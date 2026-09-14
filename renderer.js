'use strict';
// ═══════ STATE ═══════
const aud = document.getElementById('aud');
let tracks=[], filtered=[], playlists=[], likes={}, history=[], currentIdx=-1;
let view='all', srcFilter='all', sortMode='default';
let shuffle=false, repeat=false, muted=false, prevVol=0.8;
let driveFiles=[], fbType='Bug Report', queueTab='next', queueNext_=[];
let discoverResults=[];
let discoverAlbums=[], discoverPlaylists=[], discoverBrowsing=null; // discoverBrowsing: {type:'album'|'playlist', name} when viewing tracks inside one
let discoverShowingLiked=false;
let googleProfile=null;
let isOnline=false;  // Always starts offline; user toggles per session
let settings={soundcheck:false,autoplay:false,volume:0.8,playbackRate:1,audioOutputId:''};
let sleepTimerId=null,sleepTimerEndAt=null,sleepTimerEndOfTrack=false,sleepTimerUiInterval=null;

// Audio / Vis
let audioCtx, analyser, visRaf, eqNodes=[], eqValues=new Array(10).fill(0);
const EQ_FREQS=[60,170,310,600,1000,3000,6000,12000,14000,16000];
const npCanvas=document.createElement('canvas'); npCanvas.width=54; npCanvas.height=54;
const fpCanvas=document.createElement('canvas'); fpCanvas.width=220; fpCanvas.height=220;
const npCtx=npCanvas.getContext('2d'), fpCtx2d=fpCanvas.getContext('2d');

// ═══════ HELPERS ═══════
const fmt  = s => {if(!s||isNaN(s)||s===Infinity)return '0:00';const m=Math.floor(s/60),ss=Math.floor(s%60);return m+':'+(ss<10?'0':'')+ss;};
const fmtB = b => {if(!b)return '—';return b>1048576?(b/1048576).toFixed(1)+' MB':(b/1024).toFixed(0)+' KB';};
const tkey = t => t.source==='gdrive'?'gd_'+(t.id||t.name):t.source==='youtube'?'yt_'+(t.id||t.name):t.source==='jamendo'||t.source==='fma'?'online_'+(t.id||t.name):'lc_'+(t.path||t.name);
const esc  = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const MIME = {mp3:'audio/mpeg',wav:'audio/wav',flac:'audio/flac',aac:'audio/aac',ogg:'audio/ogg',m4a:'audio/mp4',wma:'audio/x-ms-wma',opus:'audio/ogg',aif:'audio/aiff',aiff:'audio/aiff'};
const getMime = ext => MIME[(ext||'').toLowerCase()]||'audio/mpeg';

function toast(msg,dur=2400){const el=document.getElementById('toast');el.textContent=msg;el.classList.add('show');clearTimeout(el._t);el._t=setTimeout(()=>el.classList.remove('show'),dur);}
function showLoad(t){document.getElementById('loadbar').style.display='flex';document.getElementById('load-txt').textContent=t||'Loading…';}
function hideLoad(){document.getElementById('loadbar').style.display='none';}

// ═══════ INIT ═══════
window.addEventListener('DOMContentLoaded', async()=>{
  aud.volume=0.8; buildEQ();
  await loadPersisted();
  await initGoogleSession();
  applyOnlineUI();  // Always offline by default
  renderSidebar(); filterAndRender(); bindKeys();
  initMediaSession();
  initThumbar();
  GB.onMiniCmd(cmd=>{
    if(cmd==='toggle') togglePlay();
    else if(cmd==='next') playNext();
    else if(cmd==='prev') playPrev();
    else if(cmd==='open-full-player') openFullPlayer();
    else if(cmd.startsWith('seek:')){const p=parseFloat(cmd.split(':')[1]);if(aud.duration) aud.currentTime=(p/100)*aud.duration;}
  });
});

async function loadPersisted(){
  const sv=await GB.storeGet('settings'); if(sv) {settings={...settings,...sv}; applySettings();}
  const lv=await GB.storeGet('likes'); if(lv) likes=lv;
  const pv=await GB.storeGet('playlists'); if(pv) playlists=pv;
  const hv=await GB.storeGet('history'); if(hv) history=hv;
  const gdt=await GB.storeGet('gdrive-meta'); if(gdt&&Array.isArray(gdt)) addTracks(gdt,false);
  const lib=await GB.scanLibrary(); lib.forEach(t=>{t.likes=likes[tkey(t)]||0;}); addTracks(lib,false);
  const linked=await GB.scanLinked(); linked.forEach(t=>{t.likes=likes[tkey(t)]||0;}); addTracks(linked,false);
  // Load saved Google credentials into settings inputs
  const gcid=await GB.storeGet('googleClientId'); if(gcid) {const el=document.getElementById('sp-gcid');if(el) el.value=gcid;}
  const drkey=await GB.storeGet('driveApiKey'); if(drkey) {const el=document.getElementById('sp-drive-apikey');if(el) el.value=drkey;}
  await resumeLastPlayed();
}

// ═══════ RESUME LAST PLAYED ═══════
// "Auto-play on launch" — stores the full track object (not just a
// key) since online tracks (YouTube/Spotify-matched) only live in
// tracks[] for the session they were played in unless liked/
// playlisted, so a key alone wouldn't resolve to anything on the next
// launch. Position is saved throttled during playback, not every tick.
let _lastPlayedSaveAt=0;
function saveLastPlayed(pos){
  if(currentIdx<0)return;
  const t=tracks[currentIdx];if(!t)return;
  GB.storeSet('lastPlayed',{track:{...t},pos:pos||0});
}
async function resumeLastPlayed(){
  if(!settings.autoplay)return;
  const lp=await GB.storeGet('lastPlayed');
  if(!lp||!lp.track)return;
  let idx=tracks.findIndex(x=>tkey(x)===tkey(lp.track));
  if(idx<0){tracks.push({...lp.track});idx=tracks.length-1;document.getElementById('sb-cnt').textContent=tracks.length;}
  const onMeta=()=>{if(lp.pos)aud.currentTime=lp.pos;aud.removeEventListener('loadedmetadata',onMeta);};
  aud.addEventListener('loadedmetadata',onMeta);
  await loadTrack(idx);
}

function applySettings(){
  aud.volume=settings.volume||0.8; document.getElementById('vol').value=settings.volume||0.8;
  ['soundcheck','autoplay'].forEach(k=>{const b=document.getElementById('tog-'+k);if(b) b.classList.toggle('on',!!settings[k]);});
  setPlaybackSpeed(settings.playbackRate||1,true);
  if(settings.audioOutputId) setAudioOutput(settings.audioOutputId,true);
}

// ═══════ GOOGLE AUTH ═══════
async function initGoogleSession(){
  const sess=await GB.googleGetSession();
  if(sess?.profile) setGoogleProfile(sess.profile);
  else showSignInButton();
}

function showSignInButton(){
  document.getElementById('tb-user').style.display='none';
  document.getElementById('tb-signin').style.display='block';
}

function setGoogleProfile(profile){
  googleProfile=profile;
  document.getElementById('tb-signin').style.display='none';
  const userEl=document.getElementById('tb-user');
  userEl.style.display='flex';
  const avatar=document.getElementById('tb-avatar');
  if(profile.picture) avatar.src=profile.picture;
  else avatar.src='';
  document.getElementById('tb-uname').textContent=profile.given_name||profile.name||profile.email;
  // Update account row in settings
  const desc=document.getElementById('sp-account-desc');
  if(desc) desc.textContent=`Signed in as ${profile.email}`;
  const btn=document.getElementById('sp-signin-btn');
  if(btn){btn.textContent='Sign Out';btn.onclick=signOut;btn.style.background='rgba(248,113,113,.15)';btn.style.color='var(--red)';}
  toast(`✅ Signed in as ${profile.given_name||profile.email}`);
}

async function startGoogleAuth(){
  if(!requireOnline('Google Sign-In'))return;
  const clientId=document.getElementById('sp-gcid')?.value.trim() || await GB.storeGet('googleClientId');
  const clientSecret=document.getElementById('sp-gcs')?.value.trim() || await GB.storeGet('googleClientSecret');
  if(!clientId||!clientSecret){
    openSettings();
    toast('⚠ Add your Google Client ID & Secret in Settings first');
    return;
  }
  toast('Opening Google Sign-In in your browser…');
  const result=await GB.googleAuth({clientId,clientSecret});
  if(result?.error){ toast('❌ '+result.error); return; }
  if(result?.profile) setGoogleProfile(result.profile);
}

async function signOut(){
  await GB.googleLogout();
  googleProfile=null;
  showSignInButton();
  const desc=document.getElementById('sp-account-desc'); if(desc) desc.textContent='Sign in to sync Drive music and unlock personalization';
  const btn=document.getElementById('sp-signin-btn');
  if(btn){btn.textContent='Sign in with Google';btn.onclick=startGoogleAuth;btn.style.background='#4285F4';btn.style.color='#fff';}
  toast('Signed out');
}

function showUserMenu(){
  if(!googleProfile) return;
  showCtxMenu(document.getElementById('tb-user').getBoundingClientRect().left, 50,[
    {label:`👤 ${googleProfile.email}`,action:()=>{}},
    {sep:true},
    {label:'Sign Out',action:signOut,danger:true},
  ]);
}

async function saveGoogleCreds(){
  const cid=document.getElementById('sp-gcid')?.value.trim();
  const cs=document.getElementById('sp-gcs')?.value.trim();
  if(!cid||!cs){toast('Enter both Client ID and Secret');return;}
  await GB.storeSet('googleClientId',cid);
  await GB.storeSet('googleClientSecret',cs);
  toast('✅ Google credentials saved — click "Sign in with Google" to continue');
}

// ═══════ ONLINE/OFFLINE MODE ═══════
function toggleOnlineMode(){
  isOnline=!isOnline;
  applyOnlineUI();
  toast(isOnline?'🌐 Online mode enabled — streaming available':'🔒 Offline mode — local files only');
}

function requireOnline(featureName){
  if(isOnline) return true;
  toast(`🔒 Enable Online mode to use ${featureName||'this feature'}`);
  return false;
}

function applyOnlineUI(){
  const pill=document.getElementById('tb-online');
  const label=document.getElementById('tb-online-text');
  if(pill){
    pill.classList.toggle('online',isOnline);
    pill.classList.toggle('offline',!isOnline);
  }
  if(label) label.textContent=isOnline?'ONLINE':'OFFLINE';
  // Discover tab offline notice
  const notice=document.getElementById('discover-offline-notice');
  if(notice) notice.style.display=isOnline?'none':'flex';
}

