# Gotchas

- Airier currently peers on ESLint 9 and `globals@15`; the Vite scaffold initially selected newer majors, so keep those dependency ranges compatible unless Airier updates.
- `use-query-params`' React Router 6 adapter imports `react-router-dom`, so the app includes `react-router-dom` even though most app imports use `react-router`.
- Export uses canvas capture plus MediaRecorder and is expected to run close to realtime; test on real mobile browsers before treating it as production-grade.
- Import `log` from `mentie/modules/logging.js` in browser code; the `mentie` barrel import can pull in a Node crypto helper and trigger Vite browser externalization warnings.
- Browser walkthroughs use Playwright Chromium. If the default Vite port is busy, Vite may move from 5173 to the next open port.
- ExportPanel starts export work from a React effect. In development StrictMode, stale effect aborts must be ignored or the UI can show `Export cancelled` even while the current export run should continue.
- IndexedDB version 2 moves thumbnail blobs from clip metadata into the `clip_thumbnails` store. Keep clip metadata lightweight so React state does not retain Blob objects.
- Project rows should only show “Export ready” for cached exports whose settings and clip-manifest hashes still match the current project state.
- If Playwright Chromium fails with missing shared libraries, run `npx playwright install-deps chromium`; this workspace has needed those system packages before browser walkthroughs can run.
- Export compilation is intentionally gated by an in-memory user-action flag. Do not let `?panel=export` or restored URL state start compilation by itself.
- When changing recording startup, keep the `getUserMedia()` stream cleanup path covered for failures that happen after stream acquisition but before `MediaRecorder.start()`.
