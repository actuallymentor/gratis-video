import { log } from 'mentie/modules/logging.js'
import { get_clip_blob } from '../storage/journal_storage.js'
import { stop_media_stream } from '../media/recorder.js'
import {
    export_quality_bits,
    export_resolution_limits,
    get_export_support_message,
    get_supported_export_mime_types
} from './settings.js'
import {
    can_attempt_remux_export,
    compile_project_remux_export,
    is_remux_unavailable_error
} from './remuxer.js'

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
const PLAYBACK_RECOVERY_ATTEMPTS = 2
const END_OF_CLIP_TOLERANCE_SECONDS = 0.2
const HAVE_CURRENT_DATA = 2
const EXPORT_RECORDER_STOP_TIMEOUT_MS = 5_000
const VIDEO_FRAME_CALLBACK_TIMEOUT_MS = 500

const make_abort_error = () => new DOMException( `Export cancelled`, `AbortError` )

const throw_if_aborted = ( signal ) => {
    if( signal?.aborted ) throw make_abort_error()
}

const wait_for_events = ( target, event_names, signal, {
    timeout_message = `Media playback stalled while preparing export.`
} = {} ) => new Promise( ( resolve, reject ) => {
    let complete = null
    let fail = null
    let abort = null
    let timeout_id = null
    const cleanup = () => {
        clearTimeout( timeout_id )
        event_names.forEach( ( event_name ) => target.removeEventListener( event_name, complete ) )
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
        reject( new Error( timeout_message ) )
    }, MEDIA_EVENT_TIMEOUT_MS )

    if( signal?.aborted ) {
        abort()
        return
    }

    event_names.forEach( ( event_name ) => target.addEventListener( event_name, complete, { once: true } ) )
    target.addEventListener( `error`, fail, { once: true } )
    signal?.addEventListener( `abort`, abort, { once: true } )
} )

const wait_for_event = ( target, event_name, signal ) => wait_for_events( target, [ event_name ], signal )

const get_expected_clip_end_seconds = ( { clip, video } ) => {
    if( Number.isFinite( video.duration ) && video.duration > 0 ) return video.duration
    if( clip.duration_ms > 0 ) return clip.duration_ms / 1000

    return null
}

const is_clip_at_export_end = ( { clip, video } ) => {
    if( video.ended ) return true

    const expected_end_seconds = get_expected_clip_end_seconds( { clip, video } )
    if( !expected_end_seconds ) return false

    return video.currentTime >= Math.max( 0, expected_end_seconds - END_OF_CLIP_TOLERANCE_SECONDS )
}

const reset_playback_progress = ( { playback_progress, timestamp, video } ) => {
    playback_progress.last_time = video.currentTime
    playback_progress.last_progress_at = timestamp
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

const is_autoplay_block_error = ( error ) => {
    const message = error?.message ?? ``

    return error?.name === `NotAllowedError`
        || message.toLowerCase().includes( `autoplay` )
        || message.includes( `disableAutoplay` )
}

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
        fail,
        stopped
    }
}

const next_video_frame = ( video, signal ) => new Promise( ( resolve, reject ) => {
    let settled = false
    let timeout_id = null
    let frame_id = null
    let animation_frame_id = null
    let abort = null

    const cleanup = () => {
        if( timeout_id ) clearTimeout( timeout_id )
        if( frame_id !== null ) video.cancelVideoFrameCallback?.( frame_id )
        if( animation_frame_id !== null ) globalThis.cancelAnimationFrame?.( animation_frame_id )
        signal?.removeEventListener( `abort`, abort )
    }

    const finish = ( timestamp = performance.now() ) => {
        if( settled ) return

        settled = true
        cleanup()
        resolve( timestamp )
    }

    abort = () => {
        if( settled ) return

        settled = true
        cleanup()
        reject( make_abort_error() )
    }

    if( signal?.aborted ) {
        abort()
        return
    }

    signal?.addEventListener( `abort`, abort, { once: true } )

    if( video.requestVideoFrameCallback ) {
        frame_id = video.requestVideoFrameCallback( ( timestamp ) => finish( timestamp ) )

        // A decode stall can mean no video-frame callback arrives. Let the
        // export loop advance so its existing recovery checks can run.
        timeout_id = setTimeout( () => finish(), VIDEO_FRAME_CALLBACK_TIMEOUT_MS )
        return
    }

    animation_frame_id = requestAnimationFrame( finish )
} )

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
        return { muted_for_playback: false }
    } catch ( error ) {
        if( !is_autoplay_block_error( error ) ) throw error

        // Browser and extension autoplay blockers do not agree on error names.
        // A muted retry keeps detached export playback moving when audible playback is blocked.
        log.warn( `Export playback was blocked; retrying muted playback`, error )
        throw_if_aborted( signal )
        video.muted = true
        await wait_for_abortable( video.play(), signal )
        return { muted_for_playback: true }
    }
}