// ═══════ TRACKS ═══════
function addTracks(arr,save=true){
  const keys=new Set(tracks.map(tkey));
  let n=0;
  arr.forEach(t=>{const k=tkey(t);if(keys.has(k))return;t.likes=likes[k]||0;tracks.push(t);keys.add(k);n++;});
  if(save&&n>0) GB.storeSet('gdrive-meta',tracks.filter(t=>t.source==='gdrive'));
  document.getElementById('sb-cnt').textContent=tracks.length;
  return n;
}

function removeTrack(idx){
  const t=tracks[idx]; if(!t) return;
  if(t.source==='local') GB.removeTrack(t.path);
  const k=tkey(t); playlists.forEach(pl=>{pl.keys=pl.keys.filter(x=>x!==k);}); savePL();
  tracks.splice(idx,1);
  if(currentIdx===idx){aud.pause();aud.src='';currentIdx=-1;updateNowPlaying(null);}
  else if(currentIdx>idx) currentIdx--;
  filterAndRender(); toast('Track removed');
}

function clearLibrary(){
  if(!confirm('Clear entire library? Files on disk are kept.')) return;
  aud.pause();aud.src='';currentIdx=-1;updateNowPlaying(null);
  tracks=[];filtered=[];likes={};history=[];playlists=[];
  GB.storeSet('likes',{});GB.storeSet('playlists',[]);GB.storeSet('history',[]);GB.storeSet('gdrive-meta',[]);
  document.getElementById('sb-cnt').textContent='0';
  renderSidebar();filterAndRender();toast('Library cleared');
}

// ═══════ LIKES ═══════
function likeTrack(idx){
  const t=tracks[idx]; if(!t) return;
  const k=tkey(t); likes[k]=(likes[k]||0)+1; t.likes=likes[k];
  GB.storeSet('likes',likes); filterAndRender(); updateNowPlayingLike();
  toast(`♥ ${t.name} · ${t.likes} like${t.likes!==1?'s':''}`);
}
function likeCurrentTrack(){if(currentIdx>=0) likeTrack(currentIdx);}
function updateNowPlayingLike(){
  const btn=document.getElementById('np-like'); if(!btn) return;
  const liked=currentIdx>=0&&(tracks[currentIdx]?.likes||0)>0;
  btn.classList.toggle('liked',liked);
  btn.querySelector('svg').setAttribute('fill',liked?'currentColor':'none');
}

// ═══════ PLAYLISTS ═══════
const savePL=()=>GB.storeSet('playlists',playlists);
function createPlaylist(name){const pl={id:'pl_'+Date.now(),name:(name||'').trim()||'New Playlist',keys:[]};playlists.push(pl);savePL();renderSidebar();toast(`Playlist "${pl.name}" created`);return pl;}
function deletePlaylist(id){if(!confirm(`Delete playlist?`))return;playlists=playlists.filter(p=>p.id!==id);savePL();if(view==='playlist:'+id)setView('all');else renderSidebar();}
function renamePlaylist(id,name){const pl=playlists.find(p=>p.id===id);if(pl){pl.name=(name||'').trim()||pl.name;savePL();renderSidebar();}}
function addToPlaylist(plId,gi){const pl=playlists.find(p=>p.id===plId);const t=tracks[gi];if(!pl||!t)return;const k=tkey(t);if(!pl.keys.includes(k)){pl.keys.push(k);savePL();renderSidebar();toast(`Added to "${pl.name}"`);}else toast('Already in playlist');}
function removeFromPlaylist(plId,k){const pl=playlists.find(p=>p.id===plId);if(pl){pl.keys=pl.keys.filter(x=>x!==k);savePL();renderSidebar();filterAndRender();}}
function getPlTracks(plId){const pl=playlists.find(p=>p.id===plId);if(!pl)return[];return pl.keys.map(k=>tracks.find(t=>tkey(t)===k)).filter(Boolean);}

// Electron does not implement window.prompt() (it throws "prompt() is
// not supported"), unlike alert()/confirm() which do work — so any
// "ask the user for a name" flow needs its own modal instead.
let _inputModalResolve=null;
function showPrompt(title,defaultValue=''){
  return new Promise(resolve=>{
    _inputModalResolve=resolve;
    document.getElementById('input-modal-title').textContent=title;
    const field=document.getElementById('input-modal-field');
    field.value=defaultValue||'';
    document.getElementById('input-modal').classList.add('show');
    field.focus();field.select();
  });
}
function closeInputModal(ok){
  const field=document.getElementById('input-modal-field');
  const val=ok?field.value.trim():null;
  document.getElementById('input-modal').classList.remove('show');
  if(_inputModalResolve){_inputModalResolve(val||null);_inputModalResolve=null;}
}

async function promptNewPlaylist(){const n=await showPrompt('New playlist name');if(n)createPlaylist(n);}

// ═══════ SIDEBAR ═══════
function renderSidebar(){
  ['all','liked','ranked','local','gdrive','discover'].forEach(id=>{
    document.getElementById('nav-'+id)?.classList.toggle('active',view===id||(view.startsWith('playlist:')&&id==='all'?false:false));
  });
  document.getElementById('nav-all')?.classList.toggle('active',view==='all');
  document.getElementById('nav-liked')?.classList.toggle('active',view==='liked');
  document.getElementById('nav-ranked')?.classList.toggle('active',view==='ranked');
  document.getElementById('nav-local')?.classList.toggle('active',view==='local');
  document.getElementById('nav-gdrive')?.classList.toggle('active',view==='gdrive');
  document.getElementById('nav-discover')?.classList.toggle('active',view==='discover');
  const pls=document.getElementById('pl-sidebar'); if(!pls) return;
  pls.innerHTML=playlists.map(pl=>{
    const act=view==='playlist:'+pl.id;
    return `<div class="pl-row"><button class="sb-item${act?' active':''}" data-plid="${pl.id}" data-action="open"><svg fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;flex-shrink:0" viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(pl.name)}</span><span class="sb-badge">${pl.keys.length}</span></button><button class="pl-more" data-plid="${pl.id}" data-action="menu">⋯</button></div>`;
  }).join('');
}

// Delegation for sidebar + track rows
document.addEventListener('click',e=>{
  const rmBtn=e.target.closest('.pl-remove-btn');
  if(rmBtn){e.stopPropagation();removeFromPlaylist(rmBtn.dataset.plid,rmBtn.dataset.tkey);return;}
  const lBtn=e.target.closest('.t-lbtn');
  if(lBtn){e.stopPropagation();const gi=parseInt(lBtn.dataset.gi);if(!isNaN(gi))likeTrack(gi);return;}
  const plBtn=e.target.closest('[data-plid][data-action]');
  if(!plBtn) return;
  const plId=plBtn.dataset.plid,action=plBtn.dataset.action;
  if(action==='open')setView('playlist:'+plId);
  if(action==='menu')showPlMenu(e,plId);
});
document.addEventListener('dblclick',e=>{const row=e.target.closest('[data-gi]');if(!row)return;const gi=parseInt(row.dataset.gi);if(!isNaN(gi))loadTrack(gi);});
document.addEventListener('contextmenu',e=>{const row=e.target.closest('.t-row[data-gi]');if(!row)return;e.preventDefault();onRowCtx(e,parseInt(row.dataset.gi));});

function showPlMenu(e,plId){
  e.stopPropagation();const pl=playlists.find(p=>p.id===plId);if(!pl)return;
  showCtxMenu(e.clientX,e.clientY,[
    {label:'▶ Open',action:()=>setView('playlist:'+plId)},
    {label:'✏ Rename',action:async()=>{const n=await showPrompt('Rename playlist',pl.name);if(n)renamePlaylist(plId,n);}},
    {label:'🗑 Delete',action:()=>deletePlaylist(plId),danger:true},
  ]);
}

// ═══════ VIEW / FILTER ═══════
function setView(v){
  view=v;
  if(v==='discover'){
    document.getElementById('library-view').style.display='none';
    document.getElementById('discover-panel').classList.add('show');
  } else {
    document.getElementById('library-view').style.display='flex';
    document.getElementById('discover-panel').classList.remove('show');
  }
  srcFilter='all'; ['all','local','gdrive'].forEach(x=>document.getElementById('tab-'+x)?.classList.toggle('active',x==='all'));
  renderSidebar(); filterAndRender();
}
function setSrcFilter(s){srcFilter=s;['all','local','gdrive'].forEach(x=>document.getElementById('tab-'+x)?.classList.toggle('active',x===s));filterAndRender();}
function setSort(s){sortMode=s;document.querySelectorAll('.srt').forEach(b=>b.classList.toggle('active',b.id==='srt-'+s));filterAndRender();}

function filterAndRender(){
  const q=(document.getElementById('search')?.value||'').trim().toLowerCase();
  const plId=view.startsWith('playlist:')?view.split(':')[1]:null;
  let pool=plId?getPlTracks(plId):[...tracks];
  if(srcFilter!=='all') pool=pool.filter(t=>t.source===srcFilter);
  if(view==='liked') pool=pool.filter(t=>(t.likes||0)>0);
  if(view==='ranked') pool=pool.filter(t=>(t.likes||0)>0);
  if(view==='local') pool=pool.filter(t=>t.source==='local');
  if(view==='gdrive') pool=pool.filter(t=>t.source==='gdrive');
  if(q) pool=pool.filter(t=>(t.name||'').toLowerCase().includes(q)||(t.artist||'').toLowerCase().includes(q));
  if(sortMode==='az') pool.sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  if(sortMode==='liked') pool.sort((a,b)=>(b.likes||0)-(a.likes||0));
  if(sortMode==='recent') pool.sort((a,b)=>(b.addedAt||0)-(a.addedAt||0));
  if(view==='ranked') pool.sort((a,b)=>(b.likes||0)-(a.likes||0));
  filtered=pool;
  renderList();
  document.getElementById('srt-cnt').textContent=filtered.length+' track'+(filtered.length!==1?'s':'');
  document.getElementById('sb-cnt').textContent=tracks.length;
  renderQueue();
}

