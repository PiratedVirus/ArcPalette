// Arc Palette — shows the palette as an overlay on top of the current page.

(() => {
  if (window.top !== window || window.__arcPaletteLoaded) return;
  window.__arcPaletteLoaded = true;

  const api = globalThis.browser ?? globalThis.chrome;
  let host = null;
  let palette = null;
  let restoreFocus = null;
  let lastToggle = 0;

  function open() {
    if (host) return palette.focus();
    restoreFocus = document.activeElement;
    host = document.createElement("arc-palette");
    host.style.cssText = "all: initial; position: fixed; inset: 0; z-index: 2147483647;";
    const shadow = host.attachShadow({ mode: "closed" });
    (document.body ?? document.documentElement).append(host);
    palette = globalThis.ArcPalette.mount(shadow, { mode: "overlay", onClose: close });
  }

  function close() {
    if (!host) return;
    palette.destroy();
    host.remove();
    host = palette = null;
    try {
      restoreFocus?.focus?.({ preventScroll: true });
    } catch {}
  }

  // Option+T may arrive both as a browser command and as a page keydown;
  // ignore the second one so the palette doesn't open and immediately close.
  function toggle() {
    const now = Date.now();
    if (now - lastToggle < 400) return;
    lastToggle = now;
    host ? close() : open();
  }

  api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "toggle") {
      toggle();
      sendResponse({ ok: true });
    }
  });

  window.addEventListener(
    "keydown",
    (e) => {
      if (e.code === "KeyT" && e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
        e.preventDefault();
        e.stopImmediatePropagation();
        toggle();
      }
    },
    true
  );
})();
