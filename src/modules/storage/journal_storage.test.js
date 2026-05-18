import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { delete_record, put_record, reset_db_connection } from './db.js'
import {
    add_clip_to_project,
    create_project,
    delete_all_data,
    delete_clip,
    delete_export,
    delete_project,
    estimate_storage,
    get_active_project,
    get_clip_blob,
    get_clip_thumbnail_blob,
    get_export_blob,
    get_project,
    get_valid_cached_export,
    get_project_clips,
    list_projects,
    load_settings,
    move_clip,
    persisted_storage,
    rename_project,
    request_persistent_storage,
    save_export_record,
    save_settings,
    set_active_project,
    update_clip_media_details
} from './journal_storage.js'
import { create_export_hashes } from '../export/cache.js'
import { normalize_export_settings } from '../export/settings.js'

describe( `journal storage`, () => {
    beforeEach( async () => {
        vi.stubGlobal( `navigator`, {} )
        reset_db_connection()
        await delete_all_data()
    } )

    afterEach( () => {
        vi.unstubAllGlobals()
    } )

    test( `creates projects and stores clip blobs outside metadata`, async () => {
        const thumbnail_blob = new Blob( [ `thumb` ], { type: `image/jpeg` } )
        const project = await create_project()
        const clip = await add_clip_to_project( {
            project_id: project.id,
            blob: new Blob( [ `video` ], { type: `video/webm` } ),
            mime_type: `video/webm`,
            duration_ms: 1200,
            width: 640,
            height: 360,
            thumbnail_blob
        } )

        const [ stored_project ] = await list_projects()
        const clips = await get_project_clips( project.id )
        const blob = await get_clip_blob( clip.id )
        const stored_thumbnail_blob = await get_clip_thumbnail_blob( clip.id )

        expect( stored_project.clip_count ).toBe( 1 )
        expect( clips ).toHaveLength( 1 )
        expect( clips[ 0 ].blob ).toBeUndefined()
        expect( clips[ 0 ].thumbnail_blob ).toBeUndefined()
        expect( clips[ 0 ].version ).toBe( 1 )
        expect( clips[ 0 ].updated_at ).toBeTruthy()
        expect( blob.type ).toBe( `video/webm` )
        expect( await stored_thumbnail_blob.text() ).toBe( `thumb` )
    } )

    test( `refuses to save clip media when the project is missing`, async () => {
        await expect( add_clip_to_project( {
            project_id: `missing-project`,
            blob: new Blob( [ `video` ], { type: `video/webm` } ),
            mime_type: `video/webm`,
            duration_ms: 1200
        } ) ).rejects.toThrow( /Project not found/ )

        expect( await get_project_clips( `missing-project` ) ).toEqual( [] )
    } )

    test( `requests persistent storage after project and clip creation`, async () => {
        const persist = vi.fn().mockResolvedValue( true )

        vi.stubGlobal( `navigator`, {
            storage: { persist }
        } )

        const project = await create_project()

        expect( persist ).toHaveBeenCalledTimes( 1 )

        await add_clip_to_project( {
            project_id: project.id,
            blob: new Blob( [ `video` ], { type: `video/webm` } ),
            mime_type: `video/webm`,
            duration_ms: 1200
        } )

        expect( persist ).toHaveBeenCalledTimes( 2 )

        await add_clip_to_project( {
            project_id: project.id,
            blob: new Blob( [ `second` ], { type: `video/webm` } ),
            mime_type: `video/webm`,
            duration_ms: 900
        } )

        expect( persist ).toHaveBeenCalledTimes( 2 )
    } )

    test( `loads clips and blobs after reopening local storage`, async () => {
        const project = await create_project()
        const clip = await add_clip_to_project( {
            project_id: project.id,
            blob: new Blob( [ `persisted-video` ], { type: `video/webm` } ),
            mime_type: `video/webm`,
            duration_ms: 1500,
            width: 640,
            height: 360
        } )

        reset_db_connection()

        const reloaded_project = await get_project( project.id )
        const reloaded_clips = await get_project_clips( project.id )
        const reloaded_blob = await get_clip_blob( clip.id )

        expect( reloaded_project.title ).toBe( project.title )
        expect( reloaded_clips.map( ( { id } ) => id ) ).toEqual( [ clip.id ] )
        expect( await reloaded_blob.text() ).toBe( `persisted-video` )
    } )

    test( `creates duplicate same-day project titles without a naming step`, async () => {
        const first_project = await create_project()
        const second_project = await create_project()

        expect( second_project.title ).toBe( `${ first_project.title } - 2` )
    } )

    test( `creates unique default titles during concurrent project creation`, async () => {
        const projects = await Promise.all( [
            create_project(),
            create_project()
        ] )
        const titles = projects.map( ( { title } ) => title )

        expect( new Set( titles ).size ).toBe( 2 )
        expect( titles.some( ( title ) => title.endsWith( ` - 2` ) ) ).toBe( true )
    } )

    test( `lists projects by most recently updated first`, async () => {
        const first_project = await create_project()

        await new Promise( ( resolve ) => setTimeout( resolve, 5 ) )
        const second_project = await create_project()

        expect( ( await list_projects() ).map( ( { id } ) => id ) ).toEqual( [
            second_project.id,
            first_project.id
        ] )

        await new Promise( ( resolve ) => setTimeout( resolve, 5 ) )
        await rename_project( first_project.id, `Updated project` )

        expect( ( await list_projects() ).map( ( { id } ) => id ) ).toEqual( [
            first_project.id,
            second_project.id
        ] )
    } )

    test( `marks active projects without changing project history order`, async () => {
        const project = await create_project()
        const original_project = await get_project( project.id )

        await new Promise( ( resolve ) => setTimeout( resolve, 5 ) )
        await set_active_project( project.id )

        const active_project = await get_active_project()
        const updated_project = await get_project( project.id )

        expect( active_project.id ).toBe( project.id )
        expect( updated_project.updated_at ).toBe( original_project.updated_at )
        expect( new Date( updated_project.active_at ).getTime() ).toBeGreaterThanOrEqual(
            new Date( original_project.active_at ).getTime()
        )
    } )

    test( `keeps an explicitly cleared active project cleared after reload lookup`, async () => {
        await create_project()
        await create_project()

        await set_active_project( null )

        expect( await get_active_project() ).toBe( null )
    } )

    test( `does not resurrect an older project after deleting the active project`, async () => {
        await create_project()
        const active_project = await create_project()

        await delete_project( active_project.id )

        expect( await get_active_project() ).toBe( null )
    } )

    test( `deleting a stale boot hint does not clear the newer active project`, async () => {
        const local_values = new Map()
        const first_project = await create_project()
        const second_project = await create_project()

        vi.stubGlobal( `localStorage`, {
            getItem: vi.fn( ( key ) => local_values.get( key ) ?? null ),
            setItem: vi.fn( ( key, value ) => local_values.set( key, value ) ),
            removeItem: vi.fn( ( key ) => local_values.delete( key ) )
        } )

        await set_active_project( second_project.id )
        localStorage.setItem( `daily_video_journal_active_project_id`, first_project.id )

        await delete_project( first_project.id )

        expect( ( await get_active_project() ).id ).toBe( second_project.id )
        expect( localStorage.getItem( `daily_video_journal_active_project_id` ) ).toBe( null )
    } )

    test( `renames projects with trimmed titles and keeps defaults for blank titles`, async () => {
        const project = await create_project()

        const renamed_project = await rename_project( project.id, `  Pocket Walk  ` )
        const fallback_project = await rename_project( project.id, `   ` )

        expect( renamed_project.title ).toBe( `Pocket Walk` )
        expect( fallback_project.title ).toBe( `Pocket Walk` )
    } )

    test( `renaming a project keeps cached export filenames current`, async () => {
        const project = await create_project()
        const settings = await load_settings()
        const clip = await add_clip_to_project( {
            project_id: project.id,
            blob: new Blob( [ `video` ], { type: `video/webm` } ),
            mime_type: `video/webm`,
            duration_ms: 1200
        } )
        const { settings_hash, clip_manifest_hash } = create_export_hashes( {
            clips: [ clip ],
            settings
        } )

        await save_export_record( {
            project_id: project.id,
            blob: new Blob( [ `export` ], { type: `video/webm` } ),
            mime_type: `video/webm`,
            settings_hash,
            clip_manifest_hash,
            duration_ms: 1200
        } )

        await rename_project( project.id, `Pocket Walk` )

        const cached_export = await get_valid_cached_export( {
            project_id: project.id,
            settings_hash,
            clip_manifest_hash
        } )

        expect( cached_export.filename ).toBe( `pocket-walk.webm` )
    } )

    test( `late project rename does not restore a deleted project`, async () => {
        const project = await create_project()

        await Promise.allSettled( [
            rename_project( project.id, `Deleted rename` ),
            delete_project( project.id )
        ] )

        expect( await get_project( project.id ) ).toBe( undefined )
    } )

    test( `deleting a clip removes it from the queue and blob stores`, async () => {
        const project = await create_project()
        const clip = await add_clip_to_project( {
            project_id: project.id,
            blob: new Blob( [ `video` ], { type: `video/webm` } ),
            mime_type: `video/webm`,
            duration_ms: 1200,
            thumbnail_blob: new Blob( [ `thumb` ], { type: `image/jpeg` } )
        } )

        await delete_clip( clip.id )

        expect( await get_project_clips( project.id ) ).toEqual( [] )
        expect( await get_clip_blob( clip.id ) ).toBe( null )
        expect( await get_clip_thumbnail_blob( clip.id ) ).toBe( null )
    } )

    test( `late clip deletion does not restore a deleted project`, async () => {
        const project = await create_project()
        const clip = await add_clip_to_project( {
            project_id: project.id,
            blob: new Blob( [ `video` ], { type: `video/webm` } ),
            mime_type: `video/webm`,
            duration_ms: 1200,
            thumbnail_blob: new Blob( [ `thumb` ], { type: `image/jpeg` } )
        } )

        await Promise.allSettled( [
            delete_clip( clip.id ),
            delete_project( project.id )
        ] )

        expect( await get_project( project.id ) ).toBe( undefined )
        expect( await get_project_clips( project.id ) ).toEqual( [] )
        expect( await get_clip_blob( clip.id ) ).toBe( null )
        expect( await get_clip_thumbnail_blob( clip.id ) ).toBe( null )
    } )

    test( `keeps queue order stable when a clip is deleted before another is added`, async () => {
        const project = await create_project()
        const first_clip = await add_clip_to_project( {
            project_id: project.id,
            blob: new Blob( [ `first` ], { type: `video/webm` } ),
            mime_type: `video/webm`,
            duration_ms: 1000
        } )
        const second_clip = await add_clip_to_project( {
            project_id: project.id,
            blob: new Blob( [ `second` ], { type: `video/webm` } ),
            mime_type: `video/webm`,
            duration_ms: 1000
        } )

        await delete_clip( first_clip.id )

        const third_clip = await add_clip_to_project( {
            project_id: project.id,
            blob: new Blob( [ `third` ], { type: `video/webm` } ),
            mime_type: `video/webm`,
            duration_ms: 1000
        } )
        const clips = await get_project_clips( project.id )

        expect( clips.map( ( { id } ) => id ) ).toEqual( [ second_clip.id, third_clip.id ] )
        expect( clips.map( ( { order_index } ) => order_index ) ).toEqual( [ 1, 2 ] )
    } )

    test( `moves clips in queue order and prunes stale exports`, async () => {
        const project = await create_project()
        const settings = await load_settings()
        const first_clip = await add_clip_to_project( {
            project_id: project.id,
            blob: new Blob( [ `first` ], { type: `video/webm` } ),
            mime_type: `video/webm`,
            duration_ms: 1000
        } )
        const second_clip = await add_clip_to_project( {
            project_id: project.id,
            blob: new Blob( [ `second` ], { type: `video/webm` } ),
            mime_type: `video/webm`,
            duration_ms: 1000
        } )
        const third_clip = await add_clip_to_project( {
            project_id: project.id,
            blob: new Blob( [ `third` ], { type: `video/webm` } ),
            mime_type: `video/webm`,
            duration_ms: 1000
        } )
        const { settings_hash, clip_manifest_hash } = create_export_hashes( {
            clips: [ first_clip, second_clip, third_clip ],
            settings
        } )
        const export_record = await save_export_record( {
            project_id: project.id,
            blob: new Blob( [ `export` ], { type: `video/webm` } ),
            mime_type: `video/webm`,
            settings_hash,
            clip_manifest_hash,
            duration_ms: 3000
        } )

        await move_clip( third_clip.id, `earlier` )

        const moved_clips = await get_project_clips( project.id )

        expect( moved_clips.map( ( { id } ) => id ) ).toEqual( [
            first_clip.id,
            third_clip.id,
            second_clip.id
        ] )
        expect( moved_clips.find( ( { id } ) => id === third_clip.id ).version ).toBe( 2 )
        expect( await get_export_blob( export_record.id ) ).toBe( null )
    } )

    test( `updates clip media details after immediate queue persistence`, async () => {
        const project = await create_project()
        const clip = await add_clip_to_project( {
            project_id: project.id,
            blob: new Blob( [ `video` ], { type: `video/webm` } ),
            mime_type: `video/webm`,
            duration_ms: 1000
        } )

        const updated_clip = await update_clip_media_details( {
            clip_id: clip.id,
            duration_ms: 1250,
            width: 640,
            height: 360,
            thumbnail_blob: new Blob( [ `thumb` ], { type: `image/jpeg` } )
        } )
        const [ stored_project ] = await list_projects()
        const [ stored_clip ] = await get_project_clips( project.id )
        const thumbnail_blob = await get_clip_thumbnail_blob( clip.id )

        expect( updated_clip ).toMatchObject( {
            id: clip.id,
            version: 1,
            duration_ms: 1250,
            width: 640,
            height: 360
        } )
        expect( stored_clip.duration_ms ).toBe( 1250 )
        expect( stored_project.total_duration_ms ).toBe( 1250 )
        expect( await thumbnail_blob.text() ).toBe( `thumb` )
    } )

    test( `late clip media detail updates do not restore a deleted project`, async () => {
        const project = await create_project()
        const clip = await add_clip_to_project( {
            project_id: project.id,
            blob: new Blob( [ `video` ], { type: `video/webm` } ),
            mime_type: `video/webm`,
            duration_ms: 1000
        } )

        await Promise.all( [
            update_clip_media_details( {
                clip_id: clip.id,
                duration_ms: 1250,
                width: 640,
                height: 360,
                thumbnail_blob: new Blob( [ `thumb` ], { type: `image/jpeg` } )
            } ),
            delete_project( project.id )
        ] )

        expect( await get_project( project.id ) ).toBe( undefined )
        expect( await get_project_clips( project.id ) ).toEqual( [] )
        expect( await get_clip_thumbnail_blob( clip.id ) ).toBe( null )
    } )

    test( `late clip media detail updates do not restore deleted local data`, async () => {
        const project = await create_project()
        const clip = await add_clip_to_project( {
            project_id: project.id,
            blob: new Blob( [ `video` ], { type: `video/webm` } ),
            mime_type: `video/webm`,
            duration_ms: 1000
        } )

        await Promise.all( [
            update_clip_media_details( {
                clip_id: clip.id,
                duration_ms: 1250,
                width: 640,
                height: 360,
                thumbnail_blob: new Blob( [ `thumb` ], { type: `image/jpeg` } )
            } ),
            delete_all_data()
        ] )

        expect( await list_projects() ).toEqual( [] )
        expect( await get_project_clips( project.id ) ).toEqual( [] )
        expect( await get_clip_thumbnail_blob( clip.id ) ).toBe( null )
    } )

    test( `stores, finds, loads, and deletes cached exports`, async () => {
        const project = await create_project()
        const settings = await load_settings()
        const clip = await add_clip_to_project( {
            project_id: project.id,
            blob: new Blob( [ `video` ], { type: `video/webm` } ),
            mime_type: `video/webm`,
            duration_ms: 1200
        } )
        const { settings_hash, clip_manifest_hash } = create_export_hashes( {
            clips: [ clip ],
            settings
        } )
        const export_record = await save_export_record( {
            project_id: project.id,
            blob: new Blob( [ `export` ], { type: `video/webm` } ),
            mime_type: `video/webm`,
            settings_hash,
            clip_manifest_hash,
            duration_ms: 2200
        } )

        const cached_export = await get_valid_cached_export( {
            project_id: project.id,
            settings_hash,
            clip_manifest_hash
        } )
        const stale_export = await get_valid_cached_export( {
            project_id: project.id,
            settings_hash: `settings-b`,
            clip_manifest_hash
        } )
        const export_blob = await get_export_blob( export_record.id )

        expect( cached_export.id ).toBe( export_record.id )
        expect( stale_export ).toBe( null )
        expect( await export_blob.text() ).toBe( `export` )
        expect( ( await list_projects() )[ 0 ].last_exported_at ).toBe( export_record.created_at )
        expect( ( await list_projects() )[ 0 ].export_count ).toBe( 1 )

        await add_clip_to_project( {
            project_id: project.id,
            blob: new Blob( [ `second` ], { type: `video/webm` } ),
            mime_type: `video/webm`,
            duration_ms: 800
        } )

        expect( ( await list_projects() )[ 0 ].last_exported_at ).toBe( null )
        expect( ( await list_projects() )[ 0 ].export_count ).toBe( 0 )
        expect( await get_export_blob( export_record.id ) ).toBe( null )

        await delete_export( export_record.id )

        expect( await get_export_blob( export_record.id ) ).toBe( null )
    } )

    test( `refuses to cache exports when the project is missing`, async () => {
        await expect( save_export_record( {
            project_id: `missing-project`,
            blob: new Blob( [ `export` ], { type: `video/webm` } ),
            mime_type: `video/webm`,
            settings_hash: `settings-a`,
            clip_manifest_hash: `clips-a`,
            duration_ms: 1200
        } ) ).rejects.toThrow( /Project not found/ )

        await expect( get_valid_cached_export( {
            project_id: `missing-project`,
            settings_hash: `settings-a`,
            clip_manifest_hash: `clips-a`
        } ) ).resolves.toBe( null )
    } )

    test( `ignores cached export metadata when the export blob is missing`, async () => {
        const project = await create_project()
        const settings = await load_settings()
        const clip = await add_clip_to_project( {
            project_id: project.id,
            blob: new Blob( [ `video` ], { type: `video/webm` } ),
            mime_type: `video/webm`,
            duration_ms: 1200
        } )
        const { settings_hash, clip_manifest_hash } = create_export_hashes( {
            clips: [ clip ],
            settings
        } )
        const export_record = await save_export_record( {
            project_id: project.id,
            blob: new Blob( [ `export` ], { type: `video/webm` } ),
            mime_type: `video/webm`,
            settings_hash,
            clip_manifest_hash,
            duration_ms: 1200
        } )

        await delete_record( `export_blobs`, export_record.id )

        expect( await get_valid_cached_export( {
            project_id: project.id,
            settings_hash,
            clip_manifest_hash
        } ) ).toBe( null )
        expect( ( await list_projects() )[ 0 ].last_exported_at ).toBe( null )
        expect( ( await list_projects() )[ 0 ].export_count ).toBe( 0 )
    } )

    test( `ignores cached export metadata when the export blob is empty or not video`, async () => {
        const project = await create_project()
        const settings = await load_settings()
        const clip = await add_clip_to_project( {
            project_id: project.id,
            blob: new Blob( [ `video` ], { type: `video/webm` } ),
            mime_type: `video/webm`,
            duration_ms: 1200
        } )
        const { settings_hash, clip_manifest_hash } = create_export_hashes( {
            clips: [ clip ],
            settings
        } )
        const export_record = await save_export_record( {
            project_id: project.id,
            blob: new Blob( [ `export` ], { type: `video/webm` } ),
            mime_type: `video/webm`,
            settings_hash,
            clip_manifest_hash,
            duration_ms: 1200
        } )

        await put_record( `export_blobs`, {
            id: export_record.id,
            project_id: project.id,
            blob: new Blob( [], { type: `video/webm` } )
        } )

        expect( await get_valid_cached_export( {
            project_id: project.id,
            settings_hash,
            clip_manifest_hash
        } ) ).toBe( null )
        expect( await get_export_blob( export_record.id ) ).toBe( null )

        const second_export_record = await save_export_record( {
            project_id: project.id,
            blob: new Blob( [ `export` ], { type: `video/webm` } ),
            mime_type: `video/webm`,
            settings_hash,
            clip_manifest_hash,
            duration_ms: 1200
        } )

        await put_record( `export_blobs`, {
            id: second_export_record.id,
            project_id: project.id,
            blob: new Blob( [ `not-video` ], { type: `text/plain` } )
        } )

        expect( await get_valid_cached_export( {
            project_id: project.id,
            settings_hash,
            clip_manifest_hash
        } ) ).toBe( null )
        expect( await get_export_blob( second_export_record.id ) ).toBe( null )
        expect( ( await list_projects() )[ 0 ].export_count ).toBe( 0 )
    } )

    test( `refuses to cache exports after project clips change`, async () => {
        const project = await create_project()
        const settings = await load_settings()
        const clip = await add_clip_to_project( {
            project_id: project.id,
            blob: new Blob( [ `video` ], { type: `video/webm` } ),
            mime_type: `video/webm`,
            duration_ms: 1200
        } )
        const { settings_hash, clip_manifest_hash } = create_export_hashes( {
            clips: [ clip ],
            settings
        } )

        await add_clip_to_project( {
            project_id: project.id,
            blob: new Blob( [ `second` ], { type: `video/webm` } ),
            mime_type: `video/webm`,
            duration_ms: 800
        } )

        await expect( save_export_record( {
            project_id: project.id,
            blob: new Blob( [ `export` ], { type: `video/webm` } ),
            mime_type: `video/webm`,
            settings_hash,
            clip_manifest_hash,
            duration_ms: 1200
        } ) ).rejects.toThrow( /Project changed/ )

        expect( await get_valid_cached_export( {
            project_id: project.id,
            settings_hash,
            clip_manifest_hash
        } ) ).toBe( null )
    } )

    test( `prunes stale export blobs when export settings change`, async () => {
        const project = await create_project()
        const settings = await load_settings()
        const clip = await add_clip_to_project( {
            project_id: project.id,
            blob: new Blob( [ `video` ], { type: `video/webm` } ),
            mime_type: `video/webm`,
            duration_ms: 1200
        } )
        const { settings_hash, clip_manifest_hash } = create_export_hashes( {
            clips: [ clip ],
            settings
        } )
        const export_record = await save_export_record( {
            project_id: project.id,
            blob: new Blob( [ `export` ], { type: `video/webm` } ),
            mime_type: `video/webm`,
            settings_hash,
            clip_manifest_hash,
            duration_ms: 1200
        } )

        await save_settings( { haptics_enabled: false } )

        expect( await get_export_blob( export_record.id ) ).toBeTruthy()

        await save_settings( { export_quality: `high` } )

        expect( await get_export_blob( export_record.id ) ).toBe( null )
        expect( ( await list_projects() )[ 0 ].export_count ).toBe( 0 )
    } )

    test( `project listing prunes legacy stale cached export blobs`, async () => {
        const project = await create_project()

        await add_clip_to_project( {
            project_id: project.id,
            blob: new Blob( [ `video` ], { type: `video/webm` } ),
            mime_type: `video/webm`,
            duration_ms: 1200
        } )

        const stale_export = {
            id: `legacy-stale-export`,
            project_id: project.id,
            mime_type: `video/webm`,
            filename: `legacy-stale-export.webm`,
            settings_hash: `stale-settings`,
            clip_manifest_hash: `stale-clips`,
            duration_ms: 1200,
            created_at: new Date().toISOString()
        }

        await put_record( `exports`, stale_export )
        await put_record( `export_blobs`, {
            id: stale_export.id,
            project_id: project.id,
            blob: new Blob( [ `stale-export` ], { type: `video/webm` } )
        } )

        const [ listed_project ] = await list_projects()

        expect( listed_project.export_count ).toBe( 0 )
        expect( listed_project.last_exported_at ).toBe( null )
        expect( await get_export_blob( stale_export.id ) ).toBe( null )
    } )

    test( `uses normalized export settings for project export status and pruning`, async () => {
        await save_settings( {
            export_resolution: `1080p`,
            preferred_mime_type: `video/mp4`
        } )

        const project = await create_project()
        const loaded_settings = await load_settings()
        const normalized_settings = normalize_export_settings( loaded_settings )
        const clip = await add_clip_to_project( {
            project_id: project.id,
            blob: new Blob( [ `video` ], { type: `video/webm` } ),
            mime_type: `video/webm`,
            duration_ms: 1200
        } )
        const { settings_hash, clip_manifest_hash } = create_export_hashes( {
            clips: [ clip ],
            settings: normalized_settings
        } )
        const export_record = await save_export_record( {
            project_id: project.id,
            blob: new Blob( [ `export` ], { type: `video/webm` } ),
            mime_type: `video/webm`,
            settings_hash,
            clip_manifest_hash,
            duration_ms: 1200
        } )

        expect( ( await list_projects() )[ 0 ].last_exported_at ).toBe( export_record.created_at )

        await save_settings( { haptics_enabled: false } )

        expect( await get_export_blob( export_record.id ) ).toBeTruthy()
        expect( ( await list_projects() )[ 0 ].valid_export_count ).toBe( 1 )
    } )

    test( `merges saved settings with new defaults`, async () => {
        await save_settings( { export_quality: `high` } )

        await expect( load_settings() ).resolves.toMatchObject( {
            export_quality: `high`,
            export_resolution: `source`,
            haptics_enabled: true,
            sounds_enabled: false
        } )
    } )

    test( `persists rapid overlapping settings saves in call order`, async () => {
        await Promise.all( [
            save_settings( {
                haptics_enabled: false,
                sounds_enabled: false
            } ),
            save_settings( {
                haptics_enabled: false,
                sounds_enabled: true
            } )
        ] )

        await expect( load_settings() ).resolves.toMatchObject( {
            haptics_enabled: false,
            sounds_enabled: true
        } )
    } )

    test( `wraps optional browser storage APIs`, async () => {
        const estimate = vi.fn().mockResolvedValue( { usage: 128, quota: 1024 } )
        const persisted = vi.fn().mockResolvedValue( true )
        const persist = vi.fn().mockRejectedValue( new Error( `Denied` ) )

        vi.stubGlobal( `navigator`, {
            storage: {
                estimate,
                persisted,
                persist
            }
        } )

        await expect( estimate_storage() ).resolves.toEqual( { usage: 128, quota: 1024 } )
        await expect( persisted_storage() ).resolves.toBe( true )
        await expect( request_persistent_storage() ).resolves.toBe( false )

        estimate.mockRejectedValue( new Error( `Estimate failed` ) )
        persisted.mockRejectedValue( new Error( `Persisted failed` ) )

        await expect( estimate_storage() ).resolves.toBe( null )
        await expect( persisted_storage() ).resolves.toBe( null )
    } )

    test( `deleting a project removes its clips and cached exports`, async () => {
        const project = await create_project()
        const settings = await load_settings()
        const clip = await add_clip_to_project( {
            project_id: project.id,
            blob: new Blob( [ `video` ], { type: `video/webm` } ),
            mime_type: `video/webm`,
            duration_ms: 1200
        } )
        const { settings_hash, clip_manifest_hash } = create_export_hashes( {
            clips: [ clip ],
            settings
        } )
        const export_record = await save_export_record( {
            project_id: project.id,
            blob: new Blob( [ `export` ], { type: `video/webm` } ),
            mime_type: `video/webm`,
            settings_hash,
            clip_manifest_hash,
            duration_ms: 1200
        } )

        await delete_project( project.id )

        expect( await list_projects() ).toEqual( [] )
        expect( await get_project_clips( project.id ) ).toEqual( [] )
        expect( await get_clip_blob( clip.id ) ).toBe( null )
        expect( await get_clip_thumbnail_blob( clip.id ) ).toBe( null )
        expect( await get_export_blob( export_record.id ) ).toBe( null )
    } )

    test( `deleting all data clears projects media exports settings and active state`, async () => {
        const project = await create_project()
        const settings = await load_settings()
        const clip = await add_clip_to_project( {
            project_id: project.id,
            blob: new Blob( [ `video` ], { type: `video/webm` } ),
            mime_type: `video/webm`,
            duration_ms: 1200,
            thumbnail_blob: new Blob( [ `thumb` ], { type: `image/jpeg` } )
        } )
        const { settings_hash, clip_manifest_hash } = create_export_hashes( {
            clips: [ clip ],
            settings
        } )
        const export_record = await save_export_record( {
            project_id: project.id,
            blob: new Blob( [ `export` ], { type: `video/webm` } ),
            mime_type: `video/webm`,
            settings_hash,
            clip_manifest_hash,
            duration_ms: 1200
        } )

        await save_settings( {
            export_quality: `high`,
            sounds_enabled: true
        } )
        await set_active_project( project.id )

        await delete_all_data()

        expect( await list_projects() ).toEqual( [] )
        expect( await get_active_project() ).toBe( null )
        expect( await get_project_clips( project.id ) ).toEqual( [] )
        expect( await get_clip_blob( clip.id ) ).toBe( null )
        expect( await get_clip_thumbnail_blob( clip.id ) ).toBe( null )
        expect( await get_export_blob( export_record.id ) ).toBe( null )
        expect( await load_settings() ).toMatchObject( {
            export_quality: `standard`,
            sounds_enabled: false
        } )
    } )
} )
