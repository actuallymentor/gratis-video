/**
 * Formats milliseconds as a compact duration.
 * @param {number} duration_ms - Duration in milliseconds.
 * @returns {string} Human-friendly duration.
 */
export function format_duration( duration_ms = 0 ) {
    const total_seconds = Math.max( 0, Math.round( duration_ms / 1000 ) )
    const minutes = Math.floor( total_seconds / 60 )
    const seconds = total_seconds % 60

    if( minutes === 0 ) return `${ seconds }s`
    return `${ minutes }:${ seconds.toString().padStart( 2, `0` ) }`
}

/**
 * Formats an ISO timestamp for short local display.
 * @param {string} iso_timestamp - ISO timestamp.
 * @returns {string} Human-friendly time.
 */
export function format_time( iso_timestamp ) {
    return new Intl.DateTimeFormat( undefined, {
        hour: `numeric`,
        minute: `2-digit`
    } ).format( new Date( iso_timestamp ) )
}

/**
 * Formats an ISO timestamp as a zero-padded local 24-hour clock time.
 * @param {string} iso_timestamp - ISO timestamp.
 * @returns {string} HH:MM clock time.
 */
export function format_clock_time( iso_timestamp ) {
    const date = new Date( iso_timestamp )

    if( Number.isNaN( date.getTime() ) ) return `--:--`

    const hours = date.getHours().toString().padStart( 2, `0` )
    const minutes = date.getMinutes().toString().padStart( 2, `0` )

    return `${ hours }:${ minutes }`
}

/**
 * Formats an ISO timestamp as a short date.
 * @param {string} iso_timestamp - ISO timestamp.
 * @returns {string} Human-friendly date.
 */
export function format_date( iso_timestamp ) {
    return new Intl.DateTimeFormat( undefined, {
        month: `short`,
        day: `numeric`,
        year: `numeric`
    } ).format( new Date( iso_timestamp ) )
}
