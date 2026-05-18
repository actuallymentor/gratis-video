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
} )