const retry_stalled_playback_muted = async ( { playback_state, signal, video } ) => {
    if( video.ended ) return

    try {
        video.pause?.()
    } catch {
        // Some media elements throw on pause during decode stalls; playback retry can continue.
    }

    log.warn( `Export playback stalled; retrying muted playback` )
    throw_if_aborted( signal )
    video.muted = true
    await wait_for_abortable( video.play(), signal )
    playback_state.muted_for_playback = true
}

const recover_playback = async ( {
    clip_index,
    playback_progress,
    playback_state,
    signal,
    timestamp,
    video
} ) => {
    if( globalThis.document?.hidden ) {
        reset_playback_progress( { playback_progress, timestamp, video } )
        return
    }

    playback_progress.recovery_attempts += 1
    log.debug( `Export playback recovery attempt`, {
        clip_index,
        attempt: playback_progress.recovery_attempts,
        current_time: video.currentTime,
        ready_state: video.readyState,
        paused: video.paused,
        ended: video.ended
    } )

    if( playback_progress.recovery_attempts > PLAYBACK_RECOVERY_ATTEMPTS ) {
        log.error( `Export playback recovery exhausted`, {
            clip_index,
            current_time: video.currentTime,
            ready_state: video.readyState
        } )
        throw new Error( `Clip ${ clip_index + 1 } stalled during export.` )
    }

    if( Number.isFinite( video.readyState ) && video.readyState < HAVE_CURRENT_DATA ) {
        await wait_for_events(
            video,
            [ `loadeddata`, `canplay`, `playing`, `timeupdate` ],
            signal,
            { timeout_message: `Clip playback stalled during export.` }
        ).catch( () => null )
    }

    if( video.paused && !video.ended ) {
        const retry_state = await start_video_playback( video, signal )
        playback_state.muted_for_playback ||= retry_state.muted_for_playback
    } else if( !video.ended ) {
        await retry_stalled_playback_muted( {
            playback_state,
            signal,
            video
        } )
    }

    reset_playback_progress( { playback_progress, timestamp: performance.now(), video } )
}

