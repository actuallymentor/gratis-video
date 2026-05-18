/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
    MemoryRouter,
    Route,
    Routes,
    useLocation
} from 'react-router'
import { SettingsPage } from './SettingsPage.jsx'
import {
    default_permission_status,
    useAppStore
} from '../../stores/app_store.js'
import {
    delete_all_data,
    estimate_storage,
    load_settings,
    persisted_storage,
    save_settings
} from '../../modules/storage/journal_storage.js'
import {
    get_export_support_message,
    normalize_export_settings,
    get_supported_export_mime_types,
    get_supported_export_resolutions
} from '../../modules/export/exporter.js'

vi.mock( 'react-hot-toast', () => {
    const toast = vi.fn()
    toast.error = vi.fn()
    toast.success = vi.fn()

    return { default: toast }
} )

vi.mock( '../../modules/storage/journal_storage.js', () => ( {
    default_settings: {
        export_quality: `standard`,
        export_resolution: `source`,
        preferred_mime_type: null,
        haptics_enabled: true,
        sounds_enabled: false
    },
    delete_all_data: vi.fn(),
    estimate_storage: vi.fn(),
    load_settings: vi.fn(),
    persisted_storage: vi.fn(),
    save_settings: vi.fn()
} ) )

vi.mock( '../../modules/export/exporter.js', () => ( {
    get_export_support_message: vi.fn(),
    normalize_export_settings: vi.fn( ( loaded_settings ) => loaded_settings ),
    get_supported_export_mime_types: vi.fn(),
    get_supported_export_resolutions: vi.fn()
} ) )

const settings = {
    export_quality: `standard`,
    export_resolution: `source`,
    preferred_mime_type: null,
    haptics_enabled: true,
    sounds_enabled: false
}

const LocationProbe = () => {
    const location = useLocation()
    return <div>{ location.pathname }</div>
}

const render_settings = ( initial_entry = `/settings` ) => render(
    <MemoryRouter initialEntries={ [ initial_entry ] }>
        <Routes>
            <Route path="/settings" element={ <SettingsPage /> } />
            <Route path="/projects" element={ <LocationProbe /> } />
            <Route path="/projects/:project_id" element={ <LocationProbe /> } />
        </Routes>
    </MemoryRouter>
)

