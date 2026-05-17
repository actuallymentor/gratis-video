import { useState } from 'react'
import styled from 'styled-components'
import { CalendarDays, CheckCircle2, Clock3, FileCheck2, Film, Pencil, Trash2 } from 'lucide-react'
import { IconButton } from '../atoms/IconButton.jsx'
import { StatusPill } from '../atoms/StatusPill.jsx'
import { format_date, format_duration } from '../../modules/media/time.js'

const Row = styled.article`
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.75rem;
    min-height: 5.5rem;
    padding: 1rem;
    border: 1px solid ${ ( { $active } ) => $active ? `var(--color-accent-strong)` : `var(--color-border)` };
    border-radius: 0.5rem;
    background: var(--color-surface);
`

const MainButton = styled.button`
    display: grid;
    gap: 0.75rem;
    min-width: 0;
    padding: 0;
    border: 0;
    color: inherit;
    background: transparent;
    text-align: left;
`

const EditingBlock = styled.div`
    display: grid;
    gap: 0.75rem;
    min-width: 0;
`

const Title = styled.h2`
    margin: 0;
    color: var(--color-ink);
    font-family: var(--font-heading);
    font-size: 1.05rem;
    font-weight: 700;
`

const Meta = styled.div`
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
`

const Actions = styled.div`
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
`

const RenameForm = styled.form`
    display: grid;
    gap: 0.5rem;

    input {
        width: 100%;
        min-height: 3rem;
        padding: 0.5rem 0.75rem;
        border: 1px solid var(--color-accent-strong);
        border-radius: 0.5rem;
        color: var(--color-ink);
        background: var(--color-surface);
    }
`

function ProjectMeta( { active, project } ) {
    return <Meta>
        { active ? <StatusPill icon={ CheckCircle2 }>Active</StatusPill> : null }
        <StatusPill icon={ CalendarDays }>{ format_date( project.created_at ) }</StatusPill>
        <StatusPill icon={ Film }>{ project.clip_count } clips</StatusPill>
        <StatusPill icon={ Clock3 }>{ format_duration( project.total_duration_ms ) }</StatusPill>
        { project.last_exported_at ? <StatusPill icon={ FileCheck2 }>Export ready</StatusPill> : null }
    </Meta>
}

/**
 * Displays one project row with open, rename, and delete actions.
 * @param {Object} props - Project row props.
 * @returns {JSX.Element} Project row.
 */
export function ProjectRow( {
    project,
    active,
    on_open,
    on_rename,
    on_delete
} ) {
    const [ editing, set_editing ] = useState( false )
    const [ title, set_title ] = useState( project.title )

    const save_title = ( event ) => {
        event.preventDefault()
        on_rename( title )
        set_editing( false )
    }

    return <Row $active={ active }>
        { editing ? <EditingBlock>
            <RenameForm onSubmit={ save_title }>
                <label className="sr-only" htmlFor={ `project-title-${ project.id }` }>Project title</label>
                <input
                    id={ `project-title-${ project.id }` }
                    value={ title }
                    onChange={ ( event ) => set_title( event.target.value ) }
                    onBlur={ save_title }
                />
            </RenameForm>
            <ProjectMeta active={ active } project={ project } />
        </EditingBlock> : <MainButton type="button" onClick={ on_open }>
            <Title>{ project.title }</Title>
            <ProjectMeta active={ active } project={ project } />
        </MainButton> }
        <Actions>
            <IconButton
                icon={ Pencil }
                label="Rename project"
                onClick={ () => set_editing( true ) }
            />
            <IconButton
                icon={ Trash2 }
                label="Delete project"
                onClick={ on_delete }
            />
        </Actions>
    </Row>
}
