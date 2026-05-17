import { create } from 'zustand'

export const default_permission_status = {
    camera: `unknown`,
    microphone: `unknown`,
    secure_context: true,
    media_devices: `unknown`,
    media_recorder: `unknown`
}

export const default_export_progress = {
    active: false,
    percent: 0,
    message: `Idle`
}

export const useAppStore = create( ( set ) => ( {
    active_project_id: undefined,
    permission_status: default_permission_status,
    recording_state: `idle`,
    export_progress: default_export_progress,
    storage_estimate: null,
    storage_persisted: null,

    set_active_project_id: ( active_project_id ) => set( { active_project_id } ),
    set_permission_status: ( permission_status ) => set( { permission_status } ),
    set_recording_state: ( recording_state ) => set( { recording_state } ),
    set_export_progress: ( export_progress ) => set( { export_progress } ),
    set_storage_estimate: ( storage_estimate ) => set( { storage_estimate } ),
    set_storage_persisted: ( storage_persisted ) => set( { storage_persisted } )
} ) )
