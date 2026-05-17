import { log } from 'mentie'
import {
    clear_all_records,
    delete_record,
    get_all_records,
    get_index_records,
    get_record,
    put_record,
    write_transaction
} from './db.js'

const ACTIVE_PROJECT_KEY = `daily_video_journal_active_project_id`
const SETTINGS_KEY = `global`

export const default_settings = {
    export_quality: `standard`,
    export_resolution: `source`,
    preferred_mime_type: null,
    haptics_enabled: true,
    sounds_enabled: false
}

const new_id = () => {
    if( globalThis.crypto?.randomUUID ) return crypto.randomUUID()

    const fallback_id = `${ Date.now() }-${ Math.random().toString( 16 ).slice( 2 ) }`
    return fallback_id
}

const now_iso = () => new Date().toISOString()

const safe_local_storage = {
    get: ( key ) => {
        try {
            return globalThis.localStorage?.getItem( key ) ?? null
        } catch ( error ) {
            log.warn( `Could not read localStorage`, error )
            return null
        }
    },
    set: ( key, value ) => {
        try {
            globalThis.localStorage?.setItem( key, value )
        } catch ( error ) {
            log.warn( `Could not write localStorage`, error )
        }
    },
    remove: ( key ) => {
        try {
            globalThis.localStorage?.removeItem( key )
        } catch ( error ) {
            log.warn( `Could not clear localStorage`, error )
        }
    }
}

const format_date_title = ( date ) => new Intl.DateTimeFormat(
    undefined,
    { month: `long`, day: `numeric`, year: `numeric` }
).format( date )

const make_default_project_title = async ( date = new Date() ) => {
    const base_title = format_date_title( date )
    const projects = await list_projects()
    const same_title_count = projects.filter( ( { title } ) => {
        return title === base_title || title.startsWith( `${ base_title } - ` )
    } ).length

    if( same_title_count === 0 ) return base_title
    return `${ base_title } - ${ same_title_count + 1 }`
}

const sort_projects = ( projects ) => [ ...projects ].sort( ( first, second ) => {
    return new Date( second.updated_at ).getTime() - new Date( first.updated_at ).getTime()
} )

const sort_clips = ( clips ) => [ ...clips ]
    .filter( ( { deleted_at } ) => !deleted_at )
    .sort( ( first, second ) => first.order_index - second.order_index )

const make_filename = ( title, mime_type ) => {
    const extension = mime_type.includes( `mp4` ) ? `mp4` : `webm`
    const slug = title
        .toLowerCase()
        .replace( /[^a-z0-9]+/g, `-` )
        .replace( /(^-|-$)/g, `` ) || `daily-video-journal`

    return `${ slug }.${ extension }`
}

/**
 * Loads all projects sorted by most recent activity.
 * @returns {Promise<Array>} Project records.
 */
export async function list_projects() {
    const projects = await get_all_records( `projects` )
    return sort_projects( projects )
}

/**
 * Loads one project.
 * @param {string} project_id - Project id.
 * @returns {Promise<Object|null>} Project record.
 */
export async function get_project( project_id ) {
    return get_record( `projects`, project_id )
}

/**
 * Finds the active project from the local boot hint or project activity.
 * @returns {Promise<Object|null>} Active project.
 */
export async function get_active_project() {
    const hinted_project_id = safe_local_storage.get( ACTIVE_PROJECT_KEY )
    const hinted_project = hinted_project_id ? await get_project( hinted_project_id ) : null

    if( hinted_project ) return hinted_project

    const projects = await list_projects()
    const [ active_project = null ] = [ ...projects ].sort( ( first, second ) => {
        return new Date( second.active_at ?? 0 ).getTime() - new Date( first.active_at ?? 0 ).getTime()
    } )

    if( active_project ) safe_local_storage.set( ACTIVE_PROJECT_KEY, active_project.id )
    return active_project
}

/**
 * Marks a project as active.
 * @param {string|null} project_id - Project id.
 * @returns {Promise<void>}
 */
export async function set_active_project( project_id ) {
    if( !project_id ) {
        safe_local_storage.remove( ACTIVE_PROJECT_KEY )
        return
    }

    const project = await get_project( project_id )
    if( !project ) return

    const updated_project = {
        ...project,
        active_at: now_iso(),
        updated_at: now_iso()
    }

    await put_record( `projects`, updated_project )
    safe_local_storage.set( ACTIVE_PROJECT_KEY, project_id )
}

/**
 * Creates a project and marks it active.
 * @returns {Promise<Object>} Created project.
 */
