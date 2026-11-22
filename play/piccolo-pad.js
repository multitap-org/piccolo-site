// The core page's touch gamepad (src/web_pad.h): buttons drawn in HTML
// under the picture (a phone upright) or beside it (sideways), so the
// picture keeps the whole canvas and nothing covers it. One fixed layout per
// core (body data-pad: gb or snes), no editor. Every finger is followed on
// its own (pointer events): one per button, sliding from one to the next,
// the d-pad in eight directions. What's held goes to piccolo as RetroPad
// bits (piccolo_web_pad_state), a controller in its input router like any
// pad (START joins a port). MENU (bit 17) opens piccolo's MAIN MENU, QUICK
// (bit 16) its QUICK MENU (never a core's: without a keyboard they're the
// only way there; in the menus the pad moves, B accepts, A goes back,
// START opens the menu bar). Shown on touch
// screens and hidden while a real gamepad is in use; PAD in the strip shows
// or hides it anywhere (remembered).
//
// Speed: a phone sends a finger's moves 120-240 times a second, on the same
// thread as the emulator. A move only does arithmetic against the buttons'
// rectangles, measured once per layout change; the page is touched only when
// what's held changes.

'use strict';

// RETRO_DEVICE_ID_JOYPAD_* as bits.
// QUICK and MENU are piccolo's own (WEB_PAD_QUICK_MENU_BIT, WEB_PAD_MAIN_MENU_BIT in src/web_pad.h).
const PICCOLO_PAD_BIT = { B: 0, Y: 1, SELECT: 2, START: 3, UP: 4, DOWN: 5, LEFT: 6, RIGHT: 7, A: 8, X: 9, L: 10, R: 11,
                          QUICK: 16, MENU: 17 };
const PICCOLO_PAD_SHOWN_KEY = 'piccolo-pad-shown';
const PICCOLO_PAD_DEADZONE = 0.3;   // of the d-pad's half size: closer to its middle is no direction

const piccolo_pad = {
  shown: false,
  fingers: new Map(),   // pointerId -> bits that finger holds
  sent: 0,              // the bits piccolo has
  attached: false,      // piccolo took the show / hide (its router exists)
  targets: null,        // [{ element, bits, dpad, left, top, right, bottom }] (null: measure again)
  lit: 0,               // the bits drawn as held
  wanted: false,        // shown unless a gamepad is in use (PAD's choice, or the default)
  gamepads: 0,          // real gamepads connected
};

function piccolo_pad_bits(names) {
  let bits = 0;
  for (const name of names) {
    bits |= 1 << PICCOLO_PAD_BIT[name];
  }
  return bits;
}

function piccolo_pad_button(label, names, kind) {
  const button = document.createElement('div');
  button.className = 'pad-button ' + kind;
  button.textContent = label;
  button.dataset.bits = String(piccolo_pad_bits(names));
  return button;
}

// The two halves: d-pad side and buttons side, each with its shoulder on top
// (SNES); SELECT / START under them.
function piccolo_pad_build(kind) {
  const left = document.getElementById('pad-left');
  const right = document.getElementById('pad-right');
  left.textContent = '';
  right.textContent = '';
  const snes = kind === 'snes';
  if (snes) {
    left.appendChild(piccolo_pad_button('L', ['L'], 'shoulder'));
    right.appendChild(piccolo_pad_button('R', ['R'], 'shoulder'));
  }
  const dpad = document.createElement('div');
  dpad.className = 'dpad';
  dpad.innerHTML = '<span class="up"></span><span class="left"></span><span class="right"></span><span class="down"></span>';
  left.appendChild(dpad);
  const face = document.createElement('div');
  face.className = snes ? 'face four' : 'face two';
  if (snes) {
    face.appendChild(piccolo_pad_button('X', ['X'], 'round x'));
    face.appendChild(piccolo_pad_button('Y', ['Y'], 'round y'));
    face.appendChild(piccolo_pad_button('A', ['A'], 'round a'));
    face.appendChild(piccolo_pad_button('B', ['B'], 'round b'));
  } else {
    face.appendChild(piccolo_pad_button('B', ['B'], 'round b'));
    face.appendChild(piccolo_pad_button('A', ['A'], 'round a'));
  }
  right.appendChild(face);
  // MENU at the top of the d-pad's side, QUICK at the top of the buttons' side.
  left.insertBefore(piccolo_pad_button('MENU', ['MENU'], 'meta menu'), left.firstChild);
  right.insertBefore(piccolo_pad_button('QUICK', ['QUICK'], 'meta menu'), right.firstChild);
  // SELECT / START: sideways at the bottom of each half; upright close
  // together in the middle, under the d-pad and the buttons (the CSS shows
  // one of the two).
  left.appendChild(piccolo_pad_button('SELECT', ['SELECT'], 'meta sideways'));
  right.appendChild(piccolo_pad_button('START', ['START'], 'meta sideways'));
  const meta = document.getElementById('pad-meta');
  meta.textContent = '';
  meta.appendChild(piccolo_pad_button('SELECT', ['SELECT'], 'meta upright'));
  meta.appendChild(piccolo_pad_button('START', ['START'], 'meta upright'));
}

