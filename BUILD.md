# GrooveBox v3.0 — Complete Setup Guide

## ⚡ Quick Start (Run without building)
```
npm install
npm start
```

## 🏗 Build Windows .exe installer
```
npm install
npm run build:win
```
→ Find your installer at: `dist/GrooveBox Setup 3.0.0.exe`

## 🏗 Build for other platforms
```
npm run build:mac     # macOS DMG
npm run build:linux   # Linux AppImage
```

---

## 🎵 Features

### Persistent Local Library
Files are **copied** to the app's data folder on first import. Reopen the app anytime — your library is always there.

### ☁ Google Drive (No Login Required)
1. Share your Drive folder → "Anyone with the link can view"
2. Get a free API key: console.cloud.google.com → Enable Drive API → Credentials → Create API Key
3. In GrooveBox: sidebar → "Drive Folder Link" → paste folder URL + API key → Fetch Files → Import

### 📋 Playlists
- Click **+** next to Playlists in sidebar to create
- Right-click any track → add to playlist
- ⋯ button to rename/delete

### ♥ Likes & Ranking
- Click ♥ on any track to like (each click = +1)
- 🥇🥈🥉 medals on top-3 liked tracks
- "Top Ranked" view + "Most Liked" sort

### 🎧 Discover (Spotify + YouTube Music)
Sidebar → "Discover" → search — results come from both Spotify (for accurate
metadata) and YouTube Music (for full-length playback) in one search box.
Requires your own free API keys — set up on first launch, or later in Settings.

### 🎛 Equalizer
Full 10-band EQ in the Full Player.

### 🪟 Mini Player
Always-on-top compact player with waveform visualizer.
Press **M** or click the mini player icon in the controls.

### 💬 Support & Feedback
Sidebar → "Support & Feedback" → opens your mail app addressed to the developer.

---

## ⌨️ Keyboard Shortcuts
| Key       | Action           |
|-----------|------------------|
| Space     | Play / Pause     |
| →         | Next track       |
| ←         | Previous track   |
| ↑ / ↓     | Volume +/- 5%    |
| S         | Toggle shuffle   |
| R         | Toggle repeat    |
| L         | Like current     |
| F         | Full player      |
| M         | Mini player      |
| Esc       | Close panels     |

---

## 🔧 Troubleshooting

**Google Drive shows "No files found"**
→ Make sure the folder is set to "Anyone with the link can view"
→ Make sure your API key has Google Drive API enabled

**Mini player doesn't appear**
→ Check Windows taskbar — it may be hidden. Press M again to toggle.

**Discover search returns nothing**
→ Make sure you're in Online mode (titlebar pill, or Ctrl+O) and have entered
a valid Spotify Client ID/Secret and/or YouTube Data API key in Settings.
