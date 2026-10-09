// AssetVFS: browser-compatible filesystem abstraction for re3's game-asset root.
//
// re3 itself needs *zero* changes to work with this: the engine already resolves
// every asset path relative to its current working directory (CFileMgr::Initialise
// captures getcwd() once at startup; see src/core/FileMgr.cpp and
// src/skel/crossplatform.cpp's casepath()). So the whole abstraction here is: get
// real files into Emscripten's virtual filesystem under a configurable mount point,
// then FS.chdir() there before main() runs. That's the clean boundary called for in
// docs/BROWSER_RUNTIME.md's Phase 2 section, carried into Phase 3 -- this file knows
// nothing about re3/librw internals, only about Emscripten's FS API and the shape of
// web/asset-manifest.json.
//
// This module never contains, downloads, or ships any GTA III asset data itself. It
// only moves bytes the *user* already has (via a folder picker or their own local
// dev server) into the running module's virtual filesystem.

(() => {
	"use strict";

	const DEFAULT_MOUNT_POINT = "/game";

	// COLFILE <level-number> <path> is the one gta3.dat keyword whose path isn't
	// the first token after the keyword -- keep this in sync with
	// scripts/validate_assets.py's GTA3_DAT_PATH_KEYWORDS/parse_gta3_dat, and with
	// src/core/FileLoader.cpp's LoadLevel() if that ever changes.
	const GTA3_DAT_PATH_KEYWORDS = new Set(["IDE", "IPL", "MODELFILE", "HIERFILE", "TEXDICTION", "CDIMAGE"]);

	function normalize(path) {
		return path.replace(/\\/g, "/").replace(/^\/+/, "");
	}

	function joinPath(mountPoint, relPath) {
		return `${mountPoint.replace(/\/+$/, "")}/${normalize(relPath)}`;
	}

	function shouldSkipImportedFile(relPath) {
		const normalized = normalize(relPath);
		const lower = normalized.toLowerCase();
		const top = lower.split("/")[0];

		// Browser audio is real OpenAL/WebAudio, so the original AUDIO folder is
		// load-bearing and must be imported. Native Windows middleware, movies,
		// and the optional user-MP3 folder remain unnecessary in this build.
		if (top === "mss" || top === "movies" || top === "mp3") return true;

		// WASM deliberately bypasses re3\'s generated TXD cache; importing it only wastes RAM.
		if (lower === "models/txd.img" || lower === "models/txd.dir") return true;

		// The browser port does not execute native Windows binaries/plugins.
		if (/\.(exe|dll|asi|bat|cmd|com)$/i.test(normalized)) return true;

		return false;
	}

	// --- low-level FS helpers ------------------------------------------------

	function ensureMountPoint(FS, mountPoint) {
		try {
			FS.mkdirTree(mountPoint);
		} catch (e) {
			if (e?.errno !== 20 /* EEXIST-ish, Emscripten FS uses its own ERRNO_CODES */) {
				// mkdirTree throws if the leaf already exists as a directory in some
				// versions; only re-throw if it's something else going on.
				if (!(FS.analyzePath(mountPoint).exists)) throw e;
			}
		}
	}

	function writeFileDeep(FS, absPath, data) {
		const dir = absPath.slice(0, absPath.lastIndexOf("/"));
		if (dir) FS.mkdirTree(dir);
		FS.writeFile(absPath, data, { canOwn: true });
	}

	function clearMountPoint(FS, mountPoint) {
		ensureMountPoint(FS, mountPoint);

		function removeTree(absDir) {
			let names = [];
			try {
				names = FS.readdir(absDir);
			} catch {
				return;
			}
			for (const name of names) {
				if (name === "." || name === "..") continue;
				const path = absDir + "/" + name;
				try {
					const st = FS.stat(path);
					if (FS.isDir(st.mode)) {
						removeTree(path);
						FS.rmdir(path);
					} else {
						FS.unlink(path);
					}
				} catch {}
			}
		}

		removeTree(mountPoint);
		return mountPoint;
	}

	// --- mounting strategies ---------------------------------------------------

	/** Bare MEMFS directory at mountPoint, nothing persisted. Always safe, always
	 * available; the baseline every other strategy builds on. */
	function mountEmpty(FS, mountPoint) {
		ensureMountPoint(FS, mountPoint);
		return mountPoint;
	}

	/** Mount IDBFS at mountPoint for persistence across page loads (task 6C).
	 * Must be called before any files are written there. Returns the mount point;
	 * call loadFromIDB() afterwards to pull in whatever was persisted last time. */
	function mountIDBFS(FS, mountPoint) {
		if (!FS.filesystems || !FS.filesystems.IDBFS) {
			throw new Error("IDBFS is not available in this build (missing -lidbfs.js?)");
		}
		ensureMountPoint(FS, mountPoint);
		FS.mount(FS.filesystems.IDBFS, {}, mountPoint);
		return mountPoint;
	}

	function syncfs(FS, populate) {
		return new Promise((resolve, reject) => {
			FS.syncfs(populate, (err) => (err ? reject(err) : resolve()));
		});
	}

	/** Pull persisted files from IndexedDB into the mounted IDBFS directory. */
	function loadFromIDB(FS, _mountPoint) {
		return syncfs(FS, true);
	}

	/** Push the current contents of the mounted IDBFS directory into IndexedDB. */
	function persistToIDB(FS, _mountPoint) {
		return syncfs(FS, false);
	}

	/**
	 * Task 6B: mount from a user-provided asset directory, e.g. the FileList from
	 * <input type="file" webkitdirectory multiple> or a drag-and-drop of a folder.
	 * Each File must carry a relative path (webkitRelativePath, or `.relativePath`
	 * if the caller set one up itself via the File System Access API).
	 *
	 * This is the only place actual GTA III bytes flow through this file, and they
	 * flow from the user's own machine straight into the in-memory/IDBFS-backed
	 * VFS -- never through a server, never persisted anywhere but the user's own
	 * browser storage.
	 */
	async function mountFromFileList(FS, mountPoint, fileList, { onProgress } = {}) {
		ensureMountPoint(FS, mountPoint);
		const allFiles = Array.from(fileList);
		const entries = [];
		let skippedFiles = 0;
		let skippedBytes = 0;

		for (const file of allFiles) {
			const rel = file.relativePath || file.webkitRelativePath || file.name;
			const trimmed = rel.includes("/") ? rel.slice(rel.indexOf("/") + 1) : rel;
			if (!trimmed) continue;
			if (shouldSkipImportedFile(trimmed)) {
				skippedFiles++;
				skippedBytes += file.size || 0;
				continue;
			}
			entries.push({ file, trimmed });
		}

		const totalBytes = entries.reduce((sum, entry) => sum + (entry.file.size || 0), 0);
		let done = 0;
		let doneBytes = 0;

		onProgress?.(0, entries.length, "", 0, totalBytes, "filtered", {
			skippedFiles,
			skippedBytes,
			originalFiles: allFiles.length,
		});

		for (const { file, trimmed } of entries) {

			// Report the file before reading it so a very large IMG/TXD does not
			// look like a frozen browser while File.arrayBuffer() is working.
			onProgress?.(done, entries.length, trimmed, doneBytes, totalBytes, "reading");

			const buf = new Uint8Array(await file.arrayBuffer());
			writeFileDeep(FS, joinPath(mountPoint, trimmed), buf);

			done++;
			doneBytes += file.size || buf.byteLength;
			onProgress?.(done, entries.length, trimmed, doneBytes, totalBytes, "written");

			// Give layout/paint/input a chance to run while importing a large GTA
			// installation. File reads are async, but a sequence of FS.writeFile()
			// calls can still monopolize the main thread on fast local storage.
			if (done % 8 === 0) {
				await new Promise((resolve) => setTimeout(resolve, 0));
			}
		}
		return done;
	}

	/**
	 * Import a ZIP selected by the user and stream its contents directly into
	 * Emscripten MEMFS. The compressed archive is read in chunks and is not
	 * uploaded or persisted by the site. Large extracted assets still consume
	 * browser RAM because MEMFS is the engine's runtime filesystem.
	 *
	 * Requires the fflate UMD bundle to be loaded before vfs.js.
	 */
	async function mountFromZipFile(FS, mountPoint, zipFile, { onProgress } = {}) {
		if (!zipFile) throw new Error("No ZIP file selected.");
		if (!window.fflate?.Unzip || !window.fflate?.UnzipInflate) {
			throw new Error("ZIP support did not load. Check the fflate script/network connection and reload the page.");
		}

		ensureMountPoint(FS, mountPoint);

		const gtaTopLevelDirs = new Set([
			"anim", "audio", "data", "models", "movies", "mp3", "mss", "text"
		]);

		function safeRelativePath(rawName) {
			const parts = normalize(rawName).split("/").filter((part) => part && part !== ".");
			if (!parts.length || parts.some((part) => part === "..")) return null;

			// GTA III archives in the wild are often wrapped more than once, e.g.
			// "gta3-assets/GTA III/models/gta3.img". Find the first real game
			// top-level directory instead of stripping exactly one wrapper folder.
			const gameRootIndex = parts.findIndex((part) => gtaTopLevelDirs.has(part.toLowerCase()));
			if (gameRootIndex >= 0) {
				return parts.slice(gameRootIndex).join("/");
			}

			// Keep legacy behavior for non-game-root files such as gta3.ini/readmes:
			// strip one obvious wrapper directory but never manufacture a path.
			if (parts.length > 1) parts.shift();
			return parts.join("/");
		}

		let filesDone = 0;
		let extractedBytes = 0;
		let skippedFiles = 0;
		let compressedRead = 0;
		let inputFinished = false;
		let settled = false;
		const activeEntries = new Set();

		let resolveComplete;
		let rejectComplete;
		const complete = new Promise((resolve, reject) => {
			resolveComplete = resolve;
			rejectComplete = reject;
		});

		function fail(err) {
			if (settled) return;
			settled = true;
			rejectComplete(err instanceof Error ? err : new Error(String(err)));
		}

		function maybeFinish() {
			if (!settled && inputFinished && activeEntries.size === 0) {
				settled = true;
				resolveComplete(filesDone);
			}
		}

		const unzipper = new window.fflate.Unzip((entry) => {
			activeEntries.add(entry);

			const rel = safeRelativePath(entry.name);
			const isDirectory = entry.name.endsWith("/");
			const skip = !rel || isDirectory || shouldSkipImportedFile(rel);
			let stream = null;
			let entryBytes = 0;

			if (!skip) {
				const absPath = joinPath(mountPoint, rel);
				const dir = absPath.slice(0, absPath.lastIndexOf("/"));
				if (dir) FS.mkdirTree(dir);
				stream = FS.open(absPath, "w");
			} else if (!isDirectory) {
				skippedFiles++;
			}

			entry.ondata = (err, chunk, final) => {
				if (err) {
					if (stream) {
						try { FS.close(stream); } catch {}
					}
					activeEntries.delete(entry);
					fail(err);
					return;
				}

				try {
					if (!skip && chunk?.length) {
						FS.write(stream, chunk, 0, chunk.length);
						entryBytes += chunk.length;
						extractedBytes += chunk.length;
					}

					onProgress?.({
						phase: skip ? "skipping" : "extracting",
						currentFile: rel || entry.name,
						filesDone,
						extractedBytes,
						compressedRead,
						compressedTotal: zipFile.size || 0,
						entryBytes,
						skippedFiles,
					});

					if (final) {
						if (stream) FS.close(stream);
						if (!skip) filesDone++;
						activeEntries.delete(entry);
						maybeFinish();
					}
				} catch (writeErr) {
					if (stream) {
						try { FS.close(stream); } catch {}
					}
					activeEntries.delete(entry);
					fail(writeErr);
				}
			};

			try {
				entry.start();
			} catch (err) {
				activeEntries.delete(entry);
				fail(err);
			}
		});

		unzipper.register(window.fflate.UnzipInflate);

		try {
			const reader = zipFile.stream().getReader();
			while (true) {
				const { value, done } = await reader.read();
				if (done) break;
				if (settled) break;

				const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
				compressedRead += chunk.byteLength;
				unzipper.push(chunk, false);

				onProgress?.({
					phase: "reading-archive",
					currentFile: "",
					filesDone,
					extractedBytes,
					compressedRead,
					compressedTotal: zipFile.size || 0,
					entryBytes: 0,
					skippedFiles,
				});

				// Yield occasionally so progress/UI paint is not starved.
				await new Promise((resolve) => setTimeout(resolve, 0));
			}

			if (!settled) unzipper.push(new Uint8Array(0), true);
			inputFinished = true;
			maybeFinish();
		} catch (err) {
			fail(err);
		}

		return complete;
	}

	/**
	 * Task 8: development-only asset mounting. Fetches a file listing + raw bytes
	 * from the *local dev server* (scripts/serve_web.py --dev-assets <dir>), never
	 * from anywhere else. This code path only runs when explicitly requested (see
	 * launcher.js: the ?devAssets=1 query flag), and scripts/serve_web.py refuses
	 * to serve --dev-assets at all unless you pass that flag on the command line
	 * too -- so there are two separate opt-ins before any local game files ever
	 * touch the network, and even then only to localhost. Nothing under this path
	 * is reachable in a normal (non-dev) run of the page, and web/build/ (the
	 * copied build output) never contains asset bytes.
	 */
	async function mountFromDevServer(FS, mountPoint, { baseUrl = "/__dev_assets", onProgress } = {}) {
		const listResp = await fetch(`${baseUrl}/manifest.json`);
		if (!listResp.ok) {
			throw new Error(
				`Dev asset server did not respond at ${baseUrl}/manifest.json (${listResp.status}). ` +
				`Is scripts/serve_web.py running with --dev-assets <path-to-your-gamefiles>?`
			);
		}
		const files = await listResp.json(); // array of relative paths
		ensureMountPoint(FS, mountPoint);
		let done = 0;
		for (const rel of files) {
			const resp = await fetch(`${baseUrl}/file/${rel.split("/").map(encodeURIComponent).join("/")}`);
			if (!resp.ok) throw new Error(`Failed to fetch dev asset "${rel}": HTTP ${resp.status}`);
			const buf = new Uint8Array(await resp.arrayBuffer());
			writeFileDeep(FS, joinPath(mountPoint, rel), buf);
			done++;
			onProgress?.(done, files.length, rel);
		}
		return done;
	}

	/**
	 * Task 7: packaged filesystem. Loads a pre-built manifest (array of relative
	 * paths) + fetches each file from `baseUrl` (relative to the page), for a
	 * "package once, mount every load" flow -- e.g. assets copied into
	 * web/build/package/ by a separate, explicit packaging step (never part of the
	 * default `cmake --build` -- see docs/GAME_ASSETS.md). Structurally identical
	 * to mountFromDevServer, kept separate because its intent (a prepared package
	 * vs. a developer's live local folder) and trust boundary are different.
	 */
	async function mountFromPackage(FS, mountPoint, { baseUrl = "build/package", onProgress } = {}) {
		const listResp = await fetch(`${baseUrl}/manifest.json`);
		if (!listResp.ok) {
			throw new Error(`No packaged asset manifest at ${baseUrl}/manifest.json (HTTP ${listResp.status})`);
		}
		const files = await listResp.json();
		ensureMountPoint(FS, mountPoint);
		let done = 0;
		for (const rel of files) {
			const resp = await fetch(`${baseUrl}/${rel.split("/").map(encodeURIComponent).join("/")}`);
			if (!resp.ok) throw new Error(`Failed to fetch packaged asset "${rel}": HTTP ${resp.status}`);
			const buf = new Uint8Array(await resp.arrayBuffer());
			writeFileDeep(FS, joinPath(mountPoint, rel), buf);
			done++;
			onProgress?.(done, files.length, rel);
		}
		return done;
	}

	/** Point the engine's cwd at the mounted asset root. Call this once, after
	 * mounting/populating is complete, before instance.callMain(). */
	function chdirToRoot(FS, mountPoint) {
		FS.chdir(mountPoint);
	}

	// --- validation (tasks 9 & 10, browser-side counterpart to
	// scripts/validate_assets.py) --------------------------------------------

	function readTextFile(FS, absPath) {
		try {
			return FS.readFile(absPath, { encoding: "utf8" });
		} catch {
			return null;
		}
	}

	/**
	 * re3 resolves paths case-insensitively at runtime (casepath() in
	 * src/skel/crossplatform.cpp does a manual, case-insensitive directory scan),
	 * but Emscripten's MEMFS/IDBFS are plain case-sensitive filesystems. A GTA III
	 * install's on-disk casing varies (installers, mixed-case CD dumps, etc.), and
	 * the manifest/gta3.dat paths are written in whatever case the original Windows
	 * game files used -- so a naive case-sensitive FS.analyzePath() check produces
	 * false "missing" reports for files that are actually there and that the engine
	 * would find just fine. Build a lowercased-path index once (same approach as
	 * scripts/validate_assets.py's build_case_insensitive_index) and validate
	 * against that instead, mapping back to the real on-disk relative path so
	 * callers (e.g. reading data/gta3.dat itself) can open the file that's
	 * actually there.
	 */
	function buildCaseInsensitiveIndex(FS, mountPoint) {
		const index = new Map(); // lowercased relative path -> real relative path
		function walk(absDir, relDir) {
			let entries;
			try {
				entries = FS.readdir(absDir);
			} catch {
				return;
			}
			for (const name of entries) {
				if (name === "." || name === "..") continue;
				const absPath = `${absDir}/${name}`;
				const relPath = relDir ? `${relDir}/${name}` : name;
				index.set(relPath.toLowerCase(), relPath);
				let st;
				try {
					st = FS.stat(absPath);
				} catch {
					continue;
				}
				if (FS.isDir(st.mode)) walk(absPath, relPath);
			}
		}
		walk(mountPoint, "");
		return index;
	}

	/** Returns the real on-disk relative path for a case-insensitive match, or null. */
	function resolveCI(index, relPath) {
		return index.get(normalize(relPath).toLowerCase()) ?? null;
	}

	/** Mirrors scripts/validate_assets.py's parse_gta3_dat(). */
	function parseLevelDat(text) {
		const paths = [];
		for (let line of text.split("\n")) {
			line = line.trim();
			if (!line || line.startsWith("#")) continue;
			const firstSpace = line.search(/\s/);
			if (firstSpace === -1) continue;
			const keyword = line.slice(0, firstSpace).toUpperCase();
			const rest = line.slice(firstSpace + 1).trim();
			if (keyword === "COLFILE") {
				const fields = rest.split(/\s+/);
				if (fields.length >= 2) paths.push(normalize(fields[1]));
			} else if (GTA3_DAT_PATH_KEYWORDS.has(keyword)) {
				paths.push(normalize(rest.split(/\s+/)[0]));
			}
		}
		return paths;
	}

	/**
	 * Checks the manifest's required/optional game assets (and, if data/gta3.dat
	 * is present under mountPoint, every path it references) against what's
	 * actually mounted. Returns missing paths as "Missing game asset: <path>"
	 * strings -- the same phrasing scripts/validate_assets.py uses -- ready to
	 * hand straight to the log panel, never a bare "File failed".
	 */
	function validate(FS, mountPoint, manifest) {
		const result = {
			missingRequired: [],
			emptyRequired: [],
			missingOptional: [],
			presentRequired: [],
			presentOptional: [],
			defaultDatChecked: false,
			gta3DatChecked: false,
			missingFromDefaultDat: [],
			missingFromGta3Dat: [],
			formatIssues: [],
		};

		const index = buildCaseInsensitiveIndex(FS, mountPoint);

		function validNonEmptyFile(relPath) {
			const real = resolveCI(index, relPath);
			if (!real) return false;
			try {
				const st = FS.stat(joinPath(mountPoint, real));
				return !FS.isDir(st.mode) && Number(st.size) > 0;
			} catch {
				return false;
			}
		}

		for (const entry of manifest.gameAssets.required) {
			if (!resolveCI(index, entry.path)) result.missingRequired.push(entry.path);
			else if (!validNonEmptyFile(entry.path)) result.emptyRequired.push(entry.path);
			else result.presentRequired.push(entry.path);
		}
		for (const entry of manifest.gameAssets.optional) {
			(resolveCI(index, entry.path) ? result.presentOptional : result.missingOptional).push(entry.path);
		}

		function checkLevelDat(sourcePath, checkedKey, missingKey) {
			const real = resolveCI(index, sourcePath);
			const text = real ? readTextFile(FS, joinPath(mountPoint, real)) : null;
			if (text == null) return;
			result[checkedKey] = true;
			const missing = new Set();
			for (const path of parseLevelDat(text)) if (!validNonEmptyFile(path)) missing.add(path);
			result[missingKey] = [...missing];
		}

		checkLevelDat("data/default.dat", "defaultDatChecked", "missingFromDefaultDat");
		checkLevelDat("data/gta3.dat", "gta3DatChecked", "missingFromGta3Dat");

		function checkArchivePair() {
			const dirReal = resolveCI(index, "models/gta3.dir");
			const imgReal = resolveCI(index, "models/gta3.img");
			if (!dirReal || !imgReal) return;
			try {
				const dir = FS.readFile(joinPath(mountPoint, dirReal));
				const imgSize = Number(FS.stat(joinPath(mountPoint, imgReal)).size);
				if (dir.byteLength < 32 || dir.byteLength % 32 !== 0) {
					result.formatIssues.push("models/gta3.dir has an invalid directory-table size");
					return;
				}
				const view = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
				let populated = 0;
				for (let off = 0; off < dir.byteLength; off += 32) {
					const sector = view.getUint32(off, true);
					const sectors = view.getUint32(off + 4, true);
					if (sectors === 0) continue;
					populated++;
					const endByte = (sector + sectors) * 2048;
					if (!Number.isSafeInteger(endByte) || endByte > imgSize) {
						result.formatIssues.push(`models/gta3.dir entry ${populated} points beyond models/gta3.img`);
						return;
					}
				}
				if (populated < 10) result.formatIssues.push("models/gta3.dir contains too few usable entries");
			} catch (err) {
				result.formatIssues.push(`Could not validate gta3.dir/gta3.img pair: ${err}`);
			}
		}

		function checkPedIfpSignature() {
			const real = resolveCI(index, "anim/ped.ifp");
			if (!real) return;
			let stream = null;
			try {
				stream = FS.open(joinPath(mountPoint, real), "r");
				const header = new Uint8Array(4);
				const count = FS.read(stream, header, 0, 4, 0);
				const sig = count === 4 ? String.fromCharCode(...header) : "";
				if (sig !== "ANLF" && sig !== "ANPK") {
					result.formatIssues.push(`anim/ped.ifp has unsupported header "${sig || "empty"}"`);
				}
			} catch (err) {
				result.formatIssues.push(`Could not inspect anim/ped.ifp: ${err}`);
			} finally {
				if (stream) try { FS.close(stream); } catch {}
			}
		}

		checkArchivePair();
		checkPedIfpSignature();

		result.ok = result.missingRequired.length === 0 &&
			result.emptyRequired.length === 0 &&
			result.missingFromDefaultDat.length === 0 &&
			result.missingFromGta3Dat.length === 0 &&
			result.formatIssues.length === 0;

		result.messages = [...new Set([
			...result.missingRequired.map((p) => `Missing game asset: ${p}`),
			...result.emptyRequired.map((p) => `Invalid game asset: ${p} is empty or unreadable`),
			...result.missingFromDefaultDat.map((p) => `Missing game asset: ${p} (referenced by data/default.dat)`),
			...result.missingFromGta3Dat.map((p) => `Missing game asset: ${p} (referenced by data/gta3.dat)`),
			...result.formatIssues.map((p) => `Invalid/incompatible game data: ${p}`),
		])];
		return result;
	}

	window.AssetVFS = {
		DEFAULT_MOUNT_POINT,
		mountEmpty,
		mountIDBFS,
		loadFromIDB,
		persistToIDB,
		mountFromFileList,
		mountFromZipFile,
		clearMountPoint,
		mountFromDevServer,
		mountFromPackage,
		chdirToRoot,
		validate,
	};
})();
