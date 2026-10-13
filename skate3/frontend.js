// The start screens: a recreation of Skate 3's front end (boot notice, title,
// first-run difficulty and world choice, and the CrossBar main menu).
//
// Every piece of art here (the Port Carverton banner, the category and row
// icons, the Futura bitmap fonts) is read at run time from the player's own
// converted copy of the game, served by their server. The client ships none
// of it; without game data the same screens render in a plain fallback style.

const FE = 'assets/private/frontend/';
const CORE = `${FE}assets/data/fe/source/screens/main/core_menu/`;
const ART = {
  banner: [`${CORE}0052_7.Texture.rgba`, 512, 64],
  noise: [`${CORE}0041_4.Texture.rgba`, 64, 64],
  globe: [`${CORE}0040_36.Texture.rgba`, 64, 64],
  chevron: [`${CORE}0043_50.Texture.rgba`, 16, 16],
  rule: [`${CORE}0042_48.Texture.rgba`, 256, 2],
  glowTile: [`${CORE}0057_83.Texture.rgba`, 64, 64],
  // Category icons: dim when not chosen, bright when chosen.
  catSkate: [`${CORE}0044_54.Texture.rgba`, 32, 32],
  catOnline: [`${CORE}0045_56.Texture.rgba`, 32, 32],
  catLearn: [`${CORE}0047_60.Texture.rgba`, 32, 32],
  catOptions: [`${CORE}0048_62.Texture.rgba`, 32, 32],
  catSkateOn: [`${CORE}0050_67.Texture.rgba`, 64, 64],
  catOnlineOn: [`${CORE}0051_69.Texture.rgba`, 64, 64],
  catLearnOn: [`${CORE}0054_73.Texture.rgba`, 64, 64],
  catOptionsOn: [`${CORE}0055_75.Texture.rgba`, 64, 64],
  // Row icons.
  start: [`${CORE}0016_128.Texture.rgba`, 64, 64],
  world: [`${CORE}0001_100.Texture.rgba`, 64, 64],
  wrench: [`${CORE}0008_112.Texture.rgba`, 64, 64],
  eye: [`${CORE}0002_102.Texture.rgba`, 64, 64],
  book: [`${CORE}0007_110.Texture.rgba`, 64, 64],
  info: [`${CORE}0017_130.Texture.rgba`, 64, 64],
  broadcast: [`${CORE}0026_148.Texture.rgba`, 64, 64],
  crew: [`${CORE}0032_158.Texture.rgba`, 64, 64],
  bulb: [`${CORE}0022_140.Texture.rgba`, 64, 64],
  rewind: [`${CORE}0010_116.Texture.rgba`, 64, 64],
  alert: [`${CORE}0061_92.Texture.rgba`, 64, 64],
};

// The worlds of Port Carverton, in the order the game presents them. Maps
// not listed here (mods, custom maps) follow under their file names.
const WORLDS = {
  University: ['University', 'Port Carverton University: campus plazas, the Observatory dam and the Super-Ultra Mega-Park.'],
  DownTown: ['Downtown', 'The city centre: ledges, stairs, rails and traffic.'],
  Industrial: ['Industrial', 'Docks, warehouses, gaps and the old plant.'],
  SkateSchool: ['Skate School', 'Learn and mess around in the school park.'],
  MaloofMoneyCup: ['Maloof Money Cup', 'The contest course.'],
  BlackBoxPark: ['Black Box Park', 'An indoor warehouse park.'],
  DownTownSkatePark: ['Downtown Skate Park', 'A park in the middle of the city.'],
  IndustrialSkatePark: ['Industrial Skate Park', 'A park on the industrial side of town.'],
  StartPark: ['Start Park', 'A small park to warm up in.'],
};

const DIFFICULTIES = [
  ['easy', 'Easy', 'Forgiving: more air, easier landings and fewer bails. Best for a first session.'],
  ['normal', 'Normal', 'The standard skate. feel.'],
  ['hardcore', 'Hardcore', 'Realistic: less air, harder landings, and you will bail.'],
];

const CONTACT = 'root@aaddpp.lol';
const DISCORD = 'https://discord.gg/EKF8gZnZGe';
// Maps left out of the world list even when the data has them. MegaPark is
// the Super-Ultra Mega-Park cut out on its own; it spawns outside its geometry,
// and the full park is part of University (FREESKATE > Teleport in game).
const HIDDEN_WORLDS = /^maps\/(private\/)?MegaPark\.skate$/i;
const SETUP_KEY = 'skate3-fe-setup';
const WORLD_KEY = 'skate3-fe-world';
const FULLSCREEN_KEY = 'skate3-fullscreen';
const GAMEPLAY = 'settings/gameplay.json';
const GRAPHICS = 'settings/graphics.json';
// Lite mode: 'on' or 'off'; unset means not chosen yet (phones are asked).
const LITE_KEY = 'skate3-lite';
// Phones and tablets: iPadOS reports a Mac, so touch support decides there.
const SMALL_DEVICE = /iPhone|iPad|iPod|Android|Mobile/.test(navigator.userAgent)
  || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
// Graphics that keep a phone's browser within its memory limit (WebKit closes
// a tab that uses too much). Lowest textures are the big saving; the rest
// trims GPU memory and work. Every value stays adjustable in GRAPHICS.
const LITE = { texture_quality: 3, shadows: 0, anti_aliasing: 0, scale: 75 };
const FULL = { texture_quality: SMALL_DEVICE ? 2 : 0, shadows: 2, anti_aliasing: 0, scale: 100 };
// The three cities: hundreds of MB of map each, too much for some phones even in Lite.
const HEAVY_WORLDS = new Set(['University', 'DownTown', 'Industrial']);

