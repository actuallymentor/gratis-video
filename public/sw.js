const CACHE_NAME = `daily-video-journal-v4`
const APP_SHELL_URL = `/`

// Fetch `/` to avoid Cloudflare's canonical `/index.html` redirect, but keep
// the cached shell under `/index.html` so direct file-path lookups share it.
const APP_SHELL_CACHE_KEY = `/index.html`

const STATIC_APP_ASSETS = [
    `/manifest.webmanifest`,
    `/assets/icon.svg`,
    `/assets/icon-192.png`,
    `/assets/icon-512.png`
]

self.addEventListener( `install`, ( event ) => {
    event.waitUntil( cache_app_shell().catch( () => null ) )
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

const same_build_asset_urls = ( first_urls, second_urls ) => {
    if( first_urls.length !== second_urls.length ) return false

    const second_url_set = new Set( second_urls )
    return first_urls.every( ( asset_url ) => second_url_set.has( asset_url ) )
}

const cached_shell_matches_build_assets = async ( cache, build_asset_urls ) => {
    const index_response = await cache.match( APP_SHELL_CACHE_KEY )

    if( !index_response?.ok ) return false

    const html = await index_response.clone().text()
    return same_build_asset_urls( get_build_asset_urls( html ), build_asset_urls )
}

const prune_stale_build_assets = async ( cache, build_asset_urls ) => {
    if( !( await cached_shell_matches_build_assets( cache, build_asset_urls ) ) ) return

    const cached_requests = await cache.keys()
    const current_assets = new Set( build_asset_urls )
    const stale_requests = cached_requests.filter( ( request ) => {
        const url = new URL( request.url )
        return is_build_asset_request( request ) && !current_assets.has( url.pathname )
    } )

    await Promise.all( stale_requests.map( ( request ) => cache.delete( request ) ) )
}

const cache_build_asset = async ( cache, asset_url ) => {
    const response = await fetch( asset_url, { cache: `reload` } )

    if( !response.ok ) throw new Error( `Build asset response was not cacheable.` )

    await cache.put( asset_url, response )
}

const cache_build_assets = async ( cache, build_asset_urls ) => {
    await Promise.all( build_asset_urls.map( ( asset_url ) => cache_build_asset( cache, asset_url ) ) )
}

const cache_index_with_build_assets = async ( cache, index_response ) => {
    if( !index_response.ok || index_response.redirected ) throw new Error( `App shell response was not cacheable.` )

    const html = await index_response.clone().text()
    const build_asset_urls = get_build_asset_urls( html )

    if( build_asset_urls.length ) await cache_build_assets( cache, build_asset_urls )
    await cache.put( APP_SHELL_CACHE_KEY, index_response.clone() )
    await prune_stale_build_assets( cache, build_asset_urls )
}

const cached_index_has_build_assets = async ( index_response, match_asset = ( asset_url ) => caches.match( asset_url ) ) => {
    if( !index_response?.ok ) return false

    const html = await index_response.clone().text()
    const build_asset_urls = get_build_asset_urls( html )
    const cached_build_assets = await Promise.all(
        build_asset_urls.map( match_asset )
    )

    return cached_build_assets.every( Boolean )
}

const get_valid_cached_index = async () => {
    const index_response = await caches.match( APP_SHELL_CACHE_KEY )

    if( await cached_index_has_build_assets( index_response ) ) return index_response
    return null
}

const current_cache_has_valid_index = async () => {
    const cache = await caches.open( CACHE_NAME )
    const index_response = await cache.match( APP_SHELL_CACHE_KEY )

    return cached_index_has_build_assets( index_response, ( asset_url ) => cache.match( asset_url ) )
}

const match_cached_request = async ( request ) => {
    const url = new URL( request.url )
    const cached_response = await caches.match( request )

    return cached_response || caches.match( url.pathname )
}

const offline_response = () => new Response( `Offline and not cached.`, {
    status: 503,
    statusText: `Offline`,
    headers: {
        'content-type': `text/plain; charset=utf-8`
    }
} )

const navigation_fallback_response = async ( response = null ) => {
    const cached_index_response = await get_valid_cached_index()

    if( cached_index_response ) return cached_index_response
    if( response?.ok && !response.redirected ) return response
    return offline_response()
}

const delete_outdated_caches = async () => {
    const names = await caches.keys()
    const outdated_names = names.filter( ( name ) => name !== CACHE_NAME )

    await Promise.all( outdated_names.map( ( name ) => caches.delete( name ) ) )
}

const cache_app_shell = async () => {
    const cache = await caches.open( CACHE_NAME )

    await cache.addAll( STATIC_APP_ASSETS )

    const index_response = await fetch( APP_SHELL_URL, { cache: `reload` } )
    await cache_index_with_build_assets( cache, index_response )
}

const fetch_and_cache_build_asset = async ( request ) => {
    const cache = await caches.open( CACHE_NAME )
    const response = await fetch( request, { cache: `reload` } )

    if( response.ok ) await cache.put( request, response.clone() )

    return response
}

const refresh_navigation = async () => {
    const cache = await caches.open( CACHE_NAME )
    const response = await fetch( APP_SHELL_URL, { cache: `reload` } )

    try {
        await cache_index_with_build_assets( cache, response.clone() )
        return response
    } catch {
        return navigation_fallback_response( response )
    }
}

self.addEventListener( `activate`, ( event ) => {
    event.waitUntil(
        current_cache_has_valid_index().then( ( is_current_cache_valid ) => {
            if( is_current_cache_valid ) return delete_outdated_caches()
            return null
        } )
    )
    self.clients.claim()
} )

self.addEventListener( `fetch`, ( event ) => {
    const { request } = event
    const url = new URL( request.url )

    if( request.method !== `GET` || url.origin !== self.location.origin ) return

    if( request.mode === `navigate` ) {
        event.respondWith(
            refresh_navigation()
                .catch( async () => {
                    return navigation_fallback_response()
                } )
        )
        return
    }

    if( is_build_asset_request( request ) ) {
        event.respondWith(
            fetch_and_cache_build_asset( request )
                .catch( async () => {
                    return await match_cached_request( request ) || offline_response()
                } )
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
            } ).catch( async () => {
                return await match_cached_request( request ) || offline_response()
            } )
        } )
    )
} )
