# Changelog

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
