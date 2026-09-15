const { app, BrowserWindow, ipcMain, dialog, shell, protocol, Menu, session, safeStorage, nativeImage } = require('electron');
const path   = require('path');
const fs     = require('fs');
const http   = require('http');
const https  = require('https');
const url    = require('url');
const crypto = require('crypto');
const Store  = require('electron-store');
const mm = require('music-metadata');

// Without this, Windows' System Media Transport Controls (the media
// overlay/lock-screen widget the OS shows for whatever's currently
// playing) has no registered identity to look up — it falls back to
// "Unknown app" with no icon, even though the media key handlers and
// MediaMetadata artwork are wired up correctly on the renderer side.
app.setName('GrooveBox');
if (process.platform === 'win32') app.setAppUserModelId('com.groovebox.app');

// setAppUserModelId() alone only tags this process's AUMID — for an
// unpackaged/dev-mode app (no installer, no Start Menu shortcut),
// Windows Shell has nowhere to look up that AUMID's friendly name, so
// the SMTC "Now Playing" flyout falls back to "Unknown app". This is
// the same per-user registry registration Microsoft documents for
// desktop-app toast notifications, and Shell reuses it to resolve the
// app name/icon for SMTC too.
function registerAumidForSmtc() {
  if (process.platform !== 'win32') return;
  try {
    const { execFile } = require('child_process');
    const key = 'HKCU\\Software\\Classes\\AppUserModelId\\com.groovebox.app';
    const iconPath = path.join(__dirname, 'assets', 'icon.ico');
    const set = (name, value) => execFile('reg', ['add', key, '/v', name, '/t', 'REG_SZ', '/d', value, '/f'], () => {});
    set('DisplayName', 'GrooveBox');
    set('IconUri', iconPath);
  } catch (e) {}
}
registerAumidForSmtc();

const store = new Store();
let mainWindow, miniWindow;

const MUSIC_DIR = path.join(app.getPath('userData'), 'music_library');
if (!fs.existsSync(MUSIC_DIR)) fs.mkdirSync(MUSIC_DIR, { recursive: true });

// ── Single instance lock ──────────────────────────────────────────
// Prevents two copies fighting over the same GPU/disk cache folder
// (the root cause of the "Unable to move the cache: Access is denied"
// errors), and prevents two windows both claiming local playback.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ── Encrypted secret storage ──────────────────────────────────────
// Sensitive values (OAuth tokens, API keys) are encrypted at rest with
// Electron's safeStorage (OS keychain/DPAPI-backed) instead of being
// written to electron-store's plaintext JSON file.
const SENSITIVE_KEYS = new Set([
  'googleTokens', 'googleProfile', 'googleClientId', 'googleClientSecret',
  'driveApiKey', 'ytApiKey',
]);

function secureSet(key, value) {
  if (SENSITIVE_KEYS.has(key) && value != null && safeStorage.isEncryptionAvailable()) {
    const enc = safeStorage.encryptString(JSON.stringify(value));
    store.set(key, { __enc: true, data: enc.toString('base64') });
  } else {
    store.set(key, value);
  }
}

function secureGet(key, def = null) {
  const raw = store.get(key, def);
  if (raw && typeof raw === 'object' && raw.__enc && safeStorage.isEncryptionAvailable()) {
    try {
      const decrypted = safeStorage.decryptString(Buffer.from(raw.data, 'base64'));
      return JSON.parse(decrypted);
    } catch (e) { return def; }
  }
  return raw;
}

const OAUTH_REDIRECT = 'http://localhost:42814/oauth2callback';
const GOOGLE_SCOPES  = [
  'openid', 'email', 'profile',
  'https://www.googleapis.com/auth/drive.readonly'
].join(' ');

// ── Window creation ───────────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1300, height: 840, minWidth: 980, minHeight: 660,
    frame: false, backgroundColor: '#08080f',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      nodeIntegration: false, contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true,
    },
    show: false,
  });
  mainWindow.loadFile('index.html');
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
    if (miniWindow && !miniWindow.isDestroyed()) miniWindow.close();
  });
}

