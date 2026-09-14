<div align="center">
  <img src="assets/icon.png" width="80" alt="GrooveBox">
  <h1>GrooveBox</h1>
  <p><strong>Your music. No subscription needed.</strong></p>
  <p>
    <a href="https://github.com/YOUR_USERNAME/groovebox/releases/latest">
      <img src="https://img.shields.io/github/v/release/YOUR_USERNAME/groovebox?style=flat-square&color=a78bfa&label=Latest Release">
    </a>
    <img src="https://img.shields.io/badge/platform-Windows%20%7C%20Mac%20%7C%20Linux-blue?style=flat-square&color=2dd4bf">
    <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square&color=34d399">
    <img src="https://img.shields.io/badge/price-Free%20Forever-pink?style=flat-square&color=f472b6">
  </p>
</div>

---

GrooveBox is a free, open-source desktop music player that plays your local files and Google Drive music with Spotify-grade features — visualizer, synced lyrics, playlists, equalizer, likes & ranking, and more.

## Features

| Feature | Details |
|---------|---------|
| 🎛 **10-Band EQ** | Real-time equalizer with reset |
| 🎤 **Synced Lyrics** | Auto-fetched, highlights current line |
| ♥ **Likes & Ranking** | Like tracks, see your top chart |
| 🪟 **Mini Player** | Always-on-top with visualizer |
| 📋 **Playlists** | Unlimited, right-click to add |
| ☁ **Google Drive** | Paste folder link, stream instantly |
| 💾 **Persistent Library** | Add once, always there |
| 🌊 **Live Visualizer** | Real-time frequency display |
| ⚡ **Keyboard Shortcuts** | Full keyboard control |

## Download

👉 **[Download latest release](https://github.com/YOUR_USERNAME/groovebox/releases/latest)**

| Platform | File |
|----------|------|
| Windows 10/11 | `GrooveBox-Setup-*.exe` |
| macOS 12+ | `GrooveBox-*.dmg` |
| Linux | `GrooveBox-*.AppImage` |

## Development

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/groovebox.git
cd groovebox

# Install dependencies
npm install

# Run in development
npm start

# Build for your platform
npm run build:win     # Windows .exe
npm run build:mac     # macOS .dmg
npm run build:linux   # Linux AppImage
```

## Releases

Releases are automated via GitHub Actions. To publish a new release:

```bash
git tag v3.1.0
git push origin v3.1.0
```

GitHub Actions will automatically build for all three platforms and create a release.

## License

MIT © 2025 Akshit Singh · [akshitsingh153@gmail.com](mailto:akshitsingh153@gmail.com)
