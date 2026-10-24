/**
 * DiskSneak — Electron main process.
 *
 * Responsibilities:
 *  - Create the main BrowserWindow (contextIsolation on, nodeIntegration off)
 *  - Expose safe IPC handlers: pick a folder (native dialog) and scan it
 *  - Run scanning in a separate worker to keep the UI responsive
 */

const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");

const { createScanner } = require("./scanner");

// One BrowserWindow per app instance.
let mainWindow = null;
// Active scan controller (supports cancel).
let scanController = null;

/** Create the main window with secure webPreferences. */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 760,
    minHeight: 520,
    title: "DiskSneak",
    backgroundColor: "#0d1117",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));
  mainWindow.on("closed", () => (mainWindow = null));
}

/** Open a native folder picker; resolves to the chosen path or null. */
async function pickFolder() {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"]
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
}

/**
 * Scan the given folder with a new controller, replacing any running scan.
 * Progress/results are pushed to the renderer via the ipc events defined in
 * preload.js (diskSneak.onScanProgress / onScanResult / onScanError).
 */
function scanFolder(folderPath) {
  // A single cancel flag governs all in-flight scans.
  if (scanController) scanController.cancelled = true;
  scanController = createScanner({
    onProgress: (p) => mainWindow?.webContents.send("scan-progress", p),
    onResult: (r) => mainWindow?.webContents.send("scan-result", r),
    onError: (e) => mainWindow?.webContents.send("scan-error", e?.message || String(e))
  });

  scanController.scan(folderPath).catch((err) => {
    mainWindow?.webContents.send(
      "scan-error",
      err?.message || String(err)
    );
  });
  return scanController;
}

/**
 * Move a list of paths into the Windows Recycle Bin (safe delete).
 * Uses Electron's built-in shell.trashItem (Electron 23+), so no
 * third-party native modules are required.
 */
async function moveToRecycleBin(paths) {
  const { shell } = require("electron");
  const errors = [];
  for (const p of paths) {
    try {
      await shell.trashItem(p);
    } catch (err) {
      errors.push(`${p}: ${err?.message || err}`);
    }
  }
  if (errors.length > 0) {
    return { ok: false, failed: errors };
  }
  return { ok: true, moved: paths.length };
}

/** Cancel the in-flight scan. */
function cancelScan() {
  if (scanController) scanController.cancelled = true;
  mainWindow?.webContents.send("scan-error", "Scan cancelled.");
}

function registerIpc() {
  ipcMain.handle("pick-folder", pickFolder);
  ipcMain.handle("scan-folder", (_event, folderPath) => scanFolder(folderPath));
  ipcMain.handle("cancel-scan", cancelScan);
  ipcMain.handle("trash-items", (_event, paths) => moveToRecycleBin(paths));
  ipcMain.handle("get-app-info", () => ({
    name: app.getName(),
    version: app.getVersion()
  }));
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
