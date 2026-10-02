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


  // Styles for actions, pickers, the footer hint and toasts.
  const EXTRA_CSS = `
    .ap-input-row { display: flex; align-items: center; gap: 8px; padding-left: 12px; }
    .ap-input-row .ap-input { padding-left: 4px; }
    .ap-chip {
      flex: none;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 10px;
      border-radius: 999px;
      font: 600 12px/1 -apple-system, sans-serif;
      color: var(--ap-text);
      background: var(--ap-selected);
      box-shadow: inset 0 0 0 0.5px var(--ap-selected-rim), inset 0 1px 0 var(--ap-selected-rim);
    }
    .ap-chip svg { width: 13px; height: 13px; }
    .ap-chip[hidden] { display: none; }

    .ap-hint {
      flex: none;
      margin-left: 8px;
      font: 500 11.5px/1 -apple-system, sans-serif;
      color: var(--ap-faint);
    }
    .ap-hint.ap-check { color: #0a84ff; font-size: 14px; }
    .ap-action .ap-icon svg, .ap-archived .ap-icon svg { color: var(--ap-text); opacity: 0.75; }

    .ap-empty { padding: 18px 14px; color: var(--ap-muted); font-size: 13px; text-align: center; }

    .ap-footer-hint { margin-left: auto; flex: none; color: var(--ap-faint); }
  `;

  const TOAST_CSS = `
    .ap-toast {
      all: initial;
      position: fixed;
      top: 18px;
      left: 50%;
      z-index: 2147483647;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      gap: 8px;
      max-width: min(520px, calc(100vw - 32px));
      padding: 10px 16px;
      border-radius: 999px;
      font: 500 13px/1.3 -apple-system, BlinkMacSystemFont, sans-serif;
      color: rgba(0, 0, 0, 0.85);
      background: rgba(255, 255, 255, 0.55);
      -webkit-backdrop-filter: blur(24px) saturate(190%);
      backdrop-filter: blur(24px) saturate(190%);
      box-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.9), 0 10px 30px rgba(0, 0, 0, 0.15);
      animation: ap-toast-in 240ms cubic-bezier(.2, 1.25, .35, 1);
      transition: opacity 200ms ease, transform 200ms ease;
    }
    .ap-toast.ap-out { opacity: 0; transform: translate(-50%, -6px); }
    .ap-toast svg { width: 14px; height: 14px; flex: none; }
    @media (prefers-color-scheme: dark) {
      .ap-toast {
        color: rgba(255, 255, 255, 0.92);
        background: rgba(40, 40, 44, 0.55);
        box-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.18), 0 10px 30px rgba(0, 0, 0, 0.4);
      }
    }
    @keyframes ap-toast-in { from { opacity: 0; transform: translate(-50%, -10px) scale(0.96); } }
    @media (prefers-reduced-motion: reduce) { .ap-toast { animation: none; transition: none; } }
  `;

  const svg = (body, sw = 1.5) =>
    `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

  const ICONS = {
    search: svg('<circle cx="7" cy="7" r="4.6"/><path d="M10.4 10.4 14 14"/>', 1.6),
    globe: svg('<circle cx="8" cy="8" r="6.2"/><path d="M1.8 8h12.4M8 1.8c1.8 1.9 2.6 4 2.6 6.2S9.8 12.3 8 14.2C6.2 12.3 5.4 10.2 5.4 8S6.2 3.7 8 1.8Z"/>', 1.4),
    link: svg('<path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.9.9"/><path d="M9.2 6.8a2.6 2.6 0 0 0-3.7 0L3.3 9a2.6 2.6 0 0 0 3.7 3.7l.9-.9"/>'),
    split: svg('<rect x="1.8" y="3" width="12.4" height="10" rx="2"/><path d="M8 3v10"/>'),
    close: svg('<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>'),
    duplicate: svg('<rect x="5" y="5" width="8.5" height="8.5" rx="1.8"/><path d="M11 5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5.5A1.5 1.5 0 0 0 4 11h1"/>'),
    reload: svg('<path d="M13 8a5 5 0 1 1-1.5-3.6"/><path d="M13 2.5v3h-3"/>'),
    pin: svg('<path d="M6 2.5h4l-.6 3.5 2.1 2.2H4.5L6.6 6 6 2.5Z"/><path d="M8 8.2V13.5"/>'),
    mute: svg('<path d="M2.5 6v4h2.5L8.5 13V3L5 6H2.5Z"/><path d="M11 6.2c.6.5 1 1.1 1 1.8s-.4 1.3-1 1.8"/>'),
    window: svg('<rect x="1.8" y="2.8" width="12.4" height="10.4" rx="2"/><path d="M1.8 5.8h12.4"/>'),
    newWindow: svg('<rect x="1.8" y="2.8" width="12.4" height="10.4" rx="2"/><path d="M8 6.5v4M6 8.5h4"/>'),
    archive: svg('<rect x="1.8" y="2.8" width="12.4" height="3" rx="1"/><path d="M3 5.8v6.4A1 1 0 0 0 4 13.2h8a1 1 0 0 0 1-1V5.8M6.5 8.5h3"/>'),
    clock: svg('<circle cx="8" cy="8" r="6"/><path d="M8 4.8V8l2.2 1.4"/>'),
    trash: svg('<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.3 4.5l.6 8.2a1 1 0 0 0 1 .9h4.2a1 1 0 0 0 1-.9l.6-8.2"/>'),
    check: svg('<path d="M3.5 8.5 6.5 11.5 12.5 4.5"/>', 1.8),
  };

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

  // Stable per-domain accent colour for the tab capsule and letter avatars.
  function accentFor(url) {
    const h = hostOf(url) || url || "";
    let n = 0;
    for (const c of h) n = (n * 31 + c.charCodeAt(0)) >>> 0;
    return `hsl(${n % 360} 65% 52%)`;
  }

  function timeAgo(ts) {
    const m = Math.round((Date.now() - ts) / 6e4);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.round(h / 24)}d ago`;
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
    if (item.kind === "suggest") {
      box.innerHTML = ICONS.search;
      return box;
    }
    if (item.kind === "action") {
      box.innerHTML = ICONS[item.icon] ?? ICONS.search;
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

  // Must run synchronously inside the key/click handler so Safari treats it as user-initiated.
  function copyText(text) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;";
      document.documentElement.append(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      if (ok) return true;
    } catch {}
    try {
      navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  // A small glass pill at the top of the page ("Link copied", "Tab archived").
  let toastHost = null;
  function toast(text, icon = "check") {
    toastHost?.remove();
    const host = document.createElement("arc-palette-toast");
    host.style.cssText = "all: initial; position: fixed; z-index: 2147483647;";
    const shadow = host.attachShadow({ mode: "closed" });
    const style = el("style");
    style.textContent = TOAST_CSS;
    const pill = el("div", "ap-toast");
    pill.setAttribute("role", "status");
    if (icon && ICONS[icon]) pill.insertAdjacentHTML("afterbegin", ICONS[icon]);
    pill.append(el("span", null, text));
    shadow.append(style, pill);
    (document.body ?? document.documentElement).append(host);
    toastHost = host;
    setTimeout(() => pill.classList.add("ap-out"), 1800);
    setTimeout(() => {
      host.remove();
      if (toastHost === host) toastHost = null;
    }, 2050);
  }

  // ---------- actions (the "do something" half of the command bar) ----------

  const ARCHIVE_CHOICES = [
    { hours: 12, label: "12 Hours" },
    { hours: 24, label: "24 Hours" },
    { hours: 168, label: "7 Days" },
  ];

  function actionsFor(ctx) {
    const t = ctx?.target;
    const current = ctx?.archiveAfterHours ?? 12;
    const list = [
      { id: "copy-url", title: "Copy Link", keys: "copy url link share", icon: "link", hint: "⌘⇧C", needsTab: true },
      { id: "split", title: "Split View with Tab…", keys: "split view side by side tile two", icon: "split", picker: "split", needsTab: true },
      { id: "close-tab", title: "Close Tab", keys: "close tab", icon: "close", needsTab: true },
      { id: "duplicate-tab", title: "Duplicate Tab", keys: "duplicate copy clone tab", icon: "duplicate", needsTab: true },
      { id: "reload-tab", title: "Reload Tab", keys: "reload refresh tab", icon: "reload", needsTab: true },
      { id: "pin-tab", title: t?.pinned ? "Unpin Tab" : "Pin Tab", keys: "pin unpin tab", icon: "pin", needsTab: true },
      { id: "mute-tab", title: t?.muted ? "Unmute Tab" : "Mute Tab", keys: "mute unmute sound audio tab", icon: "mute", needsTab: true },
      { id: "move-to-window", title: "Move Tab to New Window", keys: "move tab new window detach", icon: "window", needsTab: true },
      { id: "new-window", title: "New Window", keys: "new window", icon: "newWindow" },
      { id: "archive-tab", title: "Archive Tab", keys: "archive tab close later", icon: "archive", needsTab: true },
      {
        id: "show-archive",
        title: "Show Archived Tabs",
        keys: "archive archived restore reopen closed",
        icon: "archive",
        picker: "archive",
        hint: ctx?.archivedCount ? String(ctx.archivedCount) : "",
      },
      ...ARCHIVE_CHOICES.map((c) => ({
        id: "auto-archive",
        hours: c.hours,
        title: `Auto-Archive Tabs After ${c.label}`,
        keys: "auto archive settings timer",
        icon: "clock",
        checked: current === c.hours,
      })),
      { id: "auto-archive", hours: 0, title: "Turn Off Auto-Archive", keys: "auto archive off disable never", icon: "clock", checked: current === 0 },
      { id: "clear-archive", title: "Clear Archived Tabs", keys: "clear empty archive delete", icon: "trash" },
    ];
    return list.filter((a) => !a.needsTab || t).map((a) => ({ ...a, kind: "action" }));
  }

  // Every query word must be the start of a word in the action's title or keywords.
  function matchAction(q, action) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return 1;
    const hay = `${action.title} ${action.keys}`.toLowerCase().split(/[\s…]+/);
    if (!words.every((w) => hay.some((h) => h.startsWith(w)))) return 0;
    return action.title.toLowerCase().startsWith(q.toLowerCase()) ? 2 : 1;
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
    style.textContent = CSS + EXTRA_CSS;

    const wrap = el("div", `ap-root ap-${mode}`);
    const scrim = el("div", "ap-scrim");
    const card = el("div", "ap-card");
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", "Command palette");

    const inputRow = el("div", "ap-input-row");
    const chip = el("span", "ap-chip");
    chip.hidden = true;
    const input = el("input", "ap-input");
    input.type = "text";
    input.spellcheck = false;
    input.autocomplete = "off";
    input.setAttribute("autocorrect", "off");
    input.setAttribute("autocapitalize", "off");
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-expanded", "true");
    inputRow.append(chip, input);

    const list = el("div", "ap-list");
    list.setAttribute("role", "listbox");
    const footer = el("div", "ap-footer");

    card.append(inputRow, list, footer);
    wrap.append(scrim, card);
    root.append(style, wrap);

    let typed = ""; // what the user actually typed (without inline completion)
    let local = { tabs: [], history: [], archived: [] };
    let suggestions = [];
    let ctx = null; // the tab actions apply to, archive settings
    let picker = null; // null | "split" | "archive"
    let pickerItems = [];
    let items = [];
    let sel = -1; // -1 = act on the text in the box
    let seq = 0;
    let suggestTimer = null;
    let closed = false;
    let lastPointer = { x: -1, y: -1 };

    const PLACEHOLDERS = {
      null: "Search tabs, history and actions, or enter a URL…",
      split: "Pick a tab to show alongside this one…",
      archive: "Search archived tabs…",
    };

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

      if (picker === "archive") {
        const res = await send({ type: "listArchived", query: q });
        if (mySeq !== seq || closed) return;
        pickerItems = Array.isArray(res) ? res : [];
        return render(false);
      }

      const res = await send({ type: "searchLocal", query: q });
      if (mySeq !== seq || closed) return;
      local = res && !res.error ? res : { tabs: [], history: [], archived: [] };
      if (picker === "split") {
        pickerItems = local.tabs.filter((t) => t.tabId !== ctx?.target?.id);
        return render(false);
      }
      if (!q.trim()) suggestions = [];
      render(allowComplete);

      clearTimeout(suggestTimer);
      if (q.trim() && !looksLikeUrl(q) && !q.startsWith(">")) {
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

    function enterPicker(kind) {
      picker = kind;
      typed = "";
      input.value = "";
      sel = -1;
      chip.hidden = !kind;
      chip.innerHTML = kind === "split" ? ICONS.split : kind === "archive" ? ICONS.archive : "";
      if (kind) chip.append(el("span", null, kind === "split" ? "Split View" : "Archived"));
      input.placeholder = PLACEHOLDERS[kind];
      input.focus();
      refresh(false);
    }

    // ----- inline completion (Arc / Safari address-bar style) -----

    function findCompletion() {
      const t = typed.trim().toLowerCase();
      if (!t || /\s/.test(t) || t.length < 2 || t.startsWith(">")) return null;
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
      if (picker) {
        const label = picker === "split" ? "Open Tabs" : "Archived";
        return pickerItems.length ? [{ section: label }, ...pickerItems] : [];
      }

      const out = [];
      const raw = typed.trim();
      const commandMode = raw.startsWith(">");
      const q = commandMode ? raw.slice(1).trim() : raw;

      let actions = [];
      if (commandMode || q.length >= 2) {
        actions = actionsFor(ctx)
          .map((a) => ({ a, s: matchAction(q, a) }))
          .filter((x) => x.s > 0)
          .sort((x, y) => y.s - x.s)
          .map((x) => x.a);
        if (!commandMode) actions = actions.slice(0, 4);
      }
      const pushActions = () => {
        if (!actions.length) return;
        out.push({ section: "Actions" });
        out.push(...actions);
      };

      if (commandMode) {
        pushActions();
        return out;
      }

      // An action whose name starts with what you typed goes first ("clo" → Close Tab).
      const actionsFirst = actions.some((a) => a.title.toLowerCase().startsWith(q.toLowerCase()));
      if (actionsFirst) pushActions();
      if (local.tabs.length) {
        out.push({ section: "Open Tabs" });
        out.push(...local.tabs);
      }
      if (local.history.length) {
        out.push({ section: "History" });
        out.push(...local.history);
      }
      if (local.archived?.length) {
        out.push({ section: "Archived" });
        out.push(...local.archived);
      }
      if (!actionsFirst) pushActions();
      const sugg = suggestions.filter((s) => s.toLowerCase() !== q.toLowerCase());
      if (q && !looksLikeUrl(q) && sugg.length) {
        out.push({ section: "Search Suggestions" });
        sugg.forEach((s) => out.push({ kind: "suggest", title: s }));
      }
      return out;
    }

    function subtitleFor(item) {
      if (item.kind === "archived") return `${stripUrl(item.url)} · ${timeAgo(item.archivedAt)}`;
      if (item.url) return stripUrl(item.url);
      return null;
    }

    function render(allowComplete) {
      const prevKey = sel >= 0 ? keyOf(items[sel]) : null;
      items = buildItems();

      if (allowComplete && !picker) {
        const comp = findCompletion();
        if (comp && comp.text.toLowerCase() !== typed.toLowerCase()) {
          input.value = typed + comp.text.slice(typed.trim().length);
          input.setSelectionRange(typed.length, input.value.length);
        } else {
          input.value = typed;
        }
        sel = comp?.item ? items.findIndex((i) => i.url === comp.item.url && i.kind !== "action") : -1;
      } else if (prevKey) {
        sel = items.findIndex((i) => keyOf(i) === prevKey);
      }

      // Highlight the first row when there's nothing better to act on:
      // an empty box, a picker, ">" command mode, or an action typed by name.
      const firstRow = items.findIndex((i) => !i.section);
      const firstIsStrongAction =
        items[firstRow]?.kind === "action" && items[firstRow].title.toLowerCase().startsWith(typed.trim().toLowerCase());
      if (sel < 0 && (!typed.trim() || picker || typed.trim().startsWith(">") || firstIsStrongAction)) sel = firstRow;

      list.textContent = "";
      if (picker && !items.length) {
        list.append(
          el("div", "ap-empty", picker === "archive" ? "No archived tabs yet" : "No other open tabs to split with")
        );
      }
      items.forEach((item, idx) => {
        if (item.section) {
          list.append(el("div", "ap-section", item.section));
          return;
        }
        const compact = item.kind === "suggest" || item.kind === "action";
        const row = el("div", `ap-item ap-${item.kind}${compact ? " ap-compact" : ""}`);
        row.setAttribute("role", "option");
        row.dataset.idx = idx;
        if (item.kind === "tab") row.style.setProperty("--ap-accent", accentFor(item.url));
        const text = el("div", "ap-text");
        text.append(el("div", "ap-title", item.title));
        const sub = subtitleFor(item);
        if (sub) text.append(el("div", "ap-url", sub));
        row.append(iconNode(item), text);
        if (item.checked) {
          const hint = el("span", "ap-hint ap-check");
          hint.innerHTML = ICONS.check;
          hint.querySelector("svg").style.cssText = "width:14px;height:14px";
          row.append(hint);
        } else if (item.hint) {
          row.append(el("span", "ap-hint", item.hint));
        }
        row.addEventListener("mousemove", (e) => {
          // Browsers fire mousemove when rows re-render under a resting cursor;
          // only a real pointer movement should steal the keyboard selection.
          const first = lastPointer.x === -1;
          const still = e.screenX === lastPointer.x && e.screenY === lastPointer.y;
          lastPointer = { x: e.screenX, y: e.screenY };
          if (first || still) return;
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
      return `${item.kind}|${item.id ?? ""}|${item.hours ?? ""}|${item.tabId ?? ""}|${item.url ?? item.title}`;
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
      let hint = "";
      if (picker === "split") {
        label = item ? `Split view: ${ctx?.target?.title ?? "this tab"}  |  ${item.title}` : "Pick a tab";
        hint = "esc to go back";
      } else if (picker === "archive") {
        label = item ? `Reopen: ${item.url}` : "Nothing archived matches";
        hint = "esc to go back";
      } else if (item?.kind === "tab") {
        label = `Switch to tab: ${item.title}`;
        if (ctx?.target && item.tabId !== ctx.target.id) hint = "⌘↩ split view";
      } else if (item?.kind === "history") label = `Open: ${item.url}`;
      else if (item?.kind === "archived") label = `Reopen: ${item.url}`;
      else if (item?.kind === "suggest") label = `Search for: ${item.title}`;
      else if (item?.kind === "action") label = item.title;
      else {
        const text = input.value.trim();
        if (!text) label = "Press Enter to switch to selected tab, or type > for actions";
        else if (looksLikeUrl(text)) label = `Open: ${toUrl(text)}`;
        else label = `Search for: ${text}`;
      }
      footer.textContent = "";
      footer.append(el("kbd", null, "↩"), el("span", null, label));
      if (hint) footer.append(el("span", "ap-footer-hint", hint));
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

    // ----- doing things -----

    // In overlay mode: open things in a new tab (Arc-style); Shift opens in place.
    // In page mode (the new-tab page): always replace this tab.
    function whereFor(e) {
      if (mode === "page") return "current";
      return e?.shiftKey ? "current" : "new";
    }

    function dismiss() {
      // The overlay disappears; the new-tab page stays put until the background
      // closes or navigates it (onClose there means "cancel", which closes the tab).
      if (mode === "overlay") close();
      else closed = true;
    }

    function screenFrame() {
      const s = window.screen;
      return { x: s.availLeft ?? 0, y: s.availTop ?? 0, width: s.availWidth, height: s.availHeight };
    }

    function splitWith(item) {
      dismiss();
      send({ type: "split", tabId: item.tabId, screen: screenFrame() });
    }

    function runAction(action) {
      if (action.picker) return enterPicker(action.picker);
      if (action.id === "copy-url") {
        const url = mode === "overlay" ? location.href : ctx?.target?.url;
        const ok = url && copyText(url);
        dismiss();
        if (mode === "overlay") toast(ok ? "Link copied" : "Couldn't copy the link", ok ? "link" : null);
        else send({ type: "switchTab", tabId: ctx.target.id, closeSender: true, toast: ok ? "Link copied" : "Couldn't copy the link" });
        return;
      }
      dismiss();
      send({ type: "action", id: action.id, hours: action.hours });
    }

    function activate(idx, e) {
      const item = idx >= 0 ? items[idx] : null;
      const where = whereFor(e);

      if (picker === "split") return item && splitWith(item);
      if (picker === "archive") {
        if (!item) return;
        dismiss();
        return send({ type: "reopenArchived", url: item.url, where });
      }

      if (item?.kind === "action") return runAction(item);
      if (item?.kind === "tab" && e?.metaKey && ctx?.target && item.tabId !== ctx.target.id) return splitWith(item);

      let msg;
      if (item?.kind === "tab") {
        msg = { type: "switchTab", tabId: item.tabId, windowId: item.windowId, closeSender: mode === "page" };
      } else if (item?.kind === "history") {
        msg = { type: "open", url: item.url, where };
      } else if (item?.kind === "archived") {
        msg = { type: "reopenArchived", url: item.url, where };
      } else if (item?.kind === "suggest") {
        msg = { type: "search", text: item.title, where };
      } else {
        const text = input.value.trim();
        if (!text || text.startsWith(">")) return;
        msg = looksLikeUrl(text) ? { type: "open", url: toUrl(text), where } : { type: "search", text, where };
      }
      dismiss();
      send(msg);
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
        case "Backspace":
          // Backspace in an empty picker goes back to the main palette.
          if (picker && !input.value) {
            e.preventDefault();
            enterPicker(null);
          }
          break;
        case "Enter":
          e.preventDefault();
          activate(sel, e);
          break;
        case "Escape":
          e.preventDefault();
          if (picker) enterPicker(null);
          else if (input.value && mode === "page") {
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

    input.placeholder = PLACEHOLDERS[null];
    send({ type: "context" }).then((c) => {
      if (closed || !c || c.error) return;
      ctx = c;
      if (typed.trim()) render(false);
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

  globalThis.ArcPalette = { mount, toast, copyText };
})();
