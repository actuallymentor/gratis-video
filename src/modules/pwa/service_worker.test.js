import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { describe, expect, test, vi } from 'vitest'

const load_service_worker = async ( overrides = {} ) => {
    const listeners = {}
    const cache = {
        addAll: vi.fn(),
        delete: vi.fn(),
        keys: vi.fn().mockResolvedValue( [] ),
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
    test( `serves navigations from the app shell URL without sending route metadata`, async () => {
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

        expect( fetch ).toHaveBeenCalledWith( `/index.html`, { cache: `reload` } )
        expect(
            fetch.mock.calls.flat().some( ( value ) => {
                return String( value?.url ?? value ).includes( `local-project-id` )
            } )
        ).toBe( false )
    } )

    test( `updates cached navigations only after build assets are cached`, async () => {
        const stale_request = new Request( `https://journal.test/assets/old.js` )
        const index_response = new Response( `
            <html>
                <script type="module" src="/assets/new.js"></script>
                <link rel="stylesheet" href="/assets/new.css">
            </html>
        ` )
        const { cache, fetch, listeners } = await load_service_worker()
        let response_promise = null

        fetch.mockResolvedValue( index_response )
        cache.keys.mockResolvedValue( [ stale_request ] )

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

        expect( cache.addAll ).toHaveBeenCalledWith( [
            `/assets/new.js`,
            `/assets/new.css`
        ] )
        expect( cache.addAll.mock.invocationCallOrder.at( -1 ) ).toBeLessThan(
            cache.put.mock.invocationCallOrder.at( -1 )
        )
        expect( cache.put ).toHaveBeenCalledWith( `/index.html`, expect.any( Response ) )
        expect( cache.delete ).toHaveBeenCalledWith( stale_request )
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

    test( `serves build assets from a cached path when request matching misses`, async () => {
        const cached_asset = new Response( `asset` )
        const { caches, listeners } = await load_service_worker()
        let response_promise = null

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
