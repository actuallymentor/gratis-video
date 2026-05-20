import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
    BlobSource,
    BufferTarget,
    EncodedPacket,
    EncodedPacketSink,
    EncodedVideoPacketSource,
    Input,
    Output,
    WEBM,
    WebMOutputFormat
} from 'mediabunny'
import { compile_project_remux_export } from './remuxer.js'
import { get_clip_blob } from '../storage/journal_storage.js'

vi.mock( '../storage/journal_storage.js', () => ( {
    get_clip_blob: vi.fn()
} ) )

const default_settings = {
    export_quality: `standard`,
    export_resolution: `source`,
    preferred_mime_type: null
}

const make_fixture_packet = ( timestamp, type = `delta` ) => {
    const seed = Math.max( 1, Math.round( timestamp * 10 ) )

    return new EncodedPacket(
        new Uint8Array( [ seed, 2, 3, 4, 5 ] ),
        type,
        timestamp,
        0.5
    )
}

const make_real_webm_blob = async () => {
    const target = new BufferTarget()
    const output = new Output( {
        format: new WebMOutputFormat(),
        target
    } )
    const source = new EncodedVideoPacketSource( `vp8` )

    output.addVideoTrack( source, { frameRate: 2 } )
    await output.start()

    await source.add( make_fixture_packet( 0, `key` ), {
        decoderConfig: {
            codec: `vp8`,
            codedHeight: 16,
            codedWidth: 16
        }
    } )
    await source.add( make_fixture_packet( 0.5 ) )
    await source.add( make_fixture_packet( 1 ) )
    source.close()
    await output.finalize()

    return new Blob( [ target.buffer ], {
        type: await output.getMimeType()
    } )
}

const read_video_packets = async ( blob ) => {
    const input = new Input( {
        formats: [ WEBM ],
        source: new BlobSource( blob )
    } )

    try {
        const video_track = await input.getPrimaryVideoTrack()
        const sink = new EncodedPacketSink( video_track )
        const packets = []

        for await ( const packet of sink.packets() ) packets.push( packet )

        return packets
    } finally {
        input.dispose()
    }
}

describe( `client-side remux exporter with real Mediabunny`, () => {
    beforeEach( () => {
        vi.mocked( get_clip_blob ).mockReset()
    } )

    test( `remuxes real WebM packets into a continuous output`, async () => {
        const first_blob = await make_real_webm_blob()
        const second_blob = await make_real_webm_blob()

        vi.mocked( get_clip_blob ).mockImplementation( ( clip_id ) => {
            return Promise.resolve( clip_id === `clip-a` ? first_blob : second_blob )
        } )

        const result = await compile_project_remux_export( {
            clips: [
                { id: `clip-a`, mime_type: `video/webm` },
                { id: `clip-b`, mime_type: `video/webm` }
            ],
            settings: default_settings,
            signal: new AbortController().signal
        } )
        const packets = await read_video_packets( result.blob )

        expect( result.blob.size ).toBeGreaterThan( first_blob.size )
        expect( result.mime_type ).toMatch( /^video\/webm/ )
        expect( packets.map( ( { timestamp } ) => timestamp ) ).toEqual( [
            0,
            0.5,
            1,
            1.5,
            2,
            2.5
        ] )
    } )
} )
