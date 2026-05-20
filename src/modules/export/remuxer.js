import { log } from 'mentie/modules/logging.js'
import { get_clip_blob } from '../storage/journal_storage.js'

const REMUXABLE_EXPORT_RESOLUTION = `source`
const REMUX_PROGRESS_START_PERCENT = 1
const REMUX_PROGRESS_END_PERCENT = 95
const REMUX_PROGRESS_RANGE = REMUX_PROGRESS_END_PERCENT - REMUX_PROGRESS_START_PERCENT

let mediabunny_module_promise = null

export class RemuxUnavailableError extends Error {

    constructor( message ) {
        super( message )
        this.name = `RemuxUnavailableError`
    }

}

const make_abort_error = () => new DOMException( `Export cancelled`, `AbortError` )

const throw_if_aborted = ( signal ) => {
    if( signal?.aborted ) throw make_abort_error()
}

const remux_unavailable = ( message ) => new RemuxUnavailableError( message )

const container_definitions = [
    {
        key: `mp4`,
        mime_type: `video/mp4`
    },
    {
        key: `webm`,
        mime_type: `video/webm`
    }
]

const load_mediabunny = () => {
    mediabunny_module_promise ??= import( 'mediabunny' ).catch( ( error ) => {
        mediabunny_module_promise = null
        throw error
    } )

    return mediabunny_module_promise
}

const get_base_mime_type = ( mime_type = `` ) => {
    return mime_type.toLowerCase().split( `;` ).at( 0 )?.trim() ?? ``
}

const get_container_from_mime_type = ( mime_type = `` ) => {
    const base_mime_type = get_base_mime_type( mime_type )

    return container_definitions.find( ( { mime_type: container_mime_type } ) => {
        return base_mime_type === container_mime_type
    } ) ?? null
}

const get_container_from_format = ( format, mediabunny ) => {
    if( format === mediabunny.MP4 ) return container_definitions.find( ( { key } ) => key === `mp4` )
    if( format === mediabunny.WEBM ) return container_definitions.find( ( { key } ) => key === `webm` )

    return null
}

const make_output_format = ( container, mediabunny ) => {
    if( container.key === `mp4` ) return new mediabunny.Mp4OutputFormat( { fastStart: false } )
    if( container.key === `webm` ) return new mediabunny.WebMOutputFormat()

    throw remux_unavailable( `This clip format is not supported for lossless export.` )
}

const unique_values = ( values ) => [ ...new Set( values ) ]

const get_metadata_container = ( clips ) => {
    const containers = clips.map( ( { mime_type } ) => get_container_from_mime_type( mime_type ) )
    if( containers.some( ( container ) => !container ) ) return null

    const container_keys = unique_values( containers.map( ( { key } ) => key ) )
    if( container_keys.length !== 1 ) return null

    return containers.at( 0 )
}

const preferred_mime_matches_container = ( settings, container ) => {
    if( !settings.preferred_mime_type ) return true
    return get_base_mime_type( settings.preferred_mime_type ) === container.mime_type
}

const normalize_signature_value = ( value ) => {
    if( value === undefined ) return `__undefined__`
    if( value === null ) return null
    if( typeof value === `number` && !Number.isFinite( value ) ) return `${ value }`
    if( value instanceof Uint8Array ) return { type: `Uint8Array`, data: Array.from( value ) }
    if( value instanceof ArrayBuffer ) return { type: `ArrayBuffer`, data: Array.from( new Uint8Array( value ) ) }
    if( ArrayBuffer.isView?.( value ) ) {
        const view = new Uint8Array( value.buffer, value.byteOffset, value.byteLength )

        return {
            type: value.constructor?.name ?? `TypedArray`,
            data: Array.from( view )
        }
    }
    if( Array.isArray( value ) ) return value.map( normalize_signature_value )
    if( typeof value === `object` ) {
        return Object
            .keys( value )
            .sort()
            .reduce( ( normalized, key ) => ( {
                ...normalized,
                [ key ]: normalize_signature_value( value[ key ] )
            } ), {} )
    }

    return value
}

const make_signature = ( value ) => JSON.stringify( normalize_signature_value( value ) )

const assert_finite_number = ( value, message ) => {
    if( Number.isFinite( value ) ) return value

    throw remux_unavailable( message )
}

