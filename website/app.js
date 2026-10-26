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

// Smooth scroll is handled by CSS; nothing else needed.