// ── Taskbar thumbnail toolbar (Win) ─────────────────────────────────
// The hover preview over the taskbar icon shows the window thumbnail
// but has no transport controls unless the app explicitly registers
// them via setThumbarButtons — Electron can't derive them from the
// renderer's <audio> controls automatically. Icons are rasterized in
// the renderer (reusing the existing play/pause/prev/next glyphs) and
// handed over as PNG data URLs since nativeImage needs real bitmaps.
let thumbarIcons = null, thumbarPlaying = false;
function updateThumbar() {
  if (!mainWindow || mainWindow.isDestroyed() || !thumbarIcons) return;
  mainWindow.setThumbarButtons([
    { icon: thumbarIcons.prev, tooltip: 'Previous', click: () => mainWindow.webContents.send('thumbar-cmd', 'prev') },
    { icon: thumbarPlaying ? thumbarIcons.pause : thumbarIcons.play, tooltip: thumbarPlaying ? 'Pause' : 'Play', click: () => mainWindow.webContents.send('thumbar-cmd', 'playpause') },
    { icon: thumbarIcons.next, tooltip: 'Next', click: () => mainWindow.webContents.send('thumbar-cmd', 'next') },
  ]);
}
ipcMain.handle('set-thumbar-icons', (_, icons) => {
  try {
    thumbarIcons = {
      prev: nativeImage.createFromDataURL(icons.prev),
      play: nativeImage.createFromDataURL(icons.play),
      pause: nativeImage.createFromDataURL(icons.pause),
      next: nativeImage.createFromDataURL(icons.next),
    };
    updateThumbar();
  } catch (e) {}
});
ipcMain.handle('set-thumbar-playing', (_, playing) => { thumbarPlaying = !!playing; updateThumbar(); });

function createMiniWindow() {
  if (miniWindow && !miniWindow.isDestroyed()) { miniWindow.focus(); return; }
  miniWindow = new BrowserWindow({
    width: 380, height: 108, frame: false, alwaysOnTop: true,
    // Genuinely transparent — not just colour-matched — so the 14px
    // rounded corners in mini.html's CSS are actually rounded rather
    // than a rounded shape drawn on top of a square opaque window.
    transparent: true, backgroundColor: '#00000000', resizable: false, hasShadow: false,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') },
  });
  miniWindow.loadFile('mini.html');
  mainWindow.hide();
  miniWindow.on('closed', () => {
    miniWindow = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show(); mainWindow.focus();
      mainWindow.webContents.send('mini-cmd', 'open-full-player');
    }
  });
}

if (gotLock) {
  app.whenReady().then(() => {
    protocol.registerFileProtocol('localfile', (req, cb) => {
      const requested = path.normalize(decodeURIComponent(req.url.replace('localfile://', '')));
      if (!requested.startsWith(MUSIC_DIR)) { cb({ error: -6 /* FILE_NOT_FOUND */ }); return; }
      cb({ path: requested });
    });
    // Without an explicit handler Electron's default permission
    // behavior for newer permission types (like the Audio Output
    // Devices API's 'speaker-selection', needed for setSinkId — used
    // by the Settings > Audio Output picker) is inconsistent across
    // versions and can silently deny, surfacing as a generic
    // AbortError in the renderer with no indication it was a
    // permission problem. This is a fully local/trusted app, so allow
    // the media-related permissions outright.
    const ALLOWED_PERMISSIONS = ['media', 'speaker-selection', 'mediaKeySystem'];
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
      callback(ALLOWED_PERMISSIONS.includes(permission));
    });
    session.defaultSession.setPermissionCheckHandler((webContents, permission) => ALLOWED_PERMISSIONS.includes(permission));
    createMainWindow();
    Menu.setApplicationMenu(null);
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}

// ── Window controls ───────────────────────────────────────────────
ipcMain.on('win-min',    () => mainWindow?.minimize());
ipcMain.on('win-max',    () => mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());
ipcMain.on('win-close',  () => mainWindow?.close());
ipcMain.on('open-mini',  () => createMiniWindow());
ipcMain.on('close-mini', () => { if (miniWindow && !miniWindow.isDestroyed()) miniWindow.close(); });

ipcMain.on('player-state', (e, state) => {
  if (miniWindow && !miniWindow.isDestroyed() && e.sender !== miniWindow.webContents)
    miniWindow.webContents.send('player-state', state);
  if (mainWindow && !mainWindow.isDestroyed() && e.sender !== mainWindow.webContents)
    mainWindow.webContents.send('player-state', state);
});
ipcMain.on('mini-cmd', (e, cmd) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('mini-cmd', cmd);
});

// ── Local library ─────────────────────────────────────────────────
const AUDIO_EXTS = ['mp3','wav','flac','aac','ogg','m4a','wma','opus','aif','aiff'];
// Filters out OS junk that happens to end in an audio extension — most
// notably macOS AppleDouble sidecar files ("._Song.mp3", a few KB of
// resource-fork data copied alongside the real file onto non-HFS+
// drives) and Windows Thumbs.db-style dotfiles. These are never audio.
function isRealAudioFile(f) {
  return !f.startsWith('.') && AUDIO_EXTS.includes(path.extname(f).slice(1).toLowerCase());
}

