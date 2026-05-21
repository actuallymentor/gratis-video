/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import toast from 'react-hot-toast'
import { useRecordingController } from './use_recording_controller.js'
import {
    default_permission_status,
    useAppStore
} from '../stores/app_store.js'
import { check_media_permissions } from '../modules/permissions/permissions.js'
import {
    add_clip_to_project,
    estimate_storage,
    persisted_storage,
    save_settings,
    update_clip_media_details
} from '../modules/storage/journal_storage.js'
import {
    create_media_recorder,
    generate_video_thumbnail,
    get_video_metadata,
    list_video_input_devices,
    play_sound_feedback,
    pulse_haptic,
    request_audio_stream,
    request_capture_stream,
    select_supported_mime_type
} from '../modules/media/recorder.js'

vi.mock( 'react-hot-toast', () => {
    const toast = vi.fn()
    toast.error = vi.fn()
    toast.success = vi.fn()

    return { default: toast }
} )

vi.mock( '../modules/storage/journal_storage.js', () => ( {
    add_clip_to_project: vi.fn(),
    estimate_storage: vi.fn(),
    persisted_storage: vi.fn(),
    save_settings: vi.fn(),
    update_clip_media_details: vi.fn()
} ) )

vi.mock( '../modules/permissions/permissions.js', () => ( {
    can_attempt_recording: vi.fn( ( permission_status ) => permission_status.camera !== `denied` ),
    check_media_permissions: vi.fn()
} ) )

vi.mock( '../modules/media/recorder.js', () => ( {
    CAPTURE_WARNING_KEY: `daily_video_journal_capture_warning`,
    DEFAULT_RECORDING_VIDEO_PRESET: `1080p30`,
    HOLD_THRESHOLD_MS: 250,
    MINIMUM_CLIP_MS: 400,
    classify_recording_gesture: ( duration_ms, threshold_ms = 250 ) => duration_ms < threshold_ms ? `tap` : `hold`,
    create_media_recorder: vi.fn(),
    generate_video_thumbnail: vi.fn().mockResolvedValue( new Blob( [ `thumb` ], { type: `image/jpeg` } ) ),
    get_capture_error_message: vi.fn( ( error ) => error.message ),
    get_recording_video_preset: vi.fn( ( value = `1080p30` ) => ( {
        value: value || `1080p30`,
        label: value || `1080p30`,
        width: 1920,
        height: 1080,
        frame_rate: 30,
        video_bits_per_second: value === `4k30` ? 24_000_000 : 8_000_000
    } ) ),
    get_video_metadata: vi.fn().mockResolvedValue( {
        duration_ms: 1000,
        width: 640,
        height: 360
    } ),
    list_video_input_devices: vi.fn().mockResolvedValue( [] ),
    play_sound_feedback: vi.fn(),
    pulse_haptic: vi.fn(),
    request_audio_stream: vi.fn(),
    request_capture_stream: vi.fn(),
    select_supported_mime_type: vi.fn(),
    stop_media_stream: vi.fn( ( stream ) => {
        stream?.getTracks().forEach( ( track ) => track.stop() )
    } )
} ) )

const make_deferred = () => {
    let resolve
    let reject
    const promise = new Promise( ( promise_resolve, promise_reject ) => {
        resolve = promise_resolve
        reject = promise_reject
    } )

    return { promise, resolve, reject }
}

const make_stream = ( { video_device_id = null } = {} ) => {
    const track = {
        addEventListener: vi.fn(),
        getSettings: vi.fn( () => video_device_id ? { deviceId: video_device_id } : {} ),
        muted: false,
        readyState: `live`,
        removeEventListener: vi.fn(),
        stop: vi.fn()
    }

    const stream = {
        getTracks: () => [ track ],
        getVideoTracks: () => [ track ]
    }

    return {
        track,
        stream
    }
}

const make_video_only_stream = () => {
    const { stream, track } = make_stream()

    stream.getAudioTracks = () => []

    return { stream, track }
}

const make_audio_stream = () => {
    const track = {
        stop: vi.fn()
    }

    const stream = {
        getTracks: () => [ track ],
        getAudioTracks: () => [ track ],
        getVideoTracks: () => []
    }

    return {
        track,
        stream
    }
}

const make_recorder = () => {
    const recorder = {
        mimeType: `video/webm`,
        state: `inactive`,
        start: vi.fn( () => {
            recorder.state = `recording`
        } ),
        stop: vi.fn( () => {
            if( recorder.state === `inactive` ) return

            recorder.state = `inactive`
            recorder.ondataavailable?.( {
                data: new Blob( [ `video` ], { type: `video/webm` } )
            } )
            recorder.onstop?.()
        } )
    }

    return recorder
}

let controller
let recording_settings
const clip_saved = vi.fn()

function Harness() {
    controller = useRecordingController( {
        project_id: `project-1`,
        settings: recording_settings,
        on_clip_saved: clip_saved
    } )

    return <span>{ controller.recording_state }</span>
}

