import { useEffect } from 'react'
import { log } from 'mentie/modules/logging.js'
import { useAppStore } from '../stores/app_store.js'
import { emit_app_return_event } from '../modules/lifecycle/app_lifecycle.js'
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
    const begin_permission_refresh = useAppStore( ( state ) => state.begin_permission_refresh )
    const apply_passive_permission_status = useAppStore( ( state ) => state.apply_passive_permission_status )
    const set_storage_estimate = useAppStore( ( state ) => state.set_storage_estimate )
    const set_storage_persisted = useAppStore( ( state ) => state.set_storage_persisted )

    useEffect( () => {
        let cancelled = false

        log.info( `App bootstrap started` )

        const read_boot_value = async ( label, load_value, fallback = null ) => {
            try {
                const value = await load_value()

                log.debug( `${ label } loaded during app bootstrap` )
                log.insane( `${ label } bootstrap payload`, value )

                return value
            } catch ( error ) {
                log.warn( `${ label } failed during app bootstrap`, error )
                return fallback
            }
        }

        const refresh_permissions = async () => {
            const permission_refresh_id = begin_permission_refresh()

            log.debug( `Refreshing passive permission status` )

            try {
                const permission_status = await check_media_permissions()
                if( !cancelled ) {
                    apply_passive_permission_status( permission_status, permission_refresh_id )
                    log.info( `Permission status refreshed`, permission_status )
                }
            } catch ( error ) {
                log.warn( `Permission refresh failed`, error )
            }
        }

        const load_active_project_state = async () => {
            const active_project = await read_boot_value( `Active project lookup`, get_active_project )

            if( !cancelled ) {
                set_active_project_id( active_project?.id ?? null )
                log.info( `Active project resolved`, {
                    project_id: active_project?.id ?? null
                } )
            }
        }

        const load_permission_state = async () => {
            await refresh_permissions()
        }

        const load_storage_state = async () => {
            const [
                storage_estimate,
                storage_persisted
            ] = await Promise.all( [
                read_boot_value( `Storage estimate`, estimate_storage ),
                read_boot_value( `Storage persistence check`, persisted_storage )
            ] )

            if( cancelled ) return

            set_storage_estimate( storage_estimate )
            set_storage_persisted( storage_persisted )
            log.info( `Initial storage status loaded`, {
                persisted: storage_persisted,
                usage: storage_estimate?.usage ?? null,
                quota: storage_estimate?.quota ?? null
            } )
        }

        // Resolve the first route from the active project lookup; permission and
        // storage probes are useful background context but should not hold the app shell.
        load_active_project_state()
        load_permission_state()
        const refresh_after_app_return = ( reason ) => {
            if( document.hidden ) return

            emit_app_return_event( reason )
            refresh_permissions()
        }
        const refresh_after_visibility_return = () => {
            if( document.hidden ) return

            refresh_after_app_return( `visibilitychange` )
        }
        const refresh_after_page_show = () => refresh_after_app_return( `pageshow` )
        const refresh_after_focus = () => refresh_after_app_return( `focus` )

        load_storage_state()
        document.addEventListener( `visibilitychange`, refresh_after_visibility_return )
        window.addEventListener( `pageshow`, refresh_after_page_show )
        window.addEventListener( `focus`, refresh_after_focus )
        window.addEventListener( `online`, refresh_permissions )
        window.addEventListener( `offline`, refresh_permissions )

        return () => {
            cancelled = true
            document.removeEventListener( `visibilitychange`, refresh_after_visibility_return )
            window.removeEventListener( `pageshow`, refresh_after_page_show )
            window.removeEventListener( `focus`, refresh_after_focus )
            window.removeEventListener( `online`, refresh_permissions )
            window.removeEventListener( `offline`, refresh_permissions )
        }
    }, [
        apply_passive_permission_status,
        begin_permission_refresh,
        set_active_project_id,
        set_storage_estimate,
        set_storage_persisted
    ] )
}
