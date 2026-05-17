import { useEffect } from 'react'
import { log } from 'mentie'
import { useAppStore } from '../stores/app_store.js'
import { check_media_permissions } from '../modules/permissions/permissions.js'
import {
    estimate_storage,
    get_active_project,
    persisted_storage
} from '../modules/storage/journal_storage.js'

/**
 * Loads app-wide passive state on startup without opening media devices.
 * @returns {void}
 */
export function useAppBootstrap() {
    const set_active_project_id = useAppStore( ( state ) => state.set_active_project_id )
    const set_permission_status = useAppStore( ( state ) => state.set_permission_status )
    const set_storage_estimate = useAppStore( ( state ) => state.set_storage_estimate )
    const set_storage_persisted = useAppStore( ( state ) => state.set_storage_persisted )

    useEffect( () => {
        let cancelled = false

        const load_boot_state = async () => {
            try {
                const [
                    permission_status,
                    active_project,
                    storage_estimate,
                    storage_persisted
                ] = await Promise.all( [
                    check_media_permissions(),
                    get_active_project(),
                    estimate_storage(),
                    persisted_storage()
                ] )

                if( cancelled ) return

                set_permission_status( permission_status )
                set_active_project_id( active_project?.id ?? null )
                set_storage_estimate( storage_estimate )
                set_storage_persisted( storage_persisted )
            } catch ( error ) {
                log.error( `App bootstrap failed`, error )
                if( !cancelled ) set_active_project_id( null )
            }
        }

        load_boot_state()

        return () => {
            cancelled = true
        }
    }, [
        set_active_project_id,
        set_permission_status,
        set_storage_estimate,
        set_storage_persisted
    ] )
}
