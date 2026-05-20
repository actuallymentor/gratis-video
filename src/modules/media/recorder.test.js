/* @vitest-environment jsdom */

import { afterEach, describe, expect, test, vi } from 'vitest'
import {
    CAPTURE_WARNING_KEY,
    DEFAULT_RECORDING_VIDEO_PRESET,
    HOLD_THRESHOLD_MS,
    classify_recording_gesture,
    create_media_recorder,
    generate_video_thumbnail,
    get_capture_error_message,
    get_recording_video_preset,
    get_video_metadata,
    list_video_input_devices,
    pulse_haptic,
    request_audio_stream,
    request_capture_stream,
    select_supported_mime_type
} from './recorder.js'

const expect_unsized_video_constraints = ( constraints, {
    frame_rate = 30,
    video_device_id = null
} = {} ) => {
    const device_constraint = video_device_id
        ? { deviceId: { exact: video_device_id } }
        : {}
    const frame_rate_constraint = frame_rate
        ? { frameRate: { ideal: frame_rate } }
        : {}

    expect( constraints.video ).toEqual( {
        facingMode: { ideal: `environment` },
        resizeMode: { ideal: `none` },
        ...frame_rate_constraint,
        ...device_constraint
    } )
    expect( constraints.video ).not.toHaveProperty( `width` )
    expect( constraints.video ).not.toHaveProperty( `height` )
    expect( constraints.video ).not.toHaveProperty( `aspectRatio` )
}

