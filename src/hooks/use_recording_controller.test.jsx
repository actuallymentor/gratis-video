/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { useRecordingController } from './use_recording_controller.js'
import { useAppStore } from '../stores/app_store.js'
import { check_media_permissions } from '../modules/permissions/permissions.js'
import {
    add_clip_to_project,
    estimate_storage,
    persisted_storage
} from '../modules/storage/journal_storage.js'
import {
    create_media_recorder,
    request_capture_stream
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
    persisted_storage: vi.fn()
} ) )

vi.mock( '../modules/permissions/permissions.js', () => ( {
    check_media_permissions: vi.fn()
} ) )

vi.mock( '../modules/media/recorder.js', () => ( {
    HOLD_THRESHOLD_MS: 250,
    MINIMUM_CLIP_MS: 400,
    classify_recording_gesture: ( duration_ms, threshold_ms = 250 ) => duration_ms < threshold_ms ? `tap` : `hold`,
    create_media_recorder: vi.fn(),
    generate_video_thumbnail: vi.fn().mockResolvedValue( new Blob( [ `thumb` ], { type: `image/jpeg` } ) ),
    get_capture_error_message: vi.fn( ( error ) => error.message ),
    get_video_metadata: vi.fn().mockResolvedValue( {
        duration_ms: 1000,
        width: 640,
        height: 360
    } ),
    play_sound_feedback: vi.fn(),
    pulse_haptic: vi.fn(),
    request_capture_stream: vi.fn(),
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

const make_stream = () => {
    const track = {
        addEventListener: vi.fn(),
        stop: vi.fn()
    }

    return {
        track,
        stream: {
            getTracks: () => [ track ]
        }
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

function Harness() {
    controller = useRecordingController( {
        project_id: `project-1`,
        settings: {
            haptics_enabled: false,
            sounds_enabled: false
        },
        on_clip_saved: vi.fn()
    } )

    return <span>{ controller.recording_state }</span>
}

describe( `recording controller`, () => {
    beforeEach( () => {
        useAppStore.setState( {
            media_stream_state: `idle`,
            recording_state: `idle`
        } )
        vi.mocked( add_clip_to_project ).mockReset()
        vi.mocked( check_media_permissions ).mockReset()
        vi.mocked( create_media_recorder ).mockReset()
        vi.mocked( estimate_storage ).mockReset()
        vi.mocked( persisted_storage ).mockReset()
        vi.mocked( request_capture_stream ).mockReset()
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
        vi.mocked( persisted_storage ).mockResolvedValue( true )
    } )

    afterEach( () => {
        cleanup()
        vi.restoreAllMocks()
        vi.clearAllMocks()
        useAppStore.setState( { recording_state: `idle` } )
        controller = null
    } )

    test( `stops and saves when startup is cancelled before getUserMedia resolves`, async () => {
        const stream_deferred = make_deferred()
        const { stream } = make_stream()
        const recorder = make_recorder()
        const now_values = [ 0, 1000 ]

        vi.spyOn( Date, `now` ).mockImplementation( () => now_values.shift() ?? 1000 )
        vi.mocked( request_capture_stream ).mockReturnValue( stream_deferred.promise )
        vi.mocked( create_media_recorder ).mockReturnValue( recorder )

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
            expect( recorder.stop ).toHaveBeenCalledTimes( 1 )
        } )
        await waitFor( () => {
            expect( add_clip_to_project ).toHaveBeenCalledWith( expect.objectContaining( {
                project_id: `project-1`,
                mime_type: `video/webm`,
                duration_ms: 1000
            } ) )
        } )
        expect( useAppStore.getState().recording_state ).toBe( `idle` )
    } )

    test( `stops opened media tracks when recorder setup fails`, async () => {
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
        expect( useAppStore.getState().media_stream_state ).toBe( `idle` )
        expect( useAppStore.getState().recording_state ).toBe( `idle` )
    } )
} )
