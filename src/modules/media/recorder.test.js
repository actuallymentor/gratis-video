/* @vitest-environment jsdom */

import { afterEach, describe, expect, test, vi } from 'vitest'
import {
    CAPTURE_WARNING_KEY,
    HOLD_THRESHOLD_MS,
    classify_recording_gesture,
    create_media_recorder,
    generate_video_thumbnail,
    get_capture_error_message,
    get_video_metadata,
    pulse_haptic,
    request_capture_stream,
    select_supported_mime_type
} from './recorder.js'

const expect_unsized_video_constraints = ( constraints ) => {
    expect( constraints.video ).toEqual( {
        facingMode: { ideal: `environment` },
        resizeMode: { ideal: `none` }
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

    test( `asks the opened camera track for its full native resolution`, async () => {
        const applyConstraints = vi.fn().mockResolvedValue()
        const track = {
            applyConstraints,
            getCapabilities: () => ( {
                width: { max: 4032 },
                height: { max: 3024 },
                resizeMode: [ `none`, `crop-and-scale` ],
                zoom: { min: 1 }
            } )
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
            width: { ideal: 4032 },
            height: { ideal: 3024 }
        } )
        expect( applyConstraints.mock.calls[ 0 ][ 0 ] ).not.toHaveProperty( `aspectRatio` )
    } )

    test( `keeps recording available when full resolution refinement is rejected`, async () => {
        const applyConstraints = vi.fn().mockRejectedValue( new Error( `Unsupported mode` ) )
        const track = {
            applyConstraints,
            getCapabilities: () => ( {
                width: { max: 4032 },
                height: { max: 3024 },
                resizeMode: [ `none`, `crop-and-scale` ]
            } )
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
