const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, globalShortcut, screen, shell, session } = require('electron');
const path  = require('path');
const fs    = require('fs');
const https = require('https');
const http  = require('http');

// ── Fetch via main process (no CORS, uses Node.js http/https) ────

const LOG_FILE = path.join(require('os').tmpdir(), 'outspace-debug.log');
function dbg(...a) {
  try { fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${a.map(x => typeof x === 'object' ? JSON.stringify(x) : String(x)).join(' ')}\n`); } catch {}
}

const keepAliveAgent = new https.Agent({ keepAlive: true, maxSockets: 4, family: 4 });

// Retry wrapper — archive.org occasionally stalls; one retry clears most errors.
async function mainFetch(url, retries = 1) {
  try {
    return await mainFetchOnce(url);
  } catch (e) {
    if (retries > 0) { dbg('retry', url.slice(0, 60), e && e.message); return mainFetch(url, retries - 1); }
    throw e;
  }
}

function mainFetchOnce(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const opts = {
      timeout: 12000,
      family: 4, // force IPv4 — avoids IPv6 happy-eyeballs stall on Windows
      agent: url.startsWith('https') ? keepAliveAgent : undefined,
      maxHeaderSize: 1024 * 1024,   // ccMixter sends oversized headers → "Header overflow"
      insecureHTTPParser: true,     // tolerate slightly non-conformant responses
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Outspace/1.0',
        'Accept': 'application/json, */*',
      },
    };
    const req = lib.get(url, opts, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return mainFetch(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          json: () => Promise.resolve(JSON.parse(body)),
          text: () => Promise.resolve(body),
        });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

const TALK_RE = /\b(talk|talks|talking|podcast|podcasts|interview|interviews|speech|lecture|lectures|spoken[\s-]?word|sermon|audiobook|audio[\s-]?book|story|stories|radio[\s-]?show|radio[\s-]?talk|news|debate|smart\s*talk|conversation)\b/i;
const BAD_COLLECTIONS = new Set(['smarttalk','podcasts','radioprograms','oldtimeradio','audio_bookspoetry','audio_religion','audio_news','audio_podcast','spokenword','librivoxaudio','audio_tech']);

function pickText(v, fb = '') { if (Array.isArray(v)) return String(v[0] || fb); if (typeof v === 'string') return v; return fb; }
function arrText(v) { if (Array.isArray(v)) return v.map(String); if (typeof v === 'string') return [v]; return []; }
function shuffle(a) { const r = a.slice(); for (let i = r.length-1; i > 0; i--) { const j = Math.floor(Math.random()*(i+1)); [r[i],r[j]]=[r[j],r[i]]; } return r; }
function archiveTag(t) { return String(t||'').toLowerCase().replace(/^dnb$/,'drum and bass').replace(/^hiphop$/,'hip hop'); }

async function fetchArchiveMain(tags, source = 'archive', limit = 10) {
  const qTags = tags.map(archiveTag).filter(Boolean).slice(0, 4);
  if (!qTags.length) return [];
  const tagQ = qTags.map(t => `(subject:"${t}" OR title:"${t}")`).join(' OR ');
  const colFilter = source === 'netlabels' ? 'collection:netlabels' : 'mediatype:audio';
  const exclude = Array.from(BAD_COLLECTIONS).map(c => `-collection:${c}`).join(' ');
  // "russian" source: constrain to Russian-language / Russian-tagged audio.
  const russian = source === 'russian'
    ? ' AND (subject:"russian" OR subject:"russia" OR subject:"русская" OR subject:"русский" OR language:"rus" OR language:"Russian")'
    : '';
  const params = new URLSearchParams({ q: `${colFilter} AND (${tagQ})${russian} ${exclude}`, output: 'json', rows: '24', sort: 'random desc' });
  ['identifier','title','creator','subject','collection','description'].forEach(f => params.append('fl[]', f));

  try {
    const res = await mainFetch(`https://archive.org/advancedsearch.php?${params}`);
    dbg('archive search ok=', res.ok);
    if (!res.ok) return [];
    const json = await res.json();
    dbg('archive raw docs=', (json.response?.docs ?? []).length);
    const docs = (json.response?.docs ?? []).filter(d => {
      const colls = arrText(d.collection).map(c => c.toLowerCase());
      if (colls.some(c => BAD_COLLECTIONS.has(c))) return false;
      if (TALK_RE.test(pickText(d.title)) || TALK_RE.test(pickText(d.creator))) return false;
      return true;
    });

    const out = [];
    const want = Math.min(limit, 5);
    // Fetch metadata in small concurrent batches with early exit, to avoid
    // saturating archive.org (too many parallel requests → timeouts).
    const shuffledDocs = shuffle(docs);
    for (let i = 0; i < shuffledDocs.length && out.length < want; i += 3) {
      await Promise.allSettled(shuffledDocs.slice(i, i + 3).map(async d => {
        if (out.length >= want) return;
        const id = String(d.identifier || '');
        if (!id) return;
        const r = await mainFetch(`https://archive.org/metadata/${encodeURIComponent(id)}/files`);
        if (!r.ok) return;
        const j = await r.json();
        const files = j.result || [];
        const mp3 = files.find(f => /vbr mp3/i.test(f.format||'')) || files.find(f => /mp3/i.test(f.format||'')) || files.find(f => /\.mp3$/i.test(f.name||''));
        if (!mp3?.name) return;
        const name = mp3.title || pickText(d.title, id);
        if (TALK_RE.test(name)) return;
        const audio = `https://archive.org/download/${encodeURIComponent(id)}/${encodeURI(mp3.name)}`;
        if (out.some(t => t.audio === audio)) return;
        out.push({ id: `ia:${id}:${mp3.name}`, name, artist: pickText(d.creator, source === 'netlabels' ? 'Netlabels' : 'Internet Archive'), audio, image: '', duration: Number(mp3.length||0)||0, source });
      }));
    }
    dbg('archive filtered docs=', docs.length, 'tracks out=', out.length);
    return shuffle(out).slice(0, limit);
  } catch (e) { dbg('archive ERROR', e && e.message); return []; }
}

