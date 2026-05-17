import { afterEach, describe, expect, test, vi } from 'vitest'
import {
    check_media_permissions,
    media_status_message
} from './permissions.js'

describe( `permission helpers`, () => {
    afterEach( () => {
        vi.unstubAllGlobals()
    } )

    test( `checks camera and microphone permissions without opening media devices`, async () => {
        const getUserMedia = vi.fn()
        const query = vi.fn()
            .mockResolvedValueOnce( { state: `prompt` } )
            .mockResolvedValueOnce( { state: `granted` } )

        vi.stubGlobal( `isSecureContext`, true )
        vi.stubGlobal( `MediaRecorder`, () => {} )
        vi.stubGlobal( `navigator`, {
            permissions: { query },
            mediaDevices: { getUserMedia }
        } )

        await expect( check_media_permissions() ).resolves.toEqual( {
            camera: `prompt`,
            microphone: `granted`,
            secure_context: true,
            media_devices: `supported`,
            media_recorder: `supported`,
            offline: false
        } )
        expect( query ).toHaveBeenCalledWith( { name: `camera` } )
        expect( query ).toHaveBeenCalledWith( { name: `microphone` } )
        expect( getUserMedia ).not.toHaveBeenCalled()
    } )

    test( `reports unsupported permissions when query rejects`, async () => {
        vi.stubGlobal( `isSecureContext`, false )
        vi.stubGlobal( `navigator`, {
            permissions: { query: vi.fn().mockRejectedValue( new Error( `Unsupported permission` ) ) },
            mediaDevices: {}
        } )

        await expect( check_media_permissions() ).resolves.toMatchObject( {
            camera: `unsupported`,
            microphone: `unsupported`,
            secure_context: false,
            media_devices: `unsupported`
        } )
    } )

    test( `prioritizes actionable media status messages`, () => {
        expect( media_status_message( {
            secure_context: false,
            media_devices: `supported`,
            media_recorder: `supported`,
            camera: `granted`,
            microphone: `granted`
        } ) ).toMatch( /secure browser origin/ )

        expect( media_status_message( {
            secure_context: true,
            media_devices: `supported`,
            media_recorder: `supported`,
            camera: `denied`,
            microphone: `prompt`
        } ) ).toMatch( /Camera access is blocked/ )

        expect( media_status_message( {
            secure_context: true,
            media_devices: `unsupported`,
            media_recorder: `supported`,
            camera: `unsupported`,
            microphone: `unsupported`,
            offline: true
        } ) ).toMatch( /available offline/ )
    } )
} )
