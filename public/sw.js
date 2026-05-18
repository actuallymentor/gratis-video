const CACHE_NAME = `daily-video-journal-v1`

const APP_SHELL = [
    `/`,
    `/index.html`,
    `/manifest.webmanifest`,
    `/assets/icon.svg`,
    `/assets/icon-192.png`,
    `/assets/icon-512.png`
]

self.addEventListener( `install`, ( event ) => {
    event.waitUntil( cache_app_shell() )
    self.skipWaiting()
} )

const get_build_asset_urls = ( html ) => {
    const matches = Array.from( html.matchAll( /(?:src|href)="([^"]+\.(?:js|css))"/g ) )

    return matches
        .map( ( [ , asset_path ] ) => new URL( asset_path, self.location.origin ).pathname )
        .filter( ( asset_path ) => asset_path.startsWith( `/assets/` ) )
}

const is_build_asset_request = ( request ) => {
    const url = new URL( request.url )
    return url.pathname.startsWith( `/assets/` ) && /\.(?:js|css)$/.test( url.pathname )
}

const prune_stale_build_assets = async ( cache, build_asset_urls ) => {
    const cached_requests = await cache.keys()
    const current_assets = new Set( build_asset_urls )
    const stale_requests = cached_requests.filter( ( request ) => {
        const url = new URL( request.url )
        return is_build_asset_request( request ) && !current_assets.has( url.pathname )
    } )

    await Promise.all( stale_requests.map( ( request ) => cache.delete( request ) ) )
}

const cache_index_with_build_assets = async ( cache, index_response ) => {
    if( !index_response.ok ) throw new Error( `App shell response was not cacheable.` )

    const html = await index_response.clone().text()
    const build_asset_urls = get_build_asset_urls( html )

    if( build_asset_urls.length ) await cache.addAll( build_asset_urls )
    await cache.put( `/index.html`, index_response.clone() )
    await prune_stale_build_assets( cache, build_asset_urls )
}

const match_cached_request = async ( request ) => {
    const url = new URL( request.url )
    const cached_response = await caches.match( request )

    return cached_response || caches.match( url.pathname )
}

const cache_app_shell = async () => {
    const cache = await caches.open( CACHE_NAME )

    await cache.addAll( APP_SHELL )

    const index_response = await fetch( `/index.html`, { cache: `reload` } )
    await cache_index_with_build_assets( cache, index_response )
}

self.addEventListener( `activate`, ( event ) => {
    event.waitUntil(
        caches.keys().then( ( names ) => Promise.all(
            names.filter( ( name ) => name !== CACHE_NAME ).map( ( name ) => caches.delete( name ) )
        ) )
    )
    self.clients.claim()
} )

self.addEventListener( `fetch`, ( event ) => {
    const { request } = event
    const url = new URL( request.url )

    if( request.method !== `GET` || url.origin !== self.location.origin ) return

    if( request.mode === `navigate` ) {
        event.respondWith(
            fetch( `/index.html`, { cache: `reload` } )
                .then( async ( response ) => {
                    const cache = await caches.open( CACHE_NAME )
                    await cache_index_with_build_assets( cache, response )
                    return response
                } )
                .catch( () => caches.match( `/index.html` ) )
        )
        return
    }

    event.respondWith(
        match_cached_request( request ).then( ( cached_response ) => {
            if( cached_response ) return cached_response

            return fetch( request ).then( ( response ) => {
                if( !response.ok ) return response

                const cloned_response = response.clone()
                caches.open( CACHE_NAME ).then( ( cache ) => cache.put( request, cloned_response ) )
                return response
            } ).catch( () => match_cached_request( request ) )
        } )
    )
} )
