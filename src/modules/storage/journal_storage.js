import { log } from 'mentie/modules/logging.js'
import { create_export_hashes } from '../export/cache.js'
import { normalize_export_settings } from '../export/settings.js'
import {
    clear_all_records,
    get_all_records,
    get_index_records,
    get_record,
    has_record,
    put_record,
    write_transaction,
    write_transaction_result
} from './db.js'

const ACTIVE_PROJECT_KEY = `daily_video_journal_active_project_id`
const ACTIVE_PROJECT_STATE_KEY = `active_project`
const SETTINGS_KEY = `global`
const export_setting_keys = [
    `export_quality`,
    `export_resolution`,
    `preferred_mime_type`
]

let first_clip_persistence_requested = false

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

const strip_clip_blob_fields = ( clip ) => {
    const metadata = { ...clip }

    delete metadata.blob
    delete metadata.thumbnail_blob

    return metadata
}

const sort_clips = ( clips ) => [ ...clips ]
    .filter( ( { deleted_at } ) => !deleted_at )
    .sort( ( first, second ) => first.order_index - second.order_index )
    .map( strip_clip_blob_fields )

const increment_clip_version = ( clip, timestamp ) => ( {
    ...strip_clip_blob_fields( clip ),
    version: ( clip.version ?? 1 ) + 1,
    updated_at: timestamp
} )

const delete_export_records = async ( export_records ) => {
    if( !export_records.length ) return

    await write_transaction( [ `exports`, `export_blobs` ], ( stores ) => {
        export_records.forEach( ( { id } ) => {
            stores.exports.delete( id )
            stores.export_blobs.delete( id )
        } )
    } )
}

const filter_exports_with_existing_blobs = async ( export_records ) => {
    const export_states = await Promise.all(
        export_records.map( async ( export_record ) => ( {
            export_record,
            has_blob: await has_record( `export_blobs`, export_record.id )
        } ) )
    )
    const missing_export_records = export_states
        .filter( ( { has_blob } ) => !has_blob )
        .map( ( { export_record } ) => export_record )

    await delete_export_records( missing_export_records )

    return export_states
        .filter( ( { has_blob } ) => has_blob )
        .map( ( { export_record } ) => export_record )
}

const prune_stale_project_exports = async ( project_id ) => {
    const [ exports, clips, settings ] = await Promise.all( [
        get_index_records( `exports`, `project_id`, project_id ),
        get_index_records( `clips`, `project_id`, project_id ),
        load_settings()
    ] )
    const current_clips = sort_clips( clips )
    const normalized_settings = normalize_export_settings( settings )
    const { settings_hash, clip_manifest_hash } = create_export_hashes( {
        clips: current_clips,
        settings: normalized_settings
    } )
    const stale_export_records = exports.filter( ( export_record ) => {
        return export_record.settings_hash !== settings_hash
            || export_record.clip_manifest_hash !== clip_manifest_hash
    } )

    await delete_export_records( stale_export_records )
}

const with_project_export_status = async ( project, normalized_settings ) => {
    const [ exports, clips ] = await Promise.all( [
        get_index_records( `exports`, `project_id`, project.id ),
        get_index_records( `clips`, `project_id`, project.id )
    ] )
    const current_clips = sort_clips( clips )
    const { settings_hash, clip_manifest_hash } = create_export_hashes( {
        clips: current_clips,
        settings: normalized_settings
    } )
    const existing_exports = await filter_exports_with_existing_blobs( exports )
    const matching_exports = existing_exports.filter( ( export_record ) => {
        return export_record.settings_hash === settings_hash
            && export_record.clip_manifest_hash === clip_manifest_hash
    } )
    const [ latest_export = null ] = [ ...matching_exports ].sort( ( first, second ) => {
        return new Date( second.created_at ).getTime() - new Date( first.created_at ).getTime()
    } )

    return {
        ...project,
        export_count: existing_exports.length,
        valid_export_count: matching_exports.length,
        last_exported_at: latest_export?.created_at ?? null
    }
}

