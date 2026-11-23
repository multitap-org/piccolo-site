// The touch gamepad of piccolo's and piccoletto's pages: buttons drawn in
// HTML under the picture (a screen upright) or beside it (sideways), so the
// picture keeps the whole canvas and nothing covers it. One fixed layout
// (gb or snes), no editor. Every finger is followed on its own (pointer
// events): one per button, sliding from one to the next, the d-pad in eight
// directions. What's held goes to the program as RetroPad bits (an export
// the page names: piccolo_web_pad_state, piccoletto_web_pad), a controller
// like any pad (START joins a port). "..." (bit 16) opens the program's
// quick menu, HOME (bit 17, piccolo only) its main menu. Shown on touch
// screens and hidden while a real gamepad is in use; PAD in the strip shows
// or hides it anywhere (remembered).
//
// Moved here from piccolo's web/page/piccolo-pad.js (2026-11-22) so
// piccoletto's page uses the same one. The page has, inside its `root`:
// #pad-left, #pad-right, #pad-meta; and its own CSS for .pad, .pad-button,
// .dpad, .face (piccolo's core.html, piccoletto's index.html).
//
// Speed: a phone sends a finger's moves 120-240 times a second, on the same
// thread as the program. A move only does arithmetic against the buttons'
// rectangles, measured once per layout change; the page is touched only when
// what's held changes.

'use strict';

// RETRO_DEVICE_ID_JOYPAD_* as bits; QUICK and MENU are the programs' own.
const MULTITAP_PAD_BIT = { B: 0, Y: 1, SELECT: 2, START: 3, UP: 4, DOWN: 5, LEFT: 6, RIGHT: 7, A: 8, X: 9, L: 10, R: 11,
                           QUICK: 16, MENU: 17 };
const MULTITAP_PAD_DEADZONE = 0.3;   // of the d-pad's half size: closer to its middle is no direction
const MULTITAP_PAD_BUZZ_MS = 20;     // a press's buzz (piccolo's own touch pad: haptics.cpp BUZZ_MS)
const MULTITAP_PAD_BOTH_REACH = 0.62;   // A + B: closer than this share of the distance between their centres to each

const multitap_pad = {
  options: null,        // multitap_pad_start's
  shown: false,
  allowed: true,        // the program wants a pad now (piccoletto: only in its modes)
  fingers: new Map(),   // pointerId -> bits that finger holds
  sent: 0,              // the bits the program has
  vibrate: true,        // the program's VIBRATE setting (multitap_pad_set_vibrate)
  attached: false,      // the program took the show / hide (its export answered)
  targets: null,        // [{ element, bits, dpad, left, top, right, bottom }] (null: measure again)
  lit: 0,               // the bits drawn as held
  wanted: false,        // shown unless a gamepad is in use (PAD's choice, or the default)
  gamepads: 0,          // real gamepads connected
};

function multitap_pad_bits(names) {
  let bits = 0;
  for (const name of names) {
    bits |= 1 << MULTITAP_PAD_BIT[name];
  }
  return bits;
}

function multitap_pad_button(label, names, kind) {
  const button = document.createElement('div');
  button.className = 'pad-button ' + kind;
  button.textContent = label;
  button.dataset.bits = String(multitap_pad_bits(names));
  return button;
}

