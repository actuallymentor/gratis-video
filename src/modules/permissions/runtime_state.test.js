import { describe, expect, test } from 'vitest'
import {
    get_stream_media_access,
    grant_observed_media_access,
    is_media_permission_denial,
    mark_denied_media_access,
    reconcile_passive_permission_status
} from './runtime_state.js'

const permission_status = {
    camera: `prompt`,
    microphone: `prompt`,
    secure_context: true,
    media_devices: `supported`,
    media_recorder: `supported`,
    offline: false
}

const make_track = ( readyState = `live` ) => ( { readyState } )

describe( `runtime permission state helpers`, () => {
    test( `reads live camera and microphone tracks from a stream`, () => {
        const stream = {
            getVideoTracks: () => [ null, make_track() ],
            getAudioTracks: () => [ make_track( `ended` ), make_track() ]
        }

        expect( get_stream_media_access( stream ) ).toEqual( {
            camera: true,
            microphone: true
        } )
    } )

    test( `treats successful capture as authoritative access`, () => {
        expect( grant_observed_media_access( {
            ...permission_status,
            camera: `denied`,
            microphone: `unsupported`
        }, {
            camera: true,
            microphone: true
        } ) ).toMatchObject( {
            camera: `granted`,
            microphone: `granted`
        } )
    } )

    test( `keeps passive permission reads from contradicting live tracks`, () => {
        expect( reconcile_passive_permission_status( {
            ...permission_status,
            camera: `denied`,
            microphone: `denied`
        }, {
            camera: true,
            microphone: false
        } ) ).toMatchObject( {
            camera: `granted`,
            microphone: `denied`
        } )
    } )

    test( `records concrete capture denials for the attempted device`, () => {
        expect( mark_denied_media_access( {
            ...permission_status,
            camera: `granted`,
            microphone: `granted`
        }, {
            microphone: true
        } ) ).toMatchObject( {
            camera: `granted`,
            microphone: `denied`
        } )
    } )

    test( `recognizes browser media permission denial errors`, () => {
        expect( is_media_permission_denial( { name: `NotAllowedError` } ) ).toBe( true )
        expect( is_media_permission_denial( { name: `PermissionDeniedError` } ) ).toBe( true )
        expect( is_media_permission_denial( { name: `NotFoundError` } ) ).toBe( false )
    } )
} )