const read_video_info = async ( video_track ) => {
    const [
        codec,
        codec_parameter_string,
        decoder_config,
        coded_width,
        coded_height,
        display_width,
        display_height,
        rotation,
        pixel_aspect_ratio,
        color_space,
        has_only_key_packets
    ] = await Promise.all( [
        video_track.getCodec(),
        video_track.getCodecParameterString(),
        video_track.getDecoderConfig(),
        video_track.getCodedWidth(),
        video_track.getCodedHeight(),
        video_track.getDisplayWidth(),
        video_track.getDisplayHeight(),
        video_track.getRotation(),
        video_track.getPixelAspectRatio(),
        video_track.getColorSpace(),
        video_track.hasOnlyKeyPackets()
    ] )

    if( !codec ) throw remux_unavailable( `The recorded video codec is not supported for lossless export.` )
    if( !decoder_config ) throw remux_unavailable( `The recorded video metadata is incomplete for lossless export.` )

    const signature = make_signature( {
        codec,
        codec_parameter_string,
        decoder_config,
        coded_width,
        coded_height,
        display_width,
        display_height,
        rotation,
        pixel_aspect_ratio,
        color_space
    } )

    return {
        codec,
        decoder_config,
        has_only_key_packets,
        rotation,
        signature
    }
}

const read_audio_info = async ( audio_track ) => {
    if( !audio_track ) return null

    const [
        codec,
        codec_parameter_string,
        decoder_config,
        number_of_channels,
        sample_rate
    ] = await Promise.all( [
        audio_track.getCodec(),
        audio_track.getCodecParameterString(),
        audio_track.getDecoderConfig(),
        audio_track.getNumberOfChannels(),
        audio_track.getSampleRate()
    ] )

    if( !codec ) throw remux_unavailable( `The recorded audio codec is not supported for lossless export.` )
    if( !decoder_config ) throw remux_unavailable( `The recorded audio metadata is incomplete for lossless export.` )

    const signature = make_signature( {
        codec,
        codec_parameter_string,
        decoder_config,
        number_of_channels,
        sample_rate
    } )

    return {
        codec,
        decoder_config,
        signature
    }
}

const missing_clip_blob_error = ( clip_index ) => {
    return new Error( `Clip ${ clip_index + 1 } is missing from local storage. Export stopped to avoid creating an incomplete video.` )
}

const get_clip_blob_or_fail = async ( clip, clip_index ) => {
    const blob = await get_clip_blob( clip.id )
    if( !blob ) throw missing_clip_blob_error( clip_index )

    return blob
}

const inspect_remux_input = async ( { blob, clip, clip_index, mediabunny, signal } ) => {
    throw_if_aborted( signal )

    const input = new mediabunny.Input( {
        formats: [ mediabunny.MP4, mediabunny.WEBM ],
        source: new mediabunny.BlobSource( blob )
    } )

    try {
        const format = await input.getFormat()
        const container = get_container_from_format( format, mediabunny )
        if( !container ) throw remux_unavailable( `This clip format is not supported for lossless export.` )

        const video_track = await input.getPrimaryVideoTrack()
        if( !video_track ) throw remux_unavailable( `A clip has no video track to export losslessly.` )

        const audio_track = await input.getPrimaryAudioTrack()
        throw_if_aborted( signal )

        const tracks = [ video_track, audio_track ].filter( Boolean )
        const first_timestamp = await input.getFirstTimestamp( tracks )
        assert_finite_number( first_timestamp, `A clip has invalid timestamp metadata.` )
        throw_if_aborted( signal )

        const [ video_info, audio_info ] = await Promise.all( [
            read_video_info( video_track ),
            read_audio_info( audio_track )
        ] )
        throw_if_aborted( signal )

        return {
            audio_info,
            audio_track,
            blob,
            clip,
            clip_index,
            container,
            first_timestamp,
            input,
            tracks,
            video_info,
            video_track
        }
    } catch ( error ) {
        input.dispose()
        throw error
    }
}

const validate_remux_inputs = ( remux_inputs, settings ) => {
    const [ first_input ] = remux_inputs
    const container_keys = unique_values( remux_inputs.map( ( { container } ) => container.key ) )
    if( container_keys.length !== 1 ) throw remux_unavailable( `The clips use different container formats.` )
    if( !preferred_mime_matches_container( settings, first_input.container ) ) {
        throw remux_unavailable( `The selected export format requires re-encoding these clips.` )
    }

    remux_inputs.slice( 1 ).forEach( ( remux_input ) => {
        if( remux_input.video_info.signature !== first_input.video_info.signature ) {
            throw remux_unavailable( `The clips use different video formats or dimensions.` )
        }

        const first_has_audio = Boolean( first_input.audio_info )
        const next_has_audio = Boolean( remux_input.audio_info )
        if( first_has_audio !== next_has_audio ) throw remux_unavailable( `Some clips have audio while others do not.` )

        if( remux_input.audio_info?.signature !== first_input.audio_info?.signature ) {
            throw remux_unavailable( `The clips use different audio formats.` )
        }
    } )

    return first_input
}

