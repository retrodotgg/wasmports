// Bridge between the engine and the user's own converted game data.
//
// The data is served by the same server that serves this page
// (scripts/serve-web.js), so a file is fetched the moment the engine asks for
// it and nothing is copied. Copying a 1.4 GB install into browser storage is
// what used to fail with a quota error, and the bytes are already on disk next
// door.
//
// Browser storage therefore holds only the engine's own small writes (settings,
// captures), which are read back in preference to the server's copy.
//
// Renamed from the previous design's key, where the value was a second server
// on another port; that value would now point at nothing.
import { openPack } from './pack.js?v=b3e0ad12bba2';
export { transfer } from './pack.js?v=b3e0ad12bba2';

const ORIGIN_KEY = 'skate3-source-origin';
// --- Mobile mode ---------------------------------------------------------------
//
// Phone and tablet browsers (WebKit above all) close a page that uses too much
// memory. Mobile mode keeps the whole game (mechanics, every map, Skate 3's
// screens) and spends less: the engine runs Lite graphics and asks before the
// big cities, and the page fetches nothing ahead of time and does not keep a
// second copy of a big map to save it. On by default on phones and tablets;
// the choice is kept (the key predates the name: it was "Lite mode").
export const SMALL_DEVICE = /iPhone|iPad|iPod|Android|Mobile/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const MOBILE_KEY = 'skate3-lite';
export function mobileMode() {
  let chosen = null;
  try { chosen = localStorage.getItem(MOBILE_KEY); } catch {}
  return chosen ? chosen === 'on' : SMALL_DEVICE;
}
export function setMobileMode(on) {
  try { localStorage.setItem(MOBILE_KEY, on ? 'on' : 'off'); } catch {}
}
// Bigger files than this are not saved in mobile mode: saving holds a second
// copy of the map while it is written.
const MOBILE_SAVE_LIMIT = 48 << 20;

