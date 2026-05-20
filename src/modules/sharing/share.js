import { log } from 'mentie/modules/logging.js'

const DOWNLOAD_URL_REVOKE_MS = 60_000
const fallback_video_share_mime_type = `video/webm`
const share_video_mime_types_by_extension = {
    m4v: `video/mp4`,
    mp4: `video/mp4`,
    mpeg: `video/mpeg`,
    mpg: `video/mpeg`,
    ogm: `video/ogg`,
    ogv: `video/ogg`,
    webm: `video/webm`
}

const strip_mime_parameters = ( mime_type = `` ) => {
    return mime_type.split( `;` ).at( 0 )?.trim().toLowerCase() ?? ``
}

const get_file_extension = ( filename = `` ) => {
    return filename.split( `.` ).at( -1 )?.toLowerCase() ?? ``
}

const get_share_mime_type = ( { export_record, blob } ) => {
    const extension_mime_type = share_video_mime_types_by_extension[
        get_file_extension( export_record.filename )
    ]
    if( extension_mime_type ) return extension_mime_type

    const metadata_mime_type = strip_mime_parameters( export_record.mime_type )
    if( metadata_mime_type.startsWith( `video/` ) ) return metadata_mime_type

    const blob_mime_type = strip_mime_parameters( blob.type )
    if( blob_mime_type.startsWith( `video/` ) ) return blob_mime_type

    return fallback_video_share_mime_type
}

const has_transient_user_activation = () => {
    return globalThis.navigator?.userActivation?.isActive !== false
}

/**
 * Builds a File object from an export blob and metadata.
 * @param {Object} export_record - Export metadata.
 * @param {Blob} blob - Export blob.
 * @returns {File} Shareable file.
 */
export function create_share_file( export_record, blob ) {
    return new File(
        [ blob ],
        export_record.filename,
        { type: get_share_mime_type( { export_record, blob } ) }
    )
}

/**
 * Checks whether native file sharing is available for an export.
 * @param {File} file - File to share.
 * @returns {boolean} Whether sharing is supported.
 */
export function can_share_file( file ) {
    if( !globalThis.navigator?.share ) return false
    if( !navigator.canShare ) return false

    try {
        return navigator.canShare( { files: [ file ] } )
    } catch {
        return false
    }
}

/**
 * Opens the native share sheet when available.
 * @param {Object} options - Share options.
 * @param {Object} options.project - Project metadata.
 * @param {Object} options.export_record - Export metadata.
 * @param {Blob} options.blob - Export blob.
 * @returns {Promise<string>} `shared`, `cancelled`, `activation-required`, or `unsupported`.
 */
export async function share_export_file( { project, export_record, blob } ) {
    const file = create_share_file( export_record, blob )

    log.debug( `Native share capability checked`, {
        project_id: project.id,
        export_id: export_record.id,
        filename: file.name,
        size: file.size,
        type: file.type
    } )

    if( !can_share_file( file ) ) {
        log.info( `Native file sharing unsupported`, {
            project_id: project.id,
            export_id: export_record.id
        } )
        return `unsupported`
    }

    if( !has_transient_user_activation() ) {
        log.info( `Native file sharing needs a fresh user action`, {
            project_id: project.id,
            export_id: export_record.id
        } )
        return `activation-required`
    }

    try {
        log.info( `Native share sheet opening`, {
            project_id: project.id,
            export_id: export_record.id
        } )
        await navigator.share( {
            files: [ file ],
            title: project.title,
            text: `Video journal export`
        } )
        log.info( `Native share completed`, {
            project_id: project.id,
            export_id: export_record.id
        } )
        return `shared`
    } catch ( error ) {
        if( error.name === `AbortError` ) {
            log.info( `Native share cancelled`, {
                project_id: project.id,
                export_id: export_record.id
            } )
            return `cancelled`
        }

        log.warn( `Native share failed`, error )
        throw error
    }
}

/**
 * Downloads an export file as a browser fallback.
 * @param {Object} export_record - Export metadata.
 * @param {Blob} blob - Export blob.
 * @returns {void}
 */
export function download_export_file( export_record, blob ) {
    log.info( `Export download started`, {
        export_id: export_record.id,
        filename: export_record.filename,
        size: blob.size,
        mime_type: blob.type || export_record.mime_type
    } )
    const object_url = URL.createObjectURL( blob )
    const anchor = document.createElement( `a` )
    anchor.href = object_url
    anchor.download = export_record.filename
    anchor.rel = `noopener`
    document.body.append( anchor )
    anchor.click()
    anchor.remove()

    window.setTimeout( () => URL.revokeObjectURL( object_url ), DOWNLOAD_URL_REVOKE_MS )
}
