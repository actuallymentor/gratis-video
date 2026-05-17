/* @vitest-environment jsdom */

import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import {
    MemoryRouter,
    Route,
    Routes,
    useLocation
} from 'react-router'
import { RootRedirectPage } from './RootRedirectPage.jsx'
import { useAppStore } from '../../stores/app_store.js'

const LocationProbe = () => {
    const location = useLocation()
    return <div>{ location.pathname }</div>
}

const render_redirect = () => render(
    <MemoryRouter initialEntries={ [ `/` ] }>
        <Routes>
            <Route path="/" element={ <RootRedirectPage /> } />
            <Route path="/projects" element={ <LocationProbe /> } />
            <Route path="/projects/:project_id" element={ <LocationProbe /> } />
        </Routes>
    </MemoryRouter>
)

describe( `root redirect page`, () => {
    afterEach( () => {
        cleanup()
        useAppStore.setState( { active_project_id: undefined } )
    } )

    test( `waits while bootstrap is resolving the active project`, () => {
        useAppStore.setState( { active_project_id: undefined } )

        render_redirect()

        expect( screen.getByText( `Loading journal...` ) ).toBeTruthy()
    } )

    test( `opens the active project when one exists`, async () => {
        useAppStore.setState( { active_project_id: `project-1` } )

        render_redirect()

        expect( await screen.findByText( `/projects/project-1` ) ).toBeTruthy()
    } )

    test( `opens the project list when there is no active project`, async () => {
        useAppStore.setState( { active_project_id: null } )

        render_redirect()

        expect( await screen.findByText( `/projects` ) ).toBeTruthy()
    } )
} )
