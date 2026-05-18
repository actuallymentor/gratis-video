import { useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { log } from 'mentie/modules/logging.js'
import styled from 'styled-components'
import { Download, Share2, X } from 'lucide-react'
import { IconButton } from '../atoms/IconButton.jsx'
import { useModalFocus } from '../../hooks/use_modal_focus.js'
import { create_export_hashes } from '../../modules/export/cache.js'
import {
    compile_project_export,
    normalize_export_settings
} from '../../modules/export/exporter.js'
import {
    delete_export,
    get_export_blob,
    get_project_clips,
    is_valid_export_blob,
    load_settings,
    make_export_filename,
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
    max-height: calc( 100svh - 1rem );
    margin: 0 auto;
    padding: 1rem 1rem calc( 1rem + env( safe-area-inset-bottom ) );
    overflow-y: auto;
    overscroll-behavior: contain;
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
    color: ${ ( { $tone } ) => {
        if( $tone === `error` ) return `var(--color-danger)`
        if( $tone === `warning` ) return `var(--color-warning)`
        return `var(--color-muted)`
    } };
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

const get_initial_export_status = ( { initial_export_record } ) => {
    if( !initial_export_record ) return `compiling`
    return `loading`
}

const is_storage_quota_error = ( error ) => {
    return error?.name === `QuotaExceededError`
        || error?.name === `NS_ERROR_DOM_QUOTA_REACHED`
        || error?.code === 22
        || error?.code === 1014
}

const is_missing_project_error = ( error ) => error?.message === `Project not found.`
const is_project_changed_error = ( error ) => error?.message?.startsWith( `Project changed` )

const make_transient_export_record = ( { project, compiled_export, settings_hash, clip_manifest_hash } ) => ( {
    id: `unsaved-${ Date.now() }`,
    project_id: project.id,
    filename: make_export_filename( project.title, compiled_export.mime_type ),
    mime_type: compiled_export.mime_type,
    settings_hash,
    clip_manifest_hash,
    duration_ms: compiled_export.duration_ms,
    created_at: new Date().toISOString(),
    transient: true
} )

/**
 * Runs an explicit export flow and presents post-compile share/download actions.
 * @param {Object} props - Export flow props.
 * @returns {JSX.Element} Export panel.
 */
export function ExportPanel( {
    project,
    clips,
    settings,
    initial_export_record = null,
    load_initial_export_blob = null,
    on_export_ready = null,
    on_close
} ) {
    const initial_status = get_initial_export_status( {
        initial_export_record
    } )
    const [ status, set_status ] = useState( initial_status )
    const [ export_record, set_export_record ] = useState( initial_export_record )
    const [ error_message, set_error_message ] = useState( null )
    const [ ready_warnings, set_ready_warnings ] = useState( [] )
    const export_blob_ref = useRef( null )
    const abort_controller_ref = useRef( null )
    const export_input_ref = useRef( {
        clips,
        project,
        settings
    } )
    const load_initial_export_blob_ref = useRef( load_initial_export_blob )
    const on_export_ready_ref = useRef( on_export_ready )
    const export_progress = useAppStore( ( state ) => state.export_progress )
    const set_export_progress = useAppStore( ( state ) => state.set_export_progress )

    const update_active_export_progress = useCallback( ( progress ) => {
        log.insane( `Export progress update`, progress )
        set_export_progress( {
            active: true,
            percent: progress.percent ?? 0,
            message: progress.message ?? `Exporting`
        } )
    }, [ set_export_progress ] )

    const cancel_export = useCallback( () => {
        log.info( `Export cancelled by user`, {
            project_id: project.id
        } )
        abort_controller_ref.current?.abort()
        set_export_progress( {
            active: false,
            percent: 0,
            message: `Export cancelled`
        } )
        on_close()
    }, [ on_close, project.id, set_export_progress ] )

    const close_export_panel = useCallback( () => {
        if( status === `compiling` ) return

        on_close()
    }, [ on_close, status ] )

    const panel_ref = useModalFocus( {
        active: true,
        on_close: close_export_panel
    } )

    useEffect( () => {
        load_initial_export_blob_ref.current = load_initial_export_blob
        on_export_ready_ref.current = on_export_ready
    }, [ load_initial_export_blob, on_export_ready ] )

    useEffect( () => {
        const abort_controller = new AbortController()
        let active_effect = true
        let finished_export_effect = false
        let started_compile_work = false
        const is_current_export = () => active_effect && abort_controller_ref.current === abort_controller
        const {
            clips: export_clips,
            project: export_project,
            settings: export_settings
        } = export_input_ref.current

        const run_export = async () => {
            started_compile_work = true
            abort_controller_ref.current = abort_controller
            export_blob_ref.current = null
            set_export_record( null )
            set_ready_warnings( [] )
            set_error_message( null )
            set_status( `compiling` )
            set_export_progress( {
                active: true,
                percent: 0,
                message: `Preparing export`
            } )

            try {
                log.info( `Export panel compile started`, {
                    project_id: export_project.id,
                    clip_count: export_clips.length
                } )
                const { settings_hash, clip_manifest_hash } = create_export_hashes( {
                    clips: export_clips,
                    settings: export_settings
                } )
                log.debug( `Export cache hashes created`, {
                    project_id: export_project.id,
                    settings_hash,
                    clip_manifest_hash
                } )
                const compiled_export = await compile_project_export( {
                    clips: export_clips,
                    settings: export_settings,
                    signal: abort_controller.signal,
                    on_progress: update_active_export_progress
                } )

                if( !is_current_export() || abort_controller.signal.aborted ) return

                const [ current_clips, current_settings ] = await Promise.all( [
                    get_project_clips( export_project.id ),
                    load_settings()
                ] )
                const current_hashes = create_export_hashes( {
                    clips: current_clips,
                    settings: normalize_export_settings( current_settings )
                } )

                if(
                    current_hashes.settings_hash !== settings_hash
                    || current_hashes.clip_manifest_hash !== clip_manifest_hash
                ) {
                    log.warn( `Project changed while export was compiling`, {
                        project_id: export_project.id,
                        expected_settings_hash: settings_hash,
                        actual_settings_hash: current_hashes.settings_hash,
                        expected_clip_manifest_hash: clip_manifest_hash,
                        actual_clip_manifest_hash: current_hashes.clip_manifest_hash
                    } )
                    throw new Error( `Project changed while the export was compiling. Start the export again.` )
                }

                let saved_export = null
                let next_export_record = null
                let cache_warning = null

                try {
                    saved_export = await save_export_record( {
                        project_id: export_project.id,
                        settings_hash,
                        clip_manifest_hash,
                        ...compiled_export
                    } )
                    next_export_record = saved_export
                    log.info( `Compiled export cached`, {
                        project_id: export_project.id,
                        export_id: saved_export.id,
                        size: compiled_export.blob.size,
                        mime_type: compiled_export.mime_type
                    } )
                } catch ( error ) {
                    if( is_missing_project_error( error ) || is_project_changed_error( error ) ) throw error

                    log.warn( `Compiled export could not be cached`, error )
                    cache_warning = is_storage_quota_error( error )
                        ? `Export is ready, but local browser storage is full. Share or download it now before closing.`
                        : `Export is ready, but it could not be cached in local browser storage. Share or download it now before closing.`
                    next_export_record = make_transient_export_record( {
                        project: export_project,
                        compiled_export,
                        settings_hash,
                        clip_manifest_hash
                    } )
                }

                if( !is_current_export() || abort_controller.signal.aborted ) {
                    if( saved_export ) await delete_export( saved_export.id ).catch( () => null )
                    return
                }

                const compiled_warnings = compiled_export.warnings ?? []

                set_export_record( next_export_record )
                export_blob_ref.current = compiled_export.blob
                set_ready_warnings( [
                    ...compiled_warnings,
                    cache_warning
                ].filter( Boolean ) )
                set_status( `ready` )
                if( saved_export ) {
                    on_export_ready_ref.current?.( {
                        export_record: saved_export,
                        blob: compiled_export.blob
                    } )
                }
                finished_export_effect = true
                set_export_progress( {
                    active: false,
                    percent: 100,
                    message: `Export ready`
                } )
                log.info( `Export panel ready`, {
                    project_id: export_project.id,
                    export_id: next_export_record.id,
                    cached: Boolean( saved_export ),
                    warning_count: [
                        ...compiled_warnings,
                        cache_warning
                    ].filter( Boolean ).length
                } )
                toast.success( saved_export ? `Export ready` : `Export ready, but not cached` )
            } catch ( error ) {
                if( !is_current_export() ) return

                if( error.name === `AbortError` ) {
                    finished_export_effect = true
                    set_status( `cancelled` )
                    set_error_message( `Export cancelled.` )
                    set_export_progress( {
                        active: false,
                        percent: 0,
                        message: `Export cancelled`
                    } )
                    log.info( `Export compile aborted`, {
                        project_id: export_project.id
                    } )
                    return
                }

                finished_export_effect = true
                set_status( `error` )
                set_error_message( error.message || `Export failed.` )
                set_export_progress( {
                    active: false,
                    percent: 0,
                    message: `Export failed`
                } )
                log.error( `Export panel failed`, error )
                toast.error( `Export failed` )
            }
        }

        const replace_stale_cached_export = async ( error ) => {
            if( !active_effect ) return

            log.warn( `Cached export was unavailable; compiling a fresh export`, error )
            await delete_export( initial_export_record.id ).catch( ( delete_error ) => {
                log.warn( `Stale cached export could not be deleted`, delete_error )
            } )

            if( !active_effect ) return

            await run_export()
        }

        const load_ready_blob = async () => {
            set_export_progress( {
                active: false,
                percent: 0,
                message: `Loading export`
            } )
            set_status( `loading` )
            set_error_message( null )
            set_ready_warnings( [] )
            set_export_record( initial_export_record )
            export_blob_ref.current = null
            log.debug( `Loading ready export blob`, {
                project_id: project.id,
                export_id: initial_export_record.id
            } )

            const blob = load_initial_export_blob_ref.current
                ? await load_initial_export_blob_ref.current( initial_export_record )
                : await get_export_blob( initial_export_record.id )

            if( !active_effect ) return

            if( !is_valid_export_blob( initial_export_record, blob ) ) {
                await replace_stale_cached_export( new Error( `Cached export blob is missing.` ) )
                return
            }

            export_blob_ref.current = blob
            set_status( `ready` )
            finished_export_effect = true
            set_export_progress( {
                active: false,
                percent: 100,
                message: `Export ready`
            } )
            log.info( `Ready export blob loaded`, {
                project_id: project.id,
                export_id: initial_export_record.id,
                size: blob.size
            } )
        }

        if( initial_export_record ) load_ready_blob().catch( replace_stale_cached_export )
        else run_export()

        return () => {
            active_effect = false
            const should_report_cancel = started_compile_work
                && !finished_export_effect
                && abort_controller_ref.current === abort_controller

            abort_controller.abort()

            queueMicrotask( () => {
                if( !should_report_cancel || abort_controller_ref.current !== abort_controller ) return

                set_export_progress( {
                    active: false,
                    percent: 0,
                    message: `Export cancelled`
                } )
            } )
        }
    }, [
        initial_export_record,
        set_export_progress,
        update_active_export_progress
    ] )

    const share_ready_export = async () => {
        const export_blob = export_blob_ref.current

        if( !export_record || !export_blob ) return

        try {
            log.info( `Ready export share requested`, {
                project_id: project.id,
                export_id: export_record.id
            } )
            const result = await share_export_file( { project, export_record, blob: export_blob } )

            if( result !== `unsupported` ) {
                log.info( `Ready export share finished`, {
                    project_id: project.id,
                    export_id: export_record.id,
                    result
                } )
                return
            }

            download_export_file( export_record, export_blob )
            toast( `Native sharing is unavailable here. Download started.` )
        } catch ( error ) {
            log.warn( `Ready export share failed; falling back to download`, error )
            download_export_file( export_record, export_blob )
            toast( `Sharing failed. Download started.` )
        }
    }

    const download_ready_export = () => {
        const export_blob = export_blob_ref.current

        if( !export_record || !export_blob ) return

        log.info( `Ready export download requested`, {
            project_id: project.id,
            export_id: export_record.id
        } )
        download_export_file( export_record, export_blob )
    }

    return <Backdrop>
        <Panel ref={ panel_ref } role="dialog" aria-modal="true" aria-labelledby="export-title" tabIndex={ -1 }>
            <Header>
                <h2 id="export-title">Export video</h2>
                { status === `compiling`
                    ? null
                    : <IconButton icon={ X } label="Close export panel" onClick={ close_export_panel } /> }
            </Header>

            { status === `compiling` ? <>
                <ProgressTrack
                    role="progressbar"
                    aria-label="Export progress"
                    aria-valuemin={ 0 }
                    aria-valuemax={ 100 }
                    aria-valuenow={ export_progress.percent }
                >
                    <ProgressFill $percent={ export_progress.percent } />
                </ProgressTrack>
                <Message aria-live="polite">
                    { export_progress.percent }% complete. { export_progress.message }
                </Message>
            </> : null }

            { status === `loading` ? <Message aria-live="polite">
                Preparing export actions...
            </Message> : null }

            { status === `ready` ? <Message aria-live="polite">
                Export is ready. Use Share from here so the browser has a fresh user action.
            </Message> : null }

            { status === `ready` ? ready_warnings.map( ( warning ) => <Message key={ warning } $tone="warning" role="status">
                { warning }
            </Message> ) : null }

            { status === `error` || status === `cancelled` ? <Message $tone="error" aria-live="polite">
                { error_message }
            </Message> : null }

            <Actions>
                { status === `compiling` ? <TextButton type="button" onClick={ cancel_export }>
                    Cancel export
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
