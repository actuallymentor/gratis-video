import { log } from 'mentie/modules/logging.js'

const DOWNLOAD_URL_REVOKE_MS = 60_000

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
        { type: export_record.mime_type || blob.type || `video/webm` }
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
 * @returns {Promise<string>} `shared` or `unsupported`.
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