function renderList(){
  const list=document.getElementById('track-list'),empty=document.getElementById('empty');
  if(!filtered.length){list.innerHTML='';empty.style.display='flex';return;}
  empty.style.display='none';
  const byLike=[...tracks].sort((a,b)=>(b.likes||0)-(a.likes||0));
  const medals={};['🥇','🥈','🥉'].forEach((m,i)=>{if(byLike[i]&&(byLike[i].likes||0)>0)medals[tkey(byLike[i])]=m;});
  const inPl=view.startsWith('playlist:'),plId=inPl?view.split(':')[1]:null;
  list.innerHTML=filtered.map((t,i)=>{
    const gi=tracks.indexOf(t),playing=gi===currentIdx,k=tkey(t),lc=t.likes||0;
    const bCls=t.source==='gdrive'?'badge-gdrive':t.source==='jamendo'||t.source==='fma'?'badge-jamendo':'badge-local';
    const bTxt=t.source==='gdrive'?'Drive':t.source==='jamendo'?'Jamendo':t.source==='fma'?'FMA':'Local';
    const ext=(t.ext||'').toLowerCase();
    const qcls=['flac','wav','aif','aiff'].includes(ext)?'lossless':['aac','m4a'].includes(ext)?'aac':'mp3';
    const medal=medals[k]||'';
    const thumb=t.image?`<img src="${esc(t.image)}" alt="" loading="lazy" onerror="this.style.display='none'">`:`<div class="t-thumb-icon"><svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>`;
    const rmBtn=inPl?`<button class="pl-remove-btn" data-plid="${plId}" data-tkey="${k}" style="background:none;border:none;color:var(--text3);cursor:pointer;padding:3px 6px;font-size:11px;flex-shrink:0" title="Remove from playlist">✕</button>`:'';
    return `<div class="t-row${playing?' playing':''}" data-gi="${gi}">
      <div class="t-num"><span class="t-num-n">${medal||String(i+1)}</span><span class="t-eq" style="display:none"><span class="eq-b"></span><span class="eq-b"></span><span class="eq-b"></span></span></div>
      <div class="t-thumb">${thumb}</div>
      <div class="t-info"><div class="t-name">${esc(t.name)}</div><div class="t-meta"><span class="badge ${bCls}">${bTxt}</span>${t.artist?`<span class="t-artist">${esc(t.artist)}</span>`:''} ${lc>0?`<span style="font-size:10px;color:var(--pink);font-family:var(--mono)">♥${lc}</span>`:''}</div></div>
      <span class="t-qual ${qcls}">${ext.toUpperCase()||'?'}</span>
      <div class="t-lbtn${lc>0?' liked':''}" data-gi="${gi}" title="Like"><svg fill="${lc>0?'currentColor':'none'}" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>${lc||''}</div>
      ${rmBtn}
      <div class="t-dur" id="dur-${gi}">${t.duration?fmt(t.duration):'—'}</div>
    </div>`;
  }).join('');
  list.querySelectorAll('.t-row.playing').forEach(r=>{r.querySelector('.t-num-n').style.display='none';r.querySelector('.t-eq').style.display='flex';});
}

// ═══════ CONTEXT MENU ═══════
function showCtxMenu(x,y,items){
  closeCtxMenu();
  const el=document.getElementById('ctx');el.innerHTML='';
  items.forEach(item=>{
    if(item.sep){const hr=document.createElement('div');hr.className='ctx-sep';el.appendChild(hr);return;}
    if(item.sub){const d=document.createElement('div');d.className='ctx-sub';d.textContent=item.sub;el.appendChild(d);return;}
    const d=document.createElement('div');d.className='ctx-item'+(item.danger?' danger':'');d.textContent=item.label;
    d.onclick=()=>{item.action();closeCtxMenu();};el.appendChild(d);
  });
  // Actual menu width/height depends on its longest label (e.g. audio
  // device names), which we don't know until it's laid out — render
  // hidden first, measure, then clamp to the viewport so it can never
  // spill past the window edge.
  el.style.cssText='display:block;visibility:hidden;left:0;top:0';
  const w=el.offsetWidth,h=el.offsetHeight;
  const left=Math.max(8,Math.min(x,window.innerWidth-w-8));
  const top=Math.max(8,Math.min(y,window.innerHeight-h-8));
  el.style.cssText=`display:block;left:${left}px;top:${top}px`;
  setTimeout(()=>document.addEventListener('click',closeCtxMenu,{once:true}),10);
}
function closeCtxMenu(){const el=document.getElementById('ctx');if(el)el.style.display='none';}

function onRowCtx(e,gi){
  e.preventDefault();e.stopPropagation();
  const plItems=playlists.map(pl=>({label:`+ "${pl.name}"`,action:()=>addToPlaylist(pl.id,gi)}));
  showCtxMenu(e.clientX,e.clientY,[
    {label:'▶ Play now',action:()=>loadTrack(gi)},
    {label:'⏭ Play next',action:()=>{queueNext_.unshift(gi);renderQueue();toast(`"${tracks[gi]?.name}" will play next`);}},
    {label:'＋ Add to queue',action:()=>{queueNext_.push(gi);renderQueue();toast(`"${tracks[gi]?.name}" added to queue`);}},
    {label:'♥ Like (+1)',action:()=>likeTrack(gi)},
    {sep:true},
    ...(playlists.length?[{sub:'Add to playlist'},...plItems,{sep:true}]:[]),
    {label:'＋ New playlist',action:async()=>{const n=await showPrompt('New playlist name');if(n){const pl=createPlaylist(n);addToPlaylist(pl.id,gi);}}},
    {sep:true},
    {label:'🗑 Remove from library',action:()=>removeTrack(gi),danger:true},
  ]);
}

// ═══════ QUEUE ═══════
function toggleQueue(){document.getElementById('queue-panel').classList.toggle('show');renderQueue();}
function showQueueTab(t){queueTab=t;document.getElementById('qpt-next').classList.toggle('active',t==='next');document.getElementById('qpt-hist').classList.toggle('active',t==='hist');renderQueue();}
function renderQueue(){
  renderUpNextMini();
  const panel=document.getElementById('queue-panel');if(!panel.classList.contains('show'))return;
  const list=document.getElementById('qp-list');
  const mkItem=t=>{
    const gi=tracks.indexOf(t);
    const artHtml=t.image?`<img src="${esc(t.image)}" alt="">`:'<svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
    return `<div class="qp-item" data-gi="${gi}"><div class="qp-art">${artHtml}</div><div class="qp-info"><div class="qp-name">${esc(t.name)}</div><div class="qp-sub">${t.artist||t.source}</div></div><div class="qp-dur">${t.duration?fmt(t.duration):'—'}</div></div>`;
  };
  if(queueTab==='next'){
    const pool=filtered.length?filtered:tracks;const ci=pool.findIndex(t=>tracks.indexOf(t)===currentIdx);
    const all=[...queueNext_.map(i=>tracks[i]).filter(Boolean),...pool.slice(ci<0?0:ci+1,ci<0?21:ci+21)];
    list.innerHTML=all.length?all.map(mkItem).join(''):'<div style="padding:20px;text-align:center;font-size:12px;color:var(--text3)">Queue is empty</div>';
  } else {
    const hist=history.slice(0,30).map(k=>tracks.find(t=>tkey(t)===k)).filter(Boolean);
    list.innerHTML=hist.length?hist.map(mkItem).join(''):'<div style="padding:20px;text-align:center;font-size:12px;color:var(--text3)">No history yet</div>';
  }
}

// ═══════ FILE OPS ═══════
async function pickFiles(){const files=await GB.pickFiles();if(!files.length)return;const n=addTracks(files);filterAndRender();toast(`✅ Added ${n} file${n!==1?'s':''}`);}
async function pickFolder(){const files=await GB.pickFolder();if(!files.length){toast('No audio files found');return;}const n=addTracks(files);filterAndRender();toast(`✅ Added ${n} track${n!==1?'s':''}`);}
async function linkFolder(){const files=await GB.linkFolder();if(!files.length){toast('No audio files found');return;}const n=addTracks(files);filterAndRender();toast(`🔗 Linked ${n} track${n!==1?'s':''} — playing from original location, not copied`);}

// ═══════ GOOGLE DRIVE ═══════
function openDriveModal(){document.getElementById('drive-modal').classList.add('show');document.getElementById('m-status').innerHTML='';document.getElementById('drive-file-list').style.display='none';document.getElementById('drive-sel-row').style.display='none';GB.storeGet('driveApiKey').then(k=>{if(k&&document.getElementById('sp-drive-apikey'))document.getElementById('sp-drive-apikey').value=k;});}
function closeDriveModal(){document.getElementById('drive-modal').classList.remove('show');driveFiles=[];}
function setMStatus(msg,cls){const el=document.getElementById('m-status');el.innerHTML=msg;el.className=cls||'';}

async function fetchDriveFolder(){
  if(!requireOnline('Google Drive'))return;
  const rawUrl=(document.getElementById('drive-url')?.value||'').trim();
  if(!rawUrl){setMStatus('Paste a Drive folder link','err');return;}
  const m=rawUrl.match(/folders\/([a-zA-Z0-9_-]+)/);if(!m){setMStatus('Invalid URL — must contain /folders/ID','err');return;}
  const folderId=m[1];
  document.getElementById('drive-fetch-btn').disabled=true;
  setMStatus('<span style="color:var(--text2)">Fetching…</span>','');
  try {
    const res=await GB.gdriveList(folderId);
    if(res.error){setMStatus(res.error,'err');return;}
    driveFiles=res.files||[];
    if(!driveFiles.length){setMStatus('No audio files found. Is the folder public?','err');return;}
    renderDriveFileList();
    setMStatus(`✅ Found ${driveFiles.length} audio file${driveFiles.length!==1?'s':''}. Select which to import.`,'ok');
  } catch(e){setMStatus('Error: '+e.message,'err');}
  document.getElementById('drive-fetch-btn').disabled=false;
}

function renderDriveFileList(){
  const list=document.getElementById('drive-file-list');list.style.display='block';document.getElementById('drive-sel-row').style.display='flex';
  list.innerHTML=driveFiles.map((f,i)=>`<div class="df-row"><input type="checkbox" class="df-cb" data-i="${i}" checked><span class="df-name">${esc(f.name)}</span><span class="df-size">${f.size?fmtB(parseInt(f.size)):'—'}</span></div>`).join('');
}
function toggleSelectAllDrive(c){document.querySelectorAll('.df-cb').forEach(cb=>cb.checked=c);}
async function importSelectedDrive(){
  const sel=[];document.querySelectorAll('.df-cb').forEach(cb=>{if(cb.checked)sel.push(driveFiles[parseInt(cb.dataset.i)]);});
  if(!sel.length){toast('Select at least one file');return;}
  closeDriveModal();
  const metas=sel.map(f=>({id:f.id,name:f.name.replace(/\.[^/.]+$/,''),ext:(f.name.match(/\.([^.]+)$/)||['','mp3'])[1].toLowerCase(),size:parseInt(f.size||0),mimeType:f.mimeType,source:'gdrive',addedAt:Date.now(),likes:0}));
  const n=addTracks(metas);filterAndRender();toast(`☁ Added ${n} track${n!==1?'s':''} from Drive`);setView('gdrive');
}

