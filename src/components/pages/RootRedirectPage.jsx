import { Navigate } from 'react-router'
import styled from 'styled-components'
import { useAppStore } from '../../stores/app_store.js'

const Loading = styled.main`
    display: grid;
    place-items: center;
    min-height: 100svh;
    color: var(--color-muted);
`

/**
 * Sends `/` to the active project when one exists, otherwise project history.
 * @returns {JSX.Element} Redirect or loading state.
 */
export function RootRedirectPage() {
    const active_project_id = useAppStore( ( state ) => state.active_project_id )

    if( active_project_id === undefined ) {
        return <Loading>Loading journal...</Loading>
    }

    if( active_project_id ) return <Navigate to={ `/projects/${ active_project_id }` } replace />
    return <Navigate to="/projects" replace />
}
