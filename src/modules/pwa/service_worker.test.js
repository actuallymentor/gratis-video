import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { describe, expect, test, vi } from 'vitest'

const load_service_worker = async ( overrides = {} ) => {
    const listeners = {}
    const cache = {
        addAll: vi.fn(),
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
} )
