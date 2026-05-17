import styled from 'styled-components'
import { AlertCircle } from 'lucide-react'

const Notice = styled.div`
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
    padding: 0.85rem;
    border: 1px solid rgba( 145, 107, 29, 0.28 );
    border-radius: 0.5rem;
    color: var(--color-warning);
    background: rgba( 255, 209, 102, 0.12 );
    line-height: 1.45;

    svg {
        flex: 0 0 auto;
        margin-top: 0.1rem;
    }
`

/**
 * Shows media permission or capability guidance near recording controls.
 * @param {Object} props - Notice props.
 * @returns {JSX.Element|null} Permission notice.
 */
export function PermissionNotice( { message } ) {
    if( !message ) return null

    return <Notice role="status">
        <AlertCircle size={ 18 } aria-hidden="true" />
        <span>{ message }</span>
    </Notice>
}
