export const recording_mime_candidates = [
    `video/mp4;codecs=avc1.42E01E,mp4a.40.2`,
    `video/mp4`,
    `video/webm;codecs=vp9,opus`,
    `video/webm;codecs=vp8,opus`,
    `video/webm`
]

export const HOLD_THRESHOLD_MS = 250
export const MINIMUM_CLIP_MS = 400
export const CAPTURE_WARNING_KEY = `daily_video_journal_capture_warning`
const VIDEO_EVENT_TIMEOUT_MS = 3_000

const capture_video_constraints = {
    facingMode: { ideal: `environment` },
    width: { ideal: 1280 },
    height: { ideal: 720 }
}

const capture_audio_constraints = {
    echoCancellation: true,
    noiseSuppression: true
}

const video_only_retry_errors = [
    `NotAllowedError`,
    `PermissionDeniedError`,
    `NotFoundError`,
    `DevicesNotFoundError`,
    `NotReadableError`,
    `TrackStartError`,
    `OverconstrainedError`,
    `ConstraintNotSatisfiedError`
]

const should_retry_video_only = ( error ) => video_only_retry_errors.includes( error?.name )

const mark_capture_warning = ( stream, warning ) => {
    try {
        Object.defineProperty( stream, CAPTURE_WARNING_KEY, {
            configurable: true,
            value: warning
        } )
    } catch {
        try {
            stream[ CAPTURE_WARNING_KEY ] = warning
        } catch {
            // Warning metadata is best-effort; the media stream itself is still valid.
        }
    }

    return stream
}

const camera_denied_error = () => new DOMException(
    `Camera access is blocked for this site.`,
    `NotAllowedError`
)

/**
 * Selects the first MediaRecorder MIME type supported by this browser.
 * @param {Array<string>} candidates - Candidate MIME types in priority order.
 * @returns {string|null} Supported MIME type or null for browser default.
 */
export function select_supported_mime_type( candidates = recording_mime_candidates ) {
    if( !globalThis.MediaRecorder?.isTypeSupported ) return null

    return candidates.find( ( candidate ) => MediaRecorder.isTypeSupported( candidate ) ) ?? null
}

/**
 * Lists supported recording/export MIME types for settings screens.
 * @param {Array<string>} candidates - Candidate MIME types.
 * @returns {Array<string>} Supported MIME types.
 */
export function get_supported_mime_types( candidates = recording_mime_candidates ) {
    if( !globalThis.MediaRecorder?.isTypeSupported ) return []
    return candidates.filter( ( candidate ) => MediaRecorder.isTypeSupported( candidate ) )
}

/**
 * Classifies a record-button pointer gesture.
 * @param {number} duration_ms - Pointer press duration.
 * @param {number} threshold_ms - Hold threshold.
 * @returns {string} `tap` or `hold`.
 */
export function classify_recording_gesture( duration_ms, threshold_ms = HOLD_THRESHOLD_MS ) {
    return duration_ms < threshold_ms ? `tap` : `hold`
}

/**
 * Stops every track in a media stream.
 * @param {MediaStream|null} stream - Media stream.
 * @returns {void}
 */
export function stop_media_stream( stream ) {
    stream?.getTracks().forEach( ( track ) => track.stop() )
}

/**
 * Opens the camera and microphone from an explicit user action.
 * @param {Object} options - Capture request options.
 * @param {boolean} options.audio_enabled - Whether to request microphone audio.
 * @returns {Promise<MediaStream>} Media stream.
 */
