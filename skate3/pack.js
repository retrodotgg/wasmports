// Game data read straight out of the published zip by the browser.
//
// The pack (skate3-game-data.zip) sits on a static host such as Cloudflare R2.
// Nothing is extracted or re-uploaded: the browser reads the zip's central
// directory with HTTP range requests, then fetches only the byte ranges of the
// files it needs and inflates them itself. The game's own web server never
// carries game data.
//
// Every request is a plain GET or HEAD with a single `Range: bytes=a-b`, which
// browsers send cross-origin without a preflight. The host only has to answer
// with Access-Control-Allow-Origin (see DEPLOY.md).

const EOCD = 0x06054b50;
const EOCD64 = 0x06064b50;
const EOCD64_LOCATOR = 0x07064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const MARKER = 'assets/private/game.json';
// Bytes fetched past an entry's data to cover a local header longer than the
// central directory's copy; anything larger costs one more request.
const SLACK = 1024;

// The game asks for a few hundred sounds at once. Chrome's HTTP cache fails
// many simultaneous range reads of one URL (ERR_CACHE_OPERATION_NOT_SUPPORTED),
// so reads skip it (saved ranges are kept by the pack's own store instead),
// run a few at a time, and retry a failed fetch.
const PARALLEL = 6;
let active = 0;
const queue = [];
async function slot(task) {
  if (active >= PARALLEL) await new Promise((resolve) => queue.push(resolve));
  active++;
  try {
    return await task();
  } finally {
    active--;
    if (queue.length) queue.shift()();
  }
}

// A city is one 350 MB file. One connection to the data host tops out far
// below the line's speed, so large ranges come down as 8 MB pieces in
// parallel, each retried on its own.
const CHUNK = 8 << 20;
// `signal`: cancels the download (a background world the player stopped waiting for).
async function fetchRange(url, start, end, onBytes, signal) {
  if (end - start + 1 <= 2 * CHUNK) return fetchPiece(url, start, end, onBytes, signal);
  const out = new Uint8Array(end - start + 1);
  const pieces = [];
  for (let at = start; at <= end; at += CHUNK) {
    const last = Math.min(end, at + CHUNK - 1);
    pieces.push(fetchPiece(url, at, last, onBytes, signal).then((bytes) => out.set(bytes, at - start)));
  }
  await Promise.all(pieces);
  return out;
}

// Every byte that arrives, for the loading screens: they show progress and
// notice when nothing has come in for a while.
export const transfer = { received: 0, lastAt: 0, failures: 0, lastError: '' };

// A connection that stops sending would otherwise wait for ever: a piece with
// no new bytes for this long is dropped and asked for again.
const IDLE_MS = 30000;
const ATTEMPTS = 5;

function cancelled() {
  const error = new Error('download cancelled');
  error.name = 'AbortError';
  error.final = true;
  error.cancelled = true;
  return error;
}