// A game data zip chosen in this browser (ONLINE > Game Server): read directly.
const PACK_KEY = 'skate3-pack-url';
const isZip = (value) => /\.zip(\?.*)?$/i.test(value);
const LOCAL_DIR = 'skate3-local';
// Everything under assets/ and settings/ is read synchronously by the engine,
// so the host mounts it up front from here; maps are fetched on demand instead.
// The shared custom-character library's catalog (manifest and preview per
// model) mounts too; the models themselves download when someone wears one.
const MOUNTED = /^(assets|settings)\/|^userdata\/custom-characters\/entries\/[0-9a-f]{64}\/(manifest\.json|preview\.png)$/;
// Matches serve-web.js: customiser models and textures load on demand.
// Game audio (.ogg) streams in the same way: only its sound table mounts.
// So do the Object Dropper's props: the catalog mounts, each prop is fetched
// the first time someone places one.
const LAZY = /^assets\/private\/(customisation\/(?!.*\.json$)|audio\/.*\.ogg$|dropper\/(objects|textures)\/)/;
// Converted files the engine never reads: the customiser's 33 MB catalog
// (setup's work list), and the movable-prop and backdrop packages (inputs for
// features the engine does not load yet). Matches serve-web.js.
// Also the stock data no part of the engine opens (measured with ?trace-reads
// over full sessions, and nothing in the code names them): the PS3 ragdoll
// banks (ropa2, 86 MB), the original .rx2 models (content, 30 MB), the
// editor and pedestrian animation banks (only OnBoard/OffBoard are read),
// recipes, stream lists, the minimap and the default skater's textures:
// about 150 MB every player downloaded and held in memory for nothing.
const UNUSED = /^assets\/private\/(customisation\/sets\/[^/]+\/catalog\.json|native-props\/|native-backdrops\/|default_skater\/|stock\/data\/(ropa2|content|cacrecipes|stream)\/|stock\/data\/maps\/minimap\.|stock\/data\/anim\/(?!(OnBoard|OffBoard)\.abin$))/;
const mountedPath = (path) => MOUNTED.test(path) && !LAZY.test(path) && !UNUSED.test(path);
// Only the starting map's sky is mounted (the others are 2 MB each); the
// engine fetches another world's sky with its map when it travels there. A
// front-end boot starts with no world and so mounts none.
const otherSky = (path, map, frontEnd = false) => {
  const sky = /^assets\/private\/native-skies\/([^/.]+)\./.exec(path);
  if (sky && frontEnd) return true;
  const stem = (map || '').replace(/^.*\//, '').replace(/\.skate$/i, '');
  return Boolean(sky && stem && sky[1].toLowerCase() !== stem.toLowerCase());
};
const MAP_FILE = /^maps\/(private\/)?[^/]+\.(skate|irradiance)$/i;
const NEAREST = ['NotFoundError', 'TypeMismatchError'];

// --- Where the data comes from ----------------------------------------------

export function origin() {
  let saved = (localStorage.getItem(ORIGIN_KEY) || '').trim();
  // A zip saved as the server by an earlier client is a pack, not a server.
  if (isZip(saved)) {
    localStorage.setItem(PACK_KEY, saved);
    localStorage.removeItem(ORIGIN_KEY);
    saved = '';
  }
  return (saved || location.origin).replace(/\/+$/, '');
}

export function setOrigin(value) {
  const clean = (value || '').trim().replace(/\/+$/, '');
  packState = null;
  cached = null;
  // A .zip address is game data to read directly; the page keeps using this
  // server for itself, custom characters and multiplayer.
  if (isZip(clean)) {
    localStorage.setItem(PACK_KEY, clean);
    localStorage.removeItem(ORIGIN_KEY);
    return;
  }
  localStorage.removeItem(PACK_KEY);
  if (!clean || clean === location.origin) localStorage.removeItem(ORIGIN_KEY);
  else localStorage.setItem(ORIGIN_KEY, clean);
}

let cached = null;

// --- Game data from a published zip (pack) -------------------------------------
//
// A server started with --client-pack=<url> tells the page, in /config.json,
// that the game data is a zip on another host (e.g. Cloudflare R2). The page
// then reads files straight out of that zip (web/pack.js) and the server only
// serves the page, custom characters and multiplayer. `?pack=<url>` overrides.

let packState = null;

// --- Saved downloads ---------------------------------------------------------
//
// Maps and the startup data are kept in the browser's Cache Storage after the
// first download, so the next visit loads from disk instead of the network.
// Cache Storage works where the file-system API is hidden (Brave). Entries are
// keyed by where the data came from and its version: a replaced pack or a
// changed file on the server is downloaded again, never mixed with old data.
const DOWNLOADS = 'skate3-downloads-v1';
const DOWNLOAD_KEY = `${location.origin}/__skate3-downloads/`;
// Cache Storage exists only on HTTPS pages; a server reached over plain HTTP
// keeps its downloads in IndexedDB instead (the same calls, see idbCache).
const cacheApi = () => typeof caches !== 'undefined' && window.isSecureContext;
const hasDownloads = () => cacheApi() || typeof indexedDB !== 'undefined';
let persistAsked = false;

async function downloads() {
  if (!hasDownloads()) return null;
  try {
    return cacheApi() ? await caches.open(DOWNLOADS) : await idbCache();
  } catch {
    return null;
  }
}

// The few Cache calls used here (match, put, keys, delete) over IndexedDB,
// which stores the bytes as Blobs on disk.
const IDB_DOWNLOADS = 'skate3-downloads';
let idbOpen = null;
function idbCache() {
  idbOpen ||= new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_DOWNLOADS, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('files');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const run = (db, mode, action) => new Promise((resolve, reject) => {
    const transaction = db.transaction('files', mode);
    const request = action(transaction.objectStore('files'));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = transaction.onabort = () => reject(transaction.error);
  });
  return idbOpen.then((db) => ({
    async match(key) {
      const found = await run(db, 'readonly', (files) => files.get(typeof key === 'string' ? key : key.url));
      if (!found) return undefined;
      return { headers: new Headers(found.headers), arrayBuffer: () => found.blob.arrayBuffer() };
    },
    async put(key, response) {
      const blob = await response.blob();
      const headers = Object.fromEntries(response.headers.entries());
      await run(db, 'readwrite', (files) => files.put({ blob, headers }, key));
    },
    async keys() {
      return (await run(db, 'readonly', (files) => files.getAllKeys())).map((url) => ({ url }));
    },
    async delete(key) {
      await run(db, 'readwrite', (files) => files.delete(typeof key === 'string' ? key : key.url));
      return true;
    },
  }));
}

async function savedDownload(key) {
  const cache = await downloads();
  const hit = cache && await cache.match(DOWNLOAD_KEY + key).catch(() => null);
  return hit ? new Uint8Array(await hit.arrayBuffer()) : null;
}

async function saveDownload(key, bytes, headers = {}) {
  if (mobileMode() && bytes.length > MOBILE_SAVE_LIMIT) return;
  const cache = await downloads();
  if (!cache) return;
  // Ask once to keep saved maps when the browser runs short of space.
  if (!persistAsked && navigator.storage && navigator.storage.persist) {
    persistAsked = true;
    navigator.storage.persist().catch(() => {});
  }
  try {
    await cache.put(DOWNLOAD_KEY + key, new Response(bytes, { headers: { 'Content-Length': String(bytes.length), ...headers } }));
  } catch (error) {
    // Out of space: play on, it just downloads again next time.
    console.warn('could not save download', key, error && error.name);
  }
}

// Saved ranges of one pack version; older versions of the same pack go.
function packStore(url, version) {
  const prefix = `pack/${encodeURIComponent(url)}/`;
  (async () => {
    const cache = await downloads();
    if (!cache) return;
    for (const request of await cache.keys()) {
      const key = request.url.slice(DOWNLOAD_KEY.length);
      if (key.startsWith(prefix) && !key.startsWith(`${prefix}${version}/`)) await cache.delete(request);
    }
  })().catch(() => {});
  return {
    get: (key) => savedDownload(`${prefix}${version}/${key}`),
    put: (key, bytes) => saveDownload(`${prefix}${version}/${key}`, bytes),
    has: async (key) => {
      const cache = await downloads();
      return Boolean(cache && await cache.match(DOWNLOAD_KEY + `${prefix}${version}/${key}`).catch(() => null));
    },
  };
}

/// Bytes of game data saved in this browser.
export async function downloadsSize() {
  const cache = await downloads();
  if (!cache) return 0;
  let total = 0;
  for (const request of await cache.keys()) {
    const hit = await cache.match(request);
    total += Number(hit && hit.headers.get('Content-Length')) || 0;
  }
  return total;
}

export async function clearDownloads() {
  if (cacheApi()) await caches.delete(DOWNLOADS).catch(() => {});
  if (typeof indexedDB !== 'undefined') {
    idbOpen = null;
    indexedDB.deleteDatabase(IDB_DOWNLOADS);
  }
}

// --- Background downloads ---------------------------------------------------
//
// Worlds are fetched before they are asked for: the one picked on the main
// menu straight away, the rest one at a time while the player skates. Each is
// only read so that it lands in the saved downloads; the bytes are dropped.
// A load that asks for a world still on its way waits for that download.
const prefetching = new Map();
const prefetchQueue = [];
let prefetchRunning = false;

// Downloads in progress by path, for the loading screens: bytes so far, the
// whole, and when the last bytes came in.
const transfers = new Map();

function track(path, pack) {
  const entry = { done: 0, total: pack.spanBytes ? pack.spanBytes(path) : 0, lastAt: performance.now() };
  transfers.set(path, entry);
  return (bytes) => {
    entry.done = Math.max(0, entry.done + bytes);
    entry.lastAt = performance.now();
    if (entry.total && entry.done >= entry.total) transfers.delete(path);
  };
}

/// [bytes so far, total bytes, ms since bytes last arrived] for a file still
/// downloading, or null.
export function downloadStatus(path) {
  const entry = transfers.get(path);
  if (!entry) return null;
  return [entry.done, entry.total, Math.round(performance.now() - entry.lastAt)];
}

export function prefetch(path, background = false) {
  // A world downloading ahead of time sits whole in page memory.
  if (!hasDownloads() || prefetching.has(path) || mobileMode()) return;
  const queued = prefetchQueue.indexOf(path);
  if (queued >= 0) {
    // Asked for again in front: move it up; in the background: leave it.
    if (background) return;
    prefetchQueue.splice(queued, 1);
  }
  if (background) prefetchQueue.push(path);
  else prefetchQueue.unshift(path);
  if (!prefetchRunning) runPrefetch();
}

// The world download running ahead of time, which a world the player actually
// asked for cancels: a 400 MB city fetched because the menu passed over it
// must never hold up the map someone is waiting on.
let ahead = null;
// World reads the player is waiting on; nothing runs ahead meanwhile.
let waitingOn = 0;

async function runPrefetch() {
  prefetchRunning = true;
  while (prefetchQueue.length && !waitingOn) {
    const path = prefetchQueue.shift();
    const controller = new AbortController();
    const job = (async () => {
      const pack = await gamePack().catch(() => null);
      if (pack && pack.has(path)) {
        if (!(await pack.saved(path))) {
          const progress = track(path, pack);
          await (pack.fetchAhead ? pack.fetchAhead(path, progress, controller.signal) : pack.read(path, progress));
        }
      } else if (SAVED_FROM_SERVER.test(path)) {
        await fromServerSaved(path);
      }
    })().catch((error) => {
      if (error && error.cancelled) {
        transfers.delete(path);
        // Still worth having later, after whatever is needed now.
        if (!prefetchQueue.includes(path)) prefetchQueue.push(path);
      } else {
        console.info('background download stopped:', path, error && error.message);
      }
    });
    ahead = { path, controller };
    prefetching.set(path, job);
    await job;
    prefetching.delete(path);
    ahead = null;
  }
  prefetchRunning = false;
}

/// A world the player is waiting for: stop fetching anything else ahead of
/// time until it is in. Returns the call that ends the wait.
function needNow(path) {
  if (!SAVED_FROM_SERVER.test(path)) return () => {};
  if (ahead && ahead.path !== path && !ahead.controller.signal.aborted) {
    console.info(`stopping the download of ${ahead.path}: ${path} is needed now`);
    ahead.controller.abort();
  }
  waitingOn++;
  return () => {
    waitingOn--;
    if (!waitingOn && prefetchQueue.length && !prefetchRunning) runPrefetch();
  };
}

// Server mode: maps are saved with the server's ETag, then revalidated, so an
// unchanged map costs one small request instead of hundreds of megabytes.
const SAVED_FROM_SERVER = /^maps\//;

async function fromServerSaved(path) {
  const key = `server/${encodeURIComponent(origin())}/${path}`;
  const cache = await downloads();
  const hit = cache && await cache.match(DOWNLOAD_KEY + key).catch(() => null);
  const etag = hit && hit.headers.get('X-Skate3-ETag');
  const response = await fetch(`${origin()}/${path}`, { cache: 'no-store', headers: etag ? { 'If-None-Match': etag } : {} });
  if (response.status === 304 && hit) return new Uint8Array(await hit.arrayBuffer());
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const tag = response.headers.get('ETag');
  if (tag) await saveDownload(key, bytes, { 'X-Skate3-ETag': tag });
  return bytes;
}

// `fallback`: the server also holds the data, so a zip the browser cannot
// read (its host refuses CORS) just means reading through the server.
async function packUrl() {
  const forced = new URLSearchParams(location.search).get('pack');
  if (forced) return { url: forced, fallback: false };
  origin(); // migrates a zip saved as the server
  const chosen = (localStorage.getItem(PACK_KEY) || '').trim();
  if (chosen) return { url: chosen, fallback: false };
  try {
    const response = await fetch(`${origin()}/config.json`, { cache: 'no-cache' });
    if (!response.ok) return null;
    const config = await response.json();
    return typeof config.pack === 'string' && config.pack ? { url: config.pack, fallback: Boolean(config.fallback) } : null;
  } catch {
    return null;
  }
}

/// The game-data pack, or null when the game server holds the data itself.
// Add-on packs published next to the game data, read the same way. The game
// audio (tools/asset_pipeline/audio.py) is its own zip so the game data zip
// never has to be rebuilt and re-uploaded for it. A missing add-on is fine.
// `override` packs replace the game data's copies of their files: the original
// UI screens (tools/prepare_frontend.py) and the audio are updated more often
// than the data (older data packs carry an earlier audio conversion).
const ADD_ONS = [
  { file: 'skate3-audio.zip', marker: 'assets/private/audio/sounds.json', what: 'game audio', override: true },
  { file: 'skate3-ui.zip', marker: 'assets/private/frontend/buttons.json', what: 'original UI screens', override: true },
  // The Object Dropper's props (tools/asset_pipeline/dropper.py).
  { file: 'skate3-dropper.zip', marker: 'assets/private/dropper/catalog.json', what: 'Object Dropper props', override: true },
];

// A split pack (make-game-data-pack.js --split): the first zip lists the
// others, each small enough for the CDN to cache whole. All are required.
async function packParts(main, url) {
  if (!main.has('assets/private/pack-parts.json')) return [];
  const list = JSON.parse(new TextDecoder().decode(await main.read('assets/private/pack-parts.json')));
  return Promise.all(list.map(async ({ file, marker }) => {
    const address = new URL(file, url).href;
    return openPack(address, hasDownloads() ? (version) => packStore(address, version) : null, marker);
  }));
}

async function addOnPacks(url) {
  const opened = [];
  for (const addOn of ADD_ONS) {
    const address = new URL(addOn.file, url).href;
    try {
      const pack = await openPack(address, hasDownloads() ? (version) => packStore(address, version) : null, addOn.marker);
      pack.override = Boolean(addOn.override);
      opened.push(pack);
    } catch (error) {
      console.info(`No ${addOn.what} pack at ${address} (${error.message || error}); continuing without it.`);
    }
  }
  return opened;
}

// One pack as far as the rest of the page is concerned: each file is read
// from whichever zip holds it, the game data winning any overlap unless the
// add-on overrides it.
function combine(main, extras) {
  if (!extras.length) return main;
  const all = [...extras.filter((pack) => pack.override), main, ...extras.filter((pack) => !pack.override)];
  const owner = (name) => all.find((pack) => pack.has(name));
  return {
    url: main.url,
    version: main.version,
    get downloaded() { return all.reduce((sum, pack) => sum + pack.downloaded, 0); },
    has: (name) => all.some((pack) => pack.has(name)),
    saved: async (name) => { const pack = owner(name); return Boolean(pack && pack.saved && await pack.saved(name)); },
    fetchAhead: async (name, onBytes, signal) => { const pack = owner(name); if (pack && pack.fetchAhead) await pack.fetchAhead(name, onBytes, signal); },
    spanBytes: (name) => { const pack = owner(name); return pack && pack.spanBytes ? pack.spanBytes(name) : 0; },
    list: () => {
      const seen = new Set();
      const out = [];
      for (const pack of all) for (const file of pack.list()) if (!seen.has(file.path)) { seen.add(file.path); out.push(file); }
      return out;
    },
    read: (name, onBytes) => { const pack = owner(name); return pack ? pack.read(name, onBytes) : Promise.resolve(null); },
    async readMany(names, progress) {
      const files = new Map();
      const groups = all.map((pack) => names.filter((name) => owner(name) === pack));
      // The whole load's size up front, so the bar never jumps back.
      const grand = all.reduce((sum, pack, index) => sum + (pack.bytesFor && groups[index].length ? pack.bytesFor(groups[index]) : 0), 0);
      let before = 0;
      for (const [index, pack] of all.entries()) {
        if (!groups[index].length) continue;
        let last = 0;
        const part = await pack.readMany(groups[index], (done, total) => {
          last = total;
          if (progress) progress(before + done, Math.max(grand, before + total));
        });
        before += last;
        for (const [name, bytes] of part) files.set(name, bytes);
      }
      return files;
    },
  };
}

export function gamePack() {
  if (!packState) {
    packState = (async () => {
      const source = await packUrl();
      if (!source) return null;
      const { url } = source;
      try {
        // Ranges saved for this version of the zip are reused; older versions
        // of it are cleared out.
        const main = await openPack(url, hasDownloads() ? (version) => packStore(url, version) : null);
        return combine(main, [...await packParts(main, url), ...await addOnPacks(url)]);
      } catch (error) {
        if (source.fallback) {
          console.warn(`Game data pack ${url} unreadable here (${error.message}); reading through the game server.`);
          return null;
        }
        const reason = error instanceof TypeError
          ? 'the browser could not reach it. The host must allow this site to read it (CORS) and answer range requests; see DEPLOY.md.'
          : error.message;
        throw new Error(`Game data pack ${url}: ${reason}`);
      }
    })();
    packState.catch(() => { packState = null; });
  }
  return packState;
}

// The engine's wasm module (about 57 MB) comes from the game data's host when
// this build is published there (deploy/upload.py puts it at
// engine/skate3rust_bg-<build>.wasm beside the zips): that host's downloads are
// free, while every copy from the game server is paid for out of its upload.
// A build that is not published, or a host the page cannot read, falls back to
// the game server's own copy.
// `progress(done, total, finished)` follows the download (total 0 when unknown).
export async function engineWasm(build, local, progress = () => {}) {
  const hash = (/[?&]v=([0-9a-f]+)/.exec(build) || [])[1];
  const pack = hash && await gamePack().catch(() => null);
  if (pack && /^https:/.test(pack.url)) {
    try {
      const response = await fetch(new URL(`engine/skate3rust_bg-${hash}.wasm`, pack.url));
      if (response.ok) return counted(response, progress);
    } catch {
      // Not reachable from here; the game server has it.
    }
  }
  return counted(await fetch(local), progress);
}

// The same response, counting its bytes as the engine compiles them. A
// compressed response's Content-Length is the compressed size; the game
// server sends the real one as X-Raw-Length.
function counted(response, progress) {
  if (!response.ok || !response.body || typeof TransformStream !== 'function') return response;
  const encoded = Boolean(response.headers.get('content-encoding'));
  const total = Number(response.headers.get('x-raw-length')) || (encoded ? 0 : Number(response.headers.get('content-length'))) || 0;
  let done = 0;
  const body = response.body.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      done += chunk.byteLength;
      progress(done, total);
      controller.enqueue(chunk);
    },
    // The whole module is in: say so even when its size was unknown.
    flush() {
      progress(done, total || done, true);
    },
  }));
  return new Response(body, { status: response.status, statusText: response.statusText, headers: { 'Content-Type': 'application/wasm' } });
}

