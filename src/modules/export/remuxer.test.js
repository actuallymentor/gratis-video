import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
    can_attempt_remux_export,
    compile_project_remux_export,
    RemuxUnavailableError
} from './remuxer.js'
import { get_clip_blob } from '../storage/journal_storage.js'

const mediabunny_mock = vi.hoisted( () => {
    const MP4 = { key: `mp4` }
    const WEBM = { key: `webm` }
    const state = {
        audio_sources: [],
        disposed_inputs: [],
        outputs: [],
        video_sources: []
    }
    const reset = () => {
        state.audio_sources.length = 0
        state.disposed_inputs.length = 0
        state.outputs.length = 0
        state.video_sources.length = 0
    }

    class BlobSource {

        constructor( blob ) {
            this.blob = blob
        }

    }

    class BufferTarget {

        constructor() {
            this.buffer = null
        }

    }

    class EncodedPacketSink {

        constructor( track ) {
            this.track = track
        }

        async *packets() {
            yield* this.track.packets
        }

    }

    class EncodedVideoPacketSource {

        constructor( codec ) {
            this.codec = codec
            this.packets = []
            this.closed = false
            state.video_sources.push( this )
        }

        add( packet, metadata ) {
            this.packets.push( { metadata, packet } )
            return Promise.resolve()
        }

        close() {
            this.closed = true
        }

    }

    class EncodedAudioPacketSource {

        constructor( codec ) {
            this.codec = codec
            this.packets = []
            this.closed = false
            state.audio_sources.push( this )
        }

        add( packet, metadata ) {
            this.packets.push( { metadata, packet } )
            return Promise.resolve()
        }

        close() {
            this.closed = true
        }

    }

    class Input {

        constructor( { source } ) {
            this.fixture = source.blob.fixture
            this.disposed = false
        }

        getFormat() {
            return Promise.resolve( this.fixture.format )
        }

        getPrimaryVideoTrack() {
            return Promise.resolve( this.fixture.video_track )
        }

        getPrimaryAudioTrack() {
            return Promise.resolve( this.fixture.audio_track ?? null )
        }

        getFirstTimestamp() {
            return Promise.resolve( this.fixture.first_timestamp )
        }

        dispose() {
            this.disposed = true
            state.disposed_inputs.push( this )
        }

    }

    class Mp4OutputFormat {

        constructor( options = {} ) {
            this.options = options
        }

    }

    class WebMOutputFormat {}

    class Output {

        constructor( { target } ) {
            this.target = target
            this.cancelled = false
            this.finalized = false
            state.outputs.push( this )
        }

        addVideoTrack( source, metadata ) {
            this.video_track = { metadata, source }
        }

        addAudioTrack( source, metadata ) {
            this.audio_track = { metadata, source }
        }

        start() {
            this.started = true
            return Promise.resolve()
        }

        getMimeType() {
            return Promise.resolve( `video/webm;codecs=vp8,opus` )
        }

        cancel() {
            this.cancelled = true
            return Promise.resolve()
        }

        finalize() {
            this.finalized = true
            this.target.buffer = new TextEncoder().encode( `remuxed-output` ).buffer
            return Promise.resolve()
        }

    }

    return {
        exports: {
            BlobSource,
            BufferTarget,
            EncodedAudioPacketSource,
            EncodedPacketSink,
            EncodedVideoPacketSource,
            Input,
            MP4,
            Mp4OutputFormat,
            Output,
            WEBM,
            WebMOutputFormat
        },
        MP4,
        reset,
        state,
        WEBM
    }
} )

vi.mock( 'mediabunny', () => mediabunny_mock.exports )

vi.mock( '../storage/journal_storage.js', () => ( {
    get_clip_blob: vi.fn()
} ) )

const default_settings = {
    export_quality: `standard`,
    export_resolution: `source`,
    preferred_mime_type: null
}

const make_packet = ( timestamp, duration = 0.5 ) => ( {
    duration,
    timestamp,
    clone( options = {} ) {
        return {
            ...this,
            ...options
        }
    }
} )

