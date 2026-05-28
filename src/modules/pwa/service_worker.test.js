import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { describe, expect, test, vi } from 'vitest'

const load_service_worker = async ( overrides = {} ) => {
    const listeners = {}
    const cache = {
        addAll: vi.fn(),
        delete: vi.fn(),
        keys: vi.fn().mockResolvedValue( [] ),
        match: vi.fn(),
        put: vi.fn()
    }
    const caches = {
        keys: vi.fn().mockResolvedValue( [] ),
        delete: vi.fn(),
        match: vi.fn(),
        open: vi.fn().mockResolvedValue( cache )
    }
    const self = {
        location: {
            origin: `https://journal.test`
        },
        clients: {
            claim: vi.fn()
        },
        skipWaiting: vi.fn(),
        addEventListener: vi.fn( ( event_name, listener ) => {
            listeners[ event_name ] = listener
        } )
    }
    const fetch = vi.fn().mockResolvedValue( new Response( `<html></html>`, {
        headers: {
            'content-type': `text/html`
        }
    } ) )
    const code = await readFile( new URL( `../../../public/sw.js`, import.meta.url ), `utf8` )

    vm.runInNewContext( code, {
        URL,
        caches,
        fetch,
        Promise,
        Response,
        self,
        ...overrides
    } )

    return {
        cache,
        caches,
        fetch,
        listeners,
        self
    }
}

