# DiskPeek

A Windows real-time storage visualization.

DiskPeek samples every volume on the machine and streams live usage
numbers to a browser UI. On Windows it uses the Win32 APIs
(`GetDriveTypeW` / `GetDiskFreeSpaceExW`) so the numbers always reflect
the current state of each fixed drive; on other platforms it falls back
to POSIX mount points, and when nothing real is reachable it shows
clearly labelled sample data so the UI never renders empty.

## Features

- Live polling: the UI refreshes every 2 seconds, no page reload
- Windows-native sampling through Win32 disk APIs
- Cross-platform sampler (POSIX fallback, synthetic data as a last resort)
- Per-volume cards: used / free / total, utilization bar, color-coded
  by pressure (ok / warn / critical)

## Run

```bash
pip install -r requirements.txt
python -m uvicorn app.main:app --port 8321
```

Then open http://localhost:8321.

## Layout

```
app/main.py           FastAPI app: /api/disks endpoint + static UI
app/disk_service.py   Volume sampler (Win32 / POSIX / synthetic)
app/static/           Live UI (HTML / CSS / JS)
```
