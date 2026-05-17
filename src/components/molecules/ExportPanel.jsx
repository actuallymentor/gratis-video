import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import styled from 'styled-components'
import { Download, Share2, X } from 'lucide-react'
import { IconButton } from '../atoms/IconButton.jsx'
import { create_export_hashes } from '../../modules/export/cache.js'
import { compile_project_export } from '../../modules/export/exporter.js'
import {
    get_export_blob,
    save_export_record
} from '../../modules/storage/journal_storage.js'
import {
    download_export_file,
    share_export_file
} from '../../modules/sharing/share.js'
import { useAppStore } from '../../stores/app_store.js'

const Backdrop = styled.div`
    position: fixed;
    inset: 0;
    z-index: 35;
    display: grid;
    align-items: end;
    background: rgba( 13, 23, 24, 0.34 );
`

const Panel = styled.section`
    width: min( 100%, 44rem );
    margin: 0 auto;
    padding: 1rem 1rem calc( 1rem + env( safe-area-inset-bottom ) );
    border: 1px solid var(--color-border);
    border-bottom: 0;
    border-radius: 0.75rem 0.75rem 0 0;
    background: var(--color-surface);
    box-shadow: var(--shadow-soft);
`

const Header = styled.header`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;

    h2 {
        margin: 0;
        color: var(--color-ink);
        font-family: var(--font-heading);
        font-size: 1.1rem;
    }
`

const ProgressTrack = styled.div`
    width: 100%;
    height: 0.75rem;
    margin: 1.25rem 0 0.5rem;
    overflow: hidden;
    border-radius: 999px;
    background: var(--color-surface-strong);
`

const ProgressFill = styled.div`
    width: ${ ( { $percent } ) => `${ $percent }%` };
    height: 100%;
    background: var(--color-accent);
    transition: width 160ms ease;
`

const Message = styled.p`
    margin: 0;
    color: ${ ( { $tone } ) => $tone === `error` ? `var(--color-danger)` : `var(--color-muted)` };
    line-height: 1.5;
`

const Actions = styled.div`
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.65rem;
    margin-top: 1rem;
`

const TextButton = styled.button`
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    min-height: 3rem;
    padding: 0.5rem 0.9rem;
    border: 1px solid ${ ( { $primary } ) => $primary ? `var(--color-accent-strong)` : `var(--color-border)` };
    border-radius: 0.5rem;
    color: var(--color-ink);
    background: ${ ( { $primary } ) => $primary ? `var(--color-accent)` : `var(--color-surface)` };
    font-weight: 900;
`

/**
 * Runs an explicit export flow and presents post-compile share/download actions.
 * @param {Object} props - Export flow props.
 * @returns {JSX.Element} Export panel.
 */
export function ExportPanel( { project, clips, settings, initial_export_record = null, on_close } ) {
    const [ status, set_status ] = useState( initial_export_record ? `ready` : `compiling` )
    const [ export_record, set_export_record ] = useState( initial_export_record )
    const [ error_message, set_error_message ] = useState( null )
    const abort_controller_ref = useRef( null )
    const export_progress = useAppStore( ( state ) => state.export_progress )
    const set_export_progress = useAppStore( ( state ) => state.set_export_progress )

    useEffect( () => {
        if( initial_export_record ) {
            set_export_progress( {
                active: false,
                percent: 100,
                message: `Export ready`
            } )
            return undefined
        }

        const abort_controller = new AbortController()
        let active_effect = true
        abort_controller_ref.current = abort_controller
        const is_current_export = () => active_effect && abort_controller_ref.current === abort_controller

        const run_export = async () => {
            set_export_progress( {
                active: true,
                percent: 0,
                message: `Preparing export`
            } )

            try {
                const { settings_hash, clip_manifest_hash } = create_export_hashes( { clips, settings } )
                const compiled_export = await compile_project_export( {
                    clips,
                    settings,
                    signal: abort_controller.signal,
                    on_progress: set_export_progress
                } )
                const saved_export = await save_export_record( {
                    project_id: project.id,
                    settings_hash,
                    clip_manifest_hash,
                    ...compiled_export
                } )

                if( !is_current_export() ) return

                set_export_record( saved_export )
                set_status( `ready` )
                set_export_progress( {
                    active: false,
                    percent: 100,
                    message: `Export ready`
                } )
                toast.success( `Export ready` )
            } catch ( error ) {
                if( !is_current_export() ) return

                if( error.name === `AbortError` ) {
                    set_status( `cancelled` )
                    set_error_message( `Export cancelled.` )
                    set_export_progress( {
                        active: false,
                        percent: 0,
                        message: `Export cancelled`
                    } )
                    return
                }

                set_status( `error` )
                set_error_message( error.message || `Export failed.` )
                set_export_progress( {
                    active: false,
                    percent: 0,
                    message: `Export failed`
                } )
                toast.error( `Export failed` )
            }
        }

        run_export()

        return () => {
            active_effect = false
            abort_controller.abort()
        }
    }, [ clips, initial_export_record, project.id, set_export_progress, settings ] )

    const cancel_export = () => {
        abort_controller_ref.current?.abort()
        set_export_progress( {
            active: false,
            percent: 0,
            message: `Export cancelled`
        } )
        on_close()
    }

    const close_export_panel = () => {
        if( status === `compiling` ) {
            cancel_export()
            return
        }

        on_close()
    }

    const share_ready_export = async () => {
        if( !export_record ) return

        const blob = await get_export_blob( export_record.id )
        if( !blob ) {
            toast.error( `Export file is unavailable` )
            return
        }

        try {
            const result = await share_export_file( { project, export_record, blob } )

            if( result !== `unsupported` ) return

            download_export_file( export_record, blob )
            toast( `Native sharing is unavailable here. Download started.` )
        } catch {
            download_export_file( export_record, blob )
            toast( `Sharing failed. Download started.` )
        }
    }

    const download_ready_export = async () => {
        if( !export_record ) return

        const blob = await get_export_blob( export_record.id )
        if( !blob ) {
            toast.error( `Export file is unavailable` )
            return
        }

        download_export_file( export_record, blob )
    }

    return <Backdrop>
        <Panel role="dialog" aria-modal="true" aria-labelledby="export-title">
            <Header>
                <h2 id="export-title">Export video</h2>
                <IconButton icon={ X } label="Close export panel" onClick={ close_export_panel } />
            </Header>

            { status === `compiling` ? <>
                <ProgressTrack aria-hidden="true">
                    <ProgressFill $percent={ export_progress.percent } />
                </ProgressTrack>
                <Message aria-live="polite">
                    { export_progress.percent }% complete. { export_progress.message }
                </Message>
            </> : null }

            { status === `ready` ? <Message aria-live="polite">
                Export is ready. Use Share from here so the browser has a fresh user action.
            </Message> : null }

            { status === `error` || status === `cancelled` ? <Message $tone="error" aria-live="polite">
                { error_message }
            </Message> : null }

            <Actions>
                { status === `compiling` ? <TextButton type="button" onClick={ cancel_export }>
                    Cancel
                </TextButton> : null }
                { status === `ready` ? <>
                    <TextButton type="button" onClick={ download_ready_export }>
                        <Download size={ 18 } aria-hidden="true" />
                        Download
                    </TextButton>
                    <TextButton type="button" $primary onClick={ share_ready_export }>
                        <Share2 size={ 18 } aria-hidden="true" />
                        Share
                    </TextButton>
                </> : null }
                { status === `error` || status === `cancelled` ? <TextButton type="button" onClick={ on_close }>
                    Close
                </TextButton> : null }
            </Actions>
        </Panel>
    </Backdrop>
}
