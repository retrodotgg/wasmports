// Persistent GTA III asset-source configuration.
//
// The OPFS cache works with a local ZIP immediately. If you own/control an
// archive URL and are authorized to distribute it, put that URL in archiveUrl.
// The launcher will download it once, cache the ZIP in OPFS, and reuse it on
// later visits without another network download.
window.GTA3_ASSET_CONFIG = Object.freeze({
  proxyUrl: "https://gta3-assets-proxy.editingking-2977.workers.dev/",
  archiveUrl: "https://drive.usercontent.google.com/download?id=1CI50_lKEVQ22gjl2BdZwjxeJ4J_tJ_vL&export=download&authuser=8&confirm=t&uuid=a361c096-5cd6-4110-b885-f7179149c3bb&at=AMrWOn0-CjE2VosXilWxxD6mBvg8%3A1789910493665",
  autoInstall: false,
  cacheVersion: "gta3-zip-v4",
});
