// GTA III browser save persistence + slot file manager.
// Stores the eight native GTA3sf<N>.b files in OPFS and mirrors them into
// /game/userfiles for the re3 runtime.
(() => {
  "use strict";

  const SAVE_SUBDIR = "userfiles";
  const SLOT_COUNT = 8;
  const OPFS_DIR = "_gta3_save_manager_v1";

  let FS = null;
  let saveDir = null;
  let backend = "not mounted";
  let ready = false;
  let logFn = () => {};
  let onStateChange = () => {};

  let state = "idle";
  let pending = false;
  let syncPromise = null;
  let lastSyncResult = null;
  let lastSyncError = null;
  let lastSyncAt = null;

  const slotName = (slot) => `GTA3sf${slot + 1}.b`;
  const slotPath = (slot) => `${saveDir}/${slotName(slot)}`;

  function emitChange() {
    try { onStateChange(); } catch {}
    try { window.dispatchEvent(new CustomEvent("gta3-saves-change")); } catch {}
  }

  function validateSlot(slot) {
    const n = Number(slot);
    if (!Number.isInteger(n) || n < 0 || n >= SLOT_COUNT)
      throw new RangeError(`save slot must be 0..${SLOT_COUNT - 1}`);
    return n;
  }

  function opfsSupported() {
    return !!navigator.storage?.getDirectory;
  }

  async function getOpfsDir() {
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle(OPFS_DIR, { create: true });
  }

  async function removeOpfsFile(dir, name) {
    try {
      await dir.removeEntry(name);
    } catch (err) {
      if (err?.name !== "NotFoundError") throw err;
    }
  }

  async function persistAllNow() {
    if (!ready || !FS || !saveDir || !opfsSupported()) return;
    const dir = await getOpfsDir();

    for (let slot = 0; slot < SLOT_COUNT; slot++) {
      const name = slotName(slot);
      const path = slotPath(slot);
      if (FS.analyzePath(path).exists) {
        const bytes = FS.readFile(path, { encoding: "binary" });
        const handle = await dir.getFileHandle(name, { create: true });
        const writable = await handle.createWritable();
        await writable.write(bytes);
        await writable.close();
      } else {
        await removeOpfsFile(dir, name);
      }
    }
  }

  async function runSyncLoop() {
    state = "syncing";
    emitChange();
    try {
      do {
        pending = false;
        await persistAllNow();
      } while (pending);
      lastSyncResult = "success";
      lastSyncError = null;
      logFn("[Save] OPFS sync complete", "info");
    } catch (err) {
      lastSyncResult = "failure";
      lastSyncError = String(err?.message || err);
      logFn(`[Save] OPFS sync failed: ${lastSyncError}`, "stderr");
    } finally {
      lastSyncAt = new Date();
      state = "idle";
      syncPromise = null;
      emitChange();
    }
  }

  function requestSync() {
    if (!ready || backend !== "OPFS") return Promise.resolve();
    pending = true;
    if (!syncPromise) syncPromise = runSyncLoop();
    return syncPromise;
  }

  async function restoreFromOpfs() {
    const dir = await getOpfsDir();
    let restored = 0;
    for (let slot = 0; slot < SLOT_COUNT; slot++) {
      const name = slotName(slot);
      try {
        const handle = await dir.getFileHandle(name);
        const file = await handle.getFile();
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (bytes.byteLength > 0) {
          FS.writeFile(slotPath(slot), bytes);
          restored++;
        }
      } catch (err) {
        if (err?.name !== "NotFoundError") throw err;
      }
    }
    return restored;
  }

  async function mountAndRestore(instance, assetMountPoint, log) {
    logFn = log || logFn;
    FS = instance.FS;
    saveDir = `${assetMountPoint.replace(/\/+$/, "")}/${SAVE_SUBDIR}`;

    try {
      FS.mkdirTree(saveDir);
    } catch (err) {
      if (!FS.analyzePath(saveDir).exists) throw err;
    }

    if (opfsSupported()) {
      try {
        await navigator.storage.persist?.();
        const count = await restoreFromOpfs();
        backend = "OPFS";
        ready = true;
        logFn(`[Save] OPFS save manager ready; restored ${count} slot file(s)`, "info");
        emitChange();
        return;
      } catch (err) {
        logFn(`[Save] OPFS restore unavailable; using session memory: ${err}`, "stderr");
      }
    }

    backend = "MEMFS (session-only)";
    ready = true;
    emitChange();
  }

  function onSaveDirChanged(reason, filename) {
    logFn(reason === "delete" ? `[Save] Deleted: ${filename}` : `[Save] Written: ${filename}`, "info");
    requestSync();
    emitChange();
  }

  function listSlots() {
    const result = [];
    for (let slot = 0; slot < SLOT_COUNT; slot++) {
      const name = slotName(slot);
      const path = saveDir ? slotPath(slot) : null;
      let exists = false;
      let size = 0;
      if (FS && path && FS.analyzePath(path).exists) {
        exists = true;
        try { size = FS.stat(path).size || 0; } catch {}
      }
      result.push({ slot, number: slot + 1, name, path, exists, size });
    }
    return result;
  }

  async function uploadSlot(slot, file) {
    slot = validateSlot(slot);
    if (!ready || !FS || !saveDir) throw new Error("Save system is not ready yet.");
    if (!file) throw new Error("No save file selected.");
    if (file.size <= 0) throw new Error("The selected save file is empty.");
    if (file.size > 2 * 1024 * 1024) throw new Error("The selected file is too large to be a GTA III save.");

    const bytes = new Uint8Array(await file.arrayBuffer());
    FS.writeFile(slotPath(slot), bytes);
    logFn(`[Save Manager] Imported ${file.name} into slot ${slot + 1} (${bytes.byteLength} bytes)`, "info");
    await requestSync();
    emitChange();
    return { slot, size: bytes.byteLength, name: slotName(slot) };
  }

  function downloadSlot(slot) {
    slot = validateSlot(slot);
    if (!ready || !FS || !saveDir) throw new Error("Save system is not ready yet.");
    const path = slotPath(slot);
    if (!FS.analyzePath(path).exists) throw new Error(`Slot ${slot + 1} is empty.`);

    const bytes = FS.readFile(path, { encoding: "binary" });
    const blob = new Blob([bytes], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = slotName(slot);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    logFn(`[Save Manager] Downloaded slot ${slot + 1}`, "info");
  }

  async function deleteSlot(slot) {
    slot = validateSlot(slot);
    if (!ready || !FS || !saveDir) throw new Error("Save system is not ready yet.");
    const path = slotPath(slot);
    if (FS.analyzePath(path).exists) FS.unlink(path);
    await requestSync();
    emitChange();
  }

  async function clearSaves() {
    if (!ready || !FS || !saveDir) throw new Error("Save system is not ready yet.");
    for (let slot = 0; slot < SLOT_COUNT; slot++) {
      const path = slotPath(slot);
      if (FS.analyzePath(path).exists) {
        try { FS.unlink(path); } catch {}
      }
    }
    await requestSync();
    logFn("[Save] All browser save slots cleared", "info");
    emitChange();
  }

  function forceSync() {
    return requestSync();
  }

  function getStatus() {
    return {
      backend,
      saveDir,
      state,
      ready,
      slotCount: SLOT_COUNT,
      lastSyncResult,
      lastSyncError,
      lastSyncAt,
    };
  }

  function setOnStateChange(fn) {
    onStateChange = fn || (() => {});
  }

  window.Re3Saves = {
    SLOT_COUNT,
    mountAndRestore,
    onSaveDirChanged,
    listSlots,
    uploadSlot,
    downloadSlot,
    deleteSlot,
    forceSync,
    clearSaves,
    getStatus,
    setOnStateChange,
  };
})();
