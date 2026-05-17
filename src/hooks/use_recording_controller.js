import { useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { log } from 'mentie/modules/logging.js'
import { useAppStore } from '../stores/app_store.js'
import { add_clip_to_project } from '../modules/storage/journal_storage.js'
import {
    HOLD_THRESHOLD_MS,
    MINIMUM_CLIP_MS,
    classify_recording_gesture,
    create_media_recorder,
    generate_video_thumbnail,
    get_capture_error_message,
    get_video_metadata,
    pulse_haptic,
    request_capture_stream,
    stop_media_stream
} from '../modules/media/recorder.js'

const empty_recording_result = {
    chunks: [],
    mime_type: `video/webm`,
    started_at: 0
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
    const [ stream, set_stream ] = useState( null )
    const [ error_message, set_error_message ] = useState( null )
    const [ recording_started_at, set_recording_started_at ] = useState( null )
    const [ recording_mode, set_recording_mode ] = useState( null )
    const [ timer_tick, set_timer_tick ] = useState( 0 )

    const set_recording_state = useAppStore( ( state ) => state.set_recording_state )
    const recording_state = useAppStore( ( state ) => state.recording_state )

    const recorder_ref = useRef( null )
    const stream_ref = useRef( null )
    const stop_promise_ref = useRef( null )
    const phase_ref = useRef( `idle` )
    const pointer_started_at_ref = useRef( 0 )
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
        set_stream( null )
    }, [] )

    const save_recorded_clip = useCallback( async ( { chunks, mime_type, started_at } ) => {
        const measured_duration_ms = Date.now() - started_at
        const blob = new Blob( chunks, { type: mime_type || `video/webm` } )

        if( measured_duration_ms < MINIMUM_CLIP_MS || blob.size === 0 ) {
            toast( `Clip was too short to save.` )
            return null
        }

        const metadata = await get_video_metadata( blob ).catch( () => ( {
            duration_ms: measured_duration_ms,
            width: null,
            height: null
        } ) )
        const duration_ms = metadata.duration_ms || measured_duration_ms
        const thumbnail_blob = await generate_video_thumbnail( blob )
        const clip = await add_clip_to_project( {
            project_id,
            blob,
            mime_type: mime_type || blob.type || `video/webm`,
            duration_ms,
            width: metadata.width,
            height: metadata.height,
            thumbnail_blob
        } )

        on_clip_saved?.( clip )
        toast.success( `Clip saved` )
        return clip
    }, [ on_clip_saved, project_id ] )

    const stop_recording = useCallback( async () => {
        if( stopping_ref.current ) return stopping_ref.current

        const stop_work = async () => {
            const recorder = recorder_ref.current

            if( phase_ref.current === `starting` ) {
                pending_release_duration_ref.current = HOLD_THRESHOLD_MS
                return null
            }

            if( !recorder ) return null

            set_phase( `saving` )
            pulse_haptic( settings.haptics_enabled )

            try {
                if( recorder.state !== `inactive` ) recorder.stop()
                const result = await ( stop_promise_ref.current ?? Promise.resolve( empty_recording_result ) )
                return await save_recorded_clip( result )
            } catch ( error ) {
                log.error( `Could not save recording`, error )
                set_error_message( `The clip could not be saved.` )
                toast.error( `Clip save failed` )
                return null
            } finally {
                recorder_ref.current = null
                stop_promise_ref.current = null
                pending_release_duration_ref.current = null
                recording_mode_ref.current = null
                set_recording_mode( null )
                set_recording_started_at( null )
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
        settings.haptics_enabled
    ] )

    const start_recording = useCallback( async ( { classify_later = false } = {} ) => {
        if( phase_ref.current !== `idle` || !project_id ) return

        set_error_message( null )
        set_phase( `starting` )
        pulse_haptic( settings.haptics_enabled )

        try {
            const next_stream = await request_capture_stream()
            const recorder = create_media_recorder( next_stream )
            const chunks = []
            const started_at = Date.now()

            const stopped = new Promise( ( resolve, reject ) => {
                recorder.ondataavailable = ( event ) => {
                    if( event.data?.size > 0 ) chunks.push( event.data )
                }
                recorder.onerror = () => reject( recorder.error ?? new Error( `Recorder error` ) )
                recorder.onstop = () => resolve( {
                    chunks,
                    mime_type: recorder.mimeType || chunks.at( 0 )?.type || `video/webm`,
                    started_at
                } )
            } )

            stream_ref.current = next_stream
            recorder_ref.current = recorder
            stop_promise_ref.current = stopped
            set_stream( next_stream )
            set_recording_started_at( started_at )

            recorder.start( 250 )
            set_phase( `recording` )

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
            set_error_message( get_capture_error_message( error ) )
            toast.error( `Recording unavailable` )
            clear_current_stream()
            set_phase( `idle` )
        }
    }, [
        clear_current_stream,
        project_id,
        set_phase,
        settings.haptics_enabled,
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

        if( phase_ref.current === `recording` ) stop_recording()
    }, [ start_recording, stop_recording ] )

    useEffect( () => {
        if( recording_state !== `recording` || !recording_started_at ) return undefined

        const interval = window.setInterval( () => set_timer_tick( ( value ) => value + 1 ), 250 )
        return () => window.clearInterval( interval )
    }, [ recording_started_at, recording_state ] )

    useEffect( () => {
        const stop_when_hidden = () => {
            if( document.hidden ) cancel_record()
        }

        document.addEventListener( `visibilitychange`, stop_when_hidden )
        return () => document.removeEventListener( `visibilitychange`, stop_when_hidden )
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
        recording_state,
        recording_mode,
        elapsed_ms,
        press_record,
        release_record,
        cancel_record,
        toggle_recording
    }
}