export async function manifest(reload = false) {
  const base = origin();
  if (!reload && cached && cached.base === base && Date.now() - cached.at < 5000) return cached.files;
  const response = await fetch(`${base}/manifest.json`, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`No file list at ${base}/manifest.json (HTTP ${response.status}).`);
  let files = await response.json();
  if (!Array.isArray(files)) throw new Error(`${base}/manifest.json is not a list of files.`);
  // The server lists what it holds (custom characters); the pack, the game.
  const pack = await gamePack();
  if (pack) {
    const own = new Set(files.map((file) => file && file.path));
    files = [...pack.list().filter((file) => !own.has(file.path)), ...files];
  }
  cached = { base, at: Date.now(), files };
  return files;
}

async function fromOrigin(path) {
  const pack = await gamePack().catch(() => null);
  if (pack && pack.has(path)) return pack.read(path, track(path, pack));
  if (SAVED_FROM_SERVER.test(path) && hasDownloads()) return fromServerSaved(path);
  const response = await fetch(`${origin()}/${path}`, { cache: 'no-cache' });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

// --- Boot package -----------------------------------------------------------
//
// The boot set is a few thousand small files, and asking for them one at a time
// costs a round trip each. The server hands them over as one response instead:
// a four-byte header length, the header, then every file back to back, gzipped
// as a single stream the browser decodes while it arrives. One transfer, one
// buffer, and a view per file.
let bundle = null;
let pending = null;
let unavailable = false;

export function startBootPackage(progress) {
  // Asked again (a retry): the same outcome, never null (callers chain on it).
  if (unavailable || bundle || pending) return pending || Promise.resolve(bundle);
  pending = (async () => {
    const pack = await gamePack();
    if (pack) {
      // Neighbouring files come down as one range: about 45 requests, 100 MB.
      const names = pack.list().map((file) => file.path).filter(mountedPath);
      const before = pack.downloaded;
      const files = await pack.readMany(names, (done, total) => {
        // Saved from an earlier visit unless something actually came down.
        if (progress) progress(done, total, pack.downloaded > before ? 'Downloading game data' : 'Loading saved game data');
      });
      bundle = files;
      return files;
    }
    const saved = await savedBootPackage(progress).catch((error) => {
      console.warn('saved game data unavailable, downloading:', error && error.message);
      return null;
    });
    if (saved) {
      bundle = await splitBootStream(saved);
      return bundle;
    }
    const response = await fetch(`${origin()}/boot-package`, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    // The server gzips the package and the browser decodes it for us, so the
    // unpacked length arrives in X-Boot-Bytes rather than Content-Length.
    const expected = Number(response.headers.get('X-Boot-Bytes'))
      || Number(response.headers.get('Content-Length')) || 0;
    bundle = await splitBootStream(response.body, (at) => {
      if (progress) progress(at, expected || at, 'Downloading game data');
    });
    return bundle;
  })().catch((error) => {
    // An older or static server has no boot package; single requests still work.
    unavailable = true;
    console.warn('no boot package, asking for files one at a time:', error.message || error);
    return null;
  }).finally(() => {
    pending = null;
  });
  return pending;
}

// A boot package's framing: a 4-byte header length, the JSON header, then
// every file back to back. Split while it streams in, each file in a buffer
// of its own: then each can be let go the moment the engine has copied it
// (readFile), instead of one 220 MB buffer living until the last file is in.
// That overlap was a few hundred MB of a phone browser's limited memory.
async function splitBootStream(stream, progress) {
  const reader = stream.getReader();
  const files = new Map();
  let pending = new Uint8Array(0);
  let headerLength = -1;
  let list = null;
  let index = 0;
  let current = null;
  let filled = 0;
  let total = 0;
  const take = (chunk) => {
    let at = 0;
    while (at < chunk.length || (list && index < list.length && list[index].size === 0)) {
      if (!list) {
        // Length and header: small, so gathered by concatenation.
        const joined = new Uint8Array(pending.length + chunk.length - at);
        joined.set(pending);
        joined.set(chunk.subarray(at), pending.length);
        pending = joined;
        at = chunk.length;
        if (headerLength < 0 && pending.length >= 4) headerLength = new DataView(pending.buffer).getUint32(0, true);
        if (headerLength >= 0 && pending.length >= 4 + headerLength) {
          list = JSON.parse(new TextDecoder().decode(pending.subarray(4, 4 + headerLength))).files;
          const rest = pending.subarray(4 + headerLength);
          pending = new Uint8Array(0);
          if (rest.length) take(rest);
        }
        return;
      }
      if (index >= list.length) return;
      const file = list[index];
      if (!current) { current = new Uint8Array(file.size); filled = 0; }
      const count = Math.min(file.size - filled, chunk.length - at);
      current.set(chunk.subarray(at, at + count), filled);
      filled += count;
      at += count;
      if (filled === file.size) {
        files.set(file.path, current);
        current = null;
        index++;
      }
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    take(value);
    if (progress) progress(total);
  }
  if (!list || index < list.length) throw new Error('boot package ended early');
  return files;
}

// Server mode: the boot package kept compressed in saved downloads. The server
// is asked only whether it changed (its ETag); when it has not, nothing is
// downloaded. Null when this cannot be used (no Cache Storage, an older server
// without ?raw=1), and the caller downloads as before.
async function savedBootPackage(progress) {
  if (!hasDownloads() || typeof DecompressionStream === 'undefined') return null;
  const key = `server/${encodeURIComponent(origin())}/boot-package.gz`;
  const cache = await downloads();
  if (!cache) return null;
  const hit = await cache.match(DOWNLOAD_KEY + key).catch(() => null);
  const etag = hit && hit.headers.get('X-Skate3-ETag');
  const response = await fetch(`${origin()}/boot-package?raw=1`, { cache: 'no-store', headers: etag ? { 'If-None-Match': etag } : {} });
  let compressed;
  if (response.status === 304 && hit) {
    if (progress) progress(1, 1, 'Loading saved game data');
    compressed = new Uint8Array(await hit.arrayBuffer());
  } else if (response.ok && response.headers.get('X-Boot-Raw')) {
    const expected = Number(response.headers.get('Content-Length')) || 0;
    const reader = response.body.getReader();
    compressed = new Uint8Array(expected);
    let at = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (compressed.length - at < value.length) {
        const grown = new Uint8Array(Math.max(compressed.length * 2, at + value.length));
        grown.set(compressed.subarray(0, at));
        compressed = grown;
      }
      compressed.set(value, at);
      at += value.length;
      if (progress) progress(at, expected || at, 'Downloading game data');
    }
    compressed = compressed.subarray(0, at);
    const tag = response.headers.get('ETag');
    if (tag) await saveDownload(key, compressed, { 'X-Skate3-ETag': tag });
  } else {
    return null;
  }
  // Decompressed as a stream: the caller splits it file by file.
  return new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
}

/// The boot set is fully read into the engine once it has mounted, so drop it.
export function releaseBootPackage() {
  bundle = null;
}

// --- Local writes (origin-private file system) ------------------------------
//
// Brave hides the file-system APIs, so OPFS is a preference, not a requirement:
// without it the same writes are kept in memory for the session. Everything the
// engine reads still comes from the server.

const memory = new Map();

// Settings (graphics, player, gameplay...) are small JSON files the engine
// reads synchronously at startup, so they must be mounted with the boot set.
// They are also kept in localStorage: Brave hides OPFS, and without a copy
// there every saved option would be lost on reload.
const SETTINGS = /^settings\/[^/]+\.json$/;
const SETTINGS_KEY = 'skate3-settings:';
const SETTINGS_LIMIT = 256 * 1024;

function savedSettings() {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(SETTINGS_KEY)) out.push(key.slice(SETTINGS_KEY.length));
    }
  } catch {}
  return out;
}