ipcMain.handle('scan-library', () => {
  if (!fs.existsSync(MUSIC_DIR)) return [];
  return fs.readdirSync(MUSIC_DIR)
    .filter(isRealAudioFile)
    .map(f => {
      const fp = path.join(MUSIC_DIR, f); const st = fs.statSync(fp);
      return { path: fp, name: path.basename(f, path.extname(f)), ext: path.extname(f).slice(1).toLowerCase(), size: st.size, source: 'local', addedAt: st.birthtimeMs };
    });
});

ipcMain.handle('pick-files', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile','multiSelections'],
    filters: [{ name:'Audio', extensions:['mp3','wav','flac','aac','ogg','m4a','wma','opus','aif','aiff'] }]
  });
  if (r.canceled) return [];
  const result = [];
  for (const fp of r.filePaths) {
    let fname = path.basename(fp);
    if (!isRealAudioFile(fname)) continue;
    const dest = path.join(MUSIC_DIR, fname);
    if (!fs.existsSync(dest)) fs.copyFileSync(fp, dest);
    result.push({ path: dest, name: path.basename(dest, path.extname(dest)), ext: path.extname(dest).slice(1).toLowerCase(), size: fs.statSync(dest).size, source: 'local', addedAt: Date.now() });
  }
  return result;
});

ipcMain.handle('pick-folder', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (r.canceled) return [];
  const dir = r.filePaths[0];
  const result = [];
  const scan = d => {
    try {
      fs.readdirSync(d).forEach(f => {
        const fp = path.join(d, f);
        try {
          if (fs.statSync(fp).isDirectory()) { scan(fp); return; }
          if (!isRealAudioFile(f)) return;
          const dest = path.join(MUSIC_DIR, f);
          if (!fs.existsSync(dest)) fs.copyFileSync(fp, dest);
          result.push({ path: dest, name: path.basename(dest, path.extname(dest)), ext: path.extname(dest).slice(1).toLowerCase(), size: fs.statSync(dest).size, source: 'local', addedAt: Date.now() });
        } catch(e) {}
      });
    } catch(e) {}
  };
  scan(dir);
  return result;
});

// Lets a user pick any image file as a custom playlist cover — read
// straight into a base64 data: URL (same pattern as embedded track
// art from read-tags below) so the renderer never needs to manage a
// separate file on disk for it.
ipcMain.handle('pick-playlist-cover', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }]
  });
  if (r.canceled || !r.filePaths.length) return null;
  try {
    const fp = r.filePaths[0];
    const buf = fs.readFileSync(fp);
    const ext = path.extname(fp).slice(1).toLowerCase();
    const mime = ext === 'jpg' ? 'jpeg' : ext;
    return `data:image/${mime};base64,${buf.toString('base64')}`;
  } catch (e) { return null; }
});

// ── Linked folders (reference in place — no copy) ─────────────────
// For libraries too large to duplicate: the folder is only ever read,
// never written to, moved, renamed, or deleted from. "Removing" a
// linked track just adds it to an exclusion list so it stops showing
// up in GrooveBox — the real file on disk is never touched.
function getLinkedFolders() { return store.get('linkedFolders', []); }
function getRemovedLinkedPaths() { return new Set(store.get('removedLinkedPaths', [])); }

ipcMain.handle('link-folder', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (r.canceled) return [];
  const dir = path.normalize(path.resolve(r.filePaths[0]));
  const folders = getLinkedFolders();
  if (!folders.includes(dir)) { folders.push(dir); store.set('linkedFolders', folders); }
  return scanLinkedFolders();
});

// "Link Folder as Playlist" — same as link-folder (tracks stay referenced
// in place, never copied), but also hands back which folder was just
// picked so the renderer can create a playlist tied to it. Every track
// scanLinkedFolders() returns is now tagged with the linked-folder root
// it came from (see `folderPath` below), so that playlist's membership
// is never a fixed list — it's always "whatever's currently in this
// folder", the same self-updating design as the Android app's
// folder-backed playlists (LibraryRepository.createFolderPlaylist).
ipcMain.handle('link-folder-as-playlist', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (r.canceled) return null;
  const dir = path.normalize(path.resolve(r.filePaths[0]));
  const folders = getLinkedFolders();
  if (!folders.includes(dir)) { folders.push(dir); store.set('linkedFolders', folders); }
  return { dir, name: path.basename(dir), tracks: scanLinkedFolders() };
});

