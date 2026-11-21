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

// The picture as a window inside the stage, in fixed steps (CSS pixels),
// responsive: a wide stage gets 16:9 steps (854x480, 1280x720, 1440x810,
// 1920x1080, 2560x1440, 3840x2160), one that's narrow for its height
// (width / height under 1.55, between 4:3 and 16:9) gets 4:3 steps (640x480,
// 800x600, 960x720, 1024x768, 1280x960, 1440x1080, 1920x1440). The biggest
// step that fits, centered, with the class "framed" on the stage (the page
// draws its surroundings); the other shape when none of its own fits. A
// stage smaller than 640x480 (a phone) keeps the whole stage.
// SDL takes its window size from the canvas's CSS size: call this before
// multitap_page_start, so it runs before SDL's own resize handling (the
// resize event multitap_page_follow_stage sends).
const MULTITAP_PAGE_STEPS_WIDE = [[3840, 2160], [2560, 1440], [1920, 1080], [1440, 810], [1280, 720], [854, 480]];
const MULTITAP_PAGE_STEPS_4_3 = [[1920, 1440], [1440, 1080], [1280, 960], [1024, 768], [960, 720], [800, 600], [640, 480]];
const MULTITAP_PAGE_NARROW = 1.55;

// The first (biggest) of `steps` that fits width x height, or null.
function multitap_page_step(steps, width, height) {
  for (const step of steps) {
    if (step[0] <= width && step[1] <= height) {
      return step;
    }
  }
  return null;
}

function multitap_page_frame_16x9() {
  const stage = document.getElementById('stage');
  const canvas = document.getElementById('canvas');
  function fit() {
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    const narrow = height > 0 && width / height < MULTITAP_PAGE_NARROW;
    const first = narrow ? MULTITAP_PAGE_STEPS_4_3 : MULTITAP_PAGE_STEPS_WIDE;
    const second = narrow ? MULTITAP_PAGE_STEPS_WIDE : MULTITAP_PAGE_STEPS_4_3;
    const step = multitap_page_step(first, width, height) || multitap_page_step(second, width, height);
    if (step !== null) {
      canvas.style.width = step[0] + 'px';
      canvas.style.height = step[1] + 'px';
      stage.classList.add('framed');
    } else {
      canvas.style.width = '';
      canvas.style.height = '';
      stage.classList.remove('framed');
    }
  }
  new ResizeObserver(fit).observe(stage);
  window.addEventListener('resize', fit);
  document.addEventListener('fullscreenchange', fit);
  fit();
}

// Starts the frontend. config:
//   name         its folder name (app_storage_init's) and module script (<name>.js)
//   title        what the loading message calls it ("PICCOLO")
//   opfs_folder  its folder on OPFS ('' = the root; see multitap-storage.js)
//   skipped      top-level names in its folder that aren't kept on OPFS
//   sw, sw_scope sw.js's URL and scope (relative to the page)
//   started      called once the filesystem is there, before main() (may be null)
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
    preRun: [multitap_storage_environment],
    // The filesystem exists and main() hasn't run: the folder goes in now.
    onRuntimeInitialized: function () {
      multitap_storage_install();
      document.getElementById('overlay').classList.add('gone');
      multitap_page_follow_stage();
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
