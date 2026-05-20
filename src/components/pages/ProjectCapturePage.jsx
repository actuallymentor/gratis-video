import { useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Link, useNavigate, useParams } from 'react-router'
import { StringParam, useQueryParam } from 'use-query-params'
import { log } from 'mentie/modules/logging.js'
import styled from 'styled-components'
import { ArrowLeft, Download, Home, Settings as SettingsIcon, Share2, X } from 'lucide-react'
import { BottomAppBar } from '../atoms/BottomAppBar.jsx'
import { Content, HeaderBar, HeaderText, AppFrame, SectionTitle } from '../atoms/Layout.jsx'
import { IconButton } from '../atoms/IconButton.jsx'
import { ClipQueue } from '../molecules/ClipQueue.jsx'
import { ExportPanel } from '../molecules/ExportPanel.jsx'
import { PermissionNotice } from '../molecules/PermissionNotice.jsx'
import { RecordButton } from '../molecules/RecordButton.jsx'
import { useModalFocus } from '../../hooks/use_modal_focus.js'
import { useRecordingController } from '../../hooks/use_recording_controller.js'
import { create_export_hashes } from '../../modules/export/cache.js'
import { normalize_export_settings } from '../../modules/export/exporter.js'
import {
    DEFAULT_RECORDING_VIDEO_PRESET,
    get_recording_video_preset,
    recording_video_presets
} from '../../modules/media/recorder.js'
import {
    can_attempt_recording,
    has_denied_media_permission,
    media_status_message
} from '../../modules/permissions/permissions.js'
import { share_export_file } from '../../modules/sharing/share.js'
import {
    delete_clip,
    get_active_project,
    get_export_blob,
    get_project,
    get_project_clips,
    get_valid_cached_export,
    is_valid_export_blob,
    load_settings,
    move_clip,
    save_settings,
    set_active_project
} from '../../modules/storage/journal_storage.js'
import { useAppStore } from '../../stores/app_store.js'

const CaptureGrid = styled.div`
    display: grid;
    gap: 1rem;

    @media (min-width: 58rem) {
        grid-template-columns: minmax( 0, 1.1fr ) minmax( 22rem, 0.9fr );
        align-items: start;
    }
`

const PreviewPanel = styled.section`
    display: grid;
    gap: 0.75rem;
`

const Preview = styled.div`
    position: relative;
    display: grid;
    place-items: center;
    min-height: 18rem;
    overflow: hidden;
    border-radius: 0.5rem;
    background: #0d1718;
    color: rgba( 255, 255, 255, 0.78 );

    video {
        display: block;
        width: 100%;
        height: auto;
        max-height: 66svh;
        object-fit: contain;
        background: #0d1718;
    }
`

const PreviewSettingsButton = styled( IconButton )`
    position: absolute;
    top: 0.75rem;
    right: 0.75rem;
    z-index: 3;
    border-color: rgba( 255, 255, 255, 0.28 );
    color: #ffffff;
    background: rgba( 13, 23, 24, 0.74 );
    box-shadow: 0 0.7rem 1.4rem rgba( 0, 0, 0, 0.24 );
    backdrop-filter: blur( 8px );

    &:hover,
    &:focus-visible {
        border-color: rgba( 126, 192, 208, 0.85 );
        background: rgba( 18, 49, 51, 0.84 );
    }
`

const ModalBackdrop = styled.div`
    position: fixed;
    inset: 0;
    z-index: 40;
    display: grid;
    place-items: center;
    padding: 1rem;
    background: rgba( 13, 23, 24, 0.46 );
`

const ModalPanel = styled.section`
    width: min( 100%, 34rem );
    max-height: min( 42rem, calc( 100svh - 2rem ) );
    overflow: auto;
    border: 1px solid var(--color-border);
    border-radius: 0.5rem;
    background: var(--color-surface);
    box-shadow: var(--shadow-strong);
`