const make_remuxed_packet = ( packet, { sequence_state, timestamp_delta } ) => {
    assert_finite_number( packet.timestamp, `A clip packet has an invalid timestamp.` )
    assert_finite_number( packet.duration, `A clip packet has an invalid duration.` )

    return packet.clone( {
        sequenceNumber: sequence_state.next++,
        timestamp: packet.timestamp + timestamp_delta
    } )
}

const add_packet_to_source = async ( {
    decoder_config,
    packet,
    sequence_state,
    source,
    timestamp_delta
} ) => {
    const remuxed_packet = make_remuxed_packet( packet, {
        sequence_state,
        timestamp_delta
    } )
    assert_finite_number( remuxed_packet.timestamp, `A remuxed packet has an invalid timestamp.` )
    assert_finite_number( remuxed_packet.duration, `A remuxed packet has an invalid duration.` )

    // All clips must share decoder config, so the output track only needs it once.
    const metadata = sequence_state.next === 1
        ? { decoderConfig: decoder_config }
        : undefined

    await source.add( remuxed_packet, metadata )

    return remuxed_packet.timestamp + remuxed_packet.duration
}

const pipe_track_packets = async ( {
    decoder_config,
    mediabunny,
    sequence_state,
    signal,
    source,
    timestamp_delta,
    track
} ) => {
    const sink = new mediabunny.EncodedPacketSink( track )
    let packet_count = 0
    let max_end_timestamp = 0

    for await ( const packet of sink.packets() ) {
        throw_if_aborted( signal )
        max_end_timestamp = Math.max(
            max_end_timestamp,
            await add_packet_to_source( {
                decoder_config,
                packet,
                sequence_state,
                source,
                timestamp_delta
            } )
        )
        packet_count += 1
    }

    if( packet_count === 0 ) throw remux_unavailable( `A clip track has no packets to export losslessly.` )

    return max_end_timestamp
}

const pipe_clip_packets = async ( {
    audio_sequence_state,
    audio_source,
    clip_offset,
    mediabunny,
    remux_input,
    signal,
    video_sequence_state,
    video_source
} ) => {
    assert_finite_number( clip_offset, `Lossless export clip timing became invalid.` )
    assert_finite_number( remux_input.first_timestamp, `A clip has invalid timestamp metadata.` )

    const timestamp_delta = clip_offset - remux_input.first_timestamp
    assert_finite_number( timestamp_delta, `Lossless export timestamp adjustment became invalid.` )

    const video_duration = pipe_track_packets( {
        decoder_config: remux_input.video_info.decoder_config,
        mediabunny,
        sequence_state: video_sequence_state,
        signal,
        source: video_source,
        timestamp_delta,
        track: remux_input.video_track
    } )
    const audio_duration = remux_input.audio_track
        ? pipe_track_packets( {
            decoder_config: remux_input.audio_info.decoder_config,
            mediabunny,
            sequence_state: audio_sequence_state,
            signal,
            source: audio_source,
            timestamp_delta,
            track: remux_input.audio_track
        } )
        : Promise.resolve( clip_offset )
    const track_end_timestamps = await Promise.all( [
        video_duration,
        audio_duration
    ] )

    return Math.max( ...track_end_timestamps, clip_offset )
}

const close_sources = ( sources ) => {
    sources.filter( Boolean ).forEach( ( source ) => source.close() )
}

const dispose_inputs = ( remux_inputs ) => {
    remux_inputs.forEach( ( { input } ) => input.dispose() )
}

