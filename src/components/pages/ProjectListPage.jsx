import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useNavigate } from 'react-router'
import { Plus, Settings } from 'lucide-react'
import styled from 'styled-components'
import { BottomAppBar } from '../atoms/BottomAppBar.jsx'
import { Content, EmptyState, HeaderBar, HeaderText, AppFrame } from '../atoms/Layout.jsx'
import { IconButton } from '../atoms/IconButton.jsx'
import { PrimaryActionButton } from '../atoms/PrimaryActionButton.jsx'
import { ProjectRow } from '../molecules/ProjectRow.jsx'
import { useAppStore } from '../../stores/app_store.js'
import {
    create_project,
    delete_project,
    list_projects,
    rename_project,
    set_active_project
} from '../../modules/storage/journal_storage.js'

const StorageAlert = styled.div`
    margin: 1rem 0;
    padding: 0.85rem;
    border: 1px solid rgba( 184, 47, 37, 0.28 );
    border-radius: 0.5rem;
    color: var(--color-danger);
    background: rgba( 216, 57, 43, 0.08 );
    line-height: 1.45;
`

/**
 * Shows project history and creation controls.
 * @returns {JSX.Element} Project list page.
 */
export function ProjectListPage() {
    const [ projects, set_projects ] = useState( [] )
    const [ storage_error, set_storage_error ] = useState( null )
    const navigate = useNavigate()
    const active_project_id = useAppStore( ( state ) => state.active_project_id )
    const set_active_project_id = useAppStore( ( state ) => state.set_active_project_id )

    const refresh_projects = useCallback( async () => {
        try {
            set_projects( await list_projects() )
            set_storage_error( null )
        } catch {
            set_storage_error( `Local browser storage is unavailable, so projects cannot be loaded.` )
        }
    }, [] )

    useEffect( () => {
        refresh_projects()
    }, [ refresh_projects ] )

    const create_next_project = async () => {
        try {
            const project = await create_project()
            set_active_project_id( project.id )
            navigate( `/projects/${ project.id }` )
        } catch {
            toast.error( `Project could not be created` )
            set_storage_error( `Local browser storage is unavailable, so clips cannot be saved here.` )
        }
    }

    const open_project = async ( project ) => {
        try {
            await set_active_project( project.id )
            set_active_project_id( project.id )
            navigate( `/projects/${ project.id }` )
        } catch {
            toast.error( `Project could not be opened` )
        }
    }

    const rename_existing_project = async ( project, title ) => {
        try {
            await rename_project( project.id, title )
            await refresh_projects()
        } catch {
            toast.error( `Project could not be renamed` )
        }
    }

    const delete_existing_project = async ( project ) => {
        const confirmed = window.confirm( `Delete "${ project.title }" and all clips stored for it?` )
        if( !confirmed ) return

        try {
            await delete_project( project.id )
            if( active_project_id === project.id ) set_active_project_id( null )
            await refresh_projects()
            toast( `Project deleted` )
        } catch {
            toast.error( `Project could not be deleted` )
        }
    }

    return <AppFrame>
        <Content>
            <HeaderBar>
                <HeaderText>
                    <h1>Projects</h1>
                    <p>Everything stays on this device and browser.</p>
                </HeaderText>
                <IconButton
                    icon={ Settings }
                    label="Open settings"
                    onClick={ () => navigate( `/settings` ) }
                />
            </HeaderBar>

            { storage_error ? <StorageAlert role="alert">{ storage_error }</StorageAlert> : null }

            { projects.length ? projects.map( ( project ) => <ProjectRow
                key={ project.id }
                project={ project }
                active={ project.id === active_project_id }
                on_open={ () => open_project( project ) }
                on_rename={ ( title ) => rename_existing_project( project, title ) }
                on_delete={ () => delete_existing_project( project ) }
            /> ) : <EmptyState>
                <div>
                    <h2>No projects yet</h2>
                    <p>Create a project and start recording clips without a setup step.</p>
                </div>
                <PrimaryActionButton icon={ Plus } onClick={ create_next_project }>Create</PrimaryActionButton>
            </EmptyState> }
        </Content>

        <BottomAppBar
            label="Project actions"
            center={ <PrimaryActionButton icon={ Plus } onClick={ create_next_project }>Create Project</PrimaryActionButton> }
            right={ <IconButton icon={ Settings } label="Open settings" onClick={ () => navigate( `/settings` ) } /> }
        />
    </AppFrame>
}
