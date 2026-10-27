/**
 * DiskSneak — renderer logic.
 *
 * Talks to the main process only through the window.diskSneak API
 * exposed by preload.js (contextIsolation keeps the renderer sandboxed).
 *
 * Views:
 *  - Table: name / type / size / path, multi-select + Recycle Bin
 *  - Treemap: d3-hierarchy + d3.treemap (vendored, see vendor/d3-hierarchy.js)
 *    with hover tooltip and folder drill-down + breadcrumb.
 */

// ---- DOM handles ----
const $ = (id) => document.getElementById(id);

const $btnPick = $("btn-pick");
const $btnScan = $("btn-scan");
const $btnCancel = $("btn-cancel");
const $btnCancelInline = $("btn-cancel-inline");
const $btnTrash = $("btn-trash");
const $btnLicense = $("btn-license");
const $licenseState = $("license-state");
const $toolbarPath = $("toolbar-path");
const $btnTheme = $("btn-theme");
const $themeIconSun = $("theme-icon-sun");
const $themeIconMoon = $("theme-icon-moon");
const $themeText = $("theme-text");

const $scanPanel = $("scan-panel");
const $progressFill = $("progress-fill");
const $progressPct = $("progress-pct");
const $progressLabel = $("progress-label");
const $statScanned = $("stat-scanned");
const $statScannedSize = $("stat-scanned-size");
const $statFiles = $("stat-files");

const $resultsSection = $("results-section");
const $emptyState = $("empty-state");
const $resultsBody = $("results-body");
const $tableView = $("table-view");
const $treemapView = $("treemap-view");
const $viewTableBtn = $("view-table");
const $viewTreemapBtn = $("view-treemap");
const $treemapBox = $("treemap-box");
const $treemapTooltip = $("treemap-tooltip");
const $treemapEmpty = $("treemap-empty");
const $treemapCrumbs = $("treemap-crumbs");

const $sumRoot = $("sum-root");
const $sumTotal = $("sum-total");
const $sumFiles = $("sum-files");
const $sumFolders = $("sum-folders");
const $selectedSummary = $("selected-summary");
const $statusMessage = $("status-message");
const $statusPath = $("status-path");
const $appVersion = $("app-version");

const $licenseModal = $("license-modal");
const $licenseInput = $("license-input");
const $licenseError = $("license-error");
const $btnActivate = $("btn-activate");

// ---- State ----
let lastFolder = null;        // Path selected via the native picker
let lastResult = null;         // Last completed scan result
let currentView = "table";    // "table" | "treemap"
let treemapDir = null;        // Directory the treemap is currently showing
let childrenMap = new Map();  // parentPath -> [item, ...] (built per scan)

// ---- Helpers ----
const UNITS = ["B", "KB", "MB", "GB", "TB"];

/** Format a byte count as a human-readable string. */
function fmtBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i += 1;
  }
  const digits = v >= 100 || i === 0 ? 0 : 1;
  return v.toFixed(digits) + " " + UNITS[i];
}

function setStatus(msg, pathText) {
  $statusMessage.textContent = msg;
  if (pathText !== undefined) $statusPath.textContent = pathText;
}

/** Parent directory of a Windows/POSIX path (string ops, no Node needed). */
function parentDir(fullPath) {
  const idx = Math.max(fullPath.lastIndexOf("\\"), fullPath.lastIndexOf("/"));
  return idx > 0 ? fullPath.slice(0, idx) : fullPath;
}

/** Rebuild the parent→children map from scan items (drives the treemap). */
function rebuildChildrenMap(result) {
  childrenMap = new Map();
  for (const item of result.items) {
    const parent = parentDir(item.path);
    let list = childrenMap.get(parent);
    if (!list) {
      list = [];
      childrenMap.set(parent, list);
    }
    list.push(item);
  }
}

// ============================
// Table rendering
// ============================

function rowFromItem(item, index) {
  const tr = document.createElement("tr");

  const tdCheck = document.createElement("td");
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.className = "row-check";
  cb.dataset.index = index;
  cb.dataset.path = item.path;
  cb.addEventListener("change", updateSelection);
  tdCheck.append(cb);

  const tdName = document.createElement("td");
  tdName.textContent = item.name;

  const tdType = document.createElement("td");
  const badge = document.createElement("span");
  badge.className = `type-badge ${item.type}`;
  badge.textContent = item.type === "file" ? "File" : "Folder";
  tdType.append(badge);

  const tdSize = document.createElement("td");
  tdSize.textContent = fmtBytes(item.size);

  const tdPath = document.createElement("td");
  tdPath.className = "cell-path";
  tdPath.title = item.path;
  tdPath.textContent = item.path;

  tr.append(tdCheck, tdName, tdType, tdSize, tdPath);
  return tr;
}

