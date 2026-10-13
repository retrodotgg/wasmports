import * as store from './host.js?v=b3e0ad12bba2';
import * as net from './net.js?v=b3e0ad12bba2';
import { createFrontend } from './frontend.js?v=b3e0ad12bba2';
import { installTouchControls, touchPad } from './touch.js?v=b3e0ad12bba2';

// `?v=<build>` that the release build stamps on this script's URL; empty in
// development.
const BUILD = new URL(import.meta.url).search;

const $ = (id) => document.getElementById(id);
let frontend = null;
const params = new URLSearchParams(location.search);

const loading = $('loading');
const fill = $('load-fill');
const loadLabel = $('load-label');

// The loading screen stays up from the moment Play is pressed until the engine
// reports a frame drawn, so the wait never looks like a black page.
// Once the game is on screen the engine shows its own loading screen (Skate
// 3's, with Coach Frank's tips) for worlds it loads; the page's card stays down.
const gameShown = () => document.body.classList.contains('in-game');

function showStage(label) {
  if (gameShown()) return;
  loading.hidden = false;
  fill.classList.add('indeterminate');
  loadLabel.textContent = label;
}

function showProgress(fraction, label) {
  if (gameShown()) return;
  loading.hidden = false;
  fill.classList.remove('indeterminate');
  fill.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
  loadLabel.textContent = label;
}

// --- What the load is doing, step by step ----------------------------------
//
// Each step shows its state and progress; a step that stops moving says why
// that usually happens and offers a retry (saved downloads make it quick).
const STEPS = [
  ['server', 'Connecting'],
  ['data', 'Game data'],
  ['engine', 'Engine'],
  ['start', 'Starting the engine'],
];
// Seconds without any change before a step is called stuck.
const STUCK = { server: 15, data: 25, engine: 25, start: 60 };
const steps = new Map();
const MB = (bytes) => (bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0);
let dataHost = '';

function resetSteps() {
  steps.clear();
  for (const [id, name] of STEPS) steps.set(id, { name, state: 'wait', detail: '', changed: performance.now(), rate: null });
  renderSteps();
}

function step(id, state, detail = '') {
  const entry = steps.get(id);
  if (!entry) return;
  if (entry.state === 'done' && state !== 'done') return;
  if (entry.state !== state || entry.detail !== detail) entry.changed = performance.now();
  if (state === 'active' && entry.state === 'wait') {
    entry.began = performance.now();
    // Steps run in order: whatever came before has finished.
    for (const [other, earlier] of steps) {
      if (other === id) break;
      if (earlier.state !== 'done') { earlier.state = 'done'; earlier.detail = ''; }
    }
  }
  entry.state = state;
  entry.detail = detail;
  renderSteps();
}

// Bytes so far of a download step, with its speed over the last few seconds.
function stepBytes(id, done, total) {
  const entry = steps.get(id);
  if (!entry || entry.state === 'done') return;
  const now = performance.now();
  const rate = entry.rate || (entry.rate = { at: now, done });
  let speed = '';
  if (now - rate.at > 1500) {
    rate.speed = (done - rate.done) / ((now - rate.at) / 1000);
    rate.at = now;
    rate.done = done;
  }
  if (rate.speed > 0) speed = ` · ${MB(rate.speed)} MB/s`;
  step(id, 'active', total ? `${MB(done)} of ${MB(total)} MB${speed}` : `${MB(done)} MB${speed}`);
  // Bytes arriving count as movement even when the text stays the same.
  entry.changed = now;
}

function renderSteps() {
  const list = $('load-steps');
  if (!list) return;
  list.replaceChildren(...[...steps].map(([id, { name, state, detail, began }]) => {
    // Starting has no bytes to count: the time so far shows it is alive.
    if (id === 'start' && state !== 'wait' && state !== 'done' && began) {
      detail = `${detail}${detail ? ' · ' : ''}${Math.round((performance.now() - began) / 1000)}s`;
    }
    const item = document.createElement('li');
    item.className = state;
    const mark = document.createElement('span');
    mark.className = 'mark';
    mark.textContent = { wait: '○', active: '▸', done: '✓', warn: '!' }[state];
    const label = document.createElement('span');
    label.className = 'name';
    label.textContent = name;
    const info = document.createElement('span');
    info.className = 'detail';
    info.textContent = detail;
    item.append(mark, label, info);
    return item;
  }));
}

