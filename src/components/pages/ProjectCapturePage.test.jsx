/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
    MemoryRouter,
    Route,
    Routes,
    useLocation
} from 'react-router'
import { ProjectCapturePage } from './ProjectCapturePage.jsx'
import {
    default_permission_status,
    useAppStore
} from '../../stores/app_store.js'
import {
    delete_clip,
    get_export_blob,
    get_clip_thumbnail_blob,
    get_project,
    get_project_clips,
    get_valid_cached_export,
    load_settings,
    set_active_project
} from '../../modules/storage/journal_storage.js'
import { share_export_file } from '../../modules/sharing/share.js'

vi.mock( '../../hooks/use_recording_controller.js', () => ( {
    useRecordingController: () => ( {
        stream: null,
        error_message: null,
        recording_state: `idle`,
        elapsed_ms: 0,
        press_record: vi.fn(),
        release_record: vi.fn(),
        cancel_record: vi.fn(),
        toggle_recording: vi.fn()
    } )
} ) )

const query_state = vi.hoisted( () => ( {
    initial_panel: undefined,
    set_panel: null
} ) )

vi.mock( 'use-query-params', async () => {
    const { useState } = await vi.importActual( 'react' )

    return {
        StringParam: {},
        useQueryParam: () => {
            const [ panel, set_panel ] = useState( query_state.initial_panel )
            query_state.set_panel = set_panel
            return [ panel, set_panel ]
        }
    }
} )

vi.mock( '../molecules/ExportPanel.jsx', () => ( {
    ExportPanel: () => <div role="dialog">Export panel open</div>
} ) )

vi.mock( '../../modules/storage/journal_storage.js', () => ( {
    delete_clip: vi.fn(),
    get_export_blob: vi.fn(),
    get_clip_thumbnail_blob: vi.fn(),
    get_project: vi.fn(),
    get_project_clips: vi.fn(),
    get_valid_cached_export: vi.fn(),
    load_settings: vi.fn(),
    set_active_project: vi.fn()
} ) )

vi.mock( '../../modules/sharing/share.js', () => ( {
    share_export_file: vi.fn()
} ) )

const project = {
    id: `project-1`,
    title: `May 17, 2026`
}

const clip = {
    id: `clip-1`,
    order_index: 0,
    mime_type: `video/webm`,
    duration_ms: 1200,
    width: 640,
    height: 360,
    created_at: `2026-05-17T10:00:00.000Z`
}

const settings = {
    export_quality: `standard`,
    export_resolution: `source`,
    preferred_mime_type: null,
    haptics_enabled: true,
    sounds_enabled: false
}

const export_record = {
    id: `export-1`,
    filename: `may-17-2026.webm`,
    mime_type: `video/webm`,
    settings_hash: `settings`,
    clip_manifest_hash: `clips`
}

const LocationProbe = () => {
    const location = useLocation()
    return <div>{ location.pathname }</div>
}

const render_capture = () => render(
    <MemoryRouter initialEntries={ [ `/projects/project-1` ] }>
        <Routes>
            <Route path="/projects" element={ <LocationProbe /> } />
            <Route path="/projects/:project_id" element={ <ProjectCapturePage /> } />
        </Routes>
    </MemoryRouter>
)

