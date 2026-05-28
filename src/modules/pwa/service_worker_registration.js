import { log } from 'mentie/modules/logging.js'

const noop_update = async () => {}

/**
 * Registers the PWA service worker and reports when a waiting update exists.
 * @param {Object} options - Registration callbacks.
 * @param {Function} options.on_need_refresh - Called when new content is waiting.
 * @param {Function} options.on_offline_ready - Called when the app shell is ready offline.
 * @returns {Promise<Function>} Function that activates the waiting worker.
 */
export async function register_service_worker_update( {
    on_need_refresh = () => {},
    on_offline_ready = () => {}
} = {} ) {

    if( !import.meta.env.PROD || !( `serviceWorker` in navigator ) ) return noop_update

    const { registerSW } = await import( `virtual:pwa-register` )
    let update_service_worker = noop_update

    update_service_worker = registerSW( {
        immediate: true,
        onNeedRefresh() {
            log.info( `Service worker update ready` )
            on_need_refresh( update_service_worker )
        },
        onOfflineReady() {
            log.info( `App shell cached for offline use` )
            on_offline_ready()
        },
        onRegisteredSW( service_worker_url, registration ) {
            log.info( `Service worker registered`, {
                scope: registration?.scope,
                service_worker_url
            } )

            registration?.update().catch( ( error ) => {
                log.warn( `Service worker update check failed`, error )
            } )
        },
        onRegisterError( error ) {
            log.warn( `Service worker registration failed`, error )
        }
    } )

    return update_service_worker
}
