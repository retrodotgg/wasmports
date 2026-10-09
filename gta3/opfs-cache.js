(() => {
  "use strict";

  const CACHE_DIR = "_gta3_asset_cache_v1";
  const ARCHIVE_FILE = "game.zip";
  const META_FILE = "meta.json";
  const WORKER_URL = "opfs-cache-worker.js?v=20260926-opfs4";
  const LOCK_NAME = "gta3-opfs-cache-v1";
  let localMutation = Promise.resolve();

  function supported() {
    return !!(navigator.storage && navigator.storage.getDirectory && window.Worker);
  }

  async function requestPersistence() {
    try {
      if (navigator.storage.persist) return await navigator.storage.persist();
    } catch {}
    return false;
  }

  async function getCacheDir(create = false) {
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle(CACHE_DIR, { create });
  }

  async function readMeta() {
    try {
      const dir = await getCacheDir(false);
      const handle = await dir.getFileHandle(META_FILE);
      return JSON.parse(await (await handle.getFile()).text());
    } catch {
      return null;
    }
  }

  async function looksLikeZip(file) {
    if (!file || file.size < 4) return false;
    try {
      const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
      const sig = (head[0] << 24) | (head[1] << 16) | (head[2] << 8) | head[3];
      return sig === 0x504b0304 || sig === 0x504b0506 || sig === 0x504b0708;
    } catch {
      return false;
    }
  }

  async function getStatus(options = {}) {
    if (!supported()) return { supported: false, ready: false, size: 0, meta: null };
    const expectedVersion = String(options.cacheVersion || "");
    const expectedUrl = String(options.url || "");
    try {
      const dir = await getCacheDir(false);
      const meta = await readMeta();
      if (!meta?.complete) return { supported: true, ready: false, size: 0, meta, reason: "incomplete" };

      const handle = await dir.getFileHandle(ARCHIVE_FILE);
      const file = await handle.getFile();
      const sizeOk = file.size > 0 && (!meta.size || file.size === Number(meta.size));
      const versionOk = !expectedVersion || meta.cacheVersion === expectedVersion;
      const urlOk = !expectedUrl || meta.source !== "remote" || meta.url === expectedUrl;
      const zipOk = sizeOk ? await looksLikeZip(file) : false;
      const ready = sizeOk && versionOk && urlOk && zipOk;

      let reason = "";
      if (!sizeOk) reason = "size-mismatch";
      else if (!versionOk) reason = "cache-version-mismatch";
      else if (!urlOk) reason = "source-url-mismatch";
      else if (!zipOk) reason = "invalid-zip-signature";

      return { supported: true, ready, size: file.size, meta, reason };
    } catch {
      return { supported: true, ready: false, size: 0, meta: null, reason: "missing" };
    }
  }

  async function getArchiveFile() {
    const dir = await getCacheDir(false);
    const handle = await dir.getFileHandle(ARCHIVE_FILE);
    return handle.getFile();
  }

  function isStaleStateError(err) {
    const text = String(err?.stack || err?.message || err || "");
    return (
      err?.name === "InvalidStateError" ||
      /state cached in an interface object.*changed since it was read from disk/i.test(text) ||
      /state.*changed since.*read from disk/i.test(text)
    );
  }

  async function resetCacheFiles() {
    const root = await navigator.storage.getDirectory();
    let dir;
    try {
      dir = await root.getDirectoryHandle(CACHE_DIR, { create: true });
    } catch {
      return;
    }
    for (const name of [ARCHIVE_FILE, META_FILE]) {
      try { await dir.removeEntry(name); } catch {}
    }
  }

  async function withExclusiveLock(task) {
    if (navigator.locks?.request) {
      return navigator.locks.request(LOCK_NAME, { mode: "exclusive" }, task);
    }

    const previous = localMutation.catch(() => {});
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    localMutation = previous.then(() => gate);
    await previous;
    try {
      return await task();
    } finally {
      release();
    }
  }

  async function clear() {
    if (!supported()) return;
    return withExclusiveLock(() => resetCacheFiles());
  }

  function runWorker(message, { onProgress } = {}) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(WORKER_URL);
      let settled = false;

      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        worker.terminate();
        fn(value);
      };

      worker.onerror = (event) => {
        finish(reject, new Error(event.message || "OPFS cache worker crashed"));
      };

      worker.onmessage = (event) => {
        const msg = event.data || {};
        if (msg.type === "progress") {
          onProgress?.(msg);
          return;
        }
        if (msg.type === "done") {
          finish(resolve, msg);
          return;
        }
        if (msg.type === "error") {
          finish(reject, new Error(msg.message || "OPFS cache operation failed"));
        }
      };

      worker.postMessage(message);
    });
  }

  async function cacheLocalFile(file, options = {}) {
    if (!supported()) throw new Error("OPFS is not supported by this browser.");
    if (!file) throw new Error("No ZIP file selected.");
    const cacheVersion = String(options.cacheVersion || "");
    const onProgress = options.onProgress;
    return withExclusiveLock(() => runWorker({ type: "cache-file", file, cacheVersion }, { onProgress }));
  }

  async function cacheRemoteUrl(url, options = {}) {
    if (!supported()) throw new Error("OPFS is not supported by this browser.");
    if (!url) throw new Error("No asset URL configured.");
    const cacheVersion = String(options.cacheVersion || "");
    const onProgress = options.onProgress;
    return withExclusiveLock(async () => {
      try {
        return await runWorker({ type: "cache-url", url, cacheVersion }, { onProgress });
      } catch (err) {
        if (!isStaleStateError(err)) throw err;
        // One final clean retry for tabs still holding handles from an older build.
        await resetCacheFiles();
        return runWorker({ type: "cache-url", url, cacheVersion }, { onProgress });
      }
    });
  }

  window.OPFSAssetCache = {
    supported,
    requestPersistence,
    getStatus,
    getArchiveFile,
    cacheLocalFile,
    cacheRemoteUrl,
    looksLikeZip,
    clear,
  };
})();
