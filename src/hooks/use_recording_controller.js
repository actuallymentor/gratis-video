import { useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { log } from 'mentie/modules/logging.js'
import { useAppStore } from '../stores/app_store.js'
import { check_media_permissions } from '../modules/permissions/permissions.js'
import {
    add_clip_to_project,
    estimate_storage,
    persisted_storage,
    update_clip_media_details
} from '../modules/storage/journal_storage.js'
import {
    HOLD_THRESHOLD_MS,
    MINIMUM_CLIP_MS,
    classify_recording_gesture,
    create_media_recorder,
    generate_video_thumbnail,
    get_capture_error_message,
    get_video_metadata,
    play_sound_feedback,
    pulse_haptic,
    request_capture_stream,
    stop_media_stream
} from '../modules/media/recorder.js'

const empty_recording_result = {
    chunks: [],
    mime_type: `video/webm`,
    started_at: 0
}

const is_storage_quota_error = ( error ) => {
    return error?.name === `QuotaExceededError`
        || error?.name === `NS_ERROR_DOM_QUOTA_REACHED`
        || error?.code === 22
        || error?.code === 1014
}

const media_recorder_unavailable_message = `This browser cannot record video with MediaRecorder.`

/**
 * Coordinates pointer/keyboard recording, clip validation, and local persistence.
 * @param {Object} options - Recording options.
 * @param {string} options.project_id - Current project id.
 * @param {Object} options.settings - Global settings.
 * @param {Function} options.on_clip_saved - Callback after clip save.
 * @returns {Object} Recording controller state and handlers.
 */
export function useRecordingController( { project_id, settings, on_clip_saved } ) {
    const [ stream, set_stream ] = useState( null )
    const [ error_message, set_error_message ] = useState( null )
    const [ permission_recovery_needed, set_permission_recovery_needed ] = useState( false )
    const [ recording_started_at, set_recording_started_at ] = useState( null )
    const [ recording_mode, set_recording_mode ] = useState( null )
    const [ timer_tick, set_timer_tick ] = useState( 0 )

    const set_recording_state = useAppStore( ( state ) => state.set_recording_state )
    const recording_state = useAppStore( ( state ) => state.recording_state )
    const set_media_stream_state = useAppStore( ( state ) => state.set_media_stream_state )
    const set_permission_status = useAppStore( ( state ) => state.set_permission_status )
    const set_storage_estimate = useAppStore( ( state ) => state.set_storage_estimate )
    const set_storage_persisted = useAppStore( ( state ) => state.set_storage_persisted )

    const mounted_ref = useRef( true )
    const recorder_ref = useRef( null )
    const stream_ref = useRef( null )
    const stop_promise_ref = useRef( null )
    const phase_ref = useRef( `idle` )
    const pointer_started_at_ref = useRef( 0 )
    const pending_forced_stop_ref = useRef( false )
    const pending_release_duration_ref = useRef( null )
    const stopping_ref = useRef( null )
    const recording_mode_ref = useRef( null )

    const set_phase = useCallback( ( phase ) => {
        phase_ref.current = phase
        set_recording_state( phase )
    }, [ set_recording_state ] )

    const clear_current_stream = useCallback( () => {
        stop_media_stream( stream_ref.current )
        stream_ref.current = null
        if( mounted_ref.current ) set_stream( null )
        set_media_stream_state( `idle` )
    }, [ set_media_stream_state ] )

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
    }, [
        set_media_stream_state,
        set_phase
    ] )

    const refresh_environment_state = useCallback( async () => {
        const [
            permission_status,
            storage_estimate,
            storage_persisted
        ] = await Promise.all( [
            check_media_permissions(),
            estimate_storage(),
            persisted_storage()
        ] )

        set_permission_status( permission_status )
        set_storage_estimate( storage_estimate )
        set_storage_persisted( storage_persisted )
    }, [
        set_permission_status,
        set_storage_estimate,
        set_storage_persisted
    ] )

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

    const save_recorded_clip = useCallback( async ( { chunks, mime_type, started_at, error = null } ) => {
        const measured_duration_ms = Date.now() - started_at
        const blob = new Blob( chunks, { type: mime_type || `video/webm` } )

        if( measured_duration_ms < MINIMUM_CLIP_MS || blob.size === 0 ) {
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

        on_clip_saved?.( clip )
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
            pending_forced_stop_ref.current = true
            pending_release_duration_ref.current = HOLD_THRESHOLD_MS
            return null
        }

        if( stopping_ref.current ) return stopping_ref.current

        const stop_work = async () => {
            const recorder = recorder_ref.current

            if( !recorder ) return null

            set_phase( `saving` )
            pulse_haptic( settings.haptics_enabled )

            try {
                if( recorder.state !== `inactive` ) recorder.stop()
                play_sound_feedback( settings.sounds_enabled, `stop` )
                const result = await ( stop_promise_ref.current ?? Promise.resolve( empty_recording_result ) )
                return await save_recorded_clip( result )
            } catch ( error ) {
                log.error( `Could not save recording`, error )
                const message = is_storage_quota_error( error )
                    ? `Local browser storage is full. Export or delete old clips before recording more.`
                    : `The clip could not be saved.`

                set_error_message( message )
                toast.error( is_storage_quota_error( error ) ? `Storage is full` : `Clip save failed` )
                return null
            } finally {
                recorder_ref.current = null
                stop_promise_ref.current = null
                pending_forced_stop_ref.current = false
                pending_release_duration_ref.current = null
                recording_mode_ref.current = null
                if( mounted_ref.current ) {
                    set_recording_mode( null )
                    set_recording_started_at( null )
                }
                clear_current_stream()
                set_phase( `idle` )
                stopping_ref.current = null
            }
        }

        stopping_ref.current = stop_work()
        return stopping_ref.current
    }, [
        clear_current_stream,
        save_recorded_clip,
        set_phase,
        settings.haptics_enabled,
        settings.sounds_enabled
    ] )

    const start_recording = useCallback( async ( { classify_later = false } = {} ) => {
        if( phase_ref.current !== `idle` || !project_id ) return

        set_error_message( null )
        set_permission_recovery_needed( false )

        if( !globalThis.MediaRecorder ) {
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
        pulse_haptic( settings.haptics_enabled )

        let next_stream = null

        try {
            next_stream = await request_capture_stream()
            if( pending_forced_stop_ref.current ) {
                reset_startup_after_forced_stop( next_stream )
                return
            }

            stream_ref.current = next_stream
            set_media_stream_state( `active` )
            if( next_stream.getAudioTracks?.().length === 0 ) {
                set_error_message( `Microphone could not be used, so this clip is recording video only.` )
            }

            const recorder = create_media_recorder( next_stream )
            const chunks = []
            const started_at = Date.now()
            const stop_when_track_ends = () => {
                if( phase_ref.current === `recording` || phase_ref.current === `starting` ) stop_recording()
            }

            let recorder_error = null
            const stopped = new Promise( ( resolve ) => {
                recorder.ondataavailable = ( event ) => {
                    if( event.data?.size > 0 ) chunks.push( event.data )
                }
                recorder.onerror = () => {
                    recorder_error = recorder.error ?? new Error( `Recorder error` )
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
            stop_promise_ref.current = stopped
            next_stream.getTracks().forEach( ( track ) => {
                track.addEventListener?.( `ended`, stop_when_track_ends, { once: true } )
            } )
            set_stream( next_stream )
            set_recording_started_at( started_at )

            play_sound_feedback( settings.sounds_enabled, `start` )
            recorder.start( 250 )
            set_phase( `recording` )
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
            if( mounted_ref.current ) {
                set_error_message( get_capture_error_message( error ) )
                set_permission_recovery_needed(
                    error?.name === `NotAllowedError`
                    || error?.name === `PermissionDeniedError`
                )
                toast.error( `Recording unavailable` )
            }
            recorder_ref.current = null
            stop_promise_ref.current = null
            stopping_ref.current = null
            pending_forced_stop_ref.current = false
            if( next_stream && stream_ref.current !== next_stream ) stop_media_stream( next_stream )
            pending_release_duration_ref.current = null
            recording_mode_ref.current = null
            if( mounted_ref.current ) set_recording_mode( null )
            clear_current_stream()
            set_phase( `idle` )
            refresh_environment_state().catch( ( refresh_error ) => log.warn( `Environment refresh failed`, refresh_error ) )
        }
    }, [
        clear_current_stream,
        project_id,
        refresh_environment_state,
        reset_startup_after_forced_stop,
        set_phase,
        set_media_stream_state,
        settings.haptics_enabled,
        settings.sounds_enabled,
        stop_recording
    ] )

    const press_record = useCallback( () => {
        pointer_started_at_ref.current = performance.now()

        if( phase_ref.current === `idle` ) {
            start_recording( { classify_later: true } )
            return
        }

        if( phase_ref.current === `recording` && recording_mode_ref.current === `tap` ) {
            return
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
        const stop_when_hidden = () => {
            if( document.hidden ) cancel_record()
        }
        const stop_for_page_lifecycle = () => cancel_record()

        document.addEventListener( `visibilitychange`, stop_when_hidden )
        window.addEventListener( `pagehide`, stop_for_page_lifecycle )
        document.addEventListener( `freeze`, stop_for_page_lifecycle )
        return () => {
            document.removeEventListener( `visibilitychange`, stop_when_hidden )
            window.removeEventListener( `pagehide`, stop_for_page_lifecycle )
            document.removeEventListener( `freeze`, stop_for_page_lifecycle )
        }
    }, [ cancel_record ] )

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
        press_record,
        release_record,
        cancel_record,
        toggle_recording
    }
}
