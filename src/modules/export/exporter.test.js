/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
    compile_project_export,
    get_export_support_message,
    get_supported_export_resolutions
} from './exporter.js'
import { get_clip_blob } from '../storage/journal_storage.js'

vi.mock( '../storage/journal_storage.js', () => ( {
    get_clip_blob: vi.fn()
} ) )

const stopped_tracks = []
const original_canvas_get_context = HTMLCanvasElement.prototype.getContext
const original_canvas_capture_stream = HTMLCanvasElement.prototype.captureStream

class FakeMediaStream {

    constructor( tracks = [] ) {
        this.tracks = tracks
    }

    getVideoTracks() {
        return this.tracks.filter( ( { kind } ) => kind === `video` )
    }

    getAudioTracks() {
        return this.tracks.filter( ( { kind } ) => kind === `audio` )
    }

    getTracks() {
        return this.tracks
    }

}

class FakeMediaRecorder {

    static isTypeSupported() {
        return true
    }

    constructor( stream, options = {} ) {
        this.stream = stream
        this.mimeType = options.mimeType ?? `video/webm`
        this.state = `inactive`
    }

    start() {
        this.state = `recording`
    }

    stop() {
        if( this.state === `inactive` ) return

        this.state = `inactive`
        this.onstop?.()
    }

}

const make_track = ( kind = `video` ) => ( {
    kind,
    stop: vi.fn( () => stopped_tracks.push( kind ) )
} )

const default_settings = {
    export_quality: `standard`,
    export_resolution: `source`,
    preferred_mime_type: null
}

describe( `export compiler`, () => {
    beforeEach( () => {
        stopped_tracks.length = 0
        vi.mocked( get_clip_blob ).mockReset()
        vi.stubGlobal( `MediaStream`, FakeMediaStream )
        vi.stubGlobal( `MediaRecorder`, FakeMediaRecorder )
        vi.stubGlobal( `requestAnimationFrame`, ( callback ) => setTimeout( callback, 0 ) )

        HTMLCanvasElement.prototype.getContext = vi.fn( () => ( {
            drawImage: vi.fn(),
            fillRect: vi.fn()
        } ) )
        HTMLCanvasElement.prototype.captureStream = vi.fn( () => new FakeMediaStream( [ make_track() ] ) )
    } )

    afterEach( () => {
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
        HTMLCanvasElement.prototype.getContext = original_canvas_get_context

        if( original_canvas_capture_stream ) HTMLCanvasElement.prototype.captureStream = original_canvas_capture_stream
        else delete HTMLCanvasElement.prototype.captureStream
    } )

    test( `fails rather than exporting an incomplete project when a clip blob is missing`, async () => {
        vi.mocked( get_clip_blob ).mockResolvedValue( null )

        await expect( compile_project_export( {
            clips: [
                {
                    id: `clip-1`,
                    duration_ms: 1000,
                    width: 640,
                    height: 360
                }
            ],
            settings: default_settings,
            signal: new AbortController().signal
        } ) ).rejects.toThrow( /missing from local storage/ )

        expect( stopped_tracks ).toContain( `video` )
    } )

    test( `stops export streams when recorder construction fails`, async () => {
        class ThrowingMediaRecorder {

            static isTypeSupported() {
                return true
            }

            constructor() {
                throw new Error( `No recorder` )
            }

        }

        vi.stubGlobal( `MediaRecorder`, ThrowingMediaRecorder )

        await expect( compile_project_export( {
            clips: [
                {
                    id: `clip-1`,
                    duration_ms: 1000,
                    width: 640,
                    height: 360
                }
            ],
            settings: default_settings,
            signal: new AbortController().signal
        } ) ).rejects.toThrow( /No recorder/ )

        expect( stopped_tracks ).toContain( `video` )
    } )

    test( `stops before allocating export streams when already cancelled`, async () => {
        const abort_controller = new AbortController()
        abort_controller.abort()

        await expect( compile_project_export( {
            clips: [
                {
                    id: `clip-1`,
                    duration_ms: 1000,
                    width: 640,
                    height: 360
                }
            ],
            settings: default_settings,
            signal: abort_controller.signal
        } ) ).rejects.toMatchObject( { name: `AbortError` } )

        expect( HTMLCanvasElement.prototype.captureStream ).not.toHaveBeenCalled()
    } )

    test( `hides resolution settings when canvas capture cannot be proved`, () => {
        delete HTMLCanvasElement.prototype.captureStream

        expect( get_supported_export_resolutions() ).toEqual( [] )
        expect( get_export_support_message() ).toMatch( /capture a video export/ )
    } )

    test( `fails clearly before export when canvas capture is unsupported`, async () => {
        delete HTMLCanvasElement.prototype.captureStream

        await expect( compile_project_export( {
            clips: [
                {
                    id: `clip-1`,
                    duration_ms: 1000,
                    width: 640,
                    height: 360
                }
            ],
            settings: default_settings,
            signal: new AbortController().signal
        } ) ).rejects.toThrow( /capture a video export/ )
    } )
} )
