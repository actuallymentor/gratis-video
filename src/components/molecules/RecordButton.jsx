import styled, { keyframes } from 'styled-components'
import { Square, Video } from 'lucide-react'
import { format_duration } from '../../modules/media/time.js'

const pulse = keyframes`
    from { box-shadow: 0 0 0 0 rgba( 216, 57, 43, 0.28 ); }
    to { box-shadow: 0 0 0 1rem rgba( 216, 57, 43, 0 ); }
`

const Button = styled.button`
    display: grid;
    place-items: center;
    width: 5.25rem;
    min-width: 5.25rem;
    height: 5.25rem;
    min-height: 5.25rem;
    border: 0.35rem solid ${ ( { $recording } ) => $recording ? `var(--color-recording)` : `var(--color-surface)` };
    border-radius: 999px;
    color: ${ ( { $recording } ) => $recording ? `#ffffff` : `#0d1718` };
    background: ${ ( { $recording } ) => $recording ? `var(--color-recording)` : `var(--color-accent)` };
    box-shadow: var(--shadow-soft);
    touch-action: none;
    user-select: none;
    animation: ${ ( { $recording } ) => $recording ? pulse : `none` } 900ms ease-out infinite;

    &:disabled {
        opacity: 0.72;
    }
`

const Inner = styled.span`
    display: grid;
    place-items: center;
    gap: 0.15rem;
    font-size: 0.72rem;
    font-weight: 900;
    line-height: 1;
`

/**
 * Renders the dominant capture control with pointer and keyboard support.
 * @param {Object} props - Record button props.
 * @returns {JSX.Element} Record button.
 */
export function RecordButton( {
    recording_state,
    elapsed_ms,
    on_press,
    on_release,
    on_cancel,
    on_toggle,
    disabled = false
} ) {
    const recording = recording_state === `recording`
    const starting = recording_state === `starting`
    const saving = recording_state === `saving`

    const press_button = ( event ) => {
        if( event.pointerId !== undefined ) event.currentTarget.setPointerCapture?.( event.pointerId )
        on_press()
    }

    const release_button = ( event ) => {
        if( event.pointerId !== undefined ) event.currentTarget.releasePointerCapture?.( event.pointerId )
        on_release()
    }

    const cancel_button = ( event ) => {
        if( event.pointerId !== undefined ) event.currentTarget.releasePointerCapture?.( event.pointerId )
        on_cancel()
    }

    const use_keyboard = ( event ) => {
        if( event.key !== `Enter` && event.key !== ` ` ) return

        event.preventDefault()
        if( event.repeat ) return
        on_toggle()
    }

    return <Button
        type="button"
        aria-label={ recording ? `Stop recording` : `Record clip` }
        title={ recording ? `Stop recording` : `Record clip` }
        $recording={ recording }
        disabled={ disabled || saving }
        onPointerDown={ press_button }
        onPointerUp={ release_button }
        onPointerCancel={ cancel_button }
        onKeyDown={ use_keyboard }
    >
        <Inner>
            { recording ? <Square size={ 24 } fill="currentColor" aria-hidden="true" /> : <Video size={ 25 } aria-hidden="true" /> }
            <span>{ recording ? format_duration( elapsed_ms ) : starting ? `Starting` : saving ? `Saving` : `Rec` }</span>
        </Inner>
    </Button>
}
