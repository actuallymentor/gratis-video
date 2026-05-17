import styled from 'styled-components'

export const AppFrame = styled.main`
    min-height: 100svh;
    padding: env( safe-area-inset-top ) 0 calc( 6.5rem + env( safe-area-inset-bottom ) );
    background: var(--color-canvas);
`

export const Content = styled.div`
    width: min( 100%, 70rem );
    margin: 0 auto;
    padding: 1rem;

    @media (min-width: 56rem) {
        padding: 1.5rem 2rem;
    }
`

export const HeaderBar = styled.header`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    min-height: 3.5rem;
    margin-bottom: 1rem;
`

export const HeaderText = styled.div`
    min-width: 0;

    h1 {
        margin: 0;
        color: var(--color-ink);
        font-family: var(--font-heading);
        font-size: 1.45rem;
        font-weight: 600;
        line-height: 1.15;
        overflow-wrap: anywhere;
    }

    p {
        max-width: 65ch;
        margin: 0.35rem 0 0;
        color: var(--color-muted);
        line-height: 1.55;
    }
`

export const SectionTitle = styled.h2`
    margin: 1.5rem 0 0.75rem;
    color: var(--color-ink);
    font-family: var(--font-heading);
    font-size: 1rem;
    font-weight: 600;
`

export const EmptyState = styled.section`
    display: grid;
    place-items: center;
    min-height: 42svh;
    padding: 2rem 1rem;
    color: var(--color-muted);
    text-align: center;

    h2 {
        margin: 0 0 0.5rem;
        color: var(--color-ink);
        font-family: var(--font-heading);
        font-size: 1.25rem;
    }

    p {
        max-width: 34ch;
        margin: 0;
        line-height: 1.55;
    }
`

export const InlineActions = styled.div`
    display: flex;
    align-items: center;
    gap: 0.5rem;
`
