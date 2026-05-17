const permission_names = [ `camera`, `microphone` ]

const query_permission = async ( name ) => {
    if( !globalThis.navigator?.permissions?.query ) return `unsupported`

    try {
        const status = await navigator.permissions.query( { name } )
        return status.state ?? `unknown`
    } catch {
        return `unsupported`
    }
}

/**
 * Checks browser media capabilities without triggering permission prompts.
 * @returns {Promise<Object>} Permission and capability state.
 */
export async function check_media_permissions() {
    const [ camera, microphone ] = await Promise.all(
        permission_names.map( ( name ) => query_permission( name ) )
    )

    return {
        camera,
        microphone,
        secure_context: globalThis.isSecureContext !== false,
        media_devices: globalThis.navigator?.mediaDevices?.getUserMedia ? `supported` : `unsupported`,
        media_recorder: globalThis.MediaRecorder ? `supported` : `unsupported`
    }
}

/**
 * Creates a user-facing media availability message.
 * @param {Object} permission_status - Permission and capability state.
 * @returns {string|null} Message when attention is needed.
 */
export function media_status_message( permission_status ) {
    if( !permission_status.secure_context ) return `Recording requires HTTPS, localhost, or another secure browser origin.`
    if( permission_status.media_devices === `unsupported` ) return `This browser cannot open the camera or microphone.`
    if( permission_status.media_recorder === `unsupported` ) return `This browser cannot record video with MediaRecorder.`
    if( permission_status.camera === `denied` && permission_status.microphone === `denied` ) return `Camera and microphone access are blocked for this site.`
    if( permission_status.camera === `denied` ) return `Camera access is blocked for this site.`
    if( permission_status.microphone === `denied` ) return `Microphone access is blocked for this site.`

    return null
}
