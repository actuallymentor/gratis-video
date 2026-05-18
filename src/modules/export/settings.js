import { recording_mime_candidates, select_supported_mime_type, stop_media_stream } from '../media/recorder.js'

const EXPORT_PROBE_FPS = 30

export const export_quality_bits = {
    standard: 2_500_000,
    high: 5_500_000
}

export const export_resolution_limits = {
    source: null,
    '720p': { width: 1280, height: 720 },
    '1080p': { width: 1920, height: 1080 }
}

export const export_resolution_options = [
    { value: `source`, label: `Source` },
    { value: `720p`, label: `720p` },
    { value: `1080p`, label: `1080p` }
]

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

const can_record_canvas_stream = ( { width = 16, height = 16, mime_type = null } = {} ) => {
    if( get_export_support_message() ) return false

    const canvas = document.createElement( `canvas` )

    canvas.width = width
    canvas.height = height

    let stream = null
    let recorder = null

    try {
        stream = canvas.captureStream( EXPORT_PROBE_FPS )
        recorder = mime_type
            ? new MediaRecorder( stream, { mimeType: mime_type } )
            : new MediaRecorder( stream )
        recorder.start()
        if( recorder.state !== `inactive` ) recorder.stop()
        return Boolean( recorder )
    } catch {
        return false
    } finally {
        if( recorder?.state && recorder.state !== `inactive` ) recorder.stop()
        stop_media_stream( stream )
    }
}

const can_record_canvas_resolution = ( { width, height } ) => {
    return can_record_canvas_stream( { width, height } )
}

const can_record_canvas_mime_type = ( mime_type ) => {
    if( !globalThis.MediaRecorder?.isTypeSupported?.( mime_type ) ) return false
    return can_record_canvas_stream( { mime_type } )
}

/**
 * Lists export resolution options this browser can prove through canvas capture.
 * @returns {Array<Object>} Supported resolution options.
 */
export function get_supported_export_resolutions() {
    if( !can_compile_project_exports() ) return []

    const [ source_option, ...scaled_options ] = export_resolution_options
    const supported_scaled_options = scaled_options.filter( ( { value } ) => {
        return can_record_canvas_resolution( export_resolution_limits[ value ] )
    } )

    return [ source_option, ...supported_scaled_options ]
}

/**
 * Lists MIME types that this browser can record from the export canvas path.
 * @returns {Array<string>} Supported export MIME types.
 */
export function get_supported_export_mime_types() {
    if( !can_compile_project_exports() ) return []
    return recording_mime_candidates.filter( can_record_canvas_mime_type )
}

/**
 * Removes persisted export settings that this browser cannot prove at runtime.
 * @param {Object} settings - Stored export and feedback settings.
 * @returns {Object} Settings safe for export UI, cache hashes, and compilation.
 */
export function normalize_export_settings( settings = {} ) {
    const supported_resolution_values = get_supported_export_resolutions().map( ( { value } ) => value )
    const supported_mime_types = get_supported_export_mime_types()
    const export_quality = export_quality_bits[ settings.export_quality ] ? settings.export_quality : `standard`
    const export_resolution = supported_resolution_values.includes( settings.export_resolution )
        ? settings.export_resolution
        : `source`
    const preferred_mime_type = supported_mime_types.includes( settings.preferred_mime_type )
        ? settings.preferred_mime_type
        : null

    return {
        ...settings,
        export_quality,
        export_resolution,
        preferred_mime_type
    }
}

/**
 * Picks the export MIME type after applying a runtime-supported preference.
 * @param {Object} settings - Normalized export settings.
 * @returns {string|null} MIME type or null for browser default.
 */
export function choose_export_mime_type( settings ) {
    const preferred = settings.preferred_mime_type

    if( preferred && globalThis.MediaRecorder?.isTypeSupported?.( preferred ) ) return preferred
    return select_supported_mime_type( recording_mime_candidates )
}
