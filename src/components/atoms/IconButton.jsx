import styled from 'styled-components'

const Button = styled.button`
    display: inline-grid;
    place-items: center;
    width: 3rem;
    min-width: 3rem;
    flex: 0 0 auto;
    height: 3rem;
    min-height: 3rem;
    border: 1px solid var(--color-border);
    border-radius: 999px;
    color: var(--color-ink);
    background: var(--color-surface);
    transition: transform 140ms ease, border-color 140ms ease, background 140ms ease;

    &:hover,
    &:focus-visible {
        border-color: var(--color-accent-strong);
        background: var(--color-surface-strong);
    }

    &:active {
        transform: scale( 0.96 );
    }

    &:disabled {
        color: var(--color-muted);
        background: var(--color-surface-strong);
    }
`

/**
 * Renders an accessible circular icon button.
 * @param {Object} props - Button props.
 * @returns {JSX.Element} Icon button.
 */
export function IconButton( { icon: Icon, label, title = label, ...props } ) {
    return <Button type="button" aria-label={ label } title={ title } { ...props }>
        <Icon size={ 20 } strokeWidth={ 2.2 } aria-hidden="true" />
    </Button>
}