function scanLinkedFolders() {
  const excluded = getRemovedLinkedPaths();
  const result = [];
  const scan = (d, root) => {
    let entries;
    try { entries = fs.readdirSync(d); } catch (e) { return; }
    for (const f of entries) {
      const fp = path.join(d, f);
      try {
        if (fs.statSync(fp).isDirectory()) { scan(fp, root); continue; }
        if (!isRealAudioFile(f)) continue;
        const resolved = path.normalize(fp);
        if (excluded.has(resolved)) continue;
        const st = fs.statSync(resolved);
        result.push({ path: resolved, name: path.basename(f, path.extname(f)), ext: path.extname(f).slice(1).toLowerCase(), size: st.size, source: 'local', linked: true, folderPath: root, addedAt: st.birthtimeMs });
      } catch (e) {}
    }
  };
  for (const folder of getLinkedFolders()) { const root = path.normalize(path.resolve(folder)); scan(root, root); }
  return result;
}
ipcMain.handle('scan-linked', () => scanLinkedFolders());

// Every filesystem-touching handler below only ever operates on paths
// inside MUSIC_DIR (GrooveBox's own copied library) or inside a folder
// the user explicitly linked — renderer-supplied paths are never
// trusted outright, since a tampered track record could otherwise be
// used to read or delete arbitrary files on disk.
function isInsideMusicDir(fp) {
  const resolved = path.normalize(path.resolve(fp));
  return resolved === MUSIC_DIR || resolved.startsWith(MUSIC_DIR + path.sep);
}
function isInsideLinkedFolder(fp) {
  const resolved = path.normalize(path.resolve(fp));
  return getLinkedFolders().some(raw => {
    const folder = path.normalize(path.resolve(raw));
    return resolved === folder || resolved.startsWith(folder + path.sep);
  });
}

ipcMain.handle('remove-track', (_, fp) => {
  try {
    if (isInsideMusicDir(fp)) {
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
      return true;
    }
    if (isInsideLinkedFolder(fp)) {
      // Never touch a linked file — just hide it from future scans.
      const resolved = path.normalize(path.resolve(fp));
      const removed = getRemovedLinkedPaths();
      removed.add(resolved);
      store.set('removedLinkedPaths', [...removed]);
      return true;
    }
    return false;
  } catch(e) { return false; }
});
ipcMain.handle('read-file', async (_, fp) => {
  if (!isInsideMusicDir(fp) && !isInsideLinkedFolder(fp)) throw new Error('Path outside music library');
  const b = fs.readFileSync(fp);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
});

// Reads embedded ID3/Vorbis/etc. tags from a local/linked audio file —
// called just-in-time for whichever track is currently loaded (not a
// bulk library scan, which would be far too slow across a large
// library). Fills in real artist/title/cover art for files whose
// filenames alone (mashup/edit names, etc.) aren't useful metadata.
ipcMain.handle('read-tags', async (_, fp) => {
  if (!isInsideMusicDir(fp) && !isInsideLinkedFolder(fp)) return {};
  try {
    const meta = await mm.parseFile(fp, { duration: false, skipCovers: false });
    const c = meta.common;
    let image = null;
    if (c.picture && c.picture.length) {
      const pic = c.picture[0];
      image = `data:${pic.format};base64,${Buffer.from(pic.data).toString('base64')}`;
    }
    return { title: c.title || null, artist: c.artist || null, album: c.album || null, image };
  } catch (e) { return {}; }
});

// ── Store ─────────────────────────────────────────────────────────
// Sensitive keys (see SENSITIVE_KEYS) are transparently encrypted at
// rest; everything else (playlists, EQ settings, library metadata) is
// stored as plain JSON same as before.
ipcMain.handle('store-get', (_, k)    => secureGet(k, null));
ipcMain.handle('store-set', (_, k, v) => { secureSet(k, v); });
ipcMain.handle('store-del', (_, k)    => { store.delete(k); });

