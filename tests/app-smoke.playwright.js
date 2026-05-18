import { expect, test } from '@playwright/test'

const browser_issue_types = new Set( [ `warning`, `error` ] )
const same_origin = `http://127.0.0.1:5173`

test.beforeEach( async ( { page } ) => {
    page.browser_issues = []

    page.on( `console`, ( message ) => {
        if( browser_issue_types.has( message.type() ) ) {
            page.browser_issues.push( {
                kind: `console`,
                type: message.type(),
                text: message.text()
            } )
        }
    } )
    page.on( `pageerror`, ( error ) => {
        page.browser_issues.push( {
            kind: `pageerror`,
            text: error.stack || error.message
        } )
    } )
    page.on( `requestfailed`, ( request ) => {
        const url = new URL( request.url() )

        if( [ `http:`, `https:` ].includes( url.protocol ) && url.origin === same_origin ) {
            page.browser_issues.push( {
                kind: `requestfailed`,
                url: request.url(),
                failure: request.failure()?.errorText
            } )
        }
    } )
    page.on( `response`, ( response ) => {
        const url = new URL( response.url() )

        if( url.origin === same_origin && response.status() >= 400 ) {
            page.browser_issues.push( {
                kind: `badresponse`,
                url: response.url(),
                status: response.status()
            } )
        }
    } )
} )

test.afterEach( async ( { page } ) => {
    expect( page.browser_issues ).toEqual( [] )
} )

