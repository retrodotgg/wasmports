(() => {
  "use strict";

  const overlay = document.getElementById("save-manager-overlay");
  const openBtn = document.getElementById("save-manager-btn");
  const homeOpenBtn = document.getElementById("home-save-manager-btn");
  const closeBtn = document.getElementById("save-manager-close");
  const list = document.getElementById("save-manager-list");
  const status = document.getElementById("save-manager-status");
  const input = document.getElementById("save-upload-input");

  if (!overlay || !openBtn || !closeBtn || !list || !status || !input) return;

  let uploadTarget = null;
  let scanSlot = null;
  let loadSlot = null;
  let getGameState = null;

  function fmt(bytes) {
    if (!bytes) return "0 KB";
    return `${(bytes / 1024).toFixed(bytes >= 102400 ? 0 : 1)} KB`;
  }

  function ensureEngineFns() {
    const m = window.re3Module;
    if (!m?.cwrap) return;
    try { scanSlot ||= m.cwrap("re3_DebugScanSlot", "number", ["number"]); } catch {}
    try { loadSlot ||= m.cwrap("re3_BrowserLoadSlot", "number", ["number"]); } catch {}
    try { getGameState ||= m.cwrap("re3_GetGameState", "number", []); } catch {}
  }

  function nativeStatus(slot, exists) {
    if (!exists) return { label: "EMPTY", cls: "empty", valid: false };
    ensureEngineFns();
    try {
      const gs = getGameState ? getGameState() : -1;
      if (scanSlot && gs >= 7) {
        const code = scanSlot(slot);
        if (code === 0) return { label: "VALID SAVE", cls: "valid", valid: true };
        if (code === 2) return { label: "CORRUPT", cls: "corrupt", valid: false };
        return { label: "EMPTY", cls: "empty", valid: false };
      }
    } catch {}
    return { label: "PRESENT", cls: "present", valid: true };
  }

  async function refresh() {
    const s = window.Re3Saves?.getStatus?.();
    if (!s?.ready) {
      status.textContent = "Save storage is preparing. Start the game first.";
      list.innerHTML = "";
      return;
    }

    status.textContent = `Storage: ${s.backend} • ${s.slotCount} GTA III slots`;
    const slots = window.Re3Saves.listSlots();
    list.innerHTML = "";

    for (const item of slots) {
      const ns = nativeStatus(item.slot, item.exists);
      const row = document.createElement("div");
      row.className = "save-slot-row";
      row.innerHTML = `
        <div class="save-slot-main">
          <span class="save-slot-number">SLOT ${item.number}</span>
          <strong>${item.name}</strong>
          <small>${item.exists ? fmt(item.size) : "No save file"}</small>
        </div>
        <span class="save-slot-state ${ns.cls}">${ns.label}</span>
        <div class="save-slot-actions">
          <button type="button" data-action="load" data-slot="${item.slot}" ${!item.exists || !ns.valid ? "disabled" : ""}>LOAD</button>
          <button type="button" data-action="download" data-slot="${item.slot}" ${!item.exists ? "disabled" : ""}>DOWNLOAD</button>
          <button type="button" data-action="upload" data-slot="${item.slot}">UPLOAD &amp; LOAD</button>
          <button type="button" class="danger" data-action="delete" data-slot="${item.slot}" ${!item.exists ? "disabled" : ""}>DELETE</button>
        </div>`;
      list.appendChild(row);
    }
  }

  function closeManager() {
    overlay.classList.add("hidden");
  }

  function triggerLoad(slot) {
    ensureEngineFns();
    const gs = getGameState ? getGameState() : -1;
    if (gs < 7) throw new Error("GTA III is still starting. The save is imported; load it when the main menu is ready.");
    if (!loadSlot) throw new Error("Game engine load function is not ready yet.");
    const result = loadSlot(slot);
    if (result !== 1) {
      if (result === -2) throw new Error("This slot is not a valid GTA III save.");
      throw new Error(`Could not load slot ${slot + 1} (code ${result}).`);
    }
    status.textContent = `Loading slot ${slot + 1}…`;
    closeManager();
  }

  async function openManager() {
    document.exitPointerLock?.();
    overlay.classList.remove("hidden");
    await refresh();
  }

  openBtn.addEventListener("click", openManager);
  homeOpenBtn?.addEventListener("click", openManager);

  closeBtn.addEventListener("click", closeManager);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeManager();
  });

  list.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const slot = Number(btn.dataset.slot);
    const action = btn.dataset.action;

    try {
      if (action === "download") {
        window.Re3Saves.downloadSlot(slot);
      } else if (action === "upload") {
        uploadTarget = slot;
        input.value = "";
        input.click();
      } else if (action === "load") {
        triggerLoad(slot);
      } else if (action === "delete") {
        if (!confirm(`Delete GTA III save slot ${slot + 1}?`)) return;
        status.textContent = `Deleting slot ${slot + 1}…`;
        await window.Re3Saves.deleteSlot(slot);
        await refresh();
      }
    } catch (err) {
      status.textContent = String(err?.message || err);
    }
  });

  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    const slot = uploadTarget;
    uploadTarget = null;
    if (!file || slot == null) return;

    try {
      status.textContent = `Uploading ${file.name} to slot ${slot + 1}…`;
      await window.Re3Saves.uploadSlot(slot, file);
      await refresh();

      ensureEngineFns();
      const gs = getGameState ? getGameState() : -1;
      if (gs < 7) {
        status.textContent = `Slot ${slot + 1} imported and saved. GTA III is still starting; press LOAD when the main menu is ready.`;
        return;
      }

      if (scanSlot) {
        const code = scanSlot(slot);
        if (code !== 0) {
          status.textContent = code === 2
            ? "Upload finished, but GTA III reports this save as corrupt/incompatible."
            : "Upload finished, but the slot is not loadable.";
          return;
        }
      }

      status.textContent = `Slot ${slot + 1} imported. Loading game…`;
      triggerLoad(slot);
    } catch (err) {
      status.textContent = String(err?.message || err);
      await refresh();
    }
  });

  window.addEventListener("gta3-saves-change", () => {
    if (!overlay.classList.contains("hidden")) refresh();
  });
})();