// ── Google OAuth (opens browser tab) ─────────────────────────────
let oauthServer;
ipcMain.handle('google-auth', async (_, { clientId, clientSecret }) => {
  return new Promise((resolve, reject) => {
    const cid = clientId || secureGet('googleClientId','');
    const cse = clientSecret || secureGet('googleClientSecret','');
    if (!cid || !cse) { resolve({ error: 'No Google credentials. Set them in Settings.' }); return; }

    // Random per-attempt state token, checked on callback, to prevent
    // the OAuth redirect endpoint from accepting a code from anywhere
    // other than the request GrooveBox itself just made.
    const expectedState = crypto.randomBytes(24).toString('hex');

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${encodeURIComponent(cid)}&` +
      `redirect_uri=${encodeURIComponent(OAUTH_REDIRECT)}&` +
      `response_type=code&scope=${encodeURIComponent(GOOGLE_SCOPES)}&` +
      `state=${expectedState}&` +
      `access_type=offline&prompt=select_account`;

    if (oauthServer) oauthServer.close();
    oauthServer = http.createServer(async (req, res) => {
      const p = url.parse(req.url, true);
      if (p.pathname !== '/oauth2callback' || !p.query.code) return;
      if (p.query.state !== expectedState) {
        res.writeHead(400, { 'Content-Type': 'text/plain' }); res.end('Invalid state'); return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body style="font-family:sans-serif;background:#08080f;color:#e2e0ff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:12px"><h2 style="color:#a78bfa">✅ Signed in!</h2><p style="color:#888">Return to GrooveBox.</p></body></html>');
      oauthServer.close();
      try {
        // Exchange code for tokens
        const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ code: p.query.code, client_id: cid, client_secret: cse, redirect_uri: OAUTH_REDIRECT, grant_type: 'authorization_code' })
        });
        const tokens = await tokenResp.json();
        if (tokens.error) { resolve({ error: tokens.error_description || tokens.error }); return; }
        // Fetch user profile
        const profileResp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { Authorization: `Bearer ${tokens.access_token}` }
        });
        const profile = await profileResp.json();
        secureSet('googleTokens', tokens);
        secureSet('googleProfile', profile);
        resolve({ success: true, tokens, profile });
      } catch(e) { resolve({ error: e.message }); }
    }).listen(42814);
    shell.openExternal(authUrl);
  });
});

ipcMain.handle('google-logout', () => {
  store.delete('googleTokens'); store.delete('googleProfile');
  return true;
});
ipcMain.handle('google-get-session', () => ({
  tokens:  secureGet('googleTokens',  null),
  profile: secureGet('googleProfile', null),
}));

// ── Google Drive (uses stored access token) ───────────────────────
ipcMain.handle('gdrive-list', async (_, folderId) => {
  const tokens = secureGet('googleTokens', null);
  const apiKey = secureGet('driveApiKey', null);
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const fields = encodeURIComponent('files(id,name,size,mimeType)');
  let apiUrl;
  if (tokens?.access_token) {
    apiUrl = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&pageSize=200`;
  } else if (apiKey) {
    apiUrl = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&pageSize=200&key=${apiKey}`;
  } else {
    return { error: 'Sign in with Google or add an API key in Settings.' };
  }
  const resp = await fetch(apiUrl, tokens?.access_token ? { headers: { Authorization: `Bearer ${tokens.access_token}` } } : {});
  const data = await resp.json();
  if (data.error) return { error: data.error.message };
  const audioMimes = ['audio/mpeg','audio/wav','audio/flac','audio/aac','audio/ogg','audio/mp4','audio/x-m4a'];
  const audioExts  = ['mp3','wav','flac','aac','ogg','m4a','wma','opus','aif','aiff'];
  const files = (data.files||[]).filter(f => audioMimes.includes(f.mimeType) || audioExts.some(e => f.name.toLowerCase().endsWith('.'+e)));
  return { files };
});

ipcMain.handle('gdrive-stream', async (_, fileId) => {
  const tokens = secureGet('googleTokens', null);
  const apiKey = secureGet('driveApiKey', null);
  // Official Drive v3 media download endpoint — the old drive.google.com/uc?export=download
  // trick is unofficial, rate-limited, and blocked outright above ~25MB.
  const dlUrl = tokens?.access_token
    ? `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`
    : apiKey
    ? `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${encodeURIComponent(apiKey)}`
    : null;
  if (!dlUrl) return Promise.reject(new Error('Sign in with Google or add an API key in Settings.'));
  const headers = tokens?.access_token ? { Authorization: `Bearer ${tokens.access_token}` } : {};
  return new Promise((resolve, reject) => {
    const get = (u, hdrs) => {
      const req = https.get(u, { headers: { 'User-Agent': 'GrooveBox/3.0', ...hdrs } }, res => {
        if (res.statusCode === 302 || res.statusCode === 301) { get(res.headers.location, hdrs); return; }
        if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => { const b = Buffer.concat(chunks); resolve(b.buffer.slice(b.byteOffset, b.byteOffset+b.byteLength)); });
        res.on('error', reject);
      });
      req.on('error', reject);
      req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
    };
    get(dlUrl, headers);
  });
});

// ── Stream a URL track (plays back any track already saved with a
// direct url, e.g. from before Discover was YouTube-only) ─────────
ipcMain.handle('stream-url', async (_, streamUrl) => {
  return new Promise((resolve, reject) => {
    const get = u => {
      const req = https.get(u, { headers: { 'User-Agent': 'GrooveBox/3.0' } }, res => {
        if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) { get(res.headers.location); return; }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => { const b = Buffer.concat(chunks); resolve(b.buffer.slice(b.byteOffset, b.byteOffset+b.byteLength)); });
        res.on('error', reject);
      });
      req.on('error', reject);
      req.setTimeout(45000, () => { req.destroy(); reject(new Error('Stream timeout')); });
    };
    get(streamUrl);
  });
});

// ── Misc ──────────────────────────────────────────────────────────
ipcMain.handle('open-feedback', async (_, { type, message }) => {
  const sub  = encodeURIComponent(`GrooveBox ${type}`);
  const body = encodeURIComponent(`Type: ${type}\n\nMessage:\n${message}\n\n---\nGrooveBox v${app.getVersion()} · ${process.platform}`);
  shell.openExternal(`mailto:akshitsingh153@gmail.com?subject=${sub}&body=${body}`);
});
ipcMain.handle('open-external', (_, u) => shell.openExternal(u));
ipcMain.handle('get-version',   ()    => app.getVersion());

// ── YouTube Music Integration ─────────────────────────────────────
// Uses YouTube Data API v3 (official, free 10k queries/day)
// + yt-dlp for audio stream extraction
const { execFile, spawn } = require('child_process');
const os = require('os');

// Find yt-dlp binary — bundled with app or system installed
function getYtdlpPath() {
  const platform = process.platform;
  const binName = platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  // 1. Auto-downloaded binary in userData/bin (via Settings → Download button)
  const userBin = path.join(app.getPath('userData'), 'bin', binName);
  if (fs.existsSync(userBin)) return userBin;
  // 2. Bundled binary (in assets/bin/)
  const bundled = path.join(__dirname, 'assets', 'bin', binName);
  if (fs.existsSync(bundled)) return bundled;
  // Fall back to system-installed
  const systemPaths = platform === 'win32'
    ? ['yt-dlp.exe', path.join(process.env.LOCALAPPDATA || '', 'Programs', 'yt-dlp', 'yt-dlp.exe')]
    : ['/usr/local/bin/yt-dlp', '/usr/bin/yt-dlp', path.join(os.homedir(), '.local/bin/yt-dlp'), 'yt-dlp'];
  for (const p of systemPaths) {
    try { if (fs.existsSync(p) || p === 'yt-dlp') return p; } catch(e) {}
  }
  return 'yt-dlp'; // hope it's in PATH
}

// Search YouTube using official Data API v3
ipcMain.handle('yt-search', async (_, { query, apiKey }) => {
  if (!apiKey) return { items: [], error: 'No YouTube API key. Add one in Settings → YouTube API Key.' };
  return new Promise(resolve => {
    const q = encodeURIComponent(query);
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=10&maxResults=20&q=${q}&key=${encodeURIComponent(apiKey)}`;
    https.get(url, { headers: { 'User-Agent': 'GrooveBox/3.0' } }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) { resolve({ items: [], error: json.error.message }); return; }
          const items = (json.items || []).map(item => ({
            id:        item.id.videoId,
            name:      item.snippet.title.replace(/\s*[\[\(].*?[\]\)]/g, '').trim(), // strip [Official Video] etc
            artist:    item.snippet.channelTitle.replace(/ - Topic$| VEVO$| Official$/i, '').trim(),
            rawTitle:  item.snippet.title,
            image:     item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || '',
            published: item.snippet.publishedAt,
            source:    'youtube',
            ext:       'webm',
          }));
          resolve({ items, error: null });
        } catch(e) { resolve({ items: [], error: e.message }); }
      });
    }).on('error', e => resolve({ items: [], error: e.message }));
  });
});

