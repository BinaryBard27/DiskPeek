/**
 * DiskSneak — asynchronous disk scanner.
 *
 * The scanner walks a folder tree, accumulating sizes and collecting every
 * file/folder with its total size. It runs in the main process, reports
 * progress callbacks, and supports cancellation mid-scan.
 *
 * Design notes (extensibility in mind):
 *  - Results are plain objects: { name, type: "file"|"folder", size, path }
 *  - Sizes are in bytes; the renderer formats them (KB/MB/GB/TB)
 *  - A depth cap keeps initial scans fast on huge trees
 */

const fs = require("fs");
const path = require("path");

// How many directory levels to descend (0 = top level only).
const MAX_DEPTH = 8;
// Report progress every N entries to avoid flooding the renderer.
const PROGRESS_EVERY = 50;

/**
 * Create a scanner controller.
 *
 * @param {Object} callbacks
 * @param {(p: {scanned:number,totalSize:number,percent:number}) => void} callbacks.onProgress
 * @param {(r: {root:string, items:Array, totalSize:number, fileCount:number, folderCount:number}) => void} callbacks.onResult
 * @param {(message:string) => void} callbacks.onError
 */
function createScanner(callbacks) {
  let cancelled = false;

  /**
   * Recursively scan `dirPath` up to `depth`.
   * @returns {Promise<number>} total size (bytes) of `dirPath`
   */
  async function scanDir(dirPath, depth) {
    if (cancelled) return 0;

    let entries;
    try {
      entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    } catch (err) {
      // Permission errors (e.g. Program Files, System32) are expected;
      // skip the folder and continue with the rest of the tree.
      if (err.code === "EACCES" || err.code === "EPERM") return 0;
      throw err;
    }

    let totalSize = 0;
    for (const entry of entries) {
      if (cancelled) return 0;

      const full = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        let dirSize = 0;
        if (depth < MAX_DEPTH) {
          dirSize = await scanDir(full, depth + 1);
        }
        // Record the folder itself (its accumulated size) in the item list.
        addItem({
          name: entry.name,
          type: "folder",
          size: dirSize,
          path: full
        });
        totalSize += dirSize;
      } else if (entry.isFile()) {
        let file;
        try {
          file = await fs.promises.stat(full);
        } catch (err) {
          if (err.code === "EACCES" || err.code === "EPERM") continue;
          if (cancelled) return 0;
          throw err;
        }
        addItem({
          name: entry.name,
          type: "file",
          size: file.size,
          path: full
        });
        totalSize += file.size;
      }
      // Periodic progress reporting.
      if (state.counter % PROGRESS_EVERY === 0) {
        reportProgress();
      }
      state.counter += 1;
    }
    return totalSize;
  }

  const state = { counter: 0 };
  const items = [];

  function addItem(item) {
    items.push(item);
  }

  function reportProgress() {
    const scanned = state.counter;
    const fileItems = items.filter((i) => i.type === "file");
    const totalSizeSoFar = fileItems.reduce((a, b) => a + b.size, 0);
    // Heuristic estimate: assume the tree holds ~3x the files seen so far,
    // so the progress bar climbs smoothly and reaches 100% near the end.
    const filesSoFar = fileItems.length;
    const estimatedTotal = Math.max(filesSoFar, 1) * 3;
    const percent = Math.min(100, (scanned / estimatedTotal) * 100);
    callbacks.onProgress?.({ scanned, totalSize: totalSizeSoFar, percent });
  }

  /**
   * Public entry point: scan `folderPath` and deliver results.
   */
  async function scan(folderPath) {
    state.counter = 0;
    items.length = 0;
    cancelled = false;

    let rootStat;
    try {
      rootStat = await fs.promises.stat(folderPath);
    } catch (err) {
      callbacks.onError?.(`Cannot open folder: ${err.message}`);
      return;
    }
    if (!rootStat.isDirectory()) {
      callbacks.onError?.("Selected path is not a folder.");
      return;
    }

    let totalSize;
    try {
      totalSize = await scanDir(folderPath, 0);
    } catch (err) {
      callbacks.onError?.(err.message || String(err));
      return;
    }
    if (cancelled) {
      callbacks.onError?.("Scan cancelled.");
      return;
    }

    // Sort by size, largest first.
    items.sort((a, b) => b.size - a.size);

    const fileCount = items.filter((i) => i.type === "file").length;
    const folderCount = items.length - fileCount;

    callbacks.onResult?.({
      root: folderPath,
      items,
      totalSize,
      fileCount,
      folderCount
    });
  }

  return {
    scan,
    set cancelled(v) {
      cancelled = v;
    },
    get cancelled() {
      return cancelled;
    }
  };
}

module.exports = { createScanner };
