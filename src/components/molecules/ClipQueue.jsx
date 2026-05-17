import { useEffect, useState } from 'react'
import styled from 'styled-components'
import { Trash2, VideoOff, X } from 'lucide-react'
import { IconButton } from '../atoms/IconButton.jsx'
import { useObjectUrl } from '../../hooks/use_object_url.js'
import { get_clip_blob } from '../../modules/storage/journal_storage.js'
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

function ClipThumbnail( { clip, on_preview } ) {
    const thumbnail_url = useObjectUrl( clip.thumbnail_blob )

    return <Thumb type="button" aria-label="Preview clip" onClick={ on_preview }>
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
    const [ preview_blob, set_preview_blob ] = useState( null )
    const preview_url = useObjectUrl( preview_blob )

    const open_preview = async ( clip ) => {
        const blob = await get_clip_blob( clip.id )
        set_preview_clip( clip )
        set_preview_blob( blob )
    }

    const close_preview = () => {
        set_preview_clip( null )
        set_preview_blob( null )
    }

    useEffect( () => {
        const close_on_escape = ( event ) => {
            if( event.key === `Escape` ) close_preview()
        }

        window.addEventListener( `keydown`, close_on_escape )
        return () => window.removeEventListener( `keydown`, close_on_escape )
    }, [] )

    if( !clips.length ) {
        return <EmptyQueue>
            <span>Recorded clips will appear here.</span>
        </EmptyQueue>
    }

    return <>
        <Queue>
            { clips.map( ( clip, index ) => <Row key={ clip.id }>
                <ClipThumbnail clip={ clip } on_preview={ () => open_preview( clip ) } />
                <Details>
                    <strong>Clip { index + 1 }</strong>
                    <span>{ format_duration( clip.duration_ms ) } at { format_time( clip.created_at ) }</span>
                </Details>
                <IconButton
                    icon={ Trash2 }
                    label="Delete clip"
                    onClick={ () => on_delete( clip ) }
                />
            </Row> ) }
        </Queue>

        { preview_clip ? <Dialog role="dialog" aria-modal="true" aria-label="Clip preview" onClick={ close_preview }>
            <Preview onClick={ ( event ) => event.stopPropagation() }>
                { preview_url ? <video src={ preview_url } controls playsInline autoPlay /> : null }
                <IconButton icon={ X } label="Close preview" onClick={ close_preview } />
            </Preview>
        </Dialog> : null }
    </>
}
