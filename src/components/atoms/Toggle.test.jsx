/* @vitest-environment jsdom */

import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Toggle } from './Toggle.jsx'

describe( `toggle`, () => {
    afterEach( () => {
        cleanup()
        vi.clearAllMocks()
    } )

    test( `uses the visible setting label as the accessible control name`, async () => {
        const user = userEvent.setup()
        const change_setting = vi.fn()

        render( <Toggle
            label="Haptics"
            description="Use short vibration pulses for recording start and stop."
            checked={ false }
            on_change={ change_setting }
        /> )

        const input = screen.getByLabelText( `Haptics` )

        expect( input.checked ).toBe( false )

        await user.click( input )

        expect( change_setting ).toHaveBeenCalledWith( true )
    } )
} )
