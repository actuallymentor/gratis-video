import { defineConfig, devices } from '@playwright/test'

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
                `--use-fake-device-for-media-stream`,
                `--use-fake-ui-for-media-stream`
            ]
        },
        trace: `retain-on-failure`
    },
    webServer: {
        command: `npm run dev -- --host 127.0.0.1`,
        url: `http://127.0.0.1:5173`,
        reuseExistingServer: !process.env.CI,
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