async function fetchMixcloudMain(tags, limit = 12) {
  const out = []; const seen = new Set();
  for (const t of tags.slice(0, 3)) {
    try {
      const params = new URLSearchParams({ q: archiveTag(t), type: 'cloudcast', limit: '20' });
      const res = await mainFetch(`https://api.mixcloud.com/search/?${params}`);
      if (!res.ok) continue;
      const json = await res.json();
      for (const c of (json.data || [])) {
        if (!c.key || !c.name || seen.has(c.key)) continue;
        const artist = c.user?.name || c.user?.username || 'Mixcloud';
        if (TALK_RE.test(c.name) || TALK_RE.test(artist)) continue;
        seen.add(c.key);
        out.push({ id: `mx:${c.key}`, name: c.name, artist, audio: '', image: c.pictures?.['640wx640h']||c.pictures?.large||'', duration: c.audio_length||0, source: 'mixcloud', mixcloudKey: c.key });
        if (out.length >= limit) return shuffle(out);
      }
    } catch {}
  }
  return shuffle(out);
}

// ccMixter — free Creative Commons music. Its TLS cert is expired, so we query
// over HTTP and serve mp3s over HTTP too (cert-error handler covers any https).
async function fetchCCMixterMain(tags, limit = 10) {
  const out = []; const seen = new Set();
  for (const t of tags.slice(0, 3)) {
    if (out.length >= limit) break;
    try {
      const params = new URLSearchParams({ f: 'json', tags: archiveTag(t), limit: '25', sort: 'rand', ord: 'desc' });
      const res = await mainFetch(`http://ccmixter.org/api/query?${params}`);
      dbg('ccmixter ok=', res.ok, 'tag=', t);
      if (!res.ok) continue;
      const json = await res.json();
      const items = Array.isArray(json) ? json : [];
      for (const u of items) {
        const files = u.files || [];
        const mp3 = files.find(f => /\.mp3($|\?)/i.test(f.download_url || '') || /mp3/i.test(f.file_format_info?.['dataview-mime'] || ''))
                 || files.find(f => /\.mp3$/i.test(f.file_name || ''));
        if (!mp3?.download_url) continue;
        // Keep https — ccMixter serves mp3 only over https + with a Referer header
        // (injected in onBeforeSendHeaders); its expired cert is accepted via certificate-error.
        const audio = String(mp3.download_url).replace(/^http:/, 'https:');
        if (seen.has(audio)) continue;
        const name = u.upload_name || mp3.file_name || 'ccMixter';
        const artist = u.user_name || 'ccMixter';
        if (TALK_RE.test(name) || TALK_RE.test(artist)) continue;
        seen.add(audio);
        out.push({ id: `cc:${u.upload_id || audio}`, name, artist, audio, image: '', duration: 0, source: 'ccmixter' });
        if (out.length >= limit) return shuffle(out);
      }
    } catch (e) { dbg('ccmixter ERROR', e && e.message); }
  }
  dbg('ccmixter tracks out=', out.length);
  return shuffle(out);
}