describe( `service worker`, () => {
    test( `installs without forcing a waiting update to activate`, async () => {
        const { cache, listeners, self } = await load_service_worker()
        let install_promise = null

        cache.addAll.mockRejectedValue( new Error( `Cache write failed` ) )

        listeners.install( {
            waitUntil: ( promise ) => {
                install_promise = promise
            }
        } )

        await expect( install_promise ).resolves.toBe( null )
        expect( self.skipWaiting ).not.toHaveBeenCalled()
    } )

    test( `activates a waiting update after the page asks to skip waiting`, async () => {
        const { listeners, self } = await load_service_worker()

        listeners.message( {
            data: {
                type: `SKIP_WAITING`
            }
        } )

        expect( self.skipWaiting ).toHaveBeenCalledTimes( 1 )
    } )

    test( `refreshes navigations from the root app shell without sending route metadata`, async () => {
        const { fetch, listeners } = await load_service_worker()
        let response_promise = null

        listeners.fetch( {
            request: {
                method: `GET`,
                mode: `navigate`,
                url: `https://journal.test/projects/local-project-id`
            },
            respondWith: ( promise ) => {
                response_promise = promise
            }
        } )

        await response_promise

        expect( fetch ).toHaveBeenCalledWith( `/`, { cache: `reload` } )
        expect(
            fetch.mock.calls.flat().some( ( value ) => {
                return String( value?.url ?? value ).includes( `local-project-id` )
                    || String( value?.url ?? value ).includes( `/index.html` )
            } )
        ).toBe( false )
    } )

    test( `updates cached navigations only after build assets are cached`, async () => {
        const build_asset_urls = [ `/assets/new.js`, `/assets/new.css` ]
        const stale_request = new Request( `https://journal.test/assets/old.js` )
        const index_response = new Response( `
            <html>
                <script type="module" src="${ build_asset_urls[ 0 ] }"></script>
                <link rel="stylesheet" href="${ build_asset_urls[ 1 ] }">
            </html>
        ` )
        const { cache, fetch, listeners } = await load_service_worker()
        let response_promise = null

        fetch.mockImplementation( ( resource ) => {
            if( resource === `/` ) return Promise.resolve( index_response )
            if( resource === build_asset_urls[ 0 ] ) return Promise.resolve( new Response( `js` ) )
            if( resource === build_asset_urls[ 1 ] ) return Promise.resolve( new Response( `css` ) )
            return Promise.reject( new Error( `Unexpected request` ) )
        } )
        cache.keys.mockResolvedValue( [ stale_request ] )
        cache.match.mockResolvedValue( index_response )

        listeners.fetch( {
            request: {
                method: `GET`,
                mode: `navigate`,
                url: `https://journal.test/projects/project-1`
            },
            respondWith: ( promise ) => {
                response_promise = promise
            }
        } )

        await response_promise

        const index_put_order = cache.put.mock.invocationCallOrder.at( -1 )
        const build_asset_put_orders = build_asset_urls.map( ( asset_url ) => {
            const put_index = cache.put.mock.calls.findIndex( ( [ key ] ) => key === asset_url )
            return cache.put.mock.invocationCallOrder[ put_index ]
        } )

        expect( fetch ).toHaveBeenCalledWith( build_asset_urls[ 0 ], { cache: `reload` } )
        expect( fetch ).toHaveBeenCalledWith( build_asset_urls[ 1 ], { cache: `reload` } )
        expect( build_asset_put_orders.every( ( order ) => order < index_put_order ) ).toBe( true )
        expect( cache.put ).toHaveBeenCalledWith( build_asset_urls[ 0 ], expect.any( Response ) )
        expect( cache.put ).toHaveBeenCalledWith( build_asset_urls[ 1 ], expect.any( Response ) )
        expect( cache.put ).toHaveBeenCalledWith( `/index.html`, expect.any( Response ) )
        expect( cache.delete ).toHaveBeenCalledWith( stale_request )
    } )

    test( `does not prune newer build assets from a concurrent navigation`, async () => {
        const newer_request = new Request( `https://journal.test/assets/newer.js` )
        const older_index_response = new Response( `
            <html>
                <script type="module" src="/assets/older.js"></script>
            </html>
        ` )
        const newer_index_response = new Response( `
            <html>
                <script type="module" src="/assets/newer.js"></script>
            </html>
        ` )
        const { cache, fetch, listeners } = await load_service_worker()
        let response_promise = null

        fetch.mockImplementation( ( resource ) => {
            if( resource === `/` ) return Promise.resolve( older_index_response )
            if( resource === `/assets/older.js` ) return Promise.resolve( new Response( `older js` ) )
            return Promise.reject( new Error( `Unexpected request` ) )
        } )
        cache.keys.mockResolvedValue( [ newer_request ] )
        cache.match.mockResolvedValue( newer_index_response )

        listeners.fetch( {
            request: {
                method: `GET`,
                mode: `navigate`,
                url: `https://journal.test/projects/project-1`
            },
            respondWith: ( promise ) => {
                response_promise = promise
            }
        } )

        await response_promise

        expect( cache.delete ).not.toHaveBeenCalledWith( newer_request )
    } )

    test( `does not serve a broken cached shell when a refresh cannot be cached`, async () => {
        const fresh_index = new Response( `
            <html>
                <script type="module" src="/assets/fresh.js"></script>
            </html>
        ` )
        const stale_index = new Response( `
            <html>
                <script type="module" src="/assets/missing-old.js"></script>
            </html>
        ` )
        const { caches, fetch, listeners } = await load_service_worker()
        let response_promise = null

        fetch.mockImplementation( ( resource ) => {
            if( resource === `/` ) return Promise.resolve( fresh_index )
            if( resource === `/assets/fresh.js` ) return Promise.reject( new Error( `Asset not ready` ) )
            return Promise.reject( new Error( `Unexpected request` ) )
        } )
        caches.match
            .mockResolvedValueOnce( stale_index )
            .mockResolvedValueOnce( null )

        listeners.fetch( {
            request: {
                method: `GET`,
                mode: `navigate`,
                url: `https://journal.test/projects/project-1`
            },
            respondWith: ( promise ) => {
                response_promise = promise
            }
        } )

        await expect( response_promise ).resolves.toBe( fresh_index )
        expect( caches.match ).toHaveBeenCalledWith( `/assets/missing-old.js` )
    } )

    test( `falls back to the cached app shell when navigation refresh is not cacheable`, async () => {
        const fallback_response = new Response( `<html>cached</html>` )
        const { cache, caches, fetch, listeners } = await load_service_worker()
        let response_promise = null

        fetch.mockResolvedValue( new Response( `<html>error</html>`, { status: 500 } ) )
        caches.match.mockResolvedValue( fallback_response )

        listeners.fetch( {
            request: {
                method: `GET`,
                mode: `navigate`,
                url: `https://journal.test/projects/project-1`
            },
            respondWith: ( promise ) => {
                response_promise = promise
            }
        } )

        await expect( response_promise ).resolves.toBe( fallback_response )
        expect( cache.addAll ).not.toHaveBeenCalled()
        expect( cache.put ).not.toHaveBeenCalled()
    } )

    test( `returns a controlled offline response when navigation refresh is not cacheable and uncached`, async () => {
        const { caches, fetch, listeners } = await load_service_worker()
        let response_promise = null

        fetch.mockResolvedValue( new Response( `<html>Cloudflare error</html>`, { status: 502 } ) )
        caches.match.mockResolvedValue( null )

        listeners.fetch( {
            request: {
                method: `GET`,
                mode: `navigate`,
                url: `https://journal.test/projects/project-1`
            },
            respondWith: ( promise ) => {
                response_promise = promise
            }
        } )

        const response = await response_promise

        expect( response.status ).toBe( 503 )
        expect( await response.text() ).toMatch( /Offline/ )
    } )

    test( `keeps older caches when the current cache has no valid shell`, async () => {
        const { cache, caches, listeners } = await load_service_worker()
        let activate_promise = null

        cache.match.mockResolvedValue( null )
        caches.keys.mockResolvedValue( [ `daily-video-journal-v4`, `daily-video-journal-v5` ] )

        listeners.activate( {
            waitUntil: ( promise ) => {
                activate_promise = promise
            }
        } )

        await activate_promise

        expect( caches.delete ).not.toHaveBeenCalled()
    } )

    test( `deletes older caches after the current cache has a valid shell`, async () => {
        const index_response = new Response( `
            <html>
                <script type="module" src="/assets/current.js"></script>
            </html>
        ` )
        const { cache, caches, listeners } = await load_service_worker()
        let activate_promise = null

        cache.match.mockImplementation( ( asset_url ) => {
            if( asset_url === `/index.html` ) return Promise.resolve( index_response )
            if( asset_url === `/assets/current.js` ) return Promise.resolve( new Response( `current js` ) )
            return Promise.resolve( null )
        } )
        caches.keys.mockResolvedValue( [ `daily-video-journal-v4`, `daily-video-journal-v5` ] )

        listeners.activate( {
            waitUntil: ( promise ) => {
                activate_promise = promise
            }
        } )

        await activate_promise

        expect( caches.delete ).toHaveBeenCalledWith( `daily-video-journal-v4` )
        expect( caches.delete ).not.toHaveBeenCalledWith( `daily-video-journal-v5` )
    } )

    test( `returns a controlled offline response when navigation shell is uncached`, async () => {
        const { caches, fetch, listeners } = await load_service_worker()
        let response_promise = null

        fetch.mockRejectedValue( new Error( `Offline` ) )
        caches.match.mockResolvedValue( null )

        listeners.fetch( {
            request: {
                method: `GET`,
                mode: `navigate`,
                url: `https://journal.test/projects/project-1`
            },
            respondWith: ( promise ) => {
                response_promise = promise
            }
        } )

        const response = await response_promise

        expect( response.status ).toBe( 503 )
        expect( await response.text() ).toMatch( /Offline/ )
    } )

    test( `refreshes build assets from the network before using cached copies`, async () => {
        const network_asset = new Response( `network asset` )
        const cached_asset = new Response( `cached asset` )
        const { cache, caches, fetch, listeners } = await load_service_worker()
        let response_promise = null

        fetch.mockResolvedValue( network_asset )
        caches.match.mockResolvedValue( cached_asset )

        listeners.fetch( {
            request: new Request( `https://journal.test/assets/index.js` ),
            respondWith: ( promise ) => {
                response_promise = promise
            }
        } )

        await expect( response_promise ).resolves.toBe( network_asset )
        expect( fetch ).toHaveBeenCalledWith( expect.any( Request ), { cache: `reload` } )
        expect( cache.put ).toHaveBeenCalledWith( expect.any( Request ), expect.any( Response ) )
        expect( caches.match ).not.toHaveBeenCalled()
    } )

    test( `serves build assets from a cached path when network refresh misses`, async () => {
        const cached_asset = new Response( `asset` )
        const { caches, fetch, listeners } = await load_service_worker()
        let response_promise = null

        fetch.mockRejectedValue( new Error( `Offline` ) )
        caches.match
            .mockResolvedValueOnce( null )
            .mockResolvedValueOnce( cached_asset )

        listeners.fetch( {
            request: new Request( `https://journal.test/assets/index.js` ),
            respondWith: ( promise ) => {
                response_promise = promise
            }
        } )

        await expect( response_promise ).resolves.toBe( cached_asset )
        expect( caches.match ).toHaveBeenNthCalledWith( 1, expect.any( Request ) )
        expect( caches.match ).toHaveBeenNthCalledWith( 2, `/assets/index.js` )
    } )

    test( `returns a controlled offline response for uncached same-origin requests`, async () => {
        const { caches, fetch, listeners } = await load_service_worker()
        let response_promise = null

        fetch.mockRejectedValue( new Error( `Offline` ) )
        caches.match.mockResolvedValue( null )

        listeners.fetch( {
            request: new Request( `https://journal.test/assets/missing.js` ),
            respondWith: ( promise ) => {
                response_promise = promise
            }
        } )

        const response = await response_promise

        expect( response.status ).toBe( 503 )
        expect( await response.text() ).toMatch( /Offline/ )
    } )
} )
