import { useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { log } from 'mentie/modules/logging.js'
import { useAppStore } from '../stores/app_store.js'
import { listen_for_app_return_event } from '../modules/lifecycle/app_lifecycle.js'
import {
    get_stream_media_access,
    is_media_permission_denial
} from '../modules/permissions/runtime_state.js'
import {
    can_attempt_recording,
    check_media_permissions
} from '../modules/permissions/permissions.js'
import {
    add_clip_to_project,
    estimate_storage,
    persisted_storage,
    save_settings,
    update_clip_media_details
} from '../modules/storage/journal_storage.js'
import {
    DEFAULT_RECORDING_AUDIO_MODE,
    DEFAULT_RECORDING_VIDEO_PRESET,
    HOLD_THRESHOLD_MS,
    MINIMUM_CLIP_MS,
    classify_recording_gesture,
    create_media_recorder,
    generate_video_thumbnail,
    get_capture_error_message,
    get_recording_video_preset,
    get_video_metadata,
    list_video_input_devices,
    play_sound_feedback,
    pulse_haptic,
    request_audio_stream,
    request_capture_stream,
    select_supported_mime_type,
    stop_media_stream
} from '../modules/media/recorder.js'

const empty_recording_result = {
    chunks: [],
    mime_type: null,
    started_at: 0
}

const is_storage_quota_error = ( error ) => {
    return error?.name === `QuotaExceededError`
        || error?.name === `NS_ERROR_DOM_QUOTA_REACHED`
        || error?.code === 22
        || error?.code === 1014
}

const media_recorder_unavailable_message = `This browser cannot record video with MediaRecorder.`
const RECORDER_STOP_TIMEOUT_MS = 3_000
const stale_camera_error_names = new Set( [
    `AbortError`,
    `NotFoundError`,
    `NotReadableError`,
    `OverconstrainedError`
] )

const normalize_video_device_id = ( video_device_id ) => {
    return typeof video_device_id === `string` && video_device_id ? video_device_id : null
}

const get_stream_video_device_id = ( stream ) => {
    const [ video_track = null ] = stream?.getVideoTracks?.() ?? []
    const { deviceId = null } = video_track?.getSettings?.() ?? {}

    return normalize_video_device_id( deviceId )
}

const combine_recording_stream = ( video_stream, audio_stream = null ) => {
    const video_tracks = video_stream?.getVideoTracks?.() ?? []
    const audio_tracks = audio_stream?.getAudioTracks?.() ?? []
    const tracks = [
        ...video_tracks,
        ...audio_tracks
    ]

    if( !audio_tracks.length ) return video_stream
    if( globalThis.MediaStream ) return new MediaStream( tracks )

    return {
        getTracks: () => tracks,
        getVideoTracks: () => video_tracks,
        getAudioTracks: () => audio_tracks
    }
}

const can_retry_without_camera_choice = ( error ) => stale_camera_error_names.has( error?.name )

const can_resume_previously_open_preview = ( permission_status ) => {
    if( permission_status.secure_context === false ) return false
    if( permission_status.media_devices === `unsupported` ) return false
    if( permission_status.media_recorder === `unsupported` ) return false

    return true
}

const has_live_video_track = ( stream ) => {
    return ( stream?.getVideoTracks?.() ?? [] ).some( ( track ) => {
        return track.readyState !== `ended` && !track.muted
    } )
}

const clear_recorder_handlers = ( recorder ) => {
    if( !recorder ) return

    recorder.ondataavailable = null
    recorder.onerror = null
    recorder.onstop = null
}

/**
 * Coordinates pointer/keyboard recording, clip validation, and local persistence.
 * @param {Object} options - Recording options.
 * @param {string} options.project_id - Current project id.
 * @param {Object} options.settings - Global settings.
 * @param {Function} options.on_clip_saved - Callback after clip save.
 * @returns {Object} Recording controller state and handlers.
 */
export function useRecordingController( { project_id, settings, on_clip_saved } ) {
    const saved_video_device_id = normalize_video_device_id( settings?.last_video_device_id )
    const [ stream, set_stream ] = useState( null )
    const [ error_message, set_error_message ] = useState( null )
    const [ permission_recovery_needed, set_permission_recovery_needed ] = useState( false )
    const [ recording_started_at, set_recording_started_at ] = useState( null )
    const [ recording_mode, set_recording_mode ] = useState( null )
    const [ timer_tick, set_timer_tick ] = useState( 0 )
    const [ camera_devices, set_camera_devices ] = useState( [] )
    const [ selected_video_device_id, set_selected_video_device_id ] = useState( saved_video_device_id )

    const set_recording_state = useAppStore( ( state ) => state.set_recording_state )
    const recording_state = useAppStore( ( state ) => state.recording_state )
    const permission_status = useAppStore( ( state ) => state.permission_status )
    const set_media_stream_state = useAppStore( ( state ) => state.set_media_stream_state )
    const begin_permission_refresh = useAppStore( ( state ) => state.begin_permission_refresh )
    const apply_passive_permission_status = useAppStore( ( state ) => state.apply_passive_permission_status )
    const set_live_media_access = useAppStore( ( state ) => state.set_live_media_access )
    const mark_media_permission_denied = useAppStore( ( state ) => state.mark_media_permission_denied )
    const set_storage_estimate = useAppStore( ( state ) => state.set_storage_estimate )
    const set_storage_persisted = useAppStore( ( state ) => state.set_storage_persisted )

    const permission_status_ref = useRef( permission_status )
    const mounted_ref = useRef( true )
    const recorder_ref = useRef( null )
    const stream_ref = useRef( null )
    const stop_promise_ref = useRef( null )
    const recording_result_ref = useRef( empty_recording_result )
    const phase_ref = useRef( `idle` )
    const pointer_started_at_ref = useRef( 0 )
    const pending_forced_stop_ref = useRef( false )
    const pending_release_duration_ref = useRef( null )
    const stopping_ref = useRef( null )
    const recording_mode_ref = useRef( null )
    const preview_attempted_ref = useRef( false )
    const preview_open_promise_ref = useRef( null )
    const open_preview_ref = useRef( null )
    const preview_resume_requested_ref = useRef( false )
    const preview_resume_after_idle_ref = useRef( false )
    const preview_track_cleanup_ref = useRef( null )
    const selected_video_device_id_ref = useRef( saved_video_device_id )
    const persisted_video_device_id_ref = useRef( saved_video_device_id )

    permission_status_ref.current = permission_status

    const set_phase = useCallback( ( phase ) => {
        log.debug( `Recording phase changed`, {
            project_id,
            phase
        } )
        phase_ref.current = phase
        set_recording_state( phase )
    }, [ project_id, set_recording_state ] )

    const clear_current_stream = useCallback( () => {
        preview_track_cleanup_ref.current?.()
        preview_track_cleanup_ref.current = null
        stop_media_stream( stream_ref.current )
        stream_ref.current = null
        if( mounted_ref.current ) set_stream( null )
        set_live_media_access( {
            camera: false,
            microphone: false
        } )
        set_media_stream_state( `idle` )
    }, [
        set_live_media_access,
        set_media_stream_state
    ] )

    const remember_video_device_id = useCallback( ( video_device_id ) => {
        const next_video_device_id = normalize_video_device_id( video_device_id )

        if( persisted_video_device_id_ref.current === next_video_device_id ) return

        persisted_video_device_id_ref.current = next_video_device_id
        save_settings( {
            last_video_device_id: next_video_device_id
        } ).catch( ( error ) => {
            log.warn( `Could not save camera choice`, error )
        } )
    }, [] )

    const forget_video_device_id = useCallback( () => {
        selected_video_device_id_ref.current = null
        if( mounted_ref.current ) set_selected_video_device_id( null )
        remember_video_device_id( null )
    }, [ remember_video_device_id ] )

    const request_capture_with_camera_fallback = useCallback( async ( capture_request ) => {
        try {
            return await request_capture_stream( capture_request )
        } catch ( error ) {
            if( !capture_request.video_device_id || !can_retry_without_camera_choice( error ) ) throw error

            log.warn( `Preferred camera was unavailable; falling back to browser camera choice`, {
                video_device_id: capture_request.video_device_id,
                error
            } )
            forget_video_device_id()

            const fallback_request = { ...capture_request }

            delete fallback_request.video_device_id

            return request_capture_stream( fallback_request )
        }
    }, [ forget_video_device_id ] )

    const watch_preview_track_health = useCallback( ( preview_stream ) => {
        preview_track_cleanup_ref.current?.()

        const preview_tracks = preview_stream.getVideoTracks?.() ?? []
        const cleanup_callbacks = []
        let muted_timeout = null

        const restart_preview = ( reason ) => {
            if( stream_ref.current !== preview_stream ) return
            if( phase_ref.current !== `idle` ) return

            preview_resume_requested_ref.current = true
            preview_resume_after_idle_ref.current = false

            if( document.hidden ) {
                clear_current_stream()
                return
            }

            log.warn( `Camera preview stream stopped producing frames; reopening`, {
                project_id,
                reason
            } )
            preview_attempted_ref.current = false
            clear_current_stream()
            open_preview_ref.current?.( { force: true } )
        }

        preview_tracks.forEach( ( track ) => {
            const restart_after_muted_delay = () => {
                window.clearTimeout( muted_timeout )
                muted_timeout = window.setTimeout( () => {
                    if( track.muted ) restart_preview( `muted` )
                }, 700 )
            }
            const clear_muted_delay = () => {
                window.clearTimeout( muted_timeout )
                muted_timeout = null
            }
            const restart_after_end = () => restart_preview( `ended` )

            track.addEventListener?.( `ended`, restart_after_end, { once: true } )
            track.addEventListener?.( `mute`, restart_after_muted_delay )
            track.addEventListener?.( `unmute`, clear_muted_delay )
            cleanup_callbacks.push( () => {
                track.removeEventListener?.( `ended`, restart_after_end )
                track.removeEventListener?.( `mute`, restart_after_muted_delay )
                track.removeEventListener?.( `unmute`, clear_muted_delay )
            } )
        } )

        preview_track_cleanup_ref.current = () => {
            window.clearTimeout( muted_timeout )
            cleanup_callbacks.forEach( ( cleanup ) => cleanup() )
        }
    }, [
        clear_current_stream,
        project_id
    ] )

    const refresh_camera_devices = useCallback( async ( active_video_device_id = null ) => {
        const next_camera_devices = await list_video_input_devices()

        if( !mounted_ref.current ) return

        const selected_id = selected_video_device_id_ref.current
        const selected_device_still_available = next_camera_devices.some( ( { device_id } ) => {
            return device_id === selected_id
        } )
        const next_selected_id = selected_id && selected_device_still_available
            ? selected_id
            : active_video_device_id

        selected_video_device_id_ref.current = next_selected_id ?? null
        set_selected_video_device_id( next_selected_id ?? null )
        set_camera_devices( next_camera_devices )
        remember_video_device_id( next_selected_id ?? null )
    }, [ remember_video_device_id ] )

    const open_preview = useCallback( ( { force = false } = {} ) => {
        if( !project_id ) return Promise.resolve( null )
        if( stream_ref.current || phase_ref.current !== `idle` ) return Promise.resolve( stream_ref.current )
        if( preview_open_promise_ref.current ) return preview_open_promise_ref.current
        if( preview_attempted_ref.current && !force ) return Promise.resolve( null )

        preview_attempted_ref.current = true
        set_media_stream_state( `opening` )

        const preview_video_device_id = selected_video_device_id_ref.current
            || saved_video_device_id
        const preview_request = {
            audio_enabled: false,
            recording_video_preset: settings?.recording_video_preset ?? DEFAULT_RECORDING_VIDEO_PRESET
        }

        if( preview_video_device_id ) preview_request.video_device_id = preview_video_device_id

        const preview_work = Promise.resolve( request_capture_with_camera_fallback( preview_request ) )
            .then( ( preview_stream ) => {
                if( !preview_stream ) {
                    if( mounted_ref.current ) set_media_stream_state( `idle` )
                    return null
                }

                if( document.hidden ) {
                    preview_resume_requested_ref.current = true
                    preview_resume_after_idle_ref.current = false
                    stop_media_stream( preview_stream )
                    if( mounted_ref.current ) set_media_stream_state( `idle` )
                    return null
                }

                const preview_can_attach = phase_ref.current === `idle`
                    || phase_ref.current === `starting`

                if(
                    !mounted_ref.current
                    || !preview_can_attach
                    || stream_ref.current
                ) {
                    stop_media_stream( preview_stream )
                    return null
                }

                stream_ref.current = preview_stream
                set_stream( preview_stream )
                set_live_media_access( get_stream_media_access( preview_stream ) )
                set_media_stream_state( `active` )
                preview_resume_requested_ref.current = false
                preview_resume_after_idle_ref.current = false
                watch_preview_track_health( preview_stream )
                const active_video_device_id = get_stream_video_device_id( preview_stream )

                refresh_camera_devices( active_video_device_id ).catch( ( error ) => {
                    log.warn( `Camera device list could not be refreshed`, error )
                } )

                log.debug( `Camera preview opened`, {
                    project_id,
                    video_tracks: preview_stream.getVideoTracks?.().length ?? 0,
                    video_device_id: active_video_device_id
                } )
                return preview_stream
            } )
            .catch( ( error ) => {
                if( mounted_ref.current ) {
                    log.warn( `Camera preview could not open`, error )
                    if( is_media_permission_denial( error ) ) {
                        mark_media_permission_denied( { camera: true } )
                    }
                    set_media_stream_state( `idle` )
                    set_error_message( get_capture_error_message( error ) )
                    set_permission_recovery_needed(
                        error?.name === `NotAllowedError`
                        || error?.name === `PermissionDeniedError`
                    )
                }

                return null
            } )
            .finally( () => {
                preview_open_promise_ref.current = null
            } )

        preview_open_promise_ref.current = preview_work
        return preview_work
    }, [
        project_id,
        refresh_camera_devices,
        request_capture_with_camera_fallback,
        saved_video_device_id,
        mark_media_permission_denied,
        set_media_stream_state,
        set_live_media_access,
        settings?.recording_video_preset,
        watch_preview_track_health
    ] )
    open_preview_ref.current = open_preview

    const open_preview_after_idle_cleanup = useCallback( () => {
        if( !mounted_ref.current || document.hidden ) return

        if( preview_resume_requested_ref.current ) {
            if( !preview_resume_after_idle_ref.current ) return
            if( !can_resume_previously_open_preview( permission_status_ref.current ) ) return

            log.debug( `Resuming camera preview after recording cleanup`, {
                project_id
            } )
            preview_resume_requested_ref.current = false
            preview_resume_after_idle_ref.current = false
            preview_attempted_ref.current = false
            clear_current_stream()
        }

        open_preview( { force: true } )
    }, [
        clear_current_stream,
        open_preview,
        project_id
    ] )

    const reset_startup_after_forced_stop = useCallback( ( next_stream ) => {
        stop_media_stream( next_stream )
        pending_forced_stop_ref.current = false
        pending_release_duration_ref.current = null
        recorder_ref.current = null
        stop_promise_ref.current = null
        recording_mode_ref.current = null
        stream_ref.current = null
        set_media_stream_state( `idle` )
        set_phase( `idle` )

        if( !mounted_ref.current ) return

        set_stream( null )
        set_recording_mode( null )
        set_recording_started_at( null )
        open_preview_after_idle_cleanup()
    }, [
        open_preview_after_idle_cleanup,
        set_media_stream_state,
        set_phase
    ] )

    const select_camera_device = useCallback( ( video_device_id ) => {
        const next_video_device_id = normalize_video_device_id( video_device_id )

        selected_video_device_id_ref.current = next_video_device_id
        set_selected_video_device_id( next_video_device_id )
        remember_video_device_id( next_video_device_id )
        if( phase_ref.current !== `idle` ) return

        preview_attempted_ref.current = false
        clear_current_stream()
        if( !document.hidden ) open_preview( { force: true } )
    }, [
        clear_current_stream,
        open_preview,
        remember_video_device_id
    ] )

    const refresh_preview = useCallback( () => {
        if( phase_ref.current !== `idle` ) return Promise.resolve( stream_ref.current )

        preview_attempted_ref.current = false
        clear_current_stream()
        if( document.hidden ) return Promise.resolve( null )

        return open_preview( { force: true } )
    }, [
        clear_current_stream,
        open_preview
    ] )

    const refresh_environment_state = useCallback( async () => {
        const permission_refresh_id = begin_permission_refresh()
        const [
            permission_status,
            storage_estimate,
            storage_persisted
        ] = await Promise.all( [
            check_media_permissions(),
            estimate_storage(),
            persisted_storage()
        ] )

        apply_passive_permission_status( permission_status, permission_refresh_id )
        set_storage_estimate( storage_estimate )
        set_storage_persisted( storage_persisted )
        log.debug( `Recording environment state refreshed`, {
            permission_status,
            storage_persisted,
            storage_usage: storage_estimate?.usage ?? null,
            storage_quota: storage_estimate?.quota ?? null
        } )
    }, [
        apply_passive_permission_status,
        begin_permission_refresh,
        set_storage_estimate,
        set_storage_persisted
    ] )

    const read_recording_result = useCallback( ( recorder = null ) => {
        const result = recording_result_ref.current ?? empty_recording_result

        return {
            chunks: result.chunks ?? [],
            mime_type: recorder?.mimeType || result.chunks?.at( 0 )?.type || result.mime_type || `video/webm`,
            started_at: result.started_at ?? Date.now(),
            error: result.error ?? null
        }
    }, [] )

    const wait_for_recorder_stop = useCallback( ( recorder ) => {
        return new Promise( ( resolve ) => {
            let settled = false
            let timeout_id = null

            const finish = ( result ) => {
                if( settled ) return

                settled = true
                window.clearTimeout( timeout_id )
                resolve( result )
            }

            timeout_id = window.setTimeout( () => {
                const result = read_recording_result( recorder )
                const timeout_error = result.error ?? new Error( `Recorder stop timed out before the browser finalized the clip.` )

                finish( {
                    ...result,
                    error: timeout_error
                } )
            }, RECORDER_STOP_TIMEOUT_MS )

            Promise.resolve( stop_promise_ref.current ?? read_recording_result( recorder ) )
                .then(
                    finish,
                    ( error ) => finish( {
                        ...read_recording_result( recorder ),
                        error
                    } )
                )
        } )
    }, [ read_recording_result ] )

    const enrich_saved_clip = useCallback( async ( { clip, blob, measured_duration_ms } ) => {
        const metadata = await get_video_metadata( blob ).catch( () => ( {
            duration_ms: measured_duration_ms,
            width: null,
            height: null
        } ) )
        const thumbnail_blob = await generate_video_thumbnail( blob )
        const updated_clip = await update_clip_media_details( {
            clip_id: clip.id,
            duration_ms: metadata.duration_ms || measured_duration_ms,
            width: metadata.width,
            height: metadata.height,
            thumbnail_blob
        } )

        if( updated_clip ) on_clip_saved?.( updated_clip )
    }, [ on_clip_saved ] )

    const save_recorded_clip = useCallback( async ( { chunks, mime_type, started_at, ended_at = null, error = null } ) => {
        const measured_duration_ms = ( ended_at ?? Date.now() ) - started_at
        const blob = new Blob( chunks, { type: mime_type || `video/webm` } )

        log.debug( `Recording save started`, {
            project_id,
            chunk_count: chunks.length,
            measured_duration_ms,
            size: blob.size,
            mime_type: blob.type || mime_type
        } )
        log.insane( `Recording chunks payload`, {
            chunks: chunks.map( ( chunk ) => ( {
                size: chunk.size,
                type: chunk.type
            } ) )
        } )

        if( measured_duration_ms < MINIMUM_CLIP_MS || blob.size === 0 ) {
            log.debug( `Recording discarded because it was too short`, {
                project_id,
                measured_duration_ms,
                size: blob.size
            } )
            toast( `Clip was too short to save.` )
            return null
        }

        const clip = await add_clip_to_project( {
            project_id,
            blob,
            mime_type: mime_type || blob.type || `video/webm`,
            duration_ms: measured_duration_ms,
            width: null,
            height: null,
            thumbnail_blob: null
        } )

        log.debug( `Clip saved`, {
            project_id,
            clip_id: clip.id,
            duration_ms: clip.duration_ms,
            size: blob.size,
            mime_type: clip.mime_type
        } )

        try {
            await on_clip_saved?.( clip )
        } catch ( error ) {
            log.warn( `Clip saved but project refresh failed`, error )
        }

        refresh_environment_state().catch( ( error ) => log.warn( `Environment refresh failed`, error ) )
        enrich_saved_clip( { clip, blob, measured_duration_ms } ).catch( ( enrich_error ) => {
            log.warn( `Could not finish clip thumbnail or metadata update`, enrich_error )
        } )

        if( error ) log.warn( `Recorder stopped early; saved available partial clip`, error )
        return clip
    }, [
        enrich_saved_clip,
        on_clip_saved,
        project_id,
        refresh_environment_state
    ] )

    const stop_recording = useCallback( async () => {
        if( phase_ref.current === `starting` ) {
            log.debug( `Recording stop requested while capture is still starting`, {
                project_id
            } )
            pending_forced_stop_ref.current = true
            pending_release_duration_ref.current = HOLD_THRESHOLD_MS
            return null
        }

        if( stopping_ref.current ) {
            log.debug( `Recording stop already in progress`, {
                project_id
            } )
            return stopping_ref.current
        }

        const stop_work = async () => {
            const recorder = recorder_ref.current

            if( !recorder ) return null

            log.debug( `Recording stop requested`, {
                project_id,
                recorder_state: recorder.state
            } )
            set_phase( `saving` )
            pulse_haptic( settings.haptics_enabled )
            const ended_at = Date.now()

            try {
                if( recorder.state !== `inactive` ) recorder.stop()
                play_sound_feedback( settings.sounds_enabled, `stop` )
                const result = await wait_for_recorder_stop( recorder )
                clear_current_stream()

                return await save_recorded_clip( {
                    ...result,
                    ended_at
                } )
            } catch ( error ) {
                log.error( `Could not save recording`, error )
                const message = is_storage_quota_error( error )
                    ? `Local browser storage is full. Export or delete old clips before recording more.`
                    : `The clip could not be saved.`

                set_error_message( message )
                toast.error( is_storage_quota_error( error ) ? `Storage is full` : `Clip save failed` )
                return null
            } finally {
                clear_recorder_handlers( recorder )
                recorder_ref.current = null
                stop_promise_ref.current = null
                recording_result_ref.current = empty_recording_result
                pending_forced_stop_ref.current = false
                pending_release_duration_ref.current = null
                recording_mode_ref.current = null
                if( mounted_ref.current ) {
                    set_recording_mode( null )
                    set_recording_started_at( null )
                }
                clear_current_stream()
                set_phase( `idle` )
                open_preview_after_idle_cleanup()
                stopping_ref.current = null
            }
        }

        stopping_ref.current = stop_work()
        return stopping_ref.current
    }, [
        clear_current_stream,
        open_preview_after_idle_cleanup,
        project_id,
        save_recorded_clip,
        set_phase,
        settings.haptics_enabled,
        settings.sounds_enabled
    ] )

    const start_recording = useCallback( async ( { classify_later = false } = {} ) => {
        if( phase_ref.current !== `idle` || !project_id ) {
            log.debug( `Recording start ignored`, {
                project_id,
                phase: phase_ref.current
            } )
            return
        }

        set_error_message( null )
        set_permission_recovery_needed( false )

        if( !globalThis.MediaRecorder ) {
            log.error( `Recording unavailable because MediaRecorder is missing` )
            set_error_message( media_recorder_unavailable_message )
            toast.error( `Recording unavailable` )
            refresh_environment_state().catch( ( error ) => log.warn( `Environment refresh failed`, error ) )
            return
        }

        pending_forced_stop_ref.current = false
        pending_release_duration_ref.current = null
        recording_mode_ref.current = null
        set_recording_mode( null )

        set_phase( `starting` )
        set_media_stream_state( `opening` )

        let next_stream = null

        try {
            if( preview_open_promise_ref.current ) await preview_open_promise_ref.current.catch( () => null )

            const recording_video_preset = get_recording_video_preset(
                settings?.recording_video_preset ?? DEFAULT_RECORDING_VIDEO_PRESET
            )
            const preview_video_device_id = get_stream_video_device_id( stream_ref.current )
                || selected_video_device_id_ref.current
                || saved_video_device_id
            const preview_request = {
                audio_enabled: false,
                recording_video_preset: recording_video_preset.value
            }

            if( preview_video_device_id ) preview_request.video_device_id = preview_video_device_id

            log.debug( `Recording start requested`, {
                project_id,
                audio_enabled: permission_status.microphone !== `denied`,
                video_device_id: preview_video_device_id,
                recording_video_preset: recording_video_preset.value
            } )

            const preview_stream = stream_ref.current
                ?? await request_capture_with_camera_fallback( preview_request )

            if( !preview_stream ) throw new Error( `Camera preview could not open.` )

            if( pending_forced_stop_ref.current ) {
                log.debug( `Recording startup stopped before recorder activation`, {
                    project_id
                } )
                reset_startup_after_forced_stop( preview_stream )
                return
            }

            const active_video_device_id = get_stream_video_device_id( preview_stream )
            const should_request_audio = permission_status.microphone !== `denied`
            let audio_stream = null
            let capture_warning = permission_status.microphone === `denied`
                ? `microphone_denied`
                : null

            if( should_request_audio ) {
                try {
                    audio_stream = await request_audio_stream( {
                        recording_audio_mode: settings?.recording_audio_mode ?? DEFAULT_RECORDING_AUDIO_MODE
                    } )
                } catch ( error ) {
                    log.warn( `Microphone could not be added to recording; continuing video-only`, error )
                    if( is_media_permission_denial( error ) ) {
                        mark_media_permission_denied( { microphone: true } )
                    }
                    capture_warning = error?.name === `NotAllowedError` || error?.name === `PermissionDeniedError`
                        ? `microphone_denied`
                        : `microphone_unavailable`
                }
            }

            next_stream = combine_recording_stream( preview_stream, audio_stream )
            if( pending_forced_stop_ref.current ) {
                log.debug( `Recording startup stopped before recorder activation`, {
                    project_id
                } )
                reset_startup_after_forced_stop( next_stream )
                return
            }

            stream_ref.current = next_stream
            set_live_media_access( get_stream_media_access( next_stream ) )
            set_media_stream_state( `active` )

            refresh_camera_devices( active_video_device_id ).catch( ( error ) => {
                log.warn( `Camera device list could not be refreshed`, error )
            } )
            log.debug( `Capture stream opened`, {
                project_id,
                video_tracks: next_stream.getVideoTracks?.().length ?? 0,
                audio_tracks: next_stream.getAudioTracks?.().length ?? 0,
                capture_warning: capture_warning ?? null,
                video_device_id: active_video_device_id,
                recording_video_preset: recording_video_preset.value
            } )

            if(
                permission_status.microphone === `denied`
                || capture_warning === `microphone_denied`
            ) {
                log.warn( `Recording continues without microphone access`, {
                    project_id,
                    capture_warning: capture_warning ?? null
                } )
                set_error_message( `Microphone access is blocked, so this clip is recording video only.` )
            } else if( next_stream.getAudioTracks?.().length === 0 ) {
                log.warn( `Recording stream has no audio tracks`, {
                    project_id
                } )
                set_error_message( `Microphone could not be used, so this clip is recording video only.` )
            }

            const stop_when_track_ends = () => {
                if( phase_ref.current === `recording` || phase_ref.current === `starting` ) stop_recording()
            }
            const start_recorder_attempt = ( mime_type ) => {
                log.debug( `Recorder start attempt`, {
                    project_id,
                    mime_type: mime_type ?? `browser-default`
                } )
                const recorder = create_media_recorder( next_stream, {
                    mime_type,
                    fallback_to_default: false,
                    video_bits_per_second: recording_video_preset.video_bits_per_second
                } )
                const chunks = []
                const started_at = Date.now()
                let recorder_error = null

                recording_result_ref.current = {
                    chunks,
                    mime_type: null,
                    started_at,
                    error: null
                }

                const stopped = new Promise( ( resolve ) => {
                    recorder.ondataavailable = ( event ) => {
                        if( event.data?.size <= 0 ) return

                        chunks.push( event.data )
                        if( event.data.type ) recording_result_ref.current.mime_type = event.data.type
                    }
                    recorder.onerror = () => {
                        recorder_error = recorder.error ?? new Error( `Recorder error` )
                        recording_result_ref.current = {
                            ...recording_result_ref.current,
                            error: recorder_error
                        }
                        stop_recording()
                    }
                    recorder.onstop = () => resolve( {
                        chunks,
                        mime_type: recorder.mimeType || chunks.at( 0 )?.type || `video/webm`,
                        started_at,
                        error: recorder_error
                    } )
                } )

                recorder_ref.current = recorder
                recording_result_ref.current.mime_type = recorder.mimeType || null
                stop_promise_ref.current = stopped
                recorder.start()
                log.debug( `Recorder started`, {
                    project_id,
                    requested_mime_type: mime_type ?? null,
                    recorder_mime_type: recorder.mimeType || null,
                    video_bits_per_second: recording_video_preset.video_bits_per_second
                } )

                return {
                    recorder,
                    started_at
                }
            }
            const requested_mime_type = select_supported_mime_type()
            const recorder_attempts = requested_mime_type ? [ requested_mime_type, null ] : [ null ]
            const start_errors = []
            const started_attempt = recorder_attempts.reduce( ( started, mime_type ) => {
                if( started ) return started

                try {
                    return start_recorder_attempt( mime_type )
                } catch ( error ) {
                    const failed_recorder = recorder_ref.current

                    log.warn( `Recorder start attempt failed`, {
                        project_id,
                        mime_type: mime_type ?? `browser-default`,
                        error
                    } )
                    start_errors.push( error )
                    clear_recorder_handlers( failed_recorder )
                    try {
                        if( failed_recorder?.state && failed_recorder.state !== `inactive` ) failed_recorder.stop()
                    } catch {
                        // The next recorder attempt or the outer cleanup will release the stream.
                    }
                    recorder_ref.current = null
                    stop_promise_ref.current = null
                    recording_result_ref.current = empty_recording_result
                    return null
                }
            }, null )

            if( !started_attempt ) throw start_errors.at( -1 ) ?? new Error( `Recorder start failed` )

            const {
                started_at
            } = started_attempt

            next_stream.getTracks().forEach( ( track ) => {
                track.addEventListener?.( `ended`, stop_when_track_ends, { once: true } )
            } )
            set_stream( next_stream )
            set_recording_started_at( started_at )

            pulse_haptic( settings.haptics_enabled )
            play_sound_feedback( settings.sounds_enabled, `start` )
            set_phase( `recording` )
            log.debug( `Recording started`, {
                project_id,
                started_at
            } )
            refresh_environment_state().catch( ( error ) => log.warn( `Environment refresh failed`, error ) )

            if( classify_later ) {
                const pending_duration = pending_release_duration_ref.current

                if( pending_duration !== null ) {
                    const gesture = classify_recording_gesture( pending_duration )
                    pending_release_duration_ref.current = null

                    if( gesture === `hold` ) {
                        await stop_recording()
                        return
                    }

                    recording_mode_ref.current = `tap`
                    set_recording_mode( `tap` )
                }
            } else {
                recording_mode_ref.current = `tap`
                set_recording_mode( `tap` )
            }
        } catch ( error ) {
            log.error( `Recording could not start`, error )
            if( is_media_permission_denial( error ) ) {
                mark_media_permission_denied( { camera: true } )
            }
            if( mounted_ref.current ) {
                set_error_message( get_capture_error_message( error ) )
                set_permission_recovery_needed(
                    error?.name === `NotAllowedError`
                    || error?.name === `PermissionDeniedError`
                )
                toast.error( `Recording unavailable` )
            }
            clear_recorder_handlers( recorder_ref.current )
            recorder_ref.current = null
            stop_promise_ref.current = null
            recording_result_ref.current = empty_recording_result
            stopping_ref.current = null
            pending_forced_stop_ref.current = false
            if( next_stream && stream_ref.current !== next_stream ) stop_media_stream( next_stream )
            pending_release_duration_ref.current = null
            recording_mode_ref.current = null
            if( mounted_ref.current ) set_recording_mode( null )
            clear_current_stream()
            set_phase( `idle` )
            open_preview_after_idle_cleanup()
            refresh_environment_state().catch( ( refresh_error ) => log.warn( `Environment refresh failed`, refresh_error ) )
        }
    }, [
        clear_current_stream,
        open_preview_after_idle_cleanup,
        project_id,
        refresh_environment_state,
        refresh_camera_devices,
        request_capture_with_camera_fallback,
        reset_startup_after_forced_stop,
        saved_video_device_id,
        mark_media_permission_denied,
        set_phase,
        set_live_media_access,
        set_media_stream_state,
        settings.haptics_enabled,
        settings?.recording_audio_mode,
        settings?.recording_video_preset,
        settings.sounds_enabled,
        permission_status.microphone,
        stop_recording
    ] )

    useEffect( () => {
        persisted_video_device_id_ref.current = saved_video_device_id
        if( selected_video_device_id_ref.current || !saved_video_device_id ) return

        selected_video_device_id_ref.current = saved_video_device_id
        set_selected_video_device_id( saved_video_device_id )
    }, [ saved_video_device_id ] )

    const press_record = useCallback( () => {
        pointer_started_at_ref.current = performance.now()

        if( phase_ref.current === `idle` ) {
            start_recording( { classify_later: true } )
            return
        }

        if( phase_ref.current !== `recording` ) return

        // A permission prompt can swallow the first pointer release. Treat the next
        // fresh press as the user's stop tap instead of requiring a third tap.
        if( !recording_mode_ref.current ) {
            recording_mode_ref.current = `tap`
            set_recording_mode( `tap` )
        }
    }, [ start_recording ] )

    const release_record = useCallback( () => {
        const duration_ms = performance.now() - pointer_started_at_ref.current

        if( phase_ref.current === `starting` ) {
            pending_release_duration_ref.current = duration_ms
            return
        }

        if( phase_ref.current !== `recording` ) return

        if( recording_mode_ref.current === `tap` ) {
            stop_recording()
            return
        }

        const gesture = classify_recording_gesture( duration_ms )

        if( gesture === `tap` ) {
            recording_mode_ref.current = `tap`
            set_recording_mode( `tap` )
            return
        }

        stop_recording()
    }, [ stop_recording ] )

    const cancel_record = useCallback( () => {
        if( phase_ref.current === `recording` || phase_ref.current === `starting` ) stop_recording()
    }, [ stop_recording ] )

    const toggle_recording = useCallback( () => {
        if( phase_ref.current === `idle` ) {
            start_recording()
            return
        }

        if( phase_ref.current === `starting` ) {
            stop_recording()
            return
        }

        if( phase_ref.current === `recording` ) stop_recording()
    }, [ start_recording, stop_recording ] )

    useEffect( () => {
        return () => {
            mounted_ref.current = false
        }
    }, [] )

    useEffect( () => {
        if( recording_state !== `recording` || !recording_started_at ) return undefined

        const interval = window.setInterval( () => set_timer_tick( ( value ) => value + 1 ), 250 )
        return () => window.clearInterval( interval )
    }, [ recording_started_at, recording_state ] )

    useEffect( () => {
        const suspend_preview_for_background = () => {
            if( phase_ref.current === `recording` || phase_ref.current === `starting` ) {
                preview_resume_requested_ref.current = true
                preview_resume_after_idle_ref.current = false
                cancel_record()
                return
            }

            if( phase_ref.current !== `idle` ) return
            if( !stream_ref.current && !preview_open_promise_ref.current && !preview_attempted_ref.current ) return

            preview_resume_requested_ref.current = true
            preview_resume_after_idle_ref.current = false
            clear_current_stream()
        }
        const refresh_preview_after_return = () => {
            if( document.hidden ) return
            if( phase_ref.current !== `idle` ) {
                // A quick app switch can return while stop_recording is still saving.
                // Keep the resume request pending so the idle cleanup path reopens the camera.
                if( preview_resume_requested_ref.current ) preview_resume_after_idle_ref.current = true
                return
            }
            const resume_requested = preview_resume_requested_ref.current
            const can_refresh_preview = resume_requested
                ? can_resume_previously_open_preview( permission_status )
                : can_attempt_recording( permission_status )

            if( !can_refresh_preview ) return

            const current_stream = stream_ref.current
            const should_check_preview = preview_resume_requested_ref.current
                || preview_attempted_ref.current
                || Boolean( current_stream )

            if( !should_check_preview ) return

            if( current_stream && has_live_video_track( current_stream ) && !preview_resume_requested_ref.current ) {
                set_media_stream_state( `active` )
                return
            }

            log.debug( `Refreshing camera preview after page became visible`, {
                project_id,
                had_stream: Boolean( current_stream ),
                resume_requested: preview_resume_requested_ref.current
            } )
            preview_resume_requested_ref.current = false
            preview_resume_after_idle_ref.current = false
            preview_attempted_ref.current = false
            clear_current_stream()
            open_preview( { force: true } )
        }
        const handle_visibility_change = () => {
            if( document.hidden ) {
                suspend_preview_for_background()
            }
        }

        document.addEventListener( `visibilitychange`, handle_visibility_change )
        window.addEventListener( `pagehide`, suspend_preview_for_background )
        document.addEventListener( `freeze`, suspend_preview_for_background )
        const stop_listening_for_app_return = listen_for_app_return_event( refresh_preview_after_return )

        return () => {
            document.removeEventListener( `visibilitychange`, handle_visibility_change )
            window.removeEventListener( `pagehide`, suspend_preview_for_background )
            document.removeEventListener( `freeze`, suspend_preview_for_background )
            stop_listening_for_app_return()
        }
    }, [
        cancel_record,
        clear_current_stream,
        open_preview,
        permission_status,
        project_id,
        set_media_stream_state
    ] )

    useEffect( () => {
        return () => {
            if( phase_ref.current === `recording` || phase_ref.current === `starting` ) stop_recording()
            else clear_current_stream()
        }
    }, [ clear_current_stream, stop_recording ] )

    const elapsed_ms = recording_started_at ? Date.now() - recording_started_at + timer_tick * 0 : 0

    return {
        stream,
        error_message,
        permission_recovery_needed,
        recording_state,
        recording_mode,
        elapsed_ms,
        camera_devices,
        selected_video_device_id,
        select_camera_device,
        open_preview,
        refresh_preview,
        press_record,
        release_record,
        cancel_record,
        toggle_recording
    }
}
