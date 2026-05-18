import React from 'react'
import { createRoot } from 'react-dom/client'
import { log } from 'mentie/modules/logging.js'
import App from './App.jsx'
import './index.css'

const root_element = document.getElementById( `root` )

log.info( `Daily Video Journal app starting`, {
    path: window.location.pathname,
    loglevel: new URLSearchParams( window.location.search ).get( `loglevel` )
        ?? new URLSearchParams( window.location.search ).get( `log_level` )
        ?? `default`
} )
log.debug( `App runtime detected`, {
    secure_context: window.isSecureContext,
    online: navigator.onLine,
    service_worker_available: `serviceWorker` in navigator
} )

createRoot( root_element ).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
)

log.info( `Daily Video Journal app rendered` )

if( `serviceWorker` in navigator && import.meta.env.PROD ) {
    window.addEventListener( `load`, () => {
        navigator.serviceWorker.register( `/sw.js` )
            .then( ( registration ) => {
                log.info( `Service worker registered`, {
                    scope: registration.scope
                } )
            } )
            .catch( ( error ) => {
                log.warn( `Service worker registration failed`, error )
            } )
    } )
}
