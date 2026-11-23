// piccoletto's controls in the page (Andrés, 2026-11-22: "the app remains
// the same, the controls are outside"). The app runs as on a phone; this
// reads its state (piccoletto_web_state, src/web_shell.h) about ten times a
// second and draws the strip, SETTINGS (a panel like piccolo's FILES), HOME's
// card, GAMEPAD, the quick menu and the guest's card from it. Everything the
// page does goes back as the app's own actions (piccoletto_web_command):
// the app keeps one path, and its state is the only truth.
// Mockups: piccolo-agents docs/mockups/piccoletto-web.

'use strict';

// web_shell.h's WebCommand.
const PICCOLETTO_CMD = {
  go: 0, select: 1, menu: 2, pair_internet: 3, pair_cancel: 4, pair_continue: 5, forget: 6, measure: 7,
  set_name: 8, set_shader: 9, set_pacing: 10, set_vibrate: 11, headless: 12, pause: 13, devices: 14,
  move_device: 15, shader_answer: 16, open_link: 17, pair_lan: 18,
};
const PICCOLETTO_SCREEN = { home: 0, pair: 1, gamepad: 2, remote_play: 3, settings: 4 };
const PICCOLETTO_POLL_MS = 100;
const PICCOLETTO_PACING = ['Latency', 'Balanced', 'Smooth'];

const piccoletto_shell = {
  state: null,          // the app's, last read
  text: '',             // its JSON (redrawn only when it changes)
  active: false,        // the app has its web shell on (else ?ui=app: the page steps aside)
  pane_open: false,
  pane_page: 'hosts',   // root, hosts, pair, browser, remote
  tab: 'play',          // the quick menu's
  picked: -1,           // DEVICES: the device picked to move (index in the host's list)
  forget_asked: -1,     // a host whose FORGET was pressed once (pressed again: forgotten)
  join_link: '',        // a guest link the page was opened with, until JOIN
  wait_step: 0,         // the waiting lights' turn
};

function piccoletto_esc(text) {
  return String(text).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c];
  });
}

function piccoletto_ready() {
  return typeof Module !== 'undefined' && Module.ccall && typeof Module._piccoletto_web_state === 'function';
}

function piccoletto_cmd(command, a, b, text) {
  if (!piccoletto_ready()) {
    return;
  }
  Module.ccall('piccoletto_web_command', 'number', ['number', 'number', 'number', 'string'],
               [command, a || 0, b || 0, text || '']);
  piccoletto_shell.text = '';   // redraw at the next poll even if nothing else changed
}

// --- reading the app -----------------------------------------------------------

function piccoletto_poll() {
  if (!piccoletto_ready()) {
    return;
  }
  if (!piccoletto_shell.active) {
    const active = Module.ccall('piccoletto_web_active', 'number', [], []);
    if (active < 0) {
      return;   // main() hasn't started: ask again
    }
    if (active === 0) {
      document.body.classList.add('app-ui');   // ?ui=app: the app's own screens
      return;
    }
    piccoletto_shell.active = true;
  }
  const text = Module.ccall('piccoletto_web_state', 'string', [], []);
  if (text === '') {
    return;   // no frame yet
  }
  piccoletto_shell.wait_step++;
  if (text === piccoletto_shell.text && !piccoletto_waiting()) {
    return;
  }
  piccoletto_shell.text = text;
  try {
    piccoletto_shell.state = JSON.parse(text);
  } catch (error) {
    return;   // not written yet
  }
  piccoletto_render();
}

function piccoletto_waiting() {
  const s = piccoletto_shell.state;
  return s !== null && ((s.screen === 'pair' && s.pair.step === 'waiting') || (s.guest.on && s.link.state === 'connecting'));
}

// The four port lights one at a time, 1 2 3 4 3 2 1 ... (retroui's port_indicators).
function piccoletto_wait_lights() {
  const order = [0, 1, 2, 3, 2, 1];
  const lit = order[Math.floor(piccoletto_shell.wait_step / 2) % order.length];
  let html = '<span class="leds">';
  for (let i = 0; i < 4; i++) {
    html += '<i class="' + (i === lit ? 'on' : '') + '">' + (i + 1) + '</i>';
  }
  return html + '</span>';
}

function piccoletto_port_lights(port) {
  let html = '<span class="leds">';
  for (let i = 0; i < 4; i++) {
    html += '<i class="' + (i === port ? 'on' : '') + '">' + (i + 1) + '</i>';
  }
  return html + '</span>';
}

