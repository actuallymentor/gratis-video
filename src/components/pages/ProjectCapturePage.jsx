import { useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Link, useNavigate, useParams } from 'react-router'
import { StringParam, useQueryParam } from 'use-query-params'
import { log } from 'mentie/modules/logging.js'
import styled from 'styled-components'
import { ArrowLeft, Camera, List, RefreshCw, Settings as SettingsIcon, Share2, X } from 'lucide-react'
import { Content, AppFrame } from '../atoms/Layout.jsx'
import { IconButton } from '../atoms/IconButton.jsx'
import { SegmentedControl } from '../atoms/SegmentedControl.jsx'
import { ClipQueue } from '../molecules/ClipQueue.jsx'
import { ExportPanel } from '../molecules/ExportPanel.jsx'
import { PermissionNotice } from '../molecules/PermissionNotice.jsx'
import { RecordButton } from '../molecules/RecordButton.jsx'
import { useModalFocus } from '../../hooks/use_modal_focus.js'
import { useRecordingController } from '../../hooks/use_recording_controller.js'
import { create_export_hashes } from '../../modules/export/cache.js'
import { normalize_export_settings } from '../../modules/export/exporter.js'
import {
    DEFAULT_RECORDING_AUDIO_MODE,
    DEFAULT_RECORDING_VIDEO_PRESET,
    get_recording_audio_mode,
    get_recording_video_preset,
    recording_audio_modes,
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

const CaptureFrame = styled( AppFrame )`
    min-height: 100svh;
    padding: 0;
    overflow: hidden;
    background: #0d1718;
`

const CaptureShell = styled.section`
    position: relative;
    min-height: 100svh;
    overflow: hidden;
    background: #0d1718;
    color: #ffffff;
`

const Preview = styled.div`
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: #0d1718;
    color: rgba( 255, 255, 255, 0.78 );

    &::after {
        content: "";
        position: absolute;
        inset: 0;
        z-index: 1;
        pointer-events: none;
        background:
            linear-gradient( to bottom, rgba( 0, 0, 0, 0.42 ), rgba( 0, 0, 0, 0 ) 28% ),
            linear-gradient( to top, rgba( 0, 0, 0, 0.52 ), rgba( 0, 0, 0, 0 ) 38% );
    }

    video {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
        background: #000000;
    }
`

const TopChrome = styled.header`
    position: absolute;
    top: calc( 0.85rem + env( safe-area-inset-top ) );
    right: 1rem;
    left: 1rem;
    z-index: 4;
    display: grid;
    grid-template-columns: minmax( 3rem, 1fr ) minmax( 0, auto ) minmax( 3rem, 1fr );
    align-items: center;
    gap: 0.75rem;
`

const floating_icon_style = `
    border-color: rgba( 255, 255, 255, 0.28 );
    color: #ffffff;
    background: #000000;
    box-shadow: 0 0.7rem 1.4rem rgba( 0, 0, 0, 0.24 );

    &:hover,
    &:focus-visible {
        border-color: rgba( 126, 192, 208, 0.9 );
        background: #051012;
    }

    &:disabled {
        color: rgba( 255, 255, 255, 0.42 );
        background: rgba( 0, 0, 0, 0.66 );
    }
`

const BackLink = styled( Link )`
    ${ floating_icon_style }
    display: inline-grid;
    place-items: center;
    justify-self: start;
    width: 3rem;
    min-width: 3rem;
    height: 3rem;
    min-height: 3rem;
    border: 1px solid rgba( 255, 255, 255, 0.28 );
    border-radius: 999px;
    text-decoration: none;
    transition: transform 140ms ease, border-color 140ms ease, background 140ms ease;

    &:active {
        transform: scale( 0.96 );
    }
`

const ProjectTitle = styled.h1`
    justify-self: center;
    max-width: min( 52vw, 28rem );
    margin: 0;
    overflow: hidden;
    color: rgba( 255, 255, 255, 0.74 );
    font-family: var(--font-heading);
    font-size: 1rem;
    font-weight: 600;
    line-height: 1.2;
    text-align: center;
    text-overflow: ellipsis;
    text-shadow: 0 0.1rem 0.45rem rgba( 0, 0, 0, 0.44 );
    white-space: nowrap;
`

const TopActions = styled.div`
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
`

const FloatingIconButton = styled( IconButton )`
    ${ floating_icon_style }
`

const BottomControls = styled.div`
    position: absolute;
    right: 1rem;
    bottom: calc( 1.25rem + env( safe-area-inset-bottom ) );
    left: 1rem;
    z-index: 4;
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    grid-template-rows: auto auto;
    align-items: center;
    gap: 0.75rem;
    pointer-events: none;

    > * {
        pointer-events: auto;
    }
`

const RecordDock = styled.div`
    grid-column: 2;
    grid-row: 2;
    justify-self: center;
`

const RightControlDock = styled.div`
    grid-column: 3;
    grid-row: 2;
    justify-self: end;
    display: flex;
    align-items: center;
    gap: 0.5rem;
`

const ClipListButton = styled( FloatingIconButton )``

const CameraPickerDock = styled.div`
    grid-column: 1 / -1;
    grid-row: 1;
    justify-self: center;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.35rem;
    border: 1px solid rgba( 255, 255, 255, 0.22 );
    border-radius: 999px;
    background: #000000;
    box-shadow: 0 0.7rem 1.4rem rgba( 0, 0, 0, 0.24 );
`

const CameraChoiceButton = styled.button`
    display: inline-grid;
    grid-template-rows: auto auto;
    place-items: center;
    gap: 0.05rem;
    width: 3.2rem;
    min-width: 3.2rem;
    height: 3.2rem;
    min-height: 3.2rem;
    border: 1px solid ${ ( { $active } ) => $active ? `var(--color-accent)` : `rgba( 255, 255, 255, 0.26 )` };
    border-radius: 999px;
    color: ${ ( { $active } ) => $active ? `var(--color-accent)` : `#ffffff` };
    background: #000000;
    transition: transform 140ms ease, border-color 140ms ease, color 140ms ease;

    &:hover,
    &:focus-visible {
        border-color: rgba( 126, 192, 208, 0.9 );
        color: var(--color-accent);
    }

    &:active {
        transform: scale( 0.96 );
    }

    &:disabled {
        color: rgba( 255, 255, 255, 0.42 );
        border-color: rgba( 255, 255, 255, 0.16 );
        cursor: not-allowed;
    }

    span {
        font-size: 0.64rem;
        font-weight: 900;
        line-height: 1;
    }
`

const PreviewNotice = styled.div`
    position: absolute;
    right: 1rem;
    bottom: calc( ${ ( { $has_camera_picker } ) => $has_camera_picker ? `12rem` : `7.5rem` } + env( safe-area-inset-bottom ) );
    left: 1rem;
    z-index: 4;
    display: grid;
    justify-items: center;
    pointer-events: none;

    > * {
        width: min( 100%, 38rem );
        pointer-events: auto;
        box-shadow: 0 0.75rem 1.5rem rgba( 0, 0, 0, 0.22 );
    }
`

const ClipSheetBackdrop = styled.div`
    position: fixed;
    inset: 0;
    z-index: 36;
    display: grid;
    align-items: end;
    background: rgba( 13, 23, 24, 0.38 );
`

const ClipSheetPanel = styled.section`
    width: min( 100%, 44rem );
    max-height: min( 75svh, 42rem );
    margin: 0 auto;
    padding: 1rem 1rem calc( 1rem + env( safe-area-inset-bottom ) );
    overflow-y: auto;
    overscroll-behavior: contain;
    border: 1px solid var(--color-border);
    border-bottom: 0;
    border-radius: 0.75rem 0.75rem 0 0;
    background: var(--color-surface);
    box-shadow: 0 -1rem 2rem rgba( 13, 23, 24, 0.18 );
    transform: translateY( 0 );

    @media (prefers-reduced-motion: no-preference) {
        animation: slide-up 180ms ease-out both;
    }

    @keyframes slide-up {
        from { transform: translateY( 100% ); }
        to { transform: translateY( 0 ); }
    }
`

const ClipSheetHeader = styled.header`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1rem;

    h2 {
        margin: 0;
        color: var(--color-ink);
        font-family: var(--font-heading);
        font-size: 1.1rem;
        font-weight: 600;
        letter-spacing: 0;
    }
`

const ReadyState = styled.div`
    position: relative;
    z-index: 2;
    max-width: 28ch;
    padding: 1rem;
    border-color: rgba( 255, 255, 255, 0.28 );
    color: #ffffff;
    border: 1px solid rgba( 255, 255, 255, 0.18 );
    border-radius: 0.5rem;
    background: rgba( 13, 23, 24, 0.56 );
    backdrop-filter: blur( 8px );
    text-align: center;
    line-height: 1.45;
`

const BottomNotice = styled.div`
    position: fixed;
    right: 1rem;
    bottom: calc( ${ ( { $has_camera_picker } ) => $has_camera_picker ? `12rem` : `7.5rem` } + env( safe-area-inset-bottom ) );
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

const MediaSettingField = styled.label`
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

const get_camera_search_text = ( camera_device ) => {
    return [
        camera_device.label,
        camera_device.device_id,
        camera_device.group_id
    ].filter( Boolean ).join( ` ` ).toLowerCase()
}

const get_camera_short_label = ( camera_device, index ) => {
    const search_text = get_camera_search_text( camera_device )
    const [ , raw_zoom_label = null ] = search_text.match( /\b(\d+(?:[.,]\d+)?)\s*x\b/ ) ?? []
    const zoom_label = raw_zoom_label?.replace( `,`, `.` )

    if( zoom_label ) return `${ zoom_label }x`
    if( /\b(ultra\s*wide|ultrawide)\b/.test( search_text ) ) return `0.5x`
    if( /\b(telephoto|tele)\b/.test( search_text ) ) return `T`
    if( /\bmacro\b/.test( search_text ) ) return `M`
    if( /\b(back|rear|environment|main|wide|world)\b/.test( search_text ) ) return `1x`

    return `${ index + 1 }`
}

const is_front_facing_camera = ( camera_device ) => {
    return /\b(front|user|selfie|facetime)\b|front[-\s]?facing|facing\s+front/.test(
        get_camera_search_text( camera_device )
    )
}

const is_back_facing_camera = ( camera_device ) => {
    if( is_front_facing_camera( camera_device ) ) return false

    return /\b(back|rear|environment|world|main|wide|telephoto|macro)\b|back[-\s]?facing|facing\s+back/.test(
        get_camera_search_text( camera_device )
    )
}

const find_camera_device = ( camera_devices, video_device_id ) => {
    if( !video_device_id ) return null

    return camera_devices.find( ( { device_id } ) => device_id === video_device_id ) ?? null
}

const CameraPicker = ( {
    back_camera_devices,
    disabled,
    selected_video_device_id,
    on_select_camera
} ) => {
    if( back_camera_devices.length <= 1 ) return null

    return <CameraPickerDock role="group" aria-label="Back cameras">
        { back_camera_devices.map( ( camera_device, index ) => {
            const camera_label = get_camera_label( camera_device, index )
            const camera_short_label = get_camera_short_label( camera_device, index )
            const is_selected = camera_device.device_id === selected_video_device_id
            const select_camera = () => {
                if( is_selected ) return

                on_select_camera( camera_device.device_id )
            }

            return <CameraChoiceButton
                key={ camera_device.device_id }
                type="button"
                $active={ is_selected }
                aria-label={ `Switch to ${ camera_label }` }
                aria-pressed={ is_selected }
                title={ camera_label }
                disabled={ disabled }
                onClick={ select_camera }
            >
                <Camera size={ 20 } strokeWidth={ 2.2 } aria-hidden="true" />
                <span aria-hidden="true">{ camera_short_label }</span>
            </CameraChoiceButton>
        } ) }
    </CameraPickerDock>
}

const MediaSettingsModal = ( {
    camera_devices,
    disabled,
    recording_audio_mode,
    recording_video_preset,
    selected_video_device_id,
    on_close,
    on_select_camera,
    on_select_audio_mode,
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
            aria-labelledby="media-settings-title"
            tabIndex={ -1 }
        >
            <ModalHeader>
                <h2 id="media-settings-title">Media settings</h2>
                <IconButton icon={ X } label="Close media settings" onClick={ on_close } />
            </ModalHeader>
            <ModalBody>
                <MediaSettingField>
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
                </MediaSettingField>

                <MediaSettingField as="div">
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
                </MediaSettingField>

                <MediaSettingField as="div">
                    <span>Audio mode</span>
                    <SegmentedControl
                        label="Audio mode"
                        options={ recording_audio_modes }
                        value={ recording_audio_mode }
                        on_change={ on_select_audio_mode }
                        disabled={ disabled }
                    />
                </MediaSettingField>
            </ModalBody>
        </ModalPanel>
    </ModalBackdrop>
}

const ClipListSheet = ( {
    clips,
    on_close,
    on_delete,
    on_move
} ) => {
    const sheet_ref = useModalFocus( {
        active: true,
        on_close
    } )

    return <ClipSheetBackdrop
        onMouseDown={ ( event ) => {
            if( event.target === event.currentTarget ) on_close()
        } }
    >
        <ClipSheetPanel
            ref={ sheet_ref }
            role="dialog"
            aria-modal="true"
            aria-labelledby="clip-list-title"
            tabIndex={ -1 }
        >
            <ClipSheetHeader>
                <h2 id="clip-list-title">Clips</h2>
                <IconButton icon={ X } label="Close clip list" onClick={ on_close } />
            </ClipSheetHeader>
            <ClipQueue clips={ clips } on_delete={ on_delete } on_move={ on_move } />
        </ClipSheetPanel>
    </ClipSheetBackdrop>
}

/**
 * Shows recording controls, live preview, clip-list sheet, and export actions.
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
    const [ media_settings_open, set_media_settings_open ] = useState( false )
    const [ clip_queue_open, set_clip_queue_open ] = useState( false )
    const cached_export_blob_ref = useRef( null )
    const project_id_ref = useRef( project_id )
    const settings_ref = useRef( null )
    const previous_recording_video_preset_ref = useRef( null )
    const previous_back_video_device_id_ref = useRef( null )
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
    const camera_devices = recording.camera_devices ?? []

    const update_media_setting = useCallback( async ( patch ) => {
        const previous_settings = settings_ref.current

        if( !previous_settings ) return

        const next_settings = normalize_export_settings( {
            ...previous_settings,
            ...patch
        } )

        log.debug( `Media setting update requested`, patch )
        settings_ref.current = next_settings
        set_settings( next_settings )

        try {
            const saved_settings = await save_settings( patch )

            if( settings_ref.current === next_settings ) {
                const normalized_settings = normalize_export_settings( saved_settings )

                settings_ref.current = normalized_settings
                set_settings( normalized_settings )
            }
            log.info( `Media settings saved`, {
                changed_keys: Object.keys( patch )
            } )
        } catch ( error ) {
            log.error( `Media settings could not be saved`, error )
            toast.error( `Media setting could not be saved` )

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
        const selected_camera_device = find_camera_device(
            camera_devices,
            recording.selected_video_device_id
        )
        const fallback_back_camera_device = camera_devices.find( is_back_facing_camera )

        if( selected_camera_device && is_back_facing_camera( selected_camera_device ) ) {
            previous_back_video_device_id_ref.current = selected_camera_device.device_id
            return
        }

        if( !previous_back_video_device_id_ref.current && fallback_back_camera_device ) {
            previous_back_video_device_id_ref.current = fallback_back_camera_device.device_id
        }
    }, [
        camera_devices,
        recording.selected_video_device_id
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
                    // Web Share must start from this same tap, so only already-loaded
                    // export blobs are eligible for immediate native sharing.
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
    const back_camera_devices = camera_devices.filter( is_back_facing_camera )
    const has_back_camera_picker = back_camera_devices.length > 1
    const front_camera_device = camera_devices.find( is_front_facing_camera ) ?? null
    const selected_camera_device = find_camera_device(
        camera_devices,
        recording.selected_video_device_id
    )
    const selected_camera_is_front = Boolean(
        selected_camera_device && is_front_facing_camera( selected_camera_device )
    )
    const camera_switching_disabled = recording_in_progress || media_stream_state === `opening`
    const selected_front_has_no_back_camera = selected_camera_is_front && !back_camera_devices.length
    const facing_camera_switch_disabled = camera_switching_disabled
        || selected_front_has_no_back_camera
    const selected_recording_video_preset = get_recording_video_preset(
        settings.recording_video_preset ?? DEFAULT_RECORDING_VIDEO_PRESET
    ).value
    const selected_recording_audio_mode = get_recording_audio_mode(
        settings.recording_audio_mode ?? DEFAULT_RECORDING_AUDIO_MODE
    ).value
    const switch_facing_camera = () => {
        if( !front_camera_device || camera_switching_disabled ) return

        if( selected_camera_is_front ) {
            const previous_back_camera_device = camera_devices.find( ( camera_device ) => {
                return camera_device.device_id === previous_back_video_device_id_ref.current
                    && is_back_facing_camera( camera_device )
            } )
            const next_back_camera_device = previous_back_camera_device
                ?? back_camera_devices.at( 0 )

            if( next_back_camera_device ) recording.select_camera_device( next_back_camera_device.device_id )
            return
        }

        if( selected_camera_device && is_back_facing_camera( selected_camera_device ) ) {
            previous_back_video_device_id_ref.current = selected_camera_device.device_id
        } else if( !previous_back_video_device_id_ref.current && back_camera_devices.at( 0 ) ) {
            previous_back_video_device_id_ref.current = back_camera_devices.at( 0 ).device_id
        }

        recording.select_camera_device( front_camera_device.device_id )
    }

    return <CaptureFrame>
        <CaptureShell aria-label="Project capture">
            <Preview>
                { recording.stream ? <video ref={ preview_ref } aria-label="Live camera preview" muted playsInline autoPlay /> : <ReadyState>
                    { media_stream_state === `opening`
                        ? `Opening camera preview...`
                        : `Press record to open the camera and save the next clip.` }
                </ReadyState> }
            </Preview>

            <TopChrome>
                <BackLink to="/projects" aria-label="Back to projects" title="Back to projects">
                    <ArrowLeft size={ 20 } aria-hidden="true" />
                </BackLink>
                <ProjectTitle>{ project.title }</ProjectTitle>
                <TopActions>
                    <FloatingIconButton
                        icon={ Share2 }
                        label="Share or export project"
                        onClick={ share_or_export }
                        disabled={ export_disabled }
                    />
                    <FloatingIconButton
                        icon={ SettingsIcon }
                        label="Open media settings"
                        onClick={ () => set_media_settings_open( true ) }
                    />
                </TopActions>
            </TopChrome>

            { preview_status_message ? <PreviewNotice $has_camera_picker={ has_back_camera_picker }>
                <PermissionNotice
                    message={ preview_status_message }
                    action_to={ permission_recovery_needed ? settings_return_path : null }
                    action_label={ permission_recovery_needed ? `Open settings` : null }
                    urgent={ Boolean( storage_error ) || notice_urgent }
                />
            </PreviewNotice> : null }

            <BottomControls role="group" aria-label="Capture controls">
                <CameraPicker
                    back_camera_devices={ back_camera_devices }
                    disabled={ camera_switching_disabled }
                    selected_video_device_id={ recording.selected_video_device_id }
                    on_select_camera={ recording.select_camera_device }
                />
                <RecordDock>
                    <RecordButton
                        recording_state={ recording.recording_state }
                        elapsed_ms={ recording.elapsed_ms }
                        on_press={ recording.press_record }
                        on_release={ recording.release_record }
                        on_cancel={ recording.cancel_record }
                        on_toggle={ recording.toggle_recording }
                        disabled={ record_control_disabled }
                        bare
                    />
                </RecordDock>
                <RightControlDock>
                    <ClipListButton
                        icon={ List }
                        label="Open clip list"
                        onClick={ () => set_clip_queue_open( true ) }
                    />
                    { front_camera_device ? <FloatingIconButton
                        icon={ RefreshCw }
                        label={ selected_camera_is_front ? `Switch to back camera` : `Switch to front camera` }
                        onClick={ switch_facing_camera }
                        disabled={ facing_camera_switch_disabled }
                    /> : null }
                </RightControlDock>
            </BottomControls>
        </CaptureShell>

        { bottom_status_message ? <BottomNotice $has_camera_picker={ has_back_camera_picker }>
            <PermissionNotice
                message={ bottom_status_message }
                action_to={ permission_recovery_needed ? settings_return_path : null }
                action_label={ permission_recovery_needed ? `Open settings` : null }
                urgent={ notice_urgent }
            />
        </BottomNotice> : null }

        { clip_queue_open ? <ClipListSheet
            clips={ clips }
            on_close={ () => set_clip_queue_open( false ) }
            on_delete={ remove_clip }
            on_move={ move_existing_clip }
        /> : null }

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

        { media_settings_open ? <MediaSettingsModal
            camera_devices={ camera_devices }
            disabled={ recording_in_progress || media_stream_state === `opening` }
            recording_audio_mode={ selected_recording_audio_mode }
            recording_video_preset={ selected_recording_video_preset }
            selected_video_device_id={ recording.selected_video_device_id }
            on_close={ () => set_media_settings_open( false ) }
            on_select_camera={ recording.select_camera_device }
            on_select_audio_mode={ ( recording_audio_mode ) => {
                update_media_setting( { recording_audio_mode } )
            } }
            on_select_preset={ ( recording_video_preset ) => {
                update_media_setting( { recording_video_preset } )
            } }
        /> : null }
    </CaptureFrame>
}
