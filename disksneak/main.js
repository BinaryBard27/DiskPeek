/**
 * DiskSneak — Electron main process.
 *
 * Responsibilities:
 *  - Create the main BrowserWindow (contextIsolation on, nodeIntegration off)
 *  - Expose safe IPC handlers: pick a folder (native dialog) and scan it
 *  - Run scanning in a separate worker to keep the UI responsive
 */

const { app, BrowserWindow, ipcMain, dialog, safeStorage } = require("electron");
const fs = require("fs");
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

  // External links (e.g. the Dodo Payments buy page) open in the system
  // browser instead of spawning new Electron windows.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const { shell } = require("electron");
    if (url.startsWith("https://") || url.startsWith("http://")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });
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

// ---------------------------------------------------------------------------
// License system (Dodo Payments ready)
//
// The key is stored encrypted on disk in the per-user app-data folder
// (safeStorage uses DPAPI on Windows, so it is tied to the current user).
//
// DODO PAYMENTS PLACEHOLDER:
// When Dodo goes live, replace `validateLicenseKey`'s dev rule with a call
// to Dodo's license validation endpoint, e.g.:
//
//   const res = await fetch(
//     "https://api.dodopayments.com/v1/licenses/validate?license_key=..."
//   );
//   const data = await res.json();
//   return { valid: data.valid, license: data };
//
// The purchase link on the website points at your Dodo checkout; on success
// Dodo emails the customer a key that this handler will accept.
// ---------------------------------------------------------------------------

const LICENSE_FILE_NAME = "license.json";

/** Path to the (encrypted) license file in the per-user app-data folder. */
function licenseFilePath() {
  return path.join(app.getPath("userData"), LICENSE_FILE_NAME);
}

/** Read + decrypt the stored license. Returns the key string or null. */
function readStoredLicense() {
  try {
    const raw = fs.readFileSync(licenseFilePath(), "utf8");
    const encrypted = JSON.parse(raw);
    const decrypted = safeStorage.decryptString(encrypted);
    return JSON.parse(decrypted)?.license || null;
  } catch {
    return null; // Missing file, undecryptable, or corrupt JSON → not licensed.
  }
}

/** Encrypt + persist a license key. */
function storeLicense(key) {
  const payload = JSON.stringify({
    license: (key || "").trim(),
    storedAt: new Date().toISOString()
  });
  // safeStorage.encryptString returns a { key, iv } structure (DPAPI on Win).
  const encrypted = safeStorage.encryptString(payload);
  fs.writeFileSync(licenseFilePath(), JSON.stringify(encrypted));
}

/**
 * Development validation: accept any key longer than 10 characters.
 * @returns {{valid:boolean}}
 */
function validateLicenseKey(key) {
  const clean = (key || "").trim();
  // TODO(DODO): replace with the Dodo Payments API check described above.
  return { valid: clean.length > 10 };
}

/** Validate and persist a license key. Returns { ok, error? }. */
async function activateLicense(key) {
  const { valid } = validateLicenseKey(key);
  if (!valid) {
    return { ok: false, error: "Invalid key: must be longer than 10 characters." };
  }
  try {
    storeLicense(key);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Could not store license: ${err.message}` };
  }
}

/** License state for the renderer (drives the modal + top-bar badge). */
async function getLicenseStatus() {
  const license = readStoredLicense();
  return { licensed: license !== null, devMode: true };
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
  // License IPC (Dodo Payments ready)
  ipcMain.handle("get-license-status", getLicenseStatus);
  ipcMain.handle("activate-license", (_event, key) => activateLicense(key));
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
