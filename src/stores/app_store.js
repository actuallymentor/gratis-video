import { create } from 'zustand'
import {
    default_live_media_access,
    grant_observed_media_access,
    mark_denied_media_access,
    reconcile_passive_permission_status
} from '../modules/permissions/runtime_state.js'

export { default_live_media_access }

export const default_permission_status = {
    camera: `unknown`,
    microphone: `unknown`,
    secure_context: true,
    media_devices: `unknown`,
    media_recorder: `unknown`,
    offline: false
}

export const default_export_progress = {
    active: false,
    percent: 0,
    message: `Idle`
}

export const default_media_stream_state = `idle`

export const useAppStore = create( ( set ) => ( {
    active_project_id: undefined,
    permission_status: default_permission_status,
    permission_refresh_id: 0,
    live_media_access: default_live_media_access,
    media_stream_state: default_media_stream_state,
    recording_state: `idle`,
    export_progress: default_export_progress,
    storage_estimate: null,
    storage_persisted: null,

    set_active_project_id: ( active_project_id ) => set( { active_project_id } ),
    set_permission_status: ( permission_status ) => set( ( state ) => ( {
        permission_status: reconcile_passive_permission_status(
            permission_status,
            state.live_media_access
        )
    } ) ),
    begin_permission_refresh: () => {
        let permission_refresh_id = 0

        set( ( state ) => {
            permission_refresh_id = state.permission_refresh_id + 1

            return { permission_refresh_id }
        } )

        return permission_refresh_id
    },
    apply_passive_permission_status: ( permission_status, permission_refresh_id = null ) => {
        set( ( state ) => {
            if(
                permission_refresh_id !== null
                && permission_refresh_id < state.permission_refresh_id
            ) return {}

            return {
                permission_status: reconcile_passive_permission_status(
                    permission_status,
                    state.live_media_access
                )
            }
        } )
    },
    set_live_media_access: ( media_access ) => {
        set( ( state ) => {
            const next_live_media_access = {
                ...state.live_media_access,
                ...media_access
            }
            const observed_media_access = {
                camera: Boolean( media_access.camera ),
                microphone: Boolean( media_access.microphone )
            }
            const has_observed_access = observed_media_access.camera || observed_media_access.microphone

            return {
                live_media_access: next_live_media_access,
                permission_refresh_id: has_observed_access
                    ? state.permission_refresh_id + 1
                    : state.permission_refresh_id,
                permission_status: grant_observed_media_access(
                    state.permission_status,
                    observed_media_access
                )
            }
        } )
    },
    mark_media_permission_denied: ( media_access ) => {
        set( ( state ) => {
            const denied_media_access = {
                camera: Boolean( media_access.camera ),
                microphone: Boolean( media_access.microphone )
            }
            const has_denied_access = denied_media_access.camera || denied_media_access.microphone

            if( !has_denied_access ) return {}

            return {
                live_media_access: {
                    ...state.live_media_access,
                    camera: denied_media_access.camera ? false : state.live_media_access.camera,
                    microphone: denied_media_access.microphone ? false : state.live_media_access.microphone
                },
                permission_refresh_id: state.permission_refresh_id + 1,
                permission_status: mark_denied_media_access(
                    state.permission_status,
                    denied_media_access
                )
            }
        } )
    },
    set_media_stream_state: ( media_stream_state ) => set( { media_stream_state } ),
    set_recording_state: ( recording_state ) => set( { recording_state } ),
    set_export_progress: ( export_progress ) => set( { export_progress } ),
    set_storage_estimate: ( storage_estimate ) => set( { storage_estimate } ),
    set_storage_persisted: ( storage_persisted ) => set( { storage_persisted } )
} ) )
