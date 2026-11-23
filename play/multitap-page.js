// A frontend's page in the browser: what piccolo's and piccoletto's pages
// share. Checks that threads are possible, keeps the frontend's folder on
// OPFS (multitap-storage.js), starts the module, sizes the canvas, hands it
// files. The page itself has an #overlay with #message and #progress, the
// <canvas id="canvas">, and a #stage around the canvas.
//
// Threads need the page to be "cross-origin isolated" (COOP/COEP headers).
// A server that sends them (a Docker image, .htaccess / nginx / _headers
// configs) needs nothing else. Elsewhere (GitHub Pages, python -m
// http.server) sw.js adds them: the first visit registers it and reloads once.

'use strict';

function multitap_page_message(text, show_progress) {
  document.getElementById('message').textContent = text;
  document.getElementById('progress').style.display = show_progress ? '' : 'none';
  document.getElementById('overlay').classList.remove('gone');
}

// Threads: crossOriginIsolated, or sw.js to make it so (one reload).
// Resolves true when the module can start; false when it can't (a message is up).
async function multitap_page_isolation(sw_url, sw_scope) {
  if (self.crossOriginIsolated) {
    return true;
  }
  if (!window.isSecureContext || !('serviceWorker' in navigator)) {
    multitap_page_message('THIS PAGE NEEDS HTTPS (OR LOCALHOST) AND SERVICE WORKERS, OR A SERVER THAT SENDS ' +
                          'THE COOP/COEP HEADERS (SEE README.TXT)', false);
    return false;
  }
  // One reload only: if it didn't help, say so instead of looping.
  if (sessionStorage.getItem('multitap-sw-reloaded')) {
    sessionStorage.removeItem('multitap-sw-reloaded');
    multitap_page_message('THIS BROWSER BLOCKS WHAT THIS PAGE NEEDS (SERVICE WORKERS, OR SHAREDARRAYBUFFER). ' +
                          'A PRIVATE WINDOW CAN DO THAT: TRY A NORMAL ONE.', false);
    return false;
  }
  try {
    await navigator.serviceWorker.register(sw_url, { scope: sw_scope });
    await navigator.serviceWorker.ready;
    sessionStorage.setItem('multitap-sw-reloaded', '1');
    location.reload();
  } catch (error) {
    multitap_page_message('SERVICE WORKER REFUSED: ' + error.message, false);
  }
  return false;
}

// A file from the page (a button, a drop): into the virtual filesystem, then
// the frontend gets it (multitap_web_open, app_loop_on_open).
async function multitap_page_open(file) {
  const data = new Uint8Array(await file.arrayBuffer());
  const folder = '/tmp/open';
  try { Module.FS.mkdir(folder); } catch (error) { /* already there */ }
  const name = file.name.replace(/[\/\\]/g, '_');
  Module.FS.writeFile(folder + '/' + name, data);
  Module.ccall('multitap_web_open', null, ['string'], [folder + '/' + name]);
  document.getElementById('canvas').focus();
}

// SDL takes the window's size from the canvas's CSS size, but only on the
// browser's resize event: send one whenever the stage changes (a panel
// opening or closing, the page resized, a phone turned).
function multitap_page_follow_stage() {
  let pending = false;
  const observer = new ResizeObserver(function () {
    if (pending) {
      return;
    }
    pending = true;
    requestAnimationFrame(function () {
      pending = false;
      window.dispatchEvent(new Event('resize'));
    });
  });
  observer.observe(document.getElementById('stage'));
}