describe( `project capture page`, () => {
    beforeEach( () => {
        vi.mocked( delete_clip ).mockResolvedValue()
        vi.mocked( get_export_blob ).mockResolvedValue( new Blob( [ `export` ], { type: `video/webm` } ) )
        vi.mocked( get_clip_thumbnail_blob ).mockResolvedValue( null )
        vi.mocked( get_project ).mockResolvedValue( project )
        vi.mocked( get_project_clips ).mockResolvedValue( [ clip ] )
        vi.mocked( get_valid_cached_export ).mockResolvedValue( null )
        vi.mocked( load_settings ).mockResolvedValue( settings )
        vi.mocked( set_active_project ).mockResolvedValue()
        vi.mocked( share_export_file ).mockResolvedValue( `unsupported` )
        query_state.initial_panel = undefined
        query_state.set_panel = null
        useAppStore.setState( {
            active_project_id: null,
            permission_status: default_permission_status,
            storage_estimate: null
        } )
    } )

    afterEach( () => {
        cleanup()
        vi.restoreAllMocks()
        vi.resetAllMocks()
        useAppStore.setState( {
            active_project_id: undefined,
            permission_status: default_permission_status,
            storage_estimate: null
        } )
    } )

    test( `opens the export panel when no valid cached export exists`, async () => {
        const user = userEvent.setup()

        render_capture()

        expect( await screen.findByText( project.title ) ).toBeTruthy()
        await user.click( screen.getAllByRole( `button`, { name: `Share or export project` } )[ 0 ] )

        expect( await screen.findByText( `Export panel open` ) ).toBeTruthy()
    } )

    test( `does not restart export when history restores the export panel`, async () => {
        const user = userEvent.setup()

        render_capture()

        expect( await screen.findByText( project.title ) ).toBeTruthy()
        await user.click( screen.getAllByRole( `button`, { name: `Share or export project` } )[ 0 ] )

        expect( await screen.findByText( `Export panel open` ) ).toBeTruthy()

        act( () => query_state.set_panel( undefined ) )

        await waitFor( () => {
            expect( screen.queryByText( `Export panel open` ) ).toBe( null )
        } )

        act( () => query_state.set_panel( `export` ) )

        await waitFor( () => {
            expect( screen.queryByText( `Export panel open` ) ).toBe( null )
        } )
    } )

    test( `shares a valid cached export from the original export tap`, async () => {
        const user = userEvent.setup()

        vi.mocked( get_valid_cached_export ).mockResolvedValue( export_record )
        vi.mocked( share_export_file ).mockResolvedValue( `shared` )

        render_capture()

        expect( await screen.findByText( project.title ) ).toBeTruthy()
        await user.click( screen.getAllByRole( `button`, { name: `Share or export project` } )[ 0 ] )

        await waitFor( () => {
            expect( share_export_file ).toHaveBeenCalledWith( {
                project,
                export_record,
                blob: expect.any( Blob )
            } )
        } )
        expect( screen.queryByText( `Export panel open` ) ).toBe( null )
    } )

    test( `does not auto-open export from restored URL state`, async () => {
        query_state.initial_panel = `export`

        render_capture()

        expect( await screen.findByText( project.title ) ).toBeTruthy()
        expect( screen.queryByText( `Export panel open` ) ).toBe( null )
    } )

    test( `blocks recording when MediaRecorder is known unavailable`, async () => {
        useAppStore.setState( {
            permission_status: {
                ...default_permission_status,
                media_devices: `supported`,
                media_recorder: `unsupported`
            }
        } )

        render_capture()

        expect( await screen.findByText( project.title ) ).toBeTruthy()
        expect( screen.getByRole( `button`, { name: `Record clip` } ).disabled ).toBe( true )
    } )

    test( `shows blocking media guidance before storage warnings`, async () => {
        useAppStore.setState( {
            permission_status: {
                ...default_permission_status,
                media_devices: `supported`,
                media_recorder: `unsupported`
            },
            storage_estimate: {
                usage: 900,
                quota: 1000
            }
        } )

        render_capture()

        expect( await screen.findByText( /cannot record video with MediaRecorder/ ) ).toBeTruthy()
        expect( screen.queryByText( /storage is almost full/i ) ).toBe( null )
    } )

    test( `shows a settings recovery route for denied media permission`, async () => {
        useAppStore.setState( {
            permission_status: {
                ...default_permission_status,
                camera: `denied`,
                media_devices: `supported`,
                media_recorder: `supported`
            }
        } )

        render_capture()

        expect( await screen.findByText( /Camera access is blocked/ ) ).toBeTruthy()
        expect( screen.getByRole( `link`, { name: `Open settings` } ).getAttribute( `href` ) ).toBe( `/settings` )
    } )

    test( `deletes a clip from the capture queue after confirmation`, async () => {
        const user = userEvent.setup()

        vi.spyOn( window, `confirm` ).mockReturnValue( true )

        render_capture()

        expect( await screen.findByText( `Clip 1` ) ).toBeTruthy()
        await user.click( screen.getByRole( `button`, { name: `Delete clip` } ) )

        expect( delete_clip ).toHaveBeenCalledWith( clip.id )
    } )

    test( `redirects to project history when the project cannot be loaded`, async () => {
        useAppStore.setState( { active_project_id: `stale-project` } )
        vi.mocked( get_project ).mockResolvedValue( null )

        render_capture()

        expect( await screen.findByText( `/projects` ) ).toBeTruthy()
        expect( useAppStore.getState().active_project_id ).toBe( null )
    } )
} )
