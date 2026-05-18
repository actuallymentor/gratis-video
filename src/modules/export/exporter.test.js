/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
    calculate_export_canvas_size,
    compile_project_export,
    get_export_support_message,
    normalize_export_settings,
    get_supported_export_mime_types,
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

    test( `fails clearly when a clip never becomes readable`, async () => {
        const create_element = document.createElement.bind( document )

        class StalledVideoElement extends FakeVideoElement {

            set src( value ) {
                this.src_value = value
            }

        }

        try {
            vi.useFakeTimers()
            vi.mocked( get_clip_blob ).mockResolvedValue( new Blob( [ `clip` ], { type: `video/webm` } ) )
            vi.spyOn( URL, `createObjectURL` ).mockReturnValue( `blob:clip` )
            vi.spyOn( URL, `revokeObjectURL` ).mockImplementation( () => {} )
            vi.spyOn( document, `createElement` ).mockImplementation( ( tag_name, options ) => {
                if( tag_name === `video` ) return new StalledVideoElement()
                return create_element( tag_name, options )
            } )

            const export_promise = compile_project_export( {
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
            } )
            const stalled_export = expect( export_promise ).rejects.toThrow( /stalled/ )

            await Promise.resolve()
            await vi.advanceTimersByTimeAsync( 8_000 )

            await stalled_export
            expect( stopped_tracks ).toContain( `video` )
        } finally {
            vi.useRealTimers()
        }
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

    test( `recovers a later clip that stalls until muted playback is retried`, async () => {
        const create_element = document.createElement.bind( document )
        let video_count = 0
        let muted_retry_count = 0

        class MutedRecoveryVideoElement extends FakeVideoElement {

            constructor() {
                super()
                video_count += 1
                this.video_index = video_count
                this.current_time = 0
                this.paused = true
                this.playing = false
                this.readyState = 4
            }

            get currentTime() {
                if( this.video_index === 1 ) return 1
                if( this.muted && this.playing ) {
                    this.current_time = 1
                    this.ended = true
                }

                return this.current_time
            }

            set currentTime( value ) {
                this.current_time = value
            }

            play() {
                this.paused = false
                this.playing = true
                if( this.video_index === 1 ) this.ended = true
                if( this.video_index === 2 && this.muted ) muted_retry_count += 1
                return Promise.resolve()
            }

            pause() {
                this.paused = true
                this.playing = false
            }

        }

        try {
            vi.useFakeTimers()
            vi.stubGlobal( `MediaRecorder`, DataMediaRecorder )
            vi.mocked( get_clip_blob ).mockResolvedValue( new Blob( [ `clip` ], { type: `video/webm` } ) )
            vi.spyOn( URL, `createObjectURL` ).mockReturnValue( `blob:clip` )
            vi.spyOn( URL, `revokeObjectURL` ).mockImplementation( () => {} )
            vi.spyOn( document, `createElement` ).mockImplementation( ( tag_name, options ) => {
                if( tag_name === `video` ) return new MutedRecoveryVideoElement()
                return create_element( tag_name, options )
            } )

            const export_promise = compile_project_export( {
                clips: [
                    {
                        id: `clip-1`,
                        duration_ms: 1000,
                        width: 640,
                        height: 360
                    },
                    {
                        id: `clip-2`,
                        duration_ms: 1000,
                        width: 640,
                        height: 360
                    }
                ],
                settings: default_settings,
                signal: new AbortController().signal
            } )

            await Promise.resolve()
            await vi.advanceTimersByTimeAsync( 8_200 )

            await expect( export_promise ).resolves.toMatchObject( {
                duration_ms: 2000
            } )
            expect( muted_retry_count ).toBeGreaterThan( 0 )
        } finally {
            vi.useRealTimers()
        }
    } )

    test( `finishes a clip with infinite media duration near the stored clip end`, async () => {
        const create_element = document.createElement.bind( document )

        class InfiniteDurationVideoElement extends FakeVideoElement {

            constructor() {
                super()
                this.duration = Infinity
                this.current_time = 0
                this.playing = false
            }

            get currentTime() {
                if( this.playing && this.current_time < 0.95 ) this.current_time += 0.25
                return this.current_time
            }

            set currentTime( value ) {
                this.current_time = value
            }

            play() {
                this.playing = true
                return Promise.resolve()
            }

            pause() {
                this.playing = false
            }

        }

        vi.stubGlobal( `MediaRecorder`, DataMediaRecorder )
        vi.mocked( get_clip_blob ).mockResolvedValue( new Blob( [ `clip` ], { type: `video/webm` } ) )
        vi.spyOn( URL, `createObjectURL` ).mockReturnValue( `blob:clip` )
        vi.spyOn( URL, `revokeObjectURL` ).mockImplementation( () => {} )
        vi.spyOn( document, `createElement` ).mockImplementation( ( tag_name, options ) => {
            if( tag_name === `video` ) return new InfiniteDurationVideoElement()
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
        } ) ).resolves.toMatchObject( {
            duration_ms: 1000
        } )
    } )

    test( `finishes a clip when the browser never flips the ended flag`, async () => {
        const create_element = document.createElement.bind( document )

        class UnendedVideoElement extends FakeVideoElement {

            constructor() {
                super()
                this.duration = 1
                this.current_time = 0
                this.playing = false
            }

            get currentTime() {
                if( this.playing && this.current_time < 0.95 ) this.current_time += 0.25
                return this.current_time
            }

            set currentTime( value ) {
                this.current_time = value
            }

            play() {
                this.playing = true
                return Promise.resolve()
            }

            pause() {
                this.playing = false
            }

        }

        vi.stubGlobal( `MediaRecorder`, DataMediaRecorder )
        vi.mocked( get_clip_blob ).mockResolvedValue( new Blob( [ `clip` ], { type: `video/webm` } ) )
        vi.spyOn( URL, `createObjectURL` ).mockReturnValue( `blob:clip` )
        vi.spyOn( URL, `revokeObjectURL` ).mockImplementation( () => {} )
        vi.spyOn( document, `createElement` ).mockImplementation( ( tag_name, options ) => {
            if( tag_name === `video` ) return new UnendedVideoElement()
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
        } ) ).resolves.toMatchObject( {
            duration_ms: 1000
        } )
    } )

    test( `sets playback attributes before assigning clip video sources`, async () => {
        const create_element = document.createElement.bind( document )
        let video_element = null

        class SetupOrderVideoElement extends FakeVideoElement {

            set src( value ) {
                this.setup_before_source = {
                    playsInline: this.playsInline,
                    preload: this.preload
                }
                super.src = value
            }

        }

        vi.stubGlobal( `MediaRecorder`, DataMediaRecorder )
        vi.mocked( get_clip_blob ).mockResolvedValue( new Blob( [ `clip` ], { type: `video/webm` } ) )
        vi.spyOn( URL, `createObjectURL` ).mockReturnValue( `blob:clip` )
        vi.spyOn( URL, `revokeObjectURL` ).mockImplementation( () => {} )
        vi.spyOn( document, `createElement` ).mockImplementation( ( tag_name, options ) => {
            if( tag_name === `video` ) {
                video_element = new SetupOrderVideoElement()
                return video_element
            }

            return create_element( tag_name, options )
        } )

        await compile_project_export( {
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
        } )

        expect( video_element.setup_before_source ).toEqual( {
            playsInline: true,
            preload: `auto`
        } )
    } )

    test( `measures the first clip before sizing export canvas when stored dimensions are pending`, async () => {
        const create_element = document.createElement.bind( document )
        const capture_sizes = []

        class PortraitVideoElement extends FakeVideoElement {

            constructor() {
                super()
                this.videoWidth = 720
                this.videoHeight = 1280
            }

        }

        vi.stubGlobal( `MediaRecorder`, DataMediaRecorder )
        vi.mocked( get_clip_blob ).mockResolvedValue( new Blob( [ `clip` ], { type: `video/webm` } ) )
        vi.spyOn( URL, `createObjectURL` ).mockReturnValue( `blob:clip` )
        vi.spyOn( URL, `revokeObjectURL` ).mockImplementation( () => {} )
        vi.spyOn( document, `createElement` ).mockImplementation( ( tag_name, options ) => {
            if( tag_name === `video` ) return new PortraitVideoElement()
            return create_element( tag_name, options )
        } )
        HTMLCanvasElement.prototype.captureStream = vi.fn( function captureStream() {
            capture_sizes.push( {
                width: this.width,
                height: this.height
            } )
            return new FakeMediaStream( [ make_track() ] )
        } )

        await expect( compile_project_export( {
            clips: [
                {
                    id: `clip-1`,
                    duration_ms: 1000,
                    width: null,
                    height: null
                }
            ],
            settings: {
                ...default_settings,
                export_resolution: `720p`
            },
            signal: new AbortController().signal
        } ) ).resolves.toMatchObject( {
            duration_ms: 1000
        } )

        expect( capture_sizes ).toContainEqual( {
            width: 720,
            height: 1280
        } )
    } )

    test( `finishes with a warning when the export recorder stop event never arrives`, async () => {
        const create_element = document.createElement.bind( document )

        class NoStopMediaRecorder extends DataMediaRecorder {

            stop() {
                if( this.state === `inactive` ) return

                this.state = `inactive`
                this.ondataavailable?.( {
                    data: new Blob( [ `export` ], { type: this.mimeType } )
                } )
            }

        }

        try {
            vi.useFakeTimers()
            vi.stubGlobal( `MediaRecorder`, NoStopMediaRecorder )
            vi.mocked( get_clip_blob ).mockResolvedValue( new Blob( [ `clip` ], { type: `video/webm` } ) )
            vi.spyOn( URL, `createObjectURL` ).mockReturnValue( `blob:clip` )
            vi.spyOn( URL, `revokeObjectURL` ).mockImplementation( () => {} )
            vi.spyOn( document, `createElement` ).mockImplementation( ( tag_name, options ) => {
                if( tag_name === `video` ) return new FakeVideoElement()
                return create_element( tag_name, options )
            } )

            const export_promise = compile_project_export( {
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
            } )

            await vi.advanceTimersByTimeAsync( 0 )
            await vi.advanceTimersByTimeAsync( 5_000 )

            await expect( export_promise ).resolves.toMatchObject( {
                duration_ms: 1000,
                warnings: expect.arrayContaining( [
                    expect.stringMatching( /did not confirm export finalization/ )
                ] )
            } )
        } finally {
            vi.useRealTimers()
        }
    } )

    test( `retries blocked detached playback muted during export`, async () => {
        const create_element = document.createElement.bind( document )
        let video_element = null

        class ConnectedAudioContext {

            constructor() {
                this.state = `running`
            }

            createMediaStreamDestination() {
                return {
                    stream: new FakeMediaStream( [ make_track( `audio` ) ] )
                }
            }

            createMediaElementSource() {
                return {
                    connect: vi.fn(),
                    disconnect: vi.fn()
                }
            }

            close() {
                return Promise.resolve()
            }

        }

        class AutoplayBlockedVideoElement extends FakeVideoElement {

            play() {
                if( !this.muted ) {
                    const error = new Error( `Autoplay blocked` )
                    error.name = `NotAllowedError`
                    return Promise.reject( error )
                }

                this.ended = true
                return Promise.resolve()
            }

        }

        vi.stubGlobal( `AudioContext`, ConnectedAudioContext )
        vi.stubGlobal( `MediaRecorder`, DataMediaRecorder )
        vi.mocked( get_clip_blob ).mockResolvedValue( new Blob( [ `clip` ], { type: `video/webm` } ) )
        vi.spyOn( URL, `createObjectURL` ).mockReturnValue( `blob:clip` )
        vi.spyOn( URL, `revokeObjectURL` ).mockImplementation( () => {} )
        vi.spyOn( document, `createElement` ).mockImplementation( ( tag_name, options ) => {
            if( tag_name === `video` ) {
                video_element = new AutoplayBlockedVideoElement()
                return video_element
            }

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
        } ) ).resolves.toMatchObject( {
            duration_ms: 1000,
            warnings: expect.arrayContaining( [
                expect.stringMatching( /muted clip playback/ )
            ] )
        } )

        expect( video_element.muted ).toBe( true )
    } )

    test( `retries extension-shaped autoplay failures muted during export`, async () => {
        const create_element = document.createElement.bind( document )
        let video_element = null

        class ExtensionBlockedVideoElement extends FakeVideoElement {

            play() {
                if( !this.muted ) {
                    return Promise.reject(
                        new TypeError( `Cannot read properties of undefined (reading 'disableAutoplay')` )
                    )
                }

                this.ended = true
                return Promise.resolve()
            }

        }

        vi.stubGlobal( `MediaRecorder`, DataMediaRecorder )
        vi.mocked( get_clip_blob ).mockResolvedValue( new Blob( [ `clip` ], { type: `video/webm` } ) )
        vi.spyOn( URL, `createObjectURL` ).mockReturnValue( `blob:clip` )
        vi.spyOn( URL, `revokeObjectURL` ).mockImplementation( () => {} )
        vi.spyOn( document, `createElement` ).mockImplementation( ( tag_name, options ) => {
            if( tag_name === `video` ) {
                video_element = new ExtensionBlockedVideoElement()
                return video_element
            }

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
        } ) ).resolves.toMatchObject( {
            duration_ms: 1000
        } )

        expect( video_element.muted ).toBe( true )
    } )

    test( `continues video export when Web Audio resume is blocked`, async () => {
        const create_element = document.createElement.bind( document )
        const close = vi.fn().mockResolvedValue()

        class BlockedAudioContext {

            constructor() {
                this.state = `suspended`
            }

            createMediaStreamDestination() {
                return {
                    stream: new FakeMediaStream( [ make_track( `audio` ) ] )
                }
            }

            resume() {
                return Promise.reject( new Error( `Audio blocked` ) )
            }

            close() {
                return close()
            }

        }

        vi.stubGlobal( `AudioContext`, BlockedAudioContext )
        vi.stubGlobal( `MediaRecorder`, DataMediaRecorder )
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
        } ) ).resolves.toMatchObject( {
            duration_ms: 1000
        } )
        expect( close ).toHaveBeenCalledTimes( 1 )
    } )

    test( `disconnects clip audio sources after each clip`, async () => {
        const create_element = document.createElement.bind( document )
        const disconnect = vi.fn()

        class ConnectedAudioContext {

            constructor() {
                this.state = `running`
            }

            createMediaStreamDestination() {
                return {
                    stream: new FakeMediaStream( [ make_track( `audio` ) ] )
                }
            }

            createMediaElementSource() {
                return {
                    connect: vi.fn(),
                    disconnect
                }
            }

            close() {
                return Promise.resolve()
            }

        }

        vi.stubGlobal( `AudioContext`, ConnectedAudioContext )
        vi.stubGlobal( `MediaRecorder`, DataMediaRecorder )
        vi.mocked( get_clip_blob ).mockResolvedValue( new Blob( [ `clip` ], { type: `video/webm` } ) )
        vi.spyOn( URL, `createObjectURL` ).mockReturnValue( `blob:clip` )
        vi.spyOn( URL, `revokeObjectURL` ).mockImplementation( () => {} )
        vi.spyOn( document, `createElement` ).mockImplementation( ( tag_name, options ) => {
            if( tag_name === `video` ) return new FakeVideoElement()
            return create_element( tag_name, options )
        } )

        await compile_project_export( {
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
        } )

        expect( disconnect ).toHaveBeenCalledTimes( 1 )
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

    test( `shows only MIME types accepted by the canvas export recorder`, () => {
        class SelectiveMediaRecorder extends FakeMediaRecorder {

            static isTypeSupported( mime_type ) {
                return mime_type === `video/mp4` || mime_type === `video/webm`
            }

            constructor( stream, options = {} ) {
                if( options.mimeType === `video/mp4` ) throw new Error( `MP4 export unsupported` )
                super( stream, options )
            }

        }

        vi.stubGlobal( `MediaRecorder`, SelectiveMediaRecorder )

        expect( get_supported_export_mime_types() ).toEqual( [ `video/webm` ] )
    } )

    test( `compiles with a canvas-proven MIME fallback when the first supported type cannot start`, async () => {
        const create_element = document.createElement.bind( document )

        class CanvasSelectiveMediaRecorder extends DataMediaRecorder {

            static isTypeSupported( mime_type ) {
                return mime_type.includes( `mp4` ) || mime_type === `video/webm`
            }

            start() {
                if( this.mimeType.includes( `mp4` ) ) throw new Error( `MP4 canvas recorder cannot start` )
                super.start()
            }

        }

        vi.stubGlobal( `MediaRecorder`, CanvasSelectiveMediaRecorder )
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
        } ) ).resolves.toMatchObject( {
            mime_type: `video/webm`,
            duration_ms: 1000
        } )
    } )

    test( `retries another export MIME when the actual recorder cannot start`, async () => {
        const create_element = document.createElement.bind( document )

        class MixedStreamStartSelectiveMediaRecorder extends DataMediaRecorder {

            static isTypeSupported( mime_type ) {
                return mime_type === `video/mp4` || mime_type === `video/webm`
            }

            start() {
                if( this.mimeType === `video/mp4` && !this.stream.probe ) {
                    throw new Error( `MP4 cannot start the mixed export stream` )
                }

                super.start()
            }

        }

        vi.stubGlobal( `MediaRecorder`, MixedStreamStartSelectiveMediaRecorder )
        vi.mocked( get_clip_blob ).mockResolvedValue( new Blob( [ `clip` ], { type: `video/webm` } ) )
        vi.spyOn( URL, `createObjectURL` ).mockReturnValue( `blob:clip` )
        vi.spyOn( URL, `revokeObjectURL` ).mockImplementation( () => {} )
        vi.spyOn( document, `createElement` ).mockImplementation( ( tag_name, options ) => {
            if( tag_name === `video` ) return new FakeVideoElement()
            return create_element( tag_name, options )
        } )
        HTMLCanvasElement.prototype.captureStream = vi.fn( function captureStream() {
            const stream = new FakeMediaStream( [ make_track() ] )
            stream.probe = this.width === 16 && this.height === 16

            return stream
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
        } ) ).resolves.toMatchObject( {
            mime_type: `video/webm`,
            duration_ms: 1000
        } )
    } )

    test( `uses the emitted chunk type when typed construction falls back to the default recorder`, async () => {
        const create_element = document.createElement.bind( document )

        class ConstructorFallbackMediaRecorder extends FakeMediaRecorder {

            static isTypeSupported( mime_type ) {
                return mime_type === `video/mp4` || mime_type === `video/webm`
            }

            constructor( stream, options = {} ) {
                if( options.mimeType === `video/mp4` && !stream.probe ) {
                    throw new Error( `MP4 cannot construct for the mixed export stream` )
                }

                super( stream, options )
                if( !options.mimeType ) this.mimeType = ``
            }

            stop() {
                if( this.state === `inactive` ) return

                this.state = `inactive`
                this.ondataavailable?.( {
                    data: new Blob( [ `export` ], { type: this.mimeType || `video/webm` } )
                } )
                this.onstop?.()
            }

        }

        vi.stubGlobal( `MediaRecorder`, ConstructorFallbackMediaRecorder )
        vi.mocked( get_clip_blob ).mockResolvedValue( new Blob( [ `clip` ], { type: `video/webm` } ) )
        vi.spyOn( URL, `createObjectURL` ).mockReturnValue( `blob:clip` )
        vi.spyOn( URL, `revokeObjectURL` ).mockImplementation( () => {} )
        vi.spyOn( document, `createElement` ).mockImplementation( ( tag_name, options ) => {
            if( tag_name === `video` ) return new FakeVideoElement()
            return create_element( tag_name, options )
        } )
        HTMLCanvasElement.prototype.captureStream = vi.fn( function captureStream() {
            const stream = new FakeMediaStream( [ make_track() ] )
            stream.probe = this.width === 16 && this.height === 16

            return stream
        } )

        const export_result = await compile_project_export( {
            clips: [
                {
                    id: `clip-1`,
                    duration_ms: 1000,
                    width: 640,
                    height: 360
                }
            ],
            settings: {
                ...default_settings,
                preferred_mime_type: `video/mp4`
            },
            signal: new AbortController().signal
        } )

        expect( export_result.mime_type ).toBe( `video/webm` )
        expect( export_result.blob.type ).toBe( `video/webm` )
    } )

    test( `hides MIME types when the canvas recorder cannot start`, () => {
        class StartBlockedMediaRecorder extends FakeMediaRecorder {

            static isTypeSupported( mime_type ) {
                return mime_type === `video/webm`
            }

            start() {
                throw new Error( `Canvas recording blocked` )
            }

        }

        vi.stubGlobal( `MediaRecorder`, StartBlockedMediaRecorder )

        expect( get_supported_export_mime_types() ).toEqual( [] )
    } )

    test( `normalizes persisted export settings to runtime-supported choices`, () => {
        HTMLCanvasElement.prototype.captureStream = vi.fn( function captureStream() {
            if( this.width >= 1920 ) throw new Error( `Resolution unsupported` )
            return new FakeMediaStream( [ make_track() ] )
        } )

        class SelectiveMediaRecorder extends FakeMediaRecorder {

            static isTypeSupported( mime_type ) {
                return mime_type === `video/mp4` || mime_type === `video/webm`
            }

            constructor( stream, options = {} ) {
                if( options.mimeType === `video/mp4` ) throw new Error( `MP4 export unsupported` )
                super( stream, options )
            }

        }

        vi.stubGlobal( `MediaRecorder`, SelectiveMediaRecorder )

        expect( normalize_export_settings( {
            export_quality: `oversized`,
            export_resolution: `1080p`,
            preferred_mime_type: `video/mp4`,
            haptics_enabled: true
        } ) ).toMatchObject( {
            export_quality: `standard`,
            export_resolution: `source`,
            preferred_mime_type: null,
            haptics_enabled: true
        } )
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

    test( `hides export controls and fails clearly when canvas drawing is unavailable`, async () => {
        HTMLCanvasElement.prototype.getContext = vi.fn( () => null )

        expect( get_export_support_message() ).toMatch( /draw video frames/ )
        expect( get_supported_export_mime_types() ).toEqual( [] )
        expect( get_supported_export_resolutions() ).toEqual( [] )

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
        } ) ).rejects.toThrow( /draw video frames/ )
    } )
} )
