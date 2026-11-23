// A frontend's folder in the browser (app_storage.h): kept on OPFS (the
// origin private file system), used from memory.
//
// The frontend reads and writes its folder (settings, saves, states, games)
// in the virtual filesystem's memory, which never blocks. This file keeps it
// on OPFS with OPFS's own async API, from the page:
//
// - before the module's main(), everything on OPFS is copied into memory;
// - multitap_storage_sync() writes what changed back (and removes what's
//   gone): every few seconds, when the tab is hidden, and after the frontend
//   saves (app_storage_flush).
//
// Why not Emscripten's OPFS backend (WasmFS) mounted as the folder: it works
// in Chrome, but in Firefox renames fail (settings are written to a temporary
// file and renamed) and reading a file written earlier blocks forever, so the
// page hangs at start. The async API works the same in every browser.
//
// Every frontend on one site shares one OPFS: each keeps its folder in its
// own OPFS folder (opfs_folder), except piccolo, which has the root (where
// its first browser builds kept it) and skips the others' folders.

'use strict';

const MULTITAP_DATA = '/data';      // XDG_DATA_HOME, set before main()
const MULTITAP_SYNC_SECONDS = 5;

const multitap_storage = {
  folder: '',          // the frontend's folder in the virtual filesystem (/data/<name>)
  skipped: [],         // top-level names inside it that aren't kept (cache/, other frontends' OPFS folders)
  root: null,          // the OPFS folder kept (FileSystemDirectoryHandle), null without OPFS
  loaded: [],          // [path inside the folder, bytes]: read before the module starts
  known: new Map(),    // path inside the folder -> "size:mtime" (or "dir") as last written to OPFS
  busy: false,
  again: false,
};

function multitap_storage_skipped(relative) {
  for (const name of multitap_storage.skipped) {
    if (relative === name || relative.startsWith(name + '/')) {
      return true;
    }
  }
  return false;
}

function multitap_storage_join(parent, name) {
  return parent === '' ? name : parent + '/' + name;
}

async function multitap_storage_read_folder(handle, relative) {
  for await (const [name, entry] of handle.entries()) {
    const path = multitap_storage_join(relative, name);
    if (multitap_storage_skipped(path)) {
      continue;
    }
    if (entry.kind === 'directory') {
      multitap_storage.loaded.push([path, null]);
      await multitap_storage_read_folder(entry, path);
    } else {
      const file = await entry.getFile();
      multitap_storage.loaded.push([path, new Uint8Array(await file.arrayBuffer())]);
    }
  }
}

// Step 1, before the module's script loads: OPFS -> a list in JS memory.
//   name        the frontend's folder name (app_storage_init's folder_name)
//   opfs_folder its folder on OPFS ('' = the root)
//   skipped     top-level names never kept (cache/: made again when needed)
async function multitap_storage_read(name, opfs_folder, skipped) {
  multitap_storage.folder = MULTITAP_DATA + '/' + name;
  multitap_storage.skipped = skipped;
  try {
    let root = await navigator.storage.getDirectory();
    if (opfs_folder !== '') {
      root = await root.getDirectoryHandle(opfs_folder, { create: true });
    }
    multitap_storage.root = root;
  } catch (error) {
    console.log('Storage: no OPFS here (' + error.message + '): nothing is kept after this tab closes');
    multitap_storage.root = null;
    return;
  }
  try {
    await multitap_storage_read_folder(multitap_storage.root, '');
  } catch (error) {
    console.log('Storage: can\'t read OPFS: ' + error.message);
  }
}

// stat.mode's file type (WasmFS's FS has no isDir).
function multitap_storage_is_folder(mode) {
  return (mode & 0o170000) === 0o040000;
}

function multitap_storage_key(stat) {
  return stat.size + ':' + Number(stat.mtime);
}

// Step 2, from Module.preRun: the frontend's folder is XDG_DATA_HOME/<name>.
function multitap_storage_environment() {
  Module.ENV.XDG_DATA_HOME = MULTITAP_DATA;
}