export async function create_project() {
    const timestamp = now_iso()
    const project = {
        id: new_id(),
        title: await make_default_project_title(),
        created_at: timestamp,
        updated_at: timestamp,
        active_at: timestamp,
        clip_count: 0,
        total_duration_ms: 0,
        export_settings: null
    }

    await put_record( `projects`, project )
    safe_local_storage.set( ACTIVE_PROJECT_KEY, project.id )
    await request_persistent_storage()

    return project
}

/**
 * Renames a project.
 * @param {string} project_id - Project id.
 * @param {string} title - New title.
 * @returns {Promise<Object>} Updated project.
 */
export async function rename_project( project_id, title ) {
    const project = await get_project( project_id )
    const updated_project = {
        ...project,
        title: title.trim() || project.title,
        updated_at: now_iso()
    }

    await put_record( `projects`, updated_project )
    return updated_project
}

/**
 * Deletes a project and associated media blobs.
 * @param {string} project_id - Project id.
 * @returns {Promise<void>}
 */
export async function delete_project( project_id ) {
    const clips = await get_index_records( `clips`, `project_id`, project_id )
    const exports = await get_index_records( `exports`, `project_id`, project_id )
    const store_names = [ `projects`, `clips`, `clip_blobs`, `exports`, `export_blobs` ]

    await write_transaction( store_names, ( stores ) => {
        stores.projects.delete( project_id )
        clips.forEach( ( { id } ) => {
            stores.clips.delete( id )
            stores.clip_blobs.delete( id )
        } )
        exports.forEach( ( { id } ) => {
            stores.exports.delete( id )
            stores.export_blobs.delete( id )
        } )
    } )

    if( safe_local_storage.get( ACTIVE_PROJECT_KEY ) === project_id ) safe_local_storage.remove( ACTIVE_PROJECT_KEY )
}

/**
 * Stores clip metadata and blob data for a project.
 * @param {Object} options - Clip details.
 * @param {string} options.project_id - Project id.
 * @param {Blob} options.blob - Recorded video blob.
 * @param {string} options.mime_type - Actual recorder MIME type.
 * @param {number} options.duration_ms - Clip duration.
 * @param {number|null} options.width - Clip width.
 * @param {number|null} options.height - Clip height.
 * @param {Blob|null} options.thumbnail_blob - Generated thumbnail.
 * @returns {Promise<Object>} Stored clip metadata.
 */
export async function add_clip_to_project( {
    project_id,
    blob,
    mime_type,
    duration_ms,
    width = null,
    height = null,
    thumbnail_blob = null
} ) {
    const project = await get_project( project_id )
    const timestamp = now_iso()
    const clip = {
        id: new_id(),
        project_id,
        order_index: project.clip_count,
        mime_type,
        duration_ms,
        width,
        height,
        created_at: timestamp,
        thumbnail_blob,
        deleted_at: null
    }
    const updated_project = {
        ...project,
        clip_count: project.clip_count + 1,
        total_duration_ms: project.total_duration_ms + duration_ms,
        updated_at: timestamp
    }

    await write_transaction( [ `projects`, `clips`, `clip_blobs` ], ( stores ) => {
        stores.clips.put( clip )
        stores.clip_blobs.put( { id: clip.id, project_id, blob } )
        stores.projects.put( updated_project )
    } )

    await request_persistent_storage()
    return clip
}

/**
 * Loads non-deleted clip metadata for a project without loading main video blobs.
 * @param {string} project_id - Project id.
 * @returns {Promise<Array>} Clip metadata.
 */
export async function get_project_clips( project_id ) {
    const clips = await get_index_records( `clips`, `project_id`, project_id )
    return sort_clips( clips )
}

/**
 * Loads one clip's video blob.
 * @param {string} clip_id - Clip id.
 * @returns {Promise<Blob|null>} Video blob.
 */
export async function get_clip_blob( clip_id ) {
    const record = await get_record( `clip_blobs`, clip_id )
    return record?.blob ?? null
}

/**
 * Marks a clip as deleted and removes its video blob.
 * @param {string} clip_id - Clip id.
 * @returns {Promise<void>}
 */
export async function delete_clip( clip_id ) {
    const clip = await get_record( `clips`, clip_id )
    if( !clip || clip.deleted_at ) return

    const project = await get_project( clip.project_id )
    const updated_clip = { ...clip, deleted_at: now_iso() }
    const updated_project = {
        ...project,
        clip_count: Math.max( 0, project.clip_count - 1 ),
        total_duration_ms: Math.max( 0, project.total_duration_ms - clip.duration_ms ),
        updated_at: now_iso()
    }

    await write_transaction( [ `projects`, `clips`, `clip_blobs` ], ( stores ) => {
        stores.clips.put( updated_clip )
        stores.clip_blobs.delete( clip_id )
        stores.projects.put( updated_project )
    } )
}