// The buttons and the d-pad where they are now (only shown ones: a hidden
// one has an empty rectangle). Measured again after any layout change.
function piccolo_pad_measure() {
  const targets = [];
  for (const element of document.querySelectorAll('#main .pad-button, #main .dpad')) {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      continue;
    }
    targets.push({
      element: element,
      bits: element.classList.contains('dpad') ? 0 : Number(element.dataset.bits),
      dpad: element.classList.contains('dpad'),
      left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
    });
  }
  piccolo_pad.targets = targets;
}

function piccolo_pad_forget_layout() {
  piccolo_pad.targets = null;
}

// The d-pad's directions at a point inside it (eight ways).
function piccolo_pad_dpad_bits(target, x, y) {
  const width = target.right - target.left;
  const height = target.bottom - target.top;
  const half = Math.min(width, height) / 2;
  const dx = (x - (target.left + width / 2)) / half;
  const dy = (y - (target.top + height / 2)) / half;
  let bits = 0;
  if (dx < -PICCOLO_PAD_DEADZONE) bits |= 1 << PICCOLO_PAD_BIT.LEFT;
  if (dx > PICCOLO_PAD_DEADZONE) bits |= 1 << PICCOLO_PAD_BIT.RIGHT;
  if (dy < -PICCOLO_PAD_DEADZONE) bits |= 1 << PICCOLO_PAD_BIT.UP;
  if (dy > PICCOLO_PAD_DEADZONE) bits |= 1 << PICCOLO_PAD_BIT.DOWN;
  return bits;
}

// What a finger at (x, y) holds: the button or d-pad under it.
function piccolo_pad_bits_at(x, y) {
  if (piccolo_pad.targets === null) {
    piccolo_pad_measure();
  }
  for (const target of piccolo_pad.targets) {
    if (x >= target.left && x < target.right && y >= target.top && y < target.bottom) {
      return target.dpad ? piccolo_pad_dpad_bits(target, x, y) : target.bits;
    }
  }
  return 0;
}

// Everything held: lit on the page, sent to piccolo when it changed (a
// short buzz for a new press, where the browser can).
function piccolo_pad_update() {
  let bits = 0;
  for (const held of piccolo_pad.fingers.values()) {
    bits |= held;
  }
  if (bits !== piccolo_pad.lit) {
    piccolo_pad_light(bits);
  }
  if (bits === piccolo_pad.sent) {
    return;
  }
  if ((bits & ~piccolo_pad.sent) !== 0 && navigator.vibrate) {
    navigator.vibrate(12);
  }
  piccolo_pad.sent = bits;
  if (typeof Module !== 'undefined' && Module.ccall && piccolo_pad.attached) {
    Module.ccall('piccolo_web_pad_state', null, ['number'], [bits]);
  }
}

// Draws what's held (only called when it changed).
function piccolo_pad_light(bits) {
  piccolo_pad.lit = bits;
  for (const button of document.querySelectorAll('#main .pad-button')) {
    button.classList.toggle('held', (bits & Number(button.dataset.bits)) !== 0);
  }
  for (const name of ['up', 'down', 'left', 'right']) {
    const arrow = document.querySelector('#main .dpad .' + name);
    if (arrow !== null) {
      arrow.classList.toggle('held', (bits & (1 << PICCOLO_PAD_BIT[name.toUpperCase()])) !== 0);
    }
  }
}

