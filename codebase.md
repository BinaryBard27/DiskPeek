# DiskPeek — Codebase Documentation

Complete reference for the two applications in this repository:
the **DiskPeek** live disk-usage web app (`app/`) and the
**DiskSneak** Electron folder-scan desktop app (`disksneak/`),
plus the `diskbuddy-reverse-engineering.md` research document.

---

## 1. Repository Layout

```
DiskPeek/
├── app/                     DiskPeek: FastAPI server + live browser UI
│   ├── __init__.py
│   ├── main.py              FastAPI app: /api/disks + static mount + index
│   ├── disk_service.py      Volume sampler (Win32 / POSIX / synthetic)
│   └── static/
│       ├── index.html       Single-page UI shell (top bar + #disks grid + theme toggle)
│       ├── app.js           Polling loop, card rendering, byte formatting, theme persistence
│       └── style.css       Dark & light theme, pressure color-coding, reduced-motion
├── disksneak/               DiskSneak: Electron desktop app
│   ├── main.js              Main process: window, IPC handlers, recycle-bin
│   ├── preload.js           contextBridge API on window.diskSneak
│   ├── renderer.js          UI logic (progress, results table, selection, trash)
│   ├── scanner.js           Async tree-walk scanner with progress + cancel
│   ├── index.html           Renderer page (scan panel, results table)
│   ├── styles.css           Renderer styling
│   ├── package.json         Electron app manifest (devDeps: electron)
│   └── assets/icon.png     App icon
├── diskbuddy-reverse-engineering.md   Research notes (no code)
├── disksneak.zip           Archived copy of the disksneak app
├── requirements.txt         fastapi>=0.110, uvicorn>=0.29
└── README.md
```

---

## 2. DiskPeek — Architecture

### 2.1 System Overview

```
┌────────────────────────────────────────────────────────────────────┐
│ BROWSER (app/static)                                                │
│   index.html + app.js: polls GET /api/disks every 2 s, renders    │
│   per-volume cards (used/free/total, utilization bar)             │
└──────────────────────────┬─────────────────────────────────────────┘
                           │ HTTP (every 2000 ms, fetch)
┌──────────────────────────┴─────────────────────────────────────────┐
│ SERVER — FastAPI (app/main.py)                                      │
│   GET /api/disks  ──▶ disk_service.get_disks()                     │
│   GET /           ──▶ static/index.html (FileResponse)             │
│   /static/*       ──▶ StaticFiles mount (style.css, app.js)        │
└──────────────────────────┬─────────────────────────────────────────┘
                           │ in-process call
┌──────────────────────────┴─────────────────────────────────────────┐
│ SAMPLER — disk_service.py                                            │
│   Windows  : A:–Z: via shutil.disk_usage (Win32 GetDiskFreeSpaceExW)│
│   Other OS  : POSIX mount points from /proc/mounts + "/"            │
│   Fallback  : clearly-labelled synthetic data (source="synthetic") │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 Components

| File | Responsibility |
|---|---|
| `app/main.py` | Builds the FastAPI app; serves the API and the UI |
| `app/disk_service.py` | Samples every reachable volume; platform-native first, synthetic last |
| `app/static/index.html` | UI shell: top bar (brand + LIVE badge + updated time), `#disks` grid |
| `app/static/app.js` | Polling loop, card DOM construction, byte formatting |
| `app/static/style.css` | Dark theme, color-coded pressure (ok/warn/critical), reduced-motion support |

### 2.3 Sampler fallback chain (`get_disks`)

```
get_disks()
  1. platform == "Windows" → _win32_disks(): iterate A:..Z:,
     call shutil.disk_usage(drive); skip unreachable drives (OSError).
     source = "win32"
  2. else → _posix_disks(): roots = ["/"] + mount points parsed
     from /proc/mounts (skipping "/"); dedupe, sample each root.
     source = "posix"
  3. If the platform pass returns no disks → _synthetic_disks():
     two labelled sample volumes (C: 62.9%, D: 21.9%), source = "synthetic".
```

Every returned record has this shape (see §3.1).

---

## 3. Request / Response Contracts

### 3.1 `GET /api/disks`

**Request:** `GET /api/disks` — no parameters.

**Response `200`** — JSON array, one object per volume:

```json
[
  {
    "name": "C:",
    "total": 536870912,
    "free": 190 * 1024**3,
    "used": 322 * 1024**3,
    "percent_used": 62.9,
    "source": "win32"
  }
]
```

| Field | Type | Meaning |
|---|---|---|
| `name` | string | Volume label (`C:`, `D:`, or POSIX mount root) |
| `total` | int | Total capacity, bytes |
| `free` | int | Free space, bytes |
| `used` | int | Used space, bytes |
| `percent_used` | float | `used/total * 100`, rounded to 1 decimal |
| `source` | string | `"win32"` \| `"posix"` \| `"synthetic"` |

**Errors:** the endpoint never returns an error JSON body; unreachable volumes are simply omitted. A `500` is only possible from an unexpected sampler exception.

### 3.2 `GET /`

**Request:** `GET /`
**Response `200`:** `FileResponse` serving `app/static/index.html` (HTML).

### 3.3 `GET /static/{path}`

**Request:** `GET /static/style.css`, `GET /static/app.js`, etc.
**Response `200`:** the static file itself (via `StaticFiles` mount).

### 3.4 Browser → Server

`app.js` polls every `POLL_MS = 2000` ms with plain `fetch("/api/disks")`.
On success it re-renders the card grid, updates the "updated" timestamp,
and shows a data note when `source === "synthetic"`. On failure (network
error or non-200) the LIVE badge switches to the red **offline** state
with the error message.