// The two halves: d-pad side and buttons side, each with its shoulder on top
// (SNES); SELECT / START under them.
function multitap_pad_build(kind) {
  const left = document.getElementById('pad-left');
  const right = document.getElementById('pad-right');
  left.textContent = '';
  right.textContent = '';
  const snes = kind === 'snes';
  if (snes) {
    left.appendChild(multitap_pad_button('L', ['L'], 'shoulder'));
    right.appendChild(multitap_pad_button('R', ['R'], 'shoulder'));
  }
  const dpad = document.createElement('div');
  dpad.className = 'dpad';
  dpad.innerHTML = '<span class="up"></span><span class="left"></span><span class="right"></span><span class="down"></span>';
  left.appendChild(dpad);
  const face = document.createElement('div');
  face.className = snes ? 'face four' : 'face two';
  if (snes) {
    face.appendChild(multitap_pad_button('X', ['X'], 'round x'));
    face.appendChild(multitap_pad_button('Y', ['Y'], 'round y'));
    face.appendChild(multitap_pad_button('A', ['A'], 'round a'));
    face.appendChild(multitap_pad_button('B', ['B'], 'round b'));
  } else {
    face.appendChild(multitap_pad_button('B', ['B'], 'round b'));
    face.appendChild(multitap_pad_button('A', ['A'], 'round a'));
  }
  right.appendChild(face);
  // HOME (the main menu) at the top of the d-pad's side, "..." (the quick
  // menu) at the top of the buttons' side: piccolo's own touch pad's words
  // (touch_pad_menu, touch_pad_quick in its strings.txt).
  if (multitap_pad.options.menu_button) {
    left.insertBefore(multitap_pad_button('HOME', ['MENU'], 'meta menu'), left.firstChild);
  }
  right.insertBefore(multitap_pad_button('...', ['QUICK'], 'meta menu'), right.firstChild);
  // SELECT / START: sideways at the bottom of each half; upright close
  // together in the middle, under the d-pad and the buttons (the CSS shows
  // one of the two).
  left.appendChild(multitap_pad_button('SELECT', ['SELECT'], 'meta sideways'));
  right.appendChild(multitap_pad_button('START', ['START'], 'meta sideways'));
  const meta = document.getElementById('pad-meta');
  meta.textContent = '';
  meta.appendChild(multitap_pad_button('SELECT', ['SELECT'], 'meta upright'));
  meta.appendChild(multitap_pad_button('START', ['START'], 'meta upright'));
}

