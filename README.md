# Daily Video Journal

Local-first web app for recording short video snippets throughout a day and exporting them as one shareable file.

## Run

```bash
npm install
npm run dev
```

Camera and microphone access require a secure browser context: `localhost`, HTTPS, or another browser-accepted secure origin.

## Commands

```bash
npm run dev
npm run build
npm run lint
npm test
```

## Behavior

- Projects, clips, thumbnails, settings, and cached exports are stored in IndexedDB.
- No backend, account, sync, analytics, or upload path is included.
- Recording supports tap-to-start/tap-to-stop and press-and-hold.
- If microphone capture fails or is blocked, recording can continue as video-only with a local notice.
- Settings include media access status, haptics, and optional sound feedback for recording state changes.
- Export compiles clips on demand in queue order, preserves orientation when scaling, then offers native sharing when available or a download fallback.
- Cached exports are reused only while their clips, settings, and stored file remain valid.
- Export compilation starts only from an explicit Share/Export action.
- Known hard capture blockers disable recording and show recovery guidance near capture.
- Export controls appear only when this browser supports the export pipeline.
- Project rows show when a cached export is ready for the current clips and settings.
- Cached export metadata stays current after project renames and export setting changes.
- The PWA service worker caches the app shell for offline startup after first load.