// ═══════ DISCOVER ═══════
let discoverSrc = 'youtube';
const DISC_SOURCE_INFO = {
  youtube: '▶ <strong style="color:var(--text2)">YouTube Music</strong> — Any song ever made. Full tracks. Needs your free YouTube API key + yt-dlp (Settings).',
  spotify: '🎧 <strong style="color:var(--text2)">Spotify</strong> — Search Spotify\'s catalog for accurate metadata, then plays the matching track via YouTube (Spotify audio itself can\'t be streamed here).',
};
function setDiscoverSource(s) {
  discoverSrc = s;
  const ytBtn = document.getElementById('dsrc-youtube'); if (ytBtn) ytBtn.style.opacity = (s === 'youtube') ? '1' : '.55';
  const spBtn = document.getElementById('dsrc-spotify'); if (spBtn) spBtn.style.opacity = (s === 'spotify') ? '1' : '.55';
  const info = document.getElementById('disc-info-text');
  if (info) info.innerHTML = DISC_SOURCE_INFO[s] || '';
}

async function searchDiscover() {
  if(!requireOnline('Discover search'))return;
  const q = (document.getElementById('discover-input')?.value || '').trim();
  if (!q) { toast('Type an artist or song name'); return; }
  const resultsEl = document.getElementById('discover-results');
  resultsEl.innerHTML = '<div class="disc-empty"><div class="spin" style="width:24px;height:24px;border-width:3px;margin:0 auto"></div><div style="margin-top:10px">Searching…</div></div>';
  discoverShowingLiked = false;
  discoverBrowsing = null;
  discoverAlbums = []; discoverPlaylists = [];
  document.getElementById('dsrc-liked')?.classList.remove('active');
  try {
    if (discoverSrc === 'spotify') {
      const clientId = await GB.storeGet('spotifyClientId');
      const clientSecret = await GB.storeGet('spotifyClientSecret');
      if (!clientId || !clientSecret) {
        resultsEl.innerHTML = `<div class="disc-empty">
          <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" style="width:36px;height:36px;opacity:.3"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <div style="margin-top:10px;font-weight:600">Spotify Credentials Required</div>
          <div style="font-size:11px;color:var(--text3);margin-top:6px;max-width:300px;line-height:1.5">
            Add your free Spotify Client ID + Secret in<br>
            <strong style="color:var(--acc)">Settings → Spotify</strong>
          </div>
          <button onclick="openSettings()" style="margin-top:14px;padding:8px 20px;border-radius:12px;background:var(--acc);color:#fff;border:none;cursor:pointer;font-size:12px;font-weight:700">Open Settings</button>
        </div>`;
        return;
      }
      const data = await GB.spotifySearch({ query: q, clientId, clientSecret });
      if (data.error) {
        resultsEl.innerHTML = `<div class="disc-empty"><div>⚠ ${esc(data.error)}</div><div style="font-size:11px;color:var(--text3);margin-top:6px">Check your Client ID/Secret in Settings</div></div>`;
        return;
      }
      discoverResults = data.tracks || [];
      discoverAlbums = data.albums || [];
      discoverPlaylists = data.playlists || [];
    } else {
      const apiKey = await GB.storeGet('ytApiKey');
      if (!apiKey) {
        resultsEl.innerHTML = `<div class="disc-empty">
          <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" style="width:36px;height:36px;opacity:.3"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <div style="margin-top:10px;font-weight:600">YouTube API Key Required</div>
          <div style="font-size:11px;color:var(--text3);margin-top:6px;max-width:300px;line-height:1.5">
            Add your free YouTube Data API key in<br>
            <strong style="color:var(--acc)">Settings → YouTube Music → API Key</strong>
          </div>
          <button onclick="openSettings()" style="margin-top:14px;padding:8px 20px;border-radius:12px;background:var(--acc);color:#fff;border:none;cursor:pointer;font-size:12px;font-weight:700">Open Settings</button>
        </div>`;
        return;
      }
      const data = await GB.ytSearch({ query: q + ' official audio', apiKey });
      if (data.error) {
        resultsEl.innerHTML = `<div class="disc-empty"><div>⚠ ${esc(data.error)}</div><div style="font-size:11px;color:var(--text3);margin-top:6px">Check your API key in Settings</div></div>`;
        return;
      }
      discoverResults = (data.items || []).map(t => ({ ...t, license: 'YouTube' }));
    }
    renderDiscoverResults('No results found', 'Try a different search term');
  } catch (e) { resultsEl.innerHTML = `<div class="disc-empty"><div>Error: ${esc(e.message)}</div></div>`; }
}

// Album/playlist cards shown above the track list for a Spotify
// search — empty (returns '') for every other case (YouTube search,
// Liked Songs, or already browsing inside one of these).
function renderDiscoverGroups() {
  if (discoverBrowsing || (!discoverAlbums.length && !discoverPlaylists.length)) return '';
  const card = (item, kind) => {
    const thumb = item.image ? `<img src="${esc(item.image)}" alt="" loading="lazy">` : '<svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" style="width:20px;height:20px;opacity:.3"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
    const sub = kind === 'album' ? esc(item.artist || '') : `${esc(item.owner || 'Spotify')}${item.trackCount ? ' · ' + item.trackCount + ' tracks' : ''}`;
    const onclick = `openDiscoverContainer('${kind}','${item.spotifyId}',${JSON.stringify(item.name).replace(/"/g,'&quot;')})`;
    return `<div class="disc-card" onclick="${onclick}">
      <div class="disc-card-art">${thumb}</div>
      <div class="disc-card-name">${esc(item.name)}</div>
      <div class="disc-card-sub">${sub}</div>
    </div>`;
  };
  let html = '';
  if (discoverAlbums.length) html += `<div class="disc-group-title">Albums</div><div class="disc-card-grid">${discoverAlbums.map(a => card(a, 'album')).join('')}</div>`;
  if (discoverPlaylists.length) html += `<div class="disc-group-title">Playlists</div><div class="disc-card-grid">${discoverPlaylists.map(p => card(p, 'playlist')).join('')}</div>`;
  if (discoverResults.length) html += `<div class="disc-group-title">Tracks</div>`;
  return html;
}

// Shared by searchDiscover() and showDiscoverLiked() — both just
// populate discoverResults differently and then render the same way.
function renderDiscoverResults(emptyTitle, emptySub) {
  const resultsEl = document.getElementById('discover-results');
  const backBar = discoverBrowsing
    ? `<div class="disc-back-bar" onclick="backFromDiscoverBrowsing()"><svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg> ${discoverBrowsing.type === 'album' ? 'Album' : 'Playlist'}: ${esc(discoverBrowsing.name)}</div>`
    : '';
  const groupsHtml = renderDiscoverGroups();
  if (!discoverResults.length) {
    resultsEl.innerHTML = backBar + groupsHtml + `<div class="disc-empty"><svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" style="width:36px;height:36px;opacity:.2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><div style="margin-top:8px">${esc(emptyTitle)}</div><div style="font-size:11px;color:var(--text3);margin-top:4px">${esc(emptySub)}</div></div>`;
    return;
  }
  resultsEl.innerHTML = backBar + groupsHtml + discoverResults.map((t, i) => {
    const isYt = t.source === 'youtube';
    const isSp = t.source === 'spotify';
    const thumb = t.image ? `<img src="${esc(t.image)}" alt="" loading="lazy">` : '<svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" style="width:18px;height:18px;opacity:.3"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
    const srcBadge = isSp
      ? '<span style="font-size:8px;padding:1px 5px;border-radius:4px;background:rgba(30,215,96,.12);color:#1ed760;border:1px solid rgba(30,215,96,.25);font-family:var(--mono)">SPOTIFY · PLAYS VIA YT</span>'
      : isYt
      ? '<span style="font-size:8px;padding:1px 5px;border-radius:4px;background:rgba(255,0,0,.12);color:#ff4444;border:1px solid rgba(255,0,0,.2);font-family:var(--mono)">YT · FULL</span>'
      : `<span class="disc-license">${t.license || 'CC'} · FULL</span>`;
    const liked = isDiscoverLiked(t);
    return `<div class="disc-result">
      <div class="disc-art">${thumb}</div>
      <div class="disc-info">
        <div class="disc-name">${esc(t.name || t.rawTitle || '')}</div>
        <div class="disc-artist">${esc(t.artist || '')}</div>
        <div class="disc-meta">${srcBadge}${t.duration ? `<span style="font-size:10px;color:var(--text3);font-family:var(--mono)">${fmt(t.duration)}</span>` : ''}</div>
      </div>
      <button class="disc-add${liked ? ' liked' : ''}" data-disc-i="${i}" title="${liked ? 'Remove from Liked Songs' : 'Add to Liked Songs'}" onclick="toggleDiscoverLike(${i},this)">${liked ? '♥ Liked' : '♡ Like'}</button>
      <button class="disc-play" data-disc-i="${i}" title="Play now" onclick="playDiscoverTrack(${i})">
        <svg fill="currentColor" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21"/></svg>
      </button>
    </div>`;
  }).join('');
}

// Shared by playDiscoverTrack() and loadTrack() — extracts a playable
// audio stream for a YouTube-sourced track via yt-dlp and plays it,
// with a webm→ogg fallback since yt-dlp's chosen format isn't always
// decodable as-is. Self-contained (calls play() itself, like the
// other online sources' handling) rather than just setting aud.src,
// because the fallback needs to know whether the first attempt failed.
async function playYoutubeTrack(t) {
  toast('⏳ Loading from YouTube…');
  showLoad('Extracting audio stream via yt-dlp…');
  try {
    const streamData = await GB.ytGetStream(t.id);
    if (streamData.error || !streamData.url) {
      toast('❌ Could not get stream: ' + (streamData.error || 'No URL'));
      hideLoad(); return;
    }
    showLoad('Buffering audio…');
    const audioData = await GB.ytStreamAudio(streamData.url);
    if (audioData.error || !audioData.data) {
      toast('❌ Stream error: ' + (audioData.error || 'No data'));
      hideLoad(); return;
    }
    if (aud.src && aud.src.startsWith('blob:')) URL.revokeObjectURL(aud.src);
    aud.src = URL.createObjectURL(new Blob([audioData.data], { type: 'audio/webm' }));
    aud.load();
    aud.play()
      .then(() => { setPP(false); setupVis(); })
      .catch((err) => {
        if (err.name === 'AbortError') return; // superseded by a newer track load, not a real failure
        aud.src = URL.createObjectURL(new Blob([audioData.data], { type: 'audio/ogg' }));
        aud.load(); aud.play()
          .then(() => { setPP(false); setupVis(); })
          .catch((err2) => {if(err2.name!=='AbortError')toast('❌ Cannot play — unsupported format');});
      });
  } catch (e) { toast('❌ YouTube error: ' + e.message); }
  hideLoad();
}