// Why a step usually stops, in words a player can act on.
function stuckHelp(id, seconds) {
  const host = dataHost || 'the game data host';
  const error = store.transfer.lastError ? ` (last error: ${store.transfer.lastError})` : '';
  switch (id) {
    case 'server':
      return `Still connecting after ${seconds}s. Check your internet connection. School and work networks often block game sites; a different network or a phone hotspot usually works.`;
    case 'data':
    case 'engine':
      return `Nothing has downloaded for ${seconds}s from ${host}${error}. It keeps retrying on its own. If it stays stuck, your network may be blocking ${host} (common on school and work networks).`;
    default:
      return `Still starting after ${seconds}s. Slower computers (Chromebooks, phones) can take a few minutes here. If nothing changes, close other tabs and press Retry.`;
  }
}

let stuckTimer = 0;
function watchSteps() {
  if (stuckTimer) return;
  stuckTimer = setInterval(() => {
    if (loading.hidden) return;
    const help = $('load-help');
    const now = performance.now();
    let message = '';
    for (const [id, entry] of steps) {
      if (entry.state !== 'active' && entry.state !== 'warn') continue;
      const seconds = Math.round((now - entry.changed) / 1000);
      // Downloads in flight anywhere keep a waiting step alive.
      const moving = (id === 'data' || id === 'engine') && now - store.transfer.lastAt < 3000;
      const stuck = !moving && seconds >= STUCK[id];
      if (stuck) {
        entry.state = 'warn';
        message = stuckHelp(id, seconds);
      } else if (entry.state === 'warn') {
        entry.state = 'active';
      }
    }
    renderSteps();
    help.hidden = !message;
    $('load-help-text').textContent = message;
  }, 1000);
}
$('load-retry').addEventListener('click', () => location.reload());

function fail(message, heading) {
  loading.hidden = true;
  document.body.classList.remove('in-game');
  stopTips();
  console.error(message);
  if (frontend) frontend.fail(message, heading);
}

// The engine resizes its canvas to the window as soon as it starts presenting
// frames, so that doubles as "the game is up" if the engine's own ready() never
// arrives — and any input then dismisses the screen, so a stuck overlay can
// never make the game's menus unclickable.
const engineRunning = () => {
  const canvas = $('skate-canvas');
  return canvas.width > 320 && canvas.height > 240;
};

let watchdog = 0;

// Tips cycle on the loading screen, as they do between skate. 3's loads.
const TIPS = [
  'Pull the right stick back, then flick it forward to ollie. Flick it the other way for a nollie.',
  'Flick the right stick off to a side on the way up to kickflip or heelflip.',
  'Hold a bumper in the air to grab: left bumper is your left hand, right bumper your right.',
  'Pushing harder means more speed, and more speed means bigger gaps. Push with A (Space on keyboard).',
  'No controller? WASD steers and the arrow keys are your right stick. Flick them like a thumbstick.',
  'Press Start (Esc) and go to ONLINE to host a session, or join a friend with their code.',
  'Port Carverton is big. Choose World in the Freeskate menu to go somewhere else.',
  'Bailing is part of skating. Hardcore difficulty makes every landing count.',
  'Land on your bolts. Keep the board level before you touch down.',
  'Ollie into a rail or ledge and hold the stick to keep the grind going.',
  'This is a fan game, not an EA release. Questions or bugs: root@aaddpp.lol',
];
const tipBox = $('load-tip');
let tipTimer = 0;
let tipIndex = Math.floor(Math.random() * TIPS.length);

function nextTip() {
  tipBox.classList.add('out');
  setTimeout(() => {
    tipIndex = (tipIndex + 1) % TIPS.length;
    tipBox.textContent = TIPS[tipIndex];
    tipBox.classList.remove('out');
  }, 350);
}

function startTips() {
  tipBox.textContent = TIPS[tipIndex];
  if (!tipTimer) tipTimer = setInterval(nextTip, 7000);
}

