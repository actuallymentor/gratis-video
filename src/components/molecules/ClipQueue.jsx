import { useCallback, useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import { Trash2, VideoOff, X } from 'lucide-react'
import { IconButton } from '../atoms/IconButton.jsx'
import { useModalFocus } from '../../hooks/use_modal_focus.js'
import {
    get_clip_blob,
    get_clip_thumbnail_blob
} from '../../modules/storage/journal_storage.js'
import { format_duration, format_time } from '../../modules/media/time.js'

const Queue = styled.div`
    display: grid;
    gap: 0.65rem;
`

const Row = styled.article`
    display: grid;
    grid-template-columns: 5.75rem 1fr auto;
    align-items: center;
    gap: 0.75rem;
    min-height: 5rem;
    padding: 0.6rem;
    border: 1px solid var(--color-border);
    border-radius: 0.5rem;
    background: var(--color-surface);
`

const Thumb = styled.button`
    display: grid;
    place-items: center;
    width: 5.75rem;
    aspect-ratio: 16 / 10;
    overflow: hidden;
    border: 0;
    border-radius: 0.4rem;
    color: var(--color-muted);
    background: var(--color-surface-strong);

    img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }
`

const Details = styled.div`
    min-width: 0;

    strong {
        display: block;
        color: var(--color-ink);
        font-weight: 900;
    }

    span {
        display: block;
        color: var(--color-muted);
        font-size: 0.9rem;
        line-height: 1.45;
    }
`

const EmptyQueue = styled.div`
    display: grid;
    place-items: center;
    min-height: 8rem;
    padding: 1rem;
    border: 1px dashed var(--color-border);
    border-radius: 0.5rem;
    color: var(--color-muted);
    text-align: center;
`

const Dialog = styled.div`
    position: fixed;
    inset: 0;
    z-index: 40;
    display: grid;
    place-items: center;
    padding: 1rem;
    background: rgba( 13, 23, 24, 0.74 );
`

const Preview = styled.div`
    width: min( 100%, 52rem );
    padding: 0.75rem;
    border-radius: 0.5rem;
    background: var(--color-surface);

    video {
        display: block;
        width: 100%;
        max-height: 75svh;
        border-radius: 0.35rem;
        background: #0d1718;
    }
`

const PreviewMessage = styled.p`
    margin: 0.75rem 0 0;
    color: var(--color-muted);
    line-height: 1.5;
`

function ClipThumbnail( { clip, label, on_preview } ) {
    const [ thumbnail_url, set_thumbnail_url ] = useState( null )

    useEffect( () => {
        let cancelled = false
        let object_url = null

        const load_thumbnail = async () => {
            const blob = await get_clip_thumbnail_blob( clip.id ).catch( () => null )
            if( !blob || cancelled ) return

            object_url = URL.createObjectURL( blob )
            set_thumbnail_url( object_url )
        }

        load_thumbnail()

        return () => {
            cancelled = true
            if( object_url ) URL.revokeObjectURL( object_url )
        }
    }, [ clip.id ] )

    return <Thumb type="button" aria-label={ label } onClick={ on_preview }>
        { thumbnail_url ? <img src={ thumbnail_url } alt="" /> : <VideoOff size={ 22 } aria-hidden="true" /> }
    </Thumb>
}

/**
 * Displays saved clips with preview and delete actions.
 * @param {Object} props - Queue props.
 * @returns {JSX.Element} Clip queue.
 */
export function ClipQueue( { clips, on_delete } ) {
    const [ preview_clip, set_preview_clip ] = useState( null )
    const [ preview_url, set_preview_url ] = useState( null )
    const [ preview_error, set_preview_error ] = useState( null )
    const preview_url_ref = useRef( null )

    const replace_preview_url = useCallback( ( object_url ) => {
        if( preview_url_ref.current ) URL.revokeObjectURL( preview_url_ref.current )

        preview_url_ref.current = object_url
        set_preview_url( object_url )
    }, [] )

    const open_preview = async ( clip ) => {
        const blob = await get_clip_blob( clip.id )

        set_preview_clip( clip )

        if( !blob ) {
            replace_preview_url( null )
            set_preview_error( `This clip file is missing from local browser storage.` )
            return
        }

        replace_preview_url( URL.createObjectURL( blob ) )
        set_preview_error( null )
    }

    const close_preview = useCallback( () => {
        set_preview_clip( null )
        set_preview_error( null )
        replace_preview_url( null )
    }, [ replace_preview_url ] )
    const preview_dialog_ref = useModalFocus( {
        active: Boolean( preview_clip ),
        on_close: close_preview
    } )

    useEffect( () => {
        return () => {
            if( preview_url_ref.current ) URL.revokeObjectURL( preview_url_ref.current )
        }
    }, [] )

    if( !clips.length ) {
        return <EmptyQueue>
            <span>Recorded clips will appear here.</span>
        </EmptyQueue>
    }

    return <>
        <Queue>
            { clips.map( ( clip, index ) => <Row key={ clip.id }>
                <ClipThumbnail
                    clip={ clip }
                    label={ `Preview clip ${ index + 1 }` }
                    on_preview={ () => open_preview( clip ) }
                />
                <Details>
                    <strong>Clip { index + 1 }</strong>
                    <span>{ format_duration( clip.duration_ms ) } at { format_time( clip.created_at ) }</span>
                </Details>
                <IconButton
                    icon={ Trash2 }
                    label={ `Delete clip ${ index + 1 }` }
                    onClick={ () => on_delete( clip ) }
                />
            </Row> ) }
        </Queue>

        { preview_clip ? <Dialog role="dialog" aria-modal="true" aria-label="Clip preview" onClick={ close_preview }>
            <Preview ref={ preview_dialog_ref } tabIndex={ -1 } onClick={ ( event ) => event.stopPropagation() }>
                { preview_url ? <video src={ preview_url } controls playsInline autoPlay /> : null }
                { preview_error ? <PreviewMessage>{ preview_error }</PreviewMessage> : null }
                <IconButton icon={ X } label="Close preview" onClick={ close_preview } />
            </Preview>
        </Dialog> : null }
    </>
}
