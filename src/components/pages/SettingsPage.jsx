import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useNavigate } from 'react-router'
import styled from 'styled-components'
import { ArrowLeft, Trash2 } from 'lucide-react'
import { BottomAppBar } from '../atoms/BottomAppBar.jsx'
import { Content, HeaderBar, HeaderText, AppFrame, SectionTitle } from '../atoms/Layout.jsx'
import { IconButton } from '../atoms/IconButton.jsx'
import { SegmentedControl } from '../atoms/SegmentedControl.jsx'
import { Toggle } from '../atoms/Toggle.jsx'
import {
    get_export_support_message,
    get_supported_export_resolutions
} from '../../modules/export/exporter.js'
import { get_supported_mime_types } from '../../modules/media/recorder.js'
import {
    default_settings,
    delete_all_data,
    estimate_storage,
    load_settings,
    persisted_storage,
    save_settings
} from '../../modules/storage/journal_storage.js'
import { useAppStore } from '../../stores/app_store.js'

const SettingsList = styled.section`
    display: grid;
    gap: 0.85rem;
`

const SettingGroup = styled.div`
    padding: 1rem;
    border: 1px solid var(--color-border);
    border-radius: 0.5rem;
    background: var(--color-surface);
`

const Field = styled.label`
    display: grid;
    gap: 0.5rem;
    color: var(--color-ink);
    font-weight: 800;

    span {
        color: var(--color-muted);
        font-size: 0.92rem;
        font-weight: 500;
        line-height: 1.45;
    }

    select {
        width: 100%;
        min-width: 0;
        min-height: 3rem;
        padding: 0.5rem 0.75rem;
        border: 1px solid var(--color-border);
        border-radius: 0.5rem;
        color: var(--color-ink);
        background: var(--color-surface);
    }
`

const StorageText = styled.p`
    max-width: 65ch;
    margin: 0.5rem 0 0;
    color: var(--color-muted);
    line-height: 1.55;
`

const DangerButton = styled.button`
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    min-height: 3rem;
    margin-top: 0.75rem;
    padding: 0.5rem 0.9rem;
    border: 1px solid rgba( 184, 47, 37, 0.35 );
    border-radius: 0.5rem;
    color: var(--color-danger);
    background: rgba( 216, 57, 43, 0.08 );
    font-weight: 900;
`

const StorageAlert = styled.div`
    margin: 1rem 0;
    padding: 0.85rem;
    border: 1px solid rgba( 184, 47, 37, 0.28 );
    border-radius: 0.5rem;
    color: var(--color-danger);
    background: rgba( 216, 57, 43, 0.08 );
    line-height: 1.45;
`

const quality_options = [
    { value: `standard`, label: `Standard` },
    { value: `high`, label: `High` }
]

const format_bytes = ( bytes = 0 ) => {
    if( bytes < 1024 ) return `${ bytes } B`
    if( bytes < 1024 * 1024 ) return `${ Math.round( bytes / 1024 ) } KB`
    if( bytes < 1024 * 1024 * 1024 ) return `${ Math.round( bytes / 1024 / 1024 ) } MB`
    return `${ ( bytes / 1024 / 1024 / 1024 ).toFixed( 1 ) } GB`
}

/**
 * Shows global recording, export, storage, and destructive settings.
 * @returns {JSX.Element} Settings page.
 */
