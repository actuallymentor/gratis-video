import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styled from 'styled-components'
import { ArrowDown, ArrowUp, Trash2, Upload, VideoOff, X } from 'lucide-react'
import { IconButton } from '../atoms/IconButton.jsx'
import { useModalFocus } from '../../hooks/use_modal_focus.js'
import {
    get_clip_blob,
    get_clip_thumbnail_blob
} from '../../modules/storage/journal_storage.js'
import { format_clock_time, format_duration } from '../../modules/media/time.js'

const Queue = styled.div`
    display: grid;
    gap: 0.65rem;
`

const QueueTools = styled.div`
    display: flex;
    align-items: center;
`

const UploadTile = styled.div`
    position: relative;
    display: grid;
    place-items: center;
    width: 5rem;
    min-width: 5rem;
    aspect-ratio: 1;
    overflow: hidden;
    border: 2px dotted ${ ( { $disabled } ) => $disabled ? `rgba( 96, 114, 115, 0.42 )` : `var(--color-border)` };
    border-radius: 0.5rem;
    color: ${ ( { $disabled } ) => $disabled ? `var(--color-muted)` : `var(--color-accent-strong)` };
    background: var(--color-surface-strong);
    transition: border-color 140ms ease, background 140ms ease, color 140ms ease, transform 140ms ease;

    &:hover,
    &:focus-within {
        border-color: ${ ( { $disabled } ) => $disabled ? `rgba( 96, 114, 115, 0.42 )` : `var(--color-accent-strong)` };
        color: ${ ( { $disabled } ) => $disabled ? `var(--color-muted)` : `#0d1718` };
        background: ${ ( { $disabled } ) => $disabled ? `var(--color-surface-strong)` : `var(--color-accent)` };
    }

    &:active {
        transform: ${ ( { $disabled } ) => $disabled ? `none` : `scale( 0.97 )` };
    }
`

const UploadInput = styled.input`
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: ${ ( { disabled } ) => disabled ? `not-allowed` : `pointer` };
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

const RowActions = styled.div`
    display: grid;
    gap: 0.4rem;
`

