import { useEffect, useRef } from 'react'

const focusable_selector = [
    `a[href]`,
    `button:not([disabled])`,
    `input:not([disabled])`,
    `select:not([disabled])`,
    `textarea:not([disabled])`,
    `[tabindex]:not([tabindex="-1"])`
].join( `,` )

const get_focusable_elements = ( container ) => {
    return Array.from( container?.querySelectorAll( focusable_selector ) ?? [] )
        .filter( ( element ) => !element.hasAttribute( `disabled` ) && !element.closest( `[hidden]` ) )
}

// Nested modals share document-level key handling; only the topmost surface owns Escape and Tab.
const modal_stack = []

/**
 * Moves focus into a modal dialog, traps Tab, closes on Escape, and restores focus.
 * @param {Object} options - Modal focus options.
 * @param {boolean} options.active - Whether the modal is mounted.
 * @param {Function} options.on_close - Escape key close handler.
 * @returns {Object} Ref to attach to the dialog surface.
 */
export function useModalFocus( { active = true, on_close } = {} ) {
    const modal_ref = useRef( null )
    const on_close_ref = useRef( on_close )

    useEffect( () => {
        on_close_ref.current = on_close
    }, [ on_close ] )

    useEffect( () => {
        if( !active ) return undefined

        const previously_focused = document.activeElement
        const modal = modal_ref.current
        const original_body_overflow = document.body.style.overflow
        const stack_entry = { modal_ref }

        modal_stack.push( stack_entry )

        document.body.style.overflow = `hidden`

        const focus_timeout = window.setTimeout( () => {
            const [ first_focusable ] = get_focusable_elements( modal )
            const next_focus = first_focusable ?? modal
            next_focus?.focus?.()
        }, 0 )

        const handle_keydown = ( event ) => {
            if( modal_stack.at( -1 ) !== stack_entry ) return

            if( event.key === `Escape` ) {
                event.preventDefault()
                on_close_ref.current?.()
                return
            }

            if( event.key !== `Tab` ) return

            const focusable_elements = get_focusable_elements( modal )
            if( !focusable_elements.length ) {
                event.preventDefault()
                modal?.focus?.()
                return
            }

            const first_element = focusable_elements.at( 0 )
            const last_element = focusable_elements.at( -1 )

            if( event.shiftKey && document.activeElement === first_element ) {
                event.preventDefault()
                last_element.focus()
            } else if( !event.shiftKey && document.activeElement === last_element ) {
                event.preventDefault()
                first_element.focus()
            }
        }

        document.addEventListener( `keydown`, handle_keydown )

        return () => {
            window.clearTimeout( focus_timeout )
            document.removeEventListener( `keydown`, handle_keydown )
            const stack_index = modal_stack.indexOf( stack_entry )
            if( stack_index >= 0 ) modal_stack.splice( stack_index, 1 )
            document.body.style.overflow = original_body_overflow
            previously_focused?.focus?.()
        }
    }, [ active ] )

    return modal_ref
}