function stopTips() {
  if (tipTimer) clearInterval(tipTimer);
  tipTimer = 0;
}

function revealGame() {
  loading.hidden = true;
  document.body.classList.add('in-game');
  stopTips();
  if (watchdog) {
    clearInterval(watchdog);
    watchdog = 0;
  }
}

function watchForGame() {
  if (!watchdog) watchdog = setInterval(() => { if (engineRunning()) revealGame(); }, 500);
}

const dismissLoading = () => { if (engineRunning()) revealGame(); };
window.addEventListener('keydown', dismissLoading, true);
window.addEventListener('pointerdown', dismissLoading, true);

// A trap inside the engine escapes the wasm call it happened in, so nothing in
// this file gets to hear about it and the loading screen would sit there for
// ever. Surface it instead, while the load is still what the screen is for.
// A Rust panic is printed through console.error (console_error_panic_hook) and
// only then traps, so the trap that reaches the error event says "unreachable"
// whatever went wrong. Keep the panic text so the real cause is what gets shown.
let panicText = '';
const consoleError = console.error.bind(console);
console.error = (...args) => {
  const text = args.map(String).join(' ');
  if (!panicText && /panicked at/.test(text)) panicText = text.split('\n\nStack:')[0].trim();
  consoleError(...args);
};

function engineFailure(event) {
  const message = (event && (event.message || (event.reason && event.reason.message))) || '';
  if (!message || loading.hidden) return;
  let cause = '';
  // No GPU at all: almost always the browser running without hardware
  // acceleration (the setting is on by default but often switched off).
  if (/Unable to find a GPU/i.test(panicText || message)) {
    fail('Your browser did not give the game a GPU. Turn on hardware acceleration, then fully restart the browser and reload this page.\n\n' +
      '  • Chrome / Brave / Edge: Settings > System > "Use graphics acceleration when available" (Brave: "Use hardware acceleration when available"), then Relaunch.\n' +
      '  • Firefox: Settings > General > Performance > untick "Use recommended performance settings", tick "Use hardware acceleration when available".\n' +
      '  • Opera: Settings > System > "Use hardware acceleration when available".\n\n' +
      'Still failing? Update your graphics drivers, and check chrome://gpu (or edge://gpu) shows WebGPU as hardware accelerated.\n\n' +
      (panicText || message), 'TURN ON HARDWARE ACCELERATION');
    return;
  }
  if (/CreateSurfaceError|FailedToCreateSurface|requestAdapter|No suitable (GPU )?adapter/i.test(panicText)) {
    cause = `\n\nThe browser would not give the engine a WebGPU canvas. ${webgpuProblem() || 'Check that hardware acceleration is on and the browser supports WebGPU.'}`;
  } else if (!panicText && /unreachable|out of memory/i.test(message)) {
    // An allocation failure aborts with a bare trap and no panic text.
    cause = '\n\nThis is usually the engine running out of WebAssembly memory (4 GB at most) while building a large map.';
  }
  fail(`The engine stopped while loading. Reload and try again.${cause}\n\n${panicText || message}`);
}

// Browsers expose WebGPU only to secure contexts: https, or localhost on the
// machine itself. Opening the server by its LAN address over plain http hides
// navigator.gpu even in a browser that supports it.
function webgpuProblem() {
  if (!window.isSecureContext) {
    return `WebGPU only works over https or on localhost, and this page was opened as ${location.origin}. ` +
      `On this machine, open Chrome/Edge/Brave at chrome://flags/#unsafely-treat-insecure-origin-as-secure, ` +
      `add ${location.origin}, enable it, relaunch the browser and reload this page.`;
  }
  if (!navigator.gpu) {
    return 'WebGPU is not available in this browser. Use a current Chrome, Edge or Brave, and check that hardware acceleration is on.';
  }
  return '';
}
window.addEventListener('error', engineFailure);
window.addEventListener('unhandledrejection', engineFailure);