const ModalHeader = styled.header`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 1rem;
    border-bottom: 1px solid var(--color-border);

    h2 {
        margin: 0;
        color: var(--color-ink);
        font-family: var(--font-heading);
        font-size: 1.2rem;
        letter-spacing: 0;
    }
`

const ModalBody = styled.div`
    display: grid;
    gap: 1rem;
    padding: 1rem;
`

const VideoSettingField = styled.label`
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    color: var(--color-ink);
    font-weight: 800;

    select {
        width: 100%;
        min-height: 2.75rem;
        border: 1px solid var(--color-border);
        border-radius: 0.5rem;
        padding: 0.55rem 0.75rem;
        background: var(--color-surface);
        color: var(--color-text);
        font: inherit;
    }
`

const PresetGrid = styled.div`
    display: grid;
    grid-template-columns: repeat( 2, minmax( 0, 1fr ) );
    gap: 0.5rem;

    @media (min-width: 32rem) {
        grid-template-columns: repeat( 4, minmax( 0, 1fr ) );
    }
`

const PresetButton = styled.button`
    display: grid;
    gap: 0.25rem;
    min-height: 4rem;
    padding: 0.55rem 0.45rem;
    border: 1px solid ${ ( { $active } ) => $active ? `var(--color-accent-strong)` : `var(--color-border)` };
    border-radius: 0.5rem;
    color: ${ ( { $active } ) => $active ? `#0d1718` : `var(--color-ink)` };
    background: ${ ( { $active } ) => $active ? `var(--color-accent)` : `var(--color-surface-strong)` };
    font-weight: 900;
    letter-spacing: 0;

    small {
        color: ${ ( { $active } ) => $active ? `rgba( 13, 23, 24, 0.72 )` : `var(--color-muted)` };
        font-size: 0.78rem;
        font-weight: 800;
    }

    &:disabled {
        color: var(--color-muted);
        background: var(--color-surface-strong);
    }
`

const ReadyState = styled.div`
    max-width: 28ch;
    padding: 1rem;
    text-align: center;
    line-height: 1.45;
`

const QueuePanel = styled.section`
    min-width: 0;
`

const BottomNotice = styled.div`
    position: fixed;
    right: 1rem;
    bottom: calc( 6.35rem + env( safe-area-inset-bottom ) );
    left: 1rem;
    z-index: 22;
    display: grid;
    justify-items: center;
    pointer-events: none;

    > * {
        width: min( 100%, 38rem );
        pointer-events: auto;
        box-shadow: var(--shadow-soft);
    }
`

const LinkButton = styled( Link )`
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    min-height: 3rem;
    color: var(--color-muted);
    font-weight: 800;
    text-decoration: none;