describe( `recorder helpers`, () => {
    afterEach( () => {
        vi.useRealTimers()
        vi.restoreAllMocks()
        vi.unstubAllGlobals()
    } )

    test( `selects the first supported MIME type`, () => {
        vi.stubGlobal( `MediaRecorder`, {
            isTypeSupported: ( mime_type ) => mime_type === `video/webm;codecs=vp8,opus`
        } )

        expect( select_supported_mime_type( [
            `video/mp4`,
            `video/webm;codecs=vp8,opus`,
            `video/webm`
        ] ) ).toBe( `video/webm;codecs=vp8,opus` )
    } )

    test( `falls back to browser default when support probing is unavailable`, () => {
        vi.stubGlobal( `MediaRecorder`, {} )

        expect( select_supported_mime_type( [ `video/mp4` ] ) ).toBe( null )
    } )

    test( `falls back to the default recording video preset for stale values`, () => {
        expect( get_recording_video_preset( `missing` ).value ).toBe( DEFAULT_RECORDING_VIDEO_PRESET )
    } )

    test( `falls back to the default recorder constructor when a supported MIME option fails`, () => {
        const constructor_calls = []
        const stream = {}

        class FallbackMediaRecorder {

            static isTypeSupported() {
                return true
            }

            constructor( next_stream, options ) {
                constructor_calls.push( options )
                if( options?.mimeType ) throw new Error( `Typed construction failed` )

                this.stream = next_stream
                this.mimeType = `video/webm`
            }

        }

        vi.stubGlobal( `MediaRecorder`, FallbackMediaRecorder )

        expect( create_media_recorder( stream ).stream ).toBe( stream )
        expect( constructor_calls ).toEqual( [
            { mimeType: `video/mp4;codecs=avc1.42E01E,mp4a.40.2` },
            undefined
        ] )
    } )

    test( `passes recording bitrate to the recorder constructor`, () => {
        const constructor_calls = []
        const stream = {}

        class BitrateMediaRecorder {

            constructor( next_stream, options ) {
                constructor_calls.push( options )
                this.stream = next_stream
                this.mimeType = options?.mimeType ?? `video/webm`
            }

        }

        vi.stubGlobal( `MediaRecorder`, BitrateMediaRecorder )

        expect( create_media_recorder( stream, {
            mime_type: null,
            video_bits_per_second: 8_000_000
        } ).stream ).toBe( stream )
        expect( constructor_calls ).toEqual( [
            { videoBitsPerSecond: 8_000_000 }
        ] )
    } )

    test( `classifies short presses as taps and longer presses as holds`, () => {
        expect( classify_recording_gesture( HOLD_THRESHOLD_MS - 1 ) ).toBe( `tap` )
        expect( classify_recording_gesture( HOLD_THRESHOLD_MS ) ).toBe( `hold` )
    } )

    test( `ignores unavailable haptic feedback failures`, () => {
        vi.stubGlobal( `navigator`, {
            vibrate: vi.fn( () => {
                throw new Error( `Vibration blocked` )
            } )
        } )

        expect( () => pulse_haptic( true ) ).not.toThrow()
        expect( navigator.vibrate ).toHaveBeenCalledWith( 24 )
    } )

    test( `maps expected capture startup failures to user-facing messages`, () => {
        expect( get_capture_error_message( new DOMException( `Permission denied`, `NotAllowedError` ) ) ).toMatch( /blocked/ )
        expect( get_capture_error_message( new DOMException( `No device`, `NotFoundError` ) ) ).toMatch( /No camera was found/ )
        expect( get_capture_error_message( new DOMException( `Not supported`, `NotSupportedError` ) ) ).toMatch( /cannot start/ )
    } )

    test( `maps offline capture failures to offline guidance`, () => {
        vi.stubGlobal( `navigator`, { onLine: false } )

        expect( get_capture_error_message( new Error( `Offline media failed` ) ) ).toMatch( /available offline/ )
    } )

    test( `retries capture as video-only when microphone capture fails`, async () => {
        const video_only_stream = { getTracks: () => [] }
        const getUserMedia = vi.fn()
            .mockRejectedValueOnce( new DOMException( `No microphone`, `NotFoundError` ) )
            .mockResolvedValueOnce( video_only_stream )

        vi.stubGlobal( `isSecureContext`, true )
        vi.stubGlobal( `navigator`, {
            mediaDevices: { getUserMedia }
        } )

        await expect( request_capture_stream() ).resolves.toBe( video_only_stream )
        expect( video_only_stream[ CAPTURE_WARNING_KEY ] ).toBe( `microphone_unavailable` )
        expect( getUserMedia ).toHaveBeenCalledTimes( 2 )
        expect( getUserMedia.mock.calls[ 0 ][ 0 ] ).toMatchObject( {
            audio: {
                echoCancellation: true,
                noiseSuppression: true
            }
        } )
        expect_unsized_video_constraints( getUserMedia.mock.calls[ 0 ][ 0 ] )
        expect( getUserMedia.mock.calls[ 1 ][ 0 ] ).toMatchObject( {
            audio: false
        } )
        expect_unsized_video_constraints( getUserMedia.mock.calls[ 1 ][ 0 ] )
    } )

    test( `requests video-only capture immediately when microphone is known denied`, async () => {
        const video_only_stream = { getTracks: () => [] }
        const getUserMedia = vi.fn().mockResolvedValue( video_only_stream )

        vi.stubGlobal( `isSecureContext`, true )
        vi.stubGlobal( `navigator`, {
            mediaDevices: { getUserMedia }
        } )

        await expect( request_capture_stream( { audio_enabled: false } ) ).resolves.toBe( video_only_stream )
        expect( getUserMedia ).toHaveBeenCalledTimes( 1 )
        expect( getUserMedia ).toHaveBeenCalledWith( expect.objectContaining( {
            audio: false
        } ) )
        expect_unsized_video_constraints( getUserMedia.mock.calls[ 0 ][ 0 ] )
    } )

    test( `requests only microphone audio when adding audio to an existing preview`, async () => {
        const audio_stream = { getTracks: () => [] }
        const getUserMedia = vi.fn().mockResolvedValue( audio_stream )

        vi.stubGlobal( `isSecureContext`, true )
        vi.stubGlobal( `navigator`, {
            mediaDevices: { getUserMedia }
        } )

        await expect( request_audio_stream() ).resolves.toBe( audio_stream )
        expect( getUserMedia ).toHaveBeenCalledWith( {
            video: false,
            audio: {
                echoCancellation: true,
                noiseSuppression: true
            }
        } )
    } )

    test( `lists available camera input devices`, async () => {
        vi.stubGlobal( `navigator`, {
            mediaDevices: {
                enumerateDevices: vi.fn().mockResolvedValue( [
                    {
                        deviceId: `camera-1`,
                        groupId: `rear`,
                        kind: `videoinput`,
                        label: `Back Camera`
                    },
                    {
                        deviceId: `microphone-1`,
                        kind: `audioinput`,
                        label: `Microphone`
                    },
                    {
                        deviceId: `camera-2`,
                        groupId: `rear`,
                        kind: `videoinput`,
                        label: ``
                    }
                ] )
            }
        } )

        await expect( list_video_input_devices() ).resolves.toEqual( [
            {
                device_id: `camera-1`,
                group_id: `rear`,
                label: `Back Camera`
            },
            {
                device_id: `camera-2`,
                group_id: `rear`,
                label: `Camera 2`
            }
        ] )
    } )

    test( `pins capture to a known camera device id`, async () => {
        const stream = { getTracks: () => [] }
        const getUserMedia = vi.fn().mockResolvedValue( stream )

        vi.stubGlobal( `isSecureContext`, true )
        vi.stubGlobal( `navigator`, {
            mediaDevices: { getUserMedia }
        } )

        await expect( request_capture_stream( {
            audio_enabled: true,
            video_device_id: `rear-normal-camera`
        } ) ).resolves.toBe( stream )
        expect_unsized_video_constraints( getUserMedia.mock.calls[ 0 ][ 0 ], {
            video_device_id: `rear-normal-camera`
        } )
    } )

    test( `keeps the pinned camera device id for video-only microphone retry`, async () => {
        const video_only_stream = { getTracks: () => [] }
        const getUserMedia = vi.fn()
            .mockRejectedValueOnce( new DOMException( `No microphone`, `NotFoundError` ) )
            .mockResolvedValueOnce( video_only_stream )

        vi.stubGlobal( `isSecureContext`, true )
        vi.stubGlobal( `navigator`, {
            mediaDevices: { getUserMedia }
        } )

        await expect( request_capture_stream( {
            video_device_id: `rear-normal-camera`
        } ) ).resolves.toBe( video_only_stream )
        expect_unsized_video_constraints( getUserMedia.mock.calls[ 0 ][ 0 ], {
            video_device_id: `rear-normal-camera`
        } )
        expect_unsized_video_constraints( getUserMedia.mock.calls[ 1 ][ 0 ], {
            video_device_id: `rear-normal-camera`
        } )
        expect( getUserMedia.mock.calls[ 1 ][ 0 ] ).toMatchObject( {
            audio: false
        } )
    } )

    test( `applies the default 1080p30 preset to the opened camera track while keeping portrait shape`, async () => {
        const applyConstraints = vi.fn().mockResolvedValue()
        const track = {
            applyConstraints,
            getCapabilities: () => ( {
                width: { max: 4032 },
                height: { max: 4032 },
                resizeMode: [ `none`, `crop-and-scale` ],
                zoom: { min: 1 }
            } ),
            getSettings: () => ( { width: 720, height: 1280 } )
        }
        const stream = {
            getTracks: () => [ track ],
            getVideoTracks: () => [ track ]
        }
        const getUserMedia = vi.fn().mockResolvedValue( stream )

        vi.stubGlobal( `isSecureContext`, true )
        vi.stubGlobal( `navigator`, {
            mediaDevices: { getUserMedia }
        } )

        await expect( request_capture_stream( { audio_enabled: false } ) ).resolves.toBe( stream )
        expect_unsized_video_constraints( getUserMedia.mock.calls[ 0 ][ 0 ] )
        expect( applyConstraints ).toHaveBeenCalledWith( {
            resizeMode: { exact: `none` },
            width: { ideal: 1080 },
            height: { ideal: 1920 },
            frameRate: { ideal: 30 }
        } )
        expect( applyConstraints.mock.calls[ 0 ][ 0 ] ).not.toHaveProperty( `aspectRatio` )
    } )

    test( `keeps the portrait shape of the live track when applying a preset`, async () => {
        const applyConstraints = vi.fn().mockResolvedValue()
        const track = {
            applyConstraints,
            getCapabilities: () => ( {
                width: { max: 4032 },
                height: { max: 3024 },
                resizeMode: [ `none`, `crop-and-scale` ]
            } ),
            getSettings: () => ( { width: 720, height: 1280 } )
        }
        const stream = {
            getTracks: () => [ track ],
            getVideoTracks: () => [ track ]
        }
        const getUserMedia = vi.fn().mockResolvedValue( stream )

        vi.stubGlobal( `isSecureContext`, true )
        vi.stubGlobal( `navigator`, {
            mediaDevices: { getUserMedia }
        } )

        await expect( request_capture_stream( { audio_enabled: false } ) ).resolves.toBe( stream )
        expect( applyConstraints ).toHaveBeenCalledWith( {
            resizeMode: { exact: `none` },
            width: { ideal: 1080 },
            height: { ideal: 1920 },
            frameRate: { ideal: 30 }
        } )
    } )

    test( `keeps the landscape shape of the live track when applying a preset`, async () => {
        const applyConstraints = vi.fn().mockResolvedValue()
        const track = {
            applyConstraints,
            getCapabilities: () => ( {
                width: { max: 4032 },
                height: { max: 3024 },
                resizeMode: [ `none`, `crop-and-scale` ]
            } ),
            getSettings: () => ( { width: 1280, height: 720 } )
        }
        const stream = {
            getTracks: () => [ track ],
            getVideoTracks: () => [ track ]
        }
        const getUserMedia = vi.fn().mockResolvedValue( stream )

        vi.stubGlobal( `isSecureContext`, true )
        vi.stubGlobal( `navigator`, {
            mediaDevices: { getUserMedia }
        } )

        await expect( request_capture_stream( { audio_enabled: false } ) ).resolves.toBe( stream )
        expect( applyConstraints ).toHaveBeenCalledWith( {
            resizeMode: { exact: `none` },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 30 }
        } )
    } )

    test( `uses landscape preset dimensions when the opened track does not report dimensions yet`, async () => {
        const applyConstraints = vi.fn().mockResolvedValue()
        const track = {
            applyConstraints,
            getCapabilities: () => ( {
                width: { max: 4032 },
                height: { max: 3024 },
                resizeMode: [ `none`, `crop-and-scale` ]
            } ),
            getSettings: () => ( {} )
        }
        const stream = {
            getTracks: () => [ track ],
            getVideoTracks: () => [ track ]
        }
        const getUserMedia = vi.fn().mockResolvedValue( stream )

        vi.stubGlobal( `isSecureContext`, true )
        vi.stubGlobal( `navigator`, {
            mediaDevices: { getUserMedia }
        } )

        await expect( request_capture_stream( { audio_enabled: false } ) ).resolves.toBe( stream )
        expect( applyConstraints ).toHaveBeenCalledWith( {
            resizeMode: { exact: `none` },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 30 }
        } )
    } )

    test( `keeps recording available when preset refinement is rejected`, async () => {
        const applyConstraints = vi.fn().mockRejectedValue( new Error( `Unsupported mode` ) )
        const track = {
            applyConstraints,
            getCapabilities: () => ( {
                width: { max: 4032 },
                height: { max: 3024 },
                resizeMode: [ `none`, `crop-and-scale` ]
            } ),
            getSettings: () => ( { width: 720, height: 1280 } )
        }
        const stream = {
            getTracks: () => [ track ],
            getVideoTracks: () => [ track ]
        }
        const getUserMedia = vi.fn().mockResolvedValue( stream )

        vi.stubGlobal( `isSecureContext`, true )
        vi.stubGlobal( `navigator`, {
            mediaDevices: { getUserMedia }
        } )

        await expect( request_capture_stream( { audio_enabled: false } ) ).resolves.toBe( stream )
        expect( applyConstraints ).toHaveBeenCalledTimes( 3 )
    } )

    test( `uses the selected recording preset frame rate on first camera open`, async () => {
        const stream = { getTracks: () => [] }
        const getUserMedia = vi.fn().mockResolvedValue( stream )

        vi.stubGlobal( `isSecureContext`, true )
        vi.stubGlobal( `navigator`, {
            mediaDevices: { getUserMedia }
        } )

        await expect( request_capture_stream( {
            audio_enabled: false,
            recording_video_preset: `1080p60`
        } ) ).resolves.toBe( stream )
        expect_unsized_video_constraints( getUserMedia.mock.calls[ 0 ][ 0 ], {
            frame_rate: 60
        } )
    } )

    test( `marks microphone denial when video-only retry succeeds`, async () => {
        const video_only_stream = { getTracks: () => [] }
        const getUserMedia = vi.fn()
            .mockRejectedValueOnce( new DOMException( `Denied`, `NotAllowedError` ) )
            .mockResolvedValueOnce( video_only_stream )

        vi.stubGlobal( `isSecureContext`, true )
        vi.stubGlobal( `navigator`, {
            mediaDevices: { getUserMedia }
        } )

        await expect( request_capture_stream() ).resolves.toBe( video_only_stream )
        expect( video_only_stream[ CAPTURE_WARNING_KEY ] ).toBe( `microphone_denied` )
    } )

    test( `reports camera denial when video-only retry is also blocked`, async () => {
        const getUserMedia = vi.fn()
            .mockRejectedValueOnce( new DOMException( `Denied`, `NotAllowedError` ) )
            .mockRejectedValueOnce( new DOMException( `Still denied`, `NotAllowedError` ) )

        vi.stubGlobal( `isSecureContext`, true )
        vi.stubGlobal( `navigator`, {
            mediaDevices: { getUserMedia }
        } )

        await expect( request_capture_stream() ).rejects.toThrow( /Camera access is blocked/ )
    } )

    test( `returns no thumbnail when video seeking does not complete`, async () => {
        vi.useFakeTimers()

        const original_create_element = document.createElement.bind( document )
        const video = {
            duration: 1,
            videoWidth: 640,
            videoHeight: 360,
            load: vi.fn(),
            removeAttribute: vi.fn()
        }

        vi.spyOn( document, `createElement` ).mockImplementation( ( tag_name ) => {
            if( tag_name === `video` ) return video
            return original_create_element( tag_name )
        } )
        vi.spyOn( URL, `createObjectURL` ).mockReturnValue( `blob:clip` )
        vi.spyOn( URL, `revokeObjectURL` ).mockImplementation( () => {} )

        const thumbnail_promise = generate_video_thumbnail( new Blob( [ `clip` ], { type: `video/webm` } ) )

        video.onloadedmetadata()
        await vi.advanceTimersByTimeAsync( 3_000 )

        await expect( thumbnail_promise ).resolves.toBe( null )
        expect( URL.revokeObjectURL ).toHaveBeenCalledWith( `blob:clip` )
    } )

    test( `releases metadata object URLs after reading clip dimensions`, async () => {
        const original_create_element = document.createElement.bind( document )
        const video = {
            duration: 1.2,
            videoWidth: 640,
            videoHeight: 360,
            load: vi.fn(),
            removeAttribute: vi.fn()
        }

        vi.spyOn( document, `createElement` ).mockImplementation( ( tag_name ) => {
            if( tag_name === `video` ) return video
            return original_create_element( tag_name )
        } )
        vi.spyOn( URL, `createObjectURL` ).mockReturnValue( `blob:metadata` )
        vi.spyOn( URL, `revokeObjectURL` ).mockImplementation( () => {} )

        const metadata_promise = get_video_metadata( new Blob( [ `clip` ], { type: `video/webm` } ) )

        video.onloadedmetadata()

        await expect( metadata_promise ).resolves.toEqual( {
            duration_ms: 1200,
            width: 640,
            height: 360
        } )
        expect( video.removeAttribute ).toHaveBeenCalledWith( `src` )
        expect( video.load ).toHaveBeenCalled()
        expect( URL.revokeObjectURL ).toHaveBeenCalledWith( `blob:metadata` )
    } )
} )
