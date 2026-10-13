// On-screen controller for touch screens: Skate 3's Xbox layout over the game.
// The left stick steers and crouches, the right pad is the Flick It stick
// (drag down then up to ollie; it springs back when lifted), and the buttons
// and triggers sit where a thumb finds them. Everything feeds the same virtual
// pad as the keyboard (main.js keyboardPad), so the engine sees a controller.
//
// Button faces are Skate 3's own Xbox glyphs from the player's converted copy
// (assets/private/frontend/buttons, see tools/prepare_frontend.py); without
// them the buttons show their letters.

const XINPUT = { A: 0x1000, B: 0x2000, X: 0x4000, Y: 0x8000, LB: 0x0100, RB: 0x0200, START: 0x0010, BACK: 0x0020 };
const GLYPHS = 'assets/private/frontend/buttons.json';

export const TOUCH_SCREEN = (navigator.maxTouchPoints || 0) > 0 && matchMedia('(pointer: coarse)').matches;

const state = { buttons: 0, lt: 0, rt: 0, left: [0, 0], right: [0, 0] };

/// The touch controls' share of the virtual pad this frame.
export function touchPad() {
  return state;
}

function el(tag, className, parent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (parent) parent.append(node);
  return node;
}

// A stick: the knob follows the finger within its ring; `spring` returns it
// to the centre on release (both do; the right one is the flick stick).
function stick(root, className, target) {
  const base = el('div', `tc-stick ${className}`, root);
  const knob = el('div', 'tc-knob', base);
  let pointer = null;
  let centre = [0, 0];
  const set = (x, y) => {
    const length = Math.hypot(x, y);
    if (length > 1) { x /= length; y /= length; }
    target[0] = Math.round(x * 32767);
    target[1] = Math.round(-y * 32767); // screen down = stick pulled back
    knob.style.transform = `translate(${x * 42}px, ${y * 42}px)`;
  };
  base.addEventListener('pointerdown', (event) => {
    pointer = event.pointerId;
    base.setPointerCapture(pointer);
    const rect = base.getBoundingClientRect();
    centre = [rect.left + rect.width / 2, rect.top + rect.height / 2];
    set((event.clientX - centre[0]) / (rect.width / 2), (event.clientY - centre[1]) / (rect.height / 2));
    event.preventDefault();
  });
  base.addEventListener('pointermove', (event) => {
    if (event.pointerId !== pointer) return;
    const radius = base.getBoundingClientRect().width / 2;
    set((event.clientX - centre[0]) / radius, (event.clientY - centre[1]) / radius);
  });
  const release = (event) => {
    if (event.pointerId !== pointer) return;
    pointer = null;
    set(0, 0);
  };
  base.addEventListener('pointerup', release);
  base.addEventListener('pointercancel', release);
}

function button(root, name, className, onDown, onUp) {
  const node = el('div', `tc-button ${className}`, root);
  node.dataset.glyph = name;
  node.textContent = name;
  node.addEventListener('pointerdown', (event) => {
    node.setPointerCapture(event.pointerId);
    node.classList.add('down');
    onDown();
    event.preventDefault();
  });
  const up = () => { node.classList.remove('down'); onUp(); };
  node.addEventListener('pointerup', up);
  node.addEventListener('pointercancel', up);
  return node;
}

// Skate 3's glyph art onto the buttons, read from the game data.
async function paintGlyphs(root, readFile) {
  try {
    const index = JSON.parse(new TextDecoder().decode(await readFile(GLYPHS)));
    for (const node of root.querySelectorAll('[data-glyph]')) {
      const glyph = index[node.dataset.glyph];
      if (!glyph) continue;
      const bytes = await readFile(`assets/private/frontend/${glyph.texture}`);
      if (!bytes) continue;
      const canvas = document.createElement('canvas');
      canvas.width = glyph.width;
      canvas.height = glyph.height;
      canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.length), glyph.width, glyph.height), 0, 0);
      node.style.backgroundImage = `url(${canvas.toDataURL()})`;
      node.textContent = '';
      node.classList.add('glyph');
    }
  } catch (error) {
    console.info('touch controls: Skate 3 button art unavailable', error && error.message);
  }
}

/// Build the controls once; CSS shows them only while skating on a touch screen.
export function installTouchControls(readFile) {
  if (!TOUCH_SCREEN) return;
  document.body.classList.add('touch-screen');
  const root = el('div', '', document.body);
  root.id = 'touch-controls';
  stick(root, 'tc-left', state.left);
  stick(root, 'tc-right', state.right);
  const press = (bit) => () => { state.buttons |= bit; };
  const lift = (bit) => () => { state.buttons &= ~bit; };
  for (const [name, className] of [['A', 'tc-a'], ['B', 'tc-b'], ['X', 'tc-x'], ['Y', 'tc-y'],
    ['LB', 'tc-lb'], ['RB', 'tc-rb'], ['START', 'tc-start'], ['BACK', 'tc-back']]) {
    button(root, name, className, press(XINPUT[name]), lift(XINPUT[name]));
  }
  button(root, 'LT', 'tc-lt', () => { state.lt = 255; }, () => { state.lt = 0; });
  button(root, 'RT', 'tc-rt', () => { state.rt = 255; }, () => { state.rt = 0; });
  // Nothing under the controls should scroll or zoom the page.
  root.addEventListener('touchmove', (event) => event.preventDefault(), { passive: false });
  paintGlyphs(root, readFile);
}
