import { expect, test } from '@playwright/test'
import fs from 'node:fs/promises'
import {
    fake_video_capture_height,
    fake_video_capture_width
} from './fake_media.js'

const browser_issue_types = new Set( [ `warning`, `error` ] )
const same_origin = `http://127.0.0.1:5173`

const ensure_service_worker_controlled = async ( page ) => {
    const controlled = await page.evaluate( async () => {
        if( !( `serviceWorker` in navigator ) ) throw new Error( `Service worker is unavailable.` )

        await navigator.serviceWorker.ready

        if( navigator.serviceWorker.controller ) return true

        await Promise.race( [
            new Promise( ( resolve ) => {
                navigator.serviceWorker.addEventListener( `controllerchange`, resolve, { once: true } )
            } ),
            new Promise( ( resolve ) => setTimeout( resolve, 1000 ) )
        ] )

        return Boolean( navigator.serviceWorker.controller )
    } )

    if( controlled ) return

    await page.reload()
    await expect.poll( () => page.evaluate( () => Boolean( navigator.serviceWorker.controller ) ) ).toBe( true )
}

const record_clip_for = async ( page, duration_ms ) => {
    await page.getByRole( `button`, { name: `Record clip` } ).click()
    await expect( page.getByRole( `button`, { name: `Stop recording` } ) ).toBeVisible()
    await page.waitForTimeout( duration_ms )
    await page.getByRole( `button`, { name: `Stop recording` } ).click()
}

const read_playable_video_metadata = async ( page, {
    base64 = null,
    clip_blob = false,
    export_blob = false,
    mime_type = `video/webm`
} = {} ) => {
    return page.evaluate( async ( options ) => {
        const request_to_promise = ( request ) => new Promise( ( resolve, reject ) => {
            request.onsuccess = () => resolve( request.result )
            request.onerror = () => reject( request.error )
        } )
        const read_blob_metadata = ( blob ) => new Promise( ( resolve, reject ) => {
            const video = document.createElement( `video` )
            const object_url = URL.createObjectURL( blob )
            let settled = false
            let timeout_id = null
            const cleanup = () => {
                window.clearTimeout( timeout_id )
                video.pause()
                video.removeAttribute( `src` )
                video.load()
                URL.revokeObjectURL( object_url )
            }
            const finish = () => {
                if( settled ) return

                settled = true
                const metadata = {
                    duration_ms: Number.isFinite( video.duration ) ? Math.round( video.duration * 1000 ) : null,
                    playback_time_ms: Math.round( video.currentTime * 1000 ),
                    ready_state: video.readyState,
                    width: video.videoWidth,
                    height: video.videoHeight,
                    size: blob.size,
                    type: blob.type
                }

                cleanup()
                resolve( metadata )
            }
            const fail = ( error ) => {
                if( settled ) return

                settled = true
                cleanup()
                reject( error )
            }
            const wait_for_playback = () => {
                if( settled ) return

                if( video.currentTime > 0.04 || video.ended ) {
                    finish()
                    return
                }

                window.setTimeout( wait_for_playback, 60 )
            }

            video.muted = true
            video.playsInline = true
            video.preload = `auto`
            video.onerror = () => {
                fail( new Error( `Video blob could not be decoded.` ) )
            }
            video.onloadedmetadata = async () => {
                try {
                    await video.play()
                    wait_for_playback()
                } catch ( error ) {
                    fail( error )
                }
            }
            timeout_id = window.setTimeout( () => {
                fail( new Error( `Timed out while decoding video metadata.` ) )
            }, 5_000 )
            video.src = object_url
        } )

        if( options.clip_blob || options.export_blob ) {
            const database = await new Promise( ( resolve, reject ) => {
                const request = indexedDB.open( `daily_video_journal` )
                request.onsuccess = () => resolve( request.result )
                request.onerror = () => reject( request.error )
            } )

            try {
                if( options.export_blob ) {
                    const transaction = database.transaction( [ `exports`, `export_blobs` ], `readonly` )
                    const exports = await request_to_promise( transaction.objectStore( `exports` ).getAll() )
                    const [ latest_export = null ] = exports
                        .sort( ( first, second ) => new Date( first.created_at ).getTime() - new Date( second.created_at ).getTime() )
                        .slice( -1 )
                    const latest_export_blob_record = latest_export
                        ? await request_to_promise( transaction.objectStore( `export_blobs` ).get( latest_export.id ) )
                        : null

                    if( !latest_export_blob_record?.blob ) throw new Error( `No compiled export blob found.` )

                    return read_blob_metadata( latest_export_blob_record.blob )
                }

                const transaction = database.transaction( [ `clips`, `clip_blobs` ], `readonly` )
                const clips = await request_to_promise( transaction.objectStore( `clips` ).getAll() )
                const [ latest_clip = null ] = clips
                    .filter( ( { deleted_at } ) => !deleted_at )
                    .sort( ( first, second ) => new Date( first.created_at ).getTime() - new Date( second.created_at ).getTime() )
                    .slice( -1 )
                const latest_clip_blob_record = latest_clip
                    ? await request_to_promise( transaction.objectStore( `clip_blobs` ).get( latest_clip.id ) )
                    : null

                if( !latest_clip_blob_record?.blob ) throw new Error( `No recorded clip blob found.` )

                const metadata = await read_blob_metadata( latest_clip_blob_record.blob )

                return {
                    ...metadata,
                    stored_duration_ms: latest_clip.duration_ms,
                    stored_height: latest_clip.height,
                    stored_width: latest_clip.width
                }
            } finally {
                database.close()
            }
        }

        const binary = atob( options.base64 )
        const bytes = new Uint8Array( binary.length )

        Array.from( binary ).forEach( ( character, index ) => {
            bytes[ index ] = character.charCodeAt( 0 )
        } )

        return read_blob_metadata( new Blob( [ bytes ], { type: options.mime_type } ) )
    }, {
        base64,
        clip_blob,
        export_blob,
        mime_type
    } )
}

