/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
    MemoryRouter,
    Route,
    Routes,
    useLocation,
    useNavigate
} from 'react-router'
import { ProjectCapturePage } from './ProjectCapturePage.jsx'
import {
    default_export_progress,
    default_permission_status,
    useAppStore
} from '../../stores/app_store.js'
import {
    delete_clip,
    get_active_project,
    get_export_blob,
    get_clip_thumbnail_blob,
    get_project,
    get_project_clips,
    get_valid_cached_export,
    is_valid_export_blob,
    load_settings,
    move_clip,
    save_settings,
    set_active_project
} from '../../modules/storage/journal_storage.js'
import { share_export_file } from '../../modules/sharing/share.js'

const recording_state = vi.hoisted( () => ( {
    error_message: null,
    permission_recovery_needed: false,
    recording_state: `idle`,
    camera_devices: [],
    selected_video_device_id: null,
    select_camera_device: vi.fn(),
    open_preview: vi.fn(),
    refresh_preview: vi.fn(),
    press_record: vi.fn(),
    release_record: vi.fn(),
    cancel_record: vi.fn(),
    toggle_recording: vi.fn()
} ) )

vi.mock( '../../hooks/use_recording_controller.js', () => ( {
    useRecordingController: () => ( {
        stream: null,
        error_message: recording_state.error_message,
        permission_recovery_needed: recording_state.permission_recovery_needed,
        recording_state: recording_state.recording_state,
        elapsed_ms: 0,
        camera_devices: recording_state.camera_devices,
        selected_video_device_id: recording_state.selected_video_device_id,
        select_camera_device: recording_state.select_camera_device,
        open_preview: recording_state.open_preview,
        refresh_preview: recording_state.refresh_preview,
        press_record: recording_state.press_record,
        release_record: recording_state.release_record,
        cancel_record: recording_state.cancel_record,
        toggle_recording: recording_state.toggle_recording
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
    ExportPanel: ( { initial_export_record, on_close, on_export_ready } ) => <div role="dialog">
        Export panel open { initial_export_record ? `for cached export` : `for compile` }
        <button
            type="button"
            onClick={ () => on_export_ready?.( {
                export_record: {
                    id: `export-ready`,
                    filename: `ready.webm`,
                    mime_type: `video/webm`,
                    settings_hash: `settings`,
                    clip_manifest_hash: `clips`
                },
                blob: new Blob( [ `ready` ], { type: `video/webm` } )
            } ) }
        >
            Mark export ready
        </button>
        <button type="button" onClick={ on_close }>Close export panel</button>
    </div>
} ) )

vi.mock( '../../modules/storage/journal_storage.js', () => ( {
    delete_clip: vi.fn(),
    get_active_project: vi.fn(),
    get_export_blob: vi.fn(),
    get_clip_thumbnail_blob: vi.fn(),
    get_project: vi.fn(),
    get_project_clips: vi.fn(),
    get_valid_cached_export: vi.fn(),
    is_valid_export_blob: vi.fn(),
    load_settings: vi.fn(),
    move_clip: vi.fn(),
    save_settings: vi.fn(),
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
    recording_video_preset: `1080p30`,
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

const make_deferred = () => {
    let resolve
    const promise = new Promise( ( promise_resolve ) => {
        resolve = promise_resolve
    } )

    return { promise, resolve }
}

const render_capture = () => render(
    <MemoryRouter initialEntries={ [ `/projects/project-1` ] }>
        <Routes>
            <Route path="/projects" element={ <LocationProbe /> } />
            <Route path="/projects/:project_id" element={ <ProjectCapturePage /> } />
        </Routes>
    </MemoryRouter>
)

function SwitchableCapture() {
    const navigate = useNavigate()

    return <>
        <button type="button" onClick={ () => navigate( `/projects/project-2` ) }>Open second project</button>
        <ProjectCapturePage />
    </>
}

describe( `project capture page`, () => {
    beforeEach( () => {
        vi.mocked( delete_clip ).mockResolvedValue()
        vi.mocked( get_active_project ).mockResolvedValue( null )
        vi.mocked( get_export_blob ).mockResolvedValue( new Blob( [ `export` ], { type: `video/webm` } ) )
        vi.mocked( get_clip_thumbnail_blob ).mockResolvedValue( null )
        vi.mocked( get_project ).mockResolvedValue( project )
        vi.mocked( get_project_clips ).mockResolvedValue( [ clip ] )
        vi.mocked( get_valid_cached_export ).mockResolvedValue( null )
        vi.mocked( is_valid_export_blob ).mockImplementation( ( export_record, blob ) => {
            return Boolean( export_record?.mime_type?.startsWith( `video/` ) && blob?.size > 0 )
        } )
        vi.mocked( load_settings ).mockResolvedValue( settings )
        vi.mocked( move_clip ).mockResolvedValue( [ clip ] )
        vi.mocked( save_settings ).mockImplementation( ( next_settings ) => Promise.resolve( next_settings ) )
        vi.mocked( set_active_project ).mockResolvedValue()
        vi.mocked( share_export_file ).mockResolvedValue( `unsupported` )
        recording_state.error_message = null
        recording_state.permission_recovery_needed = false
        recording_state.recording_state = `idle`
        recording_state.camera_devices = []
        recording_state.selected_video_device_id = null
        recording_state.select_camera_device.mockReset()
        recording_state.open_preview.mockReset()
        recording_state.refresh_preview.mockReset()
        recording_state.press_record.mockReset()
        recording_state.release_record.mockReset()
        recording_state.cancel_record.mockReset()
        recording_state.toggle_recording.mockReset()
        query_state.initial_panel = undefined
        query_state.set_panel = null
        useAppStore.setState( {
            active_project_id: null,
            permission_status: default_permission_status,
            export_progress: default_export_progress,
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
            export_progress: default_export_progress,
            storage_estimate: null
        } )
    } )

    test( `opens the export panel when no valid cached export exists`, async () => {
        const user = userEvent.setup()

        render_capture()

        expect( await screen.findByText( project.title ) ).toBeTruthy()
        await user.click( screen.getAllByRole( `button`, { name: `Share or export project` } )[ 0 ] )

        expect( await screen.findByText( /Export panel open/ ) ).toBeTruthy()
    } )

    test( `shows camera selection in video settings`, async () => {
        const user = userEvent.setup()

        recording_state.camera_devices = [
            {
                device_id: `rear-wide-camera`,
                label: `Back Ultra Wide Camera`
            },
            {
                device_id: `rear-normal-camera`,
                label: `Back Camera`
            }
        ]
        recording_state.selected_video_device_id = `rear-wide-camera`

        render_capture()

        await screen.findByText( project.title )
        await user.click( screen.getByRole( `button`, { name: `Open video settings` } ) )
        const camera_select = await screen.findByLabelText( `Camera` )

        await user.selectOptions( camera_select, `rear-normal-camera` )

        expect( recording_state.select_camera_device ).toHaveBeenCalledWith( `rear-normal-camera` )
    } )

    test( `saves the selected recording preset from video settings`, async () => {
        const user = userEvent.setup()

        render_capture()

        await screen.findByText( project.title )
        await user.click( screen.getByRole( `button`, { name: `Open video settings` } ) )
        await user.click( screen.getByRole( `button`, { name: /4K 30/ } ) )

        await waitFor( () => {
            expect( save_settings ).toHaveBeenCalledWith( expect.objectContaining( {
                recording_video_preset: `4k30`
            } ) )
        } )
        await waitFor( () => {
            expect( recording_state.refresh_preview ).toHaveBeenCalledTimes( 1 )
        } )
    } )

    test( `does not export while recording is active`, async () => {
        recording_state.recording_state = `recording`

        render_capture()

        expect( await screen.findByText( project.title ) ).toBeTruthy()
        screen.getAllByRole( `button`, { name: `Share or export project` } ).forEach( ( button ) => {
            expect( button.disabled ).toBe( true )
        } )
        expect( screen.queryByText( /Export panel open/ ) ).toBe( null )
        expect( share_export_file ).not.toHaveBeenCalled()
    } )

    test( `does not export while the latest clip is saving`, async () => {
        recording_state.recording_state = `saving`

        render_capture()

        expect( await screen.findByText( project.title ) ).toBeTruthy()
        screen.getAllByRole( `button`, { name: `Share or export project` } ).forEach( ( button ) => {
            expect( button.disabled ).toBe( true )
        } )
        expect( screen.queryByText( /Export panel open/ ) ).toBe( null )
        expect( share_export_file ).not.toHaveBeenCalled()
    } )

    test( `does not restart export when history restores the export panel`, async () => {
        const user = userEvent.setup()

        render_capture()

        expect( await screen.findByText( project.title ) ).toBeTruthy()
        await user.click( screen.getAllByRole( `button`, { name: `Share or export project` } )[ 0 ] )

        expect( await screen.findByText( /Export panel open/ ) ).toBeTruthy()

        act( () => query_state.set_panel( undefined ) )

        await waitFor( () => {
            expect( screen.queryByText( `Export panel open` ) ).toBe( null )
        } )

        act( () => query_state.set_panel( `export` ) )

        await waitFor( () => {
            expect( screen.queryByText( `Export panel open` ) ).toBe( null )
        } )
    } )

    test( `keeps the export panel mounted when history changes during compilation`, async () => {
        const user = userEvent.setup()

        render_capture()

        expect( await screen.findByText( project.title ) ).toBeTruthy()
        await user.click( screen.getAllByRole( `button`, { name: `Share or export project` } )[ 0 ] )

        expect( await screen.findByText( /Export panel open/ ) ).toBeTruthy()

        act( () => {
            useAppStore.getState().set_export_progress( {
                active: true,
                percent: 42,
                message: `Exporting clip 1 of 1`
            } )
        } )
        act( () => query_state.set_panel( undefined ) )

        await waitFor( () => {
            expect( screen.getByText( /Export panel open/ ) ).toBeTruthy()
        } )
    } )

    test( `shares a preloaded cached export from the original export tap`, async () => {
        const user = userEvent.setup()

        vi.mocked( get_valid_cached_export ).mockResolvedValue( export_record )
        vi.mocked( share_export_file ).mockResolvedValue( `shared` )

        render_capture()

        expect( await screen.findByText( project.title ) ).toBeTruthy()
        await waitFor( () => {
            expect( get_export_blob ).toHaveBeenCalledWith( export_record.id )
        } )
        await act( async () => {} )

        vi.mocked( get_export_blob ).mockClear()

        await user.click( screen.getAllByRole( `button`, { name: `Share or export project` } )[ 0 ] )

        await waitFor( () => {
            expect( share_export_file ).toHaveBeenCalledWith( {
                project,
                export_record,
                blob: expect.any( Blob )
            } )
        } )
        expect( get_export_blob ).not.toHaveBeenCalled()
        expect( screen.queryByText( `Export panel open` ) ).toBe( null )
    } )

    test( `opens cached export actions when preloaded native sharing is unsupported`, async () => {
        const user = userEvent.setup()

        vi.mocked( get_valid_cached_export ).mockResolvedValue( export_record )
        vi.mocked( share_export_file ).mockResolvedValue( `unsupported` )

        render_capture()

        expect( await screen.findByText( project.title ) ).toBeTruthy()
        await waitFor( () => {
            expect( get_export_blob ).toHaveBeenCalledWith( export_record.id )
        } )

        await user.click( screen.getAllByRole( `button`, { name: `Share or export project` } )[ 0 ] )

        expect( await screen.findByText( /for cached export/ ) ).toBeTruthy()
        expect( share_export_file ).toHaveBeenCalledWith( {
            project,
            export_record,
            blob: expect.any( Blob )
        } )
    } )

    test( `opens cached export actions when native sharing needs a fresh tap`, async () => {
        const user = userEvent.setup()

        vi.mocked( get_valid_cached_export ).mockResolvedValue( export_record )
        vi.mocked( share_export_file ).mockResolvedValue( `activation-required` )

        render_capture()

        expect( await screen.findByText( project.title ) ).toBeTruthy()
        await waitFor( () => {
            expect( get_export_blob ).toHaveBeenCalledWith( export_record.id )
        } )

        await user.click( screen.getAllByRole( `button`, { name: `Share or export project` } )[ 0 ] )

        expect( await screen.findByText( /for cached export/ ) ).toBeTruthy()
        expect( share_export_file ).toHaveBeenCalledWith( {
            project,
            export_record,
            blob: expect.any( Blob )
        } )
    } )

    test( `opens a cached export panel when a cached export is found after the tap`, async () => {
        const user = userEvent.setup()
        let allow_cache = false

        vi.mocked( get_valid_cached_export ).mockImplementation( async () => {
            return allow_cache ? export_record : null
        } )

        render_capture()

        expect( await screen.findByText( project.title ) ).toBeTruthy()
        await waitFor( () => {
            expect( get_valid_cached_export ).toHaveBeenCalled()
        } )

        allow_cache = true
        await user.click( screen.getAllByRole( `button`, { name: `Share or export project` } )[ 0 ] )

        expect( await screen.findByText( /for cached export/ ) ).toBeTruthy()
        expect( share_export_file ).not.toHaveBeenCalled()
    } )

    test( `waits for an in-flight cache lookup before compiling`, async () => {
        const user = userEvent.setup()
        const pending_lookup = make_deferred()

        vi.mocked( get_valid_cached_export )
            .mockReturnValueOnce( pending_lookup.promise )
            .mockResolvedValueOnce( export_record )

        render_capture()

        expect( await screen.findByText( project.title ) ).toBeTruthy()
        await waitFor( () => {
            expect( get_valid_cached_export ).toHaveBeenCalledTimes( 1 )
        } )

        await user.click( screen.getAllByRole( `button`, { name: `Share or export project` } )[ 0 ] )

        expect( await screen.findByText( /for cached export/ ) ).toBeTruthy()
        expect( share_export_file ).not.toHaveBeenCalled()

        await act( async () => {
            pending_lookup.resolve( null )
            await pending_lookup.promise
        } )
    } )

    test( `requires a fresh share action for a cached export discovered during the export tap`, async () => {
        const user = userEvent.setup()
        let allow_cache = false

        vi.mocked( get_valid_cached_export ).mockImplementation( async () => {
            return allow_cache ? export_record : null
        } )

        render_capture()

        expect( await screen.findByText( project.title ) ).toBeTruthy()
        await waitFor( () => {
            expect( get_valid_cached_export ).toHaveBeenCalled()
        } )

        allow_cache = true
        await user.click( screen.getAllByRole( `button`, { name: `Share or export project` } )[ 0 ] )

        expect( await screen.findByText( /for cached export/ ) ).toBeTruthy()
        expect( share_export_file ).not.toHaveBeenCalled()
    } )

    test( `compiles when a preloaded cached export blob is missing`, async () => {
        const user = userEvent.setup()

        vi.mocked( get_valid_cached_export ).mockResolvedValue( export_record )
        vi.mocked( get_export_blob ).mockResolvedValue( null )

        render_capture()

        expect( await screen.findByText( project.title ) ).toBeTruthy()
        await waitFor( () => {
            expect( get_export_blob ).toHaveBeenCalledWith( export_record.id )
        } )

        await user.click( screen.getAllByRole( `button`, { name: `Share or export project` } )[ 0 ] )

        expect( await screen.findByText( /for compile/ ) ).toBeTruthy()
        expect( share_export_file ).not.toHaveBeenCalled()
    } )

    test( `compiles when a preloaded cached export blob is invalid`, async () => {
        const user = userEvent.setup()

        vi.mocked( get_valid_cached_export ).mockResolvedValue( export_record )
        vi.mocked( get_export_blob ).mockResolvedValue( new Blob( [], { type: `video/webm` } ) )

        render_capture()

        expect( await screen.findByText( project.title ) ).toBeTruthy()
        await waitFor( () => {
            expect( get_export_blob ).toHaveBeenCalledWith( export_record.id )
        } )

        await user.click( screen.getAllByRole( `button`, { name: `Share or export project` } )[ 0 ] )

        expect( await screen.findByText( /for compile/ ) ).toBeTruthy()
        expect( share_export_file ).not.toHaveBeenCalled()
    } )

    test( `compiles when cached export metadata is found but its blob is missing`, async () => {
        const user = userEvent.setup()
        let allow_cache = false

        vi.mocked( get_valid_cached_export ).mockImplementation( async () => {
            return allow_cache ? export_record : null
        } )
        vi.mocked( get_export_blob ).mockResolvedValue( null )

        render_capture()

        expect( await screen.findByText( project.title ) ).toBeTruthy()
        await waitFor( () => {
            expect( get_valid_cached_export ).toHaveBeenCalled()
        } )

        allow_cache = true
        await user.click( screen.getAllByRole( `button`, { name: `Share or export project` } )[ 0 ] )

        expect( await screen.findByText( /for compile/ ) ).toBeTruthy()
        expect( share_export_file ).not.toHaveBeenCalled()
    } )

    test( `reuses an export completed in the current capture session`, async () => {
        const user = userEvent.setup()

        render_capture()

        expect( await screen.findByText( project.title ) ).toBeTruthy()
        await user.click( screen.getAllByRole( `button`, { name: `Share or export project` } )[ 0 ] )

        expect( await screen.findByText( /for compile/ ) ).toBeTruthy()
        await user.click( screen.getByRole( `button`, { name: `Mark export ready` } ) )
        expect( screen.getByText( /for compile/ ) ).toBeTruthy()
        await user.click( screen.getByRole( `button`, { name: `Close export panel` } ) )

        vi.mocked( get_valid_cached_export ).mockClear()
        vi.mocked( get_export_blob ).mockClear()
        vi.mocked( share_export_file ).mockResolvedValue( `shared` )

        await user.click( screen.getAllByRole( `button`, { name: `Share or export project` } )[ 0 ] )

        expect( share_export_file ).toHaveBeenCalledWith( {
            project,
            export_record: expect.objectContaining( { id: `export-ready` } ),
            blob: expect.any( Blob )
        } )
        expect( get_valid_cached_export ).not.toHaveBeenCalled()
        expect( get_export_blob ).not.toHaveBeenCalled()
    } )

    test( `does not reuse a current-session export after the queue is reordered`, async () => {
        const user = userEvent.setup()
        const second_clip = {
            ...clip,
            id: `clip-2`,
            order_index: 1,
            created_at: `2026-05-17T10:00:02.000Z`
        }
        let current_clips = [ clip, second_clip ]

        vi.mocked( get_project_clips ).mockImplementation( async () => current_clips )
        vi.mocked( move_clip ).mockImplementation( async () => {
            current_clips = [ second_clip, clip ]
            return current_clips
        } )

        render_capture()

        expect( await screen.findByText( project.title ) ).toBeTruthy()
        await user.click( screen.getAllByRole( `button`, { name: `Share or export project` } )[ 0 ] )

        expect( await screen.findByText( /for compile/ ) ).toBeTruthy()
        await user.click( screen.getByRole( `button`, { name: `Mark export ready` } ) )
        await user.click( screen.getByRole( `button`, { name: `Close export panel` } ) )

        vi.mocked( share_export_file ).mockClear()
        vi.mocked( get_valid_cached_export ).mockClear()

        await user.click( screen.getByRole( `button`, { name: `Move clip 2 earlier` } ) )
        await waitFor( () => {
            expect( move_clip ).toHaveBeenCalledWith( second_clip.id, `earlier` )
        } )

        await user.click( screen.getAllByRole( `button`, { name: `Share or export project` } )[ 0 ] )

        expect( await screen.findByText( /for compile/ ) ).toBeTruthy()
        expect( share_export_file ).not.toHaveBeenCalled()
        expect( get_valid_cached_export ).toHaveBeenCalled()
    } )

    test( `blocks stale cached sharing while a clip delete is still updating the queue`, async () => {
        const user = userEvent.setup()
        const delete_deferred = make_deferred()

        vi.spyOn( window, `confirm` ).mockReturnValue( true )
        vi.mocked( get_valid_cached_export ).mockResolvedValue( export_record )
        vi.mocked( share_export_file ).mockResolvedValue( `shared` )
        vi.mocked( delete_clip ).mockReturnValue( delete_deferred.promise )

        render_capture()

        expect( await screen.findByText( project.title ) ).toBeTruthy()
        await waitFor( () => {
            expect( get_export_blob ).toHaveBeenCalledWith( export_record.id )
        } )

        await user.click( screen.getByRole( `button`, { name: `Delete clip 1` } ) )

        await waitFor( () => {
            expect( delete_clip ).toHaveBeenCalledWith( clip.id )
        } )
        screen.getAllByRole( `button`, { name: `Share or export project` } ).forEach( ( button ) => {
            expect( button.disabled ).toBe( true )
        } )
        expect( share_export_file ).not.toHaveBeenCalled()

        await act( async () => {
            delete_deferred.resolve()
            await delete_deferred.promise
        } )
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

    test( `keeps the stop control enabled if permission state changes while recording`, async () => {
        const user = userEvent.setup()

        recording_state.recording_state = `recording`
        useAppStore.setState( {
            permission_status: {
                ...default_permission_status,
                camera: `denied`,
                media_devices: `supported`,
                media_recorder: `supported`
            }
        } )

        render_capture()

        const stop_button = await screen.findByRole( `button`, { name: `Stop recording` } )

        expect( stop_button.disabled ).toBe( false )

        await user.click( stop_button )

        expect( recording_state.release_record ).toHaveBeenCalledTimes( 1 )
    } )

    test( `blocks recording when the browser origin is not secure`, async () => {
        useAppStore.setState( {
            permission_status: {
                ...default_permission_status,
                secure_context: false,
                media_devices: `supported`,
                media_recorder: `supported`
            }
        } )

        render_capture()

        expect( await screen.findByText( /Recording requires HTTPS/ ) ).toBeTruthy()
        expect( screen.getByRole( `alert` ).textContent ).toMatch( /Recording requires HTTPS/ )
        expect( screen.getByRole( `button`, { name: `Record clip` } ).disabled ).toBe( true )
    } )

    test( `blocks recording when media devices are unavailable`, async () => {
        useAppStore.setState( {
            permission_status: {
                ...default_permission_status,
                media_devices: `unsupported`,
                media_recorder: `supported`
            }
        } )

        render_capture()

        expect( await screen.findByText( /cannot open the camera or microphone/ ) ).toBeTruthy()
        expect( screen.getByRole( `button`, { name: `Record clip` } ).disabled ).toBe( true )
    } )

    test( `shows low storage guidance near capture when recording is otherwise available`, async () => {
        useAppStore.setState( {
            storage_estimate: {
                usage: 900,
                quota: 1000
            }
        } )

        render_capture()

        expect( await screen.findByText( /Local browser storage is almost full/ ) ).toBeTruthy()
        expect( screen.getByRole( `button`, { name: `Record clip` } ).disabled ).toBe( false )
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
        expect( screen.getByRole( `link`, { name: `Open settings` } ).getAttribute( `href` ) ).toBe( `/settings?return_to=%2Fprojects%2Fproject-1` )
    } )

    test( `prefers specific permission denial guidance after a blocked recording attempt`, async () => {
        recording_state.error_message = `Camera or microphone access is blocked for this site.`
        useAppStore.setState( {
            permission_status: {
                ...default_permission_status,
                camera: `denied`,
                microphone: `prompt`,
                media_devices: `supported`,
                media_recorder: `supported`
            }
        } )

        render_capture()

        expect( await screen.findByText( /Camera access is blocked/ ) ).toBeTruthy()
        expect( screen.queryByText( /Camera or microphone access is blocked/ ) ).toBe( null )
    } )

    test( `keeps settings recovery available after a capture denial with stale permission status`, async () => {
        recording_state.error_message = `Camera or microphone access is blocked for this site.`
        recording_state.permission_recovery_needed = true
        useAppStore.setState( {
            permission_status: {
                ...default_permission_status,
                camera: `unsupported`,
                microphone: `unsupported`,
                media_devices: `supported`,
                media_recorder: `supported`
            }
        } )

        render_capture()

        expect( await screen.findByText( /Camera or microphone access is blocked/ ) ).toBeTruthy()
        expect( screen.getByRole( `link`, { name: `Open settings` } ).getAttribute( `href` ) ).toBe( `/settings?return_to=%2Fprojects%2Fproject-1` )
    } )

    test( `keeps video-only recording available when microphone permission is denied`, async () => {
        useAppStore.setState( {
            permission_status: {
                ...default_permission_status,
                camera: `granted`,
                microphone: `denied`,
                media_devices: `supported`,
                media_recorder: `supported`
            }
        } )

        render_capture()

        expect( await screen.findByText( /Recording can continue video-only/ ) ).toBeTruthy()
        expect( screen.queryByRole( `alert` ) ).toBe( null )
        expect( screen.getByRole( `status` ).textContent ).toMatch( /Recording can continue video-only/ )
        expect( screen.getByRole( `button`, { name: `Record clip` } ).disabled ).toBe( false )
    } )

    test( `shows capture failure over stale microphone denial guidance`, async () => {
        recording_state.error_message = `No camera was found on this device.`
        useAppStore.setState( {
            permission_status: {
                ...default_permission_status,
                camera: `granted`,
                microphone: `denied`,
                media_devices: `supported`,
                media_recorder: `supported`
            }
        } )

        render_capture()

        expect( await screen.findByText( /No camera was found/ ) ).toBeTruthy()
        expect( screen.queryByText( /Recording can continue video-only/ ) ).toBe( null )
        expect( screen.getByRole( `button`, { name: `Record clip` } ).disabled ).toBe( false )
    } )

    test( `deletes a clip from the capture queue after confirmation`, async () => {
        const user = userEvent.setup()

        vi.spyOn( window, `confirm` ).mockReturnValue( true )

        render_capture()

        expect( await screen.findByText( `Clip 1` ) ).toBeTruthy()
        await user.click( screen.getByRole( `button`, { name: `Delete clip 1` } ) )

        expect( delete_clip ).toHaveBeenCalledWith( clip.id )
    } )

    test( `moves a clip from the capture queue`, async () => {
        const user = userEvent.setup()
        const second_clip = {
            ...clip,
            id: `clip-2`,
            order_index: 1,
            created_at: `2026-05-17T10:00:02.000Z`
        }

        vi.mocked( get_project_clips ).mockResolvedValue( [ clip, second_clip ] )

        render_capture()

        expect( await screen.findByText( `Clip 2` ) ).toBeTruthy()
        await user.click( screen.getByRole( `button`, { name: `Move clip 2 earlier` } ) )

        expect( move_clip ).toHaveBeenCalledWith( second_clip.id, `earlier` )
    } )

    test( `redirects to another active project when the requested project cannot be loaded`, async () => {
        useAppStore.setState( { active_project_id: `stale-project` } )
        vi.mocked( get_project ).mockImplementation( async ( project_id ) => {
            if( project_id === `project-2` ) return {
                id: `project-2`,
                title: `Fallback project`
            }

            return null
        } )
        vi.mocked( get_active_project ).mockResolvedValue( {
            id: `project-2`,
            title: `Fallback project`
        } )

        render_capture()

        expect( await screen.findByText( `Fallback project` ) ).toBeTruthy()
        expect( useAppStore.getState().active_project_id ).toBe( `project-2` )
    } )

    test( `redirects to project history when no project can be loaded`, async () => {
        useAppStore.setState( { active_project_id: `stale-project` } )
        vi.mocked( get_project ).mockResolvedValue( null )
        vi.mocked( get_active_project ).mockResolvedValue( null )

        render_capture()

        expect( await screen.findByText( `/projects` ) ).toBeTruthy()
        expect( useAppStore.getState().active_project_id ).toBe( null )
    } )

    test( `ignores stale project loads after navigating to another capture route`, async () => {
        const user = userEvent.setup()
        const first_project = {
            id: `project-1`,
            title: `First project`
        }
        const second_project = {
            id: `project-2`,
            title: `Second project`
        }
        const first_project_lookup = make_deferred()

        vi.mocked( get_project ).mockImplementation( async ( project_id ) => {
            if( project_id === `project-1` ) return first_project_lookup.promise
            return second_project
        } )
        vi.mocked( get_project_clips ).mockResolvedValue( [] )

        render(
            <MemoryRouter initialEntries={ [ `/projects/project-1` ] }>
                <Routes>
                    <Route path="/projects/:project_id" element={ <SwitchableCapture /> } />
                </Routes>
            </MemoryRouter>
        )

        await user.click( screen.getByRole( `button`, { name: `Open second project` } ) )

        expect( await screen.findByText( `Second project` ) ).toBeTruthy()

        await act( async () => {
            first_project_lookup.resolve( first_project )
            await first_project_lookup.promise
        } )

        expect( screen.queryByText( `First project` ) ).toBe( null )
        expect( useAppStore.getState().active_project_id ).toBe( `project-2` )
        expect( set_active_project ).not.toHaveBeenCalledWith( `project-1` )
    } )
} )