const write_remuxed_output = async ( { mediabunny, remux_inputs, settings, signal, on_progress } ) => {
    const first_input = validate_remux_inputs( remux_inputs, settings )
    const target = new mediabunny.BufferTarget()
    const output = new mediabunny.Output( {
        format: make_output_format( first_input.container, mediabunny ),
        target
    } )
    const video_source = new mediabunny.EncodedVideoPacketSource( first_input.video_info.codec )
    const audio_source = first_input.audio_info
        ? new mediabunny.EncodedAudioPacketSource( first_input.audio_info.codec )
        : null
    const video_sequence_state = { next: 0 }
    const audio_sequence_state = { next: 0 }
    let finalized = false
    let sources_closed = false

    const close_output_sources = () => {
        if( sources_closed ) return

        close_sources( [ video_source, audio_source ] )
        sources_closed = true
    }

    output.addVideoTrack( video_source, {
        hasOnlyKeyPackets: first_input.video_info.has_only_key_packets,
        rotation: first_input.video_info.rotation
    } )
    if( audio_source ) output.addAudioTrack( audio_source )

    try {
        await output.start()
        on_progress?.( {
            percent: REMUX_PROGRESS_START_PERCENT,
            message: `Preparing lossless export`
        } )

        const duration_seconds = await remux_inputs.reduce( async ( previous_offset, remux_input, index ) => {
            const clip_offset = await previous_offset
            const next_offset = await pipe_clip_packets( {
                audio_sequence_state,
                audio_source,
                clip_offset,
                mediabunny,
                remux_input,
                signal,
                video_sequence_state,
                video_source
            } )
            const percent = Math.min(
                REMUX_PROGRESS_END_PERCENT,
                Math.round( REMUX_PROGRESS_START_PERCENT +  ( index + 1 ) / remux_inputs.length  * REMUX_PROGRESS_RANGE )
            )

            on_progress?.( {
                percent,
                message: `Remuxing clip ${ index + 1 } of ${ remux_inputs.length }`
            } )

            return next_offset
        }, Promise.resolve( 0 ) )

        close_output_sources()
        throw_if_aborted( signal )
        await output.finalize()
        finalized = true

        const mime_type = await output.getMimeType().catch( () => first_input.container.mime_type )
        const { buffer } = target
        if( !buffer?.byteLength ) throw new Error( `Lossless export did not produce a video file.` )
        assert_finite_number( duration_seconds, `Lossless export duration became invalid.` )

        on_progress?.( {
            percent: 100,
            message: `Export ready`
        } )

        return {
            blob: new Blob( [ buffer ], { type: mime_type } ),
            duration_ms: Math.round( duration_seconds * 1000 ),
            mime_type,
            warnings: []
        }
    } catch ( error ) {
        close_output_sources()
        if( !finalized ) await output.cancel().catch( ( cancel_error ) => {
            log.warn( `Could not cancel failed lossless export`, cancel_error )
        } )

        throw error
    }
}

/**
 * Explains whether remux export is worth attempting from cheap metadata.
 * @param {Object} options - Export inputs.
 * @param {Array<Object>} options.clips - Clip metadata in queue order.
 * @param {Object} options.settings - Normalized export settings.
 * @returns {Object} Attempt decision and reason when disabled.
 */
export function can_attempt_remux_export( { clips, settings } ) {
    if( settings.export_resolution !== REMUXABLE_EXPORT_RESOLUTION ) {
        return {
            ok: false,
            reason: `Export resolution changes require the canvas exporter.`
        }
    }

    const container = get_metadata_container( clips )
    if( !container ) {
        return {
            ok: false,
            reason: `Clip containers are unknown or mixed.`
        }
    }

    if( !preferred_mime_matches_container( settings, container ) ) {
        return {
            ok: false,
            reason: `Selected export MIME type does not match the recorded clips.`
        }
    }

    return {
        container,
        ok: true,
        reason: null
    }
}

/**
 * Checks whether an error means the remux path should fall back to canvas export.
 * @param {Error} error - Error thrown while preparing a remux export.
 * @returns {boolean} Whether the remuxer declined this export.
 */
export function is_remux_unavailable_error( error ) {
    return error instanceof RemuxUnavailableError || error?.name === `RemuxUnavailableError`
}

/**
 * Compiles clips into a single output by copying encoded packets into a new container.
 * @param {Object} options - Compile options.
 * @param {Array<Object>} options.clips - Clip metadata in queue order.
 * @param {Object} options.settings - Normalized export settings.
 * @param {AbortSignal} options.signal - Cancellation signal.
 * @param {Function} options.on_progress - Progress callback.
 * @returns {Promise<Object>} Export blob, MIME type, duration, and warnings.
 */
export async function compile_project_remux_export( { clips, settings, signal, on_progress } ) {
    const attempt = can_attempt_remux_export( { clips, settings } )
    if( !attempt.ok ) throw remux_unavailable( attempt.reason )

    const remux_inputs = []
    const mediabunny = await load_mediabunny()

    try {
        await clips.reduce( async ( previous_clip, clip, clip_index ) => {
            await previous_clip
            throw_if_aborted( signal )

            const blob = await get_clip_blob_or_fail( clip, clip_index )

            remux_inputs.push( await inspect_remux_input( {
                blob,
                clip,
                clip_index,
                mediabunny,
                signal
            } ) )
        }, Promise.resolve() )

        log.info( `Lossless remux export started`, {
            clip_count: clips.length,
            container: attempt.container.key
        } )

        const result = await write_remuxed_output( {
            mediabunny,
            remux_inputs,
            settings,
            signal,
            on_progress
        } )

        log.info( `Lossless remux export finished`, {
            clip_count: clips.length,
            duration_ms: result.duration_ms,
            mime_type: result.mime_type,
            size: result.blob.size
        } )

        return result
    } finally {
        dispose_inputs( remux_inputs )
    }
}
