export const default_live_media_access = {
    camera: false,
    microphone: false
}

const media_permission_denial_names = new Set( [
    `NotAllowedError`,
    `PermissionDeniedError`
] )

const has_live_track = ( track ) => Boolean( track ) && track.readyState !== `ended`

const normalize_media_access = ( media_access = {} ) => ( {
    camera: Boolean( media_access.camera ),
    microphone: Boolean( media_access.microphone )
} )

/**
 * Reads active camera and microphone access from a concrete media stream.
 * @param {MediaStream|Object|null} stream - Browser media stream.
 * @returns {Object} Live camera and microphone access flags.
 */
export function get_stream_media_access( stream ) {
    const video_tracks = stream?.getVideoTracks?.() ?? []
    const audio_tracks = stream?.getAudioTracks?.() ?? []

    return {
        camera: video_tracks.some( has_live_track ),
        microphone: audio_tracks.some( has_live_track )
    }
}

/**
 * Marks successfully opened media devices as granted in the effective status.
 * @param {Object} permission_status - Current permission status.
 * @param {Object} media_access - Observed live media access.
 * @returns {Object} Permission status reconciled with observed access.
 */
export function grant_observed_media_access( permission_status, media_access ) {
    const observed_access = normalize_media_access( media_access )

    return {
        ...permission_status,
        camera: observed_access.camera ? `granted` : permission_status.camera,
        microphone: observed_access.microphone ? `granted` : permission_status.microphone
    }
}

/**
 * Applies passive permission reads without letting them contradict live tracks.
 * @param {Object} permission_status - Passive permission status.
 * @param {Object} live_media_access - Devices currently proven live.
 * @returns {Object} Effective permission status.
 */
export function reconcile_passive_permission_status( permission_status, live_media_access ) {
    return grant_observed_media_access( permission_status, live_media_access )
}

/**
 * Records a concrete capture denial from getUserMedia-style failures.
 * @param {Object} permission_status - Current permission status.
 * @param {Object} denied_media_access - Devices denied by the browser.
 * @returns {Object} Permission status with concrete denials applied.
 */
export function mark_denied_media_access( permission_status, denied_media_access ) {
    const denied_access = normalize_media_access( denied_media_access )

    return {
        ...permission_status,
        camera: denied_access.camera ? `denied` : permission_status.camera,
        microphone: denied_access.microphone ? `denied` : permission_status.microphone
    }
}

/**
 * Checks whether a browser media failure represents a user/site permission denial.
 * @param {Error|DOMException|null} error - Browser media error.
 * @returns {boolean} Whether the failure is a concrete permission denial.
 */
export function is_media_permission_denial( error ) {
    return media_permission_denial_names.has( error?.name )
}