function keepSetting(path, data) {
  if (!SETTINGS.test(path)) return;
  try {
    if (data === null || data === undefined) localStorage.removeItem(SETTINGS_KEY + path);
    else if (data.length <= SETTINGS_LIMIT) localStorage.setItem(SETTINGS_KEY + path, new TextDecoder().decode(data));
  } catch (error) {
    console.warn('could not keep setting', path, error);
  }
}

function savedSetting(path) {
  if (!SETTINGS.test(path)) return null;
  try {
    const text = localStorage.getItem(SETTINGS_KEY + path);
    return text === null ? null : new TextEncoder().encode(text);
  } catch {
    return null;
  }
}

export function hasStore() {
  return Boolean(navigator.storage && navigator.storage.getDirectory);
}

async function localRoot(create) {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(LOCAL_DIR, { create });
}

async function localDir(parts, create) {
  let dir = await localRoot(create);
  for (const part of parts) dir = await dir.getDirectoryHandle(part, { create });
  return dir;
}

const split = (path) => path.split('/').filter(Boolean);

async function readLocal(path) {
  if (!hasStore()) return memory.get(path) || savedSetting(path);
  const parts = split(path);
  const name = parts.pop();
  try {
    const handle = await (await localDir(parts, false)).getFileHandle(name);
    return new Uint8Array(await (await handle.getFile()).arrayBuffer());
  } catch (error) {
    if (error && NEAREST.includes(error.name)) return savedSetting(path);
    throw error;
  }
}

