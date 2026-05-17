import styled from 'styled-components'

const Pill = styled.span`
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    min-height: 1.75rem;
    padding: 0.2rem 0.6rem;
    border: 1px solid ${ ( { $tone } ) => $tone === `danger` ? `rgba( 184, 47, 37, 0.36 )` : `var(--color-border)` };
    border-radius: 999px;
    color: ${ ( { $tone } ) => $tone === `danger` ? `var(--color-danger)` : `var(--color-muted)` };
    background: ${ ( { $tone } ) => $tone === `danger` ? `rgba( 216, 57, 43, 0.08 )` : `var(--color-surface)` };
    font-size: 0.82rem;
    font-weight: 800;
`

/**
 * Displays compact status metadata.
 * @param {Object} props - Pill props.
 * @returns {JSX.Element} Status pill.
 */
export function StatusPill( { icon: Icon, children, tone = `neutral` } ) {
    return <Pill $tone={ tone }>
        { Icon ? <Icon size={ 14 } aria-hidden="true" /> : null }
        { children }
    </Pill>
}
