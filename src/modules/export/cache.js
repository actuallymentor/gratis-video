const stable_json = ( value ) => {
    if( Array.isArray( value ) ) return `[${ value.map( stable_json ).join( `,` ) }]`
    if( value && typeof value === `object` ) {
        const keys = Object.keys( value ).sort()
        return `{${ keys.map( ( key ) => `${ JSON.stringify( key ) }:${ stable_json( value[ key ] ) }` ).join( `,` ) }}`
    }

    return JSON.stringify( value )
}

const fnv_1a = ( text ) => {
    let hash = 0x811c9dc5

    Array.from( text ).forEach( ( character ) => {
        hash ^= character.charCodeAt( 0 )
        hash = Math.imul( hash, 0x01000193 )
    } )

    return ( hash >>> 0 ).toString( 16 ).padStart( 8, `0` )
}

/**
 * Creates a deterministic hash for plain structured data.
 * @param {*} value - Hash input.
 * @returns {string} Stable hash.
 */
export function stable_hash( value ) {
    return fnv_1a( stable_json( value ) )
}

/**
 * Creates the manifest used to decide if cached exports are stale.
 * @param {Array<Object>} clips - Clip metadata in queue order.
 * @returns {Array<Object>} Hashable clip manifest.
 */
export function create_clip_manifest( clips ) {
    return clips.map( ( {
        id,
        order_index,
        version,
        mime_type,
        duration_ms,
        width,
        height,
        created_at,
        updated_at
    } ) => ( {
        id,
        order_index,
        version,
        mime_type,
        duration_ms,
        width,
        height,
        created_at,
        updated_at
    } ) )
}

/**
 * Creates hashes for export settings and clip order.
 * @param {Object} options - Hash input.
 * @param {Array<Object>} options.clips - Clip metadata.
 * @param {Object} options.settings - Export settings.
 * @returns {Object} Cache hashes.
 */
export function create_export_hashes( { clips, settings } ) {
    return {
        settings_hash: stable_hash( {
            export_quality: settings.export_quality,
            export_resolution: settings.export_resolution,
            preferred_mime_type: settings.preferred_mime_type
        } ),
        clip_manifest_hash: stable_hash( create_clip_manifest( clips ) )
    }
}
