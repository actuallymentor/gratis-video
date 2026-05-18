import { defineConfig, devices } from '@playwright/test'
import { ensure_fake_video_capture_file } from './tests/fake_media.js'

const fake_video_capture_file = ensure_fake_video_capture_file()

export default defineConfig( {
    testDir: `./tests`,
    testMatch: `**/*.playwright.js`,
    timeout: 30_000,
    expect: {
        timeout: 5_000
    },
    fullyParallel: true,
    reporter: `list`,
    use: {
        baseURL: `http://127.0.0.1:5173`,
        launchOptions: {
            args: [
                `--no-sandbox`,
                `--use-fake-device-for-media-stream`,
                `--use-fake-ui-for-media-stream`,
                `--use-file-for-fake-video-capture=${ fake_video_capture_file }`
            ]
        },
        trace: `retain-on-failure`
    },
    webServer: {
        command: `npm run build && npm run preview -- --host 127.0.0.1 --port 5173`,
        url: `http://127.0.0.1:5173`,
        reuseExistingServer: false,
        timeout: 30_000
    },
    projects: [
        {
            name: `desktop`,
            use: {
                ...devices[ `Desktop Chrome` ],
                viewport: {
                    width: 1280,
                    height: 900
                }
            }
        },
        {
            name: `mobile`,
            use: {
                ...devices[ `Pixel 7` ]
            }
        }
    ]
} )
