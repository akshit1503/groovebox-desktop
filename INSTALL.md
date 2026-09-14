# GrooveBox v3.0 — Complete Install Guide

---

## Table of Contents
1. [Prerequisites](#1-prerequisites)
2. [Download the Source](#2-download-the-source)
3. [Install Dependencies](#3-install-dependencies)
4. [Run the App (Dev Mode)](#4-run-the-app-dev-mode)
5. [Build a Windows .exe Installer](#5-build-a-windows-exe-installer)
6. [Build for Mac](#6-build-for-mac)
7. [Build for Linux](#7-build-for-linux)
8. [Set Up Google Sign-In](#8-set-up-google-sign-in)
9. [Set Up Google Drive (API Key method)](#9-set-up-google-drive-api-key-method)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Prerequisites

You only need **one thing** installed on your computer:

### Node.js (includes npm)

1. Go to **https://nodejs.org**
2. Click the **LTS** button (the green one — "Recommended for most users")
3. Download and run the installer
4. Click Next → Next → Install → Finish
5. **Restart your computer** after installing

**Verify it worked** — open Command Prompt (Windows) or Terminal (Mac/Linux) and run:

```
node --version
npm --version
```

You should see version numbers like `v20.x.x` and `10.x.x`. If you do, you're ready.

---

## 2. Download the Source

### Option A — From GitHub (recommended)

If you have Git installed:
```bash
git clone https://github.com/YOUR_USERNAME/groovebox.git
cd groovebox
```

### Option B — From the ZIP file

1. Download `GrooveBox-v3-Final.zip`
2. Right-click → **Extract All** (Windows) or double-click (Mac)
3. Open the extracted folder `groovebox-v3`
4. Open **Command Prompt** or **Terminal** inside that folder

**How to open Terminal in a folder:**
- **Windows:** Hold `Shift` + right-click inside the folder → "Open PowerShell window here" or "Open Command Prompt here"
- **Mac:** Right-click the folder → "New Terminal at Folder"

---

## 3. Install Dependencies

Inside the `groovebox-v3` folder, run:

```bash
npm install
```

This downloads ~150MB of packages (Electron, electron-builder, electron-store). It only takes a minute. You'll see a lot of text scrolling — that's normal.

When it finishes you'll see something like:
```
added 847 packages in 45s
```

---

## 4. Run the App (Dev Mode)

To launch the app without building:

```bash
npm start
```

The GrooveBox window will open. This is the full app — everything works in dev mode. You can use it like this without ever building an installer.

**To close:** Click the ✕ button in the app, or press `Ctrl+C` in the terminal.

---

## 5. Build a Windows .exe Installer

This creates a proper installer your friends can double-click to install.

```bash
npm run build:win
```

**This takes 2–5 minutes.** When done, look in the `dist/` folder:

```
dist/
  GrooveBox Setup 3.0.0.exe   ← This is your installer
```

### Installing on Windows

1. Double-click `GrooveBox Setup 3.0.0.exe`
2. Windows SmartScreen might say "Windows protected your PC" — click **More info** → **Run anyway**  
   *(This happens because the app isn't code-signed yet. It's safe — it's your own app.)*
3. Choose install location → Install → Finish
4. GrooveBox appears in your Start Menu and on your Desktop

### Uninstalling

Add/Remove Programs → Search "GrooveBox" → Uninstall

---

## 6. Build for Mac

Run this on a Mac:

```bash
npm run build:mac
```

Output: `dist/GrooveBox-3.0.0.dmg`

**Installing on Mac:**
1. Double-click the `.dmg` file
2. Drag GrooveBox into your Applications folder
3. First time: right-click GrooveBox → **Open** → **Open** again  
   *(Required because the app isn't notarized yet)*

---

## 7. Build for Linux

Run this on Linux:

```bash
npm run build:linux
```

Output: `dist/GrooveBox-3.0.0.AppImage`

**Running on Linux:**
```bash
chmod +x GrooveBox-3.0.0.AppImage
./GrooveBox-3.0.0.AppImage
```

---

## 8. Set Up Google Sign-In

Google Sign-In lets you access your Drive music library without pasting API keys. Here's how to set it up — it's free and takes about 10 minutes.

### Step 1 — Create a Google Cloud Project

1. Go to **https://console.cloud.google.com**
2. Sign in with your Google account
3. Click the project dropdown at the top → **New Project**
4. Name it `GrooveBox` → **Create**

### Step 2 — Enable the APIs

1. In the left menu → **APIs & Services** → **Library**
2. Search for **"Google Drive API"** → Click it → **Enable**
3. Go back to Library → search **"People API"** → **Enable**

### Step 3 — Configure OAuth Consent Screen

1. Left menu → **APIs & Services** → **OAuth consent screen**
2. Choose **External** → **Create**
3. Fill in:
   - App name: `GrooveBox`
   - User support email: your email
   - Developer contact: your email
4. Click **Save and Continue** through all steps
5. On the **Test users** step → click **Add users** → add your Gmail address → **Save**

### Step 4 — Create OAuth Credentials

1. Left menu → **APIs & Services** → **Credentials**
2. Click **+ Create Credentials** → **OAuth client ID**
3. Application type: **Desktop app**
4. Name: `GrooveBox Desktop`
5. Click **Create**
6. A popup shows your **Client ID** and **Client Secret** — copy both

### Step 5 — Add to GrooveBox

1. Open GrooveBox
2. Click **Settings** (in the sidebar)
3. Under **Account → Google OAuth Credentials**:
   - Paste your Client ID
   - Paste your Client Secret
   - Click **Save Credentials**
4. Click **Sign in with Google** (in the titlebar)
5. Your browser opens → choose your Google account → Allow
6. Browser shows "✅ Connected!" → return to GrooveBox

You're signed in. Your profile photo appears in the top bar.

---

## 9. Set Up Google Drive (API Key method)

If you don't want to sign in with Google, you can use a free API key just to list files in public Drive folders.

### Step 1 — Get an API Key

1. In Google Cloud Console → **APIs & Services** → **Credentials**
2. Click **+ Create Credentials** → **API key**
3. An API key is created — copy it (looks like `AIzaSy…`)
4. Click **Restrict key** → API restrictions → **Restrict key** → Select **Google Drive API** → **Save**

### Step 2 — Add to GrooveBox

1. Open GrooveBox → **Settings**
2. Under **Google Drive → API Key**
3. Paste your key → **Save**

### Step 3 — Share your Drive folder

1. In Google Drive, right-click your music folder
2. **Share** → click **"Restricted"** → change to **"Anyone with the link"**
3. Click **Copy link**

### Step 4 — Import in GrooveBox

1. Click **Drive Folder Link** in the sidebar
2. Paste the folder link → **Fetch Files**
3. Select which tracks to import → **Import Selected**

---

## 10. Troubleshooting

### "npm is not recognized" or "node is not recognized"
Node.js isn't installed or didn't add itself to PATH.
- Reinstall from https://nodejs.org
- Restart your computer after installing
- Try opening a **new** terminal window

### "npm install" fails with network errors
You might be behind a firewall or proxy.
```bash
npm install --legacy-peer-deps
```

### App opens but shows a blank/black window
Try:
```bash
npm start
```
Look for error messages in the terminal. If you see "electron: command not found", run `npm install` again.

### Windows SmartScreen blocks the installer
Click **More info** → **Run anyway**. This is normal for unsigned apps.

### "Cannot read file" when playing a song
The file was moved or deleted from its original location. Remove it from the library and re-add it.

### Google Sign-In — "redirect_uri_mismatch" error
You forgot to add the redirect URI in Google Cloud Console.
1. Go to Google Cloud Console → Credentials → click your OAuth client
2. Under **Authorized redirect URIs** → **+ Add URI**
3. Add exactly: `http://localhost:42814/oauth2callback`
4. Click **Save** and try signing in again

### Songs from Jamendo/FMA won't play
These require an internet connection to stream. Check your connection. Some tracks may be geo-restricted.

### Build fails on Windows with "ENOENT" errors
Run as Administrator:
1. Search "Command Prompt" → right-click → **Run as administrator**
2. Navigate to your folder and run `npm run build:win` again

---

## Quick Reference

| Command | What it does |
|---------|-------------|
| `npm install` | Install all dependencies (run once) |
| `npm start` | Launch app in dev mode |
| `npm run build:win` | Build Windows .exe installer |
| `npm run build:mac` | Build Mac .dmg |
| `npm run build:linux` | Build Linux AppImage |

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play / Pause |
| `→` | Next track |
| `←` | Previous track |
| `↑` / `↓` | Volume up / down |
| `S` | Toggle shuffle |
| `R` | Toggle repeat |
| `L` | Like current track |
| `F` | Open full player |
| `M` | Open mini player |
| `Esc` | Close any panel |

---

**Questions?** Email **akshitsingh153@gmail.com** or use the Support & Feedback button inside the app.