function piccoletto_selected_host() {
  const s = piccoletto_shell.state;
  return s.selected >= 0 && s.selected < s.hosts.length ? s.hosts[s.selected] : null;
}

function piccoletto_host_where(host) {
  if (host.online) {
    return 'On the LAN';
  }
  return host.internet ? 'Internet' : 'Through the beacon';
}

// --- drawing the page ------------------------------------------------------------

function piccoletto_render() {
  const s = piccoletto_shell.state;
  const modes = s.screen === 'gamepad' || s.screen === 'remote_play';
  document.body.classList.toggle('playing', modes);
  document.body.classList.toggle('streaming', s.screen === 'remote_play');
  document.body.classList.toggle('mode-gamepad', s.screen === 'gamepad');
  multitap_pad_set_allowed(modes && !(s.guest.on && !s.guest.play));
  const aspect = s.screen === 'remote_play' && s.link.picture ? s.link.aspect : 0;
  multitap_page_game(modes, aspect);
  // PAIR lives in the panel: opening the app's PAIR opens it there.
  if (s.screen === 'pair' && (!piccoletto_shell.pane_open || piccoletto_shell.pane_page !== 'pair')) {
    piccoletto_shell.pane_open = true;
    piccoletto_shell.pane_page = 'pair';
  }
  piccoletto_render_strip(s);
  piccoletto_render_cover(s);
  piccoletto_render_picture(s);
  piccoletto_render_pane(s);
  piccoletto_render_menu(s);
  piccoletto_render_sheet(s);
}

function piccoletto_render_strip(s) {
  const chip = document.getElementById('strip-host');
  const host = piccoletto_selected_host();
  chip.hidden = host === null;
  if (host !== null) {
    chip.innerHTML = '<span class="lamp' + (host.online || host.internet ? ' on' : '') + '"></span>' + piccoletto_esc(host.name);
  }
  document.getElementById('settings-open').classList.toggle('active', piccoletto_shell.pane_open);
}

// What covers the canvas when nothing streams: HOME's card, GAMEPAD, a guest's card.
function piccoletto_render_cover(s) {
  const cover = document.getElementById('cover');
  let html = '';
  if (piccoletto_shell.join_link !== '' && s.screen !== 'remote_play') {
    html = piccoletto_join_card(s);
  } else if (s.screen === 'gamepad') {
    const port = s.link.port;
    html = '<div class="card"><span class="kicker">Gamepad</span><h2>' + piccoletto_esc(s.link.host) + '</h2>' +
           '<div class="facts"><span>' + piccoletto_port_lights(port) + '</span><span>' +
           (s.link.state === 'ready' ? (port >= 0 ? 'Port ' + (port + 1) : 'No port yet: press START') + ' · ' + s.link.ping_ms + ' ms'
                                     : 'Connecting…') + '</span></div>' +
           '<small>This browser is a pad for the game on ' + piccoletto_esc(s.link.host) +
           '\'s own screen. The keyboard and any gamepad play; on a touch screen, the pad below.</small>' +
           '<div class="row"><button class="btn wide" data-act="menu">Quick menu</button></div></div>';
  } else if (s.screen !== 'remote_play') {
    html = piccoletto_home_card(s);
  }
  if (cover.dataset.html !== html) {
    cover.dataset.html = html;
    cover.innerHTML = html;
  }
}

function piccoletto_home_card(s) {
  if (!s.network) {
    return '<div class="card"><span class="kicker">piccoletto</span><h2>No network</h2>' +
           '<small>This browser couldn\'t start piccoletto\'s network. Reload the page to try again.</small></div>';
  }
  const host = piccoletto_selected_host();
  if (host === null) {
    return '<div class="card"><span class="kicker">piccoletto</span><h2>Pair a piccolo</h2>' +
           '<small>piccoletto is a pad and a screen for piccolo. Pair this browser with one: it shows a code, and on the piccolo ' +
           'you type it in TOOLS &gt; INVITE.</small>' +
           '<div class="row"><button class="btn primary wide" data-act="pair">Pair a device</button></div></div>';
  }
  let html = '<div class="card"><span class="kicker">Your host</span><h2>' + piccoletto_esc(host.name) + '</h2>' +
             '<div class="facts"><span><span class="lamp' + (host.online || host.internet ? ' on' : '') + '"></span>' +
             piccoletto_host_where(host) + '</span><span>' + piccoletto_esc(host.access) + ' access</span>';
  if (host.down_kbps > 0) {
    html += '<span>' + Math.round(host.down_kbps / 1000) + ' Mbit/s down</span>';
  }
  html += '</div>';
  if (s.link.state === 'failed' && s.link.refusal !== '') {
    html += '<span class="bad">' + piccoletto_esc(s.link.refusal) + '</span>';
  }
  html += '<div class="row">';
  if (host.remote_play) {
    html += '<button class="btn primary wide" data-act="remote">Remote play</button>';
  }
  html += '<button class="btn wide' + (host.remote_play ? '' : ' primary') + '" data-act="gamepad">Gamepad</button></div>';
  html += '<small>' + (s.hosts.length > 1 ? 'Or pick another host in SETTINGS.' : 'More hosts: PAIR in the strip.') + '</small></div>';
  return html;
}