const local = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch {} },
};

// --- Art from the player's own data ------------------------------------------

async function loadTexture(read, [path, width, height]) {
  const bytes = await read(path);
  if (!bytes || bytes.length !== width * height * 4) return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.length), width, height), 0, 0);
  return canvas;
}

class BitmapFont {
  constructor(definition, atlas) {
    this.atlas = atlas;
    this.ascent = definition.metrics.Ascent;
    this.descent = -definition.metrics.Descent;
    this.size = definition.metrics.Size;
    const glyphs = new Map(definition.glyphs.map((g) => [g.glyph_index, g]));
    this.chars = new Map();
    for (const { codepoint, glyph_index: index } of definition.characters) {
      const glyph = glyphs.get(index);
      if (glyph) this.chars.set(codepoint, glyph);
    }
    this.space = this.chars.get(32)?.x_advance || this.size / 3;
  }

  measure(text) {
    let width = 0;
    for (const c of text) width += this.chars.get(c.codePointAt(0))?.x_advance ?? this.space;
    return width;
  }

  // Draws `text` in this font's atlas at `scale`, tinted `color`. `pen` lets a
  // glow layer follow the advances of the face it sits under.
  draw(ctx, text, x, baseline, scale, advances) {
    let pen = x;
    let i = 0;
    for (const c of text) {
      const glyph = this.chars.get(c.codePointAt(0));
      if (glyph && glyph.width > 0) {
        const [x0, y0, x1, y1] = glyph.atlas_bounds;
        ctx.drawImage(this.atlas, x0, y0, x1 - x0, y1 - y0,
          pen + glyph.x_offset * scale, baseline - glyph.y_offset * scale, (x1 - x0) * scale, (y1 - y0) * scale);
      }
      pen += (advances ? advances[i] : (glyph ? glyph.x_advance : this.space)) * scale;
      i++;
    }
  }

  advances(text) {
    return [...text].map((c) => this.chars.get(c.codePointAt(0))?.x_advance ?? this.space);
  }
}

function tint(canvas, color) {
  const ctx = canvas.getContext('2d');
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'source-over';
  return canvas;
}

// --- Text: the game's Futura when the data has it, CSS Futura otherwise --------

let heavy = null;
let glow = null;

function text(content, { size = 18, color = '#e8f6ff', glowColor = null, upper = false } = {}) {
  const value = upper ? content.toUpperCase() : content;
  if (!heavy) {
    const span = document.createElement('span');
    span.className = 'fe-text';
    span.textContent = value;
    span.style.fontSize = `${size}px`;
    span.style.color = color;
    if (glowColor) span.style.textShadow = `0 0 ${size * 0.35}px ${glowColor}, 0 0 ${size * 0.7}px ${glowColor}`;
    return span;
  }
  // Rendered at twice the layout size so it stays sharp when the stage scales up.
  const ratio = 2;
  const scale = (size / heavy.size) * ratio;
  const pad = Math.ceil(size * 0.45 * ratio);
  const width = Math.ceil(heavy.measure(value) * scale) + pad * 2;
  const height = Math.ceil((heavy.ascent + heavy.descent) * scale) + pad * 2;
  const baseline = pad + heavy.ascent * scale;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const ctx = canvas.getContext('2d');
  const advances = heavy.advances(value);
  if (glowColor && glow) {
    const layer = document.createElement('canvas');
    layer.width = canvas.width;
    layer.height = canvas.height;
    glow.draw(layer.getContext('2d'), value, pad, baseline, scale, advances);
    ctx.drawImage(tint(layer, glowColor), 0, 0);
  }
  const face = document.createElement('canvas');
  face.width = canvas.width;
  face.height = canvas.height;
  heavy.draw(face.getContext('2d'), value, pad, baseline, scale, advances);
  ctx.drawImage(tint(face, color), 0, 0);
  canvas.className = 'fe-text';
  canvas.style.width = `${canvas.width / ratio}px`;
  canvas.style.height = `${canvas.height / ratio}px`;
  canvas.style.margin = `${-pad / ratio}px`;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', value);
  return canvas;
}

// --- The front end -------------------------------------------------------------

