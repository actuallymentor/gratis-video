/* @vitest-environment jsdom */

import { afterEach, describe, expect, test, vi } from 'vitest'
import {
    can_share_file,
    create_share_file,
    download_export_file,
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
        vi.restoreAllMocks()
        vi.useRealTimers()
    } )

    test( `creates a share file with the export filename and MIME type`, () => {
        const file = create_share_file( export_record, blob )

        expect( file.name ).toBe( `may-17-2026.webm` )
        expect( file.type ).toBe( `video/webm` )
    } )

    test( `normalizes codec MIME parameters to shareable video file types`, () => {
        const mp4_export_record = {
            filename: `may-17-2026.mp4`,
            mime_type: `video/mp4;codecs=avc1.42e01e,mp4a.40.2`
        }
        const mp4_blob = new Blob( [ `video` ], {
            type: `video/mp4;codecs=avc1.42e01e,mp4a.40.2`
        } )
        const file = create_share_file( mp4_export_record, mp4_blob )

        expect( file.name ).toBe( `may-17-2026.mp4` )
        expect( file.type ).toBe( `video/mp4` )
    } )

    test( `reports unsupported native sharing when the browser has no share API`, () => {
        vi.stubGlobal( `navigator`, {} )

        expect( can_share_file( create_share_file( export_record, blob ) ) ).toBe( false )
    } )

    test( `shares files only when the browser can share them`, async () => {
        const share = vi.fn().mockResolvedValue()
        const canShare = vi.fn().mockReturnValue( true )

        vi.stubGlobal( `navigator`, { share, canShare } )

        const share_result = share_export_file( { project, export_record, blob } )

        expect( canShare ).toHaveBeenCalledWith( {
            files: [ expect.objectContaining( { name: export_record.filename } ) ]
        } )
        expect( share ).toHaveBeenCalledWith( {
            files: [ expect.objectContaining( { name: export_record.filename } ) ],
            title: project.title,
            text: `Video journal export`
        } )
        await expect( share_result ).resolves.toBe( `shared` )
    } )

    test( `does not call native share after transient activation expires`, async () => {
        vi.stubGlobal( `navigator`, {
            canShare: vi.fn().mockReturnValue( true ),
            share: vi.fn(),
            userActivation: {
                isActive: false
            }
        } )

        await expect( share_export_file( { project, export_record, blob } ) ).resolves.toBe( `activation-required` )
        expect( navigator.canShare ).toHaveBeenCalledWith( {
            files: [ expect.objectContaining( { name: export_record.filename } ) ]
        } )
        expect( navigator.share ).not.toHaveBeenCalled()
    } )

    test( `returns unsupported when native file sharing rejects the file`, async () => {
        vi.stubGlobal( `navigator`, {
            canShare: vi.fn().mockReturnValue( false ),
            share: vi.fn()
        } )

        await expect( share_export_file( { project, export_record, blob } ) ).resolves.toBe( `unsupported` )
        expect( navigator.share ).not.toHaveBeenCalled()
    } )

    test( `requires file sharing capability before using native share`, () => {
        vi.stubGlobal( `navigator`, {
            share: vi.fn()
        } )

        expect( can_share_file( create_share_file( export_record, blob ) ) ).toBe( false )
    } )

    test( `treats failed file share capability checks as unsupported`, () => {
        vi.stubGlobal( `navigator`, {
            canShare: vi.fn( () => {
                throw new TypeError( `Invalid share data` )
            } ),
            share: vi.fn()
        } )

        expect( can_share_file( create_share_file( export_record, blob ) ) ).toBe( false )
    } )

    test( `treats native share cancellation as a normal result`, async () => {
        vi.stubGlobal( `navigator`, {
            canShare: vi.fn().mockReturnValue( true ),
            share: vi.fn().mockRejectedValue( new DOMException( `Cancelled`, `AbortError` ) )
        } )

        await expect( share_export_file( { project, export_record, blob } ) ).resolves.toBe( `cancelled` )
    } )

    test( `downloads an export with an object URL fallback`, () => {
        const object_url = `blob:download`
        const click = vi.fn()
        const append = vi.spyOn( document.body, `append` ).mockImplementation( () => {} )
        const createObjectURL = vi.spyOn( URL, `createObjectURL` ).mockReturnValue( object_url )
        const revokeObjectURL = vi.spyOn( URL, `revokeObjectURL` ).mockImplementation( () => {} )
        const createElement = vi.spyOn( document, `createElement` )
            .mockReturnValue( {
                click,
                remove: vi.fn(),
                set href( value ) {
                    this.href_value = value
                },
                set download( value ) {
                    this.download_value = value
                },
                set rel( value ) {
                    this.rel_value = value
                }
            } )

        vi.useFakeTimers()
        download_export_file( export_record, blob )

        expect( createObjectURL ).toHaveBeenCalledWith( blob )
        expect( append ).toHaveBeenCalled()
        expect( click ).toHaveBeenCalled()
        expect( append.mock.calls[ 0 ][ 0 ] ).toMatchObject( {
            href_value: object_url,
            download_value: export_record.filename,
            rel_value: `noopener`
        } )

        vi.runAllTimers()

        expect( revokeObjectURL ).toHaveBeenCalledWith( object_url )

        vi.useRealTimers()
        createElement.mockRestore()
    } )
} )
