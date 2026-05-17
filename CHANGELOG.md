# Changelog

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