// Spotify search gives accurate metadata but no playable audio — the
// first time a Spotify result is actually played or liked, resolve it
// to a real YouTube video (same lookup as a normal YouTube Music
// search) and keep Spotify's name/artist/artwork on top of it, so
// from that point on it's a genuine YouTube track and behaves exactly
// like any other one everywhere else in the app.
async function resolveSpotifyToYoutube(t) {
  if (t.source !== 'spotify') return t;
  const apiKey = await GB.storeGet('ytApiKey');
  if (!apiKey) { toast('❌ YouTube API key required to play Spotify matches (Settings)'); return null; }
  toast(`🔎 Finding "${t.name}" on YouTube…`);
  const data = await GB.ytSearch({ query: `${t.artist} ${t.name} official audio`, apiKey });
  if (data.error || !data.items?.length) { toast('❌ No YouTube match found for this track'); return null; }
  const match = data.items[0];
  return { ...t, id: match.id, source: 'youtube', license: 'YouTube', spotifyMatched: true, ext: 'webm' };
}

async function playDiscoverTrack(i) {
  if(!requireOnline('online streaming'))return;
  let t = discoverResults[i]; if (!t) return;
  if (t.source === 'spotify') {
    const resolved = await resolveSpotifyToYoutube(t);
    if (!resolved) return;
    t = discoverResults[i] = resolved;
    renderDiscoverResults('No results found', 'Try a different search term');
  }
  if (!tracks.find(x => tkey(x) === tkey(t))) { tracks.push({ ...t, likes: 0 }); document.getElementById('sb-cnt').textContent = tracks.length; }
  const gi = tracks.findIndex(x => tkey(x) === tkey(t));
  currentIdx = gi;
  const k = tkey(t);
  history = history.filter(h => h !== k); history.unshift(k); history = history.slice(0, 100); GB.storeSet('history', history);
  updateNowPlaying(t); updateAudioInfo(t); filterAndRender();

  if (t.source === 'youtube') {
    await playYoutubeTrack(t);
  } else {
    if (!t.url) { toast('❌ No stream URL'); return; }
    toast('⏳ Loading stream…'); showLoad('Streaming…');
    try {
      const buf = await GB.streamUrl(t.url);
      if (aud.src && aud.src.startsWith('blob:')) URL.revokeObjectURL(aud.src);
      aud.src = URL.createObjectURL(new Blob([buf], { type: getMime(t.ext) }));
      aud.load(); aud.play().then(() => { setPP(false); setupVis(); }).catch(err => {if(err.name!=='AbortError')toast('❌ ' + err.message);});
    } catch (e) { toast('❌ Stream error: ' + e.message); }
    hideLoad();
  }
}

// Liked Songs in Discover — uses the SAME likes{} system as the rest
// of the app (the now-playing bar's heart, the right-click "Like",
// the sidebar Liked view) rather than a separate store, so liking a
// track from any one of those places is reflected everywhere,
// including here. This tab is just a YouTube-only slice of it.
function isDiscoverLiked(t) {
  const existing = tracks.find(x => tkey(x) === tkey(t));
  return !!(existing && (existing.likes || 0) > 0);
}
async function toggleDiscoverLike(i, btn) {
  let t = discoverResults[i]; if (!t) return;
  // Unliking a track that was a Spotify match doesn't need re-resolving
  // (it's already stored as source:'youtube' in tracks[] by then) —
  // only a still-unresolved Spotify row needs the lookup, and only
  // when actually being liked, not un-liked.
  if (t.source === 'spotify' && !isDiscoverLiked(t)) {
    const resolved = await resolveSpotifyToYoutube(t);
    if (!resolved) return;
    t = discoverResults[i] = resolved;
  }
  if (!tracks.find(x => tkey(x) === tkey(t))) { tracks.push({ ...t, likes: 0 }); document.getElementById('sb-cnt').textContent = tracks.length; }
  const gi = tracks.findIndex(x => tkey(x) === tkey(t));
  const k = tkey(t);
  const already = (tracks[gi].likes || 0) > 0;
  if (already) {
    likes[k] = 0; tracks[gi].likes = 0;
    toast(`Removed "${t.name}" from Liked Songs`);
  } else {
    likes[k] = (likes[k] || 0) + 1; tracks[gi].likes = likes[k];
    toast(`♥ Added "${t.name}" to Liked Songs`);
  }
  GB.storeSet('likes', likes);
  updateNowPlayingLike();
  if (discoverShowingLiked) { showDiscoverLiked(); }
  else if (btn) {
    const liked = !already;
    btn.classList.toggle('liked', liked);
    btn.textContent = liked ? '♥ Liked' : '♡ Like';
    btn.title = liked ? 'Remove from Liked Songs' : 'Add to Liked Songs';
  }
}
function showDiscoverLiked() {
  discoverShowingLiked = true;
  discoverBrowsing = null;
  discoverAlbums = []; discoverPlaylists = [];
  discoverResults = tracks.filter(t => t.source === 'youtube' && (t.likes || 0) > 0);
  document.getElementById('dsrc-liked')?.classList.add('active');
  renderDiscoverResults('No liked songs yet', 'Like a YouTube search result to save it here');
}

// Spotify search returns albums/playlists as browsable containers, not
// directly playable — opening one fetches its tracks and swaps the
// results view into them, same way a plain track search would.
async function openDiscoverContainer(kind, id, name) {
  toast(`Loading "${name}"…`);
  const clientId = await GB.storeGet('spotifyClientId');
  const clientSecret = await GB.storeGet('spotifyClientSecret');
  const data = kind === 'album'
    ? await GB.spotifyAlbumTracks({ albumId: id, clientId, clientSecret })
    : await GB.spotifyPlaylistTracks({ playlistId: id, clientId, clientSecret });
  if (data.error) { toast('❌ ' + data.error); return; }
  discoverResults = data.tracks || [];
  discoverBrowsing = { type: kind, name };
  renderDiscoverResults('No tracks found', '');
}
function backFromDiscoverBrowsing() {
  discoverBrowsing = null;
  searchDiscover();
}

// ═══════ SEARCH ═══════
function onSearchInput(){
  filterAndRender(); // instant text filter
}

// ═══════ PLAYBACK ═══════
async function loadTrack(idx){
  if(idx<0||idx>=tracks.length) return;
  const t=tracks[idx]; currentIdx=idx;
  const k=tkey(t); history=history.filter(h=>h!==k); history.unshift(k); history=history.slice(0,100); GB.storeSet('history',history);
  saveLastPlayed(0);
  if(aud.src&&aud.src.startsWith('blob:')) URL.revokeObjectURL(aud.src);

  // Gate online sources
  if(t.source!=='local'){
    if(!requireOnline('playing '+t.source+' tracks')){currentIdx=-1;return;}
  }

  if(t.source==='local'){
    try{const buf=await GB.readFile(t.path);const blob=new Blob([buf],{type:getMime(t.ext)});aud.src=URL.createObjectURL(blob);}
    catch(e){toast(`❌ Cannot read: ${t.name}`);return;}
    enrichLocalTrackTags(t);
  } else if(t.source==='gdrive'){
    toast('☁ Streaming from Drive…');showLoad('Streaming from Google Drive…');
    try{const buf=await GB.gdriveStream(t.id);const blob=new Blob([buf],{type:getMime(t.ext)||t.mimeType||'audio/mpeg'});aud.src=URL.createObjectURL(blob);}
    catch(e){toast('Stream error: '+e.message);hideLoad();return;}
    hideLoad();
  } else if(t.source==='jamendo'||t.source==='fma'||t.source==='itunes'){
    toast('⏳ Loading stream…');showLoad('Streaming…');
    try{const buf=await GB.streamUrl(t.url);aud.src=URL.createObjectURL(new Blob([buf],{type:getMime(t.ext)}));}
    catch(e){toast('Stream error: '+e.message);hideLoad();return;}
    hideLoad();
  } else if(t.source==='youtube'){
    // Self-contained: fetches, sets aud.src, and calls play() itself
    // (with a format fallback) — skip the generic tail below.
    updateNowPlaying(t); updateAudioInfo(t);
    filterAndRender(); renderQueue();
    if(audioCtx&&audioCtx.state==='suspended') audioCtx.resume();
    await playYoutubeTrack(t);
    return;
  }

  updateNowPlaying(t); updateAudioInfo(t);
  filterAndRender(); renderQueue();
  if(audioCtx&&audioCtx.state==='suspended') audioCtx.resume();
  // AbortError here just means the user skipped to another track before
  // this play() settled (e.g. clicking Next repeatedly) — the newer
  // load already supersedes it, so it's not a real failure worth an
  // error toast.
  aud.load(); aud.play().then(()=>{setPP(false);setupVis();}).catch(err=>{if(err.name!=='AbortError')toast(`❌ Playback error: ${err.message}`);});
}

// Reads embedded ID3/etc. tags for a local file just-in-time (not a
// bulk library scan — far too slow across a large library) and fills
// in artist/cover art when the filename alone didn't have them.
async function enrichLocalTrackTags(t){
  if(t.source!=='local'||t._tagsChecked) return;
  t._tagsChecked=true;
  try{
    const tags=await GB.readTags(t.path);
    let changed=false;
    if(tags.artist&&!t.artist){t.artist=tags.artist;changed=true;}
    if(tags.image&&!t.image){t.image=tags.image;changed=true;}
    if(changed&&tracks[currentIdx]===t){
      updateNowPlaying(t);
      pushMiniState();
      filterAndRender();
    }
  }catch(e){}
}