// The buttons and the d-pad where they are now (only shown ones: a hidden
// one has an empty rectangle). Measured again after any layout change.
function multitap_pad_measure() {
  const root = multitap_pad.options.root;
  const targets = [];
  for (const element of document.querySelectorAll(root + ' .pad-button, ' + root + ' .dpad')) {
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
  // A and B side by side (Game Boy): a thumb between them presses both, as
  // on the real thing. Tried first: a point near both centres (closer than
  // MULTITAP_PAD_BOTH_REACH of the distance between them to each) is both,
  // anywhere else each button is its own.
  const face = document.querySelector(root + ' .face.two');
  const a = face !== null ? face.querySelector('.a') : null;
  const b = face !== null ? face.querySelector('.b') : null;
  if (a !== null && b !== null) {
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    const rf = face.getBoundingClientRect();
    if (ra.width > 0 && rb.width > 0) {
      const ax = ra.left + ra.width / 2, ay = ra.top + ra.height / 2;
      const bx = rb.left + rb.width / 2, by = rb.top + rb.height / 2;
      targets.unshift({
        element: face, bits: Number(a.dataset.bits) | Number(b.dataset.bits), dpad: false, both: true,
        ax: ax, ay: ay, bx: bx, by: by, reach: MULTITAP_PAD_BOTH_REACH * Math.hypot(ax - bx, ay - by),
        left: rf.left, top: rf.top, right: rf.right, bottom: rf.bottom,
      });
    }
  }
  multitap_pad.targets = targets;
}

function multitap_pad_forget_layout() {
  multitap_pad.targets = null;
}

// The d-pad's directions at a point inside it (eight ways).
function multitap_pad_dpad_bits(target, x, y) {
  const width = target.right - target.left;
  const height = target.bottom - target.top;
  const half = Math.min(width, height) / 2;
  const dx = (x - (target.left + width / 2)) / half;
  const dy = (y - (target.top + height / 2)) / half;
  let bits = 0;
  if (dx < -MULTITAP_PAD_DEADZONE) bits |= 1 << MULTITAP_PAD_BIT.LEFT;
  if (dx > MULTITAP_PAD_DEADZONE) bits |= 1 << MULTITAP_PAD_BIT.RIGHT;
  if (dy < -MULTITAP_PAD_DEADZONE) bits |= 1 << MULTITAP_PAD_BIT.UP;
  if (dy > MULTITAP_PAD_DEADZONE) bits |= 1 << MULTITAP_PAD_BIT.DOWN;
  return bits;
}

// What a finger at (x, y) holds: the button or d-pad under it.
function multitap_pad_bits_at(x, y) {
  if (multitap_pad.targets === null) {
    multitap_pad_measure();
  }
  for (const target of multitap_pad.targets) {
    if (x >= target.left && x < target.right && y >= target.top && y < target.bottom) {
      if (target.both) {
        if (Math.hypot(x - target.ax, y - target.ay) < target.reach &&
            Math.hypot(x - target.bx, y - target.by) < target.reach) {
          return target.bits;
        }
        continue;
      }
      return target.dpad ? multitap_pad_dpad_bits(target, x, y) : target.bits;
    }
  }
  return 0;
}

// Everything held: lit on the page, sent to the program when it changed (a
// short buzz for a new press, where the browser can).
function multitap_pad_update() {
  let bits = 0;
  for (const held of multitap_pad.fingers.values()) {
    bits |= held;
  }
  if (bits !== multitap_pad.lit) {
    multitap_pad_light(bits);
  }
  if (bits === multitap_pad.sent) {
    return;
  }
  if ((bits & ~multitap_pad.sent) !== 0 && multitap_pad.vibrate && navigator.vibrate) {
    navigator.vibrate(MULTITAP_PAD_BUZZ_MS);
  }
  multitap_pad.sent = bits;
  if (typeof Module !== 'undefined' && Module.ccall && multitap_pad.attached) {
    Module.ccall(multitap_pad.options.state, null, ['number'], [bits]);
  }
}

// The program's VIBRATE setting (piccolo: src/web_pad.h web_pad_set_vibrate).
function multitap_pad_set_vibrate(on) {
  multitap_pad.vibrate = on;
}

// Draws what's held (only called when it changed).
function multitap_pad_light(bits) {
  const root = multitap_pad.options.root;
  multitap_pad.lit = bits;
  for (const button of document.querySelectorAll(root + ' .pad-button')) {
    button.classList.toggle('held', (bits & Number(button.dataset.bits)) !== 0);
  }
  for (const name of ['up', 'down', 'left', 'right']) {
    const arrow = document.querySelector(root + ' .dpad .' + name);
    if (arrow !== null) {
      arrow.classList.toggle('held', (bits & (1 << MULTITAP_PAD_BIT[name.toUpperCase()])) !== 0);
    }
  }
}

function multitap_pad_finger(event) {
  event.preventDefault();
  if (event.type === 'pointerup' || event.type === 'pointercancel') {
    multitap_pad.fingers.delete(event.pointerId);
  } else {
    if (event.type === 'pointerdown') {
      // Its moves keep coming here wherever it goes (sliding off a button).
      event.target.setPointerCapture(event.pointerId);
    }
    multitap_pad.fingers.set(event.pointerId, multitap_pad_bits_at(event.clientX, event.clientY));
  }
  multitap_pad_update();
}

// Tells the program the pad is there (or not). Its export isn't there until
// the module is instantiated, and (piccolo) answers 0 until its input router
// exists: tried again shortly. Without a `show` export the pad is attached
// as soon as the `state` one is there.
function multitap_pad_tell() {
  const options = multitap_pad.options;
  const name = options.show !== null ? options.show : options.state;
  if (typeof Module === 'undefined' || !Module.ccall || typeof Module['_' + name] !== 'function') {
    setTimeout(multitap_pad_tell, 250);
    return;
  }
  if (options.show !== null && Module.ccall(options.show, 'number', ['number'], [multitap_pad.shown ? 1 : 0]) === 0) {
    setTimeout(multitap_pad_tell, 250);
    return;
  }
  multitap_pad.attached = true;
  multitap_pad.sent = -1;   // send the state again
  multitap_pad_update();
}

// Shown when wanted, allowed and no gamepad is in use.
function multitap_pad_follow() {
  const shown = multitap_pad.wanted && multitap_pad.allowed && multitap_pad.gamepads === 0;
  if (shown === multitap_pad.shown && multitap_pad.attached) {
    return;
  }
  multitap_pad_set_shown(shown);
}

// Whether the program wants a pad at all now (piccoletto: its modes, not a
// guest that only watches). piccolo never calls it.
function multitap_pad_set_allowed(allowed) {
  if (allowed === multitap_pad.allowed) {
    return;
  }
  multitap_pad.allowed = allowed;
  multitap_pad_follow();
}

// PAD's choice (remembered).
function multitap_pad_set_wanted(wanted) {
  multitap_pad.wanted = wanted;
  try {
    localStorage.setItem(multitap_pad.options.storage_key, wanted ? '1' : '0');
  } catch (error) {
    // Not remembered: fine.
  }
  if (wanted) {
    multitap_pad.gamepads = 0;   // PAD pressed by hand: shown even with a gamepad there
  }
  multitap_pad_follow();
}

function multitap_pad_set_shown(shown) {
  multitap_pad.shown = shown;
  document.body.classList.toggle('has-pad', shown);
  const toggle = multitap_pad.options.toggle !== null ? document.getElementById(multitap_pad.options.toggle) : null;
  if (toggle !== null) {
    toggle.classList.toggle('active', shown);
  }
  multitap_pad.fingers.clear();
  if (typeof multitap_pad.options.on_shown === 'function') {
    multitap_pad.options.on_shown(shown);
  }
  multitap_pad_forget_layout();
  multitap_pad_tell();
}

// Before the module starts: the layout is there from the first frame (the
// stage's size depends on it). Options:
//   root          the selector holding the halves (piccolo: '#main')
//   kind          'gb' or 'snes'
//   state         the export taking the bits ('piccolo_web_pad_state')
//   show          the export told when it shows / hides (null: none)
//   toggle        the PAD button's id (null: none)
//   storage_key   where PAD's choice is remembered
//   menu_button   draw HOME (bit 17) too
//   on_shown      called with the new shown state (piccolo closes FILES upright)
//   observe       ids whose size changes move the buttons
function multitap_pad_start(options) {
  multitap_pad.options = options;
  multitap_pad_build(options.kind);
  for (const id of ['pad-left', 'pad-right', 'pad-meta']) {
    const half = document.getElementById(id);
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
      half.addEventListener(type, multitap_pad_finger);
    }
    half.addEventListener('contextmenu', function (event) { event.preventDefault(); });
  }
  let shown = window.matchMedia('(pointer: coarse)').matches;
  try {
    const value = localStorage.getItem(options.storage_key);
    if (value !== null) {
      shown = value === '1';
    }
  } catch (error) {
    // The default.
  }
  const toggle = options.toggle !== null ? document.getElementById(options.toggle) : null;
  if (toggle !== null) {
    toggle.addEventListener('click', function () {
      multitap_pad_set_wanted(!multitap_pad.shown);
    });
  }
  // Any layout change moves the buttons: measured again at the next touch.
  const observer = new ResizeObserver(multitap_pad_forget_layout);
  for (const id of options.observe) {
    observer.observe(document.getElementById(id));
  }
  window.addEventListener('resize', multitap_pad_forget_layout);
  window.addEventListener('scroll', multitap_pad_forget_layout, true);
  // A real gamepad in use (the browser tells only after its first press):
  // the screen's pad steps aside, and comes back when none is left.
  window.addEventListener('gamepadconnected', function () {
    multitap_pad.gamepads++;
    multitap_pad_follow();
  });
  window.addEventListener('gamepaddisconnected', function () {
    multitap_pad.gamepads = Math.max(0, multitap_pad.gamepads - 1);
    multitap_pad_follow();
  });
  multitap_pad.wanted = shown;
  multitap_pad_set_shown(shown && multitap_pad.allowed);
}