// A guest link (#join=...): what it is, then JOIN (a click: the browser lets
// the game's sound play after one).
function piccoletto_join_card(s) {
  let html = '<div class="card"><span class="kicker">You\'re invited to a game</span><h2>Join as a guest</h2>' +
             '<small>No pairing and nothing saved: you watch, and play when the host gave this link a seat and a port is free.</small>';
  if (s.guest.full) {
    html += '<span class="bad">The session is full. A seat frees up when someone leaves.</span>';
  } else if (s.link.state === 'failed' && s.link.refusal !== '') {
    html += '<span class="bad">' + piccoletto_esc(s.link.refusal) + '</span>';
  }
  html += '<div class="row"><button class="btn primary wide" data-act="join">Join</button></div></div>';
  return html;
}

function piccoletto_render_picture(s) {
  const streaming = s.screen === 'remote_play';
  const chip = document.getElementById('chip');
  const why = document.getElementById('why');
  const open = document.getElementById('menu-open');
  open.hidden = !(streaming || s.screen === 'gamepad');
  chip.hidden = !streaming;
  if (streaming) {
    let text = '<span class="lamp' + (s.link.state === 'ready' ? ' on' : '') + '"></span>';
    if (s.guest.on) {
      text += 'Guest · ' + (s.guest.play && s.guest.port >= 0 ? 'port ' + (s.guest.port + 1) : 'watching') + ' · ';
    }
    text += piccoletto_esc(s.link.host);
    if (s.link.state === 'ready') {
      text += ' · ' + s.link.ping_ms + ' ms · ' + s.link.fps + ' fps';
    }
    chip.innerHTML = text;
  }
  let reason = '';
  if (streaming && !s.link.picture) {
    if (s.guest.on && s.link.state === 'connecting') {
      reason = 'Joining ' + piccoletto_wait_lights();
    } else if (s.guest.on && s.link.state === 'failed') {
      reason = piccoletto_esc(s.link.refusal || 'Couldn\'t join') + '<br><br><button class="btn" data-act="home">OK</button>';
    } else {
      reason = piccoletto_esc(s.link.status || '');
    }
  }
  why.hidden = reason === '';
  if (why.dataset.html !== reason) {
    why.dataset.html = reason;
    why.innerHTML = reason;
  }
}

// --- SETTINGS: FILES' twin ---------------------------------------------------------

const PICCOLETTO_PANE_PATHS = { root: [], hosts: ['Hosts'], pair: ['Pair a device'], browser: ['This browser'], remote: ['Remote play'] };

