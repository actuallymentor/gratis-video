import { afterEach, describe, expect, test, vi } from 'vitest'
import {
    HOLD_THRESHOLD_MS,
    classify_recording_gesture,
    get_capture_error_message,
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

    test( `classifies short presses as taps and longer presses as holds`, () => {
        expect( classify_recording_gesture( HOLD_THRESHOLD_MS - 1 ) ).toBe( `tap` )
        expect( classify_recording_gesture( HOLD_THRESHOLD_MS ) ).toBe( `hold` )
    } )

    test( `maps expected capture startup failures to user-facing messages`, () => {
        expect( get_capture_error_message( new DOMException( `Permission denied`, `NotAllowedError` ) ) ).toMatch( /blocked/ )
        expect( get_capture_error_message( new DOMException( `No device`, `NotFoundError` ) ) ).toMatch( /No camera or microphone/ )
        expect( get_capture_error_message( new DOMException( `Not supported`, `NotSupportedError` ) ) ).toMatch( /cannot start/ )
    } )
} )
