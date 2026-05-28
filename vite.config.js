import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig( {
    plugins: [
        react(),
        VitePWA( {
            strategies: `injectManifest`,
            registerType: `prompt`,
            injectRegister: false,
            manifest: false,
            injectManifest: {
                globPatterns: [
                    `**/*.{js,css,html,ico,png,svg,webmanifest}`
                ]
            }
        } )
    ]
} )
