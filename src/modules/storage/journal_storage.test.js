import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { reset_db_connection } from './db.js'
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
    persisted_storage,
    rename_project,
    request_persistent_storage,
    save_export_record,
    save_settings,
    set_active_project
} from './journal_storage.js'
import { create_export_hashes } from '../export/cache.js'

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
        expect( blob.type ).toBe( `video/webm` )
        expect( await stored_thumbnail_blob.text() ).toBe( `thumb` )
    } )

    test( `creates duplicate same-day project titles without a naming step`, async () => {
        const first_project = await create_project()
        const second_project = await create_project()

        expect( second_project.title ).toBe( `${ first_project.title } - 2` )
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

    test( `renames projects with trimmed titles and keeps defaults for blank titles`, async () => {
        const project = await create_project()

        const renamed_project = await rename_project( project.id, `  Pocket Walk  ` )
        const fallback_project = await rename_project( project.id, `   ` )

        expect( renamed_project.title ).toBe( `Pocket Walk` )
        expect( fallback_project.title ).toBe( `Pocket Walk` )
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

        await delete_export( export_record.id )

        expect( await get_export_blob( export_record.id ) ).toBe( null )
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
        const clip = await add_clip_to_project( {
            project_id: project.id,
            blob: new Blob( [ `video` ], { type: `video/webm` } ),
            mime_type: `video/webm`,
            duration_ms: 1200
        } )
        const export_record = await save_export_record( {
            project_id: project.id,
            blob: new Blob( [ `export` ], { type: `video/webm` } ),
            mime_type: `video/webm`,
            settings_hash: `settings-a`,
            clip_manifest_hash: `clips-a`,
            duration_ms: 1200
        } )

        await delete_project( project.id )

        expect( await list_projects() ).toEqual( [] )
        expect( await get_project_clips( project.id ) ).toEqual( [] )
        expect( await get_clip_blob( clip.id ) ).toBe( null )
        expect( await get_clip_thumbnail_blob( clip.id ) ).toBe( null )
        expect( await get_export_blob( export_record.id ) ).toBe( null )
    } )
} )