export function createFrontend({ store, start, gpuProblem }) {
  const root = document.getElementById('panel');
  root.innerHTML = '';
  root.classList.add('fe-root');
  const stage = el('div', 'fe-stage');
  root.append(stage);

  const art = {};
  let summary = { maps: [], files: 0, bytes: 0, origin: store.origin() };
  let screen = null;
  let difficulty = 'easy';
  let world = local.get(WORLD_KEY);
  let pendingError = '';
  // Game data saved in this browser after the first download (see host.js).
  let savedBytes = 0;
  const refreshSaved = () => store.downloadsSize().then((bytes) => { savedBytes = bytes; }).catch(() => {});

  // Fit the 1280x720 layout to the window, as the game's own UI does.
  const fit = () => {
    const scale = Math.min(window.innerWidth / 1280, window.innerHeight / 720);
    stage.style.transform = `translate(-50%, -50%) scale(${scale})`;
  };
  window.addEventListener('resize', fit);
  fit();

  // --- the start screen's own ambience (from the converted audio) ---
  // Browsers only start sound after the player presses something, so it
  // begins with the first input and fades out when the game starts.
  let titleAudio = null;
  let titleLevel = 0.45;
  const startTitleAudio = () => {
    if (titleAudio && titleAudio.paused && !titleAudio.dataset.done) titleAudio.play().catch(() => {});
  };
  async function loadTitleAudio() {
    try {
      const table = JSON.parse(new TextDecoder().decode(await store.readFile('assets/private/audio/sounds.json')));
      const clip = table.maps && table.maps.title;
      if (!clip) return;
      const bytes = await store.readFile(`assets/private/audio/${clip}`);
      if (!bytes) return;
      try {
        const player = JSON.parse(new TextDecoder().decode(await store.readFile('settings/player.json')));
        if (Number.isFinite(player.sound_volume)) titleLevel = 0.45 * player.sound_volume / 100;
      } catch {}
      titleAudio = new Audio(URL.createObjectURL(new Blob([bytes], { type: 'audio/ogg' })));
      titleAudio.loop = true;
      titleAudio.volume = titleLevel;
    } catch {}
  }
  function stopTitleAudio() {
    if (!titleAudio) return;
    titleAudio.dataset.done = '1';
    const fade = setInterval(() => {
      titleAudio.volume = Math.max(0, titleAudio.volume - titleLevel / 20);
      if (titleAudio.volume <= 0) { titleAudio.pause(); clearInterval(fade); }
    }, 50);
  }

  // --- input ---
  const handlers = { up() {}, down() {}, left() {}, right() {}, accept() {}, back() {} };
  // Set while a screen says "press any button": every key, click, tap and pad
  // button counts, not only the ones the menus use.
  let anyInput = null;
  const visible = () => !root.classList.contains('hidden');
  // A tap or click moves on with its click (the screens' own onclick), never
  // on touching down: the click that follows a touch would land on the next
  // screen and choose there too (one tap picked a mode on iPhone).
  window.addEventListener('pointerdown', () => { if (visible()) startTitleAudio(); });
  // Any click in the moment after a screen changed belongs to the old screen.
  let shownAt = 0;
  window.addEventListener('click', (event) => {
    if (visible() && performance.now() - shownAt < 350) {
      event.stopPropagation();
      event.preventDefault();
    }
  }, true);
  window.addEventListener('keydown', (event) => {
    if (!visible() || (event.target && event.target.tagName === 'INPUT')) return;
    startTitleAudio();
    if (anyInput && !event.repeat) {
      const go = anyInput;
      anyInput = null;
      event.preventDefault();
      go();
      return;
    }
    const action = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
      KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right', Enter: 'accept', Space: 'accept',
      Escape: 'back', Backspace: 'back', Tab: 'back' }[event.code];
    if (!action) return;
    event.preventDefault();
    handlers[action]();
  });
  // Gamepad: d-pad or left stick to move, A / Start to choose, B to go back.
  const held = new Map();
  const poll = () => {
    requestAnimationFrame(poll);
    if (!visible()) return;
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    const now = performance.now();
    const pressed = (name, down) => {
      const since = held.get(name);
      if (!down) { held.delete(name); return; }
      if (since === undefined) { held.set(name, now + 350); handlers[name](); }
      else if (now >= since) { held.set(name, now + 110); if (!['accept', 'back'].includes(name)) handlers[name](); }
    };
    let state = { up: false, down: false, left: false, right: false, accept: false, back: false };
    const anyButton = pads.some((pad) => pad.buttons.some((button) => button && button.pressed));
    if (anyInput && anyButton && !held.has('any')) {
      held.set('any', now);
      const go = anyInput;
      anyInput = null;
      go();
      return;
    }
    if (!anyButton) held.delete('any');
    for (const pad of pads) {
      const b = (i) => pad.buttons[i] && pad.buttons[i].pressed;
      const [x = 0, y = 0] = pad.axes;
      state.up ||= b(12) || y < -0.6;
      state.down ||= b(13) || y > 0.6;
      state.left ||= b(14) || x < -0.6;
      state.right ||= b(15) || x > 0.6;
      state.accept ||= b(0) || b(9);
      state.back ||= b(1);
    }
    for (const [name, down] of Object.entries(state)) pressed(name, down);
  };
  requestAnimationFrame(poll);

  function show(build) {
    stage.innerHTML = '';
    anyInput = null;
    shownAt = performance.now();
    for (const key of Object.keys(handlers)) handlers[key] = () => {};
    screen = build;
    build();
  }

  function el(tag, className, ...children) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    for (const child of children) if (child) node.append(child);
    return node;
  }

  function img(name, className) {
    const source = art[name];
    if (!source) return el('div', `${className || ''} fe-missing`);
    const node = el('img', className);
    node.src = source;
    node.alt = '';
    node.draggable = false;
    return node;
  }

  function backdrop() {
    stage.append(el('div', 'fe-backdrop'));
    if (art.globe) {
      const decoration = img('globe', 'fe-globe');
      stage.append(decoration);
    }
  }

  function hints(...pairs) {
    const bar = el('div', 'fe-hints');
    for (const [button, label] of pairs) {
      const face = { A: ' a', B: ' b' }[button] || '';
      bar.append(el('span', 'fe-hint', el('b', `fe-button${face}`, document.createTextNode(button)), text(label, { size: 14, color: '#bcd7e6' })));
    }
    stage.append(bar);
  }

  function contactLink() {
    const link = el('a');
    link.href = `mailto:${CONTACT}`;
    link.textContent = CONTACT;
    // Opening the mail client must not also advance the screen behind it.
    link.addEventListener('click', (event) => event.stopPropagation());
    return link;
  }

  // --- 1. Boot notice: the fan game disclaimer, in the spot where the original
  // shows its own boot notices. Plain white on black, as those were. ---
  function notice() {
    show(() => {
      stage.append(el('div', 'fe-black'));
      const box = el('div', 'fe-notice fe-fade');
      box.append(el('div', 'fe-notice-logo', skateMark(64)));
      box.append(text('THIS IS A FAN GAME', { size: 30, color: '#ffffff', glowColor: '#3fb6ff' }));
      box.append(el('div', 'fe-notice-rule'));
      const body = el('div', 'fe-notice-body');
      body.innerHTML = `
        <p><b>Not made by EA.</b> This is an unofficial, non-commercial fan game. It is not made, endorsed
        or supported by Electronic Arts or Black Box. skate. and Skate 3 are trademarks of Electronic Arts.</p>
        <p>No game content is hosted here; the server only runs the engine. You bring your own legally owned
        copy of Skate 3, converted on your own machine.</p>
        <p>Settings are saved in this browser. Don't close the tab while the game is loading.</p>`;
      box.append(body);
      box.append(el('div', 'fe-contact', el('span', 'fe-contact-label', document.createTextNode('QUESTIONS / BUGS')), contactLink()));
      stage.append(box);
      const press = el('button', 'fe-notice-press', text('Press any button or click to continue', { size: 20, color: '#ffffff', glowColor: '#36b3ff' }));
      press.type = 'button';
      stage.append(press);
      let gone = false;
      const go = () => { if (!gone) { gone = true; afterNotice(); } };
      handlers.accept = go;
      handlers.back = go;
      root.onclick = (event) => { if (!(event.target && event.target.closest && event.target.closest('a'))) go(); };
      // A pad button held from before the screen appeared does not count.
      const armed = performance.now() + 300;
      setTimeout(() => { if (!gone) anyInput = go; }, Math.max(0, armed - performance.now()));
    });
  }

  // After the notice the engine takes over: Skate 3's own title, first-run
  // difficulty, CrossBar main menu and loading screen run inside it
  // (main_menu.rs). Phones first answer the Lite question, which has to be
  // settled before any world loads.
  function afterNotice() {
    root.onclick = null;
    if (pendingError) return message('CAN’T START', pendingError, () => { pendingError = ''; notice(); });
    if (SMALL_DEVICE && !local.get(LITE_KEY)) return chooseLite(true);
    bootEngine();
  }

  function bootEngine() {
    if (gpuProblem) return message('CAN’T START', gpuProblem, () => notice());
    stopTitleAudio();
    start(null, 'skate. 3', true);
  }

  // The skate. wordmark: Skate 3's Futura atlas maps it to U+00AB.
  function skateMark(size) {
    if (heavy && heavy.chars.get(0xab)?.width > 60) return text('«', { size, color: '#ffffff' });
    const node = el('span', 'fe-wordmark');
    node.textContent = 'skate.';
    node.style.fontSize = `${size}px`;
    return node;
  }

  // The full title logo: the wordmark with a big outlined 3 beside it.
  function titleLogo() {
    const logo = el('div', 'fe-logo', skateMark(150));
    const three = el('span', 'fe-logo-three');
    three.textContent = '3';
    logo.append(three);
    return logo;
  }

  // --- 2. Title: the skate. 3 start screen. City lights drift behind the logo
  // where the original runs its attract footage. ---
  function title() {
    root.onclick = null;
    show(() => {
      const bg = el('div', 'fe-title-bg', el('div', 'fe-lights far'), el('div', 'fe-lights'), el('div', 'fe-title-floor'));
      stage.append(bg, el('div', 'fe-grain'), el('div', 'fe-vignette'));
      stage.append(el('div', 'fe-letterbox top'), el('div', 'fe-letterbox bottom'));
      const box = el('div', 'fe-title');
      box.append(titleLogo());
      box.append(el('div')); // line break between the logo and its subtitle
      box.append(el('div', 'fe-title-sub', text('RUST ENGINE  ·  FAN GAME', { size: 18, color: '#cfeeff', glowColor: '#2b9bea' })));
      stage.append(box);
      stage.append(el('div', 'fe-press', text('PRESS START', { size: 30, color: '#ffffff', glowColor: '#36b3ff' })));
      const legal = el('div', 'fe-legal');
      legal.append(
        document.createTextNode('Unofficial fan game. Not made, endorsed or supported by Electronic Arts or Black Box. Bring your own copy of Skate 3.'),
        el('br'),
        document.createTextNode('Contact: '),
        contactLink());
      stage.append(legal);
      const go = () => {
        stage.onclick = null;
        if (pendingError) return message('CAN’T START', pendingError, () => { pendingError = ''; title(); });
        if (SMALL_DEVICE && !local.get(LITE_KEY)) chooseLite(true);
        else if (!local.get(SETUP_KEY)) chooseDifficulty(true);
        else crossbar(0, 0);
      };
      handlers.accept = go;
      stage.onclick = go;
    });
  }

  // --- 3. First run: difficulty, then world ---
  function chooseDifficulty(firstRun) {
    let index = Math.max(0, DIFFICULTIES.findIndex(([key]) => key === difficulty));
    show(() => {
      backdrop();
      header(firstRun ? 'NEW SKATER' : 'OPTIONS', 'DIFFICULTY');
      const list = el('div', 'fe-choice');
      list.append(text('CHOOSE YOUR DIFFICULTY', { size: 30, color: '#ffffff', glowColor: '#2b9bea' }));
      list.append(el('p', 'fe-choice-note', document.createTextNode(
        'How forgiving the board is. You can change it any time from Options, or in game from the pause menu, which also has Motorized and Custom.')));
      const rows = DIFFICULTIES.map(([key, label, help], i) => {
        const row = el('div', 'fe-choice-row');
        row.onclick = () => { index = i; draw(); choose(); };
        // A real mouse only: on a touch screen Safari fakes a hover on the first
        // tap, and a hover that redraws the list cancels the tap's click.
        row.onpointerenter = (event) => { if (event.pointerType === 'mouse') { index = i; draw(); } };
        list.append(row);
        return { row, label, help };
      });
      const help = el('div', 'fe-choice-help');
      list.append(help);
      stage.append(list);
      const draw = () => rows.forEach(({ row, label }, i) => {
        row.replaceChildren(text(label.toUpperCase(), i === index
          ? { size: 30, color: '#ffffff', glowColor: '#36b3ff' } : { size: 24, color: '#7fa9c2' }));
        row.classList.toggle('on', i === index);
        if (i === index) help.textContent = rows[i].help;
      });
      const choose = async () => {
        difficulty = DIFFICULTIES[index][0];
        await saveDifficulty();
        if (firstRun) chooseWorld(true);
        else crossbar(3, 0);
      };
      draw();
      handlers.up = () => { index = (index + rows.length - 1) % rows.length; draw(); };
      handlers.down = () => { index = (index + 1) % rows.length; draw(); };
      handlers.accept = choose;
      handlers.back = () => (firstRun ? title() : crossbar(3, 0));
      hints(['A', 'Select'], ['B', 'Back']);
    });
  }

  // --- Mobile mode (store.mobileMode: also the page's memory savers) ---
  const liteOn = () => store.mobileMode();

  async function applyLite(on) {
    store.setMobileMode(on);
    let settings = {};
    try {
      const saved = await store.readFile(GRAPHICS);
      if (saved) settings = JSON.parse(new TextDecoder().decode(saved));
    } catch {}
    Object.assign(settings, on ? LITE : FULL);
    await store.writeFile(GRAPHICS, new TextEncoder().encode(JSON.stringify(settings, null, 2)));
  }

  function chooseLite(firstRun) {
    const options = [
      [true, 'Mobile Mode', 'Every map, the full game and the original Skate 3 screens, using far less memory: lighter graphics, no background downloads, and a warning before the big cities. Recommended on this device.'],
      [false, 'Full Quality', 'The original look. Needs more memory than most phone browsers allow; the browser may close the game on the big cities.'],
    ];
    if (!SMALL_DEVICE) options.reverse();
    let index = Math.max(0, options.findIndex(([on]) => on === (local.get(LITE_KEY) ? liteOn() : SMALL_DEVICE)));
    show(() => {
      backdrop();
      header(firstRun ? 'NEW SKATER' : 'OPTIONS', 'MOBILE MODE');
      const list = el('div', 'fe-choice');
      list.append(text('HOW SHOULD IT RUN?', { size: 30, color: '#ffffff', glowColor: '#2b9bea' }));
      list.append(el('p', 'fe-choice-note', document.createTextNode(
        'Phone and tablet browsers close a game that uses too much memory. Mobile mode trades some detail for staying open. Switch any time under Options > Graphics.')));
      const rows = options.map(([, label], i) => {
        const row = el('div', 'fe-choice-row');
        row.onclick = () => { index = i; draw(); choose(); };
        // A real mouse only: on a touch screen Safari fakes a hover on the first
        // tap, and a hover that redraws the list cancels the tap's click.
        row.onpointerenter = (event) => { if (event.pointerType === 'mouse') { index = i; draw(); } };
        list.append(row);
        return { row, label };
      });
      const help = el('div', 'fe-choice-help');
      list.append(help);
      stage.append(list);
      const draw = () => rows.forEach(({ row, label }, i) => {
        row.replaceChildren(text(label.toUpperCase(), i === index
          ? { size: 30, color: '#ffffff', glowColor: '#36b3ff' } : { size: 24, color: '#7fa9c2' }));
        row.classList.toggle('on', i === index);
        if (i === index) help.textContent = options[i][2];
      });
      const choose = async () => {
        await applyLite(options[index][0]);
        if (firstRun) bootEngine();
        else crossbar(3, 2);
      };
      draw();
      handlers.up = () => { index = (index + rows.length - 1) % rows.length; draw(); };
      handlers.down = () => { index = (index + 1) % rows.length; draw(); };
      handlers.accept = choose;
      handlers.back = () => (firstRun ? notice() : crossbar(3, 2));
      hints(['A', 'Select'], ['B', 'Back']);
    });
  }

  function worlds() {
    const known = Object.keys(WORLDS);
    const list = summary.maps.filter((path) => !HIDDEN_WORLDS.test(path)).map((path) => {
      const stem = path.replace(/^maps\//, '').replace(/\.skate$/i, '');
      const [name, base] = WORLDS[stem] || [stem.replaceAll('_', ' '), 'A map from your installation.'];
      const heavy = liteOn() && HEAVY_WORLDS.has(stem);
      const about = heavy ? `${base} Large city: may still be too much for a phone in Lite mode; the parks are safer.` : base;
      // In Lite the parks come first: they fit a phone comfortably.
      const order = (known.includes(stem) ? known.indexOf(stem) : 100) + (heavy ? 1000 : 0);
      return { path, name, about, order };
    }).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    if (!list.length) list.push({ path: store.demoMap, name: 'Format Demo', about: 'No game data was found, so only the built-in demo is available.' });
    return list;
  }

  function chooseWorld(firstRun) {
    const list = worlds();
    let index = Math.max(0, list.findIndex((w) => w.path === world));
    show(() => {
      backdrop();
      header(firstRun ? 'NEW SKATER' : 'FREESKATE', 'CHOOSE WORLD');
      const box = el('div', 'fe-choice fe-worlds');
      box.append(text('WHERE DO YOU WANT TO SKATE?', { size: 30, color: '#ffffff', glowColor: '#2b9bea' }));
      const scroller = el('div', 'fe-world-list');
      const rows = list.map((w, i) => {
        const row = el('div', 'fe-choice-row');
        row.onclick = () => { index = i; draw(); choose(); };
        // A real mouse only: on a touch screen Safari fakes a hover on the first
        // tap, and a hover that redraws the list cancels the tap's click.
        row.onpointerenter = (event) => { if (event.pointerType === 'mouse') { index = i; draw(); } };
        scroller.append(row);
        return row;
      });
      box.append(scroller);
      const about = el('div', 'fe-choice-help');
      box.append(about);
      stage.append(box);
      const draw = () => {
        rows.forEach((row, i) => {
          row.replaceChildren(text(list[i].name.toUpperCase(), i === index
            ? { size: 28, color: '#ffffff', glowColor: '#36b3ff' } : { size: 21, color: '#7fa9c2' }));
          row.classList.toggle('on', i === index);
        });
        about.textContent = list[index].about;
        rows[index].scrollIntoView({ block: 'nearest' });
      };
      const choose = () => {
        world = list[index].path;
        local.set(WORLD_KEY, world);
        local.set(SETUP_KEY, '1');
        launch();
      };
      draw();
      handlers.up = () => { index = (index + rows.length - 1) % rows.length; draw(); };
      handlers.down = () => { index = (index + 1) % rows.length; draw(); };
      handlers.accept = choose;
      handlers.back = () => (firstRun ? chooseDifficulty(true) : crossbar(0, 1));
      hints(['A', 'Skate'], ['B', 'Back']);
    });
  }

  // --- 4. The CrossBar ---
  function categories() {
    const fullscreen = local.get(FULLSCREEN_KEY) !== 'off';
    const current = worlds().find((w) => w.path === world) || worlds()[0];
    const level = DIFFICULTIES.find(([key]) => key === difficulty);
    return [
      { name: 'FREESKATE', icon: 'catSkate', on: 'catSkateOn', rows: [
        { name: 'Skate', icon: 'start', help: `Drop in at ${current.name}.`, run: launch },
        { name: 'Choose World', icon: 'world', help: `Now: ${current.name}. Pick another part of Port Carverton.`, run: () => chooseWorld(false) },
        { name: 'Difficulty', icon: 'wrench', help: `Now: ${level ? level[1] : difficulty}. How forgiving the board is.`, run: () => chooseDifficulty(false) },
      ] },
      { name: 'ONLINE', icon: 'catOnline', on: 'catOnlineOn', rows: [
        { name: 'Skate With Friends', icon: 'crew', help: 'How to host or join a session.', run: () => message('SKATE WITH FRIENDS',
          'Everyone opens this same address. In game, press Start (Esc) and go to ONLINE:\n\n' +
          '• Host a Session: your friends can now find you.\n' +
          '• Find a Session: browse sessions on this server and join one.\n' +
          '• Join with a Code: type the code the host sees.\n\n' +
          'Everyone needs to be on the same world.', back(1, 0)) },
        { name: 'Game Server', icon: 'broadcast', help: serverLine(), run: serverPanel },
        { name: 'Join the Discord', icon: 'info', help: 'Find people to skate with, get help and hear about updates.', run: () => {
          const opened = window.open(DISCORD, '_blank');
          if (opened) opened.opener = null;
        } },
      ] },
      { name: 'LEARN', icon: 'catLearn', on: 'catLearnOn', rows: [
        { name: 'Controls', icon: 'book', help: 'Controller and keyboard layout.', run: () => message('CONTROLS',
          'Controller: Xbox 360 / One / Series, PlayStation 3 / 4 / 5 and most other gamepads. Flick It on the right stick, push with A (Cross), Start (Options) for the menu.\n\n' +
          'Keyboard, with no controller connected:\n' +
          '• WASD: left stick (steer, push, crouch)\n' +
          '• Arrow keys: right stick (Flick It tricks)\n' +
          '• Space / E / Q / R: A / B / X / Y\n' +
          '• Z / X: LB / RB, Shift / C: LT / RT (grabs), V / B: L3 / R3\n' +
          '• I J K L: d-pad, Esc: Start (pause menu), Tab: Back\n' +
          '• F8: debug camera, T: drop your skater at it\n\n' +
          'Trackpad Mode (in game: pause menu > PLAYER) turns the mouse or trackpad into the right stick: ' +
          'click the game to lock the pointer, move down then quickly up to ollie. ' +
          'PLAYER > Controls shows all of this in game.', back(2, 0)) },
        { name: 'About This Project', icon: 'info', help: 'What this is, and what it is not.', run: notice },
      ] },
      { name: 'OPTIONS', icon: 'catOptions', on: 'catOptionsOn', rows: [
        { name: 'Difficulty', icon: 'wrench', help: `Now: ${level ? level[1] : difficulty}.`, run: () => chooseDifficulty(false) },
        { name: `Fullscreen: ${fullscreen ? 'On' : 'Off'}`, icon: 'eye', help: 'Enter fullscreen when you drop in. Hold Esc to leave it.', run: () => {
          local.set(FULLSCREEN_KEY, fullscreen ? 'off' : 'on');
          crossbar(3, 1);
        } },
        { name: `Lite Mode: ${liteOn() ? 'On' : 'Off'}`, icon: 'bulb',
          help: 'Lowest textures, no shadows, lighter image: much less memory. For phones, tablets and low-end computers.',
          run: () => chooseLite(false) },
        { name: 'Reset First-Run Setup', icon: 'rewind', help: 'Ask for difficulty and world again next time.', run: () => {
          try { localStorage.removeItem(SETUP_KEY); } catch {}
          message('SETUP RESET', 'Next time you press Start you will choose your difficulty and world again.', back(3, 3));
        } },
        { name: 'Saved Downloads', icon: 'bulb',
          help: savedBytes ? `${(savedBytes / 1048576).toFixed(0)} MB of maps and game data kept so they load without downloading. Select to delete.`
            : 'Maps you play are kept so the next load skips the download. Nothing saved yet.',
          run: async () => {
            await store.clearDownloads();
            savedBytes = 0;
            message('DOWNLOADS DELETED', 'Saved maps and game data were removed. They download again the next time you play them.', back(3, 4));
          } },
        { name: 'Delete Local Settings', icon: 'alert', help: 'Forget every option this browser saved for the game.', run: async () => {
          await store.clearLocal();
          try { localStorage.removeItem(SETUP_KEY); localStorage.removeItem(WORLD_KEY); } catch {}
          difficulty = 'easy';
          message('SETTINGS DELETED', 'Everything this browser saved for the game has been removed.', () => title());
        } },
      ] },
    ];
  }

  const back = (category, row) => () => crossbar(category, row);

  function serverLine() {
    return summary.error ? `No game data found at ${summary.origin}.`
      : `${summary.files} files, ${(summary.bytes / 1048576).toFixed(0)} MB at ${summary.origin}.`;
  }

  function header(trail, here) {
    const top = el('div', 'fe-header');
    top.append(img('banner', 'fe-banner'));
    const crumb = el('div', 'fe-crumb', text(trail, { size: 16, color: '#ffffff' }));
    if (here) {
      crumb.append(art.chevron ? img('chevron', 'fe-chevron') : document.createTextNode(' > '));
      crumb.append(text(here, { size: 16, color: '#ffffff', glowColor: '#2b9bea' }));
    }
    top.append(crumb);
    stage.append(top);
    return top;
  }

  function crossbar(category = 0, row = 0) {
    const cats = categories();
    let c = Math.min(category, cats.length - 1);
    let r = Math.min(row, cats[c].rows.length - 1);
    show(() => {
      backdrop();
      const top = header('MAIN MENU', cats[c].name);
      const icons = el('div', 'fe-cats');
      cats.forEach((cat, i) => {
        const icon = el('div', `fe-cat${i === c ? ' on' : ''}`, img(i === c ? cat.on : cat.icon));
        icon.onclick = () => crossbar(i, 0);
        icons.append(icon);
      });
      top.append(icons);
      const column = el('div', 'fe-rows');
      cats[c].rows.forEach((item, i) => {
        const on = i === r;
        const line = el('div', `fe-row${on ? ' on' : ''}`);
        const tile = el('div', 'fe-tile', on && art.glowTile ? img('glowTile', 'fe-tile-glow') : null, img(item.icon, 'fe-tile-icon'));
        line.append(tile);
        const words = el('div', 'fe-row-words', text(item.name, on
          ? { size: 24, color: '#ffffff', glowColor: '#36b3ff' } : { size: 19, color: '#9cc9e4' }));
        if (on) words.append(el('div', 'fe-row-help', document.createTextNode(item.help)));
        line.append(words);
        line.onclick = () => (i === r ? item.run() : crossbar(c, i));
        column.append(line);
      });
      stage.append(column);
      const current = worlds().find((w) => w.path === world) || worlds()[0];
      const level = DIFFICULTIES.find(([key]) => key === difficulty);
      stage.append(el('div', 'fe-status',
        text(current.name.toUpperCase(), { size: 22, color: '#ffffff', glowColor: '#2b9bea' }),
        el('div', 'fe-status-sub', document.createTextNode(`${level ? level[1] : difficulty} · ${summary.error ? 'no game data' : 'game data ready'}`))));
      handlers.left = () => crossbar((c + cats.length - 1) % cats.length, 0);
      handlers.right = () => crossbar((c + 1) % cats.length, 0);
      handlers.up = () => crossbar(c, (r + cats[c].rows.length - 1) % cats[c].rows.length);
      handlers.down = () => crossbar(c, (r + 1) % cats[c].rows.length);
      handlers.accept = () => cats[c].rows[r].run();
      handlers.back = () => title();
      hints(['A', 'Select'], ['B', 'Back'], ['◀ ▶', 'Category']);
    });
  }

  // A text panel in the menu's style.
  function message(heading, body, done) {
    show(() => {
      backdrop();
      const box = el('div', 'fe-panel');
      box.append(text(heading, { size: 26, color: '#ffffff', glowColor: '#2b9bea' }));
      const words = el('div', 'fe-panel-body');
      words.textContent = body;
      box.append(words);
      stage.append(box);
      handlers.accept = done;
      handlers.back = done;
      box.onclick = done;
      hints(['A', 'OK'], ['B', 'Back']);
    });
  }

  function serverPanel() {
    show(() => {
      backdrop();
      const box = el('div', 'fe-panel');
      box.append(text('GAME SERVER', { size: 26, color: '#ffffff', glowColor: '#2b9bea' }));
      const body = el('div', 'fe-panel-body');
      body.textContent = `${serverLine()}\n\nThe game data comes from the server on the machine that holds your converted copy (SERVE.bat). To use another, enter its address, or the address of a game data .zip (read directly from where it is hosted):`;
      box.append(body);
      const field = el('input', 'fe-input');
      field.type = 'text';
      field.value = store.origin();
      field.placeholder = 'http://192.168.1.10';
      box.append(field);
      const row = el('div', 'fe-panel-buttons');
      const apply = el('button', 'fe-btn', document.createTextNode('Use this server'));
      const recheck = el('button', 'fe-btn', document.createTextNode('Re-check'));
      const close = el('button', 'fe-btn', document.createTextNode('Back'));
      row.append(apply, recheck, close);
      box.append(row);
      stage.append(box);
      apply.onclick = async () => { store.setOrigin(field.value); await refresh(true); serverPanel(); };
      recheck.onclick = async () => { await refresh(true); serverPanel(); };
      close.onclick = back(1, 1);
      field.addEventListener('keydown', (event) => { if (event.key === 'Enter') apply.onclick(); if (event.key === 'Escape') close.onclick(); });
      handlers.back = close.onclick;
      hints(['B', 'Back']);
    });
  }

  async function saveDifficulty() {
    await store.writeFile(GAMEPLAY, new TextEncoder().encode(JSON.stringify({ difficulty }, null, 2)));
  }

  async function refresh(force = false) {
    if (force) {
      try { await store.manifest(true); } catch {}
    }
    try {
      summary = await store.installSummary();
    } catch (error) {
      summary = { maps: [], files: 0, bytes: 0, origin: store.origin(), error: String(error.message || error) };
    }
    if (!summary.error && !summary.ready) summary.error = 'the server is running but has no converted game data';
    if (!worlds().some((w) => w.path === world)) world = worlds()[0].path;
  }

  function launch() {
    local.set(WORLD_KEY, world);
    if (gpuProblem) return message('CAN’T START', gpuProblem, () => crossbar(0, 0));
    const current = worlds().find((w) => w.path === world) || worlds()[0];
    stopTitleAudio();
    start(world, current.name);
  }

  async function loadArt() {
    const read = async (path) => {
      try { return await store.readFile(path); } catch { return null; }
    };
    const textures = await Promise.all(Object.entries(ART).map(async ([name, spec]) => [name, await loadTexture(read, spec)]));
    for (const [name, canvas] of textures) if (canvas) art[name] = canvas.toDataURL();
    if (art.noise) stage.style.setProperty('--fe-noise', `url(${art.noise})`);
    try {
      const bytes = await read(`${FE}core_menu.json`);
      if (!bytes) return;
      const fonts = JSON.parse(new TextDecoder().decode(bytes)).fonts;
      const face = fonts['Futura Std Medium'];
      const halo = fonts['Futura Glow'];
      const atlas = (font) => loadTexture(read, [`${FE}${font.texture}`, 512, 512]);
      const [faceAtlas, haloAtlas] = await Promise.all([atlas(face), halo ? atlas(halo) : null]);
      if (faceAtlas) heavy = new BitmapFont(face.definition, faceAtlas);
      if (haloAtlas) glow = new BitmapFont(halo.definition, haloAtlas);
    } catch (error) {
      console.warn('front end font unavailable:', error);
    }
  }

  async function begin() {
    if (gpuProblem) pendingError = gpuProblem;
    stage.append(el('div', 'fe-black'));
    // The first thing anyone sees: say what is happening, and what to do if
    // it takes too long (the server and the data host are asked first).
    const status = el('div', 'fe-boot-status');
    const line = el('div', 'fe-boot-line');
    const hint = el('div', 'fe-boot-hint');
    const retry = el('button', 'fe-boot-retry');
    retry.type = 'button';
    retry.textContent = 'Retry';
    retry.onclick = () => location.reload();
    retry.hidden = true;
    status.append(line, hint, retry);
    stage.append(status);
    const began = performance.now();
    let phase = 'Connecting to the game server and the game data';
    const tick = () => {
      const seconds = Math.round((performance.now() - began) / 1000);
      line.textContent = `${phase}… ${seconds >= 3 ? `${seconds}s` : ''}`;
      if (seconds >= 15) {
        hint.textContent = 'This is taking longer than it should. Check your internet connection. School and work networks often block game sites; a different network or a phone hotspot usually works.';
        retry.hidden = false;
      }
    };
    tick();
    const ticker = setInterval(tick, 1000);
    try {
      await bootSteps((next) => { phase = next; tick(); });
    } finally {
      clearInterval(ticker);
      status.remove();
    }
    notice();
  }

  async function bootSteps(say) {
    say('Connecting to the game server and the game data');
    const pack = store.gamePack().then((opened) => { if (opened) say(`Connected to ${new URL(opened.url).host}, reading the file list`); }).catch(() => {});
    await refresh();
    await pack;
    await refreshSaved();
    if (summary.error) {
      // A pack the browser cannot read is a hosting setting, not a missing
      // server: say what failed rather than suggesting SERVE.bat.
      pendingError ||= /did not answer/i.test(summary.error)
        ? summary.error.replace(/^Game data pack \S+: /, '')
        : /pack/i.test(summary.error)
        ? `${summary.error}\n\nThe game server is fine; the host of the game data zip has to allow this site (CORS) before browsers can read it.`
        : `${serverLine()}\n\n${summary.error}\n\nStart SERVE.bat on the machine that holds your converted copy and open the address it prints, or set the server under ONLINE > Game Server.`;
    }
    try {
      const saved = await store.readFile(GAMEPLAY);
      if (saved) difficulty = JSON.parse(new TextDecoder().decode(saved)).difficulty || difficulty;
    } catch {}
    // The art comes from the same data; give it a moment, never block on it.
    say('Loading the menus');
    await Promise.race([Promise.all([loadArt(), loadTitleAudio()]), new Promise((resolve) => setTimeout(resolve, 6000))]);
  }

  begin();

  return {
    // Back to the menu after a failed start, with the reason on screen.
    fail(reason, heading = 'SOMETHING WENT WRONG') {
      root.classList.remove('hidden');
      message(heading, String(reason), () => notice());
    },
    get fullscreen() { return local.get(FULLSCREEN_KEY) !== 'off'; },
    // The loading screen's heading, in the game's font when it is available.
    heading(words) { return text(words.toUpperCase(), { size: 84, color: '#ffffff', glowColor: '#2b9bea' }); },
  };
}
