/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
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

describe( `clip queue`, () => {
    beforeEach( () => {
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
        const { container } = render( <ClipQueue clips={ [ clip ] } on_delete={ vi.fn() } /> )

        await user.click( screen.getByRole( `button`, { name: `Preview clip 1` } ) )

        expect( await screen.findByRole( `dialog`, { name: `Clip preview` } ) ).toBeTruthy()
        await waitFor( () => {
            expect( container.querySelector( `video` )?.getAttribute( `src` ) ).toBe( `blob:preview` )
        } )
        expect( get_clip_blob ).toHaveBeenCalledWith( clip.id )

        await user.click( screen.getByRole( `button`, { name: `Close preview` } ) )

        expect( screen.queryByRole( `dialog`, { name: `Clip preview` } ) ).toBe( null )
        expect( URL.revokeObjectURL ).toHaveBeenCalledWith( `blob:preview` )
    } )

    test( `shows a local missing-file message when preview blob is gone`, async () => {
        const user = userEvent.setup()

        vi.mocked( get_clip_blob ).mockResolvedValue( null )

        render( <ClipQueue clips={ [ clip ] } on_delete={ vi.fn() } /> )

        await user.click( screen.getByRole( `button`, { name: `Preview clip 1` } ) )

        expect( await screen.findByText( /clip file is missing/ ) ).toBeTruthy()
    } )
} )
