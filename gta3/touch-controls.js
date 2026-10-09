(() => {
  "use strict";

  // Layout values are centralized here. They are logical short-side percentages;
  // JavaScript converts them to clamped pixels using the ACTUAL game viewport,
  // so controls stay usable on phones, tablets, Chromebooks, PCs and fullscreen.
  const TOUCH_CONFIG = {
    opacity: 0.66,
    transitionMs: 200,
    pollMs: 140,
    deadZone: 0.12,
    knobTravel: 0.40,
    haptics: true,

    // Sized against a typical 800-900 x 430-500 landscape phone:
    // joystick ~110-125px, action buttons ~58-65px,
    // steering ~65-72px, pedals ~78-85px and utility ~38-42px.
    joystick: { size: 28.0, knob: 12.0, left: 3.0, bottom: 4.0, zoneWidth: 50 },
    steering: { size: 19.0, gap: 2.0, left: 3.0, bottom: 4.5 },
    horn: { size: 11.5, left: 31.0, bottom: 26.0 },

    sprint: { size: 15.5, right: 3.0, bottom: 13.0 },
    action: { size: 15.5, right: 19.0, bottom: 34.0 },

    accelerate: { size: 21.0, right: 3.0, bottom: 10.0 },
    brake: { size: 21.0, right: 26.5, bottom: 10.0 },
    handbrake: { size: 13.5, right: 43.0, bottom: 34.0 },

    fire: { size: 13.5, right: 3.0, top: 13.0 },
    utility: { size: 9.5, gap: 1.8, right: 2.5, bottom: 2.0 },

    radar: { size: 15.0, left: 2.0, top: 2.0 },
    stats: { right: 2.2, top: 2.0 },

    // Baseline desktop targets. Responsive sizing may grow up to ~15% above
    // these values on large displays and shrink safely on compact screens.
    desktopPx: {
      joystick: 196,
      joystickKnob: 88,
      steering: 122,
      horn: 76,
      sprint: 104,
      action: 104,
      accelerate: 136,
      brake: 136,
      handbrake: 88,
      fire: 94,
      utility: 66,
      radar: 92,
    },
  };

  const CONTROL = Object.freeze({
    LEFT_X: 0,
    LEFT_Y: 1,
    CROSS: 2,
    SQUARE: 3,
    TRIANGLE: 4,
    CIRCLE: 5,
    R1: 6,
    L1: 7,
    LSHOCK: 8,
    SELECT: 9,
    START: 10,
    R2: 11,
    L2: 12,
  });

  // Crisp inline SVG icons: no icon font, CDN, image request or external dependency.
  // Every icon uses the same 32x32 grid and inherits the button's currentColor.
  const ICONS = {
    run: `<svg class="touch-icon touch-icon-run" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="20.5" cy="6.1" r="3.2" fill="currentColor"/>
      <path d="M17.4 11.2 22 14l5.1.8M17.4 11.2l-4.3 5.3-5.5 1.8m10.8-4.6-3.2 6.2-6.3 6.4m6.3-6.4 6.8 6.1"
        fill="none" stroke="currentColor" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,

    jump: `<svg class="touch-icon touch-icon-jump" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M7 12V4m0 0-4 4m4-4 4 4" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="20.5" cy="7.1" r="3" fill="currentColor"/>
      <path d="m17.5 12.2 4.6 3.4 5.2-.5m-9.8-2.9-4.3 5.7 5 3.5 3.5-4.7m-3.5 4.7-4.6 6m4.6-6 6 5"
        fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,

    car: `<svg class="touch-icon touch-icon-car" viewBox="0 0 32 32" aria-hidden="true">
      <path d="m6 15.2 3.1-7.1h13.8l3.1 7.1 2.4 2.1v7.2H25v-2.8H7v2.8H3.6v-7.2L6 15.2Z"
        fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/>
      <path d="M7.2 15.2h17.6M8.2 18.8h4m7.6 0h4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
      <circle cx="9.2" cy="23.2" r="1.4" fill="currentColor"/><circle cx="22.8" cy="23.2" r="1.4" fill="currentColor"/>
    </svg>`,

    exit: `<svg class="touch-icon touch-icon-exit" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M4.5 20.5v-8l2.3-5.4h11.4l2 4.6M7.2 16h10.2M7.5 20h3.6"
        fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M17 22h10m0 0-4-4m4 4-4 4" fill="none" stroke="currentColor" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,

    fist: `<svg class="touch-icon touch-icon-fist" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M9.2 15.5v-5.1a2.5 2.5 0 0 1 5 0v3.2-6.1a2.5 2.5 0 1 1 5 0v6.2-4.4a2.5 2.5 0 0 1 5 0v7.9c0 6.2-4 10.2-9.5 10.2-5 0-8.8-3.4-10.1-8l-1.1-3.7a2.5 2.5 0 0 1 4.6-1.8l3.1 4.4"
        fill="none" stroke="currentColor" stroke-width="2.35" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M9.2 13.5h15" fill="none" stroke="currentColor" stroke-width="2.35" stroke-linecap="round"/>
    </svg>`,

    gun: `<svg class="touch-icon touch-icon-gun" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M4.2 12h15.3l7 3.4-2.5 4.2h-7.5l-2.1 7.2H9.2l2.4-7.2H4.2V12Z"
        fill="none" stroke="currentColor" stroke-width="2.35" stroke-linejoin="round"/>
      <path d="M19.4 12V8.5h6M7 15.6h7.5" fill="none" stroke="currentColor" stroke-width="2.35" stroke-linecap="round"/>
    </svg>`,

    gas: `<svg class="touch-icon touch-icon-gas" viewBox="0 0 32 32" aria-hidden="true">
      <rect x="8.5" y="8" width="15" height="18" rx="4" fill="none" stroke="currentColor" stroke-width="2.3"/>
      <path d="M12 21.5 16 11l4 10.5M16 11v11.2" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="m16 5-3 3m3-3 3 3" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"/>
    </svg>`,

    brake: `<svg class="touch-icon touch-icon-brake" viewBox="0 0 32 32" aria-hidden="true">
      <rect x="8.5" y="7" width="15" height="19" rx="4" fill="none" stroke="currentColor" stroke-width="2.3"/>
      <path d="M12 12h8M11.5 16h9M12 20h8" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
    </svg>`,

    handbrake: `<svg class="touch-icon touch-icon-handbrake" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M5 24h14l6-13.5h2.5" fill="none" stroke="currentColor" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="m18.5 24 4.2 3M5 20v7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
      <circle cx="25.8" cy="9.6" r="2.3" fill="none" stroke="currentColor" stroke-width="2.2"/>
    </svg>`,

    horn: `<svg class="touch-icon touch-icon-horn" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M5 18h5.4l8.6 5.5v-15L10.4 14H5v4Z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/>
      <path d="M22.5 12.1c2.6 2.2 2.6 5.6 0 7.8m3.8-11.4c4.5 4.1 4.5 10.9 0 15"
        fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"/>
    </svg>`,

    grid: `<svg class="touch-icon touch-icon-weapons" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="11" fill="none" stroke="currentColor" stroke-width="2.2"/>
      <circle cx="16" cy="16" r="3" fill="none" stroke="currentColor" stroke-width="2.2"/>
      <path d="M16 5v6m0 10v6M5 16h6m10 0h6M8.2 8.2l4.2 4.2m7.2 7.2 4.2 4.2M23.8 8.2l-4.2 4.2m-7.2 7.2-4.2 4.2"
        fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/>
    </svg>`,

    map: `<svg class="touch-icon touch-icon-map" viewBox="0 0 32 32" aria-hidden="true">
      <path d="m4.5 7.5 7-3 9 3 7-3v20l-7 3-9-3-7 3v-20Z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>
      <path d="M11.5 4.5v20M20.5 7.5v20" fill="none" stroke="currentColor" stroke-width="2.2"/>
      <path d="M16 12.2a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm0 6v4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>`,

    left: `<svg class="touch-icon touch-icon-left" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M21.5 6.5 12 16l9.5 9.5" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,

    right: `<svg class="touch-icon touch-icon-right" viewBox="0 0 32 32" aria-hidden="true">
      <path d="m10.5 6.5 9.5 9.5-9.5 9.5" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,
  };

  const layoutMetrics = {
    width: Math.max(1, window.innerWidth || 1),
    height: Math.max(1, window.innerHeight || 1),
    short: Math.max(1, Math.min(window.innerWidth || 1, window.innerHeight || 1)),
    portrait: (window.innerHeight || 1) > (window.innerWidth || 1),
  };

  const getPlayfieldRect = () => {
    const viewport = document.getElementById("viewport");
    const rect = viewport?.getBoundingClientRect?.();
    if (rect && rect.width > 100 && rect.height > 100) return rect;

    const gameWindow = document.getElementById("game-window");
    const gameRect = gameWindow?.getBoundingClientRect?.();
    if (gameRect && gameRect.width > 100 && gameRect.height > 100) return gameRect;

    return {
      left: 0,
      top: 0,
      width: Math.max(1, window.innerWidth || 1),
      height: Math.max(1, window.innerHeight || 1),
    };
  };

  const updateLayoutMetrics = root => {
    const rect = getPlayfieldRect();
    layoutMetrics.width = Math.max(1, rect.width);
    layoutMetrics.height = Math.max(1, rect.height);
    layoutMetrics.short = Math.max(1, Math.min(rect.width, rect.height));
    layoutMetrics.portrait = rect.height > rect.width;

    if (root) {
      root.style.left = `${Math.round(rect.left)}px`;
      root.style.top = `${Math.round(rect.top)}px`;
      root.style.right = "auto";
      root.style.bottom = "auto";
      root.style.width = `${Math.round(rect.width)}px`;
      root.style.height = `${Math.round(rect.height)}px`;
      root.classList.toggle("touch-layout-portrait", layoutMetrics.portrait);
      root.classList.toggle("touch-layout-landscape", !layoutMetrics.portrait);
      root.classList.toggle("touch-layout-compact", layoutMetrics.short < 430);
      root.classList.toggle("touch-layout-large", layoutMetrics.short >= 800);
      root.style.setProperty("--touch-short-side", `${Math.round(layoutMetrics.short)}px`);
    }
  };

  const layoutUnit = n => `${Math.round(layoutMetrics.short * (n / 100))}px`;
  const vmin = layoutUnit;

  const controlSize = (logicalSize, desktopPx) => {
    const shortSide = layoutMetrics.short;
    const portraitScale = layoutMetrics.portrait ? 0.94 : 1;
    const compactBoost = shortSide < 430 ? 1.08 : shortSide < 560 ? 1.04 : 1;
    const largeScale = shortSide > 900 ? 0.94 : 1;
    const preferred = shortSide * (logicalSize / 100) * portraitScale * compactBoost * largeScale;

    if (!desktopPx) return `${Math.round(preferred)}px`;

    const minimum = Math.min(desktopPx * 0.60, shortSide * 0.32);
    const maximum = desktopPx * 1.15;
    return `${Math.round(Math.max(minimum, Math.min(maximum, preferred)))}px`;
  };

  const clampSensitivity = value => Math.max(50, Math.min(200, Number(value) || 100));
  let touchSensitivity = (() => {
    try {
      return clampSensitivity(window.GTA3_TOUCH_SENSITIVITY || localStorage.getItem("gta3.touchSensitivity") || 100);
    } catch {
      return 100;
    }
  })();
  const sensitivityMagnitude = magnitude => {
    const ratio = touchSensitivity / 100;
    const exponent = ratio >= 1
      ? 1 / (1 + (ratio - 1) * 0.9)
      : 1 + (1 - ratio) * 1.4;
    return Math.pow(Math.max(0, Math.min(1, magnitude)), exponent);
  };
  const pulseHaptic = () => {
    if (!TOUCH_CONFIG.haptics || typeof navigator.vibrate !== "function") return;
    try { navigator.vibrate(8); } catch {}
  };

  class TouchBridge {
    constructor() {
      this.module = null;
      this.setFn = null;
      this.resetFn = null;
      this.contextFn = null;
      this.weaponFn = null;
      this.healthFn = null;
      this.wantedFn = null;
      this.cashFn = null;
      this.clockFn = null;
    }

    connect() {
      const mod = window.re3Module;
      if (!mod || typeof mod.cwrap !== "function") return false;
      if (this.module === mod && this.setFn) return true;
      try {
        this.module = mod;
        this.setFn = mod.cwrap("re3_BrowserTouchSet", null, ["number", "number"]);
        this.resetFn = mod.cwrap("re3_BrowserTouchReset", null, []);
        this.contextFn = mod.cwrap("re3_BrowserTouchGetContext", "number", []);
        this.weaponFn = mod.cwrap("re3_BrowserTouchGetWeaponType", "number", []);
        this.healthFn = mod.cwrap("re3_BrowserTouchGetHealth", "number", []);
        this.wantedFn = mod.cwrap("re3_BrowserTouchGetWanted", "number", []);
        this.cashFn = mod.cwrap("re3_BrowserTouchGetCash", "number", []);
        this.clockFn = mod.cwrap("re3_BrowserTouchGetClock", "number", []);
        return true;
      } catch (err) {
        console.warn("[touch] native bridge unavailable", err);
        this.setFn = null;
        return false;
      }
    }

    set(control, value) {
      if (!this.setFn && !this.connect()) return;
      this.setFn(control, value);
    }

    reset() {
      if (!this.resetFn && !this.connect()) return;
      this.resetFn();
    }

    readStatus() {
      if (!this.connect()) return null;
      try {
        return {
          context: this.contextFn(),
          weapon: this.weaponFn(),
          health: this.healthFn(),
          wanted: this.wantedFn(),
          cash: this.cashFn(),
          clock: this.clockFn(),
        };
      } catch {
        return null;
      }
    }
  }

  class TouchButton {
    constructor({ parent, className = "", icon = "", label = "", shortLabel = "", onPress, onRelease }) {
      this.onPress = onPress || (() => {});
      this.onRelease = onRelease || (() => {});
      this.pointers = new Set();
      this.box = null;
      this.desktopPx = null;
      this.el = document.createElement("button");
      this.el.type = "button";
      this.el.className = `touch-control-btn ${className}`;
      this.el.innerHTML = icon;
      this.el.setAttribute("aria-label", label);
      if (shortLabel) this.el.dataset.shortLabel = shortLabel;
      parent.appendChild(this.el);
      this.bind();
    }

    bind() {
      this.el.addEventListener("pointerdown", e => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        this.el.setPointerCapture?.(e.pointerId);
        this.pointers.add(e.pointerId);
        this.el.classList.add("is-pressed");
        if (this.pointers.size === 1) {
          pulseHaptic();
          this.onPress(e);
        }
      });
      const release = e => {
        if (!this.pointers.has(e.pointerId)) return;
        e.preventDefault();
        e.stopPropagation();
        this.pointers.delete(e.pointerId);
        if (this.pointers.size === 0) {
          this.el.classList.remove("is-pressed");
          this.onRelease(e);
        }
      };
      this.el.addEventListener("pointerup", release);
      this.el.addEventListener("pointercancel", release);
      this.el.addEventListener("lostpointercapture", release);
      this.el.addEventListener("contextmenu", e => e.preventDefault());
    }

    setIcon(html, label) {
      this.el.innerHTML = html;
      if (label) this.el.setAttribute("aria-label", label);
    }

    setBox(box, desktopPx = null) {
      this.box = box;
      this.desktopPx = desktopPx;
      this.refreshBox();
    }

    refreshBox() {
      if (!this.box) return;
      const { size, left, right, top, bottom } = this.box;
      if (size != null) {
        const value = controlSize(size, this.desktopPx);
        this.el.style.width = value;
        this.el.style.height = value;
      }
      this.el.style.left = left != null ? vmin(left) : "";
      this.el.style.right = right != null ? vmin(right) : "";
      this.el.style.top = top != null ? vmin(top) : "";
      this.el.style.bottom = bottom != null ? vmin(bottom) : "";
    }

    forceRelease() {
      if (this.pointers.size > 0) {
        this.pointers.clear();
        this.el.classList.remove("is-pressed");
        this.onRelease({ forced: true });
      }
    }
  }

  class Joystick {
    constructor(parent, bridge) {
      this.bridge = bridge;
      this.pointerId = null;
      this.originX = 0;
      this.originY = 0;
      this.floating = false;

      // Invisible left-half activation surface. Touching anywhere here starts
      // movement and places the visual joystick under the player's thumb.
      this.zone = document.createElement("div");
      this.zone.className = "touch-joystick-zone on-foot-control";
      this.zone.setAttribute("aria-label", "Movement area");
      parent.appendChild(this.zone);

      this.base = document.createElement("div");
      this.base.className = "touch-joystick on-foot-control";
      this.knob = document.createElement("div");
      this.knob.className = "touch-joystick-knob";
      this.base.appendChild(this.knob);
      parent.appendChild(this.base);

      this.refreshLayout();
      this.bind();
    }

    bind() {
      const begin = e => {
        if (this.pointerId !== null) return;
        if (e.pointerType === "mouse" && e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();

        this.pointerId = e.pointerId;
        this.zone.setPointerCapture?.(e.pointerId);
        this.placeAtPointer(e);
        this.base.classList.add("is-engaged");
        pulseHaptic();
        this.update(e);
      };

      this.zone.addEventListener("pointerdown", begin);

      this.zone.addEventListener("pointermove", e => {
        if (e.pointerId !== this.pointerId) return;
        e.preventDefault();
        this.update(e);
      });

      const end = e => {
        if (e.pointerId !== this.pointerId) return;
        e.preventDefault();
        this.pointerId = null;
        this.base.classList.remove("is-active", "is-engaged");
        this.knob.style.transform = "translate(-50%,-50%)";
        this.bridge.set(CONTROL.LEFT_X, 0);
        this.bridge.set(CONTROL.LEFT_Y, 0);
        this.restoreIdlePosition();
      };

      this.zone.addEventListener("pointerup", end);
      this.zone.addEventListener("pointercancel", end);
      this.zone.addEventListener("lostpointercapture", end);
      this.zone.addEventListener("contextmenu", e => e.preventDefault());
    }

    placeAtPointer(e) {
      const rootRect = this.base.parentElement?.getBoundingClientRect?.();
      if (!rootRect) return;

      const size = this.base.getBoundingClientRect().width || parseFloat(this.base.style.width) || 100;
      const half = size / 2;
      const margin = Math.max(8, layoutMetrics.short * 0.015);
      const maxCenterX = Math.max(half + margin, layoutMetrics.width * 0.5 - half - margin);
      const maxCenterY = Math.max(half + margin, layoutMetrics.height - half - margin);

      const localX = e.clientX - rootRect.left;
      const localY = e.clientY - rootRect.top;
      const cx = Math.max(half + margin, Math.min(maxCenterX, localX));
      const cy = Math.max(half + margin, Math.min(maxCenterY, localY));

      this.originX = cx;
      this.originY = cy;
      this.floating = true;

      this.base.style.left = `${Math.round(cx - half)}px`;
      this.base.style.top = `${Math.round(cy - half)}px`;
      this.base.style.right = "auto";
      this.base.style.bottom = "auto";
    }

    update(e) {
      const rootRect = this.base.parentElement?.getBoundingClientRect?.();
      if (!rootRect) return;

      const dx = (e.clientX - rootRect.left) - this.originX;
      const dy = (e.clientY - rootRect.top) - this.originY;
      const r = this.base.getBoundingClientRect();
      const max = r.width * TOUCH_CONFIG.knobTravel;
      const rawLen = Math.hypot(dx, dy);
      const len = rawLen || 1;
      const visualScale = Math.min(1, max / len);
      const px = dx * visualScale;
      const py = dy * visualScale;

      const rawMagnitude = Math.min(1, rawLen / max);
      const deadZone = TOUCH_CONFIG.deadZone;
      let outputMagnitude = 0;
      if (rawMagnitude > deadZone) {
        const normalized = (rawMagnitude - deadZone) / (1 - deadZone);
        outputMagnitude = sensitivityMagnitude(normalized);
      }

      const dirX = rawLen > 0 ? dx / rawLen : 0;
      const dirY = rawLen > 0 ? dy / rawLen : 0;
      const sx = dirX * outputMagnitude;
      const sy = dirY * outputMagnitude;

      this.base.classList.toggle("is-active", rawMagnitude > deadZone);
      this.knob.style.transform = `translate(calc(-50% + ${px}px),calc(-50% + ${py}px))`;
      this.bridge.set(CONTROL.LEFT_X, Math.round(sx * 127));
      this.bridge.set(CONTROL.LEFT_Y, Math.round(sy * 127));
    }

    refreshLayout() {
      const cfg = TOUCH_CONFIG.joystick;
      const size = controlSize(cfg.size, TOUCH_CONFIG.desktopPx.joystick);
      this.base.style.width = this.base.style.height = size;
      this.knob.style.width = this.knob.style.height = controlSize(cfg.knob, TOUCH_CONFIG.desktopPx.joystickKnob);

      this.zone.style.left = "0";
      this.zone.style.top = "0";
      this.zone.style.bottom = "0";
      this.zone.style.width = `${cfg.zoneWidth || 50}%`;

      if (this.pointerId === null) this.restoreIdlePosition();
    }

    restoreIdlePosition() {
      const cfg = TOUCH_CONFIG.joystick;
      this.floating = false;
      this.base.style.left = vmin(cfg.left);
      this.base.style.bottom = vmin(cfg.bottom);
      this.base.style.top = "auto";
      this.base.style.right = "auto";
    }

    reset() {
      this.pointerId = null;
      this.base.classList.remove("is-active", "is-engaged");
      this.knob.style.transform = "translate(-50%,-50%)";
      this.bridge.set(CONTROL.LEFT_X, 0);
      this.bridge.set(CONTROL.LEFT_Y, 0);
      this.restoreIdlePosition();
    }
  }

  class SteeringPair {
    constructor(parent, bridge) {
      this.bridge = bridge;
      this.leftDown = false;
      this.rightDown = false;
      this.wrap = document.createElement("div");
      this.wrap.className = "touch-steering vehicle-control";
      parent.appendChild(this.wrap);

      const cfg = TOUCH_CONFIG.steering;

      this.left = new TouchButton({
        parent: this.wrap,
        className: "touch-steer-btn",
        icon: ICONS.left,
        label: "Steer left",
        onPress: () => { this.leftDown = true; this.sync(); },
        onRelease: () => { this.leftDown = false; this.sync(); },
      });
      this.right = new TouchButton({
        parent: this.wrap,
        className: "touch-steer-btn",
        icon: ICONS.right,
        label: "Steer right",
        onPress: () => { this.rightDown = true; this.sync(); },
        onRelease: () => { this.rightDown = false; this.sync(); },
      });
      for (const b of [this.left, this.right]) {
        b.el.style.position = "relative";
      }
      this.refreshLayout();
    }

    refreshLayout() {
      const cfg = TOUCH_CONFIG.steering;
      this.wrap.style.left = vmin(cfg.left);
      this.wrap.style.bottom = vmin(cfg.bottom);
      this.wrap.style.gap = vmin(cfg.gap);
      for (const b of [this.left, this.right]) {
        b.el.style.width = b.el.style.height = controlSize(cfg.size, TOUCH_CONFIG.desktopPx.steering);
      }
    }

    sync() {
      let value = 0;
      if (this.leftDown !== this.rightDown) value = this.leftDown ? -127 : 127;
      this.bridge.set(CONTROL.LEFT_X, value);
    }

    reset() {
      this.leftDown = this.rightDown = false;
      this.sync();
    }
  }

  class TouchHUD {
    constructor() {
      this.bridge = new TouchBridge();
      this.mode = "foot";
      this.context = 0;
      this.enabledMode = window.GTA3_TOUCH_CONTROLS_MODE || "auto";
      this.root = null;
      this.statusTimer = 0;
      this.lastStatus = null;
      this.build();
      this.bindGlobal();
      this.refreshVisibility();
      this.startPolling();
    }

    build() {
      const gameWindow = document.getElementById("game-window");
      if (!gameWindow || document.getElementById("gta3-touch-hud")) return;

      const root = document.createElement("div");
      root.id = "gta3-touch-hud";
      root.className = "touch-hud mode-foot";
      root.style.setProperty("--touch-opacity", String(TOUCH_CONFIG.opacity));
      root.style.setProperty("--touch-transition", `${TOUCH_CONFIG.transitionMs}ms`);
      gameWindow.appendChild(root);
      this.root = root;
      updateLayoutMetrics(root);

      // Informational HUD frames. The native GTA HUD remains visible through them.
      this.radar = document.createElement("div");
      this.radar.className = "touch-radar-frame";
      this.radar.innerHTML = '<span class="touch-radar-n">N</span>';
      const rc = TOUCH_CONFIG.radar;
      const radarSize = controlSize(rc.size, TOUCH_CONFIG.desktopPx.radar);
      Object.assign(this.radar.style, { width:radarSize, height:radarSize, left:vmin(rc.left), top:vmin(rc.top) });
      root.appendChild(this.radar);

      this.stats = document.createElement("div");
      this.stats.className = "touch-stats";
      this.stats.style.right = vmin(TOUCH_CONFIG.stats.right);
      this.stats.style.top = vmin(TOUCH_CONFIG.stats.top);
      this.stats.innerHTML = `
        <div class="touch-stat-time">--:--</div>
        <div class="touch-stat-cash">$00000000</div>
        <div class="touch-stat-health">♥ <span>100</span></div>
        <div class="touch-stat-stars">☆☆☆☆☆☆</div>`;
      root.appendChild(this.stats);

      this.joystick = new Joystick(root, this.bridge);
      this.steering = new SteeringPair(root, this.bridge);

      this.sprint = this.makeHold("on-foot-control sprint-btn", ICONS.run, "Sprint", CONTROL.CROSS, TOUCH_CONFIG.sprint, "RUN");
      this.action = new TouchButton({
        parent: root,
        className: "touch-action-btn",
        icon: ICONS.jump,
        label: "Jump or context action",
        shortLabel: "ACTION",
        onPress: () => this.pressAction(true),
        onRelease: () => this.pressAction(false),
      });
      this.action.setBox(TOUCH_CONFIG.action, TOUCH_CONFIG.desktopPx.action);

      this.accelerate = this.makeHold("vehicle-control accelerate-btn", ICONS.gas, "Accelerate", CONTROL.CROSS, TOUCH_CONFIG.accelerate, "GAS");
      this.brake = this.makeHold("vehicle-control brake-btn", ICONS.brake, "Brake or reverse", CONTROL.SQUARE, TOUCH_CONFIG.brake, "BRAKE");
      this.handbrake = this.makeHold("vehicle-control handbrake-btn", ICONS.handbrake, "Handbrake", CONTROL.R1, TOUCH_CONFIG.handbrake, "HB");
      this.horn = this.makeHold("vehicle-control horn-btn", ICONS.horn, "Horn", CONTROL.LSHOCK, TOUCH_CONFIG.horn, "HORN");

      this.fire = this.makeHold("touch-fire-btn", ICONS.fist, "Attack or fire", CONTROL.CIRCLE, TOUCH_CONFIG.fire, "FIRE");

      this.utility = document.createElement("div");
      this.utility.className = "touch-utility";
      this.utility.style.right = vmin(TOUCH_CONFIG.utility.right);
      this.utility.style.bottom = vmin(TOUCH_CONFIG.utility.bottom);
      this.utility.style.gap = vmin(TOUCH_CONFIG.utility.gap);
      root.appendChild(this.utility);

      this.weaponCycle = this.makeTapIn(this.utility, ICONS.grid, "Cycle weapon", CONTROL.R2);
      this.pause = this.makeTapIn(this.utility, ICONS.map, "Pause or menu", CONTROL.START);
      for (const b of [this.weaponCycle, this.pause]) {
        b.el.style.position = "relative";
        b.el.style.width = b.el.style.height = controlSize(TOUCH_CONFIG.utility.size, TOUCH_CONFIG.desktopPx.utility);
      }
    }

    makeHold(className, icon, label, control, box, shortLabel = "") {
      const b = new TouchButton({
        parent: this.root,
        className,
        icon,
        label,
        shortLabel,
        onPress: () => this.bridge.set(control, 1),
        onRelease: () => this.bridge.set(control, 0),
      });
      const desktopKey = className.includes("accelerate-btn") ? "accelerate"
        : className.includes("brake-btn") ? "brake"
        : className.includes("handbrake-btn") ? "handbrake"
        : className.includes("horn-btn") ? "horn"
        : className.includes("sprint-btn") ? "sprint"
        : className.includes("touch-fire-btn") ? "fire"
        : null;
      b.setBox(box, desktopKey ? TOUCH_CONFIG.desktopPx[desktopKey] : null);
      return b;
    }

    makeTapIn(parent, icon, label, control) {
      return new TouchButton({
        parent,
        className: "touch-utility-btn",
        icon,
        label,
        onPress: () => this.bridge.set(control, 1),
        onRelease: () => this.bridge.set(control, 0),
      });
    }

    pressAction(down) {
      const control = (this.mode === "vehicle" || this.context === 1) ? CONTROL.TRIANGLE : CONTROL.SQUARE;
      this.bridge.set(control, down ? 1 : 0);
    }

    bindGlobal() {
      window.addEventListener("gta3-launcher-ready", () => this.bridge.connect());
      window.addEventListener("gta3-touch-controls-change", e => {
        this.enabledMode = e.detail?.mode || "auto";
        this.refreshVisibility();
      });
      window.addEventListener("gta3-touch-sensitivity-change", e => {
        touchSensitivity = clampSensitivity(e.detail?.value);
      });
      const scheduleLayout = () => {
        window.cancelAnimationFrame(this.layoutFrame || 0);
        this.layoutFrame = window.requestAnimationFrame(() => {
          this.refreshVisibility();
          this.refreshLayout();
        });
      };

      window.addEventListener("resize", scheduleLayout);
      window.addEventListener("orientationchange", () => window.setTimeout(scheduleLayout, 120));
      document.addEventListener("fullscreenchange", () => window.setTimeout(scheduleLayout, 60));
      window.visualViewport?.addEventListener?.("resize", scheduleLayout);

      const gameWindow = document.getElementById("game-window");
      const viewport = document.getElementById("viewport");
      if (typeof ResizeObserver === "function") {
        this.resizeObserver = new ResizeObserver(scheduleLayout);
        if (gameWindow) this.resizeObserver.observe(gameWindow);
        if (viewport) this.resizeObserver.observe(viewport);
      }
      if (typeof MutationObserver === "function" && gameWindow) {
        this.gameWindowObserver = new MutationObserver(() => window.setTimeout(scheduleLayout, 0));
        this.gameWindowObserver.observe(gameWindow, { attributes:true, attributeFilter:["class","style"] });
      }

      window.addEventListener("blur", () => this.resetAll());
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) this.resetAll();
      });
    }

    isMobileDevice() {
      const userAgent = navigator.userAgent || "";
      const platform = navigator.userAgentData?.platform || navigator.platform || "";
      return navigator.userAgentData?.mobile === true
        || /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)
        || (/MacIntel/i.test(platform) && navigator.maxTouchPoints > 1);
    }

    refreshLayout() {
      updateLayoutMetrics(this.root);

      this.joystick?.refreshLayout();
      this.steering?.refreshLayout();

      if (this.radar) {
        const radarSize = controlSize(TOUCH_CONFIG.radar.size, TOUCH_CONFIG.desktopPx.radar);
        this.radar.style.width = radarSize;
        this.radar.style.height = radarSize;
        this.radar.style.left = vmin(TOUCH_CONFIG.radar.left);
        this.radar.style.top = vmin(TOUCH_CONFIG.radar.top);
      }

      if (this.stats) {
        this.stats.style.right = vmin(TOUCH_CONFIG.stats.right);
        this.stats.style.top = vmin(TOUCH_CONFIG.stats.top);
      }

      if (this.utility) {
        this.utility.style.right = vmin(TOUCH_CONFIG.utility.right);
        this.utility.style.bottom = vmin(TOUCH_CONFIG.utility.bottom);
        this.utility.style.gap = vmin(TOUCH_CONFIG.utility.gap);
      }

      for (const button of [
        this.sprint, this.action, this.accelerate, this.brake,
        this.handbrake, this.horn, this.fire, this.weaponCycle, this.pause
      ]) {
        button?.refreshBox?.();
      }

      for (const button of [this.weaponCycle, this.pause]) {
        if (button?.el) {
          const size = controlSize(TOUCH_CONFIG.utility.size, TOUCH_CONFIG.desktopPx.utility);
          button.el.style.width = size;
          button.el.style.height = size;
        }
      }
    }

    refreshVisibility() {
      if (!this.root) return;
      const enabled = this.isMobileDevice();
      this.root.classList.toggle("touch-disabled", !enabled);
      this.root.setAttribute("aria-hidden", enabled ? "false" : "true");
    }

    startPolling() {
      const tick = () => {
        const status = this.bridge.readStatus();
        if (status) this.applyStatus(status);
      };
      tick();
      this.statusTimer = window.setInterval(tick, TOUCH_CONFIG.pollMs);
    }

    applyStatus(status) {
      this.lastStatus = status;
      this.context = status.context | 0;
      const nextMode = this.context === 2 ? "vehicle" : "foot";
      if (nextMode !== this.mode) this.setMode(nextMode);

      if (this.mode === "vehicle") {
        this.action.setIcon(ICONS.exit, "Exit vehicle");
      } else if (this.context === 1) {
        this.action.setIcon(ICONS.car, "Enter nearby vehicle");
      } else {
        this.action.setIcon(ICONS.jump, "Jump");
      }

      this.fire.setIcon(status.weapon > 0 ? ICONS.gun : ICONS.fist, status.weapon > 0 ? "Fire weapon" : "Attack");

      const clock = String(Math.max(0, status.clock | 0)).padStart(4, "0");
      const hh = clock.slice(0, 2);
      const mm = clock.slice(2, 4);
      this.stats.querySelector(".touch-stat-time").textContent = `${hh}:${mm}`;
      this.stats.querySelector(".touch-stat-cash").textContent = `$${String(Math.max(0, status.cash | 0)).padStart(8, "0")}`;
      this.stats.querySelector(".touch-stat-health span").textContent = String(Math.max(0, status.health | 0)).padStart(3, "0");
      const wanted = Math.max(0, Math.min(6, status.wanted | 0));
      this.stats.querySelector(".touch-stat-stars").textContent = "★".repeat(wanted) + "☆".repeat(6 - wanted);
    }

    setMode(mode) {
      this.resetAll();
      this.mode = mode;
      this.root.classList.toggle("mode-foot", mode === "foot");
      this.root.classList.toggle("mode-vehicle", mode === "vehicle");
    }

    resetAll() {
      this.bridge.reset();
      this.joystick?.reset();
      this.steering?.reset();
      for (const button of [
        this.sprint, this.action, this.accelerate, this.brake,
        this.handbrake, this.horn, this.fire, this.weaponCycle, this.pause
      ]) {
        button?.forceRelease?.();
      }
      this.root?.querySelectorAll(".is-pressed").forEach(el => el.classList.remove("is-pressed"));
    }
  }

  function bootTouchHUD() {
    if (document.getElementById("gta3-touch-hud")) return;
    new TouchHUD();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootTouchHUD, { once:true });
  } else {
    bootTouchHUD();
  }

  window.GTA3TouchControls = { TOUCH_CONFIG, CONTROL, layoutMetrics, refreshLayout: updateLayoutMetrics };
})();
