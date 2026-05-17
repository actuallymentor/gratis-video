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
    if( !navigator.canShare ) return true
    return navigator.canShare( { files: [ file ] } )
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

    if( !can_share_file( file ) ) return `unsupported`

    try {
        await navigator.share( {
            files: [ file ],
            title: project.title,
            text: `Video journal export`
        } )
        return `shared`
    } catch ( error ) {
        if( error.name === `AbortError` ) return `cancelled`
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
    const object_url = URL.createObjectURL( blob )
    const anchor = document.createElement( `a` )
    anchor.href = object_url
    anchor.download = export_record.filename
    anchor.rel = `noopener`
    document.body.append( anchor )
    anchor.click()
    anchor.remove()

    window.setTimeout( () => URL.revokeObjectURL( object_url ), 1000 )
}
