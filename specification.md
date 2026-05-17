# Specification: Local-First Daily Video Journal

Last researched: 2026-05-17

## Purpose

Build a mobile-first web app for recording short video snippets throughout a day and exporting them as a single shareable video file.

The app is for someone who wants to document what they are doing without managing an editing workflow. They should be able to open the app, record a short clip in seconds, close the app, and repeat that throughout the day. The app stores everything locally in the browser. There is no backend, account system, sync, or cloud upload.

## Product Principles

- Fast capture is the core product. Recording a clip must require as little thought as opening the app and pressing the record control.
- The app opens to the currently active project when one exists. The project list is still available as the home/history view.
- Projects are not purely date-based. A user may create multiple projects in one day, and each project may contain many clips.
- Recording completion is silent and immediate. When recording stops, the clip is added to the project queue without a modal or naming step.
- Export/share is explicit. Compiling video is potentially heavy, so it happens when the user asks to share/export or when a cached export is stale.
- Use browser feature detection at runtime. Media, codec, storage, and sharing support differ across browsers and devices.

## Preferred Implementation Stack

Use the user's local preferences:

- JavaScript, not TypeScript.
- React in frontend mode, built with Vite.
- Node 24 LTS with `.nvmrc`.
- Run the `airier` quickstart scaffold during project setup.
- Install and use `mentie`; use `log` instead of `console`.
- Use `styled-components` for styling.
- Use `react-router` with `BrowserRouter`.
- Use `zustand` for shared app state.
- Use `use-query-params` where view state belongs in the URL.
- Use `react-hot-toast` only for brief, non-blocking feedback.
- Use `lucide-react` icons for UI controls.
- Follow Atomic Design-inspired structure:

```text
src/
  App.jsx
  index.jsx
  index.css
  assets/
  components/
    atoms/
    molecules/
    pages/
  hooks/
  modules/
    export/
    media/
    permissions/
    sharing/
    storage/
  routes/
    Routes.jsx
  stores/
```

## Target Platforms

Primary:

- Mobile browsers on iOS and Android.
- Installed PWA behavior when the user adds the app to the home screen.

Secondary:

- Desktop and laptop browsers.

Hard requirements:

- The app must run in a secure context for camera/microphone access: HTTPS, localhost, or another browser-accepted secure origin.
- The app must remain usable without network access after initial load if implemented as a PWA.
- The app must not send video, audio, metadata, telemetry, or logs to a server.

## Main User Flow

1. User opens the app.
2. App checks local storage and permission state in the background without triggering camera/microphone permission prompts.
3. If an active project exists, app opens that project.
4. If no active project exists, app opens the project list/home screen.
5. User creates or opens a project.
6. User records short clips during the day.
7. Each completed clip is appended to the project's clip queue.
8. User taps Share/Export.
9. App compiles the queued clips into a single video file or reuses a valid cached export.
10. If a valid cached export already exists, app may open the native share sheet immediately.
11. If compilation was required, app shows a ready state with an explicit Share button because native sharing requires a fresh user action.
12. App opens the native share sheet when supported, or offers a download/save fallback.

## Routes

- `/` resolves to the active project when one exists, otherwise to `/projects`.
- `/projects` shows the project list and empty state.
- `/projects/:project_id` shows the capture screen and clip queue for one project.
- `/settings` shows global recording/export/accessibility settings.

Keep route state meaningful. Do not encode large transient media state in the URL.

## Screens

### Project List

Purpose:

- Show previously created projects.
- Let the user create a new project.
- Let the user open settings.

Content:

- A list of projects sorted by `updated_at` descending.
- Each project item shows title, created date, clip count, total duration, and export status when relevant.
- The active project should be visually indicated.
- Empty state: quiet, useful, and direct. Include a prominent plus action. Avoid marketing copy.

Controls:

- Bottom app bar with a centered Create Project button using a plus icon.
- Settings icon in a consistent secondary location.
- Project item menu for rename/delete if needed.

