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

const cache_app_shell = async () => {
    const cache = await caches.open( CACHE_NAME )

    await cache.addAll( APP_SHELL )

    const index_response = await fetch( `/index.html`, { cache: `reload` } )
    const html = await index_response.clone().text()
    const build_asset_urls = get_build_asset_urls( html )

    await cache.put( `/index.html`, index_response )
    if( build_asset_urls.length ) await cache.addAll( build_asset_urls )
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
                .then( ( response ) => {
                    const cloned_response = response.clone()
                    caches.open( CACHE_NAME ).then( ( cache ) => cache.put( `/index.html`, cloned_response ) )
                    return response
                } )
                .catch( () => caches.match( `/index.html` ) )
        )
        return
    }

    event.respondWith(
        caches.match( request ).then( ( cached_response ) => {
            if( cached_response ) return cached_response

            return fetch( request ).then( ( response ) => {
                if( !response.ok ) return response

                const cloned_response = response.clone()
                caches.open( CACHE_NAME ).then( ( cache ) => cache.put( request, cloned_response ) )
                return response
            } )
        } )
    )
} )
