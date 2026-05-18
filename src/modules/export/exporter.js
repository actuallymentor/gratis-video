import { get_clip_blob } from '../storage/journal_storage.js'
import { stop_media_stream } from '../media/recorder.js'
import {
    choose_export_mime_type,
    export_quality_bits,
    export_resolution_limits,
    get_export_support_message
} from './settings.js'

export {
    can_compile_project_exports,
    export_resolution_options,
    get_export_support_message,
    get_supported_export_mime_types,
    get_supported_export_resolutions,
    normalize_export_settings
} from './settings.js'

const FPS = 30
const MEDIA_EVENT_TIMEOUT_MS = 8_000
const PLAYBACK_STALL_TIMEOUT_MS = 8_000
const EXPORT_RECORDER_STOP_TIMEOUT_MS = 5_000

const make_abort_error = () => new DOMException( `Export cancelled`, `AbortError` )

const throw_if_aborted = ( signal ) => {
    if( signal?.aborted ) throw make_abort_error()
}

const wait_for_event = ( target, event_name, signal ) => new Promise( ( resolve, reject ) => {
    let complete = null
    let fail = null
    let abort = null
    let timeout_id = null
    const cleanup = () => {
        clearTimeout( timeout_id )
        target.removeEventListener( event_name, complete )
        target.removeEventListener( `error`, fail )
        signal?.removeEventListener( `abort`, abort )
    }
    complete = () => {
        cleanup()
        resolve()
    }
    fail = () => {
        cleanup()
        reject( new Error( `Media playback failed.` ) )
    }
    abort = () => {
        cleanup()
        reject( make_abort_error() )
    }
    timeout_id = setTimeout( () => {
        cleanup()
        reject( new Error( `Media playback stalled while preparing export.` ) )
    }, MEDIA_EVENT_TIMEOUT_MS )

    if( signal?.aborted ) {
        abort()
        return
    }

    target.addEventListener( event_name, complete, { once: true } )
    target.addEventListener( `error`, fail, { once: true } )
    signal?.addEventListener( `abort`, abort, { once: true } )
} )

const assert_playback_is_moving = ( {
    clip_index,
    video,
    playback_progress,
    timestamp
} ) => {
    const advanced = video.currentTime > playback_progress.last_time + 0.04

    if( advanced ) {
        playback_progress.last_time = video.currentTime
        playback_progress.last_progress_at = timestamp
        return
    }

    if( timestamp - playback_progress.last_progress_at <= PLAYBACK_STALL_TIMEOUT_MS ) return

    throw new Error( `Clip ${ clip_index + 1 } stopped playing during export.` )
}

const wait_for_abortable = ( promise, signal ) => new Promise( ( resolve, reject ) => {
    const abort = () => reject( make_abort_error() )
    const cleanup = () => signal?.removeEventListener( `abort`, abort )

    if( signal?.aborted ) {
        reject( make_abort_error() )
        return
    }

    signal?.addEventListener( `abort`, abort, { once: true } )
    Promise.resolve( promise ).then( resolve, reject ).finally( cleanup )
} )

const wait_for_recorder_stop = ( recorder, chunks, signal ) => {
    let settled = false
    let timeout_id = null
    let arm_stop_timeout = null
    let finish = null
    let fail = null
    const abort = () => fail( make_abort_error() )

    const cleanup = () => {
        clearTimeout( timeout_id )
        recorder.ondataavailable = null
        recorder.onerror = null
        recorder.onstop = null
        signal?.removeEventListener( `abort`, abort )
    }

    const stopped = new Promise( ( resolve, reject ) => {
        finish = ( result = { timed_out: false } ) => {
            if( settled ) return

            settled = true
            cleanup()
            resolve( result )
        }

        fail = ( error ) => {
            if( settled ) return

            settled = true
            cleanup()
            reject( error )
        }
    } )

    arm_stop_timeout = () => {
        if( settled || timeout_id ) return

        timeout_id = setTimeout( () => {
            if( chunks.length ) {
                finish( { timed_out: true } )
                return
            }

            fail( new Error( `Export recorder stopped before this browser produced video data.` ) )
        }, EXPORT_RECORDER_STOP_TIMEOUT_MS )
    }

    recorder.ondataavailable = ( event ) => {
        if( event.data?.size > 0 ) chunks.push( event.data )
    }
    recorder.onerror = () => fail( recorder.error ?? new Error( `Export recorder failed.` ) )
    recorder.onstop = () => finish()

    if( signal?.aborted ) abort()
    else signal?.addEventListener( `abort`, abort, { once: true } )

    return {
        arm_stop_timeout,
        stopped
    }
}

const next_animation_frame = () => new Promise( ( resolve ) => requestAnimationFrame( resolve ) )

const orient_resolution_limit = ( limit, { width, height } ) => {
    if( !limit || height <= width ) return limit

    return {
        width: limit.height,
        height: limit.width
    }
}