describe( `recording controller`, () => {
    beforeEach( () => {
        useAppStore.setState( {
            media_stream_state: `idle`,
            recording_state: `idle`,
            permission_status: default_permission_status
        } )
        vi.mocked( add_clip_to_project ).mockReset()
        vi.mocked( check_media_permissions ).mockReset()
        vi.mocked( create_media_recorder ).mockReset()
        vi.mocked( estimate_storage ).mockReset()
        vi.mocked( generate_video_thumbnail ).mockReset()
        vi.mocked( get_video_metadata ).mockReset()
        vi.mocked( list_video_input_devices ).mockReset()
        vi.mocked( persisted_storage ).mockReset()
        vi.mocked( play_sound_feedback ).mockReset()
        vi.mocked( pulse_haptic ).mockReset()
        vi.mocked( request_audio_stream ).mockReset()
        vi.mocked( request_capture_stream ).mockReset()
        vi.mocked( save_settings ).mockReset()
        vi.mocked( select_supported_mime_type ).mockReset()
        vi.mocked( update_clip_media_details ).mockReset()
        vi.stubGlobal( `MediaRecorder`, () => {} )
        clip_saved.mockReset()
        recording_settings = {
            haptics_enabled: false,
            recording_video_preset: `1080p30`,
            sounds_enabled: false
        }
        vi.mocked( add_clip_to_project ).mockResolvedValue( { id: `clip-1` } )
        vi.mocked( check_media_permissions ).mockResolvedValue( {
            camera: `granted`,
            microphone: `granted`,
            secure_context: true,
            media_devices: `supported`,
            media_recorder: `supported`,
            offline: false
        } )
        vi.mocked( estimate_storage ).mockResolvedValue( { usage: 128, quota: 1024 } )
        vi.mocked( generate_video_thumbnail ).mockResolvedValue( new Blob( [ `thumb` ], { type: `image/jpeg` } ) )
        vi.mocked( get_video_metadata ).mockResolvedValue( {
            duration_ms: 1000,
            width: 640,
            height: 360
        } )
        vi.mocked( list_video_input_devices ).mockResolvedValue( [] )
        vi.mocked( persisted_storage ).mockResolvedValue( true )
        vi.mocked( request_audio_stream ).mockResolvedValue( make_audio_stream().stream )
        vi.mocked( save_settings ).mockResolvedValue( {} )
        vi.mocked( select_supported_mime_type ).mockReturnValue( `video/webm` )
        vi.mocked( update_clip_media_details ).mockResolvedValue( { id: `clip-1` } )
    } )

    afterEach( () => {
        cleanup()
        vi.restoreAllMocks()
        vi.unstubAllGlobals()
        vi.clearAllMocks()
        Object.defineProperty( document, `hidden`, {
            configurable: true,
            value: false
        } )
        useAppStore.setState( {
            recording_state: `idle`,
            permission_status: default_permission_status
        } )
        controller = null
    } )

    test( `stops pending startup without opening a recorder after pointer cancellation`, async () => {
        const stream_deferred = make_deferred()
        const { stream, track } = make_stream()

        vi.mocked( request_capture_stream ).mockReturnValue( stream_deferred.promise )

        render( <Harness /> )

        act( () => {
            controller.press_record()
            controller.cancel_record()
        } )

        await act( async () => {
            stream_deferred.resolve( stream )
            await stream_deferred.promise
        } )

        await waitFor( () => {
            expect( track.stop ).toHaveBeenCalledTimes( 1 )
        } )
        expect( create_media_recorder ).not.toHaveBeenCalled()
        expect( add_clip_to_project ).not.toHaveBeenCalled()
        expect( useAppStore.getState().recording_state ).toBe( `idle` )
    } )

    test( `does not open media devices when MediaRecorder is unavailable`, async () => {
        vi.stubGlobal( `MediaRecorder`, undefined )

        render( <Harness /> )

        await act( async () => {
            controller.press_record()
            await Promise.resolve()
        } )

        expect( request_capture_stream ).not.toHaveBeenCalled()
        expect( create_media_recorder ).not.toHaveBeenCalled()
        expect( useAppStore.getState().recording_state ).toBe( `idle` )
        expect( controller.error_message ).toMatch( /cannot record video with MediaRecorder/ )
    } )

    test( `marks permission recovery after a capture denial`, async () => {
        const denied_error = new Error( `Permission denied` )
        denied_error.name = `NotAllowedError`

        vi.mocked( request_capture_stream ).mockRejectedValue( denied_error )

        render( <Harness /> )

        await act( async () => {
            controller.press_record()
            await Promise.resolve()
        } )

        await waitFor( () => {
            expect( controller.permission_recovery_needed ).toBe( true )
        } )
        expect( controller.error_message ).toBe( `Permission denied` )
        expect( create_media_recorder ).not.toHaveBeenCalled()
    } )

    test( `requests video-only capture when microphone permission is known denied`, async () => {
        const { stream } = make_video_only_stream()
        const recorder = make_recorder()

        useAppStore.setState( {
            permission_status: {
                camera: `granted`,
                microphone: `denied`,
                secure_context: true,
                media_devices: `supported`,
                media_recorder: `supported`,
                offline: false
            }
        } )
        vi.mocked( request_capture_stream ).mockResolvedValue( stream )
        vi.mocked( create_media_recorder ).mockReturnValue( recorder )

        render( <Harness /> )

        await act( async () => {
            controller.press_record()
            await Promise.resolve()
        } )

        expect( request_capture_stream ).toHaveBeenCalledWith( {
            audio_enabled: false,
            recording_video_preset: `1080p30`
        } )
        expect( controller.error_message ).toMatch( /Microphone access is blocked/ )
    } )

    test( `reuses the camera stream from the live preview when recording starts`, async () => {
        const preview = make_stream( { video_device_id: `rear-normal-camera` } )
        const audio = make_audio_stream()
        const recorder = make_recorder()

        vi.mocked( request_audio_stream ).mockResolvedValue( audio.stream )
        vi.mocked( request_capture_stream ).mockResolvedValueOnce( preview.stream )
        vi.mocked( create_media_recorder ).mockReturnValue( recorder )

        render( <Harness /> )

        await act( async () => {
            await controller.open_preview( { force: true } )
        } )

        expect( request_capture_stream ).toHaveBeenNthCalledWith( 1, {
            audio_enabled: false,
            recording_video_preset: `1080p30`
        } )

        await act( async () => {
            controller.press_record()
            await Promise.resolve()
        } )

        await waitFor( () => {
            expect( recorder.start ).toHaveBeenCalledTimes( 1 )
        } )
        expect( request_capture_stream ).toHaveBeenCalledTimes( 1 )
        expect( request_audio_stream ).toHaveBeenCalledTimes( 1 )
        const [ [ recording_stream ] ] = vi.mocked( create_media_recorder ).mock.calls

        expect( recording_stream.getVideoTracks() ).toEqual( [ preview.track ] )
        expect( recording_stream.getAudioTracks() ).toEqual( [ audio.track ] )
        expect( preview.track.stop ).not.toHaveBeenCalled()
    } )

    test( `opens preview with the remembered camera device`, async () => {
        const preview = make_stream( { video_device_id: `rear-normal-camera` } )

        recording_settings = {
            ...recording_settings,
            last_video_device_id: `rear-normal-camera`
        }
        vi.mocked( request_capture_stream ).mockResolvedValue( preview.stream )

        render( <Harness /> )

        await act( async () => {
            await controller.open_preview( { force: true } )
        } )

        expect( request_capture_stream ).toHaveBeenCalledWith( {
            audio_enabled: false,
            recording_video_preset: `1080p30`,
            video_device_id: `rear-normal-camera`
        } )
    } )

    test( `reopens preview with a selected camera device`, async () => {
        const first_preview = make_stream( { video_device_id: `rear-wide-camera` } )
        const second_preview = make_stream( { video_device_id: `rear-normal-camera` } )

        vi.mocked( list_video_input_devices ).mockResolvedValue( [
            {
                device_id: `rear-wide-camera`,
                group_id: `rear`,
                label: `Back Ultra Wide Camera`
            },
            {
                device_id: `rear-normal-camera`,
                group_id: `rear`,
                label: `Back Camera`
            }
        ] )
        vi.mocked( request_capture_stream )
            .mockResolvedValueOnce( first_preview.stream )
            .mockResolvedValueOnce( second_preview.stream )

        render( <Harness /> )

        await act( async () => {
            await controller.open_preview( { force: true } )
        } )

        await waitFor( () => {
            expect( controller.camera_devices ).toHaveLength( 2 )
        } )

        act( () => {
            controller.select_camera_device( `rear-normal-camera` )
        } )

        await waitFor( () => {
            expect( request_capture_stream ).toHaveBeenCalledTimes( 2 )
        } )
        expect( request_capture_stream ).toHaveBeenNthCalledWith( 2, {
            audio_enabled: false,
            recording_video_preset: `1080p30`,
            video_device_id: `rear-normal-camera`
        } )
        expect( save_settings ).toHaveBeenLastCalledWith( {
            last_video_device_id: `rear-normal-camera`
        } )
        expect( first_preview.track.stop ).toHaveBeenCalledTimes( 1 )
    } )

    test( `falls back when the remembered camera device is stale`, async () => {
        const stale_camera_error = new DOMException( `Camera missing`, `OverconstrainedError` )
        const preview = make_stream()

        recording_settings = {
            ...recording_settings,
            last_video_device_id: `removed-camera`
        }
        vi.mocked( request_capture_stream )
            .mockRejectedValueOnce( stale_camera_error )
            .mockResolvedValueOnce( preview.stream )

        render( <Harness /> )

        await act( async () => {
            await controller.open_preview( { force: true } )
        } )

        expect( request_capture_stream ).toHaveBeenNthCalledWith( 1, {
            audio_enabled: false,
            recording_video_preset: `1080p30`,
            video_device_id: `removed-camera`
        } )
        expect( request_capture_stream ).toHaveBeenNthCalledWith( 2, {
            audio_enabled: false,
            recording_video_preset: `1080p30`
        } )
        expect( save_settings ).toHaveBeenCalledWith( {
            last_video_device_id: null
        } )
    } )

    test( `reopens the idle preview after returning from a hidden page`, async () => {
        const first_preview = make_stream( { video_device_id: `rear-normal-camera` } )
        const second_preview = make_stream( { video_device_id: `rear-normal-camera` } )

        vi.mocked( request_capture_stream )
            .mockResolvedValueOnce( first_preview.stream )
            .mockResolvedValueOnce( second_preview.stream )

        render( <Harness /> )

        await act( async () => {
            await controller.open_preview( { force: true } )
        } )

        expect( controller.stream ).toBe( first_preview.stream )

        Object.defineProperty( document, `hidden`, {
            configurable: true,
            value: true
        } )

        act( () => document.dispatchEvent( new Event( `visibilitychange` ) ) )

        expect( first_preview.track.stop ).toHaveBeenCalledTimes( 1 )
        expect( useAppStore.getState().media_stream_state ).toBe( `idle` )

        Object.defineProperty( document, `hidden`, {
            configurable: true,
            value: false
        } )

        act( () => document.dispatchEvent( new Event( `visibilitychange` ) ) )

        await waitFor( () => {
            expect( request_capture_stream ).toHaveBeenCalledTimes( 2 )
        } )
        await waitFor( () => {
            expect( controller.stream ).toBe( second_preview.stream )
        } )
        expect( useAppStore.getState().media_stream_state ).toBe( `active` )
    } )

    test( `does not attach a preview stream that resolves while the page is hidden`, async () => {
        const preview_deferred = make_deferred()
        const first_preview = make_stream()
        const second_preview = make_stream()

        vi.mocked( request_capture_stream )
            .mockReturnValueOnce( preview_deferred.promise )
            .mockResolvedValueOnce( second_preview.stream )

        render( <Harness /> )

        const preview_promise = controller.open_preview( { force: true } )

        Object.defineProperty( document, `hidden`, {
            configurable: true,
            value: true
        } )
        act( () => document.dispatchEvent( new Event( `visibilitychange` ) ) )

        await act( async () => {
            preview_deferred.resolve( first_preview.stream )
            await preview_promise
        } )

        expect( first_preview.track.stop ).toHaveBeenCalledTimes( 1 )
        expect( controller.stream ).toBe( null )

        Object.defineProperty( document, `hidden`, {
            configurable: true,
            value: false
        } )
        act( () => window.dispatchEvent( new Event( `pageshow` ) ) )

        await waitFor( () => {
            expect( request_capture_stream ).toHaveBeenCalledTimes( 2 )
        } )
        await waitFor( () => {
            expect( controller.stream ).toBe( second_preview.stream )
        } )
    } )

    test( `reopens the visible idle preview when the video track ends`, async () => {
        const first_preview = make_stream()
        const second_preview = make_stream()

        vi.mocked( request_capture_stream )
            .mockResolvedValueOnce( first_preview.stream )
            .mockResolvedValueOnce( second_preview.stream )

        render( <Harness /> )

        await act( async () => {
            await controller.open_preview( { force: true } )
        } )

        const [ , ended_listener ] = first_preview.track.addEventListener.mock.calls.find( ( [ event_name ] ) => event_name === `ended` )

        act( () => ended_listener() )

        await waitFor( () => {
            expect( request_capture_stream ).toHaveBeenCalledTimes( 2 )
        } )
        expect( first_preview.track.stop ).toHaveBeenCalledTimes( 1 )
        await waitFor( () => {
            expect( controller.stream ).toBe( second_preview.stream )
        } )
    } )

    test( `reopens the visible idle preview when the video track stays muted`, async () => {
        const first_preview = make_stream()
        const second_preview = make_stream()
        let fake_timers_active = false

        try {
            vi.mocked( request_capture_stream )
                .mockResolvedValueOnce( first_preview.stream )
                .mockResolvedValueOnce( second_preview.stream )

            render( <Harness /> )

            await act( async () => {
                await controller.open_preview( { force: true } )
            } )

            const [ , mute_listener ] = first_preview.track.addEventListener.mock.calls.find( ( [ event_name ] ) => event_name === `mute` )

            vi.useFakeTimers()
            fake_timers_active = true
            first_preview.track.muted = true
            act( () => mute_listener() )

            await act( async () => {
                await vi.advanceTimersByTimeAsync( 700 )
            } )
            vi.useRealTimers()
            fake_timers_active = false

            await waitFor( () => {
                expect( request_capture_stream ).toHaveBeenCalledTimes( 2 )
            } )
            expect( first_preview.track.stop ).toHaveBeenCalledTimes( 1 )
            await waitFor( () => {
                expect( controller.stream ).toBe( second_preview.stream )
            } )
        } finally {
            if( fake_timers_active ) vi.useRealTimers()
        }
    } )

    test( `stops keyboard-started pending capture on page lifecycle cancellation`, async () => {
        const stream_deferred = make_deferred()
        const { stream, track } = make_stream()

        vi.mocked( request_capture_stream ).mockReturnValue( stream_deferred.promise )

        render( <Harness /> )

        act( () => {
            controller.toggle_recording()
            window.dispatchEvent( new Event( `pagehide` ) )
        } )

        await act( async () => {
            stream_deferred.resolve( stream )
            await stream_deferred.promise
        } )

        await waitFor( () => {
            expect( track.stop ).toHaveBeenCalledTimes( 1 )
        } )
        expect( create_media_recorder ).not.toHaveBeenCalled()
        expect( add_clip_to_project ).not.toHaveBeenCalled()
        expect( useAppStore.getState().recording_state ).toBe( `idle` )
    } )

    test( `stops failed recording tracks and reopens the live preview`, async () => {
        const { stream, track } = make_stream()

        vi.mocked( request_capture_stream ).mockResolvedValue( stream )
        vi.mocked( create_media_recorder ).mockImplementation( () => {
            throw new Error( `Recorder unavailable` )
        } )

        render( <Harness /> )

        await act( async () => {
            controller.press_record()
            await Promise.resolve()
        } )

        await waitFor( () => {
            expect( track.stop ).toHaveBeenCalledTimes( 1 )
        } )
        expect( useAppStore.getState().media_stream_state ).toBe( `active` )
        expect( useAppStore.getState().recording_state ).toBe( `idle` )
    } )

    test( `falls back to browser default when a supported recorder fails to start`, async () => {
        const { stream } = make_stream()
        const failed_recorder = make_recorder()
        const recovered_recorder = make_recorder()

        failed_recorder.start = vi.fn( () => {
            failed_recorder.state = `recording`
            throw new Error( `Recorder start failed` )
        } )

        vi.mocked( request_capture_stream ).mockResolvedValue( stream )
        vi.mocked( create_media_recorder )
            .mockReturnValueOnce( failed_recorder )
            .mockReturnValueOnce( recovered_recorder )

        render( <Harness /> )

        await act( async () => {
            controller.press_record()
            await Promise.resolve()
        } )

        await waitFor( () => {
            expect( recovered_recorder.start ).toHaveBeenCalledTimes( 1 )
        } )
        expect( create_media_recorder ).toHaveBeenNthCalledWith( 1, expect.any( Object ), {
            mime_type: `video/webm`,
            fallback_to_default: false,
            video_bits_per_second: 8_000_000
        } )
        expect( create_media_recorder ).toHaveBeenNthCalledWith( 2, expect.any( Object ), {
            mime_type: null,
            fallback_to_default: false,
            video_bits_per_second: 8_000_000
        } )
        expect( vi.mocked( create_media_recorder ).mock.calls[ 0 ][ 0 ].getVideoTracks() ).toEqual( stream.getVideoTracks() )
        expect( failed_recorder.ondataavailable ).toBe( null )
        expect( failed_recorder.onerror ).toBe( null )
        expect( failed_recorder.onstop ).toBe( null )
        expect( failed_recorder.stop ).toHaveBeenCalledTimes( 1 )
        expect( useAppStore.getState().recording_state ).toBe( `recording` )

        act( () => controller.cancel_record() )
        await waitFor( () => {
            expect( useAppStore.getState().recording_state ).toBe( `idle` )
        } )
    } )

    test( `does not play start feedback when recorder start fails`, async () => {
        const { stream, track } = make_stream()
        const recorder = make_recorder()

        recording_settings = {
            haptics_enabled: true,
            sounds_enabled: true
        }
        recorder.start = vi.fn( () => {
            throw new Error( `Recorder start failed` )
        } )
        vi.mocked( request_capture_stream ).mockResolvedValue( stream )
        vi.mocked( create_media_recorder ).mockReturnValue( recorder )

        render( <Harness /> )

        await act( async () => {
            controller.press_record()
            await Promise.resolve()
        } )

        await waitFor( () => {
            expect( track.stop ).toHaveBeenCalledTimes( 1 )
        } )
        expect( pulse_haptic ).not.toHaveBeenCalled()
        expect( play_sound_feedback ).not.toHaveBeenCalled()
        expect( useAppStore.getState().recording_state ).toBe( `idle` )
    } )

    test( `plays start feedback after recorder start succeeds`, async () => {
        const { stream } = make_stream()
        const recorder = make_recorder()

        recording_settings = {
            haptics_enabled: true,
            sounds_enabled: true
        }
        vi.mocked( request_capture_stream ).mockResolvedValue( stream )
        vi.mocked( create_media_recorder ).mockReturnValue( recorder )

        render( <Harness /> )

        await act( async () => {
            controller.press_record()
            await Promise.resolve()
        } )

        await waitFor( () => {
            expect( recorder.start ).toHaveBeenCalledTimes( 1 )
        } )
        expect( pulse_haptic ).toHaveBeenCalledWith( true )
        expect( play_sound_feedback ).toHaveBeenCalledWith( true, `start` )
        expect( useAppStore.getState().recording_state ).toBe( `recording` )
    } )

    test( `stops and saves a valid clip when the tab is hidden`, async () => {
        const { stream } = make_stream()
        const recorder = make_recorder()
        const date_values = [ 0, 1000 ]

        vi.spyOn( Date, `now` ).mockImplementation( () => date_values.shift() ?? 1000 )
        vi.mocked( request_capture_stream ).mockResolvedValue( stream )
        vi.mocked( create_media_recorder ).mockReturnValue( recorder )

        render( <Harness /> )

        await act( async () => {
            controller.press_record()
            await Promise.resolve()
        } )

        await waitFor( () => {
            expect( recorder.start ).toHaveBeenCalledTimes( 1 )
        } )

        Object.defineProperty( document, `hidden`, {
            configurable: true,
            value: true
        } )

        act( () => document.dispatchEvent( new Event( `visibilitychange` ) ) )

        await waitFor( () => {
            expect( add_clip_to_project ).toHaveBeenCalledWith( expect.objectContaining( {
                project_id: `project-1`,
                duration_ms: 1000
            } ) )
        } )
        expect( useAppStore.getState().recording_state ).toBe( `idle` )
        expect( recorder.ondataavailable ).toBe( null )
        expect( recorder.onerror ).toBe( null )
        expect( recorder.onstop ).toBe( null )
        expect( request_capture_stream ).toHaveBeenCalledTimes( 1 )
    } )

    test( `reopens preview after returning while a background stop is still saving`, async () => {
        const recording = make_stream()
        const preview = make_stream()
        const recorder = make_recorder()
        const saved_deferred = make_deferred()
        const date_values = [ 0, 1000 ]

        vi.spyOn( Date, `now` ).mockImplementation( () => date_values.shift() ?? 1000 )
        vi.mocked( request_capture_stream )
            .mockResolvedValueOnce( recording.stream )
            .mockResolvedValueOnce( preview.stream )
        vi.mocked( create_media_recorder ).mockReturnValue( recorder )
        clip_saved.mockReturnValue( saved_deferred.promise )

        render( <Harness /> )

        await act( async () => {
            controller.press_record()
            await Promise.resolve()
        } )

        await waitFor( () => {
            expect( recorder.start ).toHaveBeenCalledTimes( 1 )
        } )

        Object.defineProperty( document, `hidden`, {
            configurable: true,
            value: true
        } )

        act( () => document.dispatchEvent( new Event( `visibilitychange` ) ) )

        await waitFor( () => {
            expect( add_clip_to_project ).toHaveBeenCalledWith( expect.objectContaining( {
                project_id: `project-1`,
                duration_ms: 1000
            } ) )
        } )
        expect( useAppStore.getState().recording_state ).toBe( `saving` )

        Object.defineProperty( document, `hidden`, {
            configurable: true,
            value: false
        } )

        act( () => document.dispatchEvent( new Event( `visibilitychange` ) ) )

        expect( request_capture_stream ).toHaveBeenCalledTimes( 1 )

        await act( async () => {
            saved_deferred.resolve()
            await saved_deferred.promise
            await Promise.resolve()
        } )

        await waitFor( () => {
            expect( request_capture_stream ).toHaveBeenCalledTimes( 2 )
        } )
        await waitFor( () => {
            expect( controller.stream ).toBe( preview.stream )
        } )
        expect( useAppStore.getState().recording_state ).toBe( `idle` )
        expect( useAppStore.getState().media_stream_state ).toBe( `active` )
    } )

    test( `stops and saves a valid clip on page lifecycle backgrounding`, async () => {
        const { stream } = make_stream()
        const recorder = make_recorder()
        const date_values = [ 0, 1000 ]

        vi.spyOn( Date, `now` ).mockImplementation( () => date_values.shift() ?? 1000 )
        vi.mocked( request_capture_stream ).mockResolvedValue( stream )
        vi.mocked( create_media_recorder ).mockReturnValue( recorder )

        render( <Harness /> )

        await act( async () => {
            controller.press_record()
            await Promise.resolve()
        } )

        await waitFor( () => {
            expect( recorder.start ).toHaveBeenCalledTimes( 1 )
        } )

        act( () => window.dispatchEvent( new Event( `pagehide` ) ) )

        await waitFor( () => {
            expect( add_clip_to_project ).toHaveBeenCalledWith( expect.objectContaining( {
                project_id: `project-1`,
                duration_ms: 1000
            } ) )
        } )
        expect( useAppStore.getState().recording_state ).toBe( `idle` )
        expect( recorder.ondataavailable ).toBe( null )
        expect( recorder.onerror ).toBe( null )
        expect( recorder.onstop ).toBe( null )
        expect( request_capture_stream ).toHaveBeenCalledTimes( 1 )
    } )

    test( `stops and saves a valid clip after pointer cancellation during recording`, async () => {
        const { stream } = make_stream()
        const recorder = make_recorder()
        const date_values = [ 0, 1000 ]

        vi.spyOn( Date, `now` ).mockImplementation( () => date_values.shift() ?? 1000 )
        vi.mocked( request_capture_stream ).mockResolvedValue( stream )
        vi.mocked( create_media_recorder ).mockReturnValue( recorder )

        render( <Harness /> )

        await act( async () => {
            controller.press_record()
            await Promise.resolve()
        } )

        await waitFor( () => {
            expect( recorder.start ).toHaveBeenCalledTimes( 1 )
        } )

        act( () => controller.cancel_record() )

        await waitFor( () => {
            expect( add_clip_to_project ).toHaveBeenCalledWith( expect.objectContaining( {
                project_id: `project-1`,
                duration_ms: 1000
            } ) )
        } )
        expect( useAppStore.getState().recording_state ).toBe( `idle` )
    } )

    test( `stops media tracks before waiting for the saved clip to refresh the queue`, async () => {
        const refresh_deferred = make_deferred()
        const { stream, track } = make_stream()
        const recorder = make_recorder()
        const date_values = [ 0, 1000 ]

        clip_saved.mockReturnValue( refresh_deferred.promise )
        vi.spyOn( Date, `now` ).mockImplementation( () => date_values.shift() ?? 1000 )
        vi.mocked( request_capture_stream ).mockResolvedValue( stream )
        vi.mocked( create_media_recorder ).mockReturnValue( recorder )

        render( <Harness /> )

        await act( async () => {
            controller.press_record()
            await Promise.resolve()
        } )

        await waitFor( () => {
            expect( recorder.start ).toHaveBeenCalledTimes( 1 )
        } )

        act( () => controller.toggle_recording() )

        await waitFor( () => {
            expect( add_clip_to_project ).toHaveBeenCalledWith( expect.objectContaining( {
                project_id: `project-1`,
                duration_ms: 1000
            } ) )
        } )
        expect( track.stop ).toHaveBeenCalledTimes( 1 )
        expect( useAppStore.getState().recording_state ).toBe( `saving` )

        await act( async () => {
            refresh_deferred.resolve()
            await refresh_deferred.promise
        } )

        await waitFor( () => {
            expect( useAppStore.getState().recording_state ).toBe( `idle` )
        } )
    } )

    test( `saves available chunks and clears tracks when recorder stop never resolves`, async () => {
        const { stream, track } = make_stream()
        const recorder = make_recorder()
        const date_values = [ 0, 1000 ]
        let fake_timers_active = false

        try {
            vi.spyOn( Date, `now` ).mockImplementation( () => date_values.shift() ?? 1000 )
            recorder.mimeType = ``
            recorder.start = vi.fn( () => {
                recorder.state = `recording`
                recorder.ondataavailable?.( {
                    data: new Blob( [ `video` ], { type: `video/mp4` } )
                } )
            } )
            recorder.stop = vi.fn( () => {
                recorder.state = `inactive`
            } )
            vi.mocked( request_capture_stream ).mockResolvedValue( stream )
            vi.mocked( create_media_recorder ).mockReturnValue( recorder )

            render( <Harness /> )

            await act( async () => {
                controller.press_record()
                await Promise.resolve()
            } )

            await waitFor( () => {
                expect( recorder.start ).toHaveBeenCalledTimes( 1 )
            } )

            vi.useFakeTimers()
            fake_timers_active = true
            vi.setSystemTime( 1000 )

            act( () => controller.cancel_record() )

            await act( async () => {
                await vi.advanceTimersByTimeAsync( 3_000 )
            } )
            vi.useRealTimers()
            fake_timers_active = false

            await waitFor( () => {
                expect( add_clip_to_project ).toHaveBeenCalledWith( expect.objectContaining( {
                    project_id: `project-1`,
                    mime_type: `video/mp4`,
                    duration_ms: 1000
                } ) )
            } )
            expect( track.stop ).toHaveBeenCalledTimes( 1 )
            expect( useAppStore.getState().recording_state ).toBe( `idle` )
        } finally {
            if( fake_timers_active ) vi.useRealTimers()
        }
    } )

    test( `stops and saves a valid clip when the capture component unmounts`, async () => {
        const { stream } = make_stream()
        const recorder = make_recorder()
        const date_values = [ 0, 1000 ]

        vi.spyOn( Date, `now` ).mockImplementation( () => date_values.shift() ?? 1000 )
        vi.mocked( request_capture_stream ).mockResolvedValue( stream )
        vi.mocked( create_media_recorder ).mockReturnValue( recorder )

        const { unmount } = render( <Harness /> )

        await act( async () => {
            controller.press_record()
            await Promise.resolve()
        } )

        await waitFor( () => {
            expect( recorder.start ).toHaveBeenCalledTimes( 1 )
        } )

        unmount()

        await waitFor( () => {
            expect( add_clip_to_project ).toHaveBeenCalledWith( expect.objectContaining( {
                project_id: `project-1`,
                duration_ms: 1000
            } ) )
        } )
        expect( useAppStore.getState().recording_state ).toBe( `idle` )
    } )

    test( `discards clips below the minimum duration`, async () => {
        const { stream } = make_stream()
        const recorder = make_recorder()
        const date_values = [ 0, 250 ]

        vi.spyOn( Date, `now` ).mockImplementation( () => date_values.shift() ?? 250 )
        vi.mocked( request_capture_stream ).mockResolvedValue( stream )
        vi.mocked( create_media_recorder ).mockReturnValue( recorder )

        render( <Harness /> )

        await act( async () => {
            controller.press_record()
            await Promise.resolve()
        } )

        await waitFor( () => {
            expect( recorder.start ).toHaveBeenCalledTimes( 1 )
        } )

        act( () => controller.toggle_recording() )

        await waitFor( () => {
            expect( useAppStore.getState().recording_state ).toBe( `idle` )
        } )
        expect( add_clip_to_project ).not.toHaveBeenCalled()
        expect( update_clip_media_details ).not.toHaveBeenCalled()
    } )

    test( `stops and saves when the active media track ends`, async () => {
        const { stream, track } = make_stream()
        const recorder = make_recorder()
        const date_values = [ 0, 1000 ]

        vi.spyOn( Date, `now` ).mockImplementation( () => date_values.shift() ?? 1000 )
        vi.mocked( request_capture_stream ).mockResolvedValue( stream )
        vi.mocked( create_media_recorder ).mockReturnValue( recorder )

        render( <Harness /> )

        await act( async () => {
            controller.press_record()
            await Promise.resolve()
        } )

        await waitFor( () => {
            expect( recorder.start ).toHaveBeenCalledTimes( 1 )
        } )

        const [ , ended_listener ] = track.addEventListener.mock.calls.find( ( [ event_name ] ) => event_name === `ended` )

        await act( async () => {
            ended_listener()
            await Promise.resolve()
        } )

        await waitFor( () => {
            expect( add_clip_to_project ).toHaveBeenCalledWith( expect.objectContaining( {
                project_id: `project-1`,
                duration_ms: 1000
            } ) )
        } )
    } )

    test( `stops and saves a partial clip when the recorder reports an error`, async () => {
        const { stream } = make_stream()
        const recorder = make_recorder()
        const date_values = [ 0, 1000 ]

        recorder.error = new Error( `Encoder stopped` )
        vi.spyOn( Date, `now` ).mockImplementation( () => date_values.shift() ?? 1000 )
        vi.mocked( request_capture_stream ).mockResolvedValue( stream )
        vi.mocked( create_media_recorder ).mockReturnValue( recorder )

        render( <Harness /> )

        await act( async () => {
            controller.press_record()
            await Promise.resolve()
        } )

        await waitFor( () => {
            expect( recorder.start ).toHaveBeenCalledTimes( 1 )
        } )

        act( () => recorder.onerror() )

        await waitFor( () => {
            expect( add_clip_to_project ).toHaveBeenCalledWith( expect.objectContaining( {
                project_id: `project-1`,
                duration_ms: 1000
            } ) )
        } )
        expect( useAppStore.getState().recording_state ).toBe( `idle` )
    } )

    test( `recovers to idle and reports quota guidance when clip saving runs out of storage`, async () => {
        const { stream, track } = make_stream()
        const recorder = make_recorder()
        const date_values = [ 0, 1000 ]
        const quota_error = new DOMException( `Storage full`, `QuotaExceededError` )

        vi.spyOn( Date, `now` ).mockImplementation( () => date_values.shift() ?? 1000 )
        vi.mocked( add_clip_to_project ).mockRejectedValue( quota_error )
        vi.mocked( request_capture_stream ).mockResolvedValue( stream )
        vi.mocked( create_media_recorder ).mockReturnValue( recorder )

        render( <Harness /> )

        await act( async () => {
            controller.press_record()
            await Promise.resolve()
        } )

        await waitFor( () => {
            expect( recorder.start ).toHaveBeenCalledTimes( 1 )
        } )

        act( () => controller.toggle_recording() )

        await waitFor( () => {
            expect( useAppStore.getState().recording_state ).toBe( `idle` )
        } )
        expect( controller.error_message ).toMatch( /storage is full/ )
        expect( toast.error ).toHaveBeenCalledWith( `Storage is full` )
        expect( track.stop ).toHaveBeenCalledTimes( 1 )
        expect( clip_saved ).not.toHaveBeenCalled()
        expect( update_clip_media_details ).not.toHaveBeenCalled()
    } )

    test( `recovers to idle after a generic clip save failure`, async () => {
        const { stream, track } = make_stream()
        const recorder = make_recorder()
        const date_values = [ 0, 1000 ]

        vi.spyOn( Date, `now` ).mockImplementation( () => date_values.shift() ?? 1000 )
        vi.mocked( add_clip_to_project ).mockRejectedValue( new Error( `Write failed` ) )
        vi.mocked( request_capture_stream ).mockResolvedValue( stream )
        vi.mocked( create_media_recorder ).mockReturnValue( recorder )

        render( <Harness /> )

        await act( async () => {
            controller.press_record()
            await Promise.resolve()
        } )

        await waitFor( () => {
            expect( recorder.start ).toHaveBeenCalledTimes( 1 )
        } )

        act( () => controller.toggle_recording() )

        await waitFor( () => {
            expect( useAppStore.getState().recording_state ).toBe( `idle` )
        } )
        expect( controller.error_message ).toBe( `The clip could not be saved.` )
        expect( toast.error ).toHaveBeenCalledWith( `Clip save failed` )
        expect( track.stop ).toHaveBeenCalledTimes( 1 )
        expect( clip_saved ).not.toHaveBeenCalled()
        expect( update_clip_media_details ).not.toHaveBeenCalled()
    } )

    test( `adds the clip to the queue before thumbnail and metadata enrichment finishes`, async () => {
        const metadata_deferred = make_deferred()
        const { stream } = make_stream()
        const recorder = make_recorder()
        const date_values = [ 0, 1000 ]

        vi.spyOn( Date, `now` ).mockImplementation( () => date_values.shift() ?? 1000 )
        vi.mocked( get_video_metadata ).mockReturnValue( metadata_deferred.promise )
        vi.mocked( request_capture_stream ).mockResolvedValue( stream )
        vi.mocked( create_media_recorder ).mockReturnValue( recorder )

        render( <Harness /> )

        await act( async () => {
            controller.press_record()
            await Promise.resolve()
        } )

        act( () => controller.toggle_recording() )

        await waitFor( () => {
            expect( add_clip_to_project ).toHaveBeenCalledWith( expect.objectContaining( {
                project_id: `project-1`,
                duration_ms: 1000,
                thumbnail_blob: null
            } ) )
        } )
        expect( update_clip_media_details ).not.toHaveBeenCalled()

        await act( async () => {
            metadata_deferred.resolve( {
                duration_ms: 1200,
                width: 640,
                height: 360
            } )
            await metadata_deferred.promise
        } )

        await waitFor( () => {
            expect( update_clip_media_details ).toHaveBeenCalledWith( expect.objectContaining( {
                clip_id: `clip-1`,
                duration_ms: 1200,
                thumbnail_blob: expect.any( Blob )
            } ) )
        } )
    } )

    test( `surfaces a video-only notice when the stream has no audio track`, async () => {
        const { stream } = make_video_only_stream()
        const recorder = make_recorder()
        const empty_audio_stream = {
            getTracks: () => [],
            getAudioTracks: () => []
        }

        vi.mocked( request_audio_stream ).mockResolvedValue( empty_audio_stream )
        vi.mocked( request_capture_stream ).mockResolvedValue( stream )
        vi.mocked( create_media_recorder ).mockReturnValue( recorder )

        render( <Harness /> )

        await act( async () => {
            controller.press_record()
            await Promise.resolve()
        } )

        await waitFor( () => {
            expect( controller.error_message ).toMatch( /video only/ )
        } )
    } )

    test( `records a tap-to-start and tap-to-stop clip`, async () => {
        const stream_deferred = make_deferred()
        const { stream, track } = make_stream()
        const recorder = make_recorder()
        let performance_now = 0
        const date_values = [ 0, 1000 ]

        vi.spyOn( performance, `now` ).mockImplementation( () => performance_now )
        vi.spyOn( Date, `now` ).mockImplementation( () => date_values.shift() ?? 1000 )
        vi.mocked( request_capture_stream ).mockReturnValue( stream_deferred.promise )
        vi.mocked( create_media_recorder ).mockReturnValue( recorder )

        render( <Harness /> )

        act( () => {
            controller.press_record()
        } )

        performance_now = 100
        act( () => controller.release_record() )

        await act( async () => {
            stream_deferred.resolve( stream )
            await stream_deferred.promise
        } )

        await waitFor( () => {
            expect( recorder.start ).toHaveBeenCalledTimes( 1 )
        } )
        expect( recorder.stop ).not.toHaveBeenCalled()
        expect( useAppStore.getState().recording_state ).toBe( `recording` )

        performance_now = 300
        act( () => controller.press_record() )

        performance_now = 320
        act( () => controller.release_record() )

        await waitFor( () => {
            expect( add_clip_to_project ).toHaveBeenCalledWith( expect.objectContaining( {
                project_id: `project-1`,
                duration_ms: 1000
            } ) )
        } )
        expect( useAppStore.getState().recording_state ).toBe( `idle` )
        expect( track.stop ).toHaveBeenCalledTimes( 1 )
        expect( recorder.ondataavailable ).toBe( null )
        expect( recorder.onerror ).toBe( null )
        expect( recorder.onstop ).toBe( null )
    } )

    test( `stops on the next tap when startup loses the initial pointer release`, async () => {
        const stream_deferred = make_deferred()
        const { stream } = make_stream()
        const recorder = make_recorder()
        let performance_now = 0
        const date_values = [ 0, 1000 ]

        vi.spyOn( performance, `now` ).mockImplementation( () => performance_now )
        vi.spyOn( Date, `now` ).mockImplementation( () => date_values.shift() ?? 1000 )
        vi.mocked( request_capture_stream ).mockReturnValue( stream_deferred.promise )
        vi.mocked( create_media_recorder ).mockReturnValue( recorder )

        render( <Harness /> )

        act( () => {
            controller.press_record()
        } )

        await act( async () => {
            stream_deferred.resolve( stream )
            await stream_deferred.promise
        } )

        await waitFor( () => {
            expect( recorder.start ).toHaveBeenCalledTimes( 1 )
        } )
        expect( useAppStore.getState().recording_state ).toBe( `recording` )

        performance_now = 500
        act( () => controller.press_record() )

        performance_now = 520
        act( () => controller.release_record() )

        await waitFor( () => {
            expect( add_clip_to_project ).toHaveBeenCalledWith( expect.objectContaining( {
                project_id: `project-1`,
                duration_ms: 1000
            } ) )
        } )
        expect( useAppStore.getState().recording_state ).toBe( `idle` )
    } )

    test( `records a press-and-hold clip on release`, async () => {
        const { stream } = make_stream()
        const recorder = make_recorder()
        let performance_now = 0
        const date_values = [ 0, 1200 ]

        vi.spyOn( performance, `now` ).mockImplementation( () => performance_now )
        vi.spyOn( Date, `now` ).mockImplementation( () => date_values.shift() ?? 1200 )
        vi.mocked( request_capture_stream ).mockResolvedValue( stream )
        vi.mocked( create_media_recorder ).mockReturnValue( recorder )

        render( <Harness /> )

        await act( async () => {
            controller.press_record()
            await Promise.resolve()
        } )

        await waitFor( () => {
            expect( recorder.start ).toHaveBeenCalledTimes( 1 )
        } )

        performance_now = 350
        act( () => controller.release_record() )

        await waitFor( () => {
            expect( recorder.stop ).toHaveBeenCalledTimes( 1 )
        } )
        await waitFor( () => {
            expect( add_clip_to_project ).toHaveBeenCalledWith( expect.objectContaining( {
                project_id: `project-1`,
                duration_ms: 1200
            } ) )
        } )
        expect( useAppStore.getState().recording_state ).toBe( `idle` )
    } )
} )
