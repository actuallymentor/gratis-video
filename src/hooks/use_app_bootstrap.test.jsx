/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { useAppBootstrap } from './use_app_bootstrap.js'
import { check_media_permissions } from '../modules/permissions/permissions.js'
import {
    estimate_storage,
    get_active_project,
    persisted_storage
} from '../modules/storage/journal_storage.js'
import {
    default_live_media_access,
    default_permission_status,
    useAppStore
} from '../stores/app_store.js'

vi.mock( '../modules/permissions/permissions.js', () => ( {
    check_media_permissions: vi.fn()
} ) )

vi.mock( '../modules/storage/journal_storage.js', () => ( {
    estimate_storage: vi.fn(),
    get_active_project: vi.fn(),
    persisted_storage: vi.fn()
} ) )

const permission_status = ( camera ) => ( {
    ...default_permission_status,
    camera,
    media_devices: `supported`,
    media_recorder: `supported`
} )

const make_deferred = () => {
    let resolve
    const promise = new Promise( ( promise_resolve ) => {
        resolve = promise_resolve
    } )

    return { promise, resolve }
}

function Harness() {
    useAppBootstrap()
    return <span>booting</span>
}

describe( `app bootstrap`, () => {
    beforeEach( () => {
        vi.mocked( estimate_storage ).mockResolvedValue( null )
        vi.mocked( get_active_project ).mockResolvedValue( {
            id: `project-1`
        } )
        vi.mocked( persisted_storage ).mockResolvedValue( null )
        useAppStore.setState( {
            active_project_id: undefined,
            live_media_access: default_live_media_access,
            permission_refresh_id: 0,
            permission_status: default_permission_status,
            storage_estimate: null,
            storage_persisted: null
        } )
    } )

    afterEach( () => {
        cleanup()
        vi.resetAllMocks()
        useAppStore.setState( {
            active_project_id: undefined,
            live_media_access: default_live_media_access,
            permission_refresh_id: 0,
            permission_status: default_permission_status,
            storage_estimate: null,
            storage_persisted: null
        } )
    } )

    test( `refreshes passive permission state when the window regains focus`, async () => {
        vi.mocked( check_media_permissions )
            .mockResolvedValueOnce( permission_status( `prompt` ) )
            .mockResolvedValueOnce( permission_status( `denied` ) )

        render( <Harness /> )

        await waitFor( () => {
            expect( useAppStore.getState().active_project_id ).toBe( `project-1` )
        } )
        expect( useAppStore.getState().permission_status.camera ).toBe( `prompt` )

        await act( async () => {
            window.dispatchEvent( new Event( `focus` ) )
        } )

        await waitFor( () => {
            expect( useAppStore.getState().permission_status.camera ).toBe( `denied` )
        } )
    } )

    test( `refreshes passive permission state when the page becomes visible`, async () => {
        vi.mocked( check_media_permissions )
            .mockResolvedValueOnce( permission_status( `prompt` ) )
            .mockResolvedValueOnce( permission_status( `granted` ) )

        render( <Harness /> )

        await waitFor( () => {
            expect( useAppStore.getState().permission_status.camera ).toBe( `prompt` )
        } )

        await act( async () => {
            document.dispatchEvent( new Event( `visibilitychange` ) )
        } )

        await waitFor( () => {
            expect( useAppStore.getState().permission_status.camera ).toBe( `granted` )
        } )
    } )

    test( `ignores stale passive refreshes after observed camera access`, async () => {
        const focus_permission = make_deferred()

        vi.mocked( check_media_permissions )
            .mockResolvedValueOnce( permission_status( `prompt` ) )
            .mockReturnValueOnce( focus_permission.promise )

        render( <Harness /> )

        await waitFor( () => {
            expect( useAppStore.getState().permission_status.camera ).toBe( `prompt` )
        } )

        await act( async () => {
            window.dispatchEvent( new Event( `focus` ) )
            await Promise.resolve()
        } )

        act( () => {
            useAppStore.getState().set_live_media_access( { camera: true } )
        } )

        await act( async () => {
            focus_permission.resolve( permission_status( `denied` ) )
            await focus_permission.promise
        } )

        expect( useAppStore.getState().permission_status.camera ).toBe( `granted` )
    } )

    test( `keeps the active project when optional passive checks fail`, async () => {
        vi.mocked( check_media_permissions ).mockResolvedValue( permission_status( `granted` ) )
        vi.mocked( estimate_storage ).mockRejectedValue( new Error( `Estimate failed` ) )
        vi.mocked( persisted_storage ).mockRejectedValue( new Error( `Persistence failed` ) )

        render( <Harness /> )

        await waitFor( () => {
            expect( useAppStore.getState().active_project_id ).toBe( `project-1` )
        } )
        expect( useAppStore.getState().permission_status.camera ).toBe( `granted` )
        expect( useAppStore.getState().storage_estimate ).toBe( null )
        expect( useAppStore.getState().storage_persisted ).toBe( null )
    } )

    test( `resolves the active project before slower passive checks finish`, async () => {
        const permission_check = make_deferred()
        const storage_estimate = make_deferred()
        const storage_persisted = make_deferred()

        vi.mocked( check_media_permissions ).mockReturnValue( permission_check.promise )
        vi.mocked( estimate_storage ).mockReturnValue( storage_estimate.promise )
        vi.mocked( persisted_storage ).mockReturnValue( storage_persisted.promise )

        render( <Harness /> )

        await waitFor( () => {
            expect( useAppStore.getState().active_project_id ).toBe( `project-1` )
        } )
        expect( useAppStore.getState().permission_status ).toEqual( default_permission_status )

        await act( async () => {
            permission_check.resolve( permission_status( `granted` ) )
            storage_estimate.resolve( { usage: 128, quota: 1024 } )
            storage_persisted.resolve( true )
        } )

        await waitFor( () => {
            expect( useAppStore.getState().permission_status.camera ).toBe( `granted` )
        } )
        expect( useAppStore.getState().storage_estimate ).toEqual( { usage: 128, quota: 1024 } )
        expect( useAppStore.getState().storage_persisted ).toBe( true )
    } )
} )
