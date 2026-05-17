import { Navigate, Route, Routes } from 'react-router'
import { ProjectCapturePage } from '../components/pages/ProjectCapturePage.jsx'
import { ProjectListPage } from '../components/pages/ProjectListPage.jsx'
import { RootRedirectPage } from '../components/pages/RootRedirectPage.jsx'
import { SettingsPage } from '../components/pages/SettingsPage.jsx'

/**
 * Defines app routes.
 * @returns {JSX.Element} Route tree.
 */
export default function AppRoutes() {
    return <Routes>
        <Route path="/" element={ <RootRedirectPage /> } />
        <Route path="/projects" element={ <ProjectListPage /> } />
        <Route path="/projects/:project_id" element={ <ProjectCapturePage /> } />
        <Route path="/settings" element={ <SettingsPage /> } />
        <Route path="*" element={ <Navigate to="/" replace /> } />
    </Routes>
}