const next_clip_order_index = ( clips ) => {
    const highest_order_index = clips.reduce( ( highest, { order_index = -1 } ) => {
        return Math.max( highest, order_index )
    }, -1 )

    return highest_order_index + 1
}

const project_not_found_error = () => new Error( `Project not found.` )

const fail_request = ( fail, message ) => ( event ) => {
    fail( event.target.error ?? new Error( message ) )
}

const load_active_project_pointer = async () => {
    const state = await get_record( `settings`, ACTIVE_PROJECT_STATE_KEY )

    if( state && Object.hasOwn( state, `project_id` ) ) {
        return {
            exists: true,
            project_id: state.project_id
        }
    }

    return {
        exists: false,
        project_id: safe_local_storage.get( ACTIVE_PROJECT_KEY )
    }
}

const save_active_project_pointer = async ( project_id ) => {
    await put_record( `settings`, {
        key: ACTIVE_PROJECT_STATE_KEY,
        project_id: project_id ?? null,
        updated_at: now_iso()
    } )

    if( project_id ) safe_local_storage.set( ACTIVE_PROJECT_KEY, project_id )
    else safe_local_storage.remove( ACTIVE_PROJECT_KEY )
}

/**
 * Creates a friendly export filename from a project title and MIME type.
 * @param {string} title - Project title.
 * @param {string} mime_type - Export MIME type.
 * @returns {string} Download/share filename.
 */
export const make_export_filename = ( title, mime_type ) => {
    const extension = mime_type.includes( `mp4` ) ? `mp4` : `webm`
    const slug = title
        .toLowerCase()
        .replace( /[^a-z0-9]+/g, `-` )
        .replace( /(^-|-$)/g, `` ) || `daily-video-journal`

    return `${ slug }.${ extension }`
}

const export_settings_changed = ( previous_settings, next_settings ) => {
    return export_setting_keys.some( ( key ) => previous_settings[ key ] !== next_settings[ key ] )
}

const update_project_export_filenames = async ( project_id, title ) => {
    const exports = await get_index_records( `exports`, `project_id`, project_id )
    if( !exports.length ) return

    await write_transaction( [ `exports` ], ( stores ) => {
        exports.forEach( ( export_record ) => {
            stores.exports.put( {
                ...export_record,
                filename: make_export_filename( title, export_record.mime_type )
            } )
        } )
    } )
}

const prune_stale_exports_for_all_projects = async () => {
    const projects = await get_all_records( `projects` )

    await Promise.all(
        projects.map( ( { id } ) => prune_stale_project_exports( id ) )
    )
}

const request_persistent_storage_soon = () => {
    request_persistent_storage().catch( ( error ) => {
        log.warn( `Persistent storage request failed`, error )
    } )
}

/**
 * Loads all projects sorted by most recent activity.
 * @returns {Promise<Array>} Project records.
 */
export async function list_projects() {
    const [ projects, settings ] = await Promise.all( [
        get_all_records( `projects` ),
        load_settings()
    ] )
    const normalized_settings = normalize_export_settings( settings )
    const projects_with_export_status = await Promise.all(
        projects.map( ( project ) => with_project_export_status( project, normalized_settings ) )
    )

    return sort_projects( projects_with_export_status )
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
    const active_pointer = await load_active_project_pointer()
    const hinted_project = active_pointer.project_id ? await get_project( active_pointer.project_id ) : null

    if( hinted_project ) {
        if( !active_pointer.exists ) await save_active_project_pointer( hinted_project.id )
        return hinted_project
    }

    if( active_pointer.exists ) {
        if( active_pointer.project_id ) await save_active_project_pointer( null )
        return null
    }

    const projects = await list_projects()
    const [ active_project = null ] = [ ...projects ].sort( ( first, second ) => {
        return new Date( second.active_at ?? 0 ).getTime() - new Date( first.active_at ?? 0 ).getTime()
    } )

    await save_active_project_pointer( active_project?.id ?? null )
    return active_project
}

/**
 * Marks a project as active.
 * @param {string|null} project_id - Project id.
 * @returns {Promise<void>}
 */