const isDev      = !app.isPackaged;
const LOCAL_HTML = path.join(__dirname, '..', 'dist', 'index.html');
const TRAY_ICON  = path.join(__dirname, 'tray-icon.png');
const STATE_FILE = path.join(app.getPath('userData'), 'op-window.json');
const STATE_VER  = 1;

const MIN_W = 420, MIN_H = 360;
const MAX_W = 2200, MAX_H = 1400;
const DEF_W = 1280, DEF_H = 700;

let mainWindow = null;
let tray = null;
let dragInterval = null, dragOffset = null, dragSize = null;
let resizeInterval = null, resizeOrigin = null;
let saveTimer = null;
let isRightDragging = false, isManualResizing = false;
let alwaysOnTop = false;

// ── Window state ──────────────────────────────────────────────────

function clamp(bounds) {
  const width  = Math.max(MIN_W, Math.min(MAX_W, Math.round(Number(bounds.width)  || DEF_W)));
  const height = Math.max(MIN_H, Math.min(MAX_H, Math.round(Number(bounds.height) || DEF_H)));
  return { x: Number.isFinite(bounds.x) ? Math.round(bounds.x) : undefined,
           y: Number.isFinite(bounds.y) ? Math.round(bounds.y) : undefined,
           width, height };
}

function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    if (s.v !== STATE_VER) return null;
    return clamp(s);
  } catch { return null; }
}

function saveState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (isRightDragging || isManualResizing) return;
  try {
    const b = mainWindow.getBounds();
    fs.writeFileSync(STATE_FILE, JSON.stringify({ v: STATE_VER, ...clamp(b) }));
  } catch {}
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; saveState(); }, 250);
}

// ── Window creation ───────────────────────────────────────────────

