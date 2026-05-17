import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { reset_db_connection } from './db.js'
import {
    add_clip_to_project,
    create_project,
    delete_all_data,
    delete_clip,
    get_clip_blob,
    get_project_clips,
    list_projects
} from './journal_storage.js'

describe( `journal storage`, () => {
    beforeEach( async () => {
        vi.stubGlobal( `navigator`, {} )
        reset_db_connection()
        await delete_all_data()
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
} )