// Wires GrooveBox into Windows' System Media Transport Controls (the
// media overlay / lock-screen widget) so hardware and on-screen media
// keys — play/pause, next, previous — control the app system-wide, not
// just play/pause (which Chromium already wires up automatically for
// any playing <audio> element — next/previous need this explicitly).
function initMediaSession(){
  if(!('mediaSession' in navigator))return;
  navigator.mediaSession.setActionHandler('play',()=>aud.play());
  navigator.mediaSession.setActionHandler('pause',()=>aud.pause());
  navigator.mediaSession.setActionHandler('previoustrack',()=>playPrev());
  navigator.mediaSession.setActionHandler('nexttrack',()=>playNext());
  navigator.mediaSession.setActionHandler('stop',()=>aud.pause());
  navigator.mediaSession.setActionHandler('seekto',d=>{if(d.seekTime!=null&&aud.duration)aud.currentTime=d.seekTime;});
}

// ── Taskbar thumbnail toolbar (Win) ──────────────────────────────
// setThumbarButtons() (main process) needs real bitmaps, not SVG — so
// the existing play/pause/prev/next glyphs are rasterized here once
// via an offscreen canvas and handed over as PNG data URLs.
function svgToPngDataUrl(svgStr,size=32){
  return new Promise((resolve,reject)=>{
    const img=new Image();
    img.onload=()=>{
      const c=document.createElement('canvas');c.width=size;c.height=size;
      c.getContext('2d').drawImage(img,0,0,size,size);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror=reject;
    img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svgStr);
  });
}
async function initThumbar(){
  if(!GB.setThumbarIcons)return;
  try{
    const [prev,play,pause,next]=await Promise.all([
      svgToPngDataUrl('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="4" y="4" width="2.5" height="16" fill="#fff"/><polygon points="20,4 20,20 7,12" fill="#fff"/></svg>'),
      svgToPngDataUrl('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><polygon points="6,4 20,12 6,20" fill="#fff"/></svg>'),
      svgToPngDataUrl('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" fill="#fff"/><rect x="14" y="4" width="4" height="16" fill="#fff"/></svg>'),
      svgToPngDataUrl('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="17.5" y="4" width="2.5" height="16" fill="#fff"/><polygon points="4,4 4,20 17,12" fill="#fff"/></svg>'),
    ]);
    await GB.setThumbarIcons({prev,play,pause,next});
    GB.setThumbarPlaying(!aud.paused);
  }catch(e){}
  GB.onThumbarCmd(cmd=>{
    if(cmd==='prev')playPrev();
    else if(cmd==='next')playNext();
    else if(cmd==='playpause')togglePlay();
  });
}
// MediaMetadata artwork rejects file:// URLs outright (silently, but
// noisily logs a warning on every internal SMTC sync attempt — this
// was firing many times a second and generating tens of MB/s of log
// spam) and has an undocumented max URL length, so a raw embedded-art
// data: URI can blow past it too. Both failure modes get filtered out
// here before anything ever reaches MediaMetadata.
let _defaultArtDataUrl=null;
(async()=>{
  try{
    const resp=await fetch('assets/icon.png');
    const blob=await resp.blob();
    _defaultArtDataUrl=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(blob);});
  }catch(e){}
})();
function pickMediaArtwork(t){
  const img=t?.image;
  if(img&&img.startsWith('https://'))return img;
  if(img&&img.startsWith('data:')&&img.length<60000)return img;
  return _defaultArtDataUrl;
}
function updateMediaSession(t){
  if(!('mediaSession' in navigator))return;
  const art=pickMediaArtwork(t);
  navigator.mediaSession.metadata=new MediaMetadata({
    title:t?.name||'GrooveBox',
    artist:t?.artist||'',
    artwork:art?[{src:art,sizes:'256x256',type:'image/png'}]:[],
  });
}

function updateNowPlaying(t){
  if(!t){
    document.getElementById('np-title').textContent='Nothing playing';
    const s=document.getElementById('np-sub-txt');if(s)s.textContent='—';
    const p=document.getElementById('np-qual-pill');if(p)p.style.display='none';
    document.getElementById('tb-qual').textContent='NO FILE';
    document.getElementById('fp-tname').textContent='Nothing playing';
    document.getElementById('fp-tsub').textContent='—';
    updateProgFill(0);updateMediaSession(null);return;
  }
  const ql=qualLabel(t);
  document.getElementById('np-title').textContent=t.name;
  const s=document.getElementById('np-sub-txt');if(s)s.textContent=t.source==='gdrive'?'☁ Drive':t.source==='jamendo'||t.source==='fma'?'🎵 Free Music':'💻 Local';
  const p=document.getElementById('np-qual-pill');if(p){p.textContent=ql;p.style.display='inline';}
  document.getElementById('tb-qual').textContent=ql;
  document.getElementById('fp-tname').textContent=t.name;
  document.getElementById('fp-tsub').textContent=(t.artist?t.artist+' · ':'')+(t.source==='jamendo'||t.source==='fma'?'Free Music · ':'')+ql;
  updateMediaSession(t);
  updateNowPlayingLike();
}

function qualLabel(t){const e=(t.ext||'').toLowerCase();if(['flac','wav','aif','aiff'].includes(e))return 'LOSSLESS';if(['m4a','aac'].includes(e))return 'AAC';if(e==='mp3')return 'MP3';if(e==='ogg'||e==='opus')return 'OGG';return e.toUpperCase()||'AUDIO';}
function updateAudioInfo(t){
  const e=(t.ext||'').toLowerCase();
  document.getElementById('ai-fmt').textContent=e.toUpperCase()||'—';
  document.getElementById('ai-sr').textContent=['flac','wav','aif','aiff'].includes(e)?'Up to 96 kHz':'44.1 kHz';
  document.getElementById('ai-bd').textContent=['flac','wav','aif','aiff'].includes(e)?'Up to 24-bit':'16-bit';
  document.getElementById('ai-ch').textContent='Stereo';
  document.getElementById('ai-src').textContent=t.source==='gdrive'?'Google Drive':t.source==='jamendo'?'Jamendo':t.source==='fma'?'Free Music Archive':'Local';
  document.getElementById('ai-sz').textContent=fmtB(t.size);
}

aud.addEventListener('timeupdate',()=>{
  if(!aud.duration||isNaN(aud.duration))return;
  const pct=(aud.currentTime/aud.duration)*100;
  const progEl=document.getElementById('prog');progEl.value=pct;updateProgFill(pct);
  document.getElementById('t-cur').textContent=fmt(aud.currentTime);
  document.getElementById('t-tot').textContent=fmt(aud.duration);
  if(currentIdx>=0&&!tracks[currentIdx].duration&&aud.duration){tracks[currentIdx].duration=aud.duration;const d=document.getElementById('dur-'+currentIdx);if(d)d.textContent=fmt(aud.duration);}
  pushMiniState();
  if(Date.now()-_lastPlayedSaveAt>5000){_lastPlayedSaveAt=Date.now();saveLastPlayed(aud.currentTime);}
});
aud.addEventListener('ended',()=>{
  if(sleepTimerEndOfTrack){toast('😴 Sleep timer — playback paused');cancelSleepTimer();return;}
  if(repeat){aud.currentTime=0;aud.play();}else playNext();
});
aud.addEventListener('pause',()=>{setPP(true);pushMiniState();if('mediaSession' in navigator)navigator.mediaSession.playbackState='paused';if(GB.setThumbarPlaying)GB.setThumbarPlaying(false);});
aud.addEventListener('play', ()=>{setPP(false);pushMiniState();if('mediaSession' in navigator)navigator.mediaSession.playbackState='playing';if(GB.setThumbarPlaying)GB.setThumbarPlaying(true);});
// aud.load() can reset playbackRate on some platforms — re-apply on
// every new src rather than chasing each load() call site individually.
aud.addEventListener('loadedmetadata',()=>{aud.playbackRate=settings.playbackRate||1;});
aud.addEventListener('error',()=>{const msgs={1:'Aborted',2:'Network error',3:'Decode error — unsupported format',4:'Not found'};toast(`❌ ${msgs[aud.error?.code]||'Playback error'}: ${tracks[currentIdx]?.name||''}`);setPP(true);});

function setPP(paused){const icon=document.getElementById('pp-icon');if(!icon)return;icon.innerHTML=paused?'<polygon points="5 3 19 12 5 21"/>':'<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';}
function updateProgFill(pct){const p=document.getElementById('prog');if(!p)return;p.style.background=`linear-gradient(to right,var(--acc) 0%,var(--acc) ${pct}%,var(--bg4) ${pct}%,var(--bg4) 100%)`;}
// timeupdate fires many times a second — embedded cover art can be a
// sizeable data: URI, so re-sending it on every single tick through
// IPC is real, needless overhead. Only include `image` in the payload
// when it actually changes; the mini window keeps whatever it's
// already showing on ticks where the key is omitted.
let _lastSentImage;
// The mini window can open fresh at any time with no prior state, so
// the "only send image when it changes" optimisation in pushMiniState
// has to be bypassed right when it opens — otherwise a freshly-opened
// mini player that happens to match the last-sent value never gets an
// image at all (blank, no visualiser fallback either).
function openMiniPlayer(){_lastSentImage=undefined;GB.openMini();pushMiniState();setTimeout(()=>{_lastSentImage=undefined;pushMiniState();},400);}
function pushMiniState(){
  const t=currentIdx>=0?tracks[currentIdx]:null;
  const payload={title:t?.name||'Nothing playing',sub:t?(t.source==='gdrive'?'☁ Drive':t.source==='jamendo'||t.source==='fma'?'🎵 Free':'💻 Local'):'—',quality:t?qualLabel(t):'',pct:aud.duration&&!isNaN(aud.duration)?(aud.currentTime/aud.duration)*100:0,timeCur:fmt(aud.currentTime),timeTot:fmt(aud.duration||0),playing:!aud.paused};
  const curImage=t?.image||null;
  if(curImage!==_lastSentImage){payload.image=curImage;_lastSentImage=curImage;}
  GB.sendPlayerState(payload);
}
function togglePlay(){aud.paused?aud.play():aud.pause();}
function seek(v){if(aud.duration&&!isNaN(aud.duration))aud.currentTime=(parseFloat(v)/100)*aud.duration;updateProgFill(parseFloat(v));}
function setVol(v){aud.volume=parseFloat(v);muted=(v==0);settings.volume=parseFloat(v);GB.storeSet('settings',settings);updateVolIcon();}
function toggleMute(){if(muted){aud.volume=prevVol;document.getElementById('vol').value=prevVol;}else{prevVol=aud.volume;aud.volume=0;document.getElementById('vol').value=0;}muted=!muted;updateVolIcon();}
function updateVolIcon(){
  const icon=document.getElementById('vol-icon');if(!icon)return;
  icon.innerHTML=muted
    ?'<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>'
    :'<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>';
}
// ═══════ PLAYBACK SPEED ═══════
const SPEED_OPTIONS=[0.5,0.75,1,1.25,1.5,1.75,2];
function setPlaybackSpeed(rate,silent=false){
  rate=parseFloat(rate)||1;
  aud.playbackRate=rate;
  settings.playbackRate=rate;
  const v=document.getElementById('speed-val');if(v)v.textContent=rate.toFixed(2).replace(/\.?0+$/,'')+'×';
  if(!silent){GB.storeSet('settings',settings);toast(`Speed: ${rate}×`);}
}
function cycleSpeedMenu(e){
  e.stopPropagation();
  showCtxMenu(e.clientX,e.clientY,SPEED_OPTIONS.map(r=>({
    label:(r===1?'1× (Normal)':r+'×')+(Math.abs((settings.playbackRate||1)-r)<0.001?'  ✓':''),
    action:()=>setPlaybackSpeed(r),
  })));
}

