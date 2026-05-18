/* @vitest-environment jsdom */

import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectRow } from './ProjectRow.jsx'

const project = {
    id: `project-1`,
    title: `Pocket Walk`,
    created_at: `2026-05-17T10:00:00.000Z`,
    clip_count: 3,
    total_duration_ms: 4200,
    last_exported_at: `2026-05-17T11:00:00.000Z`
}

describe( `project row`, () => {
    afterEach( () => cleanup() )

    test( `keeps project metadata available as the open action description`, () => {
        render( <ProjectRow
            project={ project }
            active={ true }
            on_open={ vi.fn() }
            on_rename={ vi.fn() }
            on_delete={ vi.fn() }
        /> )

        const open_button = screen.getByRole( `button`, { name: `Open Pocket Walk` } )
        const description = document.getElementById( open_button.getAttribute( `aria-describedby` ) )

        expect( description.textContent ).toMatch( /Active project/ )
        expect( description.textContent ).toMatch( /3 clips/ )
        expect( description.textContent ).toMatch( /Export ready/ )
    } )

    test( `commits an inline rename once and ignores unchanged titles`, async () => {
        const user = userEvent.setup()
        const rename_project = vi.fn()

        render( <ProjectRow
            project={ project }
            active={ false }
            on_open={ vi.fn() }
            on_rename={ rename_project }
            on_delete={ vi.fn() }
        /> )

        await user.click( screen.getByRole( `button`, { name: `Rename Pocket Walk` } ) )
        fireEvent.blur( screen.getByLabelText( `Project title` ) )

        expect( rename_project ).not.toHaveBeenCalled()

        await user.click( screen.getByRole( `button`, { name: `Rename Pocket Walk` } ) )

        const input = screen.getByLabelText( `Project title` )
        await user.clear( input )
        await user.type( input, `Pocket Walk Edited` )
        fireEvent.blur( input )

        expect( rename_project ).toHaveBeenCalledTimes( 1 )
        expect( rename_project ).toHaveBeenCalledWith( `Pocket Walk Edited` )
    } )
} )
