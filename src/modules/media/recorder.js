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
export const DEFAULT_RECORDING_VIDEO_PRESET = `1080p30`
const VIDEO_EVENT_TIMEOUT_MS = 3_000

const capture_video_constraints = {
    facingMode: { ideal: `environment` },
    resizeMode: { ideal: `none` }
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

export const recording_video_presets = [
    {
        value: `720p30`,
        label: `720p 30`,
        width: 1280,
        height: 720,
        frame_rate: 30,
        video_bits_per_second: 4_000_000
    },
    {
        value: `1080p30`,
        label: `1080p 30`,
        width: 1920,
        height: 1080,
        frame_rate: 30,
        video_bits_per_second: 8_000_000
    },
    {
        value: `1080p60`,
        label: `1080p 60`,
        width: 1920,
        height: 1080,
        frame_rate: 60,
        video_bits_per_second: 12_000_000
    },
    {
        value: `4k30`,
        label: `4K 30`,
        width: 3840,
        height: 2160,
        frame_rate: 30,
        video_bits_per_second: 24_000_000
    }
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

const is_finite_number = ( value ) => Number.isFinite( value )

/**
 * Gets a supported recording video preset, falling back to the default.
 * @param {string|null} value - Persisted preset value.
 * @returns {Object} Recording preset.
 */
export function get_recording_video_preset( value ) {
    return recording_video_presets.find( ( preset ) => preset.value === value )
        ?? recording_video_presets.find( ( preset ) => preset.value === DEFAULT_RECORDING_VIDEO_PRESET )
        ?? recording_video_presets.at( 0 )
}

const make_capture_video_constraints = ( {
    recording_video_preset = DEFAULT_RECORDING_VIDEO_PRESET,
    video_device_id = null
} = {} ) => {
    const preset = get_recording_video_preset( recording_video_preset )
    const frame_rate_constraint = preset?.frame_rate
        ? { frameRate: { ideal: preset.frame_rate } }
        : {}
    const device_constraint = video_device_id
        ? { deviceId: { exact: video_device_id } }
        : {}

    return {
        ...capture_video_constraints,
        ...frame_rate_constraint,
        ...device_constraint
    }
}

const orient_preset_dimensions = ( preset, current_settings = {} ) => {
    const current_width = is_finite_number( current_settings.width ) ? current_settings.width : null
    const current_height = is_finite_number( current_settings.height ) ? current_settings.height : null
    const current_is_portrait = current_width !== null && current_height !== null && current_height >= current_width
    const longer_edge = Math.max( preset.width, preset.height )
    const shorter_edge = Math.min( preset.width, preset.height )

    return {
        width: current_is_portrait ? shorter_edge : longer_edge,
        height: current_is_portrait ? longer_edge : shorter_edge
    }
}

// Do not request width, height, or aspect ratio on first camera open. Mobile
// browsers can satisfy those constraints by cropping or switching sensor modes.
// Once the track is open, apply ideal preset dimensions in the preview's active
// orientation so recording and preview keep matching.
const make_recording_video_constraints = ( preset, capabilities = {}, current_settings = {} ) => {
    const constraints = {}

    if( capabilities.resizeMode?.includes?.( `none` ) ) constraints.resizeMode = { exact: `none` }

    const { width, height } = orient_preset_dimensions( preset, current_settings )

    constraints.width = { ideal: width }
    constraints.height = { ideal: height }
    if( preset.frame_rate ) constraints.frameRate = { ideal: preset.frame_rate }

    return constraints
}

const apply_track_constraints = async ( track, constraints ) => {
    if( !track.applyConstraints || !Object.keys( constraints ).length ) return

    try {
        await track.applyConstraints( constraints )
    } catch {
        const fallback_constraints = {
            ...constraints,
            resizeMode: { ideal: `none` }
        }

        try {
            await track.applyConstraints( fallback_constraints )
        } catch {
            const sized_constraints = { ...constraints }
            delete sized_constraints.resizeMode

            if( Object.keys( sized_constraints ).length ) await track.applyConstraints( sized_constraints ).catch( () => null )
        }
    }
}

const apply_recording_video_preset = async ( stream, recording_video_preset ) => {
    const preset = get_recording_video_preset( recording_video_preset )
    const video_tracks = stream.getVideoTracks?.() ?? []

    await Promise.all( video_tracks.map( async ( track ) => {
        const capabilities = track.getCapabilities?.() ?? {}
        const current_settings = track.getSettings?.() ?? {}
        const constraints = make_recording_video_constraints( preset, capabilities, current_settings )

        await apply_track_constraints( track, constraints )
    } ) )

    return stream
}

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
 * Lists camera input devices available to this origin.
 * @returns {Promise<Array<Object>>} Video input device options.
 */
export async function list_video_input_devices() {
    if( !globalThis.navigator?.mediaDevices?.enumerateDevices ) return []

    const devices = await navigator.mediaDevices.enumerateDevices()
    const video_devices = devices.filter( ( { kind, deviceId } ) => {
        return kind === `videoinput` && deviceId
    } )

    return video_devices.map( ( { deviceId, groupId, label }, index ) => ( {
        device_id: deviceId,
        group_id: groupId || null,
        label: label || `Camera ${ index + 1 }`
    } ) )
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
 * @param {string|null} options.recording_video_preset - Recording video preset value.
 * @param {string|null} options.video_device_id - Specific camera source to reuse.
 * @returns {Promise<MediaStream>} Media stream.
 */
export async function request_capture_stream( {
    audio_enabled = true,
    recording_video_preset = DEFAULT_RECORDING_VIDEO_PRESET,
    video_device_id = null
} = {} ) {
    if( globalThis.isSecureContext === false ) {
        throw new Error( `Camera and microphone require a secure browser origin.` )
    }

    if( !globalThis.navigator?.mediaDevices?.getUserMedia ) {
        throw new Error( `This browser does not support camera or microphone capture.` )
    }

    const video_constraints = make_capture_video_constraints( {
        recording_video_preset,
        video_device_id
    } )
    const capture_constraints = {
        video: video_constraints,
        audio: audio_enabled ? capture_audio_constraints : false
    }

    if( !audio_enabled ) return apply_recording_video_preset(
        await navigator.mediaDevices.getUserMedia( capture_constraints ),
        recording_video_preset
    )

    try {
        return await apply_recording_video_preset(
            await navigator.mediaDevices.getUserMedia( capture_constraints ),
            recording_video_preset
        )
    } catch ( error ) {
        if( !should_retry_video_only( error ) ) throw error

        try {
            const video_only_stream = await apply_recording_video_preset(
                await navigator.mediaDevices.getUserMedia( {
                    video: video_constraints,
                    audio: false
                } ),
                recording_video_preset
            )

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
 * Opens only the microphone so recording can reuse the already-visible camera track.
 * @returns {Promise<MediaStream>} Audio stream.
 */
export async function request_audio_stream() {
    if( globalThis.isSecureContext === false ) {
        throw new Error( `Camera and microphone require a secure browser origin.` )
    }

    if( !globalThis.navigator?.mediaDevices?.getUserMedia ) {
        throw new Error( `This browser does not support camera or microphone capture.` )
    }

    return navigator.mediaDevices.getUserMedia( {
        video: false,
        audio: capture_audio_constraints
    } )
}

/**
 * Creates a configured MediaRecorder for a stream.
 * @param {MediaStream} stream - Capture stream.
 * @param {Object} options - Recorder construction options.
 * @param {string|null} options.mime_type - MIME type to request, or null for browser default.
 * @param {boolean} options.fallback_to_default - Whether typed construction may retry without MIME.
 * @param {number|null} options.video_bits_per_second - Requested video encoder bitrate.
 * @returns {MediaRecorder} Recorder instance.
 */
export function create_media_recorder( stream, {
    mime_type = select_supported_mime_type(),
    fallback_to_default = true,
    video_bits_per_second = null
} = {} ) {
    if( !globalThis.MediaRecorder ) throw new Error( `MediaRecorder is unavailable in this browser.` )

    const requested_options = {}

    if( mime_type ) requested_options.mimeType = mime_type
    if( video_bits_per_second ) requested_options.videoBitsPerSecond = video_bits_per_second

    const recorder_options = Object.keys( requested_options ).length ? requested_options : undefined

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