// ── Spotify (search/metadata only) ───────────────────────────────
// Spotify's catalog can't be streamed or downloaded outside their own
// licensed Web Playback SDK (which additionally requires the listener
// to have Premium) — there is no way to get raw audio bytes for a
// Spotify track the way yt-dlp does for YouTube. This uses Spotify's
// Client Credentials flow (app-only auth, no user login) purely to
// search/identify tracks with accurate metadata; the renderer then
// matches each result to a YouTube video to actually play it.
let spotifyToken = null, spotifyTokenExpiry = 0;
function getSpotifyToken(clientId, clientSecret) {
  if (spotifyToken && Date.now() < spotifyTokenExpiry) return Promise.resolve(spotifyToken);
  return new Promise((resolve, reject) => {
    const body = 'grant_type=client_credentials';
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const req = https.request('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.access_token) {
            spotifyToken = json.access_token;
            spotifyTokenExpiry = Date.now() + Math.max(0, (json.expires_in || 3600) - 60) * 1000;
            resolve(spotifyToken);
          } else {
            reject(new Error(json.error_description || 'Spotify auth failed — check Client ID/Secret'));
          }
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
function spotifyApiGet(url, token) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'Authorization': `Bearer ${token}` } }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
const mapSpotifyTrack = t => ({
  spotifyId: t.id,
  name:      t.name,
  artist:    (t.artists || []).map(a => a.name).join(', '),
  album:     t.album?.name || '',
  duration:  Math.round((t.duration_ms || 0) / 1000),
  image:     t.album?.images?.[0]?.url || '',
  source:    'spotify',
  ext:       'mp3',
});

// Search returns tracks, albums, and playlists together — albums and
// playlists aren't playable directly (same reason as tracks: no raw
// audio access), so the renderer fetches their contained tracks via
// spotify-album-tracks/spotify-playlist-tracks below when the user
// opens one, and each of those tracks resolves to YouTube on play
// exactly like a plain track search result does.
ipcMain.handle('spotify-search', async (_, { query, clientId, clientSecret }) => {
  if (!clientId || !clientSecret) return { tracks: [], albums: [], playlists: [], error: 'No Spotify Client ID/Secret. Add them in Settings → Spotify.' };
  try {
    const token = await getSpotifyToken(clientId, clientSecret);
    const json = await spotifyApiGet(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track,album,playlist&limit=10`, token);
    if (json.error) { spotifyToken = null; return { tracks: [], albums: [], playlists: [], error: json.error.message }; }
    const tracks = (json.tracks?.items || []).map(mapSpotifyTrack);
    const albums = (json.albums?.items || []).filter(Boolean).map(a => ({
      spotifyId: a.id,
      name:      a.name,
      artist:    (a.artists || []).map(x => x.name).join(', '),
      image:     a.images?.[0]?.url || '',
      trackCount: a.total_tracks || 0,
      type:      'album',
    }));
    const playlists = (json.playlists?.items || []).filter(Boolean).map(p => ({
      spotifyId: p.id,
      name:      p.name,
      owner:     p.owner?.display_name || '',
      image:     p.images?.[0]?.url || '',
      trackCount: p.tracks?.total || 0,
      type:      'playlist',
    }));
    return { tracks, albums, playlists, error: null };
  } catch (e) { return { tracks: [], albums: [], playlists: [], error: e.message }; }
});

ipcMain.handle('spotify-album-tracks', async (_, { albumId, clientId, clientSecret }) => {
  try {
    const token = await getSpotifyToken(clientId, clientSecret);
    const album = await spotifyApiGet(`https://api.spotify.com/v1/albums/${encodeURIComponent(albumId)}`, token);
    if (album.error) return { tracks: [], error: album.error.message };
    const albumImage = album.images?.[0]?.url || '';
    const tracks = (album.tracks?.items || []).map(t => ({
      spotifyId: t.id,
      name:      t.name,
      artist:    (t.artists || []).map(a => a.name).join(', '),
      album:     album.name || '',
      duration:  Math.round((t.duration_ms || 0) / 1000),
      image:     albumImage,
      source:    'spotify',
      ext:       'mp3',
    }));
    return { tracks, error: null };
  } catch (e) { return { tracks: [], error: e.message }; }
});

ipcMain.handle('spotify-playlist-tracks', async (_, { playlistId, clientId, clientSecret }) => {
  try {
    const token = await getSpotifyToken(clientId, clientSecret);
    const json = await spotifyApiGet(`https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/tracks?limit=50`, token);
    if (json.error) return { tracks: [], error: json.error.message };
    const tracks = (json.items || []).filter(it => it.track).map(it => mapSpotifyTrack(it.track));
    return { tracks, error: null };
  } catch (e) { return { tracks: [], error: e.message }; }
});

// Get audio stream URL via yt-dlp (fast, just extracts URL — no download)
ipcMain.handle('yt-get-stream', async (_, videoId) => {
  const ytdlp = getYtdlpPath();
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  return new Promise((resolve, reject) => {
    // Get best audio-only stream URL (no download, just URL extraction)
    execFile(ytdlp, [
      '--format', 'bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio',
      '--get-url',
      '--no-playlist',
      '--no-warnings',
      '--quiet',
      videoUrl
    ], { timeout: 30000 }, (err, stdout, stderr) => {
      if (err) {
        // Try alternate format
        execFile(ytdlp, [
          '--format', 'bestaudio',
          '--get-url',
          '--no-playlist',
          '--quiet',
          videoUrl
        ], { timeout: 30000 }, (err2, stdout2) => {
          if (err2) { resolve({ url: null, error: 'yt-dlp error: ' + err2.message }); return; }
          const u = stdout2.trim();
          resolve({ url: u || null, error: u ? null : 'No stream URL found' });
        });
        return;
      }
      const u = stdout.trim();
      resolve({ url: u || null, error: u ? null : 'No stream URL found' });
    });
  });
});

// Stream audio bytes from URL (for YouTube streams which expire)
ipcMain.handle('yt-stream-audio', async (_, streamUrl) => {
  return new Promise((resolve, reject) => {
    const get = u => {
      try {
        const urlObj = new URL(u);
        const isHttps = urlObj.protocol === 'https:';
        const lib = isHttps ? https : http;
        const req = lib.get(u, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Range': 'bytes=0-',
          }
        }, res => {
          if (res.statusCode === 301 || res.statusCode === 302) { get(res.headers.location); return; }
          if (res.statusCode !== 200 && res.statusCode !== 206) {
            resolve({ data: null, error: `HTTP ${res.statusCode}` }); return;
          }
          const chunks = [];
          res.on('data', c => chunks.push(c));
          res.on('end', () => {
            const b = Buffer.concat(chunks);
            resolve({ data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), error: null });
          });
          res.on('error', e => resolve({ data: null, error: e.message }));
        });
        req.on('error', e => resolve({ data: null, error: e.message }));
        req.setTimeout(60000, () => { req.destroy(); resolve({ data: null, error: 'Timeout' }); });
      } catch(e) { resolve({ data: null, error: e.message }); }
    };
    get(streamUrl);
  });
});