Project creation:

- Create a project immediately with a sensible default title like `May 17, 2026` or `May 17, 2026 - 2` when there is already a project for that date.
- Set the new project as active.
- Navigate directly to its capture screen.
- Allow inline rename later; do not require a naming modal before capture.

### Project Capture Screen

Purpose:

- Make recording the next clip the dominant task.
- Show enough queue context to build trust that clips were saved.

Content:

- Live camera preview when permission has been granted and a stream is active.
- If permission is unknown, show a ready state with the record control.
- If permission is denied, show a concise, local message near the record control with a route to settings/help.
- Clip queue with thumbnails, duration, and creation time.
- Share/export button.

Controls:

- Bottom app bar with the record button centered.
- Record button must be at least 72 CSS px visually and at least 48 CSS px touch target.
- Share/export icon should be obvious and reachable, but secondary to recording.
- Back/home access to project list.

Clip queue actions:

- Delete clip.
- Preview clip.
- Optional for MVP: reorder clips by drag handle or simple move controls.

Recording behavior:

- First actual recording attempt calls `getUserMedia()` and may trigger browser permission.
- Stop all active media tracks when leaving the capture screen unless actively recording must continue by explicit design. MVP should stop tracks to reduce privacy concern and battery use.
- If the tab is hidden, the app is backgrounded, or a pointer is cancelled while recording, stop recording and save the partial clip if valid.

### Settings

Purpose:

- Configure defaults without burdening the capture flow.

Settings:

- Export format: show only options supported on the current browser/device.
- Export quality: standard/high, mapped to bitrate presets.
- Export resolution: source/default, 720p, 1080p where supported.
- Haptics: on/off.
- Sound feedback: off by default; optional on/off.
- Storage usage: show estimated local usage and quota when available.
- Storage persistence: show whether persistent storage was granted when available.
- Destructive action: delete all local data, with a clear confirmation.

Do not show codec settings before the browser has proved support for them.

## Recording Interaction

The record button supports both tap-to-toggle and press-and-hold.

Use pointer events so touch, mouse, and stylus share the same logic.

Recommended interaction algorithm:

1. On `pointerdown` while inactive, start recording immediately.
2. Save `pointer_down_started_at`.
3. On `pointerup` before `hold_threshold_ms` (recommended: 250 ms), classify the gesture as a tap and keep recording.
4. On the next tap while recording in tap mode, stop recording.
5. On `pointerup` after `hold_threshold_ms`, classify the gesture as hold and stop recording immediately.
6. On `pointercancel`, `visibilitychange`, route change, or stream error while recording, stop recording and save if a valid clip exists.

Clip validation:

- Ignore or discard clips below `minimum_clip_ms` (recommended: 400 ms) unless browser behavior makes that unsafe.
- Surface a small, non-blocking message if a clip is too short.

Feedback:

- While recording, show a clear recording state using more than color: changed icon, label, ring, timer, or motion.
- Use red/warm recording color only for the active recording state.
- Use haptics on start/stop when available and enabled.
- Avoid routine sounds by default.

## Browser APIs And Technical Decisions

### Permissions

Use `navigator.permissions.query()` for a background read of `camera` and `microphone` permission state when supported. Wrap each query in `try/catch` because unsupported permission names reject in some browsers.

Do not call `getUserMedia()` during background checks because it can trigger a permission prompt. Only call it after a user action that clearly intends to record.

Required behavior:

- Detect insecure context and show that recording requires HTTPS/localhost.
- Detect missing `navigator.mediaDevices?.getUserMedia`.
- Track permission states: `unknown`, `prompt`, `granted`, `denied`, `unsupported`.
- Handle camera or microphone denial independently.

Research basis:

- MDN documents that `getUserMedia()` requires a secure context and user permission before opening camera/microphone.
- MDN documents that Permissions API can query `camera` and `microphone`, but unsupported names may reject.

### Capture

