/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClipQueue } from './ClipQueue.jsx'
import {
    get_clip_blob,
    get_clip_thumbnail_blob
} from '../../modules/storage/journal_storage.js'

vi.mock( '../../modules/storage/journal_storage.js', () => ( {
    get_clip_blob: vi.fn(),
    get_clip_thumbnail_blob: vi.fn()
} ) )

const clip = {
    id: `clip-1`,
    duration_ms: 1200,
    created_at: `2026-05-17T10:00:00.000Z`
}

const make_deferred = () => {
    let resolve
    const promise = new Promise( ( promise_resolve ) => {
        resolve = promise_resolve
    } )

    return { promise, resolve }
}

describe( `clip queue`, () => {
    beforeEach( () => {
        vi.clearAllMocks()
        vi.mocked( get_clip_blob ).mockResolvedValue( new Blob( [ `video` ], { type: `video/webm` } ) )
        vi.mocked( get_clip_thumbnail_blob ).mockResolvedValue( null )
        vi.spyOn( URL, `createObjectURL` ).mockReturnValue( `blob:preview` )
        vi.spyOn( URL, `revokeObjectURL` ).mockImplementation( () => {} )
    } )

    afterEach( () => {
        cleanup()
        vi.restoreAllMocks()
    } )

    test( `previews a clip from local storage and releases the object URL`, async () => {
        const user = userEvent.setup()
        render( <ClipQueue clips={ [ clip ] } on_delete={ vi.fn() } /> )

        await user.click( screen.getByRole( `button`, { name: `Preview clip 1` } ) )

        expect( await screen.findByRole( `dialog`, { name: `Clip preview` } ) ).toBeTruthy()
        await waitFor( () => {
            expect( document.body.querySelector( `video` )?.getAttribute( `src` ) ).toBe( `blob:preview` )
        } )
        expect( get_clip_blob ).toHaveBeenCalledWith( clip.id )

        await user.click( screen.getByRole( `button`, { name: `Close preview` } ) )

        expect( screen.queryByRole( `dialog`, { name: `Clip preview` } ) ).toBe( null )
        expect( URL.revokeObjectURL ).toHaveBeenCalledWith( `blob:preview` )
    } )

    test( `shows an upload control and titles clips by clock time`, async () => {
        const user = userEvent.setup()
        const on_upload = vi.fn()
        const file = new File( [ `video` ], `walk.mp4`, { type: `video/mp4` } )

        render( <ClipQueue clips={ [ clip ] } on_delete={ vi.fn() } on_upload={ on_upload } /> )

        expect( screen.getByText( `Clip 10:00` ) ).toBeTruthy()
        expect( screen.queryByText( `Clip 1` ) ).toBe( null )

        const upload_input = screen.getByLabelText( `Upload clip` )

        expect( upload_input.getAttribute( `accept` ) ).toBe( `video/*` )

        await user.upload( upload_input, file )

        expect( on_upload ).toHaveBeenCalledWith( file )
        expect( upload_input.value ).toBe( `` )
    } )

    test( `announces preview loading while the clip blob is being read`, async () => {
        const user = userEvent.setup()
        const preview = make_deferred()

        vi.mocked( get_clip_blob ).mockReturnValue( preview.promise )

        render( <ClipQueue clips={ [ clip ] } on_delete={ vi.fn() } /> )

        await user.click( screen.getByRole( `button`, { name: `Preview clip 1` } ) )

        expect( screen.getByText( `Loading clip preview...` ) ).toBeTruthy()

        await act( async () => {
            preview.resolve( new Blob( [ `video` ], { type: `video/webm` } ) )
            await preview.promise
        } )

        expect( screen.queryByText( `Loading clip preview...` ) ).toBe( null )
    } )

    test( `closes preview with Escape and restores focus to the preview trigger`, async () => {
        const user = userEvent.setup()

        render( <ClipQueue clips={ [ clip ] } on_delete={ vi.fn() } /> )

        const preview_button = screen.getByRole( `button`, { name: `Preview clip 1` } )
        preview_button.focus()

        await user.click( preview_button )

        expect( await screen.findByRole( `dialog`, { name: `Clip preview` } ) ).toBeTruthy()
        await waitFor( () => {
            expect( document.activeElement ).toBe( screen.getByRole( `button`, { name: `Close preview` } ) )
        } )

        await user.keyboard( `{Escape}` )

        expect( screen.queryByRole( `dialog`, { name: `Clip preview` } ) ).toBe( null )
        expect( document.activeElement ).toBe( preview_button )
    } )

    test( `shows a local missing-file message when preview blob is gone`, async () => {
        const user = userEvent.setup()

        vi.mocked( get_clip_blob ).mockResolvedValue( null )

        render( <ClipQueue clips={ [ clip ] } on_delete={ vi.fn() } /> )

        await user.click( screen.getByRole( `button`, { name: `Preview clip 1` } ) )

        expect( await screen.findByText( /clip file is missing/ ) ).toBeTruthy()
    } )

    test( `shows a local read-failure message when preview storage rejects`, async () => {
        const user = userEvent.setup()

        vi.mocked( get_clip_blob ).mockRejectedValue( new Error( `IndexedDB failed` ) )

        render( <ClipQueue clips={ [ clip ] } on_delete={ vi.fn() } /> )

        await user.click( screen.getByRole( `button`, { name: `Preview clip 1` } ) )

        expect( await screen.findByText( /could not be read from local browser storage/ ) ).toBeTruthy()
    } )

    test( `ignores stale preview loads after a newer clip is selected`, async () => {
        const user = userEvent.setup()
        const first_preview = make_deferred()
        const second_clip = {
            ...clip,
            id: `clip-2`,
            created_at: `2026-05-17T10:00:02.000Z`
        }
        render( <ClipQueue clips={ [ clip, second_clip ] } on_delete={ vi.fn() } /> )

        vi.mocked( get_clip_blob ).mockImplementation( ( clip_id ) => {
            if( clip_id === `clip-1` ) return first_preview.promise
            return Promise.resolve( new Blob( [ `second` ], { type: `video/webm` } ) )
        } )
        URL.createObjectURL
            .mockReturnValueOnce( `blob:second-preview` )
            .mockReturnValueOnce( `blob:first-preview` )

        await user.click( screen.getByRole( `button`, { name: `Preview clip 1` } ) )
        await user.click( screen.getByRole( `button`, { name: `Preview clip 2` } ) )

        await waitFor( () => {
            expect( document.body.querySelector( `video` )?.getAttribute( `src` ) ).toBe( `blob:second-preview` )
        } )

        first_preview.resolve( new Blob( [ `first` ], { type: `video/webm` } ) )

        await waitFor( () => {
            expect( document.body.querySelector( `video` )?.getAttribute( `src` ) ).toBe( `blob:second-preview` )
        } )
        expect( URL.createObjectURL ).toHaveBeenCalledTimes( 1 )
    } )

    test( `does not create preview object URLs after unmount`, async () => {
        const user = userEvent.setup()
        const pending_preview = make_deferred()

        vi.mocked( get_clip_blob ).mockReturnValue( pending_preview.promise )

        const { unmount } = render( <ClipQueue clips={ [ clip ] } on_delete={ vi.fn() } /> )

        await user.click( screen.getByRole( `button`, { name: `Preview clip 1` } ) )
        unmount()

        await act( async () => {
            pending_preview.resolve( new Blob( [ `video` ], { type: `video/webm` } ) )
            await pending_preview.promise
        } )

        expect( URL.createObjectURL ).not.toHaveBeenCalled()
        expect( URL.revokeObjectURL ).not.toHaveBeenCalled()
    } )

    test( `reloads thumbnails when async media details update the clip`, async () => {
        const thumbnail_blob = new Blob( [ `thumb` ], { type: `image/jpeg` } )

        vi.mocked( get_clip_thumbnail_blob )
            .mockResolvedValueOnce( null )
            .mockResolvedValueOnce( thumbnail_blob )

        const { container, rerender } = render(
            <ClipQueue clips={ [ { ...clip, updated_at: `2026-05-17T10:00:00.000Z` } ] } on_delete={ vi.fn() } />
        )

        await waitFor( () => {
            expect( get_clip_thumbnail_blob ).toHaveBeenCalledTimes( 1 )
        } )

        rerender(
            <ClipQueue clips={ [ { ...clip, updated_at: `2026-05-17T10:00:03.000Z` } ] } on_delete={ vi.fn() } />
        )

        await waitFor( () => {
            expect( container.querySelector( `img` )?.getAttribute( `src` ) ).toBe( `blob:preview` )
        } )
        expect( get_clip_thumbnail_blob ).toHaveBeenCalledTimes( 2 )
    } )

    test( `moves clips with boundary controls disabled`, async () => {
        const user = userEvent.setup()
        const on_move = vi.fn()
        const second_clip = {
            ...clip,
            id: `clip-2`,
            created_at: `2026-05-17T10:00:02.000Z`
        }

        render( <ClipQueue clips={ [ clip, second_clip ] } on_delete={ vi.fn() } on_move={ on_move } /> )

        expect( screen.getByRole( `button`, { name: `Move clip 1 earlier` } ).disabled ).toBe( true )
        expect( screen.getByRole( `button`, { name: `Move clip 2 later` } ).disabled ).toBe( true )

        await user.click( screen.getByRole( `button`, { name: `Move clip 2 earlier` } ) )
        await user.click( screen.getByRole( `button`, { name: `Move clip 1 later` } ) )

        expect( on_move ).toHaveBeenCalledWith( second_clip, `earlier` )
        expect( on_move ).toHaveBeenCalledWith( clip, `later` )
    } )
} )
