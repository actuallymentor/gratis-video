import { useEffect, useState } from 'react'
import styled from 'styled-components'
import { log } from 'mentie/modules/logging.js'
import { Download } from 'lucide-react'

const installed_display_modes = [
    `standalone`,
    `fullscreen`,
    `minimal-ui`,
    `window-controls-overlay`
]

const PillButton = styled.button`
    position: fixed;
    bottom: calc( 0.85rem + env( safe-area-inset-bottom ) );
    left: calc( 0.85rem + env( safe-area-inset-left ) );
    z-index: 30;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    min-height: 2.75rem;
    padding: 0.35rem 0.8rem;
    border: 1px solid rgba( 44, 120, 136, 0.32 );
    border-radius: 999px;
    color: var(--color-ink);
    background: rgba( 255, 255, 255, 0.96 );
    box-shadow: var(--shadow-soft);
    font-size: 0.88rem;
    font-weight: 900;
    transition: transform 140ms ease, filter 140ms ease, border-color 140ms ease;

    &:hover,
    &:focus-visible {
        border-color: var(--color-accent-strong);
        filter: brightness( 0.98 );
    }

    &:active {
        transform: scale( 0.96 );
    }

    svg {
        flex: 0 0 auto;
    }
`

const is_running_installed_pwa = () => {
    const is_ios_standalone = window.navigator.standalone === true
    const is_display_mode_installed = installed_display_modes.some( ( display_mode ) => {
        const display_mode_query = window.matchMedia?.( `(display-mode: ${ display_mode })` )

        return display_mode_query?.matches
    } )

    return is_ios_standalone || is_display_mode_installed
}

/**
 * Shows a compact PWA install action when the browser exposes an install prompt.
 * @returns {JSX.Element|null} PWA install pill.
 */
export function PwaInstallPill() {

    const [ install_prompt, set_install_prompt ] = useState( null )
    const [ is_installed_mode, set_is_installed_mode ] = useState( false )

    useEffect( () => {
        const update_installed_mode = () => {
            set_is_installed_mode( is_running_installed_pwa() )
        }
        const store_install_prompt = ( event ) => {
            event.preventDefault()
            if( is_running_installed_pwa() ) return

            set_install_prompt( event )
        }
        const clear_install_prompt = () => {
            set_install_prompt( null )
            update_installed_mode()
        }

        update_installed_mode()
        window.addEventListener( `beforeinstallprompt`, store_install_prompt )
        window.addEventListener( `appinstalled`, clear_install_prompt )

        return () => {
            window.removeEventListener( `beforeinstallprompt`, store_install_prompt )
            window.removeEventListener( `appinstalled`, clear_install_prompt )
        }
    }, [] )

    if( is_installed_mode || !install_prompt ) return null

    const install_app = async () => {
        const prompt_to_show = install_prompt

        set_install_prompt( null )

        try {
            const prompt_result = await prompt_to_show.prompt()
            const user_choice = prompt_result ?? await prompt_to_show.userChoice
            const outcome = user_choice?.outcome ?? `unknown`

            log.info( `PWA install prompt completed`, { outcome } )
        } catch ( error ) {
            log.warn( `PWA install prompt failed`, error )
        }
    }

    return <PillButton type="button" onClick={ install_app } aria-label="Install app">
        <Download size={ 16 } strokeWidth={ 2.5 } aria-hidden="true" />
        <span>Install App</span>
    </PillButton>
}