Use `MediaRecorder` for MVP capture.

Reasons:

- It is widely available across modern browsers.
- It records directly from the `MediaStream`.
- It can be configured with runtime-tested MIME/container options.

At recording startup:

- Build a candidate MIME type list.
- Pick the first candidate where `MediaRecorder.isTypeSupported(candidate)` returns true.
- Fall back to omitting `mimeType` and let the browser choose.

Preferred candidate order:

1. `video/mp4;codecs=avc1.42E01E,mp4a.40.2`
2. `video/mp4`
3. `video/webm;codecs=vp9,opus`
4. `video/webm;codecs=vp8,opus`
5. `video/webm`

Do not hardcode a single browser assumption. Store the actual `recorder.mimeType` with each clip.

### Local Storage

Use IndexedDB for projects, metadata, thumbnails, clips, and cached exports.

Reasons:

- IndexedDB is intended for significant structured local data and can store files/blobs.
- It is asynchronous and does not block the UI like localStorage.

Use `localStorage` only for tiny boot preferences if needed, such as last active project id. Prefer IndexedDB as the source of truth.

Use `navigator.storage.estimate()` when available to show local storage usage and warn before storage is likely to run out.

Call `navigator.storage.persist()` after the user creates a project or saves the first clip. Treat failure as non-fatal; browsers may deny persistence based on their own rules.

The UI must explain that data lives on this device/browser and can be removed by clearing site data.

### Export/Compile

MVP export should compile on demand.

Recommended MVP strategy:

- Re-render clips sequentially into a canvas.
- Capture the canvas stream.
- Route audio through Web Audio when available.
- Record the combined output using `MediaRecorder`.
- Cache the resulting export blob with a hash of clip ids, clip versions, and export settings.

Why this strategy:

- It avoids shipping a heavy WebAssembly video stack for the first version.
- It uses browser-native primitives already needed for capture.
- It works with mixed original clip containers because each clip is decoded by the browser before being re-recorded.

Tradeoff:

- Export may run close to realtime. A two-minute project may take about two minutes to compile.

Required export UX:

- When the user taps Share/Export and no valid cached export exists, show a compile progress view.
- Progress must be bounded and specific, preferably percentage complete.
- Keep the user on the export flow until compilation completes or is cancelled.
- After compilation completes, show a clear Share button rather than trying to open the native share sheet automatically.
- Make cancellation explicit.
- Do not start expensive export work continuously in the background by default.

Advanced export option for later:

- Use WebCodecs plus a muxing library if faster or higher-quality export becomes necessary.
- WebCodecs alone is not enough to write a playable video file; it encodes/decodes media chunks but needs muxing for containers like MP4/WebM.
- Consider a muxing library such as Mediabunny only when the MVP export path is insufficient.

Codec settings:

- H.264 in MP4 is the pragmatic default when supported because it is broadly compatible with third-party apps.
- VP9 in WebM is a good fallback where MP4/H.264 recording is unavailable.
- H.265/HEVC must not be the default. Expose it only if the browser supports it and mark it as a compatibility-oriented advanced setting.
- AV1 must not be the default for mobile export unless runtime tests show practical encoding support and acceptable performance.

### Sharing

Use Web Share API for native sharing when available.

Flow:

1. Retrieve a valid cached export blob, or compile one if no valid cache exists.
2. Create a `File` with a friendly filename and accurate MIME type.
3. Check `navigator.canShare?.({ files: [ file ] })`.
4. If a valid cached export was available before the tap, call `navigator.share({ files: [ file ], title, text })` from that same user interaction when supported.
5. If compilation was required, wait for the user to tap the post-compile Share button, then call `navigator.share({ files: [ file ], title, text })` from that fresh user interaction when supported.
6. If unsupported or sharing fails with a non-cancel error, provide a download link fallback.

Important behavior:

