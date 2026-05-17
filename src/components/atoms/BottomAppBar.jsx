import styled from 'styled-components'

const Bar = styled.nav`
    position: fixed;
    right: 0;
    bottom: 0;
    left: 0;
    z-index: 20;
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 0.75rem;
    min-height: calc( 5.25rem + env( safe-area-inset-bottom ) );
    padding: 0.75rem 1rem calc( 0.75rem + env( safe-area-inset-bottom ) );
    border-top: 1px solid var(--color-border);
    background: rgba( 247, 250, 249, 0.92 );
    backdrop-filter: blur( 16px );
`

const Slot = styled.div`
    display: flex;
    align-items: center;
    justify-content: ${ ( { $align } ) => $align };
    gap: 0.5rem;
    min-width: 0;
`

/**
 * Keeps primary actions anchored near the bottom edge.
 * @param {Object} props - Slot content.
 * @returns {JSX.Element} Bottom app bar.
 */
export function BottomAppBar( { left = null, center, right = null, label } ) {
    return <Bar aria-label={ label }>
        <Slot $align="flex-start">{ left }</Slot>
        <Slot $align="center">{ center }</Slot>
        <Slot $align="flex-end">{ right }</Slot>
    </Bar>
}
