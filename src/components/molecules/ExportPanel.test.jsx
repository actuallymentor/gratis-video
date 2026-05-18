/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExportPanel } from './ExportPanel.jsx'
import {
    compile_project_export,
    normalize_export_settings
} from '../../modules/export/exporter.js'
import {
    delete_export,
    get_export_blob,
    get_project_clips,
    is_valid_export_blob,
    load_settings,
    save_export_record
} from '../../modules/storage/journal_storage.js'
import {
    download_export_file,
    share_export_file
} from '../../modules/sharing/share.js'
import { useAppStore } from '../../stores/app_store.js'

vi.mock( 'react-hot-toast', () => {
    const toast = vi.fn()
    toast.error = vi.fn()
    toast.success = vi.fn()

    return { default: toast }
} )

vi.mock( '../../modules/export/exporter.js', () => ( {
    compile_project_export: vi.fn(),
    normalize_export_settings: vi.fn( ( settings ) => settings )
} ) )

vi.mock( '../../modules/storage/journal_storage.js', () => ( {
    delete_export: vi.fn(),
    get_export_blob: vi.fn(),
    get_project_clips: vi.fn(),
    is_valid_export_blob: vi.fn(),
    load_settings: vi.fn(),
    make_export_filename: vi.fn( () => `may-17-2026.webm` ),
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
        vi.mocked( get_project_clips ).mockResolvedValue( clips )
        vi.mocked( is_valid_export_blob ).mockImplementation( ( export_record, blob ) => {
            return Boolean( export_record?.mime_type?.startsWith( `video/` ) && blob?.size > 0 )
        } )
        vi.mocked( load_settings ).mockResolvedValue( settings )
        vi.mocked( normalize_export_settings ).mockImplementation( ( settings ) => settings )
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
        expect( get_export_blob ).not.toHaveBeenCalled()
    } )

    test( `shows export failure without exposing share or download actions`, async () => {
        vi.mocked( compile_project_export ).mockRejectedValue( new Error( `Encoder failed` ) )

        render( <ExportPanel
            project={ project }
            clips={ clips }
            settings={ settings }
            on_close={ vi.fn() }
        /> )

        expect( await screen.findByText( `Encoder failed` ) ).toBeTruthy()
        expect( screen.queryByRole( `button`, { name: `Share` } ) ).toBe( null )
        expect( screen.queryByRole( `button`, { name: `Download` } ) ).toBe( null )
        expect( save_export_record ).not.toHaveBeenCalled()
        expect( download_export_file ).not.toHaveBeenCalled()
        expect( useAppStore.getState().export_progress ).toEqual( {
            active: false,
            percent: 0,
            message: `Export failed`
        } )
    } )

    test( `loads a cached export blob before enabling fresh share actions`, async () => {
        const user = userEvent.setup()
        const blob_deferred = make_deferred()

        vi.mocked( get_export_blob ).mockReturnValue( blob_deferred.promise )

        render( <ExportPanel
            project={ project }
            clips={ clips }
            settings={ settings }
            initial_export_record={ saved_export }
            on_close={ vi.fn() }
        /> )

        expect( await screen.findByText( /Preparing export actions/ ) ).toBeTruthy()
        expect( screen.queryByRole( `button`, { name: `Share` } ) ).toBe( null )

        await act( async () => {
            blob_deferred.resolve( compiled_export.blob )
            await blob_deferred.promise
        } )

        await user.click( await screen.findByRole( `button`, { name: `Share` } ) )

        expect( share_export_file ).toHaveBeenCalledWith( {
            project,
            export_record: saved_export,
            blob: compiled_export.blob
        } )
    } )

    test( `compiles a fresh export when cached export blob is missing`, async () => {
        vi.mocked( get_export_blob ).mockResolvedValueOnce( null )

        render( <ExportPanel
            project={ project }
            clips={ clips }
            settings={ settings }
            initial_export_record={ saved_export }
            on_close={ vi.fn() }
        /> )

        expect( await screen.findByText( /Export is ready/ ) ).toBeTruthy()
        expect( delete_export ).toHaveBeenCalledWith( saved_export.id )
        expect( compile_project_export ).toHaveBeenCalledWith( expect.objectContaining( {
            clips,
            settings,
            signal: expect.any( AbortSignal )
        } ) )
        expect( save_export_record ).toHaveBeenCalledWith( expect.objectContaining( {
            project_id: project.id,
            blob: compiled_export.blob
        } ) )
    } )

    test( `compiles a fresh export when cached export blob is invalid`, async () => {
        vi.mocked( get_export_blob ).mockResolvedValueOnce( new Blob( [], { type: `video/webm` } ) )

        render( <ExportPanel
            project={ project }
            clips={ clips }
            settings={ settings }
            initial_export_record={ saved_export }
            on_close={ vi.fn() }
        /> )

        expect( await screen.findByText( /Export is ready/ ) ).toBeTruthy()
        expect( delete_export ).toHaveBeenCalledWith( saved_export.id )
        expect( compile_project_export ).toHaveBeenCalledWith( expect.objectContaining( {
            clips,
            settings,
            signal: expect.any( AbortSignal )
        } ) )
    } )

    test( `downloads from the ready share action when native file sharing is unavailable`, async () => {
        const user = userEvent.setup()

        vi.mocked( share_export_file ).mockResolvedValue( `unsupported` )

        render( <ExportPanel
            project={ project }
            clips={ clips }
            settings={ settings }
            initial_export_record={ saved_export }
            on_close={ vi.fn() }
        /> )

        await user.click( await screen.findByRole( `button`, { name: `Share` } ) )

        expect( download_export_file ).toHaveBeenCalledWith( saved_export, compiled_export.blob )
    } )

    test( `downloads from the ready share action when native sharing fails`, async () => {
        const user = userEvent.setup()

        vi.mocked( share_export_file ).mockRejectedValue( new Error( `Share target failed` ) )

        render( <ExportPanel
            project={ project }
            clips={ clips }
            settings={ settings }
            initial_export_record={ saved_export }
            on_close={ vi.fn() }
        /> )

        await user.click( await screen.findByRole( `button`, { name: `Share` } ) )

        expect( download_export_file ).toHaveBeenCalledWith( saved_export, compiled_export.blob )
    } )

    test( `downloads directly from a ready export`, async () => {
        const user = userEvent.setup()

        render( <ExportPanel
            project={ project }
            clips={ clips }
            settings={ settings }
            initial_export_record={ saved_export }
            on_close={ vi.fn() }
        /> )

        await user.click( await screen.findByRole( `button`, { name: `Download` } ) )

        expect( download_export_file ).toHaveBeenCalledWith( saved_export, compiled_export.blob )
    } )

    test( `only aborts compile work from the explicit cancel action`, async () => {
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

        expect( await screen.findByRole( `progressbar`, { name: `Export progress` } ) ).toBeTruthy()
        expect( screen.queryByRole( `button`, { name: `Close export panel` } ) ).toBe( null )

        await user.keyboard( `{Escape}` )

        expect( export_signal.aborted ).toBe( false )
        expect( on_close ).not.toHaveBeenCalled()

        await user.click( screen.getByRole( `button`, { name: `Cancel export` } ) )

        expect( export_signal.aborted ).toBe( true )
        expect( on_close ).toHaveBeenCalledTimes( 1 )
        expect( save_export_record ).not.toHaveBeenCalled()
    } )

    test( `keeps shared export progress state complete during compilation`, async () => {
        const deferred_export = make_deferred()

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

            return deferred_export.promise
        } )

        render( <ExportPanel
            project={ project }
            clips={ clips }
            settings={ settings }
            on_close={ vi.fn() }
        /> )

        expect( ( await screen.findByRole( `progressbar`, { name: `Export progress` } ) ).getAttribute( `aria-valuenow` ) ).toBe( `42` )

        await act( async () => {
            deferred_export.resolve( compiled_export )
            await deferred_export.promise
        } )

        expect( await screen.findByText( /Export is ready/ ) ).toBeTruthy()
    } )

    test( `does not restart compilation when background clip metadata refreshes`, async () => {
        const deferred_export = make_deferred()

        vi.mocked( compile_project_export ).mockReturnValue( deferred_export.promise )

        const { rerender } = render( <ExportPanel
            project={ project }
            clips={ clips }
            settings={ settings }
            on_close={ vi.fn() }
        /> )

        await waitFor( () => {
            expect( compile_project_export ).toHaveBeenCalledTimes( 1 )
        } )

        rerender( <ExportPanel
            project={ project }
            clips={ [ {
                ...clips[ 0 ],
                duration_ms: 1300,
                width: 1280,
                height: 720,
                updated_at: `2026-05-17T10:00:03.000Z`
            } ] }
            settings={ settings }
            on_close={ vi.fn() }
        /> )

        expect( compile_project_export ).toHaveBeenCalledTimes( 1 )

        await act( async () => {
            deferred_export.resolve( compiled_export )
            await deferred_export.promise
        } )

        expect( await screen.findByText( /Export is ready/ ) ).toBeTruthy()
        expect( save_export_record ).toHaveBeenCalledTimes( 1 )
    } )

    test( `keeps a compiled export downloadable when caching fails`, async () => {
        const user = userEvent.setup()
        const on_export_ready = vi.fn()

        vi.mocked( save_export_record ).mockRejectedValue( new DOMException( `Quota full`, `QuotaExceededError` ) )
        vi.mocked( share_export_file ).mockResolvedValue( `unsupported` )

        render( <ExportPanel
            project={ project }
            clips={ clips }
            settings={ settings }
            on_export_ready={ on_export_ready }
            on_close={ vi.fn() }
        /> )

        expect( await screen.findByText( /local browser storage is full/ ) ).toBeTruthy()

        await user.click( screen.getByRole( `button`, { name: `Download` } ) )
        await user.click( screen.getByRole( `button`, { name: `Share` } ) )

        expect( on_export_ready ).not.toHaveBeenCalled()
        expect( download_export_file ).toHaveBeenCalledWith(
            expect.objectContaining( {
                filename: `may-17-2026.webm`,
                transient: true
            } ),
            compiled_export.blob
        )
        expect( share_export_file ).toHaveBeenCalledWith( {
            project,
            export_record: expect.objectContaining( { transient: true } ),
            blob: compiled_export.blob
        } )
    } )

    test( `does not expose a stale export when the project disappears before caching`, async () => {
        vi.mocked( save_export_record ).mockRejectedValue( new Error( `Project not found.` ) )

        render( <ExportPanel
            project={ project }
            clips={ clips }
            settings={ settings }
            on_close={ vi.fn() }
        /> )

        expect( await screen.findByText( /Project not found/ ) ).toBeTruthy()
        expect( screen.queryByRole( `button`, { name: `Share` } ) ).toBe( null )
        expect( screen.queryByRole( `button`, { name: `Download` } ) ).toBe( null )
    } )

    test( `does not expose a stale export when transactional cache validation fails`, async () => {
        vi.mocked( save_export_record ).mockRejectedValue(
            new Error( `Project changed before export could be cached. Start the export again.` )
        )

        render( <ExportPanel
            project={ project }
            clips={ clips }
            settings={ settings }
            on_close={ vi.fn() }
        /> )

        expect( await screen.findByText( /Project changed before export could be cached/ ) ).toBeTruthy()
        expect( screen.queryByRole( `button`, { name: `Share` } ) ).toBe( null )
        expect( screen.queryByRole( `button`, { name: `Download` } ) ).toBe( null )
    } )

    test( `uses the latest cached export metadata after the initial export changes`, async () => {
        const user = userEvent.setup()
        const first_export = {
            ...saved_export,
            id: `export-a`,
            filename: `first.webm`
        }
        const second_export = {
            ...saved_export,
            id: `export-b`,
            filename: `second.webm`
        }
        const first_blob = new Blob( [ `first` ], { type: `video/webm` } )
        const second_blob = new Blob( [ `second` ], { type: `video/webm` } )
        const second_blob_deferred = make_deferred()

        vi.mocked( get_export_blob )
            .mockResolvedValueOnce( first_blob )
            .mockReturnValueOnce( second_blob_deferred.promise )

        const { rerender } = render( <ExportPanel
            project={ project }
            clips={ clips }
            settings={ settings }
            initial_export_record={ first_export }
            on_close={ vi.fn() }
        /> )

        expect( await screen.findByRole( `button`, { name: `Share` } ) ).toBeTruthy()

        rerender( <ExportPanel
            project={ project }
            clips={ clips }
            settings={ settings }
            initial_export_record={ second_export }
            on_close={ vi.fn() }
        /> )

        expect( await screen.findByText( /Preparing export actions/ ) ).toBeTruthy()

        await act( async () => {
            second_blob_deferred.resolve( second_blob )
            await second_blob_deferred.promise
        } )

        await user.click( await screen.findByRole( `button`, { name: `Share` } ) )

        expect( share_export_file ).toHaveBeenLastCalledWith( {
            project,
            export_record: second_export,
            blob: second_blob
        } )
    } )

    test( `does not cache an export when project inputs change during compilation`, async () => {
        vi.mocked( get_project_clips ).mockResolvedValue( [
            {
                ...clips[ 0 ],
                version: 2,
                updated_at: `2026-05-17T10:00:03.000Z`
            }
        ] )

        render( <ExportPanel
            project={ project }
            clips={ clips }
            settings={ settings }
            on_close={ vi.fn() }
        /> )

        expect( await screen.findByText( /Project changed while the export was compiling/ ) ).toBeTruthy()
        expect( save_export_record ).not.toHaveBeenCalled()
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

    test( `clears active progress when an in-flight export unmounts`, async () => {
        vi.mocked( compile_project_export ).mockImplementation( ( { signal } ) => {
            return new Promise( ( resolve, reject ) => {
                signal.addEventListener( `abort`, () => {
                    reject( new DOMException( `Cancelled`, `AbortError` ) )
                } )
            } )
        } )

        const { unmount } = render( <ExportPanel
            project={ project }
            clips={ clips }
            settings={ settings }
            on_close={ vi.fn() }
        /> )

        expect( await screen.findByRole( `progressbar`, { name: `Export progress` } ) ).toBeTruthy()

        unmount()

        await waitFor( () => {
            expect( useAppStore.getState().export_progress ).toEqual( {
                active: false,
                percent: 0,
                message: `Export cancelled`
            } )
        } )
    } )
} )