- The app cannot guarantee WhatsApp or any specific app appears in the share sheet. That is controlled by the OS, browser, installed apps, file type, and share target support.
- Treat user cancellation as a normal outcome, not an error toast.
- For desktop browsers, the fallback download path is expected and acceptable.

Research basis:

- MDN documents that file sharing should be tested with `navigator.canShare()` and that `share()` requires transient user activation.

## Data Model

Use stable ids generated client-side. `crypto.randomUUID()` is acceptable when available.

### Project

```js
{
    id: `uuid`,
    title: `May 17, 2026`,
    created_at: `2026-05-17T19:00:00.000Z`,
    updated_at: `2026-05-17T19:00:00.000Z`,
    active_at: `2026-05-17T19:00:00.000Z`,
    clip_count: 0,
    total_duration_ms: 0,
    export_settings: null
}
```

### Clip

```js
{
    id: `uuid`,
    project_id: `uuid`,
    order_index: 0,
    blob: Blob,
    mime_type: `video/webm;codecs=vp8,opus`,
    duration_ms: 2500,
    width: 1280,
    height: 720,
    created_at: `2026-05-17T19:05:00.000Z`,
    thumbnail_blob: Blob,
    deleted_at: null
}
```

### Export

```js
{
    id: `uuid`,
    project_id: `uuid`,
    blob: Blob,
    mime_type: `video/mp4`,
    filename: `may-17-2026.mp4`,
    settings_hash: `hash`,
    clip_manifest_hash: `hash`,
    duration_ms: 42000,
    created_at: `2026-05-17T20:00:00.000Z`
}
```

### Settings

```js
{
    export_quality: `standard`,
    export_resolution: `source`,
    preferred_mime_type: null,
    haptics_enabled: true,
    sounds_enabled: false
}
```

## State Management

Use Zustand for cross-screen app state:

- Active project id.
- Permission status.
- Current media stream state.
- Recording state.
- Export progress.
- Storage quota estimate.

Keep large blobs out of Zustand. Store blobs in IndexedDB and load them by id.

## Visual And Interaction Design

Use a restrained, task-first interface. This is a tool, not a landing page.

Brand defaults:

- Accent: `#7ec0d0`.
- Heading font: `"Montserrat Variable", system-ui, -apple-system, "Segoe UI", sans-serif`.
- Body font: `"Nunito Variable", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif`.

Layout:

- Mobile first.
- Bottom app bar is consistent across project list and capture screens.
- Frequent actions live near the bottom edge.
- On desktop, use a wider layout with project navigation and capture context visible where practical. Do not create decorative device frames.
- Avoid nested cards. Use cards only for repeated project/clip rows or modal-like surfaces.

Controls:

- Use icon buttons with accessible labels/tooltips.
- Use lucide icons rather than hand-drawn SVG icons when available.
- Use toggles for binary settings, segmented controls for export mode/quality, sliders or steppers for numeric values.
- Minimum touch target: 48 CSS px.

Typography:

- Do not override root font size.
- Use `rem` for text/layout sizing.
- Keep line length under 65 characters in prose-like settings/help content.
- Do not use viewport width to scale font size.

Color:

- Do not encode state by color alone.
- Use brightness contrast, icon shape, label, and motion where needed.
- Avoid a one-note palette. Use neutral surfaces, strong text contrast, the accent color sparingly, and red only for recording/destructive states.

Animation:

- Use short transitions only to communicate state changes.
- Micro-interactions: 100-200 ms.
- Screen transitions: 200-350 ms.
- No decorative animation.

Accessibility:

- Every icon-only control needs an accessible label.
- Buttons must support keyboard operation.
- Recording must work with pointer and keyboard controls.
- Export progress must be announced with appropriate ARIA live behavior.
- Respect reduced motion.
- Keep haptics and sounds independently configurable.

## Error States

Handle these explicitly:

