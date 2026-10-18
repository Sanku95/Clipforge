# ClipForge

A local-first macOS app for cutting long videos into short clips for Shorts, Reels and TikTok.
Everything runs on your Mac: no accounts, no uploads, no telemetry.

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
