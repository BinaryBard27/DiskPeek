// DiskSneak website — small helpers (vanilla JS, no dependencies)

// Keep the footer year current.
const yearEl = document.getElementById("year");
if (yearEl) yearEl.textContent = new Date().getFullYear();

// Close mobile nav / highlight active section (optional, lightweight)
const nav = document.getElementById("nav");
if (nav) {
  let lastY = 0;
  window.addEventListener("scroll", () => {
    const y = window.scrollY;
    nav.classList.toggle("nav-scrolled", y > 40);
    lastY = y;
  }, { passive: true });
}

// Light / Dark Theme toggle
const themeBtn = document.getElementById("theme-toggle");
const themeSun = document.getElementById("theme-sun");
const themeMoon = document.getElementById("theme-moon");

function applyWebsiteTheme(theme) {
  const isLight = theme === "light";
  document.documentElement.setAttribute("data-theme", isLight ? "light" : "dark");
  if (themeSun && themeMoon) {
    themeSun.classList.toggle("hidden", !isLight);
    themeMoon.classList.toggle("hidden", isLight);
  }
}

function initWebsiteTheme() {
  const saved = localStorage.getItem("disksneak-website-theme");
  const preferred = saved || (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  applyWebsiteTheme(preferred);
}

if (themeBtn) {
  themeBtn.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
    const next = current === "light" ? "dark" : "light";
    localStorage.setItem("disksneak-website-theme", next);
    applyWebsiteTheme(next);
  });
}

initWebsiteTheme();

// Smooth scroll is handled by CSS; nothing else needed.