test.describe( `daily video journal app`, () => {
    test( `creates a project, opens capture, and keeps the active route`, async ( { page } ) => {
        await page.goto( `/` )

        await expect( page.getByRole( `heading`, { name: `Projects`, exact: true } ) ).toBeVisible()
        await expect( page.getByText( `Everything stays on this device and browser.` ) ).toBeVisible()

        await page.getByRole( `button`, { name: `New` } ).click()

        await expect( page ).toHaveURL( /\/projects\/[^/]+$/ )
        await expect( page.getByText( `Press record to open the camera and save the next clip.` ) ).toBeVisible()
        await expect( page.getByRole( `heading`, { name: `Clip queue` } ) ).toBeVisible()
        await expect( page.getByRole( `button`, { name: `Record clip` } ) ).toBeVisible()

        const capture_url = page.url()

        await page.goto( `/` )
        await expect( page ).toHaveURL( capture_url )
    } )

    test( `does not open media devices before the user records`, async ( { page } ) => {
        await page.addInitScript( () => {
            const calls = []
            const media_devices = navigator.mediaDevices
            const original_get_user_media = media_devices?.getUserMedia?.bind( media_devices )

            Object.defineProperty( window, `__get_user_media_calls`, {
                configurable: true,
                value: calls
            } )

            if( original_get_user_media ) {
                Object.defineProperty( media_devices, `getUserMedia`, {
                    configurable: true,
                    value: ( constraints ) => {
                        calls.push( constraints )
                        return original_get_user_media( constraints )
                    }
                } )
                return
            }

            Object.defineProperty( navigator, `mediaDevices`, {
                configurable: true,
                value: {
                    getUserMedia: ( constraints ) => {
                        calls.push( constraints )
                        return Promise.reject( new Error( `getUserMedia unavailable` ) )
                    }
                }
            } )
        } )

        await page.goto( `/` )

        await expect( page.getByRole( `heading`, { name: `Projects`, exact: true } ) ).toBeVisible()
        await expect.poll( () => page.evaluate( () => window.__get_user_media_calls.length ) ).toBe( 0 )

        await page.getByRole( `button`, { name: `New` } ).click()

        await expect( page ).toHaveURL( /\/projects\/[^/]+$/ )
        await expect( page.getByText( `Press record to open the camera and save the next clip.` ) ).toBeVisible()
        await expect.poll( () => page.evaluate( () => window.__get_user_media_calls.length ) ).toBe( 0 )
    } )

    test( `keeps bottom capture actions stable at the viewport edge`, async ( { page } ) => {
        await page.goto( `/projects` )
        await page.getByRole( `button`, { name: `New` } ).click()

        const record_button = page.getByRole( `button`, { name: `Record clip` } )
        const app_bar = page.getByRole( `navigation`, { name: `Capture actions` } )

        await expect( record_button ).toBeVisible()
        await expect( app_bar ).toBeVisible()

        const button_box = await record_button.boundingBox()
        const bar_box = await app_bar.boundingBox()
        const viewport = page.viewportSize()

        expect( button_box.width ).toBeGreaterThanOrEqual( 72 )
        expect( button_box.height ).toBeGreaterThanOrEqual( 72 )
        expect( Math.abs(  button_box.x + button_box.width / 2  - viewport.width / 2 ) ).toBeLessThan( 4 )
        expect( bar_box.y + bar_box.height ).toBeGreaterThan( viewport.height - 2 )
    } )

    test( `records, reloads, and deletes a clip with browser media`, async ( { context, page } ) => {
        await context.grantPermissions( [ `camera`, `microphone` ] )
        await page.goto( `/projects` )
        await page.getByRole( `button`, { name: `New` } ).click()

        await page.getByRole( `button`, { name: `Record clip` } ).click()
        await expect( page.getByRole( `button`, { name: `Stop recording` } ) ).toBeVisible()
        await page.waitForTimeout( 900 )
        await page.getByRole( `button`, { name: `Stop recording` } ).click()

        await expect( page.getByText( `Clip 1` ) ).toBeVisible()

        const capture_url = page.url()

        await page.reload()
        await expect( page ).toHaveURL( capture_url )
        await expect( page.getByText( `Clip 1` ) ).toBeVisible()

        page.once( `dialog`, ( dialog ) => dialog.accept() )
        await page.getByRole( `button`, { name: `Delete clip 1` } ).click()
        await expect( page.getByText( `Recorded clips will appear here.` ) ).toBeVisible()
    } )

    test( `records a press-and-hold clip with browser media`, async ( { context, page } ) => {
        await context.grantPermissions( [ `camera`, `microphone` ] )
        await page.goto( `/projects` )
        await page.getByRole( `button`, { name: `New` } ).click()

        const record_button = page.getByRole( `button`, { name: `Record clip` } )
        await expect( record_button ).toBeVisible()

        const button_box = await record_button.boundingBox()
        const button_center = {
            x: button_box.x + button_box.width / 2,
            y: button_box.y + button_box.height / 2
        }

        await page.mouse.move( button_center.x, button_center.y )
        await page.mouse.down()
        await expect( page.getByRole( `button`, { name: `Stop recording` } ) ).toBeVisible()
        await page.waitForTimeout( 900 )
        await page.mouse.up()

        await expect( page.getByText( `Clip 1` ) ).toBeVisible()
        await expect( page.getByRole( `button`, { name: `Record clip` } ) ).toBeVisible()
    } )

    test( `exports, downloads, renames, and deletes a browser-recorded project`, async ( { context, page } ) => {
        await context.grantPermissions( [ `camera`, `microphone` ] )
        await page.goto( `/projects` )
        await page.getByRole( `button`, { name: `New` } ).click()

        await page.getByRole( `button`, { name: `Record clip` } ).click()
        await page.waitForTimeout( 900 )
        await page.getByRole( `button`, { name: `Stop recording` } ).click()

        await expect( page.getByText( `Clip 1` ) ).toBeVisible()

        await page.getByRole( `button`, { name: `Preview clip 1` } ).click()
        await expect( page.getByRole( `dialog`, { name: `Clip preview` } ) ).toBeVisible()
        await page.getByRole( `button`, { name: `Close preview` } ).click()

        await page.getByRole( `button`, { name: `Share or export project` } ).first().click()
        await expect( page.getByRole( `dialog`, { name: `Export video` } ) ).toBeVisible()
        await expect( page.getByText( /Export is ready/ ).first() ).toBeVisible( {
            timeout: 30_000
        } )

        const download_promise = page.waitForEvent( `download` )

        await page.getByRole( `button`, { name: `Download` } ).click()

        const download = await download_promise

        expect( download.suggestedFilename() ).toMatch( /\.(webm|mp4)$/ )

        await page.getByRole( `button`, { name: `Close export panel` } ).click()
        await page.getByRole( `button`, { name: `Open projects` } ).click()

        await expect( page.locator( `article` ).filter( {
            hasText: `Export ready`
        } ).first() ).toBeVisible()

        await page.getByRole( `button`, { name: /Rename/ } ).first().click()
        await page.getByLabel( `Project title` ).fill( `Browser Smoke Project` )
        await page.getByLabel( `Project title` ).press( `Enter` )

        await expect( page.getByRole( `button`, { name: `Open Browser Smoke Project` } ) ).toBeVisible()

        page.once( `dialog`, ( dialog ) => dialog.accept() )
        await page.getByRole( `button`, { name: `Delete Browser Smoke Project` } ).click()

        await expect( page.getByText( `No projects yet` ) ).toBeVisible()
    } )

    test( `shows recovery guidance when camera permission is denied`, async ( { page } ) => {
        await page.addInitScript( () => {
            Object.defineProperty( navigator, `permissions`, {
                configurable: true,
                value: {
                    query: ( { name } ) => Promise.resolve( {
                        state: name === `camera` ? `denied` : `prompt`
                    } )
                }
            } )
        } )

        await page.goto( `/projects` )
        await page.getByRole( `button`, { name: `New` } ).click()

        await expect( page.getByText( /Camera access is blocked/ ) ).toBeVisible()
        await expect( page.getByRole( `link`, { name: `Open settings` } ) ).toHaveAttribute( `href`, /\/settings\?return_to=/ )
    } )

    test( `keeps video-only recording available when microphone permission is denied`, async ( { page } ) => {
        await page.addInitScript( () => {
            Object.defineProperty( navigator, `permissions`, {
                configurable: true,
                value: {
                    query: ( { name } ) => Promise.resolve( {
                        state: name === `microphone` ? `denied` : `granted`
                    } )
                }
            } )
        } )

        await page.goto( `/projects` )
        await page.getByRole( `button`, { name: `New` } ).click()

        await expect( page.getByText( /Recording can continue video-only/ ) ).toBeVisible()
        await expect( page.getByRole( `button`, { name: `Record clip` } ) ).toBeEnabled()
    } )

    test( `opens settings with storage and export controls`, async ( { page } ) => {
        await page.goto( `/projects` )
        await page.getByRole( `button`, { name: `Open settings` } ).first().click()

        await expect( page.getByRole( `heading`, { name: `Settings` } ) ).toBeVisible()
        await expect( page.getByText( /stored locally in this browser/ ) ).toBeVisible()
        await expect( page.getByRole( `button`, { name: `Delete all local data` } ) ).toBeVisible()
        await expect( page.getByRole( `heading`, { name: `Export`, exact: true } ) ).toBeVisible()
    } )
} )
