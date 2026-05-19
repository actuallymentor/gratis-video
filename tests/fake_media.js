import fs from 'node:fs'
import path from 'node:path'

export const fake_video_capture_width = 240
export const fake_video_capture_height = 320
export const fake_video_capture_fps = 30
export const fake_video_capture_frames = 90

const fixture_directory = path.resolve( `tests`, `.generated`, `fake-media` )
const fake_video_capture_file = path.join( fixture_directory, `fake-camera.y4m` )

const make_frame = ( frame_index ) => {
    const y_size = fake_video_capture_width * fake_video_capture_height
    const chroma_width = fake_video_capture_width / 2
    const chroma_height = fake_video_capture_height / 2
    const chroma_size = chroma_width * chroma_height
    const frame = Buffer.alloc( y_size + chroma_size * 2 )
    const bar_x = ( frame_index * 5 ) % fake_video_capture_width

    Array.from( { length: fake_video_capture_height } ).forEach( ( _, y ) => {
        Array.from( { length: fake_video_capture_width } ).forEach( ( __, x ) => {
            const distance = Math.abs( x - bar_x )
            const luma = distance < 18
                ? 220
                : 52 + ( ( x + y + frame_index * 3 ) % 96 )

            frame[ y * fake_video_capture_width + x ] = luma
        } )
    } )

    frame.fill( 96 + frame_index % 40, y_size, y_size + chroma_size )
    frame.fill( 144 - frame_index % 40, y_size + chroma_size )

    return frame
}

const build_y4m_buffer = () => {
    const header = Buffer.from(
        `YUV4MPEG2 W${ fake_video_capture_width } H${ fake_video_capture_height } F${ fake_video_capture_fps }:1 Ip A1:1 C420jpeg\n`
    )
    const chunks = [ header ]

    Array.from( { length: fake_video_capture_frames } ).forEach( ( _, frame_index ) => {
        chunks.push( Buffer.from( `FRAME\n` ) )
        chunks.push( make_frame( frame_index ) )
    } )

    return Buffer.concat( chunks )
}

/**
 * Ensures Playwright Chromium has a deterministic fake camera video file.
 * @returns {string} Absolute path to the Y4M fake video capture fixture.
 */
export function ensure_fake_video_capture_file() {
    const y4m_buffer = build_y4m_buffer()

    if( fs.existsSync( fake_video_capture_file ) ) {
        const existing_buffer = fs.readFileSync( fake_video_capture_file )
        if( existing_buffer.equals( y4m_buffer ) ) return fake_video_capture_file
    }

    fs.mkdirSync( fixture_directory, { recursive: true } )
    fs.writeFileSync( fake_video_capture_file, y4m_buffer )

    return fake_video_capture_file
}