function piccoletto_render_pane(s) {
  const pane = document.getElementById('pane');
  pane.classList.toggle('closed', !piccoletto_shell.pane_open);
  if (!piccoletto_shell.pane_open) {
    return;
  }
  const page = piccoletto_shell.pane_page;
  // Typing in a field: don't redraw it under the fingers.
  if (document.activeElement !== null && document.activeElement.closest('#pane-list') !== null &&
      document.activeElement.tagName === 'INPUT') {
    return;
  }
  let path = '<button class="plain" data-page="root">Settings</button>';
  for (const part of PICCOLETTO_PANE_PATHS[page]) {
    path += '<span>/</span><button class="plain" data-page="' + page + '">' + piccoletto_esc(part) + '</button>';
  }
  document.getElementById('pane-path').innerHTML = path;
  let rows = '';
  let footer = 'Saved in this browser';
  if (page === 'root') {
    rows = '<li class="folder" data-page="hosts"><span class="name">Hosts</span><span class="size">' + s.hosts.length + '</span></li>' +
           '<li class="folder" data-page="pair"><span class="name">Pair a device</span></li>' +
           '<li class="folder" data-page="browser"><span class="name">This browser</span></li>' +
           '<li class="folder" data-page="remote"><span class="name">Remote play</span></li>' +
           '<li><span class="name">piccoletto</span><span class="size">' + piccoletto_esc(s.version) + '</span></li>';
  } else if (page === 'hosts') {
    rows = piccoletto_pane_hosts(s);
    footer = s.hosts.length + ' paired';
  } else if (page === 'pair') {
    rows = piccoletto_pane_pair(s);
    footer = 'The code lives while this stays open';
  } else if (page === 'browser') {
    rows = '<li class="block"><span class="hint">This browser\'s name (how piccolo shows it)</span>' +
           '<span style="display:flex;gap:4px"><input class="field" id="name-field" maxlength="31" value="' + piccoletto_esc(s.settings.name) + '">' +
           '<span class="actions" style="visibility:visible"><button type="button" data-act="name">Save</button></span></span></li>' +
           '<li class="choice' + (s.settings.vibrate ? ' on' : '') + '" data-act="vibrate"><span class="radio"></span><span class="name">Vibrate on press</span>' +
           '<span class="size">Phones</span></li>';
  } else {
    rows = '<li class="head">Shader</li>';
    s.settings.shaders.forEach(function (label, i) {
      rows += '<li class="choice' + (s.settings.shader === i ? ' on' : '') + '" data-shader="' + i + '"><span class="radio"></span>' +
              '<span class="name">' + piccoletto_esc(label) + '</span></li>';
    });
    rows += '<li class="head">Pacing</li>';
    PICCOLETTO_PACING.forEach(function (label, i) {
      rows += '<li class="choice' + (s.settings.pacing === i ? ' on' : '') + '" data-pacing="' + i + '"><span class="radio"></span>' +
              '<span class="name">' + label + '</span></li>';
    });
  }
  const list = document.getElementById('pane-list');
  if (list.dataset.html !== rows) {
    list.dataset.html = rows;
    list.innerHTML = rows;
  }
  document.getElementById('pane-footer').textContent = footer;
}

function piccoletto_pane_hosts(s) {
  let rows = '';
  s.hosts.forEach(function (host, i) {
    const picked = i === s.selected;
    rows += '<li class="' + (picked ? 'picked' : '') + '" data-select="' + i + '"><span class="lamp' + (host.online || host.internet ? ' on' : '') + '"></span>' +
            '<span class="name">' + piccoletto_esc(host.name) + '</span><span class="size">' +
            (host.measuring ? 'Measuring…' : piccoletto_host_where(host)) + '</span><span class="actions">';
    if (host.remote_play) {
      rows += '<button type="button" class="go" data-play="' + i + '">Play</button>';
    }
    rows += '<button type="button" data-pad="' + i + '">Pad</button>' +
            '<button type="button" data-forget="' + i + '">' + (piccoletto_shell.forget_asked === i ? 'Sure?' : 'Forget') + '</button></span></li>';
  });
  rows += '<li class="folder" data-page="pair"><span class="name">+ Pair a device</span></li>';
  return rows;
}

function piccoletto_pane_pair(s) {
  if (s.screen !== 'pair') {
    return '<li class="block"><button class="btn primary" data-act="pair">Start pairing</button>' +
           '<span class="hint">This browser shows a code; on the piccolo you type it in TOOLS &gt; INVITE.</span></li>';
  }
  const p = s.pair;
  const code = p.code.length === 9 ? p.code.slice(0, 3) + ' ' + p.code.slice(3, 6) + ' ' + p.code.slice(6) : p.code;
  if (p.step === 'paired') {
    return '<li class="head">Paired</li><li class="block"><span class="name" style="white-space:normal">' + piccoletto_esc(p.host) + '</span>' +
           '<span class="hint">Gamepad' + (p.remote_play ? ', remote play' : '') + (p.full ? ', devices' : '') + '</span>' +
           '<button class="btn primary" data-act="pair_continue">Continue</button></li>';
  }
  let rows = '';
  if (p.step === 'pick' && p.found.length > 0) {
    rows += '<li class="head">On this network</li>';
    p.found.forEach(function (name, i) {
      rows += '<li><span class="lamp on"></span><span class="name">' + piccoletto_esc(name) + '</span>' +
              '<span class="actions" style="visibility:visible"><button type="button" class="go" data-pairlan="' + i + '">Pair</button></span></li>';
    });
  }
  rows += '<li class="head">This browser\'s code</li><li class="block"><span class="bigcode">' + piccoletto_esc(code) + '</span>' +
          '<span class="hint">Send it to whoever has the piccolo. There: TOOLS &gt; INVITE, type it, pick the access level, ALLOW.</span>' +
          '<span style="display:flex;gap:6px"><button class="btn wide" data-act="copy">Copy</button>' +
          (navigator.share ? '<button class="btn wide" data-act="share">Send…</button>' : '') + '</span></li>';
  if (p.step === 'waiting') {
    rows += '<li>' + piccoletto_wait_lights() + '<span class="name">' + (p.asked ? 'The host has your request' : 'Waiting for the host') + '</span></li>' +
            '<li class="block"><button class="btn" data-act="pair_cancel">Cancel</button></li>';
  } else {
    if (p.error !== '') {
      rows += '<li class="block"><span class="hint" style="color:var(--accent)">' + piccoletto_esc(p.error) + '</span></li>';
    }
    rows += '<li class="block"><button class="btn primary" data-act="pair_internet">Wait for the host</button>' +
            '<span class="hint">One use. A wrong code gives a new one; after five it closes.</span></li>';
  }
  return rows;
}

