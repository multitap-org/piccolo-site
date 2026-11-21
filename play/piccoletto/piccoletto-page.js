// piccoletto's page in the browser: what's only piccoletto's. The start
// (threads, its folder on OPFS, the module) is frontends-common's
// multitap-page.js and multitap-storage.js. This adds what a phone app
// wants: full screen at the first touch, the screen kept on, and ROTATE.

'use strict';

// The screen stays on while piccoletto is shown (a pad held for minutes
// without touching the screen would otherwise let it sleep). The browser
// drops the lock when the page is hidden: taken again when it's back.
async function piccoletto_page_wake_lock() {
  if (!('wakeLock' in navigator) || document.hidden) {
    return;
  }
  try {
    await navigator.wakeLock.request('screen');
  } catch (error) {
    console.log('Wake lock: ' + error.message);
  }
}

function piccoletto_page_touch_device() {
  return window.matchMedia('(pointer: coarse)').matches;
}

async function piccoletto_page_fullscreen() {
  if (document.fullscreenElement || !document.documentElement.requestFullscreen) {
    return;
  }
  try {
    await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
  } catch (error) {
    console.log('Full screen: ' + error.message);
  }
}

// ROTATE (main.cpp's rotate): lock the screen to the other side. Browsers
// only lock in full screen, and only on phones; elsewhere nothing turns.
async function piccoletto_page_rotate(orientation) {
  await piccoletto_page_fullscreen();
  if (!screen.orientation || !screen.orientation.lock) {
    return;
  }
  try {
    await screen.orientation.lock(orientation);
  } catch (error) {
    console.log('Rotate: ' + error.message);
  }
}

function piccoletto_page_started() {
  piccoletto_page_wake_lock();
  document.addEventListener('visibilitychange', piccoletto_page_wake_lock);
  // A phone: full screen at the first touch (browsers allow it only from a
  // gesture), like the app, which has no system bars. The touch still
  // reaches piccoletto.
  if (piccoletto_page_touch_device()) {
    window.addEventListener('pointerdown', function () { piccoletto_page_fullscreen(); }, { once: true, capture: true });
  }
}

function piccoletto_page_start() {
  multitap_page_start({
    name: 'piccoletto',
    title: 'PICCOLETTO',
    // Its own folder on OPFS: piccolo has the root (multitap-storage.js).
    opfs_folder: 'piccoletto',
    skipped: [],
    sw: '../sw.js',
    sw_scope: '../',
    started: piccoletto_page_started,
  });
}
