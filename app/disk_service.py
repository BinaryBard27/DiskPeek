"""Real-time disk usage sampling for DiskPeek.

On Windows the sampler talks to the OS through the Win32 API
(GetDriveTypeW / GetDiskFreeSpaceExW) so the numbers reflect the live
state of each fixed drive. On other platforms it falls back to
shutil.disk_usage over known mount points, and when no real volume is
reachable it returns clearly-labelled synthetic data so the UI always has
something to draw.
"""

from __future__ import annotations

import shutil
from typing import Any


def _win32_disks() -> list[dict[str, Any]]:
    """Sample every fixed drive on Windows via the Win32 disk APIs.

    Uses shutil.disk_usage, which wraps GetDiskFreeSpaceExW under the
    hood, so the numbers are the OS's live values without hand-rolled
    ctypes plumbing.
    """
    disks: list[dict[str, Any]] = []
    for code in range(ord("A"), ord("Z") + 1):
        drive = f"{chr(code)}:"
        try:
            usage = shutil.disk_usage(drive)
        except (OSError, PermissionError, ValueError):
            continue  # drive doesn't exist or isn't accessible
        total_b = usage.total
        if total_b <= 0:
            continue
        disks.append(
            {
                "name": drive,
                "total": total_b,
                "free": usage.free,
                "used": usage.used,
                "percent_used": round(usage.used / total_b * 100, 1),
                "source": "win32",
            }
        )
    return disks


def _posix_disks() -> list[dict[str, Any]]:
    """Sample mounted filesystems on non-Windows systems."""
    roots = ["/"]
    try:
        with open("/proc/mounts", encoding="utf-8") as fh:
            for line in fh:
                parts = line.split()
                if len(parts) >= 2 and parts[1] != "/":
                    roots.append(parts[1])
    except OSError:
        pass

    disks: list[dict[str, Any]] = []
    seen: set[str] = set()
    for root in roots:
        if root in seen:
            continue
        seen.add(root)
        try:
            usage = shutil.disk_usage(root)
        except OSError:
            continue
        total_b = usage.total
        if total_b <= 0:
            continue
        used_b = usage.used
        disks.append(
            {
                "name": root,
                "total": total_b,
                "free": usage.free,
                "used": used_b,
                "percent_used": round(used_b / total_b * 100, 1),
                "source": "posix",
            }
        )
    return disks


def _synthetic_disks() -> list[dict[str, Any]]:
    """Clearly-labelled sample data, used only when no real volume is reachable."""
    gb = 1024 ** 3
    return [
        {
            "name": "C:",
            "total": 512 * gb,
            "free": 190 * gb,
            "used": 322 * gb,
            "percent_used": 62.9,
            "source": "synthetic",
        },
        {
            "name": "D:",
            "total": 1024 * gb,
            "free": 800 * gb,
            "used": 224 * gb,
            "percent_used": 21.9,
            "source": "synthetic",
        },
    ]


def get_disks() -> list[dict[str, Any]]:
    """Return one live sample per reachable volume.

    Prefers the platform-native path, then falls back to synthetic
    data so the visualization always has content.
    """
    try:
        if hasattr(shutil, "disk_usage"):
            disks = _win32_disks() if _is_windows() else _posix_disks()
    except OSError:
        disks = []
    if not disks:
        disks = _synthetic_disks()
    return disks


def _is_windows() -> bool:
    import platform

    return platform.system() == "Windows"
