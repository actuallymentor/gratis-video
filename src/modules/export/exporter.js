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

const wait_for_event = ( target, event_name ) => new Promise( ( resolve, reject ) => {
    target.addEventListener( event_name, resolve, { once: true } )
    target.addEventListener( `error`, () => reject( new Error( `Media playback failed.` ) ), { once: true } )
} )

const wait_for_recorder_stop = ( recorder, chunks ) => new Promise( ( resolve, reject ) => {
    recorder.ondataavailable = ( event ) => {
        if( event.data?.size > 0 ) chunks.push( event.data )
    }
    recorder.onerror = () => reject( recorder.error ?? new Error( `Export recorder failed.` ) )
    recorder.onstop = () => resolve()
} )

const next_animation_frame = () => new Promise( ( resolve ) => requestAnimationFrame( resolve ) )

const calculate_canvas_size = ( clips, settings ) => {
    const source_width = clips.find( ( clip ) => clip.width )?.width ?? 1280
    const source_height = clips.find( ( clip ) => clip.height )?.height ?? 720
    const ratio = source_width / source_height
    const limit = resolution_limits[ settings.export_resolution ] ?? null

    if( !limit ) return { width: source_width, height: source_height }

    const limited_width = Math.min( source_width, limit.width )
    const limited_height = Math.min( Math.round( limited_width / ratio ), limit.height )

    return {
        width: Math.max( 1, limited_width ),
        height: Math.max( 1, limited_height )
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
    return select_supported_mime_type( recording_mime_candidates ) ?? `video/webm`
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
    if( !audio_graph ) return

    try {
        const source = audio_graph.audio_context.createMediaElementSource( video )
        source.connect( audio_graph.destination )
        audio_graph.sources.push( source )
    } catch {
        // Some browsers restrict media element routing. Export can still complete as silent video.
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
    const blob = await get_clip_blob( clip.id )
    if( !blob ) return

    const object_url = URL.createObjectURL( blob )
    const video = document.createElement( `video` )

    try {
        video.src = object_url
        video.playsInline = true
        video.preload = `auto`
        await wait_for_event( video, `loadedmetadata` )
        connect_video_audio( audio_graph, video )

        const duration_ms = clip.duration_ms || Math.round( ( video.duration || 0 ) * 1000 )
        const project_duration_ms = clips.reduce( ( total, next_clip ) => total + ( next_clip.duration_ms || 0 ), 0 ) || 1
        const previous_duration_ms = clips.slice( 0, clip_index ).reduce( ( total, next_clip ) => {
            return total + ( next_clip.duration_ms || 0 )
        }, 0 )

        await video.play()

        while( !video.ended ) {
            if( signal.aborted ) throw new DOMException( `Export cancelled`, `AbortError` )

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
    if( !globalThis.MediaRecorder ) throw new Error( `This browser cannot compile video exports.` )

    const { width, height } = calculate_canvas_size( clips, settings )
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
    const recorder_options = {
        mimeType: mime_type,
        videoBitsPerSecond: quality_bits[ settings.export_quality ] ?? quality_bits.standard
    }
    let recorder

    try {
        recorder = new MediaRecorder( mixed_stream, recorder_options )
    } catch {
        recorder = new MediaRecorder( mixed_stream, {
            videoBitsPerSecond: recorder_options.videoBitsPerSecond
        } )
    }
    const stopped = wait_for_recorder_stop( recorder, chunks )

    try {
        if( audio_graph?.audio_context.state === `suspended` ) await audio_graph.audio_context.resume()

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

        const output_type = recorder.mimeType || mime_type
        const blob = new Blob( chunks, { type: output_type } )
        const duration_ms = clips.reduce( ( total, clip ) => total + ( clip.duration_ms || 0 ), 0 )

        return {
            blob,
            mime_type: output_type,
            duration_ms
        }
    } finally {
        if( recorder.state !== `inactive` ) recorder.stop()
        stop_media_stream( video_stream )
        stop_media_stream( mixed_stream )
        await audio_graph?.audio_context.close?.()
    }
}
