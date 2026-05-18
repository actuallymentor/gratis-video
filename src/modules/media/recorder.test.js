import { afterEach, describe, expect, test, vi } from 'vitest'
import {
    HOLD_THRESHOLD_MS,
    classify_recording_gesture,
    create_media_recorder,
    get_capture_error_message,
    request_capture_stream,
    select_supported_mime_type
} from './recorder.js'

describe( `recorder helpers`, () => {
    afterEach( () => {
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

    test( `maps expected capture startup failures to user-facing messages`, () => {
        expect( get_capture_error_message( new DOMException( `Permission denied`, `NotAllowedError` ) ) ).toMatch( /blocked/ )
        expect( get_capture_error_message( new DOMException( `No device`, `NotFoundError` ) ) ).toMatch( /No camera or microphone/ )
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
        expect( getUserMedia ).toHaveBeenCalledTimes( 2 )
        expect( getUserMedia.mock.calls[ 0 ][ 0 ] ).toMatchObject( {
            audio: {
                echoCancellation: true,
                noiseSuppression: true
            }
        } )
        expect( getUserMedia.mock.calls[ 1 ][ 0 ] ).toMatchObject( {
            audio: false
        } )
    } )
} )
