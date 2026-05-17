import { afterEach, describe, expect, test, vi } from 'vitest'
import {
    can_share_file,
    create_share_file,
    share_export_file
} from './share.js'

const export_record = {
    filename: `may-17-2026.webm`,
    mime_type: `video/webm`
}

const project = {
    title: `May 17, 2026`
}

const blob = new Blob( [ `video` ], { type: `video/webm` } )

describe( `sharing helpers`, () => {
    afterEach( () => {
        vi.unstubAllGlobals()
    } )

    test( `creates a share file with the export filename and MIME type`, () => {
        const file = create_share_file( export_record, blob )

        expect( file.name ).toBe( `may-17-2026.webm` )
        expect( file.type ).toBe( `video/webm` )
    } )

    test( `reports unsupported native sharing when the browser has no share API`, () => {
        vi.stubGlobal( `navigator`, {} )

        expect( can_share_file( create_share_file( export_record, blob ) ) ).toBe( false )
    } )

    test( `shares files only when the browser can share them`, async () => {
        const share = vi.fn().mockResolvedValue()
        const canShare = vi.fn().mockReturnValue( true )

        vi.stubGlobal( `navigator`, { share, canShare } )

        await expect( share_export_file( { project, export_record, blob } ) ).resolves.toBe( `shared` )
        expect( canShare ).toHaveBeenCalledWith( {
            files: [ expect.objectContaining( { name: export_record.filename } ) ]
        } )
        expect( share ).toHaveBeenCalledWith( {
            files: [ expect.objectContaining( { name: export_record.filename } ) ],
            title: project.title,
            text: `Video journal export`
        } )
    } )

    test( `treats native share cancellation as a normal result`, async () => {
        vi.stubGlobal( `navigator`, {
            canShare: vi.fn().mockReturnValue( true ),
            share: vi.fn().mockRejectedValue( new DOMException( `Cancelled`, `AbortError` ) )
        } )

        await expect( share_export_file( { project, export_record, blob } ) ).resolves.toBe( `cancelled` )
    } )
} )
