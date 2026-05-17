/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
    MemoryRouter,
    Route,
    Routes,
    useLocation
} from 'react-router'
import { ProjectListPage } from './ProjectListPage.jsx'
import { useAppStore } from '../../stores/app_store.js'
import {
    create_project,
    delete_project,
    list_projects,
    rename_project,
    set_active_project
} from '../../modules/storage/journal_storage.js'

vi.mock( '../../modules/storage/journal_storage.js', () => ( {
    create_project: vi.fn(),
    delete_project: vi.fn(),
    list_projects: vi.fn(),
    rename_project: vi.fn(),
    set_active_project: vi.fn()
} ) )

const LocationProbe = () => {
    const location = useLocation()
    return <div>{ location.pathname }</div>
}

const render_project_list = () => render(
    <MemoryRouter initialEntries={ [ `/projects` ] }>
        <Routes>
            <Route path="/projects" element={ <ProjectListPage /> } />
            <Route path="/projects/:project_id" element={ <LocationProbe /> } />
            <Route path="/settings" element={ <LocationProbe /> } />
        </Routes>
    </MemoryRouter>
)

describe( `project list page`, () => {
    beforeEach( () => {
        vi.mocked( list_projects ).mockResolvedValue( [] )
        vi.mocked( create_project ).mockResolvedValue( {
            id: `project-1`,
            title: `May 17, 2026`
        } )
        vi.mocked( set_active_project ).mockResolvedValue()
        vi.mocked( rename_project ).mockResolvedValue()
        vi.mocked( delete_project ).mockResolvedValue()
        useAppStore.setState( { active_project_id: null } )
    } )

    afterEach( () => {
        cleanup()
        vi.resetAllMocks()
        useAppStore.setState( { active_project_id: undefined } )
    } )

    test( `creates a project immediately and opens its capture screen`, async () => {
        const user = userEvent.setup()

        render_project_list()

        expect( await screen.findByText( `No projects yet` ) ).toBeTruthy()
        await user.click( screen.getByRole( `button`, { name: `New` } ) )

        expect( create_project ).toHaveBeenCalledTimes( 1 )
        expect( useAppStore.getState().active_project_id ).toBe( `project-1` )
        expect( await screen.findByText( `/projects/project-1` ) ).toBeTruthy()
    } )

    test( `keeps settings reachable from the project history screen`, async () => {
        const user = userEvent.setup()

        render_project_list()

        await screen.findByText( `No projects yet` )
        await user.click( screen.getAllByRole( `button`, { name: `Open settings` } )[ 0 ] )

        expect( await screen.findByText( `/settings` ) ).toBeTruthy()
    } )
} )