const make_video_track = ( {
    codec = `vp8`,
    decoder_config = { codec: `vp8`, codedHeight: 360, codedWidth: 640 },
    height = 360,
    packets = [ make_packet( 0 ), make_packet( 0.5 ) ],
    width = 640
} = {} ) => ( {
    packets,
    getCodec: () => Promise.resolve( codec ),
    getCodecParameterString: () => Promise.resolve( codec ),
    getDecoderConfig: () => Promise.resolve( decoder_config ),
    getCodedWidth: () => Promise.resolve( width ),
    getCodedHeight: () => Promise.resolve( height ),
    getDisplayWidth: () => Promise.resolve( width ),
    getDisplayHeight: () => Promise.resolve( height ),
    getRotation: () => Promise.resolve( 0 ),
    getPixelAspectRatio: () => Promise.resolve( { denominator: 1, numerator: 1 } ),
    getColorSpace: () => Promise.resolve( { matrix: `bt709`, primaries: `bt709`, transfer: `bt709` } ),
    hasOnlyKeyPackets: () => Promise.resolve( false )
} )

const make_audio_track = ( {
    codec = `opus`,
    decoder_config = { codec: `opus`, numberOfChannels: 2, sampleRate: 48_000 },
    packets = [ make_packet( 0, 0.5 ), make_packet( 0.5, 0.5 ) ]
} = {} ) => ( {
    packets,
    getCodec: () => Promise.resolve( codec ),
    getCodecParameterString: () => Promise.resolve( codec ),
    getDecoderConfig: () => Promise.resolve( decoder_config ),
    getNumberOfChannels: () => Promise.resolve( 2 ),
    getSampleRate: () => Promise.resolve( 48_000 )
} )

const make_clip_blob = ( fixture = {} ) => ( {
    fixture: {
        audio_track: make_audio_track(),
        first_timestamp: 0,
        format: mediabunny_mock.WEBM,
        video_track: make_video_track(),
        ...fixture
    },
    size: 100,
    type: `video/webm`
} )

