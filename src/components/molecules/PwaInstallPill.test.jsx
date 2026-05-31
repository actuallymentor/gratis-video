/* @vitest-environment jsdom */

import { afterEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PwaInstallPill } from './PwaInstallPill.jsx'

const original_match_media = window.matchMedia

const make_install_event = () => {
    const event = new Event( `beforeinstallprompt`, { cancelable: true } )
    const prompt = vi.fn().mockResolvedValue( { outcome: `accepted` } )

    Object.defineProperty( event, `prompt`, {
        configurable: true,
        value: prompt
    } )

    return {
        event,
        prompt
    }
}

const mock_display_mode = ( active_display_mode = `browser` ) => {
    window.matchMedia = vi.fn( ( query ) => ( {
        matches: query.includes( `(display-mode: ${ active_display_mode })` ),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
    } ) )
}

describe( `PWA install pill`, () => {
    afterEach( () => {
        cleanup()
        vi.restoreAllMocks()
        delete window.navigator.standalone
        window.matchMedia = original_match_media
    } )

    test( `captures the browser install prompt and invokes it from the pill`, async () => {
        const { event, prompt } = make_install_event()

        render( <PwaInstallPill /> )

        expect( screen.queryByRole( `button`, { name: /Install app/i } ) ).toBe( null )

        await act( async () => {
            window.dispatchEvent( event )
        } )

        expect( event.defaultPrevented ).toBe( true )

        fireEvent.click( screen.getByRole( `button`, { name: /Install app/i } ) )

        await waitFor( () => {
            expect( prompt ).toHaveBeenCalledTimes( 1 )
        } )
        expect( screen.queryByRole( `button`, { name: /Install app/i } ) ).toBe( null )
    } )

    test( `hides when the app is already running in PWA display mode`, async () => {
        const { event, prompt } = make_install_event()

        mock_display_mode( `standalone` )
        render( <PwaInstallPill /> )

        await act( async () => {
            window.dispatchEvent( event )
        } )

        expect( event.defaultPrevented ).toBe( true )
        expect( prompt ).not.toHaveBeenCalled()
        expect( screen.queryByRole( `button`, { name: /Install app/i } ) ).toBe( null )
    } )

    test( `hides after the appinstalled event fires`, async () => {
        const { event } = make_install_event()

        render( <PwaInstallPill /> )

        await act( async () => {
            window.dispatchEvent( event )
        } )

        expect( screen.getByRole( `button`, { name: /Install app/i } ) ).toBeTruthy()

        await act( async () => {
            window.dispatchEvent( new Event( `appinstalled` ) )
        } )

        expect( screen.queryByRole( `button`, { name: /Install app/i } ) ).toBe( null )
    } )
} )