// --- the quick menu ------------------------------------------------------------------

function piccoletto_render_menu(s) {
  const qm = document.getElementById('qm');
  const open = s.menu && (s.screen === 'gamepad' || s.screen === 'remote_play');
  qm.hidden = !open;
  if (!open) {
    qm.dataset.html = '';
    return;
  }
  const tabs = [['play', 'Play']];
  if (s.screen === 'remote_play') {
    tabs.push(['picture', 'Picture']);
  }
  if (!s.guest.on && s.link.full) {
    tabs.push(['devices', 'Devices']);
  }
  if (!s.guest.on) {
    tabs.push(['host', 'Host']);
  }
  if (!tabs.some(function (t) { return t[0] === piccoletto_shell.tab; })) {
    piccoletto_shell.tab = 'play';
  }
  let html = '<div class="dim" data-act="resume"></div><div class="panel"><nav class="tabs" role="tablist">';
  for (const tab of tabs) {
    html += '<button type="button" role="tab" aria-selected="' + (tab[0] === piccoletto_shell.tab) + '" data-tab="' + tab[0] + '">' + tab[1] + '</button>';
  }
  html += '<span class="space"></span><button type="button" data-act="resume">&times;<br>Close</button></nav><div class="body">' +
          piccoletto_menu_body(s) + '</div></div>';
  if (qm.dataset.html !== html) {
    qm.dataset.html = html;
    qm.innerHTML = html;
  }
}