// Check if yt-dlp is installed
ipcMain.handle('yt-check', async () => {
  const ytdlp = getYtdlpPath();
  return new Promise(resolve => {
    execFile(ytdlp, ['--version'], { timeout: 5000 }, (err, stdout) => {
      resolve({ installed: !err, version: stdout?.trim() || null, path: ytdlp });
    });
  });
});

// Get video metadata (title, duration, thumbnail)
ipcMain.handle('yt-get-meta', async (_, videoId) => {
  const ytdlp = getYtdlpPath();
  return new Promise(resolve => {
    execFile(ytdlp, [
      '--dump-json', '--no-playlist', '--quiet',
      `https://www.youtube.com/watch?v=${videoId}`
    ], { timeout: 20000 }, (err, stdout) => {
      if (err) { resolve(null); return; }
      try {
        const meta = JSON.parse(stdout);
        resolve({
          id:       meta.id,
          name:     meta.track || meta.title,
          artist:   meta.artist || meta.uploader,
          duration: meta.duration,
          image:    meta.thumbnail,
          ext:      meta.ext || 'webm',
        });
      } catch(e) { resolve(null); }
    });
  });
});


// ── One-click yt-dlp download (customer-ready: no terminal needed) ──
// Follows redirects and resolves the full response body as text.
function httpGetText(u, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 8) { reject(new Error('Too many redirects')); return; }
    https.get(u, { headers: { 'User-Agent': 'GrooveBox/3.0' } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        resolve(httpGetText(res.headers.location, redirects + 1)); return;
      }
      if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode)); return; }
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