export function SettingsPage() {
    const [ settings, set_settings ] = useState( null )
    const [ supported_mime_types, set_supported_mime_types ] = useState( [] )
    const [ supported_resolution_options, set_supported_resolution_options ] = useState( [] )
    const [ export_support_message, set_export_support_message ] = useState( null )
    const [ storage_error, set_storage_error ] = useState( null )
    const navigate = useNavigate()
    const storage_estimate = useAppStore( ( state ) => state.storage_estimate )
    const storage_persisted = useAppStore( ( state ) => state.storage_persisted )
    const set_storage_estimate = useAppStore( ( state ) => state.set_storage_estimate )
    const set_storage_persisted = useAppStore( ( state ) => state.set_storage_persisted )
    const set_active_project_id = useAppStore( ( state ) => state.set_active_project_id )

    useEffect( () => {
        const load = async () => {
            try {
                const [ loaded_settings, estimate, persisted ] = await Promise.all( [
                    load_settings(),
                    estimate_storage(),
                    persisted_storage()
                ] )

                set_settings( loaded_settings )
                set_supported_mime_types( get_supported_mime_types() )
                set_supported_resolution_options( get_supported_export_resolutions() )
                set_export_support_message( get_export_support_message() )
                set_storage_estimate( estimate )
                set_storage_persisted( persisted )
                set_storage_error( null )
            } catch {
                set_storage_error( `Local browser storage is unavailable, so settings cannot be saved here.` )
                set_settings( default_settings )
                set_supported_resolution_options( get_supported_export_resolutions() )
                set_export_support_message( get_export_support_message() )
            }
        }

        load()
    }, [ set_storage_estimate, set_storage_persisted ] )

    const update_setting = async ( patch ) => {
        try {
            const saved_settings = await save_settings( {
                ...settings,
                ...patch
            } )
            set_settings( saved_settings )
        } catch {
            toast.error( `Setting could not be saved` )
        }
    }

    const delete_everything = async () => {
        const confirmed = window.confirm( `Delete every project, clip, and export stored in this browser?` )
        if( !confirmed ) return

        try {
            await delete_all_data()
            set_active_project_id( null )
            toast( `Local data deleted` )
            navigate( `/projects`, { replace: true } )
        } catch {
            toast.error( `Local data could not be deleted` )
        }
    }

    if( !settings ) {
        return <AppFrame>
            <Content>Loading settings...</Content>
        </AppFrame>
    }

    const format_options = [
        { value: ``, label: `Browser default` },
        ...supported_mime_types.map( ( mime_type ) => ( {
            value: mime_type,
            label: mime_type
        } ) )
    ]
    const storage_usage = storage_estimate
        ? `${ format_bytes( storage_estimate.usage ?? 0 ) } used of ${ format_bytes( storage_estimate.quota ?? 0 ) }`
        : `Storage estimate unavailable`
    const storage_ratio = storage_estimate?.quota
        ? ( storage_estimate.usage ?? 0 ) / storage_estimate.quota
        : 0
    const storage_warning = storage_ratio >= 0.85
        ? `Local browser storage is almost full. Export or delete old clips before recording more.`
        : null
    const persistence_text = storage_persisted === null
        ? `Persistence status unavailable`
        : storage_persisted ? `Persistent storage granted` : `Persistent storage not granted`
    const selected_mime_type = supported_mime_types.includes( settings.preferred_mime_type )
        ? settings.preferred_mime_type
        : ``
    const selected_export_resolution = supported_resolution_options.some( ( { value } ) => value === settings.export_resolution )
        ? settings.export_resolution
        : default_settings.export_resolution

    return <AppFrame>
        <Content>
            <HeaderBar>
                <HeaderText>
                    <h1>Settings</h1>
                    <p>Configure defaults without adding steps to capture.</p>
                </HeaderText>
                <IconButton icon={ ArrowLeft } label="Back to projects" onClick={ () => navigate( `/projects` ) } />
            </HeaderBar>

            { storage_error ? <StorageAlert role="alert">{ storage_error }</StorageAlert> : null }
            { storage_warning ? <StorageAlert role="status">{ storage_warning }</StorageAlert> : null }

            <SettingsList>
                <SettingGroup>
                    <SectionTitle>Export</SectionTitle>
                    <Field>
                        Format
                        <span>Only formats this browser reports as recordable are shown.</span>
                        <select
                            value={ selected_mime_type }
                            onChange={ ( event ) => update_setting( {
                                preferred_mime_type: event.target.value || null
                            } ) }
                        >
                            { format_options.map( ( option ) => <option key={ option.value } value={ option.value }>
                                { option.label }
                            </option> ) }
                        </select>
                    </Field>

                    <SectionTitle>Quality</SectionTitle>
                    <SegmentedControl
                        label="Export quality"
                        options={ quality_options }
                        value={ settings.export_quality }
                        on_change={ ( export_quality ) => update_setting( { export_quality } ) }
                    />

                    <SectionTitle>Resolution</SectionTitle>
                    { supported_resolution_options.length ? <SegmentedControl
                        label="Export resolution"
                        options={ supported_resolution_options }
                        value={ selected_export_resolution }
                        on_change={ ( export_resolution ) => update_setting( { export_resolution } ) }
                    /> : <StorageText>{ export_support_message }</StorageText> }
                </SettingGroup>

                <SettingGroup>
                    <SectionTitle>Feedback</SectionTitle>
                    <Toggle
                        label="Haptics"
                        description="Use short vibration pulses for recording start and stop when the device supports it."
                        checked={ settings.haptics_enabled }
                        on_change={ ( haptics_enabled ) => update_setting( { haptics_enabled } ) }
                    />
                    <Toggle
                        label="Sound feedback"
                        description="Reserved for optional feedback. Sounds stay off by default."
                        checked={ settings.sounds_enabled }
                        on_change={ ( sounds_enabled ) => update_setting( { sounds_enabled } ) }
                    />
                </SettingGroup>

                <SettingGroup>
                    <SectionTitle>Storage</SectionTitle>
                    <StorageText>{ storage_usage }</StorageText>
                    <StorageText>{ persistence_text }</StorageText>
                    <StorageText>
                        Video, audio, thumbnails, settings, and exports are stored locally in this browser. Clearing site data can remove them.
                    </StorageText>
                </SettingGroup>

                <SettingGroup>
                    <SectionTitle>Delete Local Data</SectionTitle>
                    <StorageText>This removes all local projects, clips, thumbnails, cached exports, and settings.</StorageText>
                    <DangerButton type="button" onClick={ delete_everything }>
                        <Trash2 size={ 18 } aria-hidden="true" />
                        Delete all local data
                    </DangerButton>
                </SettingGroup>
            </SettingsList>
        </Content>

        <BottomAppBar
            label="Settings navigation"
            center={ <IconButton icon={ ArrowLeft } label="Back to projects" onClick={ () => navigate( `/projects` ) } /> }
        />
    </AppFrame>
}
