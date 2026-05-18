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

        const button = screen.getByRole( `button`, { name: `Starting recording` } )

        expect( button.disabled ).toBe( false )

        fireEvent.pointerDown( button, { pointerId: 1 } )
        fireEvent.pointerUp( button, { pointerId: 1 } )

        expect( default_props.on_press ).toHaveBeenCalledTimes( 1 )
        expect( default_props.on_release ).toHaveBeenCalledTimes( 1 )
    } )

    test( `is disabled only while saving a completed recording`, () => {
        render( <RecordButton { ...default_props } recording_state="saving" /> )

        expect( screen.getByRole( `button`, { name: `Saving recording` } ).disabled ).toBe( true )
    } )

    test( `uses accessible names that match transient recording states`, () => {
        const { rerender } = render( <RecordButton { ...default_props } recording_state="idle" /> )

        expect( screen.getByRole( `button`, { name: `Record clip` } ) ).toBeTruthy()

        rerender( <RecordButton { ...default_props } recording_state="starting" /> )
        expect( screen.getByRole( `button`, { name: `Starting recording` } ) ).toBeTruthy()

        rerender( <RecordButton { ...default_props } recording_state="recording" elapsed_ms={ 1000 } /> )
        expect( screen.getByRole( `button`, { name: `Stop recording` } ) ).toBeTruthy()

        rerender( <RecordButton { ...default_props } recording_state="saving" /> )
        expect( screen.getByRole( `button`, { name: `Saving recording` } ) ).toBeTruthy()
    } )

    test( `ignores repeated keyboard activation while a key is held`, () => {
        render( <RecordButton { ...default_props } recording_state="idle" /> )

        const button = screen.getByRole( `button`, { name: `Record clip` } )

        fireEvent.keyDown( button, { key: ` ` } )
        fireEvent.keyDown( button, { key: ` `, repeat: true } )

        expect( default_props.on_toggle ).toHaveBeenCalledTimes( 1 )
    } )

    test( `supports click-style activation without duplicating pointer gestures`, () => {
        render( <RecordButton { ...default_props } recording_state="idle" /> )

        const button = screen.getByRole( `button`, { name: `Record clip` } )

        fireEvent.click( button )

        expect( default_props.on_toggle ).toHaveBeenCalledTimes( 1 )

        fireEvent.pointerDown( button, { pointerId: 1 } )
        fireEvent.pointerUp( button, { pointerId: 1 } )
        fireEvent.click( button )

        expect( default_props.on_press ).toHaveBeenCalledTimes( 1 )
        expect( default_props.on_release ).toHaveBeenCalledTimes( 1 )
        expect( default_props.on_toggle ).toHaveBeenCalledTimes( 1 )
    } )

    test( `ignores unrelated secondary pointers during an active press`, () => {
        render( <RecordButton { ...default_props } recording_state="recording" /> )

        const button = screen.getByRole( `button`, { name: `Stop recording` } )

        fireEvent.pointerDown( button, { pointerId: 1, button: 0 } )
        fireEvent.pointerDown( button, { pointerId: 2, button: 0 } )
        fireEvent.pointerUp( button, { pointerId: 2, button: 0 } )
        fireEvent.pointerUp( button, { pointerId: 1, button: 0 } )

        expect( default_props.on_press ).toHaveBeenCalledTimes( 1 )
        expect( default_props.on_release ).toHaveBeenCalledTimes( 1 )
        expect( default_props.on_cancel ).not.toHaveBeenCalled()
    } )

    test( `ignores non-primary pointer presses`, () => {
        render( <RecordButton { ...default_props } recording_state="idle" /> )

        const button = screen.getByRole( `button`, { name: `Record clip` } )

        fireEvent.pointerDown( button, { pointerId: 1, button: 2 } )
        fireEvent.pointerUp( button, { pointerId: 1, button: 2 } )

        expect( default_props.on_press ).not.toHaveBeenCalled()
        expect( default_props.on_release ).not.toHaveBeenCalled()
    } )

    test( `ignores the synthetic click after a long pointer hold`, () => {
        let now = 0

        vi.spyOn( performance, `now` ).mockImplementation( () => now )

        render( <RecordButton { ...default_props } recording_state="recording" /> )

        const button = screen.getByRole( `button`, { name: `Stop recording` } )

        fireEvent.pointerDown( button, { pointerId: 1 } )
        now = 900
        fireEvent.pointerUp( button, { pointerId: 1 } )
        now = 901
        fireEvent.click( button )

        expect( default_props.on_press ).toHaveBeenCalledTimes( 1 )
        expect( default_props.on_release ).toHaveBeenCalledTimes( 1 )
        expect( default_props.on_toggle ).not.toHaveBeenCalled()
    } )

    test( `forwards pointer cancellation so partial recordings can be saved`, () => {
        render( <RecordButton { ...default_props } recording_state="recording" /> )

        const button = screen.getByRole( `button`, { name: `Stop recording` } )

        fireEvent.pointerDown( button, { pointerId: 1 } )
        fireEvent.pointerCancel( button, { pointerId: 1 } )

        expect( default_props.on_press ).toHaveBeenCalledTimes( 1 )
        expect( default_props.on_cancel ).toHaveBeenCalledTimes( 1 )
    } )

    test( `still forwards pointer cancellation when pointer capture is already gone`, () => {
        render( <RecordButton { ...default_props } recording_state="recording" /> )

        const button = screen.getByRole( `button`, { name: `Stop recording` } )

        button.releasePointerCapture = vi.fn( () => {
            throw new Error( `Pointer capture already released` )
        } )

        fireEvent.pointerDown( button, { pointerId: 1 } )
        fireEvent.pointerCancel( button, { pointerId: 1 } )

        expect( button.releasePointerCapture ).toHaveBeenCalledWith( 1 )
        expect( default_props.on_press ).toHaveBeenCalledTimes( 1 )
        expect( default_props.on_cancel ).toHaveBeenCalledTimes( 1 )
    } )
} )
