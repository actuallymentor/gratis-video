import { afterEach, describe, expect, test, vi } from 'vitest'
import {
    can_attempt_recording,
    check_media_permissions,
    has_denied_media_permission,
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
            media_devices: `supported`,
            media_recorder: `supported`,
            camera: `granted`,
            microphone: `denied`
        } ) ).toMatch( /video-only/ )

        expect( media_status_message( {
            secure_context: true,
            media_devices: `unsupported`,
            media_recorder: `supported`,
            camera: `unsupported`,
            microphone: `unsupported`,
            offline: true
        } ) ).toMatch( /available offline/ )
    } )

    test( `blocks recording attempts only for known hard media failures`, () => {
        expect( can_attempt_recording( {
            secure_context: true,
            media_devices: `supported`,
            media_recorder: `supported`,
            camera: `prompt`,
            microphone: `unknown`
        } ) ).toBe( true )

        expect( can_attempt_recording( {
            secure_context: true,
            media_devices: `supported`,
            media_recorder: `supported`,
            camera: `granted`,
            microphone: `denied`
        } ) ).toBe( true )

        expect( can_attempt_recording( {
            secure_context: true,
            media_devices: `supported`,
            media_recorder: `unsupported`,
            camera: `prompt`,
            microphone: `prompt`
        } ) ).toBe( false )

        expect( can_attempt_recording( {
            secure_context: true,
            media_devices: `supported`,
            media_recorder: `supported`,
            camera: `denied`,
            microphone: `prompt`
        } ) ).toBe( false )
    } )

    test( `detects denied media permission for recovery guidance`, () => {
        expect( has_denied_media_permission( {
            camera: `prompt`,
            microphone: `denied`
        } ) ).toBe( true )

        expect( has_denied_media_permission( {
            camera: `prompt`,
            microphone: `granted`
        } ) ).toBe( false )
    } )
} )