export async function set_active_project( project_id ) {
    if( !project_id ) {
        await save_active_project_pointer( null )
        return
    }

    const project = await get_project( project_id )
    if( !project ) {
        await save_active_project_pointer( null )
        return
    }

    const updated_project = {
        ...project,
        active_at: now_iso()
    }

    await put_record( `projects`, updated_project )
    await save_active_project_pointer( project_id )
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
    await save_active_project_pointer( project.id )
    request_persistent_storage_soon()

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
    if( !project ) throw new Error( `Project not found.` )

    const next_title = title.trim() || project.title
    const updated_project = {
        ...project,
        title: next_title,
        updated_at: now_iso()
    }

    await put_record( `projects`, updated_project )
    await update_project_export_filenames( project_id, next_title )

    return updated_project
}

/**
 * Deletes a project and associated media blobs.
 * @param {string} project_id - Project id.
 * @returns {Promise<void>}
 */
export async function delete_project( project_id ) {
    const active_pointer = await load_active_project_pointer()
    const store_names = [ `projects`, `clips`, `clip_blobs`, `clip_thumbnails`, `exports`, `export_blobs` ]

    await write_transaction_result( store_names, ( stores, { complete, fail } ) => {
        const clips_request = stores.clips.index( `project_id` ).getAll( project_id )
        const exports_request = stores.exports.index( `project_id` ).getAll( project_id )
        let clips = []
        let exports = []
        let clips_loaded = false
        let exports_loaded = false

        const delete_when_ready = () => {
            if( !clips_loaded || !exports_loaded ) return

            stores.projects.delete( project_id )
            clips.forEach( ( { id } ) => {
                stores.clips.delete( id )
                stores.clip_blobs.delete( id )
                stores.clip_thumbnails.delete( id )
            } )
            exports.forEach( ( { id } ) => {
                stores.exports.delete( id )
                stores.export_blobs.delete( id )
            } )
            complete()
        }

        clips_request.onerror = fail_request( fail, `Could not load project clips before deletion.` )
        exports_request.onerror = fail_request( fail, `Could not load project exports before deletion.` )
        clips_request.onsuccess = () => {
            clips = clips_request.result
            clips_loaded = true
            delete_when_ready()
        }
        exports_request.onsuccess = () => {
            exports = exports_request.result
            exports_loaded = true
            delete_when_ready()
        }
    } )

    if(
        active_pointer.project_id === project_id
        || safe_local_storage.get( ACTIVE_PROJECT_KEY ) === project_id
    ) {
        await save_active_project_pointer( null )
    }
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
    const clip = await write_transaction_result( [
        `projects`,
        `clips`,
        `clip_blobs`,
        `clip_thumbnails`
    ], ( stores, { complete, fail } ) => {
        const project_request = stores.projects.get( project_id )
        const clips_request = stores.clips.index( `project_id` ).getAll( project_id )
        let project = null
        let existing_clips = []
        let project_loaded = false
        let clips_loaded = false

        const save_when_ready = () => {
            if( !project_loaded || !clips_loaded ) return
            if( !project ) {
                fail( project_not_found_error() )
                return
            }

            const timestamp = now_iso()
            const clip = {
                id: new_id(),
                project_id,
                order_index: next_clip_order_index( existing_clips ),
                version: 1,
                mime_type,
                duration_ms,
                width,
                height,
                created_at: timestamp,
                updated_at: timestamp,
                deleted_at: null
            }
            const updated_project = {
                ...project,
                clip_count: project.clip_count + 1,
                total_duration_ms: project.total_duration_ms + duration_ms,
                updated_at: timestamp
            }

            stores.clips.put( clip )
            stores.clip_blobs.put( { id: clip.id, project_id, blob } )
            if( thumbnail_blob ) stores.clip_thumbnails.put( { id: clip.id, project_id, blob: thumbnail_blob } )
            stores.projects.put( updated_project )
            complete( clip )
        }

        project_request.onerror = fail_request( fail, `Could not load project before saving clip.` )
        clips_request.onerror = fail_request( fail, `Could not load project clips before saving clip.` )
        project_request.onsuccess = () => {
            project = project_request.result ?? null
            project_loaded = true
            save_when_ready()
        }
        clips_request.onsuccess = () => {
            existing_clips = clips_request.result
            clips_loaded = true
            save_when_ready()
        }
    } )

    if( !first_clip_persistence_requested ) {
        first_clip_persistence_requested = true
        request_persistent_storage_soon()
    }

    await prune_stale_project_exports( project_id ).catch( ( error ) => {
        log.warn( `Could not prune stale exports after clip save`, error )
    } )

    return clip
}