/**
 * Loads global settings, creating defaults when missing.
 * @returns {Promise<Object>} Settings.
 */
export async function load_settings() {
    const stored_settings = await get_record( `settings`, SETTINGS_KEY )

    if( stored_settings ) {
        const settings = { ...stored_settings }
        delete settings.key
        return { ...default_settings, ...settings }
    }

    await save_settings( default_settings )
    return default_settings
}

/**
 * Persists global settings.
 * @param {Object} settings - Settings patch or full object.
 * @returns {Promise<Object>} Saved settings.
 */
export async function save_settings( settings ) {
    const existing_settings = await get_record( `settings`, SETTINGS_KEY )
    const saved_settings = {
        ...default_settings,
        ...existing_settings,
        ...settings,
        key: SETTINGS_KEY
    }

    await put_record( `settings`, saved_settings )

    const settings_without_key = { ...saved_settings }
    delete settings_without_key.key
    return settings_without_key
}

/**
 * Stores a compiled export and its blob.
 * @param {Object} options - Export details.
 * @returns {Promise<Object>} Export metadata.
 */
export async function save_export_record( {
    project_id,
    blob,
    mime_type,
    settings_hash,
    clip_manifest_hash,
    duration_ms
} ) {
    const project = await get_project( project_id )
    const export_record = {
        id: new_id(),
        project_id,
        mime_type,
        filename: make_filename( project.title, mime_type ),
        settings_hash,
        clip_manifest_hash,
        duration_ms,
        created_at: now_iso()
    }

    await write_transaction( [ `exports`, `export_blobs` ], ( stores ) => {
        stores.exports.put( export_record )
        stores.export_blobs.put( { id: export_record.id, project_id, blob } )
    } )

    return export_record
}

/**
 * Finds a cached export matching current settings and clip manifest hashes.
 * @param {Object} options - Cache lookup details.
 * @param {string} options.project_id - Project id.
 * @param {string} options.settings_hash - Settings hash.
 * @param {string} options.clip_manifest_hash - Clip manifest hash.
 * @returns {Promise<Object|null>} Matching export metadata.
 */
export async function get_valid_cached_export( { project_id, settings_hash, clip_manifest_hash } ) {
    const exports = await get_index_records( `exports`, `project_id`, project_id )
    const matching_exports = exports
        .filter( ( export_record ) => {
            return export_record.settings_hash === settings_hash
                && export_record.clip_manifest_hash === clip_manifest_hash
        } )
        .sort( ( first, second ) => new Date( second.created_at ).getTime() - new Date( first.created_at ).getTime() )

    return matching_exports.at( 0 ) ?? null
}

/**
 * Loads one export blob.
 * @param {string} export_id - Export id.
 * @returns {Promise<Blob|null>} Export blob.
 */
export async function get_export_blob( export_id ) {
    const record = await get_record( `export_blobs`, export_id )
    return record?.blob ?? null
}

/**
 * Deletes all local journal data.
 * @returns {Promise<void>}
 */
export async function delete_all_data() {
    await clear_all_records()
    safe_local_storage.remove( ACTIVE_PROJECT_KEY )
}

/**
 * Estimates local browser storage usage when available.
 * @returns {Promise<Object|null>} Storage estimate.
 */
export async function estimate_storage() {
    if( !globalThis.navigator?.storage?.estimate ) return null
    return navigator.storage.estimate()
}

/**
 * Requests persistent browser storage when available.
 * @returns {Promise<boolean|null>} Persistence result.
 */
export async function request_persistent_storage() {
    if( !globalThis.navigator?.storage?.persist ) return null

    try {
        return await navigator.storage.persist()
    } catch ( error ) {
        log.warn( `Persistent storage request failed`, error )
        return false
    }
}

/**
 * Checks whether persistent browser storage is already granted.
 * @returns {Promise<boolean|null>} Persistence state.
 */
export async function persisted_storage() {
    if( !globalThis.navigator?.storage?.persisted ) return null
    return navigator.storage.persisted()
}

/**
 * Deletes one export metadata/blob pair.
 * @param {string} export_id - Export id.
 * @returns {Promise<void>}
 */
export async function delete_export( export_id ) {
    await delete_record( `exports`, export_id )
    await delete_record( `export_blobs`, export_id )
}