// Writes to one file go one after another: two at once (a save, then the
// engine's rename removing it) fail with NoModificationAllowedError, and the
// setting is lost.
const writing = new Map();
export function writeFile(path, data) {
  const previous = writing.get(path) || Promise.resolve();
  const next = previous.catch(() => {}).then(() => writeNow(path, data));
  writing.set(path, next);
  next.finally(() => { if (writing.get(path) === next) writing.delete(path); }).catch(() => {});
  return next;
}

async function writeNow(path, data) {
  keepSetting(path, data);
  if (!hasStore()) {
    if (data === null || data === undefined) memory.delete(path);
    else memory.set(path, new Uint8Array(data));
    return;
  }
  const parts = split(path);
  const name = parts.pop();
  if (data === null || data === undefined) {
    try {
      await (await localDir(parts, false)).removeEntry(name);
    } catch (error) {
      if (!error || error.name !== 'NotFoundError') throw error;
    }
    return;
  }
  const handle = await (await localDir(parts, true)).getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(data);
  await writable.close();
}

async function localFiles() {
  if (!hasStore()) return [...memory].map(([path, data]) => ({ path, size: data.length }));
  const out = [];
  async function walk(dir, base) {
    for await (const [name, handle] of dir.entries()) {
      const path = base ? `${base}/${name}` : name;
      if (handle.kind === 'directory') await walk(handle, path);
      else out.push({ path, size: (await handle.getFile()).size });
    }
  }
  try {
    await walk(await localRoot(false), '');
  } catch (error) {
    if (!error || error.name !== 'NotFoundError') throw error;
  }
  return out;
}

