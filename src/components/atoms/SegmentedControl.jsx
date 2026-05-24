import styled from 'styled-components'

const Group = styled.div`
    display: grid;
    grid-template-columns: repeat( ${ ( { $count } ) => $count }, minmax( 0, 1fr ) );
    gap: 0.25rem;
    padding: 0.25rem;
    border: 1px solid var(--color-border);
    border-radius: 0.5rem;
    background: var(--color-surface-strong);
`

const Segment = styled.button`
    min-height: 3rem;
    padding: 0.35rem 0.6rem;
    border: 0;
    border-radius: 0.35rem;
    color: ${ ( { $active } ) => $active ? `#0d1718` : `var(--color-muted)` };
    background: ${ ( { $active } ) => $active ? `var(--color-surface)` : `transparent` };
    box-shadow: ${ ( { $active } ) => $active ? `0 0.25rem 0.75rem rgba( 18, 49, 51, 0.08 )` : `none` };
    font-weight: 800;

    &:disabled {
        color: var(--color-muted);
        opacity: 0.62;
    }
`

/**
 * Renders a small mutually exclusive option set.
 * @param {Object} props - Control props.
 * @returns {JSX.Element} Segmented control.
 */
export function SegmentedControl( { label, options, value, on_change, disabled = false } ) {
    return <Group role="group" aria-label={ label } $count={ Math.max( 1, options.length ) }>
        { options.map( ( option ) => <Segment
            key={ option.value }
            type="button"
            $active={ option.value === value }
            aria-pressed={ option.value === value }
            onClick={ () => on_change( option.value ) }
            disabled={ disabled }
        >
            { option.label }
        </Segment> ) }
    </Group>
}