/**
 * Updates recorded clip details after the queue entry already exists.
 * @param {Object} options - Media details.
 * @param {string} options.clip_id - Clip id.
 * @param {number} options.duration_ms - Refined clip duration.
 * @param {number|null} options.width - Clip width.
 * @param {number|null} options.height - Clip height.
 * @param {Blob|null} options.thumbnail_blob - Generated thumbnail.
 * @returns {Promise<Object|null>} Updated clip metadata.
 */
export async function update_clip_media_details( {
    clip_id,
    duration_ms,
    width = null,
    height = null,
    thumbnail_blob = null
} ) {
    const updated_clip = await write_transaction_result( [
        `projects`,
        `clips`,
        `clip_thumbnails`
    ], ( stores, { complete, fail } ) => {
        const clip_request = stores.clips.get( clip_id )

        clip_request.onerror = fail_request( fail, `Could not load clip before updating media details.` )
        clip_request.onsuccess = () => {
            const clip = clip_request.result

            if( !clip || clip.deleted_at ) {
                complete( null )
                return
            }

            const project_request = stores.projects.get( clip.project_id )

            project_request.onerror = fail_request( fail, `Could not load project before updating clip media details.` )
            project_request.onsuccess = () => {
                const project = project_request.result

                if( !project ) {
                    complete( null )
                    return
                }

                const next_duration_ms = duration_ms || clip.duration_ms
                const duration_delta_ms = next_duration_ms - clip.duration_ms
                const timestamp = now_iso()
                const updated_clip = {
                    ...strip_clip_blob_fields( clip ),
                    duration_ms: next_duration_ms,
                    width: width ?? clip.width,
                    height: height ?? clip.height,
                    updated_at: timestamp
                }
                const updated_project = {
                    ...project,
                    total_duration_ms: Math.max( 0, project.total_duration_ms + duration_delta_ms ),
                    updated_at: timestamp
                }

                stores.clips.put( updated_clip )
                if( thumbnail_blob ) stores.clip_thumbnails.put( {
                    id: clip_id,
                    project_id: clip.project_id,
                    blob: thumbnail_blob
                } )
                stores.projects.put( updated_project )
                complete( updated_clip )
            }
        }
    } )

    if( !updated_clip ) return null

    await prune_stale_project_exports( updated_clip.project_id ).catch( ( error ) => {
        log.warn( `Could not prune stale exports after clip media update`, error )
    } )

    return updated_clip
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
 * Loads one clip's thumbnail blob.
 * @param {string} clip_id - Clip id.
 * @returns {Promise<Blob|null>} Thumbnail blob.
 */
export async function get_clip_thumbnail_blob( clip_id ) {
    const record = await get_record( `clip_thumbnails`, clip_id )
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
    if( !project ) return

    const updated_clip = {
        ...strip_clip_blob_fields( clip ),
        deleted_at: now_iso()
    }
    const updated_project = {
        ...project,
        clip_count: Math.max( 0, project.clip_count - 1 ),
        total_duration_ms: Math.max( 0, project.total_duration_ms - clip.duration_ms ),
        updated_at: now_iso()
    }

    await write_transaction( [ `projects`, `clips`, `clip_blobs`, `clip_thumbnails` ], ( stores ) => {
        stores.clips.put( updated_clip )
        stores.clip_blobs.delete( clip_id )
        stores.clip_thumbnails.delete( clip_id )
        stores.projects.put( updated_project )
    } )
    await prune_stale_project_exports( clip.project_id ).catch( ( error ) => {
        log.warn( `Could not prune stale exports after clip deletion`, error )
    } )
}

/**
 * Moves one clip earlier or later in its project queue.
 * @param {string} clip_id - Clip id to move.
 * @param {string} direction - `earlier` or `later`.
 * @returns {Promise<Array>} Updated project clip queue.
 */
export async function move_clip( clip_id, direction ) {
    const clip = await get_record( `clips`, clip_id )
    if( !clip || clip.deleted_at ) return []

    const project = await get_project( clip.project_id )
    if( !project ) return []

    const project_clips = await get_index_records( `clips`, `project_id`, clip.project_id )
    const active_clips = [ ...project_clips ]
        .filter( ( { deleted_at } ) => !deleted_at )
        .sort( ( first, second ) => first.order_index - second.order_index )
    const clip_index = active_clips.findIndex( ( { id } ) => id === clip_id )
    const offset = direction === `earlier` ? -1 : 1
    const target_index = clip_index + offset
    const target_clip = active_clips[ target_index ]

    if( clip_index === -1 || !target_clip ) return sort_clips( project_clips )

    const timestamp = now_iso()
    const moved_clip = {
        ...increment_clip_version( active_clips[ clip_index ], timestamp ),
        order_index: target_clip.order_index
    }
    const swapped_clip = {
        ...increment_clip_version( target_clip, timestamp ),
        order_index: active_clips[ clip_index ].order_index
    }
    const updated_project = {
        ...project,
        updated_at: timestamp
    }

    await write_transaction( [ `projects`, `clips` ], ( stores ) => {
        stores.clips.put( moved_clip )
        stores.clips.put( swapped_clip )
        stores.projects.put( updated_project )
    } )
    await prune_stale_project_exports( clip.project_id ).catch( ( error ) => {
        log.warn( `Could not prune stale exports after clip reorder`, error )
    } )

    return get_project_clips( clip.project_id )
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
    const previous_settings = {
        ...default_settings,
        ...existing_settings
    }
    const saved_settings = {
        ...default_settings,
        ...existing_settings,
        ...settings,
        key: SETTINGS_KEY
    }

    await put_record( `settings`, saved_settings )

    const settings_without_key = { ...saved_settings }
    delete settings_without_key.key

    if( export_settings_changed( previous_settings, settings_without_key ) ) {
        await prune_stale_exports_for_all_projects()
    }

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
    return write_transaction_result( [ `projects`, `exports`, `export_blobs` ], ( stores, { complete, fail } ) => {
        const project_request = stores.projects.get( project_id )

        project_request.onerror = fail_request( fail, `Could not load project before saving export.` )
        project_request.onsuccess = () => {
            const project = project_request.result
            if( !project ) {
                fail( project_not_found_error() )
                return
            }

            const export_record = {
                id: new_id(),
                project_id,
                mime_type,
                filename: make_export_filename( project.title, mime_type ),
                settings_hash,
                clip_manifest_hash,
                duration_ms,
                created_at: now_iso()
            }

            stores.exports.put( export_record )
            stores.export_blobs.put( { id: export_record.id, project_id, blob } )
            complete( export_record )
        }
    } )
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
    const valid_exports = await filter_exports_with_existing_blobs( matching_exports )

    return valid_exports.at( 0 ) ?? null
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
    first_clip_persistence_requested = false
}

/**
 * Estimates local browser storage usage when available.
 * @returns {Promise<Object|null>} Storage estimate.
 */
export async function estimate_storage() {
    if( !globalThis.navigator?.storage?.estimate ) return null

    try {
        return await navigator.storage.estimate()
    } catch ( error ) {
        log.warn( `Storage estimate failed`, error )
        return null
    }
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

    try {
        return await navigator.storage.persisted()
    } catch ( error ) {
        log.warn( `Storage persistence check failed`, error )
        return null
    }
}

/**
 * Deletes one export metadata/blob pair.
 * @param {string} export_id - Export id.
 * @returns {Promise<void>}
 */
export async function delete_export( export_id ) {
    await write_transaction( [ `exports`, `export_blobs` ], ( stores ) => {
        stores.exports.delete( export_id )
        stores.export_blobs.delete( export_id )
    } )
}
