import { expect, test } from '@playwright/test'

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
        await expect( page.getByRole( `link`, { name: `Open settings` } ) ).toHaveAttribute( `href`, `/settings` )
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
