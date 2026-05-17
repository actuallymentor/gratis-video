const CACHE_NAME = `daily-video-journal-v1`

const APP_SHELL = [
    `/`,
    `/index.html`,
    `/manifest.webmanifest`,
    `/assets/icon.svg`
]

self.addEventListener( `install`, ( event ) => {
    event.waitUntil(
        caches.open( CACHE_NAME ).then( ( cache ) => cache.addAll( APP_SHELL ) )
    )
    self.skipWaiting()
} )

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
            fetch( request )
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
