# ClipForge

A local-first macOS app for cutting long videos into short clips for Shorts, Reels and TikTok.
Everything runs on your Mac: no accounts, no uploads, no telemetry.

## Website version

The same editor runs in the browser: **https://sanku95.github.io/Clipforge/** (deployed from the `browser-local` branch by GitHub Actions).

- Your video stays on your device. Nothing is uploaded; there is no server.
- Media work uses **ffmpeg.wasm** (single-threaded, bundled with the site, so no special hosting headers are needed).
- Imports MP4/MOV/WebM, and also MKV/AVI: formats the browser cannot play are read with FFmpeg and a small 360p preview copy is made for the editor (this takes roughly 0.4x real time, e.g. about 75 s for a 3-minute 1080p file).
- Exports are real **H.264/AAC MP4** files that are re-opened and checked. Expect about 0.8x real time for 1080p sources.
- Limits: very large files are bounded by browser memory; preview playback needs a browser that can play H.264 (Chrome, Edge, Safari, Firefox on most systems).
- Not built yet in either version: transcription, AI highlights, captions, face-aware framing.

## AI clipping with Ssemble (Vercel)

The dashboard includes an optional Ssemble AI-clipping panel. It submits a standard YouTube video URL to Ssemble, then checks job status and displays the generated clip links. Ssemble processes the source on its service; this is **not** a local download of the original video. You can open/download generated clips and then import a downloaded clip into ClipForge's local editor.

To enable this integration:

1. Deploy this repository to Vercel (the `vercel.json` config builds the Vite app and exposes the `api/` functions).
2. Obtain an active Ssemble API subscription and API key from Ssemble. Each generation request consumes one credit; Ssemble's API docs say processing typically takes 5–30 minutes.
3. In Vercel → Project → Settings → Environment Variables, add `SSEMBLE_API_KEY` with your key. Do **not** put the key in frontend code or a `VITE_*` variable.
4. Redeploy the project after adding the environment variable.

The GitHub Pages deployment remains a static local editor and does not host the `/api` endpoints; the Ssemble panel requires the Vercel deployment. AI clipping sends the YouTube URL to Ssemble for server-side processing, so only submit videos you have the rights and permission to process. Review Ssemble's current terms and applicable platform rules before public use.

Official API docs: https://www.ssemble.com/docs and https://www.ssemble.com/docs/endpoints/create-short.

## What works today

| Feature | Status |
| --- | --- |
| Import a local video with the native file picker (MP4, MOV, M4V, MKV, WebM, AVI) | Implemented |
| Project list with filename, duration, resolution and status, stored locally | Implemented |
| Video preview, timeline with draggable in/out handles, exact time entry | Implemented |
| Multiple clips per video: add, rename, review, update, remove | Implemented |
| Export as 9:16, 1:1, 16:9 or original framing, with adjustable fixed crop | Implemented |
| Real export progress, cancel, output folder choice, "Show in Finder" | Implemented |
| Safety: source never modified, existing files never overwritten, bad ranges / missing media / low disk space / FFmpeg errors reported | Implemented |
| Every export is re-opened and checked (size, duration, dimensions) | Implemented |
| Local transcription (Whisper), AI highlight suggestions, captions | **Planned, not in this version** |
| Face-aware framing | **Planned, not implemented** (the crop is a fixed position you choose) |

See the in-app **Roadmap** page. Nothing marked planned is simulated.

## Install

Download the DMG from the **Releases** page of this repository:

- Apple menu → **About This Mac**. If it says **Chip: Apple M…** use `ClipForge_aarch64.dmg`; if it says **Processor: Intel** use `ClipForge_x86_64.dmg`.
- Open the DMG and drag **ClipForge** into **Applications**.
- **First launch:** the app is not signed with an Apple Developer ID and is not notarized (that needs a paid Apple Developer Program membership), so macOS blocks it once. Open **System Settings → Privacy & Security**, scroll down, and click **Open Anyway** next to the ClipForge message. On macOS 14 or earlier you can instead right-click the app and choose **Open**.

You do not need to install Node, Rust, FFmpeg or anything else: FFmpeg is bundled.

## How it is built

- **UI:** React + TypeScript + Tailwind (Vite), in a **Tauri v2** shell.
- **Media core** (`crates/clipforge-core`): Rust. Probing, crop geometry, FFmpeg export with real progress, output verification, atomic project storage. No GUI dependencies, so it is tested headlessly against a real FFmpeg.
- **FFmpeg / FFprobe:** compiled from official source in CI (`scripts/build-ffmpeg-macos.sh`) with x264, natively for each architecture, checked to link only macOS system libraries and to not be `--enable-nonfree`. They are GPL; see `src-tauri/resources/THIRD_PARTY_NOTICES.md`.
- **CI** (`.github/workflows/build-macos.yml`): builds Apple Silicon and Intel on macOS runners, mounts the produced DMG, checks the bundle, verifies the code signature, runs the app's `--selftest` (real exports of all four presets with the bundled FFmpeg) from the installed copy, and publishes a pre-release when you push a `v*` tag or run the workflow with a release tag.

### Build it yourself

Needs Node 20+, Rust, Xcode command line tools, `nasm` and `pkgconf`:

```bash
bash scripts/build-ffmpeg-macos.sh   # one-time, ~10 minutes
npm ci
npx tauri build                       # → target/release/bundle/dmg/
```

### Develop / test

```bash
npm test                              # frontend unit tests
cargo test -p clipforge-core          # core unit + end-to-end tests (needs ffmpeg on PATH)
```

## Privacy

Videos are read and processed locally. The app has no network features and no analytics. Project data is one JSON file in the app's data folder (`~/Library/Application Support/app.clipforge.desktop/projects.json`).
