/* @vitest-environment jsdom */

import { afterEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PwaRefreshBadge } from './PwaRefreshBadge.jsx'
import { register_service_worker_update } from '../../modules/pwa/service_worker_registration.js'

vi.mock( '../../modules/pwa/service_worker_registration.js', () => ( {
    register_service_worker_update: vi.fn()
} ) )

describe( `PWA refresh badge`, () => {
    afterEach( () => {
        cleanup()
        vi.resetAllMocks()
    } )

    test( `stays visible after an update is waiting and reloads on request`, async () => {
        let mark_update_ready = () => {}
        const update_service_worker = vi.fn().mockResolvedValue()

        vi.mocked( register_service_worker_update ).mockImplementation( ( { on_need_refresh } ) => {
            mark_update_ready = on_need_refresh
            return Promise.resolve( update_service_worker )
        } )

        render( <PwaRefreshBadge /> )

        expect( screen.queryByRole( `status` ) ).toBe( null )

        await act( async () => {
            mark_update_ready( update_service_worker )
        } )

        const badge = screen.getByRole( `status` )

        expect( badge.textContent ).toMatch( /Update ready/ )
        expect( badge.textContent ).toMatch( /Reload page/ )

        fireEvent.click( screen.getByRole( `button`, { name: /Reload/ } ) )

        await waitFor( () => {
            expect( update_service_worker ).toHaveBeenCalledTimes( 1 )
        } )
        expect( screen.getByRole( `status` ) ).toBe( badge )
    } )
} )