// The previous design copied the whole install into the browser. That cache is
// obsolete now that files are read from the server, and it can be most of a
// browser's entire storage quota, so drop it on first load of the new client.
const LEGACY_DIR = 'skate3-install';
const LEGACY_DB = 'skate3-web';

export async function discardLegacyCache() {
  let dropped = false;
  if (hasStore()) {
    try {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry(LEGACY_DIR, { recursive: true });
      dropped = true;
    } catch (error) {
      if (!error || error.name !== 'NotFoundError') console.warn('could not drop the old copy', error);
    }
  }
  try {
    await new Promise((resolve) => {
      const request = indexedDB.deleteDatabase(LEGACY_DB);
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    });
  } catch (error) {
    console.warn('could not drop the old folder handle', error);
  }
  localStorage.removeItem('skate3-asset-origin');
  return dropped;
}

export async function localCount() {
  return (await localFiles()).length;
}

export async function clearLocal() {
  for (const path of savedSettings()) keepSetting(path, null);
  if (!hasStore()) {
    memory.clear();
    return;
  }
  try {
    await (await navigator.storage.getDirectory()).removeEntry(LOCAL_DIR, { recursive: true });
  } catch (error) {
    if (!error || error.name !== 'NotFoundError') throw error;
  }
}

// --- The host API the engine calls ------------------------------------------

