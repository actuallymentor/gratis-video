export const app_return_event_type = `daily-video-journal:app-return`

/**
 * Emits one normalized event when the page returns to an active visible state.
 * @param {string} reason - Browser event that detected the app return.
 * @returns {void}
 */
export function emit_app_return_event( reason = `unknown` ) {
    if( !globalThis.window?.dispatchEvent ) return

    const event = typeof globalThis.CustomEvent === `function`
        ? new CustomEvent( app_return_event_type, { detail: { reason } } )
        : new Event( app_return_event_type )

    window.dispatchEvent( event )
}

/**
 * Subscribes to normalized visible-app-return events.
 * @param {Function} callback - Callback to run after the app returns.
 * @returns {Function} Unsubscribe function.
 */
export function listen_for_app_return_event( callback ) {
    if( !globalThis.window?.addEventListener ) return () => {}

    const listener = () => callback()

    window.addEventListener( app_return_event_type, listener )

    return () => window.removeEventListener( app_return_event_type, listener )
}
