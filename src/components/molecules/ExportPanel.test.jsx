/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExportPanel } from './ExportPanel.jsx'
import { compile_project_export } from '../../modules/export/exporter.js'
import {
    delete_export,
    get_export_blob,
    save_export_record
} from '../../modules/storage/journal_storage.js'
import { share_export_file } from '../../modules/sharing/share.js'
import { useAppStore } from '../../stores/app_store.js'

vi.mock( 'react-hot-toast', () => {
    const toast = vi.fn()
    toast.error = vi.fn()
    toast.success = vi.fn()

    return { default: toast }
} )

vi.mock( '../../modules/export/exporter.js', () => ( {
    compile_project_export: vi.fn()
} ) )

vi.mock( '../../modules/storage/journal_storage.js', () => ( {
    delete_export: vi.fn(),
    get_export_blob: vi.fn(),
    save_export_record: vi.fn()
} ) )

vi.mock( '../../modules/sharing/share.js', () => ( {
    download_export_file: vi.fn(),
    share_export_file: vi.fn()
} ) )

const project = {
    id: `project-1`,
    title: `May 17, 2026`
}

const clips = [
    {
        id: `clip-1`,
        order_index: 0,
        mime_type: `video/webm`,
        duration_ms: 1200,
        width: 640,
        height: 360,
        created_at: `2026-05-17T10:00:00.000Z`
    }
]

const settings = {
    export_quality: `standard`,
    export_resolution: `source`,
    preferred_mime_type: null
}

const compiled_export = {
    blob: new Blob( [ `compiled` ], { type: `video/webm` } ),
    mime_type: `video/webm`,
    duration_ms: 1200
}

const saved_export = {
    id: `export-1`,
    project_id: project.id,
    filename: `may-17-2026.webm`,
    mime_type: `video/webm`,
    settings_hash: `settings`,
    clip_manifest_hash: `clips`
}

const make_deferred = () => {
    let resolve
    let reject
    const promise = new Promise( ( promise_resolve, promise_reject ) => {
        resolve = promise_resolve
        reject = promise_reject
    } )

    return { promise, resolve, reject }
}

describe( `export panel`, () => {
    beforeEach( () => {
        vi.mocked( compile_project_export ).mockResolvedValue( compiled_export )
        vi.mocked( delete_export ).mockResolvedValue()
        vi.mocked( get_export_blob ).mockResolvedValue( compiled_export.blob )
        vi.mocked( save_export_record ).mockResolvedValue( saved_export )
        vi.mocked( share_export_file ).mockResolvedValue( `shared` )
        useAppStore.setState( {
            export_progress: {
                active: false,
                percent: 0,
                message: `Idle`
            }
        } )
    } )

    afterEach( () => {
        cleanup()
        vi.resetAllMocks()
    } )

    test( `compiles on explicit panel open and shares from the ready action`, async () => {
        const user = userEvent.setup()

        render( <ExportPanel
            project={ project }
            clips={ clips }
            settings={ settings }
            on_close={ vi.fn() }
        /> )

        expect( await screen.findByText( /Export is ready/ ) ).toBeTruthy()

        await user.click( screen.getByRole( `button`, { name: `Share` } ) )

        expect( compile_project_export ).toHaveBeenCalledWith( expect.objectContaining( {
            clips,
            settings,
            signal: expect.any( AbortSignal )
        } ) )
        expect( save_export_record ).toHaveBeenCalledWith( expect.objectContaining( {
            project_id: project.id,
            blob: compiled_export.blob,
            mime_type: compiled_export.mime_type
        } ) )
        expect( share_export_file ).toHaveBeenCalledWith( {
            project,
            export_record: saved_export,
            blob: compiled_export.blob
        } )
    } )

    test( `aborts compile work when the user cancels`, async () => {
        const user = userEvent.setup()
        const on_close = vi.fn()
        let export_signal = null

        vi.mocked( compile_project_export ).mockImplementation( ( { signal } ) => {
            export_signal = signal
            return new Promise( ( resolve, reject ) => {
                signal.addEventListener( `abort`, () => reject( new DOMException( `Cancelled`, `AbortError` ) ) )
            } )
        } )

        render( <ExportPanel
            project={ project }
            clips={ clips }
            settings={ settings }
            on_close={ on_close }
        /> )

        await user.click( await screen.findByRole( `button`, { name: `Cancel` } ) )

        expect( export_signal.aborted ).toBe( true )
        expect( on_close ).toHaveBeenCalledTimes( 1 )
        expect( save_export_record ).not.toHaveBeenCalled()
    } )

    test( `keeps shared export progress state complete during compilation`, async () => {
        vi.mocked( compile_project_export ).mockImplementation( async ( { on_progress } ) => {
            on_progress( {
                percent: 42,
                message: `Exporting clip 1 of 1`
            } )

            expect( useAppStore.getState().export_progress ).toEqual( {
                active: true,
                percent: 42,
                message: `Exporting clip 1 of 1`
            } )

            return compiled_export
        } )

        render( <ExportPanel
            project={ project }
            clips={ clips }
            settings={ settings }
            on_close={ vi.fn() }
        /> )

        expect( await screen.findByText( /Export is ready/ ) ).toBeTruthy()
    } )

    test( `does not save an obsolete export after the panel unmounts`, async () => {
        const deferred_export = make_deferred()

        vi.mocked( compile_project_export ).mockReturnValue( deferred_export.promise )

        const { unmount } = render( <ExportPanel
            project={ project }
            clips={ clips }
            settings={ settings }
            on_close={ vi.fn() }
        /> )

        await waitFor( () => {
            expect( compile_project_export ).toHaveBeenCalled()
        } )

        unmount()

        await act( async () => {
            deferred_export.resolve( compiled_export )
            await deferred_export.promise
        } )

        expect( save_export_record ).not.toHaveBeenCalled()
    } )
} )
