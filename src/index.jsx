import React from 'react'
import { createRoot } from 'react-dom/client'
import { log } from 'mentie/modules/logging.js'
import App from './App.jsx'
import './index.css'

const root_element = document.getElementById( `root` )

createRoot( root_element ).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
)

if( `serviceWorker` in navigator && import.meta.env.PROD ) {
    window.addEventListener( `load`, () => {
        navigator.serviceWorker.register( `/sw.js` ).catch( ( error ) => {
            log.warn( `Service worker registration failed`, error )
        } )
    } )
}