`

const make_export_cache_key = ( { settings_hash, clip_manifest_hash } ) => {
    return `${ settings_hash }:${ clip_manifest_hash }`
}

const make_settings_return_path = ( project_id ) => {
    return `/settings?return_to=${ encodeURIComponent( `/projects/${ project_id }` ) }`
}

const format_bitrate = ( bits_per_second ) => {
    return `${ Math.round( bits_per_second / 1_000_000 ) } Mbps`
}

const get_camera_label = ( camera_device, index ) => {
    return camera_device.label || `Camera ${ index + 1 }`
}

const VideoSettingsModal = ( {
    camera_devices,
    disabled,
    recording_video_preset,
    selected_video_device_id,
    on_close,
    on_select_camera,
    on_select_preset
} ) => {
    const modal_ref = useModalFocus( {
        active: true,
        on_close
    } )

    return <ModalBackdrop
        onMouseDown={ ( event ) => {
            if( event.target === event.currentTarget ) on_close()
        } }
    >
        <ModalPanel
            ref={ modal_ref }
            role="dialog"
            aria-modal="true"
            aria-labelledby="video-settings-title"
            tabIndex={ -1 }
        >
            <ModalHeader>
                <h2 id="video-settings-title">Video settings</h2>
                <IconButton icon={ X } label="Close video settings" onClick={ on_close } />
            </ModalHeader>
            <ModalBody>
                <VideoSettingField>
                    Camera
                    <select
                        aria-label="Camera"
                        value={ selected_video_device_id ?? `` }
                        onChange={ ( event ) => on_select_camera( event.target.value ) }
                        disabled={ disabled }
                    >
                        <option value="">Default camera</option>
                        { camera_devices.map( ( camera_device, index ) => <option
                            key={ camera_device.device_id }
                            value={ camera_device.device_id }
                        >
                            { get_camera_label( camera_device, index ) }
                        </option> ) }
                    </select>
                </VideoSettingField>

                <VideoSettingField as="div">
                    <span id="recording-preset-label">Recording preset</span>
                    <PresetGrid role="group" aria-labelledby="recording-preset-label">
                        { recording_video_presets.map( ( preset ) => <PresetButton
                            key={ preset.value }
                            type="button"
                            $active={ preset.value === recording_video_preset }
                            aria-pressed={ preset.value === recording_video_preset }
                            onClick={ () => on_select_preset( preset.value ) }
                            disabled={ disabled }
                        >
                            { preset.label }
                            <small>{ format_bitrate( preset.video_bits_per_second ) }</small>
                        </PresetButton> ) }
                    </PresetGrid>
                </VideoSettingField>
            </ModalBody>
        </ModalPanel>
    </ModalBackdrop>
}

/**
 * Shows recording controls, live preview, clip queue, and export actions.
 * @returns {JSX.Element} Capture page.
 */
export function ProjectCapturePage() {
    const { project_id } = useParams()
    const navigate = useNavigate()
    const preview_ref = useRef( null )
    const [ panel, set_panel ] = useQueryParam( `panel`, StringParam )
    const [ project, set_project ] = useState( null )
    const [ clips, set_clips ] = useState( [] )
    const [ settings, set_settings ] = useState( null )
    const [ storage_error, set_storage_error ] = useState( null )
    const [ cached_export_record, set_cached_export_record ] = useState( null )
    const [ cached_export_key, set_cached_export_key ] = useState( null )
    const [ cached_export_ready, set_cached_export_ready ] = useState( false )
    const [ export_panel_record, set_export_panel_record ] = useState( null )
    const [ export_requested, set_export_requested ] = useState( false )
    const [ queue_mutation_pending, set_queue_mutation_pending ] = useState( false )
    const [ video_settings_open, set_video_settings_open ] = useState( false )
    const cached_export_blob_ref = useRef( null )
    const project_id_ref = useRef( project_id )
    const settings_ref = useRef( null )
    const previous_recording_video_preset_ref = useRef( null )
    const permission_status = useAppStore( ( state ) => state.permission_status )
    const storage_estimate = useAppStore( ( state ) => state.storage_estimate )
    const media_stream_state = useAppStore( ( state ) => state.media_stream_state )
    const export_progress_active = useAppStore( ( state ) => state.export_progress.active )
    const set_active_project_id = useAppStore( ( state ) => state.set_active_project_id )

    project_id_ref.current = project_id

    useEffect( () => {
        settings_ref.current = settings
    }, [ settings ] )

    const redirect_missing_project = useCallback( async ( missing_project_id ) => {
        const active_project = await get_active_project().catch( () => null )

        if( project_id_ref.current !== missing_project_id ) return

        log.warn( `Project route was missing; redirecting`, {
            missing_project_id,
            active_project_id: active_project?.id ?? null
        } )
        set_active_project_id( active_project?.id ?? null )
        navigate( active_project ? `/projects/${ active_project.id }` : `/projects`, { replace: true } )
    }, [ navigate, set_active_project_id ] )

    const clear_cached_export = useCallback( () => {
        cached_export_blob_ref.current = null
        set_cached_export_record( null )
        set_cached_export_key( null )
        set_cached_export_ready( false )
    }, [] )

    const load_initial_export_blob = useCallback( async ( export_record ) => {
        if(
            cached_export_record?.id === export_record.id
            && cached_export_blob_ref.current
        ) {
            log.debug( `Using already loaded cached export blob`, {
                export_id: export_record.id
            } )
            return cached_export_blob_ref.current
        }

        log.debug( `Loading cached export blob`, {
            export_id: export_record.id
        } )
        return get_export_blob( export_record.id )
    }, [ cached_export_record ] )

    const promote_ready_export = useCallback( ( { export_record, blob } ) => {
        const hashes = create_export_hashes( { clips, settings } )

        cached_export_blob_ref.current = blob
        set_cached_export_record( export_record )
        set_cached_export_key( make_export_cache_key( hashes ) )
        set_cached_export_ready( true )
        log.info( `Export cached for current project`, {
            project_id: export_record.project_id,
            export_id: export_record.id,
            size: blob.size,
            mime_type: blob.type || export_record.mime_type
        } )
    }, [ clips, settings ] )

    const refresh_project = useCallback( async () => {
        const requested_project_id = project_id

        log.debug( `Project refresh started`, {
            project_id: requested_project_id
        } )

        try {
            const [ loaded_project, loaded_clips, loaded_settings ] = await Promise.all( [
                get_project( requested_project_id ),
                get_project_clips( requested_project_id ),
                load_settings()
            ] )

            if( project_id_ref.current !== requested_project_id ) return

            if( !loaded_project ) {
                await redirect_missing_project( requested_project_id )
                return
            }

            log.info( `Project loaded`, {
                project_id: loaded_project.id,
                clip_count: loaded_clips.length
            } )
            log.insane( `Project capture payload`, {
                project: loaded_project,
                clips: loaded_clips,
                settings: normalize_export_settings( loaded_settings )
            } )
            set_project( loaded_project )
            set_clips( loaded_clips )
            set_settings( normalize_export_settings( loaded_settings ) )
            set_storage_error( null )
        } catch ( error ) {
            log.error( `Project refresh failed`, error )
            set_storage_error( `Local browser storage is unavailable, so clips cannot be loaded or saved.` )
        }
    }, [ project_id, redirect_missing_project ] )

    const recording = useRecordingController( {
        project_id,
        settings: settings ?? { haptics_enabled: true },
        on_clip_saved: refresh_project
    } )
    const open_camera_preview = recording.open_preview
    const refresh_camera_preview = recording.refresh_preview

    const update_video_setting = useCallback( async ( patch ) => {
        const previous_settings = settings_ref.current

        if( !previous_settings ) return

        const next_settings = normalize_export_settings( {
            ...previous_settings,
            ...patch
        } )

        log.debug( `Video setting update requested`, patch )
        settings_ref.current = next_settings
        set_settings( next_settings )

        try {
            const saved_settings = await save_settings( next_settings )

            if( settings_ref.current === next_settings ) {
                const normalized_settings = normalize_export_settings( saved_settings )

                settings_ref.current = normalized_settings
                set_settings( normalized_settings )
            }
            log.info( `Video settings saved`, {
                changed_keys: Object.keys( patch )
            } )
        } catch ( error ) {
            log.error( `Video settings could not be saved`, error )
            toast.error( `Video setting could not be saved` )

            if( settings_ref.current === next_settings ) {
                settings_ref.current = previous_settings
                set_settings( previous_settings )
            }
        }
    }, [] )

    useEffect( () => {
        if( !project || !settings ) return
        if( permission_status.camera === `unknown` ) return
        if( !can_attempt_recording( permission_status ) ) return

        open_camera_preview( {
            force: permission_status.camera === `granted`
        } )
    }, [
        open_camera_preview,
        permission_status,
        project,
        settings
    ] )

    useEffect( () => {
        if( !settings ) return

        const recording_video_preset = settings.recording_video_preset ?? DEFAULT_RECORDING_VIDEO_PRESET
        const previous_recording_video_preset = previous_recording_video_preset_ref.current

        previous_recording_video_preset_ref.current = recording_video_preset

        if(
            previous_recording_video_preset
            && previous_recording_video_preset !== recording_video_preset
        ) {
            refresh_camera_preview()
        }
    }, [
        refresh_camera_preview,
        settings?.recording_video_preset
    ] )

    useEffect( () => {
        let cancelled = false
        const requested_project_id = project_id

        const activate_project = async () => {
            log.debug( `Project activation started`, {
                project_id: requested_project_id
            } )

            try {
                const loaded_project = await get_project( requested_project_id )

                if( cancelled || project_id_ref.current !== requested_project_id ) return

                if( !loaded_project ) {
                    await redirect_missing_project( requested_project_id )
                    return
                }

                await set_active_project( requested_project_id )
                if( cancelled || project_id_ref.current !== requested_project_id ) return

                set_active_project_id( requested_project_id )
                await refresh_project()
                log.info( `Project activated`, {
                    project_id: requested_project_id
                } )
            } catch ( error ) {
                if( cancelled || project_id_ref.current !== requested_project_id ) return
                log.error( `Project activation failed`, error )
                set_storage_error( `Local browser storage is unavailable, so this project cannot be opened.` )
            }
        }

        activate_project()

        return () => {
            cancelled = true
        }
    }, [ project_id, redirect_missing_project, refresh_project, set_active_project_id ] )

    useEffect( () => {
        if( !preview_ref.current ) return

        const preview_video = preview_ref.current
        preview_video.srcObject = recording.stream

        return () => {
            if( preview_video.srcObject === recording.stream ) preview_video.srcObject = null
        }
    }, [ recording.stream ] )

    useEffect( () => {
        if( panel === `export` && !export_requested && !export_progress_active ) set_panel( undefined )
    }, [ export_progress_active, export_requested, panel, set_panel ] )

    useEffect( () => {
        if( panel === `export` || export_progress_active ) return

        set_export_requested( false )
    }, [ export_progress_active, panel ] )

    useEffect( () => {
        if( !export_requested || !export_progress_active || panel === `export` ) return

        set_panel( `export`, `replaceIn` )
    }, [
        export_progress_active,
        export_requested,
        panel,
        set_panel
    ] )

    useEffect( () => {
        let cancelled = false

        clear_cached_export()

        if( !project || !settings || !clips.length ) return undefined

        const load_cached_export = async () => {
            const hashes = create_export_hashes( { clips, settings } )
            const cache_key = make_export_cache_key( hashes )

            log.debug( `Cached export lookup started`, {
                project_id,
                clip_count: clips.length,
                cache_key
            } )
            const cached_export = await get_valid_cached_export( {
                project_id,
                ...hashes
            } )

            if( cancelled ) return
            if( !cached_export ) {
                log.debug( `No reusable cached export found`, {
                    project_id,
                    cache_key
                } )
                return
            }

            set_cached_export_record( cached_export )
            set_cached_export_key( cache_key )

            const blob = await get_export_blob( cached_export.id )

            if( cancelled ) return
            if( !is_valid_export_blob( cached_export, blob ) ) {
                log.warn( `Cached export metadata had no valid blob`, {
                    project_id,
                    export_id: cached_export.id
                } )
                clear_cached_export()
                return
            }

            cached_export_blob_ref.current = blob
            set_cached_export_ready( true )
            log.info( `Cached export ready`, {
                project_id,
                export_id: cached_export.id,
                size: blob.size,
                mime_type: blob.type || cached_export.mime_type
            } )
        }

        load_cached_export().catch( ( error ) => {
            if( !cancelled ) {
                log.warn( `Cached export lookup failed`, error )
                clear_cached_export()
            }
        } )

        return () => {
            cancelled = true
        }
    }, [ clear_cached_export, clips, project, project_id, settings ] )

    const remove_clip = async ( clip ) => {
        const confirmed = window.confirm( `Delete this clip from the project?` )
        if( !confirmed ) {
            log.debug( `Clip deletion cancelled`, {
                clip_id: clip.id
            } )
            return
        }

        log.info( `Clip deletion requested`, {
            project_id,
            clip_id: clip.id
        } )
        set_queue_mutation_pending( true )
        clear_cached_export()

        try {
            await delete_clip( clip.id )
            await refresh_project()
            log.info( `Clip deleted`, {
                project_id,
                clip_id: clip.id
            } )
            toast( `Clip deleted` )
        } catch ( error ) {
            log.error( `Clip could not be deleted`, error )
            toast.error( `Clip could not be deleted` )
        } finally {
            set_queue_mutation_pending( false )
        }
    }

    const move_existing_clip = async ( clip, direction ) => {
        log.debug( `Clip move requested`, {
            project_id,
            clip_id: clip.id,
            direction
        } )
        set_queue_mutation_pending( true )
        clear_cached_export()

        try {
            await move_clip( clip.id, direction )
            await refresh_project()
            log.info( `Clip moved`, {
                project_id,
                clip_id: clip.id,
                direction
            } )
        } catch ( error ) {
            log.error( `Clip could not be moved`, error )
            toast.error( `Clip could not be moved` )
        } finally {
            set_queue_mutation_pending( false )
        }
    }

    const recording_busy = recording.recording_state !== `idle`
    const export_disabled = queue_mutation_pending || recording_busy
    const export_flow_open = export_requested && ( panel === `export` || export_progress_active )

    const share_or_export = async () => {
        log.info( `Share or export requested`, {
            project_id,
            clip_count: clips.length,
            recording_state: recording.recording_state,
            queue_mutation_pending
        } )

        if( recording_busy ) {
            const message = recording.recording_state === `saving`
                ? `Clip is still saving. Try again in a moment.`
                : `Finish recording before exporting.`

            log.debug( `Share or export blocked by recording state`, {
                recording_state: recording.recording_state
            } )
            toast( message )
            return
        }

        if( queue_mutation_pending ) {
            log.debug( `Share or export blocked by queue mutation` )
            toast( `Clip queue is updating. Try again in a moment.` )
            return
        }

        if( !clips.length ) {
            log.debug( `Share or export blocked because project has no clips` )
            toast( `Record at least one clip first.` )
            return
        }

        const hashes = create_export_hashes( { clips, settings } )
        const cache_key = make_export_cache_key( hashes )

        log.debug( `Share or export cache state`, {
            cache_key,
            cached_export_id: cached_export_record?.id ?? null,
            cached_export_ready,
            has_loaded_blob: Boolean( cached_export_blob_ref.current )
        } )

        if(
            cached_export_record
            && cached_export_ready
            && cached_export_blob_ref.current
            && cached_export_key === cache_key
        ) {
            if( !is_valid_export_blob( cached_export_record, cached_export_blob_ref.current ) ) {
                clear_cached_export()
            } else {
                try {
                    const share_result = await share_export_file( {
                        project,
                        export_record: cached_export_record,
                        blob: cached_export_blob_ref.current
                    } )

                    log.info( `Cached export share finished`, {
                        export_id: cached_export_record.id,
                        result: share_result
                    } )
                    if( share_result === `shared` || share_result === `cancelled` ) return
                } catch ( error ) {
                    log.warn( `Cached export sharing failed`, error )
                    toast( `Sharing failed. Download is available.` )
                }

                set_export_panel_record( cached_export_record )
                set_export_requested( true )
                set_panel( `export` )
                return
            }
        }

        if(
            cached_export_record
            && cached_export_ready
            && cached_export_key === cache_key
        ) {
            clear_cached_export()
        }

        if(
            cached_export_record
            && !cached_export_ready
            && cached_export_key === cache_key
        ) {
            try {
                const blob = await load_initial_export_blob( cached_export_record )
                if( !is_valid_export_blob( cached_export_record, blob ) ) {
                    log.warn( `Cached export became invalid before opening panel`, {
                        export_id: cached_export_record.id
                    } )
                    clear_cached_export()
                } else {
                    cached_export_blob_ref.current = blob
                    set_cached_export_ready( true )
                    log.info( `Cached export loaded before opening panel`, {
                        export_id: cached_export_record.id,
                        size: blob.size
                    } )
                    set_export_panel_record( cached_export_record )
                    set_export_requested( true )
                    set_panel( `export` )
                    return
                }
            } catch ( error ) {
                log.warn( `Cached export blob could not be loaded before opening panel`, error )
                clear_cached_export()
            }
        }

        const cached_export = await get_valid_cached_export( {
            project_id,
            ...hashes
        } ).catch( ( error ) => {
            log.warn( `Fresh cached export lookup failed`, error )
            return null
        } )

        if( !cached_export ) {
            clear_cached_export()
            set_export_panel_record( null )
            set_export_requested( true )
            log.info( `Opening export panel for fresh compilation`, {
                project_id,
                clip_count: clips.length
            } )
            set_panel( `export` )
            return
        }

        const cached_blob = await get_export_blob( cached_export.id ).catch( () => null )

        if( is_valid_export_blob( cached_export, cached_blob ) ) {
            cached_export_blob_ref.current = cached_blob
            set_cached_export_record( cached_export )
            set_cached_export_key( cache_key )
            set_cached_export_ready( true )

            set_export_panel_record( cached_export )
            set_export_requested( true )
            log.info( `Opening export panel with cached export`, {
                project_id,
                export_id: cached_export.id
            } )
            set_panel( `export` )
            return
        }

        log.warn( `Fresh cached export record had no valid blob`, {
            project_id,
            export_id: cached_export.id
        } )
        clear_cached_export()
        set_export_panel_record( null )
        set_export_requested( true )
        log.info( `Opening export panel after cache invalidation`, {
            project_id,
            clip_count: clips.length
        } )
        set_panel( `export` )
    }

    if( storage_error && ( !project || !settings ) ) {
        return <AppFrame>
            <Content>
                <PermissionNotice message={ storage_error } urgent />
            </Content>
        </AppFrame>
    }

    if( !project || !settings ) {
        return <AppFrame>
            <Content>Loading project...</Content>
        </AppFrame>
    }

    const storage_ratio = storage_estimate?.quota
        ? ( storage_estimate.usage ?? 0 ) / storage_estimate.quota
        : 0
    const storage_warning = storage_ratio >= 0.85
        ? `Local browser storage is almost full. Export or delete old clips before recording more.`
        : null
    const permission_status_message = media_status_message( permission_status )
    const camera_permission_denied = permission_status.camera === `denied`
    const microphone_permission_denied = permission_status.microphone === `denied`
    const permission_denied = has_denied_media_permission( permission_status )
    const permission_recovery_needed = permission_denied || recording.permission_recovery_needed
    const settings_return_path = make_settings_return_path( project.id )
    const should_prioritize_permission_status = camera_permission_denied
        ? true
        : microphone_permission_denied && !recording.error_message
    const status_message = should_prioritize_permission_status
        ? permission_status_message || recording.error_message || storage_warning
        : recording.error_message || permission_status_message || storage_warning
    const recording_disabled = !can_attempt_recording( permission_status )
    const recording_in_progress = recording.recording_state === `starting` || recording.recording_state === `recording`
    const record_control_disabled = recording_disabled && !recording_in_progress
    const status_message_is_video_only = /video[- ]only/i.test( status_message ?? `` )
    const notice_urgent = Boolean( status_message )
        && !status_message_is_video_only
        && Boolean( recording_disabled || recording.error_message || storage_error )
    const bottom_status_message = status_message && ( recording.error_message || permission_denied || recording_disabled )
        ? status_message
        : null
    const preview_status_message = storage_error || ( bottom_status_message ? null : status_message )
    const camera_devices = recording.camera_devices ?? []
    const selected_recording_video_preset = get_recording_video_preset(
        settings.recording_video_preset ?? DEFAULT_RECORDING_VIDEO_PRESET
    ).value

    return <AppFrame>
        <Content>
            <HeaderBar>
                <HeaderText>
                    <LinkButton to="/projects">
                        <ArrowLeft size={ 18 } aria-hidden="true" />
                        Projects
                    </LinkButton>
                    <h1>{ project.title }</h1>
                </HeaderText>
                <IconButton
                    icon={ Share2 }
                    label="Share or export project"
                    onClick={ share_or_export }
                    disabled={ export_disabled }
                />
            </HeaderBar>

            <CaptureGrid>
                <PreviewPanel>
                    <Preview>
                        { recording.stream ? <video ref={ preview_ref } aria-label="Live camera preview" muted playsInline autoPlay /> : <ReadyState>
                            { media_stream_state === `opening`
                                ? `Opening camera preview...`
                                : `Press record to open the camera and save the next clip.` }
                        </ReadyState> }
                        <PreviewSettingsButton
                            icon={ SettingsIcon }
                            label="Open video settings"
                            onClick={ () => set_video_settings_open( true ) }
                        />
                    </Preview>
                    <PermissionNotice
                        message={ preview_status_message }
                        action_to={ permission_recovery_needed ? settings_return_path : null }
                        action_label={ permission_recovery_needed ? `Open settings` : null }
                        urgent={ Boolean( storage_error ) || notice_urgent }
                    />
                </PreviewPanel>

                <QueuePanel>
                    <SectionTitle>Clip queue</SectionTitle>
                    <ClipQueue clips={ clips } on_delete={ remove_clip } on_move={ move_existing_clip } />
                </QueuePanel>
            </CaptureGrid>
        </Content>

        <BottomAppBar
            label="Capture actions"
            left={ <IconButton icon={ Home } label="Open projects" onClick={ () => navigate( `/projects` ) } /> }
            center={ <RecordButton
                recording_state={ recording.recording_state }
                elapsed_ms={ recording.elapsed_ms }
                on_press={ recording.press_record }
                on_release={ recording.release_record }
                on_cancel={ recording.cancel_record }
                on_toggle={ recording.toggle_recording }
                disabled={ record_control_disabled }
            /> }
            right={ <IconButton
                icon={ Download }
                label="Share or export project"
                onClick={ share_or_export }
                disabled={ export_disabled }
            /> }
        />

        { bottom_status_message ? <BottomNotice>
            <PermissionNotice
                message={ bottom_status_message }
                action_to={ permission_recovery_needed ? settings_return_path : null }
                action_label={ permission_recovery_needed ? `Open settings` : null }
                urgent={ notice_urgent }
            />
        </BottomNotice> : null }

        { export_flow_open ? <ExportPanel
            project={ project }
            clips={ clips }
            settings={ settings }
            initial_export_record={ export_panel_record }
            load_initial_export_blob={ load_initial_export_blob }
            on_export_ready={ promote_ready_export }
            on_close={ () => {
                log.debug( `Export panel closed`, {
                    project_id
                } )
                set_export_panel_record( null )
                set_export_requested( false )
                set_panel( undefined )
            } }
        /> : null }

        { video_settings_open ? <VideoSettingsModal
            camera_devices={ camera_devices }
            disabled={ recording_in_progress || media_stream_state === `opening` }
            recording_video_preset={ selected_recording_video_preset }
            selected_video_device_id={ recording.selected_video_device_id }
            on_close={ () => set_video_settings_open( false ) }
            on_select_camera={ recording.select_camera_device }
            on_select_preset={ ( recording_video_preset ) => {
                update_video_setting( { recording_video_preset } )
            } }
        /> : null }
    </AppFrame>
}