/**
 * Calculates the export canvas size without upscaling or changing orientation.
 * @param {Array<Object>} clips - Clip metadata in queue order.
 * @param {Object} settings - Export settings.
 * @returns {Object} Canvas width and height.
 */
export function calculate_export_canvas_size( clips, settings ) {
    const source_width = clips.find( ( clip ) => clip.width )?.width ?? 1280
    const source_height = clips.find( ( clip ) => clip.height )?.height ?? 720
    const limit = orient_resolution_limit( export_resolution_limits[ settings.export_resolution ], {
        width: source_width,
        height: source_height
    } )

    if( !limit ) return { width: source_width, height: source_height }

    const scale = Math.min( 1, limit.width / source_width, limit.height / source_height )

    return {
        width: Math.max( 1, Math.round( source_width * scale ) ),
        height: Math.max( 1, Math.round( source_height * scale ) )
    }
}

const draw_video_frame = ( context, video, canvas ) => {
    const video_ratio = ( video.videoWidth || canvas.width ) / ( video.videoHeight || canvas.height )
    const canvas_ratio = canvas.width / canvas.height
    const draw_width = video_ratio > canvas_ratio ? canvas.width : canvas.height * video_ratio
    const draw_height = video_ratio > canvas_ratio ? canvas.width / video_ratio : canvas.height
    const draw_x = ( canvas.width - draw_width ) / 2
    const draw_y = ( canvas.height - draw_height ) / 2

    context.fillStyle = `#0d1718`
    context.fillRect( 0, 0, canvas.width, canvas.height )
    context.drawImage( video, draw_x, draw_y, draw_width, draw_height )
}

const create_audio_graph = () => {
    const AudioContextConstructor = globalThis.AudioContext || globalThis.webkitAudioContext
    if( !AudioContextConstructor ) return null

    try {
        const audio_context = new AudioContextConstructor()
        const destination = audio_context.createMediaStreamDestination()

        return {
            audio_context,
            destination
        }
    } catch {
        return null
    }
}

const resume_audio_graph = async ( audio_graph ) => {
    if( !audio_graph ) return null

    try {
        if( audio_graph.audio_context.state === `suspended` ) await audio_graph.audio_context.resume()
        return audio_graph
    } catch {
        try {
            await audio_graph.audio_context.close?.()
        } catch {
            // Export can continue silently when Web Audio is blocked.
        }

        return null
    }
}

const connect_video_audio = ( audio_graph, video ) => {
    if( !audio_graph ) return null

    try {
        const source = audio_graph.audio_context.createMediaElementSource( video )
        source.connect( audio_graph.destination )
        return source
    } catch {
        // Some browsers restrict media element routing. Export can still complete as silent video.
        return null
    }
}

const start_video_playback = async ( video, signal ) => {
    try {
        await wait_for_abortable( video.play(), signal )
    } catch ( error ) {
        if( error.name !== `NotAllowedError` ) throw error

        // Mobile autoplay rules can reject detached videos after React effects.
        // A muted retry keeps export moving even when the browser will not play audible media.
        throw_if_aborted( signal )
        video.muted = true
        await wait_for_abortable( video.play(), signal )
    }
}

const create_export_recorder = ( { stream, mime_type, settings } ) => {
    const base_options = {
        videoBitsPerSecond: export_quality_bits[ settings.export_quality ] ?? export_quality_bits.standard
    }
    const recorder_options = mime_type
        ? { ...base_options, mimeType: mime_type }
        : base_options

    try {
        return new MediaRecorder( stream, recorder_options )
    } catch ( error ) {
        if( mime_type ) return new MediaRecorder( stream, base_options )
        throw error
    }
}

const cleanup_video = ( video, object_url ) => {
    video.pause()
    video.removeAttribute( `src` )
    video.load()
    URL.revokeObjectURL( object_url )
}