function createWindow() {
  const saved = loadState();
  let bounds = { width: DEF_W, height: DEF_H, x: undefined, y: undefined };
  if (saved) {
    const onScreen = screen.getAllDisplays().some((d) => {
      const b = d.bounds;
      return saved.x + 50 < b.x + b.width  && saved.x + saved.width  - 50 > b.x &&
             saved.y + 10 < b.y + b.height && saved.y + saved.height - 10 > b.y;
    });
    if (onScreen) bounds = saved;
  }

  mainWindow = new BrowserWindow({
    ...bounds,
    center: !saved,
    minWidth: MIN_W, minHeight: MIN_H,
    maxWidth: MAX_W, maxHeight: MAX_H,
    resizable: false, maximizable: false, fullscreenable: false,
    frame: false, transparent: true, hasShadow: false,
    backgroundColor: '#00000000',
    title: 'Outspace',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  mainWindow.once('ready-to-show', () => {
    // Force onto primary display if somehow off-screen
    const primary = screen.getPrimaryDisplay().workArea;
    const [w, h] = mainWindow.getSize();
    const [cx, cy] = [
      Math.round(primary.x + (primary.width  - w) / 2),
      Math.round(primary.y + (primary.height - h) / 2),
    ];
    mainWindow.setPosition(cx, cy);
    mainWindow.show();
    mainWindow.focus();
    mainWindow.moveTop();
  });

  if (!isDev && fs.existsSync(LOCAL_HTML)) {
    mainWindow.loadFile(LOCAL_HTML);
  } else {
    // dev: expect Vite on 5173
    mainWindow.loadURL('http://localhost:5173');
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });

  mainWindow.on('resize', scheduleSave);
  mainWindow.on('move',   scheduleSave);
  mainWindow.on('close',  () => { if (saveTimer) clearTimeout(saveTimer); saveState(); void clearCache(); });
  mainWindow.on('closed', () => { mainWindow = null; stopDrag(); stopResize(); });
}

// ── Tray ──────────────────────────────────────────────────────────

function createTray() {
  let icon = nativeImage.createFromPath(TRAY_ICON);
  if (icon.isEmpty()) icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('Outspace');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show', click: () => mainWindow?.show() },
    { label: 'Hide', click: () => mainWindow?.hide() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
  tray.on('click', () => {
    if (!mainWindow) return;
    mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
  });
}

// ── Cache ─────────────────────────────────────────────────────────

async function clearCache() {
  try {
    const ses = session.defaultSession;
    await Promise.allSettled([
      ses.clearCache(),
      ses.clearStorageData({ storages: ['cachestorage','shadercache','serviceworkers'] }),
    ]);
  } catch {}
}

// ── App lifecycle ─────────────────────────────────────────────────

// ccMixter's TLS certificate is expired — accept it only for that host so its
// https mp3s still play. All other hosts keep normal certificate validation.
app.on('certificate-error', (event, _wc, url, _err, _cert, callback) => {
  if (/(^|\.)ccmixter\.org/.test(new URL(url).hostname)) {
    event.preventDefault();
    callback(true);
  } else {
    callback(false);
  }
});

app.whenReady().then(() => {
  // Patch Origin header so archive.org / mixcloud CORS passes from file://
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const h = details.requestHeaders;
    if (!h['Origin'] && details.url.startsWith('http')) {
      h['Origin'] = 'https://outspace-player.app';
    }
    // ccMixter serves audio only when a Referer from its own domain is present.
    if (/ccmixter\.org/.test(details.url)) {
      h['Referer'] = 'https://ccmixter.org/';
    }
    callback({ requestHeaders: h });
  });

  createWindow();
  createTray();
  globalShortcut.register('Alt+Q', () => mainWindow?.hide());

  // Warm up DNS/TLS to archive.org so the first real fetch isn't slow (~12s cold).
  mainFetch('https://archive.org/advancedsearch.php?q=mediatype:audio&rows=1&output=json')
    .then(() => dbg('warmup ok'))
    .catch((e) => dbg('warmup failed', e && e.message));
});

app.on('will-quit', () => {
  if (saveTimer) clearTimeout(saveTimer);
  saveState();
  void clearCache();
  globalShortcut.unregisterAll();
  stopDrag(); stopResize();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });

// ── Always on top ─────────────────────────────────────────────────

ipcMain.on('win:toggleAlwaysOnTop', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  alwaysOnTop = !alwaysOnTop;
  try { mainWindow.setAlwaysOnTop(alwaysOnTop, alwaysOnTop ? 'screen-saver' : 'normal'); } catch {
    try { mainWindow.setAlwaysOnTop(alwaysOnTop); } catch {}
  }
  try { mainWindow.webContents.send('win:alwaysOnTopChanged', alwaysOnTop); } catch {}
});

// ── Window controls ───────────────────────────────────────────────