const read_downloaded_file_size = async ( download ) => {
    const download_path = await download.path()
    const download_buffer = await fs.readFile( download_path )

    return download_buffer.length
}

const expect_fake_capture_video = ( metadata ) => {
    const duration_ms = metadata.duration_ms ?? metadata.stored_duration_ms ?? metadata.playback_time_ms

    expect( metadata.size ).toBeGreaterThan( 1_000 )
    expect( metadata.width ).toBe( fake_video_capture_width )
    expect( metadata.height ).toBe( fake_video_capture_height )
    expect( metadata.ready_state ).toBeGreaterThanOrEqual( 2 )
    expect( metadata.playback_time_ms ).toBeGreaterThan( 40 )
    expect( duration_ms ).toBeGreaterThan( 400 )
}

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
    page.on( `request`, ( request ) => {
        const url = new URL( request.url() )

        if( [ `http:`, `https:` ].includes( url.protocol ) && url.origin !== same_origin ) {
            page.browser_issues.push( {
                kind: `offorigin`,
                url: request.url()
            } )
        }
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

        await page.getByRole( `button`, { name: `Create Project` } ).click()

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

        await page.getByRole( `button`, { name: `Create Project` } ).click()

        await expect( page ).toHaveURL( /\/projects\/[^/]+$/ )
        await expect( page.getByText( `Press record to open the camera and save the next clip.` ) ).toBeVisible()
        await expect.poll( () => page.evaluate( () => window.__get_user_media_calls.length ) ).toBe( 0 )

        const active_capture_url = page.url()

        await page.goto( `/` )

        await expect( page ).toHaveURL( active_capture_url )
        await expect.poll( () => page.evaluate( () => window.__get_user_media_calls.length ) ).toBe( 0 )
    } )

    test( `keeps bottom capture actions stable at the viewport edge`, async ( { page } ) => {
        await page.goto( `/projects` )
        await page.getByRole( `button`, { name: `Create Project` } ).click()

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
        await page.getByRole( `button`, { name: `Create Project` } ).click()

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
        await page.getByRole( `button`, { name: `Create Project` } ).click()

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

    test( `moves recorded clips and keeps queue order after reload`, async ( { context, page } ) => {
        await context.grantPermissions( [ `camera`, `microphone` ] )
        await page.goto( `/projects` )
        await page.getByRole( `button`, { name: `Create Project` } ).click()

        await record_clip_for( page, 700 )
        await expect( page.getByText( `Clip 1` ) ).toBeVisible()

        await record_clip_for( page, 1700 )
        await expect( page.getByText( `Clip 2` ) ).toBeVisible()

        const clip_rows = page.locator( `article` ).filter( {
            hasText: /Clip [12]/
        } )
        const capture_url = page.url()

        await expect( clip_rows ).toHaveCount( 2 )
        await expect( clip_rows.nth( 0 ) ).toContainText( `1s` )
        await expect( clip_rows.nth( 1 ) ).toContainText( `2s` )

        await page.getByRole( `button`, { name: `Move clip 2 earlier` } ).click()

        await expect( clip_rows.nth( 0 ) ).toContainText( `2s` )
        await expect( clip_rows.nth( 1 ) ).toContainText( `1s` )

        await page.reload()
        await expect( page ).toHaveURL( capture_url )
        await expect( clip_rows ).toHaveCount( 2 )
        await expect( clip_rows.nth( 0 ) ).toContainText( `2s` )
        await expect( clip_rows.nth( 1 ) ).toContainText( `1s` )
    } )

    test( `records deterministic fake video, exports, downloads, renames, and deletes a project`, async ( { context, page } ) => {
        await page.addInitScript( () => {
            const native_share_calls = []

            Object.defineProperty( window, `__native_share_calls`, {
                configurable: true,
                value: native_share_calls
            } )
            Object.defineProperty( navigator, `canShare`, {
                configurable: true,
                value: ( share_data ) => {
                    const [ file = null ] = share_data.files ?? []

                    native_share_calls.push( {
                        kind: `canShare`,
                        file_name: file?.name ?? null,
                        file_type: file?.type ?? null
                    } )

                    return Boolean( file )
                }
            } )
            Object.defineProperty( navigator, `share`, {
                configurable: true,
                value: async ( share_data ) => {
                    const [ file = null ] = share_data.files ?? []

                    native_share_calls.push( {
                        kind: `share`,
                        file_name: file?.name ?? null,
                        file_type: file?.type ?? null,
                        title: share_data.title ?? null
                    } )

                    throw new DOMException( `Share cancelled`, `AbortError` )
                }
            } )
        } )
        await context.grantPermissions( [ `camera`, `microphone` ] )
        await page.goto( `/projects` )
        await page.getByRole( `button`, { name: `Create Project` } ).click()

        await page.getByRole( `button`, { name: `Record clip` } ).click()
        await page.waitForTimeout( 900 )
        await page.getByRole( `button`, { name: `Stop recording` } ).click()

        await expect( page.getByText( `Clip 1` ) ).toBeVisible()
        await expect.poll( async () => {
            const metadata = await read_playable_video_metadata( page, {
                clip_blob: true
            } )

            return metadata.width
        } ).toBe( fake_video_capture_width )

        expect_fake_capture_video( await read_playable_video_metadata( page, {
            clip_blob: true
        } ) )

        await page.getByRole( `button`, { name: `Preview clip 1` } ).click()
        await expect( page.getByRole( `dialog`, { name: `Clip preview` } ) ).toBeVisible()
        await page.getByRole( `button`, { name: `Close preview` } ).click()

        await page.getByRole( `button`, { name: `Share or export project` } ).first().click()
        await expect( page.getByRole( `dialog`, { name: `Export video` } ) ).toBeVisible()
        await expect( page.getByText( /Export is ready/ ).first() ).toBeVisible( {
            timeout: 30_000
        } )
        await expect.poll( async () => {
            const metadata = await read_playable_video_metadata( page, {
                export_blob: true
            } )

            return metadata.width
        } ).toBe( fake_video_capture_width )

        expect_fake_capture_video( await read_playable_video_metadata( page, {
            export_blob: true
        } ) )

        await page.getByRole( `button`, { name: `Share`, exact: true } ).click()
        await expect.poll( () => page.evaluate( () => {
            return window.__native_share_calls.filter( ( { kind } ) => kind === `share` ).length
        } ) ).toBe( 1 )

        const [ share_call ] = await page.evaluate( () => {
            return window.__native_share_calls.filter( ( { kind } ) => kind === `share` )
        } )

        expect( share_call.title ).toBeTruthy()
        expect( share_call.file_name ).toMatch( /\.(webm|mp4)$/ )
        expect( share_call.file_type ).toMatch( /^video\// )

        const download_promise = page.waitForEvent( `download` )

        await page.getByRole( `button`, { name: `Download` } ).click()

        const download = await download_promise

        expect( download.suggestedFilename() ).toMatch( /\.(webm|mp4)$/ )
        expect( await read_downloaded_file_size( download ) ).toBeGreaterThan( 1_000 )

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
        await page.getByRole( `button`, { name: `Create Project` } ).click()

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
        await page.getByRole( `button`, { name: `Create Project` } ).click()

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

    test( `shows low-storage and persistence status from browser storage estimates`, async ( { page } ) => {
        await page.addInitScript( () => {
            Object.defineProperty( navigator, `storage`, {
                configurable: true,
                value: {
                    estimate: () => Promise.resolve( {
                        usage: 900,
                        quota: 1000
                    } ),
                    persisted: () => Promise.resolve( false ),
                    persist: () => Promise.resolve( false )
                }
            } )
        } )

        await page.goto( `/projects` )
        await page.getByRole( `button`, { name: `Create Project` } ).click()

        await expect( page.getByText( /Local browser storage is almost full/ ) ).toBeVisible()

        const capture_path = new URL( page.url() ).pathname

        await page.goto( `/settings?return_to=${ encodeURIComponent( capture_path ) }` )

        await expect( page.getByText( /Local browser storage is almost full/ ) ).toBeVisible()
        await expect( page.getByText( `900 B used of 1000 B` ) ).toBeVisible()
        await expect( page.getByText( `Persistent storage not granted` ) ).toBeVisible()
    } )

    test( `persists settings changes and deletes all local data`, async ( { page } ) => {
        await page.goto( `/projects` )
        await page.getByRole( `button`, { name: `Create Project` } ).click()
        await expect( page.getByText( `Press record to open the camera and save the next clip.` ) ).toBeVisible()

        await page.getByRole( `button`, { name: `Open projects` } ).click()
        await page.getByRole( `button`, { name: `Open settings` } ).first().click()

        await expect( page.getByRole( `heading`, { name: `Settings` } ) ).toBeVisible()
        await expect( page.getByLabel( `Haptics` ) ).toBeChecked()
        await expect( page.getByLabel( `Sound feedback` ) ).not.toBeChecked()

        await page.getByLabel( `Haptics` ).click()
        await page.getByLabel( `Sound feedback` ).click()
        await expect( page.getByLabel( `Haptics` ) ).not.toBeChecked()
        await expect( page.getByLabel( `Sound feedback` ) ).toBeChecked()
        await page.waitForTimeout( 120 )
        await page.reload()

        await expect( page.getByRole( `heading`, { name: `Settings` } ) ).toBeVisible()
        await expect( page.getByLabel( `Haptics` ) ).not.toBeChecked()
        await expect( page.getByLabel( `Sound feedback` ) ).toBeChecked()

        page.once( `dialog`, ( dialog ) => dialog.accept() )
        await page.getByRole( `button`, { name: `Delete all local data` } ).click()

        await expect( page ).toHaveURL( /\/projects$/ )
        await expect( page.getByText( `No projects yet` ) ).toBeVisible()

        await page.goto( `/` )
        await expect( page ).toHaveURL( /\/projects$/ )
    } )

    test( `starts from the cached app shell while offline`, async ( { context, page } ) => {
        await page.goto( `/projects` )
        await expect( page.getByRole( `heading`, { name: `Projects`, exact: true } ) ).toBeVisible()

        await ensure_service_worker_controlled( page )

        await context.setOffline( true )
        await page.goto( `/projects/offline-startup-check` )

        await expect( page.getByRole( `heading`, { name: `Projects`, exact: true } ) ).toBeVisible()
    } )

    test( `reopens the active project from the cached app shell while offline`, async ( { context, page } ) => {
        await page.goto( `/projects` )
        await page.getByRole( `button`, { name: `Create Project` } ).click()
        await expect( page.getByText( `Press record to open the camera and save the next clip.` ) ).toBeVisible()

        const capture_path = new URL( page.url() ).pathname

        await ensure_service_worker_controlled( page )

        await context.setOffline( true )
        await page.goto( `/` )

        await expect( page ).toHaveURL( new RegExp( `${ capture_path }$` ) )
        await expect( page.getByRole( `button`, { name: `Record clip` } ) ).toBeVisible()
    } )
} )
