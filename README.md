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
npm run test:e2e
```

## Deploy

GitHub Actions deploys version bumps to the `gratis-video-log` Cloudflare Worker with Workers Static Assets. Configure repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

Create the Cloudflare token from **Account API tokens** with the **Edit Cloudflare Workers** permission policy, scoped to the account that owns `gratis-video-log`. If building the policy manually, use:

- `Account / Workers Scripts / Edit`
- `Account / Account Settings / Read`
- `User / User Details / Read` and `User / Memberships / Read` if the token UI offers user policies
- `Zone / Workers Routes / Edit` only when deploying a custom route for a zone

Treat API tokens as single-use secrets. If a token is pasted into chat, logs, or an issue, revoke it and replace the GitHub secret before rerunning deployment.

## Behavior

- Projects, clips, thumbnails, settings, and cached exports are stored in IndexedDB.
- No backend, account, sync, or analytics is included; imported clips stay local.
- Recording supports tap-to-start/tap-to-stop and press-and-hold.
- Recording opens the camera preview, reuses that video stream for the saved clip, and records without MediaRecorder timeslices.
- The capture view uses a full-height preview with floating back, share, settings, record, and clip-list controls.
- Camera preview refreshes itself after the browser returns from the background.
- The preview gear opens media settings for camera selection, audio mode, and bitrate-backed 720p/1080p/4K recording presets; audio defaults to unfiltered and video defaults to 1080p30.
- Multi-camera devices remember the last selected camera, can switch front/back from capture, and show labeled back-camera shortcuts when multiple back cameras are available.
- The clip-list sheet supports local video upload, preview, move earlier/later, and delete actions; clip previews open in a global modal.
- If microphone capture fails or is blocked, recording can continue as video-only with a local notice.
- Settings include media access status, haptics, and optional sound feedback for recording state changes.
- Export remuxes compatible clips losslessly, falls back to canvas re-encoding when needed, then opens the native share sheet from explicit Share taps or downloads as fallback.
- Export waits until recording and clip saving are idle so the queue cannot be shared stale.
- Export compilation remains open until ready or explicitly cancelled.
- Cached exports are reused only while their clips, settings, and stored file remain valid.
- Preloaded cached exports can open native sharing immediately from the export tap.
- Cached exports discovered during an export tap open the export panel so Share has a fresh user action.
- If local caching fails after compilation, the finished export remains available to share or download until the panel closes.
- Cached exports are rejected if clips or settings change while compilation is running.
- Export compilation starts only from an explicit Share/Export action.
- Known hard capture blockers disable recording and show recovery guidance near capture.
- Export controls and saved export preferences are limited to options this browser supports.
- Project rows show when a cached export is ready for the current clips and settings.
- Cached export metadata stays current after project renames and export setting changes.
- Browser diagnostics use Mentie logging; add `?loglevel=info`, `?loglevel=debug`, or `?loglevel=insane` to inspect runtime flow in the console.
- Clearing or deleting the active project keeps the app on project history until another project is opened or created.
- The Vite PWA service worker caches the app shell for offline startup after first load.
- Service-worker updates validate cached build assets before reusing an older app shell.
- Waiting PWA updates show a persistent reload badge.
- Installable browsers show a bottom-left Install App pill when a prompt is available outside PWA mode.
