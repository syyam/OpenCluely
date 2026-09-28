// Minimal Electron stand-in for loading main.js under plain Node. Installed
// into the require cache under the real 'electron' module id, so every
// require('electron') in the app (including lazy ones) gets it.
// ipcMain records handlers so tests can invoke IPC channels directly.
const path = require('path');
const { EventEmitter } = require('events');

function createStub(userDataDir) {
  const ipcHandlers = new Map();
  const ipcListeners = new Map();

  const display = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 }, workAreaSize: { width: 1920, height: 1040 }, scaleFactor: 1 };

  class BrowserWindow extends EventEmitter {
    static getAllWindows() { return []; }
  }

  const stub = {
    app: Object.assign(new EventEmitter(), {
      getPath: (name) => (name === 'userData' ? userDataDir : path.join(userDataDir, name)),
      setName() {}, getName: () => 'Terminal ',
      whenReady: () => new Promise(() => {}), // app start-up is not under test
      isReady: () => false,
      requestSingleInstanceLock: () => true,
      quit() {}, exit() {}, relaunch() {},
      disableHardwareAcceleration() {},
      setAppUserModelId() {},
      commandLine: { appendSwitch() {} },
    }),
    ipcMain: {
      handle: (channel, fn) => ipcHandlers.set(channel, fn),
      on: (channel, fn) => ipcListeners.set(channel, fn),
    },
    BrowserWindow,
    globalShortcut: { register: () => true, unregisterAll() {} },
    session: {
      defaultSession: {
        webRequest: { onBeforeSendHeaders() {} },
        setCertificateVerifyProc() {},
        setPermissionCheckHandler() {},
        setPermissionRequestHandler() {},
      },
    },
    screen: Object.assign(new EventEmitter(), {
      getPrimaryDisplay: () => display,
      getAllDisplays: () => [display],
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      getDisplayNearestPoint: () => display,
    }),
    desktopCapturer: { getSources: async () => [] },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    clipboard: { writeText() {} },
    shell: { openExternal: async () => {} },
    nativeImage: { createFromBuffer: (b) => ({ toJPEG: () => b }) },
  };

  /** Invoke an ipcMain.handle channel like a renderer would. */
  stub.invoke = (channel, ...args) => {
    const fn = ipcHandlers.get(channel);
    if (!fn) throw new Error(`no ipc handler for ${channel}`);
    return fn({ sender: { send() {} } }, ...args);
  };
  stub.ipcHandlers = ipcHandlers;
  stub.ipcListeners = ipcListeners;
  return stub;
}

/** Put a module's exports into the require cache under its real resolved path. */
function preload(resolvedPath, exports) {
  require.cache[resolvedPath] = { id: resolvedPath, filename: resolvedPath, loaded: true, exports, children: [], paths: [] };
}

function installElectron(userDataDir) {
  const stub = createStub(userDataDir);
  preload(require.resolve('electron'), stub);
  return stub;
}

module.exports = { installElectron, preload };
