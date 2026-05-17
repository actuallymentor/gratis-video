const DATABASE_NAME = `daily_video_journal`
const DATABASE_VERSION = 1

const STORE_NAMES = [
    `projects`,
    `clips`,
    `clip_blobs`,
    `exports`,
    `export_blobs`,
    `settings`
]

let database_promise = null

const request_to_promise = ( request ) => new Promise( ( resolve, reject ) => {
    request.onsuccess = () => resolve( request.result )
    request.onerror = () => reject( request.error )
} )

const transaction_done = ( transaction ) => new Promise( ( resolve, reject ) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject( transaction.error )
    transaction.onabort = () => reject( transaction.error )
} )

const create_store = ( database, transaction, name, options ) => {
    if( database.objectStoreNames.contains( name ) ) return transaction.objectStore( name )
    return database.createObjectStore( name, options )
}

const upgrade_database = ( database, transaction ) => {
    const projects = create_store( database, transaction, `projects`, { keyPath: `id` } )
    if( !projects.indexNames.contains( `updated_at` ) ) projects.createIndex( `updated_at`, `updated_at` )
    if( !projects.indexNames.contains( `active_at` ) ) projects.createIndex( `active_at`, `active_at` )

    const clips = create_store( database, transaction, `clips`, { keyPath: `id` } )
    if( !clips.indexNames.contains( `project_id` ) ) clips.createIndex( `project_id`, `project_id` )

    const clip_blobs = create_store( database, transaction, `clip_blobs`, { keyPath: `id` } )
    if( !clip_blobs.indexNames.contains( `project_id` ) ) clip_blobs.createIndex( `project_id`, `project_id` )

    const exports = create_store( database, transaction, `exports`, { keyPath: `id` } )
    if( !exports.indexNames.contains( `project_id` ) ) exports.createIndex( `project_id`, `project_id` )

    const export_blobs = create_store( database, transaction, `export_blobs`, { keyPath: `id` } )
    if( !export_blobs.indexNames.contains( `project_id` ) ) export_blobs.createIndex( `project_id`, `project_id` )

    create_store( database, transaction, `settings`, { keyPath: `key` } )
}

/**
 * Opens the journal IndexedDB database.
 * @returns {Promise<IDBDatabase>} Open database connection.
 */
export function open_journal_db() {
    if( database_promise ) return database_promise

    database_promise = new Promise( ( resolve, reject ) => {
        if( !globalThis.indexedDB ) {
            reject( new Error( `IndexedDB is not available in this browser.` ) )
            return
        }

        const request = indexedDB.open( DATABASE_NAME, DATABASE_VERSION )
        request.onupgradeneeded = () => upgrade_database( request.result, request.transaction )
        request.onsuccess = () => resolve( request.result )
        request.onerror = () => reject( request.error )
    } )

    return database_promise
}

/**
 * Resets the cached database handle. Intended for tests.
 * @returns {void}
 */
export function reset_db_connection() {
    database_promise = null
}

/**
 * Reads one object by key from an object store.
 * @param {string} store_name - IndexedDB object store name.
 * @param {string} key - Object key.
 * @returns {Promise<*>} Stored value.
 */
export async function get_record( store_name, key ) {
    const database = await open_journal_db()
    const transaction = database.transaction( store_name, `readonly` )
    return request_to_promise( transaction.objectStore( store_name ).get( key ) )
}

/**
 * Reads all objects from an object store.
 * @param {string} store_name - IndexedDB object store name.
 * @returns {Promise<Array>} Stored values.
 */
export async function get_all_records( store_name ) {
    const database = await open_journal_db()
    const transaction = database.transaction( store_name, `readonly` )
    return request_to_promise( transaction.objectStore( store_name ).getAll() )
}

/**
 * Reads all objects matching an index key.
 * @param {string} store_name - IndexedDB object store name.
 * @param {string} index_name - Object store index name.
 * @param {string} key - Index key.
 * @returns {Promise<Array>} Matching values.
 */
export async function get_index_records( store_name, index_name, key ) {
    const database = await open_journal_db()
    const transaction = database.transaction( store_name, `readonly` )
    return request_to_promise( transaction.objectStore( store_name ).index( index_name ).getAll( key ) )
}

/**
 * Writes one object to an object store.
 * @param {string} store_name - IndexedDB object store name.
 * @param {*} record - Value to store.
 * @returns {Promise<void>}
 */
export async function put_record( store_name, record ) {
    const database = await open_journal_db()
    const transaction = database.transaction( store_name, `readwrite` )
    transaction.objectStore( store_name ).put( record )
    await transaction_done( transaction )
}

/**
 * Deletes one object from an object store.
 * @param {string} store_name - IndexedDB object store name.
 * @param {string} key - Object key.
 * @returns {Promise<void>}
 */
export async function delete_record( store_name, key ) {
    const database = await open_journal_db()
    const transaction = database.transaction( store_name, `readwrite` )
    transaction.objectStore( store_name ).delete( key )
    await transaction_done( transaction )
}

/**
 * Clears all journal stores.
 * @returns {Promise<void>}
 */
export async function clear_all_records() {
    const database = await open_journal_db()
    const transaction = database.transaction( STORE_NAMES, `readwrite` )

    STORE_NAMES.forEach( ( store_name ) => {
        transaction.objectStore( store_name ).clear()
    } )

    await transaction_done( transaction )
}

/**
 * Runs a readwrite transaction across selected stores.
 * @param {Array<string>} store_names - Stores to include.
 * @param {Function} write_records - Synchronous writer callback.
 * @returns {Promise<void>}
 */
export async function write_transaction( store_names, write_records ) {
    const database = await open_journal_db()
    const transaction = database.transaction( store_names, `readwrite` )
    const stores = Object.fromEntries(
        store_names.map( ( store_name ) => [ store_name, transaction.objectStore( store_name ) ] )
    )

    write_records( stores )
    await transaction_done( transaction )
}
