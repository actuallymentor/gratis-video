import { useEffect, useState } from 'react'

/**
 * Creates and revokes an object URL for a Blob.
 * @param {Blob|null} blob - Source blob.
 * @returns {string|null} Object URL.
 */
export function useObjectUrl( blob ) {
    const [ object_url, set_object_url ] = useState( null )

    useEffect( () => {
        if( !blob ) {
            set_object_url( null )
            return undefined
        }

        const next_object_url = URL.createObjectURL( blob )
        set_object_url( next_object_url )

        return () => URL.revokeObjectURL( next_object_url )
    }, [ blob ] )

    return object_url
}