function piccoletto_menu_body(s) {
  const tab = piccoletto_shell.tab;
  const host = piccoletto_esc(s.link.host);
  if (tab === 'picture') {
    let html = '<h3>Picture</h3><div class="sub">Drawn here, in the browser</div><div class="items"><div class="label">Shader</div>';
    s.settings.shaders.forEach(function (label, i) {
      html += '<button type="button" class="item' + (s.settings.shader === i ? ' on' : '') + '" data-shader="' + i + '"><span class="radio"></span>' +
              '<span class="grow">' + piccoletto_esc(label) + '</span></button>';
    });
    html += '<div class="label">Pacing</div><div class="seg3">';
    PICCOLETTO_PACING.forEach(function (label, i) {
      html += '<button type="button" class="' + (s.settings.pacing === i ? 'on' : '') + '" data-pacing="' + i + '">' + label + '</button>';
    });
    return html + '</div></div>';
  }
  if (tab === 'devices') {
    return '<h3>Devices</h3><div class="sub">Who plays on ' + host + '\'s ports · tap a device, then MOVE HERE</div>' +
           '<div class="items">' + piccoletto_ports(s) + '</div>';
  }
  if (tab === 'host') {
    const kbps = s.link.kbps > 0 ? (s.link.kbps / 1000).toFixed(1) + ' Mbit/s' : '-';
    return '<h3>' + host + '</h3><div class="sub"><span class="lamp' + (s.link.state === 'ready' ? ' on' : '') + '"></span>' +
           piccoletto_esc(s.link.state) + '</div><dl class="stats"><dt>Ping</dt><dd>' + s.link.ping_ms + ' ms</dd>' +
           '<dt>Loss</dt><dd>' + (s.link.loss * 100).toFixed(1) + '%</dd>' +
           (s.screen === 'remote_play' ? '<dt>Picture</dt><dd>' + s.link.fps + ' fps · ' + kbps + '</dd><dt>Lost frames</dt><dd>' + s.link.lost + '</dd>' +
                                         '<dt>Audio gaps</dt><dd>' + s.link.audio_gaps + '</dd>' : '') +
           (s.link.delay_ms >= 0 ? '<dt>Host\'s frame delay</dt><dd>' + s.link.delay_ms + ' ms</dd>' : '') +
           '<dt>Port</dt><dd>' + (s.link.port >= 0 ? s.link.port + 1 : '-') + '</dd></dl>' +
           '<div class="items"><button type="button" class="item" data-act="measure"><span class="grow">Measure the speed again</span></button></div>';
  }
  let html = '<h3>' + host + '</h3><div class="sub"><span class="lamp' + (s.link.state === 'ready' ? ' on' : '') + '"></span>' +
             (s.screen === 'remote_play' ? 'Remote play' : 'Gamepad') + (s.link.state === 'ready' ? ' · ' + s.link.ping_ms + ' ms' : '') + '</div>' +
             '<div class="items"><button type="button" class="item primary" data-act="resume"><span class="grow">Resume<small>Back to the game (Esc)</small></span></button>';
  if (!s.guest.on) {
    if (s.screen === 'remote_play') {
      html += '<button type="button" class="item" data-act="gamepad"><span class="grow">Switch to gamepad<small>No picture here, play on its screen</small></span></button>';
    } else if (s.link.remote_play) {
      html += '<button type="button" class="item" data-act="remote"><span class="grow">Switch to remote play<small>The game\'s picture here</small></span></button>';
    }
    if (s.screen === 'remote_play' && s.link.streaming) {
      if (!s.link.headless_on) {
        html += '<button type="button" class="item" data-act="headless_on"><span class="grow">Go headless<small>' + host + '\'s window hides; only you see the game</small></span></button>';
      } else if (s.link.headless_yours) {
        html += '<button type="button" class="item" data-act="headless_off"><span class="grow">Play on ' + host + '<small>Its window comes back</small></span></button>';
      }
    }
    if (s.link.pause_offered) {
      html += '<button type="button" class="item" data-act="pause"><span class="grow">' + (s.link.paused ? 'Resume the game' : 'Pause the game') + '</span></button>';
    }
    html += '<button type="button" class="item" data-act="settings"><span class="grow">Settings</span>›</button>';
  }
  html += '<button type="button" class="item" data-act="fullscreen"><span class="grow">Full screen</span></button>' +
          '<button type="button" class="item leave" data-act="home"><span class="grow">Leave<small>' +
          (s.guest.on ? 'Frees your seat for someone else' : 'The game keeps running on ' + host) + '</small></span></button></div>';
  return html;
}

// DEVICES: retroui's ports board, as the page draws it.
function piccoletto_ports(s) {
  if (!s.devices.known) {
    return '<div class="sub">Asking ' + piccoletto_esc(s.link.host) + '…</div>';
  }
  let ports = 4;
  for (const device of s.devices.list) {
    for (let bit = 0; bit < 8; bit++) {
      if ((device.ports & (1 << bit)) !== 0) {
        ports = Math.max(ports, bit + 1);
      }
    }
  }
  const picked = piccoletto_shell.picked;
  let html = '';
  const port_row = function (port, label) {
    let devs = '';
    s.devices.list.forEach(function (device, i) {
      const here = port < 0 ? device.ports === 0 : (device.ports & (1 << port)) !== 0;
      if (here) {
        devs += '<button type="button" class="dev' + (device.owner === 'yours' ? ' yours' : '') + (picked === i ? ' picked' : '') +
                '" data-device="' + i + '">' + piccoletto_esc(device.name) + (device.owner === 'yours' ? ' (you)' : '') + '</button>';
      }
    });
    const move = picked >= 0 && picked < s.devices.list.length &&
                 !(port < 0 ? s.devices.list[picked].ports === 0 : (s.devices.list[picked].ports & (1 << port)) !== 0);
    return '<div class="port"><span class="n">' + label + '</span><span class="devs">' + (devs || '<span class="none">Nobody</span>') + '</span>' +
           (move ? '<button type="button" class="move" data-moveto="' + port + '">Move here</button>' : '') + '</div>';
  };
  for (let port = 0; port < ports; port++) {
    html += port_row(port, String(port + 1));
  }
  html += port_row(-1, '–');
  return html;
}

