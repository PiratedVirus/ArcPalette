// Arc Palette — shows the palette as an overlay on top of the current page,
// plus page-level helpers: toasts and ⌘⇧C "copy link".

(() => {
  if (window.top !== window || window.__arcPaletteLoaded) return;
  window.__arcPaletteLoaded = true;

  const api = globalThis.browser ?? globalThis.chrome;
  let host = null;
  let palette = null;
  let restoreFocus = null;
  let lastToggle = 0;
  let lastCopy = 0;

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

  // Shortcuts may arrive both as a browser command and as a page keydown;
  // ignore the second one so the palette doesn't open and immediately close.
  function toggle() {
    const now = Date.now();
    if (now - lastToggle < 400) return;
    lastToggle = now;
    host ? close() : open();
  }

  function copyLink() {
    const now = Date.now();
    if (now - lastCopy < 400) return;
    const ok = globalThis.ArcPalette.copyText(location.href);
    if (ok) lastCopy = now; // a failed attempt lets the other trigger try again
    globalThis.ArcPalette.toast(ok ? "Link copied" : "Couldn't copy the link", ok ? "link" : null);
  }

  api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "toggle") {
      toggle();
      sendResponse({ ok: true });
    } else if (msg?.type === "copyUrl") {
      copyLink();
      sendResponse({ ok: true });
    } else if (msg?.type === "toast") {
      globalThis.ArcPalette.toast(msg.text, null);
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
      } else if (e.code === "KeyC" && e.metaKey && e.shiftKey && !e.altKey && !e.ctrlKey) {
        e.preventDefault();
        e.stopImmediatePropagation();
        copyLink();
      }
    },
    true
  );
})();