- Insecure context: explain that camera/microphone require HTTPS or localhost.
- Camera unavailable.
- Microphone unavailable.
- Permission denied.
- MediaRecorder unsupported.
- No supported MIME type found. Fall back to default MediaRecorder constructor before failing.
- Storage unavailable.
- Storage quota low or exceeded.
- Clip save failure.
- Export failure.
- Share unsupported.
- Share cancelled by user.

Failure style:

- Put critical messages near the user's current focus.
- Use concise text.
- Offer the next action when one exists.
- Do not blame the user.

## Performance Requirements

- App shell should load quickly on mobile.
- Recording start should feel immediate after pointer down.
- Clip save should complete without blocking the UI.
- Generate thumbnails asynchronously.
- Avoid loading every clip blob into memory at once.
- Export should process clips sequentially and release object URLs, video elements, tracks, and audio nodes after use.
- Large exports must show progress and must not freeze the UI.

## Privacy And Security

- No backend.
- No analytics by default.
- No remote video processing.
- No third-party upload.
- Camera/microphone permission is requested only from a user action.
- Stop media tracks when not actively needed.
- Make local-only storage clear in settings.
- Let users delete all local data.

## PWA Requirements

Implement as a PWA unless there is a clear blocker:

- Web app manifest.
- App icon placeholders or real generated assets.
- Service worker for app shell caching.
- Offline startup after first visit.
- Clear handling when media APIs are unavailable offline due to browser/platform policy.

Do not make PWA install a prerequisite for use.

## Acceptance Criteria

Core:

- User can create a project without a modal.
- New project becomes active and opens immediately.
- App reopens to the active project.
- User can record with press-and-hold.
- User can record with tap-to-start and tap-to-stop.
- Stopped clips appear in the queue without a dialog.
- Clips persist after reload.
- User can delete a clip.
- User can export all clips in queue order.
- User can share via native share sheet when supported.
- User can download the export when native file sharing is unavailable.
- User can see and change supported export settings.

Technical:

- No network calls are required for normal use after app load.
- No backend code or server persistence exists.
- Camera/microphone prompts are not triggered by passive app load.
- Runtime feature detection controls media, codec, storage, and sharing behavior.
- Blob data is stored outside React state.
- Media streams and object URLs are cleaned up.

Design:

- First screen is the actual app, not a marketing landing page.
- Main controls fit and do not overlap at mobile and desktop widths.
- Bottom record/create action remains stable across screens.
- Recording state is clear without relying only on color.
- Touch targets meet the minimum size.

## Testing Guidance

Automated:

- Unit-test storage modules with fake IndexedDB where practical.
- Unit-test recording gesture classification.
- Unit-test export cache invalidation by clip/settings hash.
- Unit-test MIME candidate selection with mocked `MediaRecorder.isTypeSupported`.

Browser/manual:

- Test mobile viewport with Playwright.
- Test desktop viewport with Playwright.
- Test fake media stream in Chromium where possible.
- Test denied camera permission.
- Test denied microphone permission.
- Test reload persistence after recording.
- Test low storage behavior with mocked `navigator.storage.estimate`.
- Test native share path on at least one real mobile browser.
- Test download fallback on desktop.

## Out Of Scope For MVP

- Accounts.
- Cloud sync.
- Backend storage.
- Multi-device continuity.
- Collaborative projects.
- AI-generated edits.
- Filters, stickers, captions, or timeline effects.
- Background auto-export without user intent.
- Direct integration with a specific app such as WhatsApp beyond the OS/browser share sheet.

## Research References

- MDN MediaRecorder: https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder
- MDN getUserMedia: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
- MDN Permissions API: https://developer.mozilla.org/en-US/docs/Web/API/Permissions_API
- MDN Permissions query: https://developer.mozilla.org/en-US/docs/Web/API/Permissions/query
- MDN IndexedDB: https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API
- MDN StorageManager estimate: https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/estimate
- MDN StorageManager persist: https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist
- MDN Web Share API share: https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share
- MDN WebCodecs: https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API
- MDN WebCodecs codec selection: https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API/Codec_selection
