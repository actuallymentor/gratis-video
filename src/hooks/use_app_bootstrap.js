import { useEffect } from 'react'
import { log } from 'mentie/modules/logging.js'
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

        const read_boot_value = async ( label, load_value, fallback = null ) => {
            try {
                return await load_value()
            } catch ( error ) {
                log.warn( `${ label } failed during app bootstrap`, error )
                return fallback
            }
        }

        const refresh_permissions = async () => {
            try {
                const permission_status = await check_media_permissions()
                if( !cancelled ) set_permission_status( permission_status )
            } catch ( error ) {
                log.warn( `Permission refresh failed`, error )
            }
        }

        const load_boot_state = async () => {
            const [
                permission_status,
                active_project,
                storage_estimate,
                storage_persisted
            ] = await Promise.all( [
                read_boot_value( `Permission check`, check_media_permissions ),
                read_boot_value( `Active project lookup`, get_active_project ),
                read_boot_value( `Storage estimate`, estimate_storage ),
                read_boot_value( `Storage persistence check`, persisted_storage )
            ] )

            if( cancelled ) return

            if( permission_status ) set_permission_status( permission_status )
            set_active_project_id( active_project?.id ?? null )
            set_storage_estimate( storage_estimate )
            set_storage_persisted( storage_persisted )
        }

        load_boot_state()
        window.addEventListener( `focus`, refresh_permissions )
        window.addEventListener( `online`, refresh_permissions )
        window.addEventListener( `offline`, refresh_permissions )

        return () => {
            cancelled = true
            window.removeEventListener( `focus`, refresh_permissions )
            window.removeEventListener( `online`, refresh_permissions )
            window.removeEventListener( `offline`, refresh_permissions )
        }
    }, [
        set_active_project_id,
        set_permission_status,
        set_storage_estimate,
        set_storage_persisted
    ] )
}
