# Changelog

## v3.2.0 — July 2026

### New: Online/Offline Toggle
- App **launches in Offline mode every session** — no network calls made until you opt in
- Clear **OFFLINE / ONLINE pill in the titlebar** — click to toggle (or press **Ctrl+O**)
- Every online feature gated with a friendly message: YouTube search, Discover playback, Google Drive listing/streaming, Google Sign-In
- Discover tab shows a clear "Enable Online to search" banner in offline mode
- Local files play with zero network activity


## v3.1.0 — July 2026

### Fixed
- Discover search broken on first use (default source pointed at a source with no search branch)

### New
- One-click "Install Automatically" button for the yt-dlp YouTube audio engine — downloads from GitHub to the app's data folder, no terminal needed
- Per-source search hints and full/preview badges in Discover results


## v3.0.0 — June 2025

### New Features
- **Persistent Library** — tracks copied to app data, survive reboots
- **Google Drive** — paste any public folder link to stream cloud music
- **Playlists** — create, rename, delete; right-click to add tracks
- **Likes & Ranking** — cumulative likes, 🥇🥈🥉 medals, Top Ranked view
- **10-Band Equalizer** — real-time EQ with reset button
- **Mini Player** — always-on-top compact player with visualizer
- **Queue Panel** — Playing Next + History views
- **Keyboard Shortcuts** — Space, arrows, S, R, L, F, M
- **Support & Feedback** — sends email to developer directly

### Improvements
- Full audio MIME type map — all formats now play correctly
- AudioContext properly initialized and resumed
- Event delegation throughout — no more broken buttons
- EQ filters correctly connected in audio chain
- Progress bar always visible with gradient fill

## v2.0.0 — May 2025
- Initial release with local library + Google Drive OAuth