/** Re-render the results section from the last scan result. */
function renderResults(result) {
  lastResult = result;
  rebuildChildrenMap(result);

  $emptyState.classList.add("hidden");
  $resultsSection.classList.remove("hidden");

  $sumRoot.textContent = result.root;
  $sumTotal.textContent = fmtBytes(result.totalSize);
  $sumFiles.textContent = String(result.fileCount);
  $sumFolders.textContent = String(result.folderCount);

  const frag = document.createDocumentFragment();
  for (let i = 0; i < result.items.length; i += 1) {
    frag.append(rowFromItem(result.items[i], i));
  }
  $resultsBody.replaceChildren(frag);

  // Treemap starts at the scan root.
  treemapDir = result.root;
  if (currentView === "treemap") renderTreemap();

  updateSelection();
  setStatus("Scan complete", result.root);
}

function updateSelection() {
  const checked = $resultsBody.querySelectorAll("input.row-check:checked");
  $btnTrash.disabled = checked.length === 0;
  $selectedSummary.textContent =
    checked.length === 0 ? "0 selected" : `${checked.length} selected`;
}

// ============================
// Scan flow
// ============================

function pickAndPrepare() {
  window.diskSneak.pickFolder().then((folderPath) => {
    if (!folderPath) {
      setStatus("Folder selection cancelled");
      return;
    }
    lastFolder = folderPath;
    $btnScan.disabled = false;
    $toolbarPath.textContent = folderPath;
    $statusPath.textContent = folderPath;
    setStatus("Folder selected — press Scan", folderPath);
  });
}

function startScan() {
  if (!lastFolder) return;
  const folderPath = lastFolder;
  $scanPanel.classList.remove("hidden");
  $resultsSection.classList.add("hidden");
  $emptyState.classList.add("hidden");
  $progressLabel.textContent = "Scanning…";
  $progressFill.style.width = "0%";
  $progressPct.textContent = "0%";
  $statScanned.textContent = "0";
  $statScannedSize.textContent = "0 B";
  $statFiles.textContent = "0";
  $btnScan.disabled = true;
  $btnCancel.hidden = false;
  $btnCancelInline.hidden = false;
  $btnTrash.disabled = true;

  window.diskSneak.scanFolder(folderPath);
  setStatus("Scanning", folderPath);
}

function cancelScan() {
  // Dedicated IPC handler in main.js sets the controller's cancel flag;
  // the running scan loop checks the flag and reports "Scan cancelled".
  window.diskSneak.cancelScan();
}

function onScanProgress(p) {
  $progressFill.style.width = `${p.percent}%`;
  $progressPct.textContent = `${Math.round(p.percent)}%`;
  $statScanned.textContent = `${p.scanned}`;
  $statScannedSize.textContent = fmtBytes(p.totalSize);
  if (p.fileCount !== undefined) $statFiles.textContent = `${p.fileCount}`;
}

function finishScanUI() {
  $scanPanel.classList.add("hidden");
  $btnScan.disabled = lastFolder !== null;
  $btnCancel.hidden = true;
  $btnCancelInline.hidden = true;
}

function onScanResult(result) {
  finishScanUI();
  renderResults(result);
}

function onScanError(msg) {
  finishScanUI();
  setStatus("Scan error", msg);
  $resultsSection.classList.add("hidden");
  $emptyState.classList.remove("hidden");
}

// ============================
// Trash flow (existing behavior)
// ============================

function trashSelected() {
  const paths = [...$resultsBody.querySelectorAll("input.row-check:checked")].map((cb) => cb.dataset.path);
  if (paths.length === 0) return;

  $btnTrash.disabled = true;
  setStatus(`Moving ${paths.length} item(s) to Recycle Bin…`);
  window.diskSneak
    .trashItems(paths)
    .then((res) => {
      if (res.ok) {
        setStatus(`Moved ${res.moved} item(s) to the Recycle Bin.`);
        // Uncheck and refresh (trashed rows disappear on the next scan)
        $resultsBody.querySelectorAll("input.row-check:checked").forEach((cb) => (cb.checked = false));
        updateSelection();
      } else {
        const first = res.failed?.[0] || "unknown error";
        setStatus("Recycle Bin error", first);
      }
      updateSelection();
    })
    .catch((err) => {
      setStatus("Recycle Bin error", String(err?.message || err));
      $btnTrash.disabled = false;
    });
}

