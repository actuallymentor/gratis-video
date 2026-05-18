# Research

- 2026-05-18: MDN Web media autoplay guidance says script-started media playback with audible tracks can be blocked outside user interaction, while muted media is generally allowed. Keep export playback resilient with muted fallback for detached video elements.
- 2026-05-18: MDN Web Share guidance emphasizes that file sharing depends on `navigator.canShare()` and `navigator.share()` being called from transient user activation. Keep share blobs ready before the user taps Share.
- 2026-05-18: MDN HTMLMediaElement `ended` docs say the event fires when playback reaches the end or no further data is available, but the export path must still tolerate browsers that leave `ended` false near the real end of MediaRecorder blobs.
- 2026-05-18: MDN MediaRecorder `dataavailable` docs warn timing chunks are not exact and can be delayed by browser behavior. Export code should keep bounded stop handling and avoid deriving correctness from chunk cadence.
- 2026-05-18: `actuallymentor/gratis-reader` deploys Vite `dist` output as Cloudflare Workers Static Assets with `wrangler.toml`, `cloudflare/wrangler-action@v3`, and GitHub secrets `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID`; its workflow gates deployment on a `package.json` version differing from the latest GitHub release.