// Keyboard-as-controller (slot 0 when no gamepad is connected). Values are the
// raw XInput integers: buttons bitmask, LT, RT, LX, LY, RX, RY (Y up positive).
const KEY_BUTTONS = {
  Space: 0x1000, KeyE: 0x2000, KeyQ: 0x4000, KeyR: 0x8000, KeyZ: 0x0100, KeyX: 0x0200,
  Escape: 0x0010, Tab: 0x0020, KeyV: 0x0040, KeyB: 0x0080,
  KeyI: 0x0001, KeyK: 0x0002, KeyJ: 0x0004, KeyL: 0x0008,
};
const MAPPED_KEYS = new Set([
  ...Object.keys(KEY_BUTTONS), 'ShiftLeft', 'ShiftRight', 'KeyC', 'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
]);
const held = new Set();
// While the in-game chat box is open, keys are text, not the controller.
let typing = false;
function setTyping(value) {
  typing = Boolean(value);
  held.clear();
}
window.addEventListener('keydown', (event) => {
  if (typing || !MAPPED_KEYS.has(event.code) || !$('panel').classList.contains('hidden')) return;
  held.add(event.code);
  event.preventDefault();
});
window.addEventListener('keyup', (event) => held.delete(event.code));
// F1 / F2 vote yes / no in a multiplayer kick vote (as in CS:GO): keep the
// browser's own F1 help and F2 actions from taking them while in game.
window.addEventListener('keydown', (event) => {
  if ((event.code === 'F1' || event.code === 'F2') && $('panel').classList.contains('hidden')) event.preventDefault();
});
window.addEventListener('blur', () => held.clear());
// Trackpad Mode (pause menu > PLAYER): pointer movement is the right stick.
// Movement pushes a virtual stick that springs back to centre when the pointer
// stops, so a quick down-then-up stroke reads as the pull-back-and-flick the
// game's Flick It gestures expect. The level is the sensitivity (stick per
// pixel); the engine sends it, and whether play has the input, through
// skateHost.setTrackpad.
const TRACKPAD_GAIN = [0, 1 / 90, 1 / 55, 1 / 32];
const TRACKPAD_RETURN_MS = 75;
const trackpad = { level: 0, playing: false, x: 0, y: 0, at: performance.now() };
function setTrackpad(level, playing) {
  trackpad.level = Math.max(0, Math.min(3, level | 0));
  trackpad.playing = Boolean(playing);
  // The Discord button shows in game only while paused.
  document.body.classList.toggle('paused', !trackpad.playing);
  trackpad.x = trackpad.y = 0;
  // Menus need the pointer back; an off setting never holds it.
  if ((!trackpad.level || !trackpad.playing) && document.pointerLockElement) document.exitPointerLock();
}
window.addEventListener('pointermove', (event) => {
  if (!trackpad.level || !trackpad.playing || !$('panel').classList.contains('hidden')) return;
  const gain = TRACKPAD_GAIN[trackpad.level];
  trackpad.x += event.movementX * gain;
  trackpad.y -= event.movementY * gain; // pointer down = stick pulled back
  const length = Math.hypot(trackpad.x, trackpad.y);
  if (length > 1) { trackpad.x /= length; trackpad.y /= length; }
});
// Clicking the game locks the pointer, so strokes never run into the screen edge.
$('skate-canvas').addEventListener('click', () => {
  if (trackpad.level && trackpad.playing && !document.pointerLockElement) {
    try { $('skate-canvas').requestPointerLock(); } catch {}
  }
});
function trackpadStick() {
  const now = performance.now();
  const keep = Math.exp(-(now - trackpad.at) / TRACKPAD_RETURN_MS);
  trackpad.at = now;
  trackpad.x *= keep;
  trackpad.y *= keep;
  if (Math.abs(trackpad.x) < 0.01) trackpad.x = 0;
  if (Math.abs(trackpad.y) < 0.01) trackpad.y = 0;
  return [Math.round(trackpad.x * 32767), Math.round(trackpad.y * 32767)];
}