// A preset too slow for this browser: KEEP / REVERT (frontends-common's shader_check).
function piccoletto_render_sheet(s) {
  const sheet = document.getElementById('sheet');
  const asking = s.screen === 'remote_play' && s.shader_check.asking;
  sheet.hidden = !asking;
  if (!asking) {
    sheet.dataset.html = '';
    return;
  }
  const html = '<div class="card"><span class="kicker">Shader</span><h2>Too slow here</h2>' +
               '<small>' + piccoletto_esc(s.shader_check.name) + ' runs at ' + s.shader_check.fps.toFixed(0) + ' fps; the screen needs ' +
               s.shader_check.target.toFixed(0) + '.</small><div class="row"><button class="btn wide" data-act="keep">Keep it</button>' +
               '<button class="btn primary wide" data-act="revert">Go back</button></div></div>';
  if (sheet.dataset.html !== html) {
    sheet.dataset.html = html;
    sheet.innerHTML = html;
  }
}

// --- what a click does ------------------------------------------------------------------

function piccoletto_go(screen) {
  piccoletto_cmd(PICCOLETTO_CMD.go, PICCOLETTO_SCREEN[screen]);
}

function piccoletto_open_pane(page) {
  piccoletto_shell.pane_open = true;
  piccoletto_shell.pane_page = page;
  const s = piccoletto_shell.state;
  if (page === 'pair' && s !== null && s.screen !== 'pair') {
    piccoletto_go('pair');
  } else if (page !== 'pair' && s !== null && s.screen === 'pair') {
    piccoletto_go('home');   // leaving PAIR stops a pairing that's still running (the app's go_to)
  }
  piccoletto_shell.text = '';
  if (s !== null) {
    piccoletto_render();
  }
}

function piccoletto_close_pane() {
  piccoletto_shell.pane_open = false;
  const s = piccoletto_shell.state;
  if (s !== null && s.screen === 'pair') {
    piccoletto_go('home');
  }
  if (s !== null) {
    piccoletto_render();
  }
}

async function piccoletto_copy(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (error) {
    console.log('Copy: ' + error.message);
  }
}

function piccoletto_code_message() {
  const code = piccoletto_shell.state.pair.code;
  return 'piccoletto code: ' + code.slice(0, 3) + ' ' + code.slice(3, 6) + ' ' + code.slice(6) +
         '. Type it on the piccolo in TOOLS > INVITE.';
}

function piccoletto_act(name) {
  const s = piccoletto_shell.state;
  switch (name) {
    case 'pair': piccoletto_open_pane('pair'); break;
    case 'remote': piccoletto_go('remote_play'); break;
    case 'gamepad': piccoletto_go('gamepad'); break;
    case 'home': piccoletto_go('home'); break;
    case 'menu': piccoletto_cmd(PICCOLETTO_CMD.menu, 1); break;
    case 'resume': piccoletto_cmd(PICCOLETTO_CMD.menu, 0); break;
    case 'settings': piccoletto_cmd(PICCOLETTO_CMD.menu, 0); piccoletto_open_pane('remote'); break;   // beside the game, which goes on
    case 'fullscreen': piccoletto_page_fullscreen(); break;
    case 'headless_on': piccoletto_cmd(PICCOLETTO_CMD.headless, 1); break;
    case 'headless_off': piccoletto_cmd(PICCOLETTO_CMD.headless, 0); break;
    case 'pause': piccoletto_cmd(PICCOLETTO_CMD.pause); break;
    case 'measure': piccoletto_cmd(PICCOLETTO_CMD.measure, s.selected); break;
    case 'pair_internet': piccoletto_cmd(PICCOLETTO_CMD.pair_internet); break;
    case 'pair_cancel': piccoletto_cmd(PICCOLETTO_CMD.pair_cancel); break;
    case 'pair_continue': piccoletto_cmd(PICCOLETTO_CMD.pair_continue); piccoletto_shell.pane_open = false; break;
    case 'copy': piccoletto_copy(piccoletto_code_message()); break;
    case 'share': navigator.share({ text: piccoletto_code_message() }).catch(function () {}); break;
    case 'vibrate': piccoletto_cmd(PICCOLETTO_CMD.set_vibrate, s.settings.vibrate ? 0 : 1); break;
    case 'name': piccoletto_cmd(PICCOLETTO_CMD.set_name, 0, 0, document.getElementById('name-field').value); break;
    case 'keep': piccoletto_cmd(PICCOLETTO_CMD.shader_answer, 1); break;
    case 'revert': piccoletto_cmd(PICCOLETTO_CMD.shader_answer, 0); break;
    case 'join':
      piccoletto_cmd(PICCOLETTO_CMD.open_link, 0, 0, piccoletto_shell.join_link);
      piccoletto_shell.join_link = '';
      break;
  }
}