/// `null` means the server has no such file.
export async function readFile(path) {
  const local = await readLocal(path);
  if (local) return local;
  if (pending) await pending;
  const booted = bundle && bundle.get(path);
  if (booted) {
    // The engine copies each startup file into its own memory as it mounts
    // it; the page's copy can go now rather than at the end of the load.
    bundle.delete(path);
    return booted;
  }
  const done = needNow(path);
  try {
    // A world already downloading ahead of time: wait, then read it saved.
    if (prefetching.has(path)) await prefetching.get(path);
    return await fromOrigin(path);
  } finally {
    done();
  }
}

/// The fixture map the client ships in dist/. Not part of a converted install.
export const demoMap = 'maps/format-demo.skate';

export async function installSummary() {
  let base = origin();
  try {
    const pack = await gamePack();
    if (pack) base = pack.url;
    const files = await manifest();
    const wanted = files.filter((file) => file && mountedPath(file.path));
    return {
      origin: base,
      ready: wanted.some((file) => file.path === 'assets/private/game.json'),
      files: wanted.length,
      bytes: wanted.reduce((sum, file) => sum + (file.size || 0), 0),
      maps: files
        .filter((file) => file && /^maps\/(private\/)?[^/]+\.skate$/i.test(file.path))
        .map((file) => file.path)
        .sort(),
    };
  } catch (error) {
    return { origin: base, ready: false, files: 0, bytes: 0, maps: [], error: error.message };
  }
}

export async function bootConfig(map, difficulty, capture = false, teleport = null, frontEnd = false) {
  const files = await manifest();
  const mounted = (file) => file && mountedPath(file.path) && !otherSky(file.path, map, frontEnd);
  return {
    root: 'assets',
    // Plus settings saved in this browser, which the server does not list.
    mount: [...new Set([
      ...files.filter(mounted).map((file) => file.path),
      ...savedSettings(),
    ])],
    // Files the engine may fetch later (every world, the skies not mounted):
    // it lists them, and loads one when the player travels there.
    declared: files
      .filter((file) => file && (MAP_FILE.test(file.path) || (mountedPath(file.path) && !mounted(file))))
      .map((file) => file.path),
    // Start at Skate 3's title and main menu rather than in a world.
    frontEnd: Boolean(frontEnd),
    mobile: mobileMode(),
    map,
    difficulty: difficulty || null,
    capture,
    // A teleports.json destination id: start at that spot instead of the spawn.
    teleport: teleport || null,
  };
}
