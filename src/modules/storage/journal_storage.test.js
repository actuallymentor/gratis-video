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
    get_clip_blob,
    get_export_blob,
    get_valid_cached_export,
    get_project_clips,
    list_projects,
    save_export_record
} from './journal_storage.js'

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
        const project = await create_project()
        const clip = await add_clip_to_project( {
            project_id: project.id,
            blob: new Blob( [ `video` ], { type: `video/webm` } ),
            mime_type: `video/webm`,
            duration_ms: 1200,
            width: 640,
            height: 360,
            thumbnail_blob: new Blob( [ `thumb` ], { type: `image/jpeg` } )
        } )

        const [ stored_project ] = await list_projects()
        const clips = await get_project_clips( project.id )
        const blob = await get_clip_blob( clip.id )

        expect( stored_project.clip_count ).toBe( 1 )
        expect( clips ).toHaveLength( 1 )
        expect( clips[ 0 ].blob ).toBeUndefined()
        expect( blob.type ).toBe( `video/webm` )
    } )

    test( `deleting a clip removes it from the queue and blob store`, async () => {
        const project = await create_project()
        const clip = await add_clip_to_project( {
            project_id: project.id,
            blob: new Blob( [ `video` ], { type: `video/webm` } ),
            mime_type: `video/webm`,
            duration_ms: 1200
        } )

        await delete_clip( clip.id )

        expect( await get_project_clips( project.id ) ).toEqual( [] )
        expect( await get_clip_blob( clip.id ) ).toBe( null )
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
        const export_record = await save_export_record( {
            project_id: project.id,
            blob: new Blob( [ `export` ], { type: `video/webm` } ),
            mime_type: `video/webm`,
            settings_hash: `settings-a`,
            clip_manifest_hash: `clips-a`,
            duration_ms: 2200
        } )

        const cached_export = await get_valid_cached_export( {
            project_id: project.id,
            settings_hash: `settings-a`,
            clip_manifest_hash: `clips-a`
        } )
        const stale_export = await get_valid_cached_export( {
            project_id: project.id,
            settings_hash: `settings-b`,
            clip_manifest_hash: `clips-a`
        } )
        const export_blob = await get_export_blob( export_record.id )

        expect( cached_export.id ).toBe( export_record.id )
        expect( stale_export ).toBe( null )
        expect( await export_blob.text() ).toBe( `export` )

        await delete_export( export_record.id )

        expect( await get_export_blob( export_record.id ) ).toBe( null )
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
        expect( await get_export_blob( export_record.id ) ).toBe( null )
    } )
} )