describe( `client-side remux exporter`, () => {
    beforeEach( () => {
        mediabunny_mock.reset()
        vi.mocked( get_clip_blob ).mockReset()
    } )

    test( `attempts remuxing only for source-resolution clips with one known container`, () => {
        expect( can_attempt_remux_export( {
            clips: [
                { mime_type: `video/webm` },
                { mime_type: `video/webm;codecs=vp8,opus` }
            ],
            settings: default_settings
        } ) ).toMatchObject( {
            ok: true
        } )

        expect( can_attempt_remux_export( {
            clips: [ { mime_type: `video/webm` } ],
            settings: {
                ...default_settings,
                export_resolution: `720p`
            }
        } ) ).toMatchObject( {
            ok: false
        } )

        expect( can_attempt_remux_export( {
            clips: [
                { mime_type: `video/webm` },
                { mime_type: `video/mp4` }
            ],
            settings: default_settings
        } ) ).toMatchObject( {
            ok: false
        } )

        expect( can_attempt_remux_export( {
            clips: [ { mime_type: `video/webm` } ],
            settings: {
                ...default_settings,
                preferred_mime_type: `video/mp4`
            }
        } ) ).toMatchObject( {
            ok: false
        } )
    } )

    test( `copies packets into one output with continuous timestamps`, async () => {
        vi.mocked( get_clip_blob ).mockImplementation( ( clip_id ) => {
            if( clip_id === `clip-a` ) return Promise.resolve( make_clip_blob() )
            return Promise.resolve( make_clip_blob() )
        } )

        const result = await compile_project_remux_export( {
            clips: [
                { id: `clip-a`, mime_type: `video/webm` },
                { id: `clip-b`, mime_type: `video/webm` }
            ],
            settings: default_settings,
            signal: new AbortController().signal
        } )

        const [ video_source ] = mediabunny_mock.state.video_sources
        const [ audio_source ] = mediabunny_mock.state.audio_sources

        expect( result ).toMatchObject( {
            duration_ms: 2000,
            mime_type: `video/webm;codecs=vp8,opus`
        } )
        expect( result.blob.size ).toBeGreaterThan( 0 )
        expect( video_source.packets.map( ( { packet } ) => packet.timestamp ) ).toEqual( [
            0,
            0.5,
            1,
            1.5
        ] )
        expect( audio_source.packets.map( ( { packet } ) => packet.timestamp ) ).toEqual( [
            0,
            0.5,
            1,
            1.5
        ] )
        expect( video_source.packets.at( 0 ).metadata ).toMatchObject( {
            decoderConfig: expect.objectContaining( { codec: `vp8` } )
        } )
        expect( video_source.packets.at( 1 ).metadata ).toBeUndefined()
        expect( video_source.closed ).toBe( true )
        expect( audio_source.closed ).toBe( true )
        expect( mediabunny_mock.state.disposed_inputs ).toHaveLength( 2 )
    } )

    test( `normalizes non-zero clip start timestamps while preserving duration`, async () => {
        vi.mocked( get_clip_blob ).mockImplementation( ( clip_id ) => {
            if( clip_id === `clip-a` ) return Promise.resolve( make_clip_blob( {
                first_timestamp: 2,
                video_track: make_video_track( {
                    packets: [
                        make_packet( 2 ),
                        make_packet( 2.5 )
                    ]
                } ),
                audio_track: make_audio_track( {
                    packets: [
                        make_packet( 2, 0.5 ),
                        make_packet( 2.5, 0.5 )
                    ]
                } )
            } ) )

            return Promise.resolve( make_clip_blob( {
                first_timestamp: 8,
                video_track: make_video_track( {
                    packets: [
                        make_packet( 8 ),
                        make_packet( 8.5 )
                    ]
                } ),
                audio_track: make_audio_track( {
                    packets: [
                        make_packet( 8, 0.5 ),
                        make_packet( 8.5, 0.5 )
                    ]
                } )
            } ) )
        } )

        await compile_project_remux_export( {
            clips: [
                { id: `clip-a`, mime_type: `video/webm` },
                { id: `clip-b`, mime_type: `video/webm` }
            ],
            settings: default_settings,
            signal: new AbortController().signal
        } )

        const [ video_source ] = mediabunny_mock.state.video_sources

        expect( video_source.packets.map( ( { packet } ) => packet.timestamp ) ).toEqual( [
            0,
            0.5,
            1,
            1.5
        ] )
    } )

    test( `rejects incompatible video metadata before writing an export`, async () => {
        vi.mocked( get_clip_blob ).mockImplementation( ( clip_id ) => {
            if( clip_id === `clip-a` ) return Promise.resolve( make_clip_blob() )
            return Promise.resolve( make_clip_blob( {
                video_track: make_video_track( {
                    decoder_config: { codec: `vp8`, codedHeight: 720, codedWidth: 1280 },
                    height: 720,
                    width: 1280
                } )
            } ) )
        } )

        await expect( compile_project_remux_export( {
            clips: [
                { id: `clip-a`, mime_type: `video/webm` },
                { id: `clip-b`, mime_type: `video/webm` }
            ],
            settings: default_settings,
            signal: new AbortController().signal
        } ) ).rejects.toBeInstanceOf( RemuxUnavailableError )

        expect( mediabunny_mock.state.outputs ).toHaveLength( 0 )
        expect( mediabunny_mock.state.disposed_inputs ).toHaveLength( 2 )
    } )

    test( `cancels the output when packet copying fails`, async () => {
        vi.mocked( get_clip_blob ).mockResolvedValue( make_clip_blob( {
            video_track: make_video_track( { packets: [] } )
        } ) )

        await expect( compile_project_remux_export( {
            clips: [ { id: `clip-a`, mime_type: `video/webm` } ],
            settings: default_settings,
            signal: new AbortController().signal
        } ) ).rejects.toBeInstanceOf( RemuxUnavailableError )

        expect( mediabunny_mock.state.outputs.at( 0 ).cancelled ).toBe( true )
        expect( mediabunny_mock.state.disposed_inputs ).toHaveLength( 1 )
    } )
} )