const play_clip_to_canvas = async ( {
    clip,
    clip_index,
    clips,
    canvas,
    context,
    audio_graph,
    signal,
    on_progress
} ) => {
    throw_if_aborted( signal )

    const blob = await get_clip_blob( clip.id )
    if( !blob ) throw new Error( `Clip ${ clip_index + 1 } is missing from local storage. Export stopped to avoid creating an incomplete video.` )
    throw_if_aborted( signal )

    const object_url = URL.createObjectURL( blob )
    const video = document.createElement( `video` )
    let audio_source = null

    try {
        video.src = object_url
        video.playsInline = true
        video.preload = `auto`
        await wait_for_event( video, `loadedmetadata`, signal )
        audio_source = connect_video_audio( audio_graph, video )
        if( !audio_source ) video.muted = true

        const duration_ms = clip.duration_ms || Math.round( ( video.duration || 0 ) * 1000 )
        const project_duration_ms = clips.reduce( ( total, next_clip ) => total + ( next_clip.duration_ms || 0 ), 0 ) || 1
        const previous_duration_ms = clips.slice( 0, clip_index ).reduce( ( total, next_clip ) => {
            return total + ( next_clip.duration_ms || 0 )
        }, 0 )

        await start_video_playback( video, signal )

        const playback_progress = {
            last_time: -1,
            last_progress_at: performance.now()
        }

        while( !video.ended ) {
            throw_if_aborted( signal )
            const timestamp = performance.now()

            draw_video_frame( context, video, canvas )
            assert_playback_is_moving( {
                clip_index,
                video,
                playback_progress,
                timestamp
            } )

            const current_clip_ms = Math.min( duration_ms, Math.round( video.currentTime * 1000 ) )
            const completed_ms = previous_duration_ms + current_clip_ms
            const percent = Math.min( 99, Math.round(  completed_ms / project_duration_ms  * 100 ) )
            on_progress?.( {
                percent,
                message: `Exporting clip ${ clip_index + 1 } of ${ clips.length }`
            } )

            if(
                Number.isFinite( video.duration )
                && video.duration > 0
                && video.currentTime >= video.duration - 0.04
            ) break

            await next_animation_frame()
        }

        draw_video_frame( context, video, canvas )
        return {
            audio_routed: Boolean( audio_source )
        }
    } finally {
        try {
            audio_source?.disconnect?.()
        } catch {
            // The video element and object URL still need cleanup if audio teardown fails.
        }

        cleanup_video( video, object_url )
    }
}

/**
 * Compiles project clips into a single video blob using browser-native media APIs.
 * @param {Object} options - Compile options.
 * @param {Array<Object>} options.clips - Clip metadata in queue order.
 * @param {Object} options.settings - Export settings.
 * @param {AbortSignal} options.signal - Cancellation signal.
 * @param {Function} options.on_progress - Progress callback.
 * @returns {Promise<Object>} Export blob, MIME type, and duration.
 */
export async function compile_project_export( { clips, settings, signal, on_progress } ) {
    if( !clips.length ) throw new Error( `Record at least one clip before exporting.` )
    const export_support_message = get_export_support_message()
    if( export_support_message ) throw new Error( export_support_message )
    throw_if_aborted( signal )

    const { width, height } = calculate_export_canvas_size( clips, settings )
    const canvas = document.createElement( `canvas` )
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext( `2d` )
    const video_stream = canvas.captureStream( FPS )
    let audio_graph = await resume_audio_graph( create_audio_graph() )
    const audio_warnings = audio_graph ? [] : [
        `This browser could not route clip audio into the export, so the export may be video-only.`
    ]
    const audio_tracks = audio_graph?.destination.stream.getAudioTracks() ?? []
    const mixed_stream = new MediaStream( [
        ...video_stream.getVideoTracks(),
        ...audio_tracks
    ] )
    const mime_type = choose_export_mime_type( settings )
    const chunks = []
    let recorder = null

    try {
        recorder = create_export_recorder( { stream: mixed_stream, mime_type, settings } )
        const {
            arm_stop_timeout,
            stopped
        } = wait_for_recorder_stop( recorder, chunks, signal )
        stopped.catch( () => null )

        throw_if_aborted( signal )

        recorder.start( 250 )
        on_progress?.( { percent: 1, message: `Preparing export` } )

        const playback_results = []

        await clips.reduce( async ( previous_clip, clip, clip_index ) => {
            await previous_clip
            const playback_result = await play_clip_to_canvas( {
                clip,
                clip_index,
                clips,
                canvas,
                context,
                audio_graph,
                signal,
                on_progress
            } )
            playback_results.push( playback_result )
        }, Promise.resolve() )

        if( audio_graph && playback_results.some( ( { audio_routed } ) => !audio_routed ) ) {
            audio_warnings.push( `This browser could not route audio from every clip, so the export may be video-only.` )
        }

        recorder.stop()
        arm_stop_timeout()
        const stop_result = await stopped
        on_progress?.( { percent: 100, message: `Export ready` } )

        if( stop_result.timed_out ) {
            audio_warnings.push( `This browser did not confirm export finalization. Check the exported video before deleting clips.` )
        }

        const output_type = recorder.mimeType || mime_type || chunks.at( 0 )?.type || `video/webm`
        const blob = new Blob( chunks, { type: output_type } )
        const duration_ms = clips.reduce( ( total, clip ) => total + ( clip.duration_ms || 0 ), 0 )

        if( chunks.length === 0 || blob.size === 0 ) {
            throw new Error( `Export failed because this browser did not produce a video file.` )
        }

        return {
            blob,
            mime_type: output_type,
            duration_ms,
            warnings: [ ...new Set( audio_warnings ) ]
        }
    } finally {
        if( recorder && recorder.state !== `inactive` ) recorder.stop()
        stop_media_stream( video_stream )
        stop_media_stream( mixed_stream )
        await audio_graph?.audio_context.close?.()
    }
}
