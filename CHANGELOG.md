# Changelog

## [0.3.20] - 2026-05-19

### Fixed
- recover Chrome clients from stale service-worker app shells

## [0.3.19] - 2026-05-18

### Fixed
- remove all recording width and height capture constraints

## [0.3.18] - 2026-05-18

### Fixed
- record native uncropped camera frames instead of forcing 16:9 capture

## [0.3.17] - 2026-05-18

### Fixed
- pin Cloudflare deploys to Wrangler 4
- document Cloudflare token permissions and rotation

## [0.3.16] - 2026-05-18

### Added
- add Cloudflare Workers Static Assets deploy workflow

## [0.3.15] - 2026-05-18

### Added
- add mentie browser diagnostics for core user flows
- add browser console log-level smoke coverage

## [0.3.14] - 2026-05-18

### Added
- add project-list, preview, storage, and multi-clip export regressions

### Fixed
- recover stalled later clips during multi-clip export
- keep export share/download MIME metadata accurate after fallback
- remove orphaned media blobs when deleting projects
- avoid empty project/preview states while local storage is still loading

## [0.3.13] - 2026-05-18

### Added
- add unreliable clip-end and share-file export regressions

### Fixed
- finish exports when browser clip end signals are unreliable
- retry recoverable export playback stalls before failing

## [0.3.12] - 2026-05-18

### Added
- add recording, queue, title, and export edge regressions
- run Playwright media smoke tests with deterministic fake camera video
- assert decoded recorded clips and compiled exports in E2E

### Fixed
- retry recording with default MIME when supported start fails
- ignore unrelated record-button pointers during active gestures
- avoid clip preview object URLs after queue unmount
- keep same-day default project titles unique after renames
- hide export controls when canvas drawing is unavailable
- warn when muted export playback may drop audio

## [0.3.11] - 2026-05-18

### Added
- add settings, project, recording, and export race regressions

### Fixed
- persist rapid Settings changes in order
- keep concurrent project titles and active pointers consistent
- keep saved clips out of export until the queue refreshes
- isolate optional haptics and pointer-cancel cleanup from recording
- keep export progress coherent across history and unmounts

## [0.3.10] - 2026-05-18

### Added
- add stale-export guard and recorder-start fallback regressions

### Fixed
- block export while recording or saving clips
- retry export recorder start with fallback formats
- announce blocking capture issues assertively

## [0.3.9] - 2026-05-18

### Added
- add autoplay-blocker export regression
- add browser queue-reorder persistence smoke coverage

### Fixed
- retry extension-shaped export autoplay failures muted

## [0.3.8] - 2026-05-18

### Added
- add cached-export, cleanup, and offline active-route regressions

### Fixed
- reject empty or non-video cached export blobs
- validate export cache freshness inside the save transaction
- avoid exposing stale transient exports after cache validation fails

## [0.3.7] - 2026-05-18

### Added
- add save-failure, export-error, storage, and network regressions

### Fixed
- size immediate exports from first-clip metadata before cache save
- return controlled offline responses for uncached navigations
- show camera-specific missing-device guidance
- label automatic export format choice as Recommended

## [0.3.6] - 2026-05-18

### Added
- add native-share, settings, export, and recording regressions

### Fixed
- require explicit cancellation while export compilation is running
- block stale cached export sharing during queue mutations
- keep cached export blobs paired with current metadata
- reject exports when their project disappears before caching
- keep active recordings stoppable after permission state changes
- stop recordings on next tap after lost startup release

## [0.3.5] - 2026-05-18

### Added
- add stale-write, share fallback, and no-prompt regressions

### Fixed
- keep stale project mutations from restoring deleted data
- prune legacy stale cached exports during project listing
- surface capture failures over stale microphone-denied guidance
- clear recording MediaRecorder handlers after shutdown
- label the bottom create action as Create Project

## [0.3.4] - 2026-05-18

### Added
- add destructive-enrichment, cached-export, MIME, and PWA regressions

### Fixed
- ignore background clip enrichment while export compilation is running
- compile a fresh export when cached export blobs are missing
- preserve recorder chunk MIME when stop finalization times out
- keep late clip enrichment from restoring deleted local data

## [0.3.3] - 2026-05-18

### Added
- add passive media, hold-recording, stale-export, and delete-all regressions

### Fixed
- prevent long press-and-hold recording from immediately restarting
- bound export recorder finalization when browsers miss the stop event
- keep project-scoped clip and export writes transactional

## [0.3.2] - 2026-05-18

### Added
- add export-cache, storage, blocker, sharing, and modal regressions

### Fixed
- reuse valid cached exports while preload checks are still settling
- compile missing cached export blobs instead of opening a dead-end panel
- play recording start feedback only after recording actually starts

## [0.3.1] - 2026-05-18

### Added
- add bootstrap, media, export, PWA, and browser smoke regressions

### Fixed
- route active projects before passive boot checks finish
- request video-only capture when microphone permission is blocked
- save partial clips and release tracks if recorder stop stalls
- choose export formats from canvas-proven recorder support
- require fresh Share actions for late-discovered cached exports
- return Settings permission recovery to the capture screen
- improve project row accessibility and rename idempotence
- return controlled offline responses for uncached PWA requests

## [0.3.0] - 2026-05-18

### Added
- add clip queue move controls and reorder regression coverage
- add media denial, recorder support, and stalled export regressions

### Fixed
- block recording before camera access when MediaRecorder is unavailable
- fail stalled export playback instead of leaving progress stuck
- require canvas export recorders to start before showing options
- keep permission recovery links after stale capture-denial status

