import styled from 'styled-components'

const Button = styled.button`
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    min-width: 4.5rem;
    min-height: 4.5rem;
    padding: 0 1.2rem;
    border: 0;
    border-radius: 999px;
    color: var(--color-on-filled);
    background: var(--color-filled);
    box-shadow: var(--shadow-soft);
    font-weight: 800;
    transition: transform 140ms ease, filter 140ms ease;

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
 * Renders the main bottom-bar action.
 * @param {Object} props - Button props.
 * @returns {JSX.Element} Primary action button.
 */
export function PrimaryActionButton( { icon: Icon, children, ...props } ) {
    return <Button type="button" { ...props }>
        { Icon ? <Icon size={ 26 } strokeWidth={ 2.4 } aria-hidden="true" /> : null }
        { children ? <span>{ children }</span> : null }
    </Button>
}
