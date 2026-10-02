// Arc Palette — the palette UI. Shared by the in-page overlay (content.js)
// and the new-tab page (newtab.js). Renders into any root (a shadow root or
// a plain element) and talks to background.js for data and actions.

(() => {
  if (globalThis.ArcPalette) return;

  const api = globalThis.browser ?? globalThis.chrome;

  const CSS = `
    /* Liquid Glass: a translucent, light-refracting material with a specular rim. */
    :host, .ap-root {
      --ap-text: rgba(0, 0, 0, 0.88);
      --ap-muted: rgba(0, 0, 0, 0.55);
      --ap-faint: rgba(0, 0, 0, 0.38);
      --ap-glass: rgba(255, 255, 255, 0.38);
      --ap-glass-filter: blur(30px) saturate(190%) brightness(1.06);
      --ap-rim-strong: rgba(255, 255, 255, 0.95);
      --ap-rim-weak: rgba(255, 255, 255, 0.12);
      --ap-sheen: rgba(255, 255, 255, 0.55);
      --ap-hairline: rgba(0, 0, 0, 0.07);
      --ap-hover: rgba(255, 255, 255, 0.28);
      --ap-selected: rgba(255, 255, 255, 0.62);
      --ap-selected-rim: rgba(255, 255, 255, 0.9);
      --ap-selected-shadow: 0 1px 2px rgba(0, 0, 0, 0.06), 0 4px 14px rgba(0, 0, 0, 0.06);
      --ap-icon-tile: rgba(255, 255, 255, 0.55);
      --ap-key: rgba(255, 255, 255, 0.5);
      --ap-scrim: rgba(255, 255, 255, 0.06);
      --ap-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.1), 0 30px 80px rgba(0, 0, 0, 0.18), 0 8px 24px rgba(0, 0, 0, 0.08);
      --ap-mark: rgba(10, 132, 255, 0.22);
    }
    @media (prefers-color-scheme: dark) {
      :host, .ap-root {
        --ap-text: rgba(255, 255, 255, 0.94);
        --ap-muted: rgba(255, 255, 255, 0.58);
        --ap-faint: rgba(255, 255, 255, 0.4);
        --ap-glass: rgba(28, 28, 32, 0.42);
        --ap-glass-filter: blur(30px) saturate(170%) brightness(0.9);
        --ap-rim-strong: rgba(255, 255, 255, 0.42);
        --ap-rim-weak: rgba(255, 255, 255, 0.04);
        --ap-sheen: rgba(255, 255, 255, 0.1);
        --ap-hairline: rgba(255, 255, 255, 0.08);
        --ap-hover: rgba(255, 255, 255, 0.06);
        --ap-selected: rgba(255, 255, 255, 0.14);
        --ap-selected-rim: rgba(255, 255, 255, 0.22);
        --ap-selected-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
        --ap-icon-tile: rgba(255, 255, 255, 0.1);
        --ap-key: rgba(255, 255, 255, 0.1);
        --ap-scrim: rgba(0, 0, 0, 0.18);
        --ap-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.6), 0 30px 80px rgba(0, 0, 0, 0.45), 0 8px 24px rgba(0, 0, 0, 0.25);
        --ap-mark: rgba(10, 132, 255, 0.4);
      }
    }

    .ap-root {
      all: initial;
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      display: flex;
      justify-content: center;
      align-items: flex-start;
      padding: 13vh 16px 16px;
      box-sizing: border-box;
      font: 14px/1.3 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif;
      color: var(--ap-text);
      -webkit-font-smoothing: antialiased;
    }
    .ap-root *, .ap-root *::before, .ap-root *::after { box-sizing: border-box; }

    /* Light scrim: the page should stay visible so the glass has something to bend. */
    .ap-scrim {
      position: absolute;
      inset: 0;
      background: var(--ap-scrim);
      -webkit-backdrop-filter: blur(2px);
      backdrop-filter: blur(2px);
      animation: ap-fade 160ms ease-out;
    }
    .ap-page .ap-scrim { background: transparent; backdrop-filter: none; -webkit-backdrop-filter: none; }

    .ap-card {
      position: relative;
      width: min(660px, 100%);
      max-height: 74vh;
      display: flex;
      flex-direction: column;
      padding: 6px;
      border-radius: 28px;
      background: var(--ap-glass);
      -webkit-backdrop-filter: var(--ap-glass-filter);
      backdrop-filter: var(--ap-glass-filter);
      box-shadow: var(--ap-shadow);
      isolation: isolate;
      animation: ap-pop 260ms cubic-bezier(.2, 1.25, .35, 1);
      transform-origin: 50% 0;
    }
    /* Specular rim: bright where light hits (top-left, bottom-right), fading elsewhere. */
    .ap-card::before {
      content: "";
      position: absolute;
      inset: 0;
      border-radius: inherit;
      padding: 1px;
      background: linear-gradient(140deg,
        var(--ap-rim-strong) 0%, var(--ap-rim-weak) 28%,
        var(--ap-rim-weak) 70%, var(--ap-rim-strong) 100%);
      -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
      -webkit-mask-composite: xor;
      mask-composite: exclude;
      pointer-events: none;
      z-index: 3;
    }
    /* Soft sheen across the top, like light pooling in the glass. */
    .ap-card::after {
      content: "";
      position: absolute;
      inset: 0;
      border-radius: inherit;
      background:
        radial-gradient(120% 60% at 20% -10%, var(--ap-sheen), transparent 60%),
        linear-gradient(180deg, var(--ap-sheen) 0, transparent 2px);
      opacity: 0.7;
      pointer-events: none;
      z-index: -1;
    }

    .ap-input {
      all: unset;
      display: block;
      width: 100%;
      padding: 13px 16px 12px;
      font: 400 18px/1.3 -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif;
      letter-spacing: -0.01em;
      color: var(--ap-text);
      caret-color: #0a84ff;
    }
    .ap-input::placeholder { color: var(--ap-faint); }
    .ap-input::selection { background: var(--ap-mark); }

    .ap-list {
      overflow-y: auto;
      overscroll-behavior: contain;
      flex: 1 1 auto;
      margin-top: 2px;
      padding-top: 4px;
      border-top: 1px solid var(--ap-hairline);
      scrollbar-width: thin;
    }
    .ap-list:empty { display: none; }

    .ap-section {
      padding: 10px 14px 4px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.02em;
      color: var(--ap-muted);
    }

    .ap-item {
      position: relative;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 7px 14px 7px 16px;
      min-height: 50px;
      border-radius: 16px;
      cursor: default;
      transition: background-color 120ms ease, box-shadow 120ms ease;
    }
    .ap-item.ap-compact { min-height: 38px; padding-top: 5px; padding-bottom: 5px; }
    .ap-item:hover { background: var(--ap-hover); }
    .ap-item.ap-sel {
      background: var(--ap-selected);
      box-shadow: inset 0 0 0 0.5px var(--ap-selected-rim), inset 0 1px 0 var(--ap-selected-rim), var(--ap-selected-shadow);
    }
    /* Open tabs: a small coloured capsule instead of a hard edge stripe. */
    .ap-item.ap-tab::before {
      content: "";
      position: absolute;
      left: 5px;
      top: 50%;
      width: 4px;
      height: 20px;
      margin-top: -10px;
      border-radius: 2px;
      background: var(--ap-accent, #8e8e93);
      opacity: 0.85;
    }

    .ap-icon {
      flex: 0 0 28px;
      width: 28px;
      height: 28px;
      display: grid;
      place-items: center;
      border-radius: 9px;
      overflow: hidden;
      background: var(--ap-icon-tile);
      box-shadow: inset 0 0 0 0.5px var(--ap-hairline);
      font-size: 12px;
      font-weight: 700;
      color: #fff;
    }
    .ap-icon img { width: 16px; height: 16px; display: block; }
    .ap-icon svg { width: 14px; height: 14px; color: var(--ap-muted); }

    .ap-text { min-width: 0; flex: 1; }
    .ap-title, .ap-url {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .ap-title { font-size: 13.5px; font-weight: 500; }
    .ap-url { font-size: 12px; color: var(--ap-muted); margin-top: 2px; }

    .ap-footer {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 4px;
      padding: 9px 12px 6px;
      font-size: 12px;
      color: var(--ap-muted);
      border-top: 1px solid var(--ap-hairline);
    }
    .ap-footer span { min-width: 0; overflow-wrap: anywhere; }
    .ap-footer kbd {
      flex: none;
      font: 600 11px/1 -apple-system, sans-serif;
      padding: 4px 7px;
      border-radius: 999px;
      background: var(--ap-key);
      box-shadow: inset 0 0 0 0.5px var(--ap-selected-rim), inset 0 1px 0 var(--ap-selected-rim);
    }

    @keyframes ap-fade { from { opacity: 0; } }
    @keyframes ap-pop { from { opacity: 0; transform: translateY(-8px) scale(0.96); } }
    @media (prefers-reduced-motion: reduce) {
      .ap-scrim, .ap-card { animation: none; }
      .ap-item { transition: none; }
    }
    /* If the system asks for less transparency, fall back to a solid surface. */
    @media (prefers-reduced-transparency: reduce) {
      .ap-card { background: Canvas; -webkit-backdrop-filter: none; backdrop-filter: none; }
    }
  `;

  const SEARCH_ICON =
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="7" cy="7" r="4.6"/><path d="M10.4 10.4 14 14"/></svg>';
  const GLOBE_ICON =
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="6.2"/><path d="M1.8 8h12.4M8 1.8c1.8 1.9 2.6 4 2.6 6.2S9.8 12.3 8 14.2C6.2 12.3 5.4 10.2 5.4 8S6.2 3.7 8 1.8Z"/></svg>';

  // ---------- helpers ----------

  const stripUrl = (url) =>
    (url || "").replace(/^[a-z]+:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");

  const hostOf = (url) => {
    try {
      return new URL(url).hostname.replace(/^www\./i, "");
    } catch {
      return "";
    }
  };

  function looksLikeUrl(text) {
    const t = text.trim();
    if (!t || /\s/.test(t)) return false;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t) || /^(about|data|file|mailto):/i.test(t)) return true;
    if (/^localhost(:\d+)?(\/.*)?$/i.test(t)) return true;
    if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/.test(t)) return true;
    return /^[^\s/?#]+\.[a-z]{2,63}(:\d+)?([/?#].*)?$/i.test(t);
  }

  function toUrl(text) {
    const t = text.trim();
    if (/^[a-z][a-z0-9+.-]*:/i.test(t) && !/^localhost:/i.test(t)) return t;
    return (/^(localhost|\d{1,3}(\.\d{1,3}){3})/i.test(t) ? "http://" : "https://") + t;
  }

  // Stable per-domain accent colour for the tab stripe and letter avatars.
  function accentFor(url) {
    const h = hostOf(url) || url || "";
    let n = 0;
    for (const c of h) n = (n * 31 + c.charCodeAt(0)) >>> 0;
    return `hsl(${n % 360} 65% 52%)`;
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function send(msg) {
    return api.runtime.sendMessage(msg).catch(() => null);
  }

  function faviconFor(item) {
    if (item.favicon && /^(https?|data):/i.test(item.favicon)) return item.favicon;
    const host = hostOf(item.url);
    return host ? `https://icons.duckduckgo.com/ip3/${host}.ico` : null;
  }

  function iconNode(item) {
    const box = el("span", "ap-icon");
    if (item.kind === "suggest" || item.kind === "search") {
      box.innerHTML = SEARCH_ICON;
      return box;
    }
    if (item.kind === "url") {
      box.innerHTML = GLOBE_ICON;
      return box;
    }
    const letter = () => {
      box.textContent = (hostOf(item.url)[0] || "•").toUpperCase();
      box.style.background = accentFor(item.url);
    };
    const src = faviconFor(item);
    if (!src) {
      letter();
      return box;
    }
    const img = document.createElement("img");
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    img.onerror = () => {
      img.remove();
      letter();
    };
    img.src = src;
    box.append(img);
    return box;
  }

  // ---------- the palette ----------

  /**
   * Mounts a palette into `root`.
   * opts.mode:   "overlay" (on top of a web page) or "page" (the new-tab page)
   * opts.onClose: called when the palette should be dismissed
   */
  function mount(root, opts = {}) {
    const mode = opts.mode ?? "overlay";

    const style = el("style");
    style.textContent = CSS;

    const wrap = el("div", `ap-root ap-${mode}`);
    const scrim = el("div", "ap-scrim");
    const card = el("div", "ap-card");
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", "Command palette");

    const input = el("input", "ap-input");
    input.type = "text";
    input.placeholder = "Type to search tabs or enter URL…";
    input.spellcheck = false;
    input.autocomplete = "off";
    input.setAttribute("autocorrect", "off");
    input.setAttribute("autocapitalize", "off");
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-expanded", "true");

    const list = el("div", "ap-list");
    list.setAttribute("role", "listbox");
    const footer = el("div", "ap-footer");

    card.append(input, list, footer);
    wrap.append(scrim, card);
    root.append(style, wrap);

    let typed = ""; // what the user actually typed (without inline completion)
    let local = { tabs: [], history: [] };
    let suggestions = [];
    let items = [];
    let sel = -1; // -1 = act on the text in the box
    let seq = 0;
    let suggestTimer = null;
    let closed = false;

    function close() {
      if (closed) return;
      closed = true;
      clearTimeout(suggestTimer);
      opts.onClose?.();
    }

    // ----- data -----

    async function refresh(allowComplete) {
      const mySeq = ++seq;
      const q = typed;

      const res = await send({ type: "searchLocal", query: q });
      if (mySeq !== seq || closed) return;
      local = res && !res.error ? res : { tabs: [], history: [] };
      if (!q.trim()) suggestions = [];
      render(allowComplete);

      clearTimeout(suggestTimer);
      if (q.trim() && !looksLikeUrl(q)) {
        suggestTimer = setTimeout(async () => {
          const s = await send({ type: "suggest", query: q });
          if (mySeq !== seq || closed) return;
          suggestions = Array.isArray(s) ? s : [];
          render(false);
        }, 90);
      } else {
        suggestions = [];
      }
    }

    // ----- inline completion (Arc / Safari address-bar style) -----

    function findCompletion() {
      const t = typed.trim().toLowerCase();
      if (!t || /\s/.test(t) || t.length < 2) return null;
      const candidates = [...local.tabs, ...local.history];

      // Prefer completing just the domain while no path has been typed.
      if (!t.includes("/")) {
        for (const c of candidates) {
          const host = hostOf(c.url);
          if (host.startsWith(t)) {
            const root = candidates.find((x) => stripUrl(x.url).toLowerCase() === host);
            return { text: host, item: root ?? null };
          }
        }
      }
      for (const c of candidates) {
        const u = stripUrl(c.url);
        if (u.toLowerCase().startsWith(t)) return { text: u, item: c };
      }
      return null;
    }

    // ----- rendering -----

    function buildItems() {
      const out = [];
      const q = typed.trim();
      if (local.tabs.length) {
        out.push({ section: "Open Tabs" });
        local.tabs.forEach((t) => out.push({ ...t }));
      }
      if (local.history.length) {
        out.push({ section: "History" });
        local.history.forEach((h) => out.push({ ...h }));
      }
      const sugg = suggestions.filter((s) => s.toLowerCase() !== q.toLowerCase());
      if (q && !looksLikeUrl(q) && sugg.length) {
        out.push({ section: "Search Suggestions" });
        sugg.forEach((s) => out.push({ kind: "suggest", title: s }));
      }
      return out;
    }

    function render(allowComplete) {
      const prevKey = sel >= 0 ? keyOf(items[sel]) : null;
      items = buildItems();

      if (allowComplete) {
        const comp = findCompletion();
        if (comp && comp.text.toLowerCase() !== typed.toLowerCase()) {
          input.value = typed + comp.text.slice(typed.trim().length);
          input.setSelectionRange(typed.length, input.value.length);
        } else {
          input.value = typed;
        }
        sel = comp?.item ? items.findIndex((i) => i.url === comp.item.url) : -1;
      } else if (prevKey) {
        sel = items.findIndex((i) => keyOf(i) === prevKey);
      }

      // Empty box: highlight the most recent tab, like the video.
      if (!typed.trim() && sel < 0) sel = items.findIndex((i) => !i.section);

      list.textContent = "";
      items.forEach((item, idx) => {
        if (item.section) {
          list.append(el("div", "ap-section", item.section));
          return;
        }
        const row = el("div", `ap-item ap-${item.kind}${item.kind === "suggest" ? " ap-compact" : ""}`);
        row.setAttribute("role", "option");
        row.dataset.idx = idx;
        if (item.kind === "tab") row.style.setProperty("--ap-accent", accentFor(item.url));
        const text = el("div", "ap-text");
        text.append(el("div", "ap-title", item.title));
        if (item.url) text.append(el("div", "ap-url", stripUrl(item.url)));
        row.append(iconNode(item), text);
        row.addEventListener("mousemove", () => {
          if (sel !== idx) select(idx, false);
        });
        row.addEventListener("mousedown", (e) => e.preventDefault()); // keep focus in the input
        row.addEventListener("click", (e) => activate(idx, e));
        list.append(row);
      });
      paintSelection(true);
    }

    function keyOf(item) {
      if (!item || item.section) return null;
      return `${item.kind}|${item.tabId ?? ""}|${item.url ?? item.title}`;
    }

    function paintSelection(scroll) {
      for (const row of list.querySelectorAll(".ap-item")) {
        const on = Number(row.dataset.idx) === sel;
        row.classList.toggle("ap-sel", on);
        row.setAttribute("aria-selected", on ? "true" : "false");
        if (on && scroll) row.scrollIntoView({ block: "nearest" });
      }
      renderFooter();
    }

    function renderFooter() {
      const item = sel >= 0 ? items[sel] : null;
      let label;
      if (item?.kind === "tab") label = `Switch to tab: ${item.title}`;
      else if (item?.kind === "history") label = `Open: ${item.url}`;
      else if (item?.kind === "suggest") label = `Search for: ${item.title}`;
      else {
        const text = input.value.trim();
        if (!text) label = "Press Enter to switch to selected tab, or start typing to search";
        else if (looksLikeUrl(text)) label = `Open: ${toUrl(text)}`;
        else label = `Search for: ${text}`;
      }
      footer.textContent = "";
      footer.append(el("kbd", null, "↩"), el("span", null, label));
    }

    function select(idx, scroll = true) {
      sel = idx;
      paintSelection(scroll);
    }

    function move(delta) {
      const selectable = items.map((it, i) => (it.section ? -1 : i)).filter((i) => i >= 0);
      if (!selectable.length) return;
      const pos = selectable.indexOf(sel);
      let next;
      if (pos === -1) next = delta > 0 ? selectable[0] : selectable[selectable.length - 1];
      else next = selectable[Math.min(Math.max(pos + delta, 0), selectable.length - 1)];
      // Moving off an inline completion drops the completion text.
      if (input.value !== typed && input.selectionStart !== input.selectionEnd) input.value = typed;
      select(next);
    }

    // ----- actions -----

    // In overlay mode: open things in a new tab (Arc-style); Shift opens in place.
    // In page mode (the new-tab page): always replace this tab.
    function whereFor(e) {
      if (mode === "page") return "current";
      return e?.shiftKey ? "current" : "new";
    }

    async function activate(idx, e) {
      const item = idx >= 0 ? items[idx] : null;
      const where = whereFor(e);
      let msg;
      if (item?.kind === "tab") {
        msg = { type: "switchTab", tabId: item.tabId, windowId: item.windowId, closeSender: mode === "page" };
      } else if (item?.kind === "history") {
        msg = { type: "open", url: item.url, where };
      } else if (item?.kind === "suggest") {
        msg = { type: "search", text: item.title, where };
      } else {
        const text = input.value.trim();
        if (!text) return;
        msg = looksLikeUrl(text) ? { type: "open", url: toUrl(text), where } : { type: "search", text, where };
      }
      // The overlay disappears; the new-tab page stays put until it navigates
      // (onClose there means "cancel", which would close the tab).
      if (mode === "overlay") close();
      else closed = true;
      await send(msg);
    }

    // ----- events -----

    input.addEventListener("input", (e) => {
      typed = input.value;
      const deleting = (e.inputType || "").startsWith("delete");
      refresh(!deleting);
    });

    input.addEventListener("keydown", (e) => {
      if (e.isComposing) return;
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          move(1);
          break;
        case "ArrowUp":
          e.preventDefault();
          move(-1);
          break;
        case "Tab":
          e.preventDefault();
          move(e.shiftKey ? -1 : 1);
          break;
        case "ArrowRight":
          // Accept the inline completion.
          if (input.selectionStart !== input.selectionEnd && input.selectionEnd === input.value.length) {
            e.preventDefault();
            typed = input.value;
            input.setSelectionRange(typed.length, typed.length);
            refresh(false);
          }
          break;
        case "Enter":
          e.preventDefault();
          activate(sel, e);
          break;
        case "Escape":
          e.preventDefault();
          if (input.value && mode === "page") {
            typed = "";
            input.value = "";
            sel = -1;
            refresh(false);
          } else close();
          break;
      }
      e.stopPropagation();
    });

    // Keep keystrokes from reaching the page's own shortcuts (YouTube, Gmail, …).
    for (const type of ["keydown", "keyup", "keypress"]) {
      wrap.addEventListener(type, (e) => e.stopPropagation());
    }

    scrim.addEventListener("mousedown", (e) => {
      e.preventDefault();
      if (mode === "overlay") close();
      else input.focus();
    });

    refresh(false);
    input.focus();
    requestAnimationFrame(() => input.focus());

    return {
      focus: () => input.focus(),
      destroy: () => {
        closed = true;
        clearTimeout(suggestTimer);
        style.remove();
        wrap.remove();
      },
    };
  }

  globalThis.ArcPalette = { mount };
})();