// The screen's refresh rate, measured (browsers don't tell it, and a phone's
// changes: an S22 runs 60, 48, 96 or 120 Hz): the median of the last
// animation frames' intervals, in globalThis.multitap_display_hz (0 until
// measured). The frontend reads it each loop (app_shell_display_refresh_hz):
// near the core's rate it runs one core frame per refresh (Vsync timing),
// otherwise its own clock with catch-up (Exact).
const MULTITAP_DISPLAY_FRAMES = 120;   // the intervals kept (two seconds at 60 Hz)
function multitap_page_measure_display() {
  const intervals = [];
  let last = 0;
  let count = 0;
  globalThis.multitap_display_hz = 0;
  function frame(time) {
    const interval = time - last;
    last = time;
    if (interval > 2 && interval < 100) {   // (not the first, nor after a hidden page's pause)
      intervals.push(interval);
      if (intervals.length > MULTITAP_DISPLAY_FRAMES) {
        intervals.shift();
      }
    }
    // Worked out every half second, once there's enough to go on.
    if (++count % 30 === 0 && intervals.length >= 60) {
      const sorted = intervals.slice().sort(function (a, b) { return a - b; });
      globalThis.multitap_display_hz = 1000 / sorted[sorted.length >> 1];
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// The canvas fills the stage and the frontend places and scales the picture
// inside it (Andrés, 2026-11-21: the fixed 16:9 / 4:3 steps wasted the
// screen, a phone's most of all). Nothing to do any more; kept for pages
// that still call it.
function multitap_page_frame_16x9() {
}

// The frontend tells the page what it shows (piccolo: src/web_pad.h): body
// gets "playing" while a game is played (the page may hide its strip), and
// "has-picture" with --picture-aspect (width / height) while a game's
// picture is on screen (an upright phone can give the canvas only the
// height that picture needs).
function multitap_page_game(playing, aspect) {
  document.body.classList.toggle('playing', playing);
  const has_picture = aspect > 0;
  document.body.classList.toggle('has-picture', has_picture);
  if (has_picture) {
    document.documentElement.style.setProperty('--picture-aspect', String(aspect));
  } else {
    document.documentElement.style.removeProperty('--picture-aspect');
  }
}

// Starts the frontend. config:
//   name         its folder name (app_storage_init's) and module script (<name>.js)
//   title        what the loading message calls it ("PICCOLO")
//   opfs_folder  its folder on OPFS ('' = the root; see multitap-storage.js)
//   skipped      top-level names in its folder that aren't kept on OPFS
//   sw, sw_scope sw.js's URL and scope (relative to the page)
//   started      called once the filesystem is there, before main() (may be null)
//   environment  more environment variables for the frontend, { NAME: 'value' } (may be null)
async function multitap_page_start(config) {
  if (!(await multitap_page_isolation(config.sw, config.sw_scope))) {
    return;
  }
  if (!document.createElement('canvas').getContext('webgl2')) {
    multitap_page_message('THIS BROWSER HAS NO WEBGL 2', false);
    return;
  }
  // Ask the browser to keep the folder (saves, pairings) when space runs
  // low; it may say no, and then it's only kept while space allows.
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist();
  }
  multitap_page_message('LOADING ' + config.title, true);
  await multitap_storage_read(config.name, config.opfs_folder, config.skipped);
  window.Module = {
    canvas: document.getElementById('canvas'),
    print: function (text) { console.log(text); },
    printErr: function (text) { console.log(text); },
    setStatus: function (text) {
      // Emscripten's download progress: "Downloading data... (12/34)".
      const match = /\((\d+(?:\.\d+)?)\/(\d+)\)/.exec(text);
      if (match) {
        const progress = document.getElementById('progress');
        progress.max = Number(match[2]);
        progress.value = Number(match[1]);
      }
    },
    preRun: [multitap_storage_environment, function () {
      for (const name in config.environment || {}) {
        Module.ENV[name] = config.environment[name];
      }
    }],
    // The filesystem exists and main() hasn't run: the folder goes in now.
    onRuntimeInitialized: function () {
      multitap_storage_install();
      document.getElementById('overlay').classList.add('gone');
      multitap_page_follow_stage();
      multitap_page_measure_display();
      if (config.started) {
        config.started();
      }
      document.getElementById('canvas').focus();
    },
    onAbort: function (what) {
      multitap_page_message(config.title + ' STOPPED: ' + what, false);
    },
  };
  const script = document.createElement('script');
  script.src = config.name + '.js';
  script.onerror = function () { multitap_page_message('CAN\'T LOAD ' + config.name.toUpperCase() + '.JS', false); };
  document.body.appendChild(script);
}
