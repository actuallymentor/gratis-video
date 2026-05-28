import { useEffect, useState } from 'react'
import styled from 'styled-components'
import { log } from 'mentie/modules/logging.js'
import { RefreshCw } from 'lucide-react'
import { register_service_worker_update } from '../../modules/pwa/service_worker_registration.js'

const Badge = styled.aside`
    position: fixed;
    top: calc( 0.75rem + env( safe-area-inset-top ) );
    left: 50%;
    z-index: 90;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: min( calc( 100vw - 2rem ), 28rem );
    padding: 0.75rem;
    border: 1px solid rgba( 44, 120, 136, 0.32 );
    border-radius: 0.5rem;
    color: var(--color-ink);
    background: rgba( 255, 255, 255, 0.96 );
    box-shadow: var(--shadow-soft);
    transform: translateX( -50% );
`

const BadgeText = styled.div`
    min-width: 0;
    flex: 1 1 auto;
    line-height: 1.35;

    strong {
        display: block;
        margin-bottom: 0.1rem;
        font-size: 0.9rem;
    }

    span {
        display: block;
        color: var(--color-muted);
        font-size: 0.84rem;
    }
`

const ReloadButton = styled.button`
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    min-width: 5.75rem;
    min-height: 2.75rem;
    padding: 0 0.8rem;
    border: 0;
    border-radius: 0.5rem;
    color: var(--color-on-filled);
    background: var(--color-accent-strong);
    font-weight: 800;
    transition: filter 140ms ease, transform 140ms ease;

    &:hover,
    &:focus-visible {
        filter: brightness( 0.96 );
    }

    &:active {
        transform: scale( 0.96 );
    }

    svg {
        flex: 0 0 auto;
    }
`

/**
 * Shows a persistent reload action when a service-worker update is waiting.
 * @returns {JSX.Element|null} PWA refresh badge.
 */
export function PwaRefreshBadge() {

    const [ update_service_worker, set_update_service_worker ] = useState( null )

    useEffect( () => {
        let is_active = true

        register_service_worker_update( {
            on_need_refresh: ( refresh_update ) => {
                if( is_active ) set_update_service_worker( () => refresh_update )
            }
        } ).catch( ( error ) => {
            log.warn( `Service worker registration failed`, error )
        } )

        return () => {
            is_active = false
        }
    }, [] )

    if( !update_service_worker ) return null

    const reload_page = () => {
        update_service_worker().catch( ( error ) => {
            log.warn( `Service worker reload failed`, error )
        } )
    }

    return <Badge role="status" aria-live="polite">
        <BadgeText>
            <strong>Update ready</strong>
            <span>Reload page to finish.</span>
        </BadgeText>
        <ReloadButton type="button" onClick={ reload_page }>
            <RefreshCw size={ 16 } strokeWidth={ 2.5 } aria-hidden="true" />
            Reload
        </ReloadButton>
    </Badge>
}
