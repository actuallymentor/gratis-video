/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
    calculate_export_canvas_size,
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

class DataMediaRecorder extends FakeMediaRecorder {

    stop() {
        if( this.state === `inactive` ) return

        this.state = `inactive`
        this.ondataavailable?.( {
            data: new Blob( [ `export` ], { type: this.mimeType } )
        } )
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

class FakeVideoElement extends EventTarget {

    constructor() {
        super()
        this.videoWidth = 640
        this.videoHeight = 360
        this.duration = 1
        this.currentTime = 0
        this.ended = false
    }

    set src( value ) {
        this.src_value = value
        setTimeout( () => this.dispatchEvent( new Event( `loadedmetadata` ) ), 0 )
    }

    get src() {
        return this.src_value
    }

    play() {
        this.ended = true
        return Promise.resolve()
    }

    pause() {}

    removeAttribute() {}

    load() {}

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

    test( `fails instead of caching an empty export file`, async () => {
        const create_element = document.createElement.bind( document )

        vi.mocked( get_clip_blob ).mockResolvedValue( new Blob( [ `clip` ], { type: `video/webm` } ) )
        vi.spyOn( URL, `createObjectURL` ).mockReturnValue( `blob:clip` )
        vi.spyOn( URL, `revokeObjectURL` ).mockImplementation( () => {} )
        vi.spyOn( document, `createElement` ).mockImplementation( ( tag_name, options ) => {
            if( tag_name === `video` ) return new FakeVideoElement()
            return create_element( tag_name, options )
        } )

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
        } ) ).rejects.toThrow( /did not produce a video file/ )

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

    test( `loads clip blobs in queue order while compiling export`, async () => {
        const create_element = document.createElement.bind( document )

        vi.stubGlobal( `MediaRecorder`, DataMediaRecorder )
        vi.mocked( get_clip_blob ).mockResolvedValue( new Blob( [ `clip` ], { type: `video/webm` } ) )
        vi.spyOn( URL, `createObjectURL` ).mockReturnValue( `blob:clip` )
        vi.spyOn( URL, `revokeObjectURL` ).mockImplementation( () => {} )
        vi.spyOn( document, `createElement` ).mockImplementation( ( tag_name, options ) => {
            if( tag_name === `video` ) return new FakeVideoElement()
            return create_element( tag_name, options )
        } )

        const export_result = await compile_project_export( {
            clips: [
                {
                    id: `clip-1`,
                    duration_ms: 1000,
                    width: 640,
                    height: 360
                },
                {
                    id: `clip-2`,
                    duration_ms: 900,
                    width: 640,
                    height: 360
                }
            ],
            settings: default_settings,
            signal: new AbortController().signal
        } )

        expect( export_result.duration_ms ).toBe( 1900 )
        expect( export_result.blob.size ).toBeGreaterThan( 0 )
        expect( get_clip_blob.mock.calls.map( ( [ clip_id ] ) => clip_id ) ).toEqual( [
            `clip-1`,
            `clip-2`
        ] )
    } )

    test( `keeps landscape export resolution within the selected size`, () => {
        expect( calculate_export_canvas_size( [
            {
                width: 1920,
                height: 1080
            }
        ], {
            export_resolution: `720p`
        } ) ).toEqual( {
            width: 1280,
            height: 720
        } )
    } )

    test( `keeps portrait export resolution portrait within the selected size`, () => {
        expect( calculate_export_canvas_size( [
            {
                width: 1080,
                height: 1920
            }
        ], {
            export_resolution: `720p`
        } ) ).toEqual( {
            width: 720,
            height: 1280
        } )
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
