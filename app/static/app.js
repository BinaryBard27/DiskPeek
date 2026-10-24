const $disks = document.getElementById("disks");
const $updated = document.getElementById("updated");
const $note = document.getElementById("data-note");
const $live = document.getElementById("live-badge");

const POLL_MS = 2000;

function fmt(bytes) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  const digits = v >= 10 || i === 0 ? 0 : 1;
  return v.toFixed(digits) + " " + units[i];
}

function card(d) {
  const level = d.percent_used >= 90 ? "high" : d.percent_used >= 75 ? "mid" : "low";
  const el = document.createElement("article");
  el.className = "disk-card";
  el.dataset.level = level;

  const header = document.createElement("header");
  const h2 = document.createElement("h2");
  h2.textContent = d.name;
  const pct = document.createElement("span");
  pct.className = "pct " + level;
  pct.textContent = d.percent_used + "%";
  header.append(h2, pct);

  const bar = document.createElement("div");
  bar.className = "bar";
  const fill = document.createElement("div");
  fill.className = "bar-fill";
  bar.append(fill);

  const dl = document.createElement("dl");
  for (const key of ["used", "free", "total"]) {
    const wrap = document.createElement("div");
    const dt = document.createElement("dt");
    dt.textContent = key;
    const dd = document.createElement("dd");
    dd.textContent = fmt(d[key]);
    wrap.append(dt, dd);
    dl.append(wrap);
  }

  el.append(header, bar, dl);
  requestAnimationFrame(() => {
    fill.style.width = d.percent_used + "%";
  });
  return el;
}

async function poll() {
  try {
    const res = await fetch("/api/disks");
    if (!res.ok) throw new Error("HTTP " + res.status);
    const disks = await res.json();
    $disks.replaceChildren(...disks.map(card));
    $updated.textContent = new Date().toLocaleTimeString();
    const src = disks.length ? disks[0].source : "";
    $note.textContent =
      src === "synthetic"
        ? "Showing sample data: no real volumes were reachable on this machine."
        : "";
    $live.classList.remove("offline");
  } catch (err) {
    $live.classList.add("offline");
    $updated.textContent = "offline — " + err.message;
  }
}

poll();
setInterval(poll, POLL_MS);