function keyboardPad() {
  let buttons = 0;
  for (const [code, bit] of Object.entries(KEY_BUTTONS)) if (held.has(code)) buttons |= bit;
  const axis = (negative, positive) => (held.has(positive) ? 32767 : 0) - (held.has(negative) ? 32767 : 0);
  const lt = held.has('ShiftLeft') || held.has('ShiftRight') ? 255 : 0;
  const rt = held.has('KeyC') ? 255 : 0;
  // Arrow keys win while held; otherwise the trackpad drives the right stick.
  let rx = axis('ArrowLeft', 'ArrowRight');
  let ry = axis('ArrowDown', 'ArrowUp');
  const [tx, ty] = trackpadStick();
  if (!rx && !ry) { rx = tx; ry = ty; }
  // The on-screen controller (touch.js) joins in on touch screens.
  const touch = touchPad();
  let lx = axis('KeyA', 'KeyD');
  let ly = axis('KeyS', 'KeyW');
  if (!lx && !ly) [lx, ly] = touch.left;
  if (!rx && !ry) [rx, ry] = touch.right;
  return new Int32Array([
    buttons | touch.buttons, Math.max(lt, touch.lt), Math.max(rt, touch.rt),
    lx, ly,
    rx, ry,
  ]);
}

// Open a link from the game (pause menu > ONLINE > Join the Discord). A key
// press counts as a click for pop-up blockers; a gamepad press does not, so
// the visible button stays as the fallback.
function openUrl(url) {
  if (!/^https:\/\//.test(url)) return;
  const opened = window.open(url, '_blank');
  if (opened) opened.opener = null;
  else document.body.classList.add('paused');
}

// A file the player gives the game (a shared skater, .cfss): read here in the
// page and handed to the engine; it is never uploaded anywhere.
let picked = null;
function pickFile(accept) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    if (file) picked = new Uint8Array(await file.arrayBuffer());
  });
  input.click();
}
window.addEventListener('dragover', (event) => {
  if (event.dataTransfer && [...event.dataTransfer.types].includes('Files')) event.preventDefault();
});
window.addEventListener('drop', async (event) => {
  const file = event.dataTransfer && event.dataTransfer.files[0];
  if (!file || !/\.cfss$/i.test(file.name)) return;
  event.preventDefault();
  picked = new Uint8Array(await file.arrayBuffer());
});

// Phones and tablets (as the front end decides for Lite mode).
const SMALL_SCREEN = /iPhone|iPad|iPod|Android|Mobile/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// The display's refresh rate, measured from the browser's repaints: a frame
// cap at or above it would only make frames uneven, so the engine runs
// uncapped then (graphics_menu.rs web_frame_limit).
let displayHz = 0;
(() => {
  const times = [];
  const tick = (now) => {
    times.push(now);
    if (times.length < 90) return requestAnimationFrame(tick);
    const gaps = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b);
    const median = gaps[gaps.length >> 1];
    if (median > 0) displayHz = Math.round(1000 / median);
  };
  requestAnimationFrame(tick);
})();

window.skateHost = {
  displayHz: () => displayHz,
  setMobile: (on) => store.setMobileMode(on),
  keyboardPad,
  setTyping,
  setTrackpad,
  openUrl,
  pickFile,
  takePicked: () => { const file = picked; picked = null; return file; },
  getBootConfig: async () => window.__skateBoot,
  readFile: (path) => store.readFile(path),
  // Download a world ahead of time. Background ones (every other world) are
  // skipped on phones and tablets, sparing their data plans and storage.
  downloadStatus: (path) => store.downloadStatus(path),
  prefetch: (path, background) => { if (!(background && SMALL_SCREEN)) store.prefetch(path, background); },
  writeFile: (path, data) => { store.writeFile(path, data).catch((e) => console.warn('persist failed', path, e)); },
  progress: (done, total, label) => {
    step('start', 'active', `${label} ${done}/${total}`);
    showProgress(total ? done / total : 0, `${label} (${done}/${total})`);
  },
  stage: (label) => {
    step('start', 'active', label.replace(/…$/, ''));
    showStage(label);
  },
  // The engine has copied the startup files into its own memory by now, so the
  // page's 250 MB copy of them is dead weight for the rest of the session.
  ready: () => { store.releaseBootPackage(); revealGame(); installTouchControls(store.readFile); $('skate-canvas').focus(); },
  releaseBoot: () => store.releaseBootPackage(),
  fatal: (message) => fail(message),
  netOpen: net.open,
  netClose: net.close,
  netSend: net.send,
  netText: net.text,
  netPoll: net.poll,
  netBacklog: net.backlog,
};