// Step 3, from Module.onRuntimeInitialized (the filesystem exists, main()
// hasn't run): the list -> the frontend's folder in memory.
function multitap_storage_install() {
  Module.FS.mkdirTree(multitap_storage.folder);
  for (const [path, data] of multitap_storage.loaded) {
    const full = multitap_storage.folder + '/' + path;
    try {
      if (data === null) {
        Module.FS.mkdirTree(full);
        multitap_storage.known.set(path, 'dir');
      } else {
        Module.FS.writeFile(full, data);
        multitap_storage.known.set(path, multitap_storage_key(Module.FS.stat(full)));
      }
    } catch (error) {
      console.log('Storage: can\'t restore ' + path + ': ' + error.message);
    }
  }
  console.log('Storage: ' + multitap_storage.loaded.length + ' entries from OPFS into ' + multitap_storage.folder);
  multitap_storage.loaded = [];
  if (multitap_storage.root !== null) {
    setInterval(multitap_storage_sync, MULTITAP_SYNC_SECONDS * 1000);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        multitap_storage_sync();
      }
    });
  }
}

async function multitap_storage_write_folder(handle, relative, seen) {
  const folder = relative === '' ? multitap_storage.folder : multitap_storage.folder + '/' + relative;
  for (const name of Module.FS.readdir(folder)) {
    if (name === '.' || name === '..') {
      continue;
    }
    const path = multitap_storage_join(relative, name);
    if (multitap_storage_skipped(path)) {
      continue;
    }
    const full = folder + '/' + name;
    let stat;
    try {
      stat = Module.FS.stat(full);
    } catch (error) {
      continue;   // removed since readdir
    }
    seen.add(path);
    if (multitap_storage_is_folder(stat.mode)) {
      const child = await handle.getDirectoryHandle(name, { create: true });
      multitap_storage.known.set(path, 'dir');
      await multitap_storage_write_folder(child, path, seen);
      continue;
    }
    const key = multitap_storage_key(stat);
    if (multitap_storage.known.get(path) === key) {
      continue;
    }
    // A copy: the module's memory is shared (threads), and OPFS takes no
    // views of shared memory.
    const data = new Uint8Array(Module.FS.readFile(full));
    const file = await handle.getFileHandle(name, { create: true });
    const writable = await file.createWritable();
    await writable.write(data);
    await writable.close();
    multitap_storage.known.set(path, key);
  }
}

async function multitap_storage_remove(path) {
  const parts = path.split('/');
  const name = parts.pop();
  let handle = multitap_storage.root;
  for (const part of parts) {
    handle = await handle.getDirectoryHandle(part);
  }
  await handle.removeEntry(name, { recursive: true });
}

async function multitap_storage_sync_once() {
  const seen = new Set();
  await multitap_storage_write_folder(multitap_storage.root, '', seen);
  // Gone from memory: gone from OPFS. Parents first is fine (recursive).
  for (const path of Array.from(multitap_storage.known.keys())) {
    if (!seen.has(path)) {
      multitap_storage.known.delete(path);
      try {
        await multitap_storage_remove(path);
      } catch (error) {
        // Already gone with its folder.
      }
    }
  }
}

// Memory -> OPFS, what changed since the last time. One at a time: a call
// while one runs makes it go once more when it ends.
async function multitap_storage_sync() {
  if (multitap_storage.root === null || typeof Module === 'undefined' || !Module.FS) {
    return;
  }
  if (multitap_storage.busy) {
    multitap_storage.again = true;
    return;
  }
  multitap_storage.busy = true;
  try {
    do {
      multitap_storage.again = false;
      await multitap_storage_sync_once();
    } while (multitap_storage.again);
  } catch (error) {
    console.log('Storage: can\'t write to OPFS: ' + error.message);
  } finally {
    multitap_storage.busy = false;
  }
}