const Dialog = styled.div`
    position: fixed;
    inset: 0;
    z-index: 48;
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

function ClipUploadControl( { disabled = false, on_upload } ) {
    const upload_clip = ( event ) => {
        const [ file = null ] = Array.from( event.target.files ?? [] )

        event.target.value = ``
        if( file ) on_upload( file )
    }

    return <QueueTools>
        <UploadTile $disabled={ disabled }>
            <Upload size={ 24 } strokeWidth={ 2.2 } aria-hidden="true" />
            <UploadInput
                type="file"
                accept="video/*"
                aria-label="Upload clip"
                title="Upload clip"
                disabled={ disabled }
                onChange={ upload_clip }
            />
        </UploadTile>
    </QueueTools>
}

const ClipPreviewDialog = ( {
    preview_dialog_ref,
    preview_error,
    preview_url,
    on_close
} ) => {
    return createPortal(
        <Dialog role="dialog" aria-modal="true" aria-label="Clip preview" onClick={ on_close }>
            <Preview ref={ preview_dialog_ref } tabIndex={ -1 } onClick={ ( event ) => event.stopPropagation() }>
                { preview_url ? <video src={ preview_url } controls playsInline autoPlay /> : null }
                { !preview_url && !preview_error ? <PreviewMessage aria-live="polite">Loading clip preview...</PreviewMessage> : null }
                { preview_error ? <PreviewMessage>{ preview_error }</PreviewMessage> : null }
                <IconButton icon={ X } label="Close preview" onClick={ on_close } />
            </Preview>
        </Dialog>,
        document.body
    )
}

function ClipThumbnail( { clip, label, on_preview } ) {
    const [ thumbnail_url, set_thumbnail_url ] = useState( null )

    useEffect( () => {
        let cancelled = false
        let object_url = null

        const load_thumbnail = async () => {
            set_thumbnail_url( null )

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
    }, [ clip.id, clip.updated_at ] )

    return <Thumb type="button" aria-label={ label } onClick={ on_preview }>
        { thumbnail_url ? <img src={ thumbnail_url } alt="" /> : <VideoOff size={ 22 } aria-hidden="true" /> }
    </Thumb>
}

/**
 * Displays saved clips with preview and delete actions.
 * @param {Object} props - Queue props.
 * @returns {JSX.Element} Clip queue.
 */
export function ClipQueue( {
    clips,
    on_delete,
    on_move = null,
    on_upload = null,
    queue_actions_disabled = false,
    upload_disabled = false
} ) {
    const [ preview_clip, set_preview_clip ] = useState( null )
    const [ preview_url, set_preview_url ] = useState( null )
    const [ preview_error, set_preview_error ] = useState( null )
    const mounted_ref = useRef( true )
    const preview_url_ref = useRef( null )
    const preview_request_ref = useRef( 0 )

    const replace_preview_url = useCallback( ( object_url ) => {
        if( preview_url_ref.current ) URL.revokeObjectURL( preview_url_ref.current )

        preview_url_ref.current = object_url
        set_preview_url( object_url )
    }, [] )

    const open_preview = async ( clip ) => {
        const request_id = preview_request_ref.current + 1
        preview_request_ref.current = request_id
        set_preview_clip( clip )
        set_preview_error( null )
        replace_preview_url( null )

        const preview_is_current = () => preview_request_ref.current === request_id

        let blob = null

        try {
            blob = await get_clip_blob( clip.id )
        } catch {
            if( !preview_is_current() ) return
            replace_preview_url( null )
            set_preview_error( `This clip could not be read from local browser storage.` )
            return
        }

        if( !preview_is_current() || !mounted_ref.current ) return

        if( !blob ) {
            replace_preview_url( null )
            set_preview_error( `This clip file is missing from local browser storage.` )
            return
        }

        const object_url = URL.createObjectURL( blob )

        if( !preview_is_current() || !mounted_ref.current ) {
            URL.revokeObjectURL( object_url )
            return
        }

        replace_preview_url( object_url )
        set_preview_error( null )
    }

    const close_preview = useCallback( () => {
        preview_request_ref.current += 1
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
            mounted_ref.current = false
            preview_request_ref.current += 1
            if( preview_url_ref.current ) URL.revokeObjectURL( preview_url_ref.current )
        }
    }, [] )

    const upload_control = on_upload
        ? <ClipUploadControl disabled={ upload_disabled } on_upload={ on_upload } />
        : null

    if( !clips.length ) {
        return <Queue>
            { upload_control }
            <EmptyQueue>
                <span>Clips will appear here.</span>
            </EmptyQueue>
        </Queue>
    }

    return <>
        <Queue>
            { upload_control }
            { clips.map( ( clip, index ) => <Row key={ clip.id }>
                <ClipThumbnail
                    clip={ clip }
                    label={ `Preview clip ${ index + 1 }` }
                    on_preview={ () => open_preview( clip ) }
                />
                <Details>
                    <strong>Clip { format_clock_time( clip.created_at ) }</strong>
                    <span>{ format_duration( clip.duration_ms ) }</span>
                </Details>
                <RowActions>
                    <IconButton
                        icon={ ArrowUp }
                        label={ `Move clip ${ index + 1 } earlier` }
                        onClick={ () => on_move?.( clip, `earlier` ) }
                        disabled={ queue_actions_disabled || !on_move || index === 0 }
                    />
                    <IconButton
                        icon={ ArrowDown }
                        label={ `Move clip ${ index + 1 } later` }
                        onClick={ () => on_move?.( clip, `later` ) }
                        disabled={ queue_actions_disabled || !on_move || index === clips.length - 1 }
                    />
                    <IconButton
                        icon={ Trash2 }
                        label={ `Delete clip ${ index + 1 }` }
                        onClick={ () => on_delete( clip ) }
                        disabled={ queue_actions_disabled }
                    />
                </RowActions>
            </Row> ) }
        </Queue>

        { preview_clip ? <ClipPreviewDialog
            preview_dialog_ref={ preview_dialog_ref }
            preview_error={ preview_error }
            preview_url={ preview_url }
            on_close={ close_preview }
        /> : null }
    </>
}
