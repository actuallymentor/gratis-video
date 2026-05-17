import styled from 'styled-components'

const ToggleRow = styled.label`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    min-height: 3.5rem;
    padding: 0.85rem 0;
    border-bottom: 1px solid var(--color-border);
`

const Text = styled.span`
    display: grid;
    gap: 0.2rem;

    strong {
        color: var(--color-ink);
        font-weight: 800;
    }

    span {
        max-width: 65ch;
        color: var(--color-muted);
        font-size: 0.92rem;
        line-height: 1.45;
    }
`

const Switch = styled.span`
    position: relative;
    flex: 0 0 auto;
    width: 3.25rem;
    height: 1.85rem;
    border-radius: 999px;
    background: ${ ( { $checked } ) => $checked ? `var(--color-accent)` : `#cfdad8` };
    transition: background 140ms ease;

    &::after {
        position: absolute;
        top: 0.22rem;
        left: ${ ( { $checked } ) => $checked ? `1.62rem` : `0.22rem` };
        width: 1.4rem;
        height: 1.4rem;
        border-radius: 999px;
        background: #ffffff;
        box-shadow: 0 0.2rem 0.5rem rgba( 18, 49, 51, 0.18 );
        transition: left 140ms ease;
        content: "";
    }
`

const Input = styled.input`
    position: absolute;
    opacity: 0;

    &:focus-visible + ${ Switch } {
        outline: 3px solid rgba( 44, 120, 136, 0.32 );
        outline-offset: 3px;
    }
`

/**
 * Renders a binary setting toggle.
 * @param {Object} props - Toggle props.
 * @returns {JSX.Element} Toggle control.
 */
export function Toggle( { label, description, checked, on_change } ) {
    return <ToggleRow>
        <Text>
            <strong>{ label }</strong>
            { description ? <span>{ description }</span> : null }
        </Text>
        <Input
            type="checkbox"
            aria-label={ label }
            checked={ checked }
            onChange={ ( event ) => on_change( event.target.checked ) }
        />
        <Switch $checked={ checked } aria-hidden="true" />
    </ToggleRow>
}
