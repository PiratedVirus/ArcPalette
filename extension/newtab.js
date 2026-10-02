// Arc Palette — the new-tab page: Cmd+T opens a tab that is the palette.

const api = globalThis.browser ?? globalThis.chrome;

const palette = ArcPalette.mount(document.body, {
  mode: "page",
  // Esc on an empty palette cancels the new tab, like Arc.
  onClose: () => api.runtime.sendMessage({ type: "closeSender" }),
});

// Safari focuses the address bar for new tabs; grab focus back as soon as the page can.
window.addEventListener("focus", () => palette.focus());
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) palette.focus();
});
