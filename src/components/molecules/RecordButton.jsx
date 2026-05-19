import { useRef } from 'react'
import styled, { css, keyframes } from 'styled-components'
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
    color: var(--color-on-filled);
    background: ${ ( { $recording } ) => $recording ? `var(--color-recording)` : `var(--color-filled)` };
    box-shadow: var(--shadow-soft);
    touch-action: none;
    user-select: none;
    animation: none;

    ${ ( { $recording } ) => $recording ? css`
        @media (prefers-reduced-motion: no-preference) {
            animation: ${ pulse } 900ms ease-out infinite;
        }

        @media (prefers-reduced-motion: reduce) {
            box-shadow: 0 0 0 0.35rem rgba( 216, 57, 43, 0.24 ), var(--shadow-soft);
        }
    ` : `` }

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

const recording_state_labels = {
    idle: `Record clip`,
    starting: `Starting recording`,
    recording: `Stop recording`,
    saving: `Saving recording`
}

const capture_pointer = ( event ) => {
    if( event.pointerId === undefined ) return

    try {
        event.currentTarget.setPointerCapture?.( event.pointerId )
    } catch {
        // Pointer capture is a convenience; the record action still needs to run.
    }
}

const release_pointer = ( event ) => {
    if( event.pointerId === undefined ) return

    try {
        event.currentTarget.releasePointerCapture?.( event.pointerId )
    } catch {
        // Browsers may release capture before pointercancel reaches this handler.
    }
}

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
    const accessible_label = recording_state_labels[ recording_state ] ?? recording_state_labels.idle
    const active_pointer_id_ref = useRef( null )
    const last_direct_activation_at_ref = useRef( Number.NEGATIVE_INFINITY )

    const mark_direct_activation = () => {
        last_direct_activation_at_ref.current = performance.now()
    }

    const recently_handled_direct_activation = () => {
        return performance.now() - last_direct_activation_at_ref.current < 500
    }

    const claim_pointer = ( event ) => {
        if( active_pointer_id_ref.current !== null ) return false
        if( event.button !== undefined && event.button !== 0 ) return false

        active_pointer_id_ref.current = event.pointerId ?? `pointer`
        return true
    }

    const release_active_pointer = ( event ) => {
        const pointer_id = event.pointerId ?? `pointer`

        if( active_pointer_id_ref.current !== pointer_id ) return false

        active_pointer_id_ref.current = null
        return true
    }

    const press_button = ( event ) => {
        if( !claim_pointer( event ) ) return

        mark_direct_activation()
        capture_pointer( event )
        on_press()
    }

    const release_button = ( event ) => {
        if( !release_active_pointer( event ) ) return

        mark_direct_activation()
        release_pointer( event )
        on_release()
    }

    const cancel_button = ( event ) => {
        if( !release_active_pointer( event ) ) return

        mark_direct_activation()
        release_pointer( event )
        on_cancel()
    }

    const use_keyboard = ( event ) => {
        if( event.key !== `Enter` && event.key !== ` ` ) return

        event.preventDefault()
        if( event.repeat ) return
        mark_direct_activation()
        on_toggle()
    }

    const activate_from_click = () => {
        if( recently_handled_direct_activation() ) return

        on_toggle()
    }

    return <Button
        type="button"
        aria-label={ accessible_label }
        title={ accessible_label }
        $recording={ recording }
        disabled={ disabled || saving }
        onPointerDown={ press_button }
        onPointerUp={ release_button }
        onPointerCancel={ cancel_button }
        onKeyDown={ use_keyboard }
        onClick={ activate_from_click }
    >
        <Inner>
            { recording ? <Square size={ 24 } fill="currentColor" aria-hidden="true" /> : <Video size={ 25 } aria-hidden="true" /> }
            <span>{ recording ? format_duration( elapsed_ms ) : starting ? `Starting` : saving ? `Saving` : `Rec` }</span>
        </Inner>
    </Button>
}