export async function request_capture_stream( { audio_enabled = true } = {} ) {
    if( globalThis.isSecureContext === false ) {
        throw new Error( `Camera and microphone require a secure browser origin.` )
    }

    if( !globalThis.navigator?.mediaDevices?.getUserMedia ) {
        throw new Error( `This browser does not support camera or microphone capture.` )
    }

    const capture_constraints = {
        video: capture_video_constraints,
        audio: audio_enabled ? capture_audio_constraints : false
    }

    if( !audio_enabled ) return navigator.mediaDevices.getUserMedia( capture_constraints )

    try {
        return await navigator.mediaDevices.getUserMedia( capture_constraints )
    } catch ( error ) {
        if( !should_retry_video_only( error ) ) throw error

        try {
            const video_only_stream = await navigator.mediaDevices.getUserMedia( {
                video: capture_video_constraints,
                audio: false
            } )

            const warning = error?.name === `NotAllowedError` || error?.name === `PermissionDeniedError`
                ? `microphone_denied`
                : `microphone_unavailable`

            return mark_capture_warning( video_only_stream, warning )
        } catch ( retry_error ) {
            if(
                ( error?.name === `NotAllowedError` || error?.name === `PermissionDeniedError` )
                && ( retry_error?.name === `NotAllowedError` || retry_error?.name === `PermissionDeniedError` )
            ) {
                throw camera_denied_error()
            }

            throw retry_error
        }
    }
}

/**
 * Creates a configured MediaRecorder for a stream.
 * @param {MediaStream} stream - Capture stream.
 * @param {Object} options - Recorder construction options.
 * @param {string|null} options.mime_type - MIME type to request, or null for browser default.
 * @param {boolean} options.fallback_to_default - Whether typed construction may retry without MIME.
 * @returns {MediaRecorder} Recorder instance.
 */
export function create_media_recorder( stream, {
    mime_type = select_supported_mime_type(),
    fallback_to_default = true
} = {} ) {
    if( !globalThis.MediaRecorder ) throw new Error( `MediaRecorder is unavailable in this browser.` )

    const recorder_options = mime_type ? { mimeType: mime_type } : undefined

    try {
        return new MediaRecorder( stream, recorder_options )
    } catch ( error ) {
        if( recorder_options && fallback_to_default ) return new MediaRecorder( stream )
        throw error
    }
}

/**
 * Maps capture startup failures to concise user-facing guidance.
 * @param {Error|DOMException} error - Capture startup error.
 * @returns {string} User-facing capture failure message.
 */
export function get_capture_error_message( error ) {
    if( globalThis.navigator?.onLine === false ) {
        return `Saved projects are available offline, but this browser could not open the camera or microphone while offline.`
    }

    if( error?.name === `NotAllowedError` || error?.name === `PermissionDeniedError` ) {
        return `Camera or microphone access is blocked for this site. Check browser site settings, then try recording again.`
    }

    if( error?.name === `NotFoundError` || error?.name === `DevicesNotFoundError` ) return `No camera was found on this device.`

    if( error?.name === `NotReadableError` || error?.name === `TrackStartError` ) {
        return `The camera or microphone is already in use by another app or browser tab.`
    }

    if( error?.name === `OverconstrainedError` || error?.name === `ConstraintNotSatisfiedError` ) {
        return `This camera or microphone cannot satisfy the requested recording settings.`
    }

    if( error?.name === `SecurityError` ) return `Camera and microphone access is blocked by this browser context.`
    if( error?.name === `NotSupportedError` ) return `This browser cannot start camera or microphone capture here.`

    return error?.message || `Recording could not start.`
}

const wait_for_video_event = ( video, event_name, error_message ) => new Promise( ( resolve, reject ) => {
    let timeout_id = null
    const event_handler_name = `on${ event_name }`
    const cleanup = () => {
        if( timeout_id ) globalThis.clearTimeout( timeout_id )
        video[ event_handler_name ] = null
        video.onerror = null
    }

    video[ event_handler_name ] = () => {
        cleanup()
        resolve()
    }
    video.onerror = () => {
        cleanup()
        reject( new Error( error_message ) )
    }
    timeout_id = globalThis.setTimeout( () => {
        cleanup()
        reject( new Error( error_message ) )
    }, VIDEO_EVENT_TIMEOUT_MS )
} )

const load_video_metadata = ( video ) => {
    return wait_for_video_event( video, `loadedmetadata`, `Could not read recorded clip metadata.` )
}

const seek_video = async ( video, time ) => {
    const seeked = wait_for_video_event( video, `seeked`, `Could not seek recorded clip.` )
    video.currentTime = time
    return seeked
}