describe( `settings page`, () => {
    beforeEach( () => {
        vi.mocked( delete_all_data ).mockResolvedValue()
        vi.mocked( estimate_storage ).mockResolvedValue( {
            usage: 128,
            quota: 1024
        } )
        vi.mocked( get_export_support_message ).mockReturnValue( null )
        vi.mocked( get_supported_export_resolutions ).mockReturnValue( [
            { value: `source`, label: `Source` },
            { value: `720p`, label: `720p` }
        ] )
        vi.mocked( get_supported_export_mime_types ).mockReturnValue( [ `video/webm` ] )
        vi.mocked( normalize_export_settings ).mockImplementation( ( loaded_settings ) => ( {
            ...loaded_settings,
            export_resolution: [ `source`, `720p` ].includes( loaded_settings.export_resolution )
                ? loaded_settings.export_resolution
                : `source`,
            preferred_mime_type: [ `video/webm` ].includes( loaded_settings.preferred_mime_type )
                ? loaded_settings.preferred_mime_type
                : null
        } ) )
        vi.mocked( load_settings ).mockResolvedValue( settings )
        vi.mocked( persisted_storage ).mockResolvedValue( true )
        vi.mocked( save_settings ).mockImplementation( async ( next_settings ) => next_settings )
        useAppStore.setState( {
            active_project_id: `project-1`,
            permission_status: default_permission_status,
            storage_estimate: null,
            storage_persisted: null
        } )
    } )

    afterEach( () => {
        cleanup()
        vi.resetAllMocks()
        vi.restoreAllMocks()
    } )

    test( `shows denied media permission status in the recovery destination`, async () => {
        useAppStore.setState( {
            permission_status: {
                ...default_permission_status,
                camera: `denied`,
                microphone: `prompt`,
                media_devices: `supported`,
                media_recorder: `supported`
            }
        } )

        render_settings()

        expect( await screen.findByText( /Camera access is blocked/ ) ).toBeTruthy()
        expect( screen.getByText( /allow camera access, then return and try recording again/ ) ).toBeTruthy()
        expect( screen.getByText( `Camera: denied` ) ).toBeTruthy()
        expect( screen.getByText( `Microphone: prompt` ) ).toBeTruthy()
    } )

    test( `shows low storage guidance from the browser estimate`, async () => {
        vi.mocked( estimate_storage ).mockResolvedValue( {
            usage: 900,
            quota: 1000
        } )

        render_settings()

        expect( await screen.findByText( /Local browser storage is almost full/ ) ).toBeTruthy()
        expect( screen.getByText( /900 B used of 1000 B/ ) ).toBeTruthy()
    } )

    test( `hides the format selector until specific supported formats are proven`, async () => {
        vi.mocked( get_supported_export_mime_types ).mockReturnValue( [] )

        render_settings()

        expect( await screen.findByText( /default recorder format/ ) ).toBeTruthy()
        expect( screen.queryByLabelText( /Format/ ) ).toBe( null )
    } )

    test( `hides export format choices when export compilation is unsupported`, async () => {
        vi.mocked( get_export_support_message ).mockReturnValue( `This browser cannot capture a video export from the canvas.` )
        vi.mocked( get_supported_export_resolutions ).mockReturnValue( [] )
        vi.mocked( get_supported_export_mime_types ).mockReturnValue( [ `video/webm` ] )

        render_settings()

        expect( await screen.findAllByText( /cannot capture a video export/ ) ).toHaveLength( 1 )
        expect( screen.queryByLabelText( /Format/ ) ).toBe( null )
        expect( screen.queryByRole( `button`, { name: `High` } ) ).toBe( null )
        expect( get_supported_export_mime_types ).not.toHaveBeenCalled()
    } )

    test( `saves changed export and feedback settings`, async () => {
        const user = userEvent.setup()

        render_settings()

        expect( await screen.findByText( `Settings` ) ).toBeTruthy()
        expect( screen.getByRole( `option`, { name: `Recommended` } ) ).toBeTruthy()

        await user.selectOptions( screen.getByLabelText( /Format/ ), `video/webm` )
        await user.click( screen.getByRole( `button`, { name: `High` } ) )
        await user.click( screen.getByRole( `button`, { name: `720p` } ) )
        await user.click( screen.getByLabelText( `Haptics` ) )

        await waitFor( () => {
            expect( save_settings ).toHaveBeenCalledWith( expect.objectContaining( {
                preferred_mime_type: `video/webm`
            } ) )
        } )
        expect( save_settings ).toHaveBeenCalledWith( expect.objectContaining( {
            export_quality: `high`
        } ) )
        expect( save_settings ).toHaveBeenCalledWith( expect.objectContaining( {
            export_resolution: `720p`
        } ) )
        expect( save_settings ).toHaveBeenCalledWith( expect.objectContaining( {
            haptics_enabled: false
        } ) )
    } )

    test( `normalizes unsupported persisted export settings before displaying and saving`, async () => {
        const user = userEvent.setup()

        vi.mocked( load_settings ).mockResolvedValue( {
            ...settings,
            export_resolution: `1080p`,
            preferred_mime_type: `video/mp4`
        } )

        render_settings()

        expect( ( await screen.findByRole( `button`, { name: `Source` } ) ).getAttribute( `aria-pressed` ) ).toBe( `true` )
        expect( screen.getByLabelText( /Format/ ).value ).toBe( `` )

        await user.click( screen.getByLabelText( `Haptics` ) )

        expect( save_settings ).toHaveBeenCalledWith( expect.objectContaining( {
            export_resolution: `source`,
            preferred_mime_type: null,
            haptics_enabled: false
        } ) )
    } )

    test( `updates settings controls before storage save completes`, async () => {
        const user = userEvent.setup()
        let resolve_save

        vi.mocked( save_settings ).mockImplementation( ( next_settings ) => new Promise( ( resolve ) => {
            resolve_save = () => resolve( next_settings )
        } ) )

        render_settings()

        const haptics = await screen.findByLabelText( `Haptics` )

        await user.click( haptics )

        expect( haptics.checked ).toBe( false )
        expect( save_settings ).toHaveBeenCalledWith( expect.objectContaining( {
            haptics_enabled: false
        } ) )

        resolve_save()

        await waitFor( () => {
            expect( haptics.checked ).toBe( false )
        } )
    } )

    test( `deletes all local data after confirmation`, async () => {
        const user = userEvent.setup()
        vi.spyOn( window, `confirm` ).mockReturnValue( true )

        render_settings()

        await user.click( await screen.findByRole( `button`, { name: /Delete all local data/ } ) )

        expect( delete_all_data ).toHaveBeenCalledTimes( 1 )
        expect( useAppStore.getState().active_project_id ).toBe( null )
    } )

    test( `returns to the capture route that opened permission recovery`, async () => {
        const user = userEvent.setup()

        render_settings( `/settings?return_to=/projects/project-1` )

        await screen.findByText( `Settings` )
        await user.click( screen.getAllByRole( `button`, { name: `Back to capture` } )[ 0 ] )

        expect( await screen.findByText( `/projects/project-1` ) ).toBeTruthy()
    } )
} )