## [0.2.14] - 2026-05-18

### Added
- add active-recording cleanup and Playwright smoke regressions
- add an e2e test command for desktop and mobile smoke checks

## [0.2.13] - 2026-05-18

### Added
- add export activation, cache-failure, cache-missing, and record-click regressions

### Fixed
- share cached exports discovered during the export tap
- keep compiled exports available when local caching fails
- expose export progress as a semantic progress bar
- mute export playback when audio routing is unavailable
- support click-style record activation
- delete cached export records and blobs atomically

## [0.2.12] - 2026-05-18

### Added
- add startup, route-race, preview, and export-cache regressions

### Fixed
- keep export-ready status aligned with normalized settings
- stop pending camera startup before opening a recorder
- ignore stale capture route and clip preview loads
- respect reduced motion and clarify permission recovery

## [0.2.11] - 2026-05-18

### Added
- add cached asset fallback regression for offline startup

### Fixed
- serve cached PWA build assets when browser request matching misses

## [0.2.10] - 2026-05-18

### Added
- add bootstrap, lifecycle, export-cache, PWA, and thumbnail regressions

### Fixed
- keep active-project routing when passive boot checks fail
- reuse exports completed in the current capture session
- keep transient export blobs out of React state
- stop recordings on page lifecycle backgrounding
- finish thumbnail enrichment when video seeking stalls
- cache PWA build assets before replacing the offline app shell

## [0.2.9] - 2026-05-18

### Added
- add active-state, cache-version, export-race, and preview regressions

### Fixed
- keep cleared or deleted active projects from reactivating on reload
- invalidate exports when clip media details update asynchronously
- reject stale exports if clips or settings change during compilation
- normalize saved export settings to runtime-supported browser options
- reload thumbnails after media enrichment finishes
- show preview storage failures without unhandled rejections
- recover cleanly when recorder startup or Web Audio export setup fails
- keep permission action links at the required touch target size

## [0.2.8] - 2026-05-18

### Added
- add browser, service-worker, export, and recording regressions

### Fixed
- share preloaded cached exports from the original tap
- load cached export actions before enabling Share or Download
- append clips before thumbnail and metadata enrichment finishes
- save valid partial clips after recorder errors
- retry blocked detached export playback muted
- keep invalid project routes on the active project when possible
- keep Settings toggles responsive during local saves
- fetch PWA navigations through the app shell URL
- preserve icon touch targets in compact layouts

## [0.2.7] - 2026-05-18

### Added
- add export download, storage persistence, and lifecycle regressions

### Fixed
- refresh cached export filenames after project renames
- prune stale export blobs after export setting changes
- prove export formats through canvas recorder construction
- show critical recording guidance near the record control
- add contextual labels for project and clip row actions
- keep export download URLs alive longer

## [0.2.6] - 2026-05-18

### Added
- add microphone-denial and unsupported-export settings regressions

### Fixed
- allow video-only recording when microphone permission is denied
- hide export settings when export compilation is unsupported

## [0.2.5] - 2026-05-17

### Added
- add capture delete, export fallback, and resolution setting path tests

### Fixed
- reject empty browser export output before caching or sharing
- prune stale and missing cached export records after clip changes
- fall back to video-only capture when microphone capture fails

## [0.2.4] - 2026-05-17

### Added
- add Settings, recording gesture, and export history regression coverage

### Fixed
- preserve portrait orientation when scaling exports
- require proven native file-sharing support before sharing files
- keep export progress state complete during compilation
- prevent restored export URL state from restarting compilation
- show media-access help in Settings and prioritize media blockers
- fail visibly instead of silently muting audio-routed exports

## [0.2.3] - 2026-05-17

### Added
- add regression coverage for blocked recording and explicit export intent

### Fixed
- stop media tracks when recorder setup fails after camera access
- require a fresh export action before starting compilation
- refresh permission state after browser settings or network changes
- show recovery guidance for denied media permissions
- handle unsupported export primitives and storage pressure clearly
- improve modal focus handling, title wrapping, and PWA install icons

## [0.2.2] - 2026-05-17

### Fixed
- make Settings toggles reachable by their visible labels

## [0.2.1] - 2026-05-17

### Added
- add regression coverage for recording startup cancel and export cleanup

### Fixed
- stop recordings that finish opening after startup cancellation
- avoid activating invalid project URLs
- keep thumbnail blobs out of React clip queue state
- show export-ready status only for current clips and settings
- clean up export streams on cancellation and recorder startup failure
- isolate optional storage API failures from app startup routing
- improve offline media messaging, keyboard repeat, focus, and touch targets

## [0.2.0] - 2026-05-17

### Added
- show cached export status on project rows
- filter export resolution settings by runtime browser support
- add capture, export, sharing, and storage regression tests

### Fixed
- prevent exports from silently omitting missing clip files
- keep record gesture release working during camera startup
- avoid false export cancellation from React StrictMode effects
- share valid cached exports from the original export tap
- keep project activation separate from project update ordering
- keep preview clip blobs out of React state

## [0.1.1] - 2026-05-17

### Fixed
- keep clip queue ordering stable after deleted clips
- require a fresh action before sharing cached exports
- avoid console errors for expected media-start failures
- cache built app assets during service worker install

### Added
- add route, permission, sharing, and export storage tests
- add Playwright browser tooling for user-flow checks

## [0.1.0] - 2026-05-17

### Added
- add local-first video journal app with projects, capture, and export
- add IndexedDB storage for clips, thumbnails, settings, and exports
- add PWA manifest and service worker app-shell caching
- add unit tests for recording helpers, export cache, and storage
