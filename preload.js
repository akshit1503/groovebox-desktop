const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('GB', {
  // Window
  winMin:    ()    => ipcRenderer.send('win-min'),
  winMax:    ()    => ipcRenderer.send('win-max'),
  winClose:  ()    => ipcRenderer.send('win-close'),
  openMini:  ()    => ipcRenderer.send('open-mini'),
  closeMini: ()    => ipcRenderer.send('close-mini'),
  // Taskbar thumbnail toolbar (Win)
  setThumbarIcons:   (icons)   => ipcRenderer.invoke('set-thumbar-icons', icons),
  setThumbarPlaying: (playing) => ipcRenderer.invoke('set-thumbar-playing', playing),
  onThumbarCmd: (cb) => ipcRenderer.on('thumbar-cmd', (_, cmd) => cb(cmd)),
  // Files
  scanLibrary:  ()    => ipcRenderer.invoke('scan-library'),
  pickFiles:    ()    => ipcRenderer.invoke('pick-files'),
  pickFolder:   ()    => ipcRenderer.invoke('pick-folder'),
  pickPlaylistCover: () => ipcRenderer.invoke('pick-playlist-cover'),
  removeTrack:  (p)   => ipcRenderer.invoke('remove-track', p),
  readFile:     (p)   => ipcRenderer.invoke('read-file', p),
  readTags:     (p)   => ipcRenderer.invoke('read-tags', p),
  // Linked folders (reference in place, no copy — for libraries too
  // large to duplicate onto disk)
  linkFolder: ()    => ipcRenderer.invoke('link-folder'),
  scanLinked: ()    => ipcRenderer.invoke('scan-linked'),
  // Store
  storeGet: (k)    => ipcRenderer.invoke('store-get', k),
  storeSet: (k, v) => ipcRenderer.invoke('store-set', k, v),
  storeDel: (k)    => ipcRenderer.invoke('store-del', k),
  // Google Auth
  googleAuth:       (c)  => ipcRenderer.invoke('google-auth', c),
  googleLogout:     ()   => ipcRenderer.invoke('google-logout'),
  googleGetSession: ()   => ipcRenderer.invoke('google-get-session'),
  // Google Drive
  gdriveList:   (fid) => ipcRenderer.invoke('gdrive-list', fid),
  gdriveStream: (id)  => ipcRenderer.invoke('gdrive-stream', id),
  streamUrl:     (u)  => ipcRenderer.invoke('stream-url', u),
  // YouTube Music
  ytSearch:       (d)  => ipcRenderer.invoke('yt-search', d),
  spotifySearch:  (d)  => ipcRenderer.invoke('spotify-search', d),
  spotifyAlbumTracks:    (d) => ipcRenderer.invoke('spotify-album-tracks', d),
  spotifyPlaylistTracks: (d) => ipcRenderer.invoke('spotify-playlist-tracks', d),
  ytGetStream:    (id) => ipcRenderer.invoke('yt-get-stream', id),
  ytStreamAudio:  (u)  => ipcRenderer.invoke('yt-stream-audio', u),
  ytGetMeta:      (id) => ipcRenderer.invoke('yt-get-meta', id),
  ytCheck:        ()   => ipcRenderer.invoke('yt-check'),
  downloadYtdlp:  ()   => ipcRenderer.invoke('download-ytdlp'),
  // Misc
  openFeedback: (d) => ipcRenderer.invoke('open-feedback', d),
  openExternal: (u) => ipcRenderer.invoke('open-external', u),
  getVersion:   ()  => ipcRenderer.invoke('get-version'),
  // IPC events
  onPlayerState:   (cb) => ipcRenderer.on('player-state', (_, s) => cb(s)),
  onMiniCmd:       (cb) => ipcRenderer.on('mini-cmd',     (_, c) => cb(c)),
  sendPlayerState: (s)  => ipcRenderer.send('player-state', s),
  sendMiniCmd:     (c)  => ipcRenderer.send('mini-cmd', c),
});