// ═══════ SLEEP TIMER ═══════
// Purely a countdown to pause() (or "let the current track finish,
// then pause") — doesn't touch what's queued/playing otherwise, so
// skipping tracks while it's running is unaffected.
function openSleepMenu(e){
  e.stopPropagation();
  const active=sleepTimerId||sleepTimerEndOfTrack;
  showCtxMenu(e.clientX,e.clientY,[
    {label:'15 min',action:()=>setSleepTimer(15)},
    {label:'30 min',action:()=>setSleepTimer(30)},
    {label:'45 min',action:()=>setSleepTimer(45)},
    {label:'60 min',action:()=>setSleepTimer(60)},
    {label:'End of current track',action:()=>setSleepTimerEndOfTrack()},
    ...(active?[{sep:true},{label:'✕ Turn off',action:()=>cancelSleepTimer(),danger:true}]:[]),
  ]);
}
function setSleepTimer(minutes){
  cancelSleepTimer();
  sleepTimerEndAt=Date.now()+minutes*60000;
  sleepTimerId=setTimeout(()=>{
    aud.pause();
    toast('😴 Sleep timer — playback paused');
    cancelSleepTimer();
  },minutes*60000);
  updateSleepUi();
  sleepTimerUiInterval=setInterval(updateSleepUi,15000);
  toast(`😴 Sleep timer set — ${minutes} min`);
}
function setSleepTimerEndOfTrack(){
  cancelSleepTimer();
  sleepTimerEndOfTrack=true;
  updateSleepUi();
  toast('😴 Will pause at the end of this track');
}
function cancelSleepTimer(){
  if(sleepTimerId){clearTimeout(sleepTimerId);sleepTimerId=null;}
  if(sleepTimerUiInterval){clearInterval(sleepTimerUiInterval);sleepTimerUiInterval=null;}
  sleepTimerEndAt=null;sleepTimerEndOfTrack=false;
  updateSleepUi();
}
function updateSleepUi(){
  const v=document.getElementById('sleep-val');if(!v)return;
  if(sleepTimerEndOfTrack){v.textContent='End of track';}
  else if(sleepTimerEndAt){
    const mins=Math.max(0,Math.ceil((sleepTimerEndAt-Date.now())/60000));
    v.textContent=mins+' min';
  } else v.textContent='Off';
}

// ═══════ AUDIO OUTPUT DEVICE ═══════
// Deliberately NOT a native <select> — the expanded options list of a
// native select is OS-drawn and can't be styled to match the glass
// theme, so this uses the same showCtxMenu() glass popup as the
// Speed/Sleep Timer buttons instead.
let _audioOutputDevices=[];
async function loadAudioOutputDevices(){
  const label=document.getElementById('sp-audio-output-label');
  try{
    // Labels are only populated after a permission prompt on some
    // platforms; harmless to request since this is output-only (no
    // mic data involved) and Chromium generally grants it silently.
    try{await navigator.mediaDevices.getUserMedia({audio:true}).then(s=>s.getTracks().forEach(t=>t.stop()));}catch(e){}
    const devices=await navigator.mediaDevices.enumerateDevices();
    _audioOutputDevices=devices.filter(d=>d.kind==='audiooutput');
  }catch(e){_audioOutputDevices=[];}
  updateAudioOutputLabel();
}
function updateAudioOutputLabel(){
  const label=document.getElementById('sp-audio-output-label');if(!label)return;
  const match=_audioOutputDevices.find(d=>d.deviceId===settings.audioOutputId);
  label.textContent=match?(match.label||'Audio device'):'Default Audio Device';
}
function openAudioOutputMenu(e){
  e.stopPropagation();
  const items=[{label:'Default Audio Device'+(!settings.audioOutputId?'  ✓':''),action:()=>setAudioOutput('')}];
  _audioOutputDevices.forEach(d=>{
    if(!d.deviceId)return;
    items.push({label:(d.label||'Audio device')+(settings.audioOutputId===d.deviceId?'  ✓':''),action:()=>setAudioOutput(d.deviceId)});
  });
  showCtxMenu(e.clientX,e.clientY,items);
}
async function setAudioOutput(deviceId,silent=false){
  settings.audioOutputId=deviceId||'';
  if(!silent)GB.storeSet('settings',settings);
  updateAudioOutputLabel();
  // Once a track has played, aud is captured into the Web Audio graph
  // (for EQ/visualizer) and audibly comes out of audioCtx.destination
  // instead — at that point aud.setSinkId() doesn't just "do nothing",
  // it actively THROWS AbortError (Chromium refuses it on a captured
  // element), so it can't be tried first or it aborts before the call
  // that actually matters. audioCtx.setSinkId() is the one that's
  // authoritative once a graph exists; aud.setSinkId() only matters
  // before that (no track played yet, so no graph exists). Try both
  // independently and only report failure if neither worked.
  let ok=false,lastErr=null;
  if(audioCtx&&typeof audioCtx.setSinkId==='function'){
    try{await audioCtx.setSinkId(deviceId||'');ok=true;}catch(e){lastErr=e;}
  }
  if(typeof aud.setSinkId==='function'){
    try{await aud.setSinkId(deviceId||'');ok=true;}catch(e){if(!ok)lastErr=e;}
  }
  if(!silent){
    if(ok)toast('🔊 Audio output changed');
    else if(lastErr)toast('❌ Could not switch output: '+lastErr.message);
  }
}

function playNext(){
  if(!tracks.length)return;
  if(queueNext_.length){const idx=queueNext_.shift();loadTrack(idx);renderQueue();return;}
  const pool=filtered.length?filtered:tracks;const ci=pool.findIndex(t=>tracks.indexOf(t)===currentIdx);
  const next=shuffle?pool[Math.floor(Math.random()*pool.length)]:pool[(ci+1)%pool.length];
  if(next)loadTrack(tracks.indexOf(next));
}
function playPrev(){if(!tracks.length)return;const pool=filtered.length?filtered:tracks;const ci=pool.findIndex(t=>tracks.indexOf(t)===currentIdx);const prev=pool[(ci-1+pool.length)%pool.length];if(prev)loadTrack(tracks.indexOf(prev));}
function toggleShuffle(){shuffle=!shuffle;document.getElementById('shuf-btn').classList.toggle('on',shuffle);toast(shuffle?'🔀 Shuffle on':'Shuffle off');}
function toggleRepeat(){repeat=!repeat;document.getElementById('rep-btn').classList.toggle('on',repeat);toast(repeat?'🔁 Repeat on':'Repeat off');}

// ═══════ VISUALISER + EQ ═══════
function initAudioContext(){
  if(audioCtx)return;
  audioCtx=new (window.AudioContext||window.webkitAudioContext)();
  analyser=audioCtx.createAnalyser();analyser.fftSize=128;
  let node=audioCtx.createMediaElementSource(aud);
  EQ_FREQS.forEach((freq,i)=>{const f=audioCtx.createBiquadFilter();f.type=i===0?'lowshelf':i===EQ_FREQS.length-1?'highshelf':'peaking';f.frequency.value=freq;f.Q.value=1;f.gain.value=eqValues[i];node.connect(f);node=f;eqNodes[i]=f;});
  node.connect(analyser);analyser.connect(audioCtx.destination);
  // audioCtx is created fresh on first play — if the user had already
  // picked a non-default output device in Settings, apply it here too
  // (see setAudioOutput()'s comment for why both need to be set).
  if(settings.audioOutputId&&typeof audioCtx.setSinkId==='function')audioCtx.setSinkId(settings.audioOutputId).catch(()=>{});
}
function setupVis(){
  initAudioContext();if(audioCtx.state==='suspended')audioCtx.resume();
  const npArt=document.getElementById('np-art');npArt.querySelector('.np-ph').style.display='none';
  if(!npArt.contains(npCanvas)){npCanvas.style.cssText='position:absolute;inset:0;width:100%;height:100%';npArt.appendChild(npCanvas);}
  const fpArt=document.getElementById('fp-art-big');const fpPh=fpArt.querySelector('.np-ph');if(fpPh)fpPh.style.display='none';
  if(!fpArt.contains(fpCanvas)){fpCanvas.style.cssText='position:absolute;inset:0;width:100%;height:100%';fpArt.appendChild(fpCanvas);}
  if(visRaf)cancelAnimationFrame(visRaf);drawVis();
}
function drawVis(){
  visRaf=requestAnimationFrame(drawVis);if(!analyser)return;
  const buf=new Uint8Array(analyser.frequencyBinCount);analyser.getByteFrequencyData(buf);
  circleVis(npCtx,27,27,54,54,buf,12,10);circleVis(fpCtx2d,110,110,220,220,buf,50,38);
}
function circleVis(ctx,cx,cy,W,H,buf,r,len){
  ctx.clearRect(0,0,W,H);ctx.fillStyle='#0e0420';ctx.beginPath();ctx.arc(cx,cy,W/2,0,Math.PI*2);ctx.fill();
  for(let i=0;i<buf.length;i++){const a=(i/buf.length)*Math.PI*2-Math.PI/2;const v=buf[i]/255;const r2=r+v*len+1;ctx.strokeStyle=`hsl(${260+i*(80/buf.length)},80%,${55+v*20}%)`;ctx.lineWidth=W>100?3:2;ctx.beginPath();ctx.moveTo(cx+Math.cos(a)*r,cy+Math.sin(a)*r);ctx.lineTo(cx+Math.cos(a)*r2,cy+Math.sin(a)*r2);ctx.stroke();}
  const g=ctx.createRadialGradient(cx,cy,0,cx,cy,r);g.addColorStop(0,'rgba(167,139,250,.3)');g.addColorStop(1,'rgba(8,8,31,0)');ctx.fillStyle=g;ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#0e0420';ctx.beginPath();ctx.arc(cx,cy,r*.65,0,Math.PI*2);ctx.fill();ctx.fillStyle='#a78bfa';ctx.beginPath();ctx.arc(cx,cy,r*.22,0,Math.PI*2);ctx.fill();
}
function buildEQ(){
  const grid=document.getElementById('eq-bands');if(!grid)return;grid.innerHTML='';
  const valRow=document.getElementById('eq-val-row');if(valRow)valRow.innerHTML='';
  EQ_FREQS.forEach((freq,i)=>{
    const label=freq>=1000?(freq/1000)+'k':String(freq);
    const d=document.createElement('div');d.className='eq-band';
    d.innerHTML=`<input type="range" min="-12" max="12" value="0" step="1" id="eq-${i}" oninput="setEQ(${i},this.value)"><span>${label}</span>`;
    grid.appendChild(d);
    if(valRow){const v=document.createElement('div');v.className='eq-v';v.id='eq-val-'+i;v.textContent='0';valRow.appendChild(v);}
  });
}
function setEQ(i,val){const v=parseFloat(val);eqValues[i]=v;if(eqNodes[i])eqNodes[i].gain.value=v;const l=document.getElementById('eq-val-'+i);if(l)l.textContent=(v>0?'+':'')+v;document.querySelectorAll('.eq-tab').forEach(b=>b.classList.remove('active'));}
function resetEQ(){applyEQPreset('Flat');}