ipcMain.handle('download-ytdlp', async () => {
  const platform = process.platform;
  const binName = platform === 'win32' ? 'yt-dlp.exe' : platform === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp';
  const saveName = platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  const dlUrl = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${binName}`;
  const sumsUrl = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS`;
  const binDir = path.join(app.getPath('userData'), 'bin');
  if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true });
  const dest = path.join(binDir, saveName);

  // Fetch the official published checksums first — if that fails we do
  // not proceed, rather than run an unverified downloaded binary.
  let expectedHash;
  try {
    const sums = await httpGetText(sumsUrl);
    const line = sums.split('\n').find(l => l.trim().endsWith(binName));
    expectedHash = line ? line.trim().split(/\s+/)[0].toLowerCase() : null;
    if (!expectedHash) throw new Error('checksum not listed for ' + binName);
  } catch(e) {
    return { success: false, error: 'Could not verify release checksums: ' + e.message };
  }

  return new Promise(resolve => {
    const get = (u, redirects = 0) => {
      if (redirects > 8) { resolve({ success: false, error: 'Too many redirects' }); return; }
      https.get(u, { headers: { 'User-Agent': 'GrooveBox/3.0' } }, res => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) { get(res.headers.location, redirects + 1); return; }
        if (res.statusCode !== 200) { resolve({ success: false, error: 'HTTP ' + res.statusCode }); return; }
        const file = fs.createWriteStream(dest);
        const hash = crypto.createHash('sha256');
        res.on('data', c => hash.update(c));
        res.pipe(file);
        file.on('finish', () => {
          file.close(() => {
            const actualHash = hash.digest('hex');
            if (actualHash !== expectedHash) {
              try { fs.unlinkSync(dest); } catch(_) {}
              resolve({ success: false, error: 'Checksum mismatch — download was corrupted or tampered with, not installed.' });
              return;
            }
            try { if (platform !== 'win32') fs.chmodSync(dest, 0o755); } catch(e) {}
            resolve({ success: true, path: dest });
          });
        });
        file.on('error', e => { try { fs.unlinkSync(dest); } catch(_) {} resolve({ success: false, error: e.message }); });
      }).on('error', e => resolve({ success: false, error: e.message }));
    };
    get(dlUrl);
  });
});
