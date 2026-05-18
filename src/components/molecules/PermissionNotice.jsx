import styled from 'styled-components'
import { Link } from 'react-router'
import { AlertCircle } from 'lucide-react'

const Notice = styled.div`
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
    padding: 0.85rem;
    border: 1px solid ${ ( { $urgent } ) => $urgent ? `rgba( 184, 47, 37, 0.28 )` : `rgba( 145, 107, 29, 0.28 )` };
    border-radius: 0.5rem;
    color: ${ ( { $urgent } ) => $urgent ? `var(--color-danger)` : `var(--color-warning)` };
    background: ${ ( { $urgent } ) => $urgent ? `rgba( 216, 57, 43, 0.08 )` : `rgba( 255, 209, 102, 0.12 )` };
    line-height: 1.45;

    svg {
        flex: 0 0 auto;
        margin-top: 0.1rem;
    }
`

const NoticeContent = styled.span`
    display: grid;
    gap: 0.45rem;
`

const NoticeAction = styled( Link )`
    width: fit-content;
    display: inline-flex;
    align-items: center;
    min-height: 3rem;
    padding-inline: 0.25rem;
    color: var(--color-ink);
    font-weight: 900;
`

/**
 * Shows media permission or capability guidance near recording controls.
 * @param {Object} props - Notice props.
 * @returns {JSX.Element|null} Permission notice.
 */
export function PermissionNotice( { message, action_to = null, action_label = null, urgent = false } ) {
    if( !message ) return null

    return <Notice role={ urgent ? `alert` : `status` } $urgent={ urgent }>
        <AlertCircle size={ 18 } aria-hidden="true" />
        <NoticeContent>
            <span>{ message }</span>
            { action_to && action_label ? <NoticeAction to={ action_to }>{ action_label }</NoticeAction> : null }
        </NoticeContent>
    </Notice>
}