// 10 bands, in EQ_FREQS order: 60,170,310,600,1k,3k,6k,12k,14k,16k
const EQ_PRESETS={
  'Flat':         [0,0,0,0,0,0,0,0,0,0],
  'Bass Boost':   [10,8,5,2,0,0,0,0,0,0],
  'Vocal Boost':  [-3,-2,0,3,6,6,3,0,-1,-2],
  'Treble Boost': [0,0,0,-1,-1,0,3,6,8,9],
  'Jazz':         [5,4,2,1,-1,-1,1,3,4,4],
  'Rock':         [6,4,1,-2,-3,0,3,5,6,6],
};
function applyEQPreset(name){
  const preset=EQ_PRESETS[name];if(!preset)return;
  preset.forEach((v,i)=>{
    eqValues[i]=v;
    if(eqNodes[i])eqNodes[i].gain.value=v;
    const inp=document.getElementById('eq-'+i);if(inp)inp.value=v;
    const l=document.getElementById('eq-val-'+i);if(l)l.textContent=(v>0?'+':'')+v;
  });
  document.querySelectorAll('.eq-tab').forEach(b=>b.classList.toggle('active',b.dataset.preset===name));
  toast(`EQ: ${name}`);
}

// ═══════ UP NEXT (mini queue preview in the full player) ═══════
// Mirrors renderQueue()'s "next" pool so the full-player card always
// shows what's coming up without requiring the slide-out queue panel
// to be open.
function renderUpNextMini(){
  const list=document.getElementById('upnext-list');if(!list)return;
  const pool=filtered.length?filtered:tracks;
  const ci=pool.findIndex(t=>tracks.indexOf(t)===currentIdx);
  const all=[...queueNext_.map(i=>tracks[i]).filter(Boolean),...pool.slice(ci<0?0:ci+1,ci<0?6:ci+6)].slice(0,5);
  if(!all.length){list.innerHTML='<div style="padding:16px 4px;text-align:center;font-size:12px;color:var(--text3)">Queue is empty</div>';return;}
  list.innerHTML=all.map(t=>{
    const gi=tracks.indexOf(t);
    const artHtml=t.image?`<img src="${esc(t.image)}" alt="" style="width:34px;height:34px;border-radius:7px;object-fit:cover">`:'<div style="width:34px;height:34px;border-radius:7px;background:var(--glass-fill-2);display:flex;align-items:center;justify-content:center"><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" style="opacity:.4"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>';
    return `<div class="upnext-item" onclick="loadTrack(${gi})" style="display:flex;align-items:center;gap:9px;padding:6px 4px;border-radius:9px;cursor:pointer">
      ${artHtml}
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:600;color:var(--text1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.name||'')}</div>
        <div style="font-size:10.5px;color:var(--text3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.artist||t.source||'')}</div>
      </div>
      <div style="font-size:10px;color:var(--text3);font-family:var(--mono)">${t.duration?fmt(t.duration):'—'}</div>
    </div>`;
  }).join('');
}

// ═══════ PANELS ═══════
function openFullPlayer(){document.getElementById('fp').classList.add('show');}
function closeFullPlayer(){document.getElementById('fp').classList.remove('show');}
function openSettings(){
  document.getElementById('settings-panel').classList.add('show');
  GB.storeGet('driveApiKey').then(k=>{const el=document.getElementById('sp-drive-apikey');if(el&&k)el.value=k;});
  GB.storeGet('googleClientId').then(k=>{const el=document.getElementById('sp-gcid');if(el&&k)el.value=k;});
  GB.storeGet('ytApiKey').then(k=>{const el=document.getElementById('sp-yt-apikey');if(el&&k)el.value=k;});
  GB.storeGet('spotifyClientId').then(k=>{const el=document.getElementById('sp-spotify-clientid');if(el&&k)el.value=k;});
  GB.storeGet('spotifyClientSecret').then(k=>{const el=document.getElementById('sp-spotify-clientsecret');if(el&&k)el.value=k;});
  // Auto-check yt-dlp status
  checkYtdlp();
  loadAudioOutputDevices();
}
function closeSettings(){document.getElementById('settings-panel').classList.remove('show');}
function toggleSetting(k){settings[k]=!settings[k];document.getElementById('tog-'+k)?.classList.toggle('on',settings[k]);GB.storeSet('settings',settings);}
function saveDriveApiKey(){const el=document.getElementById('sp-drive-apikey');const k=(el?.value||'').trim();if(!k){toast('Enter an API key first');return;}GB.storeSet('driveApiKey',k);toast('✅ API key saved');}

// ═══════ FEEDBACK ═══════
function openFeedback(){fbType='Bug Report';document.getElementById('fb-modal').classList.add('show');document.querySelectorAll('.fb-type').forEach(b=>b.classList.remove('active'));document.getElementById('fb-bug').classList.add('active');}
function closeFeedback(){document.getElementById('fb-modal').classList.remove('show');}
function setFbType(t){fbType=t;document.querySelectorAll('.fb-type').forEach(b=>b.classList.remove('active'));event.target.classList.add('active');}
async function sendFeedback(){const msg=document.getElementById('fb-msg').value.trim();if(!msg){toast('Write a message first');return;}await GB.openFeedback({type:fbType,message:msg});closeFeedback();document.getElementById('fb-msg').value='';toast('✉ Mail app opened — thanks!');}

// ═══════ KEYBOARD ═══════
function bindKeys(){
  document.addEventListener('keydown',e=>{
    const tag=e.target.tagName;if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT')return;
    if(e.code==='Space'){e.preventDefault();togglePlay();}
    else if(e.code==='ArrowRight'){e.preventDefault();playNext();}
    else if(e.code==='ArrowLeft'){e.preventDefault();playPrev();}
    else if(e.code==='ArrowUp'){e.preventDefault();const v=Math.min(1,(aud.volume||0)+.05);setVol(v);document.getElementById('vol').value=v;}
    else if(e.code==='ArrowDown'){e.preventDefault();const v=Math.max(0,(aud.volume||0)-.05);setVol(v);document.getElementById('vol').value=v;}
    else if(e.code==='KeyS')toggleShuffle();
    else if(e.code==='KeyR')toggleRepeat();
    else if(e.code==='KeyL')likeCurrentTrack();
    else if(e.code==='KeyF')openFullPlayer();
    else if(e.code==='KeyM')openMiniPlayer();
    else if((e.ctrlKey||e.metaKey)&&e.code==='KeyO'){e.preventDefault();toggleOnlineMode();}
    else if(e.code==='Escape'){closeFullPlayer();closeSettings();closeDriveModal();closeFeedback();closeCtxMenu();}
  });
  document.querySelectorAll('.overlay').forEach(ov=>ov.addEventListener('click',e=>{if(e.target===ov)ov.classList.remove('show');}));
}

// ── YouTube Settings helpers ─────────────────────────────────────
async function saveYtApiKey(){
  const el=document.getElementById('sp-yt-apikey');
  const k=(el?.value||'').trim();
  if(!k){toast('Enter an API key first');return;}
  await GB.storeSet('ytApiKey',k);
  toast('✅ YouTube API key saved');
}

// ── Spotify Settings helpers ──────────────────────────────────────
async function saveSpotifyCreds(){
  const idEl=document.getElementById('sp-spotify-clientid');
  const secEl=document.getElementById('sp-spotify-clientsecret');
  const clientId=(idEl?.value||'').trim(), clientSecret=(secEl?.value||'').trim();
  if(!clientId||!clientSecret){toast('Enter both Client ID and Client Secret');return;}
  await GB.storeSet('spotifyClientId',clientId);
  await GB.storeSet('spotifyClientSecret',clientSecret);
  toast('✅ Spotify credentials saved');
}

async function downloadYtdlpNow(){
  const btn=document.getElementById('ytdlp-dl-btn');
  const status=document.getElementById('ytdlp-status');
  if(btn){btn.disabled=true;btn.textContent='Downloading… (~12 MB)';}
  if(status){status.textContent='Downloading yt-dlp from GitHub…';status.style.color='var(--text2)';}
  const res=await GB.downloadYtdlp();
  if(btn){btn.disabled=false;btn.textContent='⬇ Install Automatically';}
  if(res.success){
    if(status){status.textContent='✅ Installed to '+res.path;status.style.color='var(--green)';}
    toast('✅ YouTube audio engine installed — you can now play full songs');
  } else {
    if(status){status.textContent='❌ Download failed: '+res.error;status.style.color='var(--red)';}
    toast('❌ Download failed — check your internet connection');
  }
}

async function checkYtdlp(){
  const status=document.getElementById('ytdlp-status');
  if(status)status.textContent='Checking…';
  const res=await GB.ytCheck();
  if(status){
    if(res.installed){status.textContent=`✅ yt-dlp ${res.version||''} installed at ${res.path}`;status.style.color='var(--green)';}
    else{status.textContent='❌ yt-dlp not found. Install from https://github.com/yt-dlp/yt-dlp';status.style.color='var(--red)';}
  }
}