async function fetchPiece(url, start, end, onBytes = () => {}, signal = null) {
  for (let attempt = 1; ; attempt++) {
    let got = 0;
    if (signal && signal.aborted) throw cancelled();
    try {
      return await slot(async () => {
        // Queued behind other reads: it may have been cancelled meanwhile.
        if (signal && signal.aborted) throw cancelled();
        const abort = new AbortController();
        const stop = () => abort.abort();
        if (signal) signal.addEventListener('abort', stop, { once: true });
        let timer = setTimeout(() => abort.abort(), IDLE_MS);
        const alive = () => { clearTimeout(timer); timer = setTimeout(() => abort.abort(), IDLE_MS); };
        try {
          const response = await fetch(url, { headers: { Range: `bytes=${start}-${end}` }, cache: 'no-store', signal: abort.signal });
          if (response.status !== 206) {
            const error = new Error(response.status === 200
              ? `${url} ignores range requests, so the browser cannot read single files out of it`
              : `${url}: HTTP ${response.status}`);
            error.final = response.status !== 429 && response.status < 500;
            throw error;
          }
          const out = new Uint8Array(end - start + 1);
          const reader = response.body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (got + value.length > out.length) throw new Error(`${url}: more bytes than the range asked for`);
            out.set(value, got);
            got += value.length;
            transfer.received += value.length;
            transfer.lastAt = performance.now();
            onBytes(value.length);
            alive();
          }
          if (got !== out.length) throw new Error(`${url}: the download ended early`);
          return out;
        } finally {
          clearTimeout(timer);
          if (signal) signal.removeEventListener('abort', stop);
        }
      });
    } catch (error) {
      // What this attempt counted no longer counts.
      if (got) onBytes(-got);
      if (signal && signal.aborted) throw cancelled();
      transfer.failures++;
      transfer.lastError = error.name === 'AbortError' ? `no data for ${IDLE_MS / 1000}s` : String(error.message || error);
      if (error.final || attempt >= ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
}

const u16 = (b, i) => b[i] | (b[i + 1] << 8);
const u32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
const u64 = (b, i) => u32(b, i) + u32(b, i + 4) * 4294967296;

// Same unwrapping as scripts/game-data-pack.js: paths inside start at assets/.
// `marker` is a file every pack of its kind holds at a known path.
function wrapperPrefix(names, marker = MARKER) {
  for (const name of names) {
    if (name.endsWith(marker) && name.length > marker.length) return name.slice(0, name.length - marker.length);
    if (name === marker) return '';
  }
  return '';
}

async function inflate(bytes, method, size, name) {
  let out;
  if (method === 0) out = bytes;
  else if (method === 8) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    out = new Uint8Array(await new Response(stream).arrayBuffer());
  } else throw new Error(`${name}: zip method ${method} is not supported (store or deflate only)`);
  if (out.length !== size) throw new Error(`${name}: unpacked ${out.length} of ${size} bytes`);
  return out;
}

// `storeFor` (optional) keeps fetched ranges between visits: given the pack's
// version it returns { get(key), put(key, bytes) } for that version only, so a
// replaced zip is never mixed with an old one. Ranges are saved as downloaded,
// still compressed.
// `marker` identifies the kind of pack: the game data holds MARKER; an add-on
// pack (the converted audio) names its own file.
export async function openPack(url, storeFor = null, marker = MARKER) {
  // A host the network silently blocks never answers; give up and say so.
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 20000);
  let head;
  try {
    head = await fetch(url, { method: 'HEAD', cache: 'no-store', signal: abort.signal });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`${new URL(url).host} did not answer in 20 seconds. Your network may be blocking it (common on school and work networks); try another network or a phone hotspot`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
  if (!head.ok) throw new Error(`${url}: HTTP ${head.status}`);
  const size = Number(head.headers.get('content-length'));
  if (!size) throw new Error(`${url} did not report its size`);
  const version = `${size}-${head.headers.get('etag') || head.headers.get('last-modified') || ''}`.replace(/[^\w.-]/g, '');
  const store = storeFor ? storeFor(version) : null;
  // Reads name the version: a CDN caches ranges per URL, and a zip replaced
  // under the same name must not be read from the old copy's cached bytes
  // (that mix fails with HTTP 416 or a corrupt directory).
  const versioned = `${url}${url.includes('?') ? '&' : '?'}v=${version}`;
  // Bytes that came over the network rather than from saved downloads.
  let downloaded = 0;
  // Whether a file was saved by an earlier read (without loading it).
  const savedRange = async (start, end) => Boolean(store && store.has && await store.has(`${start}-${end}`));
  // `onBytes(n)`: bytes of this range as they arrive (all at once when saved).
  const range = async (url, start, end, onBytes, signal) => {
    const key = `${start}-${end}`;
    if (store) {
      const saved = await store.get(key);
      if (saved && saved.length === end - start + 1) {
        if (onBytes) onBytes(saved.length);
        return saved;
      }
    }
    const bytes = await fetchRange(versioned, start, end, onBytes, signal);
    downloaded += bytes.length;
    if (store) await store.put(key, bytes);
    return bytes;
  };

  const tail = await range(url, Math.max(0, size - 65557), size - 1);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (u32(tail, i) === EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error(`${url} is not a zip`);
  let directorySize = u32(tail, eocd + 12);
  let directoryOffset = u32(tail, eocd + 16);
  if (eocd >= 20 && u32(tail, eocd - 20) === EOCD64_LOCATOR) {
    const record = u64(tail, eocd - 12);
    const header = await range(url, record, record + 55);
    if (u32(header, 0) !== EOCD64) throw new Error(`${url} has a broken zip64 record`);
    directorySize = u64(header, 40);
    directoryOffset = u64(header, 48);
  }

  const directory = await range(url, directoryOffset, directoryOffset + directorySize - 1);
  const decoder = new TextDecoder();
  const found = [];
  for (let at = 0; at + 46 <= directory.length && u32(directory, at) === CENTRAL;) {
    const method = u16(directory, at + 10);
    let compressed = u32(directory, at + 20);
    let uncompressed = u32(directory, at + 24);
    const nameLength = u16(directory, at + 28);
    const extraLength = u16(directory, at + 30);
    const commentLength = u16(directory, at + 32);
    let offset = u32(directory, at + 42);
    const name = decoder.decode(directory.subarray(at + 46, at + 46 + nameLength));
    if (compressed === 0xffffffff || uncompressed === 0xffffffff || offset === 0xffffffff) {
      for (let x = at + 46 + nameLength, end = x + extraLength; x + 4 <= end;) {
        const id = u16(directory, x);
        const length = u16(directory, x + 2);
        if (id === 1) {
          let slot = x + 4;
          if (uncompressed === 0xffffffff) { uncompressed = u64(directory, slot); slot += 8; }
          if (compressed === 0xffffffff) { compressed = u64(directory, slot); slot += 8; }
          if (offset === 0xffffffff) offset = u64(directory, slot);
          break;
        }
        x += 4 + length;
      }
    }
    if (!name.endsWith('/')) found.push({ name, method, compressed, size: uncompressed, offset, nameLength, extraLength });
    at += 46 + nameLength + extraLength + commentLength;
  }
  const wrapper = wrapperPrefix(found.map((entry) => entry.name), marker);
  const entries = new Map();
  for (const entry of found) {
    if (wrapper && !entry.name.startsWith(wrapper)) continue;
    const name = entry.name.slice(wrapper.length);
    if (name) entries.set(name, { ...entry, name });
  }
  if (!entries.has(marker)) throw new Error(`${url} does not contain a converted install (no ${marker})`);

  // The data inside `bytes` (fetched from `base`) for one entry, reading its
  // local header there; null if the header ran past what was fetched.
  const extract = (entry, bytes, base) => {
    const at = entry.offset - base;
    if (at + 30 > bytes.length || u32(bytes, at) !== LOCAL) throw new Error(`${entry.name}: broken local header`);
    const start = at + 30 + u16(bytes, at + 26) + u16(bytes, at + 28);
    if (start + entry.compressed > bytes.length) return null;
    return bytes.subarray(start, start + entry.compressed);
  };
  const span = (entry) => entry.offset + 30 + entry.nameLength + entry.extraLength + SLACK + entry.compressed;

  // The bytes a whole-file read downloads, for progress.
  const spanBytes = (name) => {
    const entry = entries.get(name);
    return entry && entry.size ? Math.min(size - 1, span(entry)) - entry.offset + 1 : 0;
  };

  async function read(name, onBytes) {
    const entry = entries.get(name);
    if (!entry) return null;
    if (entry.size === 0) return new Uint8Array(0);
    let bytes = await range(url, entry.offset, Math.min(size - 1, span(entry)), onBytes);
    let data = extract(entry, bytes, entry.offset);
    if (!data) {
      const header = 30 + u16(bytes, 26) + u16(bytes, 28);
      bytes = await range(url, entry.offset, entry.offset + header + entry.compressed - 1);
      data = extract(entry, bytes, entry.offset);
    }
    return inflate(data, entry.method, entry.size, name);
  }

  // Many files at once: neighbouring entries are fetched as one range (small
  // gaps are cheaper to download than to request separately), a few at a time.
  function runsFor(names) {
    const wanted = names.map((name) => entries.get(name)).filter(Boolean).sort((a, b) => a.offset - b.offset);
    const GAP = 1 << 20;
    const runs = [];
    for (const entry of wanted) {
      const last = runs[runs.length - 1];
      const end = Math.min(size - 1, span(entry));
      if (last && entry.offset - last.end <= GAP) {
        last.end = Math.max(last.end, end);
        last.entries.push(entry);
      } else runs.push({ start: entry.offset, end, entries: [entry] });
    }
    return runs;
  }
  const bytesFor = (names) => runsFor(names).reduce((sum, run) => sum + run.end - run.start + 1, 0);

  async function readMany(names, progress) {
    const runs = runsFor(names);
    const total = runs.reduce((sum, run) => sum + run.end - run.start + 1, 0);
    let done = 0;
    const files = new Map();
    let next = 0;
    const worker = async () => {
      while (next < runs.length) {
        const run = runs[next++];
        // Progress as the bytes arrive, not once per (possibly 100 MB) run.
        const bytes = await range(url, run.start, run.end, (n) => {
          done += n;
          if (progress) progress(done, total);
        });
        for (const entry of run.entries) {
          const data = extract(entry, bytes, run.start);
          files.set(entry.name, data ? await inflate(data, entry.method, entry.size, entry.name) : await read(entry.name));
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, runs.length) }, worker));
    return files;
  }

  return {
    url,
    version,
    get downloaded() { return downloaded; },
    entries,
    has: (name) => entries.has(name),
    // Download a file into the saved downloads without unpacking it (the
    // same range a later read asks for), for fetching ahead of time.
    fetchAhead: async (name, onBytes, signal) => {
      const entry = entries.get(name);
      if (entry && entry.size) await range(url, entry.offset, Math.min(size - 1, span(entry)), onBytes, signal);
    },
    spanBytes,
    bytesFor,
    // A whole-file read of `name` is already in the saved downloads.
    saved: async (name) => {
      const entry = entries.get(name);
      return Boolean(entry) && savedRange(entry.offset, Math.min(size - 1, span(entry)));
    },
    list: () => [...entries.values()].map((entry) => ({ path: entry.name, size: entry.size })),
    read,
    readMany,
  };
}