---

## 4. Working: End-to-End Flow (DiskPeek)

1. Server starts: `python -m uvicorn app.main:app --port 8321`
   (or `python app/main.py` which runs uvicorn on 127.0.0.1:8321).
2. Opening `http://localhost:8321` serves `index.html`.
3. `app.js` immediately calls `poll()`, then `setInterval(poll, 2000)`.
4. Each poll fetches `/api/disks`; the server runs the platform sampler
   and returns the current live numbers — no page reload, no server-side
   caching, so every request reflects the OS state at request time.
5. `card(d)` builds one `<article class="disk-card">` per volume:
   - header: volume name + percentage
   - pressure level: `percent_used >= 90` → `high` (red),
     `>= 75` → `mid` (amber), else `low` (green); set on `data-level`
   - utilization bar whose fill width animates to `percent_used`%
   - `dl` with used / free / total (bytes formatted via `fmt()`)
6. The grid uses `repeat(auto-fit, minmax(260px, 1fr))` so cards reflow
   from phone (390 px) to desktop.

---

## 5. DiskSneak — Architecture

### 5.1 Process Model

```
MAIN PROCESS (main.js)                  RENDERER (index.html + renderer.js)
─────────────────────────────            ─────────────────────────────────
app.whenReady
  registerIpc()                          window.diskSneak (from preload.js)
  createWindow()                         onScanProgress / onScanResult /
                                         onScanError subscriptions
IPC invoke (renderer → main):
  pick-folder, scan-folder,
  cancel-scan, trash-items,
  get-app-info
IPC events (main → renderer):
  scan-progress, scan-result, scan-error
```

Security posture: `contextIsolation: true`, `nodeIntegration: false`,
`sandbox: false`; the renderer talks to the OS only through the
`window.diskSneak` API bridged by `preload.js`.

### 5.2 Request / Response Contracts (IPC)

**Invoke handlers** (`ipcMain.handle` in `main.js`):

| Channel | Request | Response |
|---|---|---|
| `pick-folder` | none | folder path string, or `null` if cancelled |
| `scan-folder` | `folderPath` (string) | kicks off a scan; results arrive via events |
| `cancel-scan` | none | sets the controller's `cancelled` flag |
| `trash-items` | `paths[]` | `{ ok: true, moved }` or `{ ok: false, failed[] }` |
| `get-app-info` | none | `{ name, version }` |

**Event payloads:**

```jsonc
// scan-progress
{ "scanned": 1234, "totalSize": 987654321, "percent": 42 }

// scan-result
{
  "root": "C:\\",
  "items": [
    { "name": "Windows", "type": "folder", "size": 1234567890, "path": "C:\\Windows" },
    { "name": "bigfile.iso", "type": "file", "size": 987654321, "path": "C:\\bigfile.iso" }
  ],
  "totalSize": 5000000000,
  "fileCount": 42,
  "folderCount": 10
}

// scan-error
"Cannot open folder: <message>"   // or "Scan cancelled."
```

### 5.3 Working: User Flow

1. Click **Scan** → renderer calls `window.diskSneak.pickFolder()`
   (native folder dialog).
2. On selection, `scanFolder(path)` creates a fresh scanner controller;
   any in-flight scan is cancelled first.
3. `scanner.js` walks the tree:
   - async recursive `readdir` with `withFileTypes`
   - `MAX_DEPTH = 8`, `PROGRESS_EVERY = 50`
   - `EACCES`/`EPERM` folders are skipped, not fatal
   - progress uses a 3× heuristic so the bar climbs smoothly
   - on completion, items are sorted by size (largest first)
4. `scan-result` arrives → renderer hides the scan panel, renders the
   results table (checkbox, name, type badge, size, full path), updates
   the summary line (`N files · M folders · X GB total`).
5. User checks rows; **Trash** sends `trash-items` with the selected
   paths → main uses `shell.trashItem` (Recycle Bin, safe delete),
   reports `ok`/`failed[]`, and the renderer unchecks the rows and
   re-enables the scan button.

### 5.4 Scanner Design Notes

- Items are plain objects; formatting (B/KB/MB/GB/TB) happens in the
  renderer's `fmtBytes`.
- Cancellation is cooperative: a single `cancelled` flag is checked at
  every loop iteration, so a scan can be stopped mid-walk.

---

## 6. Key Invariants & Edge Cases

| Concern | Behaviour |
|---|---|
| No reachable volumes | Sampler returns clearly-labelled **synthetic** data (`source: "synthetic"`); UI shows a note |
| Unreachable drives | Skipped silently (OSError / PermissionError) |
| Polling failure | LIVE badge goes offline/red; last timestamp replaced with error message |
| Permissioned folders during scan | Skipped (EACCES/EPERM); scan continues |
| Reduced motion | `prefers-reduced-motion` disables bar transitions and the LIVE-dot pulse |
| Windows-only drive letters | `A:–Z:` loop; drives that don't exist simply raise and are skipped |
| POSIX mount parsing | `/proc/mounts` lines with mount point ≠ `/`; roots deduped |

---

## 7. Running the Applications

```bash
# DiskPeek (web app)
pip install -r requirements.txt
python -m uvicorn app.main:app --port 8321
# → open http://localhost:8321

# DiskSneak (Electron)
cd disksneak
npm install
npx electron .
```

## 8. Reference

`diskbuddy-reverse-engineering.md` is a research document about the
third-party product DiskBuddy (scan pipeline, cleanup safety model,
duplicates, monitor/compress features). It is reference material only —
no code, not part of either application's runtime.