// ============================
// View switching
// ============================

function setView(view) {
  currentView = view;
  $viewTableBtn.classList.toggle("active", view === "table");
  $viewTreemapBtn.classList.toggle("active", view === "treemap");
  $tableView.classList.toggle("hidden", view !== "table");
  $treemapView.classList.toggle("hidden", view !== "treemap");
  $btnTrash.style.display = view === "table" ? "" : "none";
  $selectedSummary.style.display = view === "table" ? "" : "none";
  if (view === "treemap") {
    if (lastResult && !treemapDir) treemapDir = lastResult.root;
    renderTreemap();
  }
}

// ============================
// Treemap (d3-hierarchy + d3.treemap)
// ============================

const TREEMAP_COLORS = {
  file: "hsl(215, 85%, 45%)",
  folder: "hsl(215, 70%, 34%)"
};

function renderTreemap() {
  const box = $treemapBox;
  // Clear any previously injected cells (keep tooltip + empty msg)
  box.querySelectorAll(".tm-cell").forEach((el) => el.remove());

  if (!lastResult) {
    $treemapEmpty.textContent = "Nothing to visualize yet.";
    $treemapEmpty.classList.remove("hidden");
    return;
  }
  $treemapEmpty.classList.add("hidden");

  const w = box.clientWidth - 8;
  const h = box.clientHeight - 8;

  const kids = childrenMap.get(treemapDir || lastResult.root) || [];
  if (kids.length === 0) {
    $treemapEmpty.textContent = "This folder has no items.";
    $treemapEmpty.classList.remove("hidden");
    renderCrumbs();
    return;
  }

  // Build the hierarchy: root = current directory, children = direct items.
  const root = {
    name: (treemapDir || lastResult.root).split(/[\\/]/).pop() || lastResult.root,
    children: kids.map((k) => ({
      name: k.name,
      size: k.size,
      path: k.path,
      type: k.type
    }))
  };

  const hierarchy = d3.hierarchy(root).sum((d) => d.size);

  const layout = d3.treemap()
    .size([w, h])
    .paddingOuter(2)
    .paddingInner(2);
  layout(hierarchy);

  const leaves = hierarchy.leaves();
  const maxLeaf = leaves.reduce((m, l) => Math.max(m, l.value || 0), 0) || 1;

  const frag = document.createDocumentFragment();
  for (const leaf of leaves) {
    const d = leaf.data;
    const cell = document.createElement("div");
    cell.className = `tm-cell ${d.type}`;
    cell.style.left = leaf.x0 + "px";
    cell.style.top = leaf.y0 + "px";
    cell.style.width = Math.max(leaf.x1 - leaf.x0, 0) + "px";
    cell.style.height = Math.max(leaf.y1 - leaf.y0, 0) + "px";

    // Bigger items → deeper, more saturated color.
    const t = (leaf.value || 0) / maxLeaf;
    const light = 52 - 24 * t;
    cell.style.background =
      d.type === "file"
        ? `hsl(215, 85%, ${light}%)`
        : `hsl(215, 55%, ${light + 8}%)`;

    // Labels only when the cell is wide/tall enough.
    const label = document.createElement("span");
    label.className = "tm-label";
    label.textContent = d.name;
    const sizeLbl = document.createElement("span");
    sizeLbl.className = "tm-size";
    sizeLbl.textContent = fmtBytes(d.size);
    cell.append(label, sizeLbl);
    if (leaf.x1 - leaf.x0 < 70 || leaf.y1 - leaf.y0 < 40) {
      label.classList.add("hidden");
      sizeLbl.classList.add("hidden");
    }

    // Hover tooltip: name + size.
    cell.addEventListener("mousemove", (ev) => {
      showTooltip(ev, d);
    });
    cell.addEventListener("mouseleave", hideTooltip);

    // Drill-down: folders with children open that folder.
    if (d.type === "folder" && childrenMap.has(d.path)) {
      cell.classList.add("folder");
      cell.addEventListener("click", () => {
        treemapDir = d.path;
        renderTreemap();
      });
    }

    frag.append(cell);
  }
  box.append(frag);
  renderCrumbs();
}

