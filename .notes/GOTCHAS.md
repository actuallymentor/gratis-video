# Gotchas

- Airier currently peers on ESLint 9 and `globals@15`; the Vite scaffold initially selected newer majors, so keep those dependency ranges compatible unless Airier updates.
- `use-query-params`' React Router 6 adapter imports `react-router-dom`, so the app includes `react-router-dom` even though most app imports use `react-router`.
- Export uses canvas capture plus MediaRecorder and is expected to run close to realtime; test on real mobile browsers before treating it as production-grade.
- Import `log` from `mentie/modules/logging.js` in browser code; the `mentie` barrel import can pull in a Node crypto helper and trigger Vite browser externalization warnings.
- Browser walkthroughs use Playwright Chromium. If the default Vite port is busy, Vite may move from 5173 to the next open port.
