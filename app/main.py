"""DiskPeek: real-time storage visualization.

Run from the project root:

    python -m uvicorn app.main:app --port 8321

The server exposes one live sample per volume at /api/disks; the
browser UI polls it every couple of seconds, so the visualization
stays current without a page reload.
"""

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import disk_service

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"

app = FastAPI(title="DiskPeek")


@app.get("/api/disks")
def api_disks() -> list[dict[str, object]]:
    """One live sample per volume, polled by the UI."""
    return disk_service.get_disks()


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/", include_in_schema=False)
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="127.0.0.1", port=8321)