$('load-back').addEventListener('click', () => location.reload());

// Browsers only enter fullscreen from a click, so dropping in is where it
// happens. Keyboard Lock keeps Esc for the pause menu instead of leaving
// fullscreen (hold Esc to leave); browsers without it keep their default.
async function enterFullscreen() {
  if (!frontend.fullscreen || document.fullscreenElement || !document.documentElement.requestFullscreen) return;
  try {
    await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    if (navigator.keyboard && navigator.keyboard.lock) await navigator.keyboard.lock(['Escape']);
  } catch (error) {
    console.warn('fullscreen unavailable:', error && error.message ? error.message : error);
  }
}

let started = false;
// `frontEnd`: start at Skate 3's title and main menu in the engine, with no
// world loaded yet; the player picks one there.
async function startGame(map, name, frontEnd = false) {
  if (started) return;
  started = true;
  enterFullscreen();
  document.querySelector('.load-card h1').replaceChildren(frontend.heading(name));
  startTips();
  $('panel').classList.add('hidden');
  resetSteps();
  watchSteps();
  step('server', 'active', location.host);
  showStage('Checking the server for game data…');
  watchForGame();
  store.gamePack().then((pack) => {
    if (pack) dataHost = new URL(pack.url).host;
    step('data', 'active', dataHost);
  }).catch(() => {});
  try {
    // The engine module and the game data are fetched together; the data is one
    // request, so this wait is the whole download.
    // The engine's script and wasm carry this page's build (main.js?v=...),
    // so a cached copy of one can never meet the other from another build.
    const module = import(`./pkg/skate3rust.js${BUILD}`);
    // The wasm downloads alongside the data, from the data's host if it has it.
    let engineDone = false;
    const engine = store.engineWasm(BUILD, new URL(`./pkg/skate3rust_bg.wasm${BUILD}`, import.meta.url), (done, total, finished) => {
      if (engineDone) return;
      // Shown once the game data is in; until then the two share the line.
      if (steps.get('data').state === 'done') stepBytes('engine', done, total);
      else steps.get('engine').detail = total ? `${MB(done)} of ${MB(total)} MB` : `${MB(done)} MB`;
      if (finished || (total && done >= total)) {
        engineDone = true;
        step('engine', 'done', `${MB(done)} MB`);
        // Compiling follows the download; then the engine reports its own stages.
        if (steps.get('data').state === 'done') step('start', 'active', 'compiling');
      }
    });
    engine.catch(() => {});
    const gameData = store.startBootPackage((done, total, label) => {
      stepBytes('data', done, total);
      showProgress(total ? done / total : 0, `${label} — ${(done / 1048576).toFixed(0)} of ${(total / 1048576).toFixed(0)} MB`);
    })
      // Resolve to nothing: this handler stays suspended for the whole game,
      // and holding the file map here would keep the package alive after
      // the engine releases it.
      .then(() => undefined);
    // Difficulty comes from settings/gameplay.json (chosen on first run and in
    // the menus); a ?difficulty= link still overrides it for that session.
    window.__skateBoot = await store.bootConfig(map, params.get('difficulty'), params.has('capture'), params.get('teleport'), frontEnd);
    await gameData;
    step('data', 'done', 'ready');
    if (!engineDone) step('engine', 'active', steps.get('engine').detail || 'downloading');
    else step('start', 'active', 'compiling');
    showStage('Loading the engine…');
    engine.then(() => {}, () => {});
    await (await module).default({ module_or_path: engine });
  } catch (error) {
    // winit unwinds main with a control-flow exception on web; that is not a failure.
    if (error && /Using exceptions for control flow/.test(String(error.message || error))) return;
    started = false;
    fail(error && error.stack ? error.stack : error);
  }
}

frontend = createFrontend({ store, start: startGame, gpuProblem: webgpuProblem() });
// The previous client copied the whole install into the browser; reclaim it quietly.
store.discardLegacyCache().catch(() => {});