const ensure_playback_is_moving = async ( {
    clip,
    clip_index,
    video,
    playback_progress,
    playback_state,
    signal,
    timestamp
} ) => {
    if( is_clip_at_export_end( { clip, video } ) ) return true

    const advanced = video.currentTime > playback_progress.last_time + 0.04

    if( advanced ) {
        playback_progress.last_time = video.currentTime
        playback_progress.last_progress_at = timestamp
        playback_progress.recovery_attempts = 0
        return false
    }

    if( timestamp - playback_progress.last_progress_at <= PLAYBACK_STALL_TIMEOUT_MS ) return false

    await recover_playback( {
        clip_index,
        playback_progress,
        playback_state,
        signal,
        timestamp,
        video
    } )

    if( is_clip_at_export_end( { clip, video } ) ) return true

    return false
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

const create_mime_attempts = ( settings ) => {
    const supported_mime_types = get_supported_export_mime_types()
    const preferred_mime_type = supported_mime_types.includes( settings.preferred_mime_type )
        ? settings.preferred_mime_type
        : supported_mime_types.at( 0 ) ?? null
    const attempts = [
        preferred_mime_type,
        ...supported_mime_types.filter( ( mime_type ) => mime_type !== preferred_mime_type ),
        null
    ]

    return attempts.filter( ( mime_type, index ) => attempts.indexOf( mime_type ) === index )
}

const start_export_recorder = ( { stream, settings, signal } ) => {
    const attempts = create_mime_attempts( settings )
    const errors = []

    log.debug( `Export recorder MIME attempts prepared`, {
        attempts: attempts.map( ( mime_type ) => mime_type ?? `browser-default` )
    } )

    const start_next_attempt = ( mime_type ) => {
        const chunks = []
        let recorder = null
        let stop_wait = null

        try {
            throw_if_aborted( signal )
            log.debug( `Export recorder start attempt`, {
                mime_type: mime_type ?? `browser-default`
            } )
            recorder = create_export_recorder( { stream, mime_type, settings } )
            stop_wait = wait_for_recorder_stop( recorder, chunks, signal )
            stop_wait.stopped.catch( () => null )
            throw_if_aborted( signal )
            recorder.start()

            log.info( `Export recorder started`, {
                requested_mime_type: mime_type ?? null,
                recorder_mime_type: recorder.mimeType || null
            } )

            return {
                recorder,
                chunks,
                mime_type,
                ...stop_wait
            }
        } catch ( error ) {
            stop_wait?.fail( error )

            try {
                if( recorder?.state && recorder.state !== `inactive` ) recorder.stop()
            } catch {
                // The next MIME attempt can still succeed even if cleanup fails.
            }

            throw error
        }
    }

    const started_attempt = attempts.reduce( ( started, mime_type ) => {
        if( started ) return started

        try {
            return start_next_attempt( mime_type )
        } catch ( error ) {
            log.warn( `Export recorder start attempt failed`, {
                mime_type: mime_type ?? `browser-default`,
                error
            } )
            errors.push( error )
            return null
        }
    }, null )

    if( started_attempt ) return started_attempt
    if( signal?.aborted ) throw make_abort_error()
    log.error( `Export recorder failed all MIME attempts`, errors )
    throw errors.at( -1 ) ?? new Error( `Export recorder failed.` )
}

const cleanup_video = ( video, object_url ) => {
    video.pause()
    video.removeAttribute( `src` )
    video.load()
    URL.revokeObjectURL( object_url )
}

const attach_export_video = ( video ) => {
    if( !globalThis.document?.body?.append || !video.style ) return () => {}

    video.setAttribute( `aria-hidden`, `true` )
    video.tabIndex = -1
    video.style.position = `fixed`
    video.style.left = `0`
    video.style.top = `0`
    video.style.width = `1px`
    video.style.height = `1px`
    video.style.opacity = `0`
    video.style.pointerEvents = `none`

    document.body.append( video )

    return () => video.remove()
}

const missing_clip_blob_error = ( clip_index ) => {
    return new Error( `Clip ${ clip_index + 1 } is missing from local storage. Export stopped to avoid creating an incomplete video.` )
}

const get_clip_blob_or_fail = async ( clip, clip_index ) => {
    const blob = await get_clip_blob( clip.id )
    if( !blob ) throw missing_clip_blob_error( clip_index )

    return blob
}

const read_blob_video_metadata = async ( { blob, signal } ) => {
    const object_url = URL.createObjectURL( blob )
    const video = document.createElement( `video` )

    try {
        video.playsInline = true
        video.preload = `metadata`
        video.src = object_url
        await wait_for_event( video, `loadedmetadata`, signal )

        return {
            duration_ms: Number.isFinite( video.duration ) ? Math.round( video.duration * 1000 ) : 0,
            width: video.videoWidth || null,
            height: video.videoHeight || null
        }
    } finally {
        cleanup_video( video, object_url )
    }
}

const with_first_clip_canvas_metadata = async ( clips, signal ) => {
    const [ first_clip ] = clips

    if( !first_clip ||  first_clip.width && first_clip.height  ) return clips

    const blob = await get_clip_blob_or_fail( first_clip, 0 )
    throw_if_aborted( signal )

    const metadata = await read_blob_video_metadata( { blob, signal } ).catch( () => null )

    if( !metadata?.width || !metadata?.height ) return clips

    const measured_first_clip = {
        ...first_clip,
        duration_ms: first_clip.duration_ms || metadata.duration_ms,
        width: metadata.width,
        height: metadata.height
    }

    return [
        measured_first_clip,
        ...clips.slice( 1 )
    ]
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

    log.info( `Export clip started`, {
        clip_index: clip_index + 1,
        clip_count: clips.length,
        clip_id: clip.id,
        duration_ms: clip.duration_ms
    } )
    const blob = await get_clip_blob_or_fail( clip, clip_index )
    log.debug( `Export clip blob loaded`, {
        clip_index: clip_index + 1,
        clip_id: clip.id,
        size: blob.size,
        mime_type: blob.type || clip.mime_type
    } )
    log.insane( `Export clip payload`, {
        clip,
        blob: {
            size: blob.size,
            type: blob.type
        }
    } )
    throw_if_aborted( signal )

    const object_url = URL.createObjectURL( blob )
    const video = document.createElement( `video` )
    const detach_video = attach_export_video( video )
    let audio_source = null

    try {
        video.playsInline = true
        video.preload = `auto`
        video.src = object_url
        await wait_for_event( video, `loadedmetadata`, signal )
        audio_source = connect_video_audio( audio_graph, video )
        if( !audio_source ) video.muted = true

        const measured_duration_ms = Number.isFinite( video.duration ) ? Math.round( video.duration * 1000 ) : 0
        const duration_ms = clip.duration_ms || measured_duration_ms
        const project_duration_ms = clips.reduce( ( total, next_clip ) => total + ( next_clip.duration_ms || 0 ), 0 ) || 1
        const previous_duration_ms = clips.slice( 0, clip_index ).reduce( ( total, next_clip ) => {
            return total + ( next_clip.duration_ms || 0 )
        }, 0 )

        log.debug( `Export clip metadata loaded`, {
            clip_index: clip_index + 1,
            measured_duration_ms,
            duration_ms,
            width: video.videoWidth || null,
            height: video.videoHeight || null,
            audio_routed: Boolean( audio_source )
        } )

        const playback_state = await start_video_playback( video, signal )

        const playback_progress = {
            last_time: -1,
            last_progress_at: performance.now(),
            recovery_attempts: 0
        }

        while( !is_clip_at_export_end( { clip, video } ) ) {
            throw_if_aborted( signal )
            const timestamp = performance.now()

            draw_video_frame( context, video, canvas )
            const reached_end = await ensure_playback_is_moving( {
                clip,
                clip_index,
                video,
                playback_progress,
                playback_state,
                signal,
                timestamp
            } )
            if( reached_end ) break

            const current_clip_ms = Math.min( duration_ms, Math.round( video.currentTime * 1000 ) )
            const completed_ms = previous_duration_ms + current_clip_ms
            const percent = Math.min( 99, Math.round(  completed_ms / project_duration_ms  * 100 ) )
            on_progress?.( {
                percent,
                message: `Exporting clip ${ clip_index + 1 } of ${ clips.length }`
            } )

            await next_video_frame( video, signal )
        }

        draw_video_frame( context, video, canvas )
        log.info( `Export clip finished`, {
            clip_index: clip_index + 1,
            clip_id: clip.id,
            muted_for_playback: playback_state.muted_for_playback,
            audio_routed: Boolean( audio_source )
        } )
        return {
            audio_routed: Boolean( audio_source ),
            muted_for_playback: playback_state.muted_for_playback
        }
    } finally {
        try {
            audio_source?.disconnect?.()
        } catch {
            // The video element and object URL still need cleanup if audio teardown fails.
        }

        detach_video()
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
async function compile_project_canvas_export( { clips, settings, signal, on_progress } ) {
    if( !clips.length ) throw new Error( `Record at least one clip before exporting.` )
    const export_support_message = get_export_support_message()
    if( export_support_message ) throw new Error( export_support_message )
    throw_if_aborted( signal )

    log.info( `Project export compile started`, {
        clip_count: clips.length,
        export_quality: settings.export_quality,
        export_resolution: settings.export_resolution,
        preferred_mime_type: settings.preferred_mime_type ?? null
    } )
    log.insane( `Project export input payload`, {
        clips,
        settings
    } )

    const export_clips = await with_first_clip_canvas_metadata( clips, signal )
    throw_if_aborted( signal )

    const { width, height } = calculate_export_canvas_size( export_clips, settings )
    const canvas = document.createElement( `canvas` )
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext( `2d` )
    if( !context ) throw new Error( `This browser cannot draw video frames for export.` )

    log.debug( `Project export canvas prepared`, {
        width,
        height,
        fps: FPS
    } )

    const video_stream = canvas.captureStream( FPS )
    let audio_graph = await resume_audio_graph( create_audio_graph() )
    const audio_warnings = audio_graph ? [] : [
        `This browser could not route clip audio into the export, so the export may be video-only.`
    ]
    if( !audio_graph ) log.warn( `Export audio graph unavailable; export may be video-only` )
    const audio_tracks = audio_graph?.destination.stream.getAudioTracks() ?? []
    const mixed_stream = new MediaStream( [
        ...video_stream.getVideoTracks(),
        ...audio_tracks
    ] )
    let recorder = null
    let chunks = []
    let mime_type = null

    try {
        const {
            arm_stop_timeout,
            chunks: export_chunks,
            mime_type: started_mime_type,
            recorder: export_recorder,
            stopped
        } = start_export_recorder( {
            stream: mixed_stream,
            settings,
            signal
        } )

        recorder = export_recorder
        chunks = export_chunks
        mime_type = started_mime_type
        on_progress?.( { percent: 1, message: `Preparing export` } )

        const playback_results = []

        await export_clips.reduce( async ( previous_clip, clip, clip_index ) => {
            await previous_clip
            const playback_result = await play_clip_to_canvas( {
                clip,
                clip_index,
                clips: export_clips,
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
        if( audio_graph && playback_results.some( ( { muted_for_playback } ) => muted_for_playback ) ) {
            audio_warnings.push( `This browser muted clip playback to finish the export, so the export may be video-only.` )
        }

        recorder.stop()
        arm_stop_timeout()
        const stop_result = await stopped
        on_progress?.( { percent: 100, message: `Export ready` } )

        if( stop_result.timed_out ) {
            log.warn( `Export recorder stop timed out after producing data` )
            audio_warnings.push( `This browser did not confirm export finalization. Check the exported video before deleting clips.` )
        }

        const output_type = recorder.mimeType || chunks.at( 0 )?.type || mime_type || `video/webm`
        const blob = new Blob( chunks, { type: output_type } )
        const duration_ms = export_clips.reduce( ( total, clip ) => total + ( clip.duration_ms || 0 ), 0 )

        if( chunks.length === 0 || blob.size === 0 ) {
            throw new Error( `Export failed because this browser did not produce a video file.` )
        }

        log.info( `Project export compile finished`, {
            clip_count: export_clips.length,
            duration_ms,
            size: blob.size,
            mime_type: output_type,
            warning_count: audio_warnings.length
        } )

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

/**
 * Compiles project clips into a single video blob, preferring lossless remuxing.
 * @param {Object} options - Compile options.
 * @param {Array<Object>} options.clips - Clip metadata in queue order.
 * @param {Object} options.settings - Export settings.
 * @param {AbortSignal} options.signal - Cancellation signal.
 * @param {Function} options.on_progress - Progress callback.
 * @returns {Promise<Object>} Export blob, MIME type, and duration.
 */
export async function compile_project_export( { clips, settings, signal, on_progress } ) {
    if( !clips.length ) throw new Error( `Record at least one clip before exporting.` )
    throw_if_aborted( signal )

    const remux_attempt = can_attempt_remux_export( { clips, settings } )

    if( remux_attempt.ok ) {
        try {
            return await compile_project_remux_export( {
                clips,
                settings,
                signal,
                on_progress
            } )
        } catch ( error ) {
            if( error?.name === `AbortError` ) throw error

            if( is_remux_unavailable_error( error ) ) {
                log.debug( `Lossless remux unavailable; falling back to canvas export`, {
                    reason: error.message
                } )
            } else {
                log.warn( `Lossless remux failed; falling back to canvas export`, error )
            }
        }
    } else {
        log.debug( `Lossless remux skipped`, {
            reason: remux_attempt.reason
        } )
    }

    return compile_project_canvas_export( {
        clips,
        settings,
        signal,
        on_progress
    } )
}
