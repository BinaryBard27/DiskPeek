/**
 * DiskSneak — renderer logic.
 *
 * Talks to the main process only through the window.diskSneak API
 * exposed by preload.js (contextIsolation keeps the renderer sandboxed).
 */

// ---- DOM handles ----
const $ = (id) => document.getElementById(id);

const $btnScan = $("btn-scan");
const $btnCancel = $("btn-cancel");
const $btnTrash = $("btn-trash");

const $scanPanel = $("scan-panel");
const $progressFill = $("progress-fill");
const $progressPct = $("progress-pct");
const $progressLabel = $("progress-label");
const $statScanned = $("stat-scanned");
const $statScannedSize = $("stat-scanned-size");

const $resultsSection = $("results-section");
const $emptyState = $("empty-state");
const $resultsBody = $("results-body");

const $sumRoot = $("sum-root");
const $sumCounts = $("sum-counts");
const $selectedSummary = $("selected-summary");
const $statusMessage = $("status-message");
const $statusPath = $("status-path");
const $appVersion = $("app-version");

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

/** Re-render the results table from the last scan result. */
function renderResults(result) {
  $emptyState.classList.add("hidden");
  $resultsSection.classList.remove("hidden");

  $sumRoot.textContent = result.root;
  $sumCounts.textContent =
    `${result.fileCount} files · ${result.folderCount} folders · ${fmtBytes(result.totalSize)} total`;

  const frag = document.createDocumentFragment();
  for (let i = 0; i < result.items.length; i += 1) {
    frag.append(rowFromItem(result.items[i], i));
  }
  $resultsBody.replaceChildren(frag);

  updateSelection();
  setStatus("Scan complete", result.root);
}

function updateSelection() {
  const checked = $resultsBody.querySelectorAll("input.row-check:checked");
  $btnTrash.disabled = checked.length === 0;
  $selectedSummary.textContent =
    checked.length === 0
      ? "0 selected"
      : `${checked.length} selected`;
}

function startScan() {
  window.diskSneak.pickFolder().then((folderPath) => {
    if (!folderPath) {
      setStatus("Folder selection cancelled");
      return;
    }
    $scanPanel.classList.remove("hidden");
    $resultsSection.classList.add("hidden");
    $emptyState.classList.add("hidden");
    $progressLabel.textContent = "Scanning…";
    $progressFill.style.width = "0%";
    $progressPct.textContent = "0%";
    $statScanned.textContent = "0 items";
    $statScannedSize.textContent = "0 B scanned";
    $btnScan.disabled = true;

    window.diskSneak.scanFolder(folderPath);
    setStatus("Scanning", folderPath);
  });
}

function cancelScan() {
  // Dedicated IPC handler in main.js sets the controller's cancel flag;
  // the running scan loop checks the flag and reports "Scan cancelled".
  window.diskSneak.cancelScan();
}

function trashSelected() {
  const paths = [...$resultsBody.querySelectorAll("input.row-check:checked")]
    .map((cb) => cb.dataset.path);
  if (paths.length === 0) return;

  $btnTrash.disabled = true;
  setStatus(`Moving ${paths.length} item(s) to Recycle Bin…`);
  window.diskSneak
    .trashItems(paths)
    .then((res) => {
      if (res.ok) {
        setStatus(`Moved ${res.moved} item(s) to the Recycle Bin.`);
        // Uncheck and re-render (trashed rows will disappear on next scan)
        $resultsBody.querySelectorAll("input.row-check:checked").forEach((cb) => (cb.checked = false));
        updateSelection();
      } else {
        const first = res.failed?.[0] || "unknown error";
        setStatus("Recycle Bin error", first);
      }
      $btnTrash.disabled = true;
      updateSelection();
    })
    .catch((err) => {
      setStatus("Recycle Bin error", String(err?.message || err));
      $btnTrash.disabled = false;
    });
}

// ---- Wire up events ----
window.diskSneak.onScanProgress((p) => {
  $progressFill.style.width = `${p.percent}%`;
  $progressPct.textContent = `${Math.round(p.percent)}%`;
  $statScanned.textContent = `${p.scanned} items`;
  $statScannedSize.textContent = `${fmtBytes(p.totalSize)} scanned`;
});

window.diskSneak.onScanResult((result) => {
  $scanPanel.classList.add("hidden");
  $btnScan.disabled = false;
  renderResults(result);
});

window.diskSneak.onScanError((msg) => {
  $scanPanel.classList.add("hidden");
  $btnScan.disabled = false;
  setStatus("Scan error", msg);
});

window.diskSneak
  .getAppInfo()
  .then((info) => {
    $appVersion.textContent = `v${info.version}`;
  });

$btnScan.addEventListener("click", startScan);
$btnCancel.addEventListener("click", cancelScan);
$btnTrash.addEventListener("click", trashSelected);
