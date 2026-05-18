/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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

const existing_project = {
    id: `project-2`,
    title: `Pocket Walk`,
    created_at: `2026-05-17T10:00:00.000Z`,
    clip_count: 3,
    total_duration_ms: 4200,
    last_exported_at: `2026-05-17T11:00:00.000Z`
}

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
        expect( screen.getByRole( `button`, { name: `Create` } ) ).toBeTruthy()
        await user.click( screen.getByRole( `button`, { name: `Create Project` } ) )

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

    test( `surfaces unavailable local storage without leaving project history`, async () => {
        vi.mocked( list_projects ).mockRejectedValue( new Error( `IndexedDB unavailable` ) )

        render_project_list()

        expect( ( await screen.findByRole( `alert` ) ).textContent ).toMatch( /Local browser storage is unavailable/ )
        expect( screen.getByRole( `button`, { name: `Create Project` } ) ).toBeTruthy()
    } )

    test( `opens an existing project and marks it active`, async () => {
        const user = userEvent.setup()

        vi.mocked( list_projects ).mockResolvedValue( [ existing_project ] )

        render_project_list()

        await user.click( await screen.findByRole( `button`, { name: `Open Pocket Walk` } ) )

        expect( set_active_project ).toHaveBeenCalledWith( existing_project.id )
        expect( useAppStore.getState().active_project_id ).toBe( existing_project.id )
        expect( await screen.findByText( `/projects/project-2` ) ).toBeTruthy()
    } )

    test( `renames an existing project inline`, async () => {
        const user = userEvent.setup()

        vi.mocked( list_projects ).mockResolvedValue( [ existing_project ] )

        render_project_list()

        await screen.findByText( existing_project.title )
        await user.click( screen.getByRole( `button`, { name: `Rename Pocket Walk` } ) )

        const input = screen.getByLabelText( `Project title` )
        await user.clear( input )
        await user.type( input, `Pocket Walk Edited` )
        fireEvent.blur( input )

        expect( rename_project ).toHaveBeenCalledWith( existing_project.id, `Pocket Walk Edited` )
    } )

    test( `deletes an existing active project after confirmation`, async () => {
        const user = userEvent.setup()

        vi.mocked( list_projects ).mockResolvedValue( [ existing_project ] )
        vi.spyOn( window, `confirm` ).mockReturnValue( true )
        useAppStore.setState( { active_project_id: existing_project.id } )

        render_project_list()

        await screen.findByText( existing_project.title )
        await user.click( screen.getByRole( `button`, { name: `Delete Pocket Walk` } ) )

        expect( delete_project ).toHaveBeenCalledWith( existing_project.id )
        expect( useAppStore.getState().active_project_id ).toBe( null )
    } )
} )
