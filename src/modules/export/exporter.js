import { get_clip_blob } from '../storage/journal_storage.js'
import { recording_mime_candidates, select_supported_mime_type, stop_media_stream } from '../media/recorder.js'

const FPS = 30

const quality_bits = {
    standard: 2_500_000,
    high: 5_500_000
}

const resolution_limits = {
    source: null,
    '720p': { width: 1280, height: 720 },
    '1080p': { width: 1920, height: 1080 }
}

export const export_resolution_options = [
    { value: `source`, label: `Source` },
    { value: `720p`, label: `720p` },
    { value: `1080p`, label: `1080p` }
]

const make_abort_error = () => new DOMException( `Export cancelled`, `AbortError` )

const throw_if_aborted = ( signal ) => {
    if( signal?.aborted ) throw make_abort_error()
}

const wait_for_event = ( target, event_name, signal ) => new Promise( ( resolve, reject ) => {
    let complete = null
    let fail = null
    let abort = null
    const cleanup = () => {
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

    if( signal?.aborted ) {
        abort()
        return
    }

    target.addEventListener( event_name, complete, { once: true } )
    target.addEventListener( `error`, fail, { once: true } )
    signal?.addEventListener( `abort`, abort, { once: true } )
} )

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

const wait_for_recorder_stop = ( recorder, chunks ) => new Promise( ( resolve, reject ) => {
    recorder.ondataavailable = ( event ) => {
        if( event.data?.size > 0 ) chunks.push( event.data )
    }
    recorder.onerror = () => reject( recorder.error ?? new Error( `Export recorder failed.` ) )
    recorder.onstop = () => resolve()
} )

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
    const limit = orient_resolution_limit( resolution_limits[ settings.export_resolution ], {
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

const choose_export_mime_type = ( settings ) => {
    const preferred = settings.preferred_mime_type

    if( preferred && globalThis.MediaRecorder?.isTypeSupported?.( preferred ) ) return preferred
    return select_supported_mime_type( recording_mime_candidates )
}

const create_audio_graph = () => {
    const AudioContextConstructor = globalThis.AudioContext || globalThis.webkitAudioContext
    if( !AudioContextConstructor ) return null

    const audio_context = new AudioContextConstructor()
    const destination = audio_context.createMediaStreamDestination()

    return {
        audio_context,
        destination,
        sources: []
    }
}

const connect_video_audio = ( audio_graph, video ) => {
    if( !audio_graph ) return false

    try {
        const source = audio_graph.audio_context.createMediaElementSource( video )
        source.connect( audio_graph.destination )
        audio_graph.sources.push( source )
        return true
    } catch {
        // Some browsers restrict media element routing. Export can still complete as silent video.
        return false
    }
}

const start_video_playback = async ( video, signal, { allow_muted_retry = false } = {} ) => {
    try {
        await wait_for_abortable( video.play(), signal )
    } catch ( error ) {
        if( error.name !== `NotAllowedError` ) throw error
        if( !allow_muted_retry ) {
            throw new Error( `This browser blocked export playback with audio. Try export again while keeping this tab active.` )
        }

        // Mobile autoplay rules can reject detached videos after React effects.
        // Retrying muted preserves video-only export when no audio route is available.
        throw_if_aborted( signal )
        video.muted = true
        await wait_for_abortable( video.play(), signal )
    }
}

const create_export_recorder = ( { stream, mime_type, settings } ) => {
    const base_options = {
        videoBitsPerSecond: quality_bits[ settings.export_quality ] ?? quality_bits.standard
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

    try {
        video.src = object_url
        video.playsInline = true
        video.preload = `auto`
        await wait_for_event( video, `loadedmetadata`, signal )
        const audio_connected = connect_video_audio( audio_graph, video )

        const duration_ms = clip.duration_ms || Math.round( ( video.duration || 0 ) * 1000 )
        const project_duration_ms = clips.reduce( ( total, next_clip ) => total + ( next_clip.duration_ms || 0 ), 0 ) || 1
        const previous_duration_ms = clips.slice( 0, clip_index ).reduce( ( total, next_clip ) => {
            return total + ( next_clip.duration_ms || 0 )
        }, 0 )

        await start_video_playback( video, signal, {
            allow_muted_retry: !audio_connected
        } )

        while( !video.ended ) {
            throw_if_aborted( signal )

            draw_video_frame( context, video, canvas )

            const current_clip_ms = Math.min( duration_ms, Math.round( video.currentTime * 1000 ) )
            const completed_ms = previous_duration_ms + current_clip_ms
            const percent = Math.min( 99, Math.round(  completed_ms / project_duration_ms  * 100 ) )
            on_progress?.( {
                percent,
                message: `Exporting clip ${ clip_index + 1 } of ${ clips.length }`
            } )

            await next_animation_frame()
        }

        draw_video_frame( context, video, canvas )
    } finally {
        cleanup_video( video, object_url )
    }
}

const can_record_canvas_resolution = ( { width, height } ) => {
    if( get_export_support_message() ) return false

    const canvas = document.createElement( `canvas` )

    canvas.width = width
    canvas.height = height

    let stream = null
    let recorder = null

    try {
        stream = canvas.captureStream( FPS )
        recorder = new MediaRecorder( stream )
        return Boolean( recorder )
    } catch {
        return false
    } finally {
        stop_media_stream( stream )
    }
}

/**
 * Explains why browser-native export compilation is unavailable.
 * @returns {string|null} User-facing unavailable message, or null when supported.
 */
export function get_export_support_message() {
    if( !globalThis.MediaRecorder ) return `This browser cannot compile video exports.`
    if( !globalThis.MediaStream ) return `This browser cannot build a combined export stream.`
    if( !globalThis.document?.createElement ) return `This browser cannot prepare the export canvas.`

    const canvas = document.createElement( `canvas` )
    if( !canvas.captureStream ) return `This browser cannot capture a video export from the canvas.`

    return null
}

/**
 * Checks if this browser has the primitives needed for MVP export compilation.
 * @returns {boolean} Whether export compilation is available.
 */
export function can_compile_project_exports() {
    return !get_export_support_message()
}

/**
 * Lists export resolution options this browser can prove through canvas capture.
 * @returns {Array<Object>} Supported resolution options.
 */
export function get_supported_export_resolutions() {
    if( !can_compile_project_exports() ) return []

    const [ source_option, ...scaled_options ] = export_resolution_options
    const supported_scaled_options = scaled_options.filter( ( { value } ) => {
        return can_record_canvas_resolution( resolution_limits[ value ] )
    } )

    return [ source_option, ...supported_scaled_options ]
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
    const audio_graph = create_audio_graph()
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
        const stopped = wait_for_recorder_stop( recorder, chunks )

        if( audio_graph?.audio_context.state === `suspended` ) await audio_graph.audio_context.resume()
        throw_if_aborted( signal )

        recorder.start( 250 )
        on_progress?.( { percent: 1, message: `Preparing export` } )

        await clips.reduce( async ( previous_clip, clip, clip_index ) => {
            await previous_clip
            return play_clip_to_canvas( {
                clip,
                clip_index,
                clips,
                canvas,
                context,
                audio_graph,
                signal,
                on_progress
            } )
        }, Promise.resolve() )

        recorder.stop()
        await stopped
        on_progress?.( { percent: 100, message: `Export ready` } )

        const output_type = recorder.mimeType || mime_type || chunks.at( 0 )?.type || `video/webm`
        const blob = new Blob( chunks, { type: output_type } )
        const duration_ms = clips.reduce( ( total, clip ) => total + ( clip.duration_ms || 0 ), 0 )

        return {
            blob,
            mime_type: output_type,
            duration_ms
        }
    } finally {
        if( recorder && recorder.state !== `inactive` ) recorder.stop()
        stop_media_stream( video_stream )
        stop_media_stream( mixed_stream )
        await audio_graph?.audio_context.close?.()
    }
}