ipcMain.handle('music:fetch', async (_e, source, tags, limit = 10) => {
  dbg('music:fetch CALLED', 'source=', source, 'tags=', tags, 'limit=', limit);
  try {
    const r = source === 'mixcloud' ? await fetchMixcloudMain(tags, limit)
            : source === 'ccmixter' ? await fetchCCMixterMain(tags, limit)
            : await fetchArchiveMain(tags, source, limit);
    dbg('music:fetch RESULT count=', Array.isArray(r) ? r.length : 'not-array', Array.isArray(r) && r[0] ? r[0].audio : '');
    return r;
  } catch (e) { dbg('music:fetch ERROR', e && e.message, e && e.stack); return []; }
});

ipcMain.on('win:minimize',    () => mainWindow?.minimize());
ipcMain.on('win:hideToTray',  () => mainWindow?.hide());
ipcMain.on('win:close',       () => app.quit());

// ── Drag (right-click move) ───────────────────────────────────────

function stopDrag() {
  if (dragInterval) { clearInterval(dragInterval); dragInterval = null; }
  dragOffset = null; dragSize = null;
}

ipcMain.on('win:dragStart', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  stopResize();
  if (dragInterval) return;
  isRightDragging = true;
  const b = mainWindow.getBounds();
  dragSize = { width: b.width, height: b.height };
  try { mainWindow.setResizable(false); } catch {}
  const c = screen.getCursorScreenPoint();
  dragOffset = { x: c.x - b.x, y: c.y - b.y };
  dragInterval = setInterval(() => {
    if (!mainWindow || !dragOffset || !dragSize) return stopDrag();
    const cur = screen.getCursorScreenPoint();
    try {
      mainWindow.setBounds({ x: Math.round(cur.x - dragOffset.x), y: Math.round(cur.y - dragOffset.y), ...dragSize }, false);
    } catch {}
  }, 16);
});

ipcMain.on('win:dragEnd', () => {
  stopDrag();
  isRightDragging = false;
  try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setResizable(false); } catch {}
  saveState();
});

// ── Resize (left-click edge zones) ───────────────────────────────

function stopResize() {
  isManualResizing = false;
  if (resizeInterval) { clearInterval(resizeInterval); resizeInterval = null; }
  resizeOrigin = null;
  try { mainWindow?.setResizable(false); } catch {}
}

function computeBounds(origin, cur) {
  const e = String(origin.edge || 'se');
  const right = origin.x + origin.w, bottom = origin.y + origin.h;
  let x = origin.x, y = origin.y, w = origin.w, h = origin.h;
  if (e.includes('e')) w = origin.w + (cur.x - origin.cx);
  if (e.includes('s')) h = origin.h + (cur.y - origin.cy);
  if (e.includes('w')) { w = origin.w - (cur.x - origin.cx); w = Math.max(MIN_W, Math.min(MAX_W, Math.round(w))); x = right - w; }
  if (e.includes('n')) { h = origin.h - (cur.y - origin.cy); h = Math.max(MIN_H, Math.min(MAX_H, Math.round(h))); y = bottom - h; }
  if (!e.includes('w')) w = Math.max(MIN_W, Math.min(MAX_W, Math.round(w)));
  if (!e.includes('n')) h = Math.max(MIN_H, Math.min(MAX_H, Math.round(h)));
  return { x: Math.round(x), y: Math.round(y), width: w, height: h };
}

ipcMain.on('win:resizeStart', (_e, edge = 'se') => {
  if (!mainWindow) return;
  stopDrag();
  try { mainWindow.setResizable(true); } catch {}
  if (resizeInterval) return;
  isManualResizing = true;
  const [x, y] = mainWindow.getPosition();
  const [w, h] = mainWindow.getSize();
  const c = screen.getCursorScreenPoint();
  resizeOrigin = { x, y, w, h, cx: c.x, cy: c.y, edge };
  resizeInterval = setInterval(() => {
    if (!mainWindow || !resizeOrigin) return stopResize();
    mainWindow.setBounds(computeBounds(resizeOrigin, screen.getCursorScreenPoint()));
  }, 16);
});

ipcMain.on('win:resizeEnd', () => { stopResize(); saveState(); });