/** Breadcrumb of the drill-down path; clicking a crumb jumps up. */
function renderCrumbs() {
  $treemapCrumbs.replaceChildren();
  if (!lastResult || !treemapDir) return;

  const parts = [];
  let cur = treemapDir;
  while (cur) {
    parts.unshift({ path: cur, name: cur.split(/[\\/]/).pop() || cur });
    const parent = parentDir(cur);
    cur = parent === cur ? null : parent;
  }

  parts.forEach((p, i) => {
    const b = document.createElement("span");
    b.className = "crumb" + (i === parts.length - 1 ? " current" : "");
    b.textContent = p.name;
    b.title = p.path;
    b.addEventListener("click", () => {
      treemapDir = p.path;
      renderTreemap();
    });
    $treemapCrumbs.append(b);
    if (i < parts.length - 1) {
      const sep = document.createElement("span");
      sep.className = "muted";
      sep.textContent = "›";
      $treemapCrumbs.append(sep);
    }
  });
}

function showTooltip(ev, d) {
  const box = $treemapBox;
  const tt = $treemapTooltip;
  tt.innerHTML = "";
  const name = document.createElement("div");
  name.className = "tt-name";
  name.textContent = d.name;
  const size = document.createElement("div");
  size.className = "tt-size";
  size.textContent = `${fmtBytes(d.size)} · ${d.type}`;
  tt.append(name, size);
  tt.classList.remove("hidden");

  const rect = box.getBoundingClientRect();
  let x = ev.clientX - rect.left + 14;
  let y = ev.clientY - rect.top + 14;
  if (x + 280 > rect.width) x = ev.clientX - rect.left - 294;
  if (y + 60 > rect.height) y = ev.clientY - rect.top - 74;
  tt.style.left = Math.max(4, x) + "px";
  tt.style.top = Math.max(4, y) + "px";
}

function hideTooltip() {
  $treemapTooltip.classList.add("hidden");
}

// Re-layout on window resize (debounced).
let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (currentView === "treemap" && lastResult) renderTreemap();
  }, 150);
});

// ============================
// License (Dodo Payments ready)
// ============================

function initLicense() {
  window.diskSneak.getLicenseStatus().then((st) => {
    if (st.licensed) {
      $licenseState.textContent = "Licensed";
    } else {
      $licenseState.textContent = "Unlicensed";
      // First launch / not licensed → show the activation modal.
      $licenseModal.classList.remove("hidden");
    }
  }).catch(() => {
    $licenseState.textContent = "Unlicensed";
    $licenseModal.classList.remove("hidden");
  });
}

function activateLicense() {
  const key = $licenseInput.value.trim();
  const err = $licenseError;
  err.classList.add("hidden");
  $btnActivate.disabled = true;
  window.diskSneak.activateLicense(key).then((res) => {
    if (res.ok) {
      $licenseModal.classList.add("hidden");
      $licenseState.textContent = "Licensed";
      setStatus("License activated.");
    } else {
      err.textContent = res.error || "Invalid license key.";
      err.classList.remove("hidden");
    }
    $btnActivate.disabled = false;
  }).catch((err2) => {
    err.textContent = String(err2?.message || err2);
    err.classList.remove("hidden");
    $btnActivate.disabled = false;
  });
}

// ============================
// Wire up events
// ============================

window.diskSneak.onScanProgress(onScanProgress);
window.diskSneak.onScanResult(onScanResult);
window.diskSneak.onScanError(onScanError);

$btnPick.addEventListener("click", pickAndPrepare);
$btnScan.addEventListener("click", startScan);
$btnCancel.addEventListener("click", cancelScan);
$btnCancelInline.addEventListener("click", cancelScan);
$btnTrash.addEventListener("click", trashSelected);
$viewTableBtn.addEventListener("click", () => setView("table"));
$viewTreemapBtn.addEventListener("click", () => setView("treemap"));
$btnLicense.addEventListener("click", () => $licenseModal.classList.remove("hidden"));
$btnActivate.addEventListener("click", activateLicense);

window.diskSneak
  .getAppInfo()
  .then((info) => {
    $appVersion.textContent = `v${info.version}`;
  });

// ============================
// Theme support (Light / Dark)
// ============================

function applyTheme(theme) {
  const isLight = theme === "light";
  document.documentElement.setAttribute("data-theme", isLight ? "light" : "dark");
  if ($themeIconSun && $themeIconMoon && $themeText) {
    $themeIconSun.classList.toggle("hidden", !isLight);
    $themeIconMoon.classList.toggle("hidden", isLight);
    $themeText.textContent = isLight ? "Light" : "Dark";
  }
}

function initTheme() {
  const saved = localStorage.getItem("disksneak-theme");
  const preferred = saved || (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  applyTheme(preferred);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  const next = current === "light" ? "dark" : "light";
  localStorage.setItem("disksneak-theme", next);
  applyTheme(next);
}

if ($btnTheme) {
  $btnTheme.addEventListener("click", toggleTheme);
}

initTheme();
initLicense();
