/**
 * DiskSneak — preload script.
 *
 * With contextIsolation enabled, the renderer cannot touch Node or
 * Electron APIs directly. This script exposes a minimal, safe API on
 * window.diskSneak, bridging to ipcMain handlers in main.js.
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("diskSneak", {
  /** Open the native folder picker. Resolves to a path string or null. */
  pickFolder: () => ipcRenderer.invoke("pick-folder"),

  /** Start scanning the given path. Results arrive via on* callbacks. */
  scanFolder: (folderPath) => ipcRenderer.invoke("scan-folder", folderPath),

  /** Cancel the currently running scan. */
  cancelScan: () => ipcRenderer.invoke("cancel-scan"),

  /** Move selected items to the Recycle Bin. Resolves to { ok, moved | failed[] }. */
  trashItems: (paths) => ipcRenderer.invoke("trash-items", paths),

  /** App info: { name, version }. */
  getAppInfo: () => ipcRenderer.invoke("get-app-info"),

  /** License status (Dodo Payments ready): { licensed, devMode }. */
  getLicenseStatus: () => ipcRenderer.invoke("get-license-status"),

  /** Validate + store a license key. Resolves to { ok, error? }. */
  activateLicense: (key) => ipcRenderer.invoke("activate-license", key),

  /** Subscribe to scan progress events from the main process. */
  onScanProgress: (cb) => {
    ipcRenderer.on("scan-progress", (_e, p) => cb(p));
  },
  onScanResult: (cb) => {
    ipcRenderer.on("scan-result", (_e, r) => cb(r));
  },
  onScanError: (cb) => {
    ipcRenderer.on("scan-error", (_e, msg) => cb(msg));
  }
});