const canvas_to_blob = ( canvas, type = `image/jpeg`, quality = 0.78 ) => new Promise( ( resolve ) => {
    canvas.toBlob( ( blob ) => resolve( blob ), type, quality )
} )

/**
 * Reads duration and dimensions from a recorded video blob.
 * @param {Blob} blob - Video blob.
 * @returns {Promise<Object>} Video metadata.
 */
export async function get_video_metadata( blob ) {
    const video = document.createElement( `video` )
    const object_url = URL.createObjectURL( blob )

    try {
        video.preload = `metadata`
        video.src = object_url
        await load_video_metadata( video )

        return {
            duration_ms: Number.isFinite( video.duration ) ? Math.round( video.duration * 1000 ) : 0,
            width: video.videoWidth || null,
            height: video.videoHeight || null
        }
    } finally {
        video.removeAttribute( `src` )
        video.load()
        URL.revokeObjectURL( object_url )
    }
}

/**
 * Generates a small thumbnail from a recorded video blob.
 * @param {Blob} blob - Video blob.
 * @returns {Promise<Blob|null>} Thumbnail blob.
 */
export async function generate_video_thumbnail( blob ) {
    const video = document.createElement( `video` )
    const object_url = URL.createObjectURL( blob )

    try {
        video.muted = true
        video.playsInline = true
        video.preload = `metadata`
        video.src = object_url
        await load_video_metadata( video )

        const seek_time = Math.min( 0.2, Math.max( 0, ( video.duration || 1 ) / 2 ) )
        const seek_completed = Number.isFinite( seek_time )
            ? await seek_video( video, seek_time ).then( () => true ).catch( () => false )
            : true

        if( !seek_completed ) return null

        const width = video.videoWidth || 320
        const height = video.videoHeight || 180
        const thumbnail_width = 320
        const thumbnail_height = Math.max( 1, Math.round(  thumbnail_width / width  * height ) )
        const canvas = document.createElement( `canvas` )
        canvas.width = thumbnail_width
        canvas.height = thumbnail_height

        const context = canvas.getContext( `2d` )
        context.drawImage( video, 0, 0, thumbnail_width, thumbnail_height )

        return canvas_to_blob( canvas )
    } catch {
        return null
    } finally {
        video.removeAttribute( `src` )
        video.load()
        URL.revokeObjectURL( object_url )
    }
}

/**
 * Plays a lightweight haptic pulse when enabled and supported.
 * @param {boolean} enabled - Whether haptics are enabled.
 * @returns {void}
 */
export function pulse_haptic( enabled ) {
    if( !enabled || !globalThis.navigator?.vibrate ) return

    try {
        navigator.vibrate( 24 )
    } catch {
        // Optional feedback should never decide whether recording succeeds.
    }
}

/**
 * Plays optional short sound feedback for recording state changes.
 * @param {boolean} enabled - Whether sound feedback is enabled.
 * @param {string} kind - Sound variant.
 * @returns {void}
 */
export function play_sound_feedback( enabled, kind = `start` ) {
    if( !enabled ) return

    const AudioContextConstructor = globalThis.AudioContext || globalThis.webkitAudioContext
    if( !AudioContextConstructor ) return

    let audio_context = null

    try {
        audio_context = new AudioContextConstructor()
        const oscillator = audio_context.createOscillator()
        const gain = audio_context.createGain()
        const now = audio_context.currentTime
        const frequency = kind === `stop` ? 520 : 760

        oscillator.type = `sine`
        oscillator.frequency.setValueAtTime( frequency, now )
        gain.gain.setValueAtTime( 0.0001, now )
        gain.gain.exponentialRampToValueAtTime( 0.045, now + 0.015 )
        gain.gain.exponentialRampToValueAtTime( 0.0001, now + 0.12 )

        oscillator.connect( gain )
        gain.connect( audio_context.destination )
        oscillator.start( now )
        oscillator.stop( now + 0.14 )
        oscillator.onended = () => audio_context.close?.()
    } catch {
        audio_context?.close?.()
        // Browsers can deny Web Audio outside user activation; recording still works.
    }
}
