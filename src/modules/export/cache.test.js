import { describe, expect, test } from 'vitest'
import {
    create_clip_manifest,
    create_export_hashes,
    stable_hash
} from './cache.js'

describe( `export cache helpers`, () => {
    test( `stable_hash ignores object key order`, () => {
        expect( stable_hash( { b: 2, a: 1 } ) ).toBe( stable_hash( { a: 1, b: 2 } ) )
    } )

    test( `clip manifest includes order-sensitive export inputs`, () => {
        const clips = [
            {
                id: `clip-a`,
                order_index: 1,
                version: 2,
                mime_type: `video/webm`,
                duration_ms: 1000,
                width: 1280,
                height: 720,
                created_at: `2026-05-17T10:00:00.000Z`,
                updated_at: `2026-05-17T10:00:03.000Z`,
                thumbnail_blob: new Blob()
            }
        ]

        expect( create_clip_manifest( clips ) ).toEqual( [
            {
                id: `clip-a`,
                order_index: 1,
                version: 2,
                mime_type: `video/webm`,
                created_at: `2026-05-17T10:00:00.000Z`
            }
        ] )
    } )

    test( `clip hash ignores background metadata enrichment`, () => {
        const base_clip = {
            id: `clip-a`,
            order_index: 1,
            version: 1,
            mime_type: `video/webm`,
            duration_ms: 1000,
            width: null,
            height: null,
            created_at: `2026-05-17T10:00:00.000Z`,
            updated_at: `2026-05-17T10:00:00.000Z`
        }
        const settings = {
            export_quality: `standard`,
            export_resolution: `source`,
            preferred_mime_type: null
        }
        const first_hashes = create_export_hashes( {
            clips: [ base_clip ],
            settings
        } )
        const enriched_hashes = create_export_hashes( {
            clips: [ {
                ...base_clip,
                duration_ms: 1240,
                width: 640,
                height: 360,
                updated_at: `2026-05-17T10:00:03.000Z`
            } ],
            settings
        } )

        expect( first_hashes.clip_manifest_hash ).toBe( enriched_hashes.clip_manifest_hash )
    } )

    test( `clip hash changes when queue order or clip version changes`, () => {
        const base_clip = {
            id: `clip-a`,
            order_index: 1,
            version: 1,
            mime_type: `video/webm`,
            duration_ms: 1000,
            width: null,
            height: null,
            created_at: `2026-05-17T10:00:00.000Z`,
            updated_at: `2026-05-17T10:00:00.000Z`
        }
        const settings = {
            export_quality: `standard`,
            export_resolution: `source`,
            preferred_mime_type: null
        }
        const first_hashes = create_export_hashes( {
            clips: [ base_clip ],
            settings
        } )
        const moved_hashes = create_export_hashes( {
            clips: [ {
                ...base_clip,
                order_index: 2,
                version: 2,
                updated_at: `2026-05-17T10:00:03.000Z`
            } ],
            settings
        } )

        expect( first_hashes.clip_manifest_hash ).not.toBe( moved_hashes.clip_manifest_hash )
    } )

    test( `settings hash changes when export settings change`, () => {
        const clips = []
        const standard = create_export_hashes( {
            clips,
            settings: {
                export_quality: `standard`,
                export_resolution: `source`,
                preferred_mime_type: null
            }
        } )
        const high = create_export_hashes( {
            clips,
            settings: {
                export_quality: `high`,
                export_resolution: `source`,
                preferred_mime_type: null
            }
        } )

        expect( standard.settings_hash ).not.toBe( high.settings_hash )
        expect( standard.clip_manifest_hash ).toBe( high.clip_manifest_hash )
    } )
} )
