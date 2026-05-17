/* @vitest-environment jsdom */

import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { RecordButton } from './RecordButton.jsx'

const default_props = {
    elapsed_ms: 0,
    on_press: vi.fn(),
    on_release: vi.fn(),
    on_cancel: vi.fn(),
    on_toggle: vi.fn()
}

describe( `record button`, () => {
    afterEach( () => {
        cleanup()
        vi.clearAllMocks()
    } )

    test( `stays enabled while startup is pending so pointer release can classify the gesture`, () => {
        render( <RecordButton { ...default_props } recording_state="starting" /> )

        const button = screen.getByRole( `button`, { name: `Record clip` } )

        expect( button.disabled ).toBe( false )

        fireEvent.pointerDown( button, { pointerId: 1 } )
        fireEvent.pointerUp( button, { pointerId: 1 } )

        expect( default_props.on_press ).toHaveBeenCalledTimes( 1 )
        expect( default_props.on_release ).toHaveBeenCalledTimes( 1 )
    } )

    test( `is disabled only while saving a completed recording`, () => {
        render( <RecordButton { ...default_props } recording_state="saving" /> )

        expect( screen.getByRole( `button`, { name: `Record clip` } ).disabled ).toBe( true )
    } )

    test( `ignores repeated keyboard activation while a key is held`, () => {
        render( <RecordButton { ...default_props } recording_state="idle" /> )

        const button = screen.getByRole( `button`, { name: `Record clip` } )

        fireEvent.keyDown( button, { key: ` ` } )
        fireEvent.keyDown( button, { key: ` `, repeat: true } )

        expect( default_props.on_toggle ).toHaveBeenCalledTimes( 1 )
    } )
} )