function piccolo_pad_finger(event) {
  event.preventDefault();
  if (event.type === 'pointerup' || event.type === 'pointercancel') {
    piccolo_pad.fingers.delete(event.pointerId);
  } else {
    if (event.type === 'pointerdown') {
      // Its moves keep coming here wherever it goes (sliding off a button).
      event.target.setPointerCapture(event.pointerId);
    }
    piccolo_pad.fingers.set(event.pointerId, piccolo_pad_bits_at(event.clientX, event.clientY));
  }
  piccolo_pad_update();
}

// Tells piccolo the pad is there (or not); before main() set up its router
// it can't take it yet: tried again shortly.
function piccolo_pad_tell() {
  // The export is there once the module is instantiated; calling it before
  // main() is harmless (it answers 0 until the router exists).
  if (typeof Module === 'undefined' || !Module.ccall || typeof Module._piccolo_web_pad_show !== 'function') {
    setTimeout(piccolo_pad_tell, 250);
    return;
  }
  if (Module.ccall('piccolo_web_pad_show', 'number', ['number'], [piccolo_pad.shown ? 1 : 0]) === 0) {
    setTimeout(piccolo_pad_tell, 250);
    return;
  }
  piccolo_pad.attached = true;
  piccolo_pad.sent = -1;   // send the state again
  piccolo_pad_update();
}

// Shown when wanted and no gamepad is in use.
function piccolo_pad_follow() {
  const shown = piccolo_pad.wanted && piccolo_pad.gamepads === 0;
  if (shown === piccolo_pad.shown && piccolo_pad.attached) {
    return;
  }
  piccolo_pad_set_shown(shown);
}

// PAD's choice (remembered).
function piccolo_pad_set_wanted(wanted) {
  piccolo_pad.wanted = wanted;
  try {
    localStorage.setItem(PICCOLO_PAD_SHOWN_KEY, wanted ? '1' : '0');
  } catch (error) {
    // Not remembered: fine.
  }
  if (wanted) {
    piccolo_pad.gamepads = 0;   // PAD pressed by hand: shown even with a gamepad there
  }
  piccolo_pad_follow();
}

function piccolo_pad_set_shown(shown) {
  piccolo_pad.shown = shown;
  document.body.classList.toggle('has-pad', shown);
  document.getElementById('pad-toggle').classList.toggle('active', shown);
  piccolo_pad.fingers.clear();
  // Upright, the pad takes the place under the game where FILES was open.
  const files = document.getElementById('files');
  if (shown && window.matchMedia('(orientation: portrait)').matches && files !== null &&
      !files.classList.contains('closed') && typeof piccolo_files_set_open === 'function') {
    piccolo_files_set_open(false);
  }
  piccolo_pad_forget_layout();
  piccolo_pad_tell();
}

// Before the module starts: the layout is there from the first frame (the
// stage's size depends on it).
function piccolo_pad_start() {
  piccolo_pad_build(document.body.dataset.pad === 'snes' ? 'snes' : 'gb');
  for (const id of ['pad-left', 'pad-right', 'pad-meta']) {
    const half = document.getElementById(id);
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
      half.addEventListener(type, piccolo_pad_finger);
    }
    half.addEventListener('contextmenu', function (event) { event.preventDefault(); });
  }
  let shown = window.matchMedia('(pointer: coarse)').matches;
  try {
    const value = localStorage.getItem(PICCOLO_PAD_SHOWN_KEY);
    if (value !== null) {
      shown = value === '1';
    }
  } catch (error) {
    // The default.
  }
  document.getElementById('pad-toggle').addEventListener('click', function () {
    piccolo_pad_set_wanted(!piccolo_pad.shown);
  });
  // Any layout change moves the buttons: measured again at the next touch.
  const observer = new ResizeObserver(piccolo_pad_forget_layout);
  for (const id of ['main', 'pad-left', 'pad-right', 'pad-meta']) {
    observer.observe(document.getElementById(id));
  }
  window.addEventListener('resize', piccolo_pad_forget_layout);
  window.addEventListener('scroll', piccolo_pad_forget_layout, true);
  // A real gamepad in use (the browser tells only after its first press):
  // the screen's pad steps aside, and comes back when none is left.
  window.addEventListener('gamepadconnected', function () {
    piccolo_pad.gamepads++;
    piccolo_pad_follow();
  });
  window.addEventListener('gamepaddisconnected', function () {
    piccolo_pad.gamepads = Math.max(0, piccolo_pad.gamepads - 1);
    piccolo_pad_follow();
  });
  piccolo_pad.wanted = shown;
  piccolo_pad_set_shown(shown);
}