function piccoletto_click(event) {
  const t = event.target.closest('[data-act],[data-page],[data-tab],[data-shader],[data-pacing],[data-select],[data-play],' +
                                 '[data-pad],[data-forget],[data-pairlan],[data-device],[data-moveto]');
  if (t === null) {
    return;
  }
  const d = t.dataset;
  if (d.forget !== undefined) {
    const i = Number(d.forget);
    if (piccoletto_shell.forget_asked === i) {
      piccoletto_cmd(PICCOLETTO_CMD.forget, i);
      piccoletto_shell.forget_asked = -1;
    } else {
      piccoletto_shell.forget_asked = i;
    }
  } else if (d.play !== undefined) {
    piccoletto_cmd(PICCOLETTO_CMD.select, Number(d.play));
    piccoletto_go('remote_play');
  } else if (d.pad !== undefined) {
    piccoletto_cmd(PICCOLETTO_CMD.select, Number(d.pad));
    piccoletto_go('gamepad');
  } else if (d.select !== undefined) {
    piccoletto_cmd(PICCOLETTO_CMD.select, Number(d.select));
  } else if (d.pairlan !== undefined) {
    piccoletto_cmd(PICCOLETTO_CMD.pair_lan, Number(d.pairlan));
  } else if (d.page !== undefined) {
    piccoletto_open_pane(d.page);
  } else if (d.tab !== undefined) {
    const was = piccoletto_shell.tab;
    piccoletto_shell.tab = d.tab;
    if (d.tab === 'devices' && was !== 'devices') {
      piccoletto_shell.picked = -1;
      piccoletto_cmd(PICCOLETTO_CMD.devices, 1);
    } else if (d.tab !== 'devices' && was === 'devices') {
      piccoletto_cmd(PICCOLETTO_CMD.devices, 0);
    }
  } else if (d.shader !== undefined) {
    piccoletto_cmd(PICCOLETTO_CMD.set_shader, Number(d.shader));
  } else if (d.pacing !== undefined) {
    piccoletto_cmd(PICCOLETTO_CMD.set_pacing, Number(d.pacing));
  } else if (d.device !== undefined) {
    const i = Number(d.device);
    piccoletto_shell.picked = piccoletto_shell.picked === i ? -1 : i;
  } else if (d.moveto !== undefined) {
    piccoletto_cmd(PICCOLETTO_CMD.move_device, piccoletto_shell.picked, Number(d.moveto));
    piccoletto_shell.picked = -1;
  } else if (d.act !== undefined) {
    piccoletto_act(d.act);
  }
  piccoletto_shell.text = '';
  if (piccoletto_shell.state !== null) {
    piccoletto_render();
  }
  // Keys go to the app again (Esc, the keyboard as a pad), unless a field has them.
  if (document.activeElement === null || document.activeElement.tagName !== 'INPUT') {
    document.getElementById('canvas').focus();
  }
}

// The pad shown or hidden (multitap-pad.js): the canvas changes size.
function piccoletto_shell_pad_shown(shown) {
  void shown;
}

// Before the module: a guest link in the address (#join=...) is kept for
// JOIN and taken out of the address (the app would join at once, before a
// click; a reload or a bookmark shouldn't keep the token either).
function piccoletto_shell_start() {
  const hash = location.hash;
  if (hash.indexOf('join=') >= 0) {
    piccoletto_shell.join_link = hash;
    history.replaceState(null, '', location.pathname + location.search);
  }
  document.addEventListener('click', piccoletto_click);
  document.getElementById('pair-open').addEventListener('click', function () { piccoletto_open_pane('pair'); });
  document.getElementById('settings-open').addEventListener('click', function () {
    if (piccoletto_shell.pane_open) {
      piccoletto_close_pane();
    } else {
      piccoletto_open_pane('hosts');
    }
  });
  document.getElementById('pane-hosts').addEventListener('click', function () { piccoletto_open_pane('hosts'); });
  document.getElementById('pane-pair').addEventListener('click', function () { piccoletto_open_pane('pair'); });
  document.getElementById('pane-close').addEventListener('click', piccoletto_close_pane);
  document.getElementById('menu-open').addEventListener('click', function () { piccoletto_cmd(PICCOLETTO_CMD.menu, 1); });
  document.getElementById('fullscreen').addEventListener('click', function () {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      piccoletto_page_fullscreen();
    }
  });
  setInterval(piccoletto_poll, PICCOLETTO_POLL_MS);
}
