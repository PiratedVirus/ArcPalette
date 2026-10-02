// Arc Palette — background service worker.
// Answers search queries from the palette (tabs, history, web suggestions)
// and performs the chosen action (switch tab / open URL).

const api = globalThis.browser ?? globalThis.chrome;

const HISTORY_KEY = "visits";
const MRU_KEY = "mru";
const SETTINGS_KEY = "settings";
const MAX_HISTORY = 3000;

const DEFAULT_SETTINGS = { engine: "google" };

const ENGINES = {
  google: {
    search: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
    suggest: async (q, signal) => {
      const res = await fetch(
        `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(q)}`,
        { signal }
      );
      const data = await res.json();
      return Array.isArray(data?.[1]) ? data[1] : [];
    },
  },
  duckduckgo: {
    search: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`,
    suggest: async (q, signal) => {
      const res = await fetch(`https://duckduckgo.com/ac/?q=${encodeURIComponent(q)}&type=list`, { signal });
      const data = await res.json();
      if (Array.isArray(data?.[1])) return data[1];
      return Array.isArray(data) ? data.map((d) => d.phrase).filter(Boolean) : [];
    },
  },
};

// ---------- storage helpers ----------

let visitsCache = null; // url -> { url, title, visits, last }
let mruCache = null; // [tabId, ...] most recent first

async function getVisits() {
  if (!visitsCache) {
    const got = await api.storage.local.get(HISTORY_KEY);
    visitsCache = got[HISTORY_KEY] ?? {};
  }
  return visitsCache;
}

let saveVisitsTimer = null;
function saveVisitsSoon() {
  clearTimeout(saveVisitsTimer);
  saveVisitsTimer = setTimeout(() => {
    const entries = Object.values(visitsCache);
    if (entries.length > MAX_HISTORY) {
      entries.sort((a, b) => b.last - a.last);
      visitsCache = Object.fromEntries(entries.slice(0, MAX_HISTORY).map((e) => [e.url, e]));
    }
    api.storage.local.set({ [HISTORY_KEY]: visitsCache });
  }, 1000);
}

async function getMru() {
  if (!mruCache) {
    const got = await api.storage.local.get(MRU_KEY);
    mruCache = got[MRU_KEY] ?? [];
  }
  return mruCache;
}

function saveMru() {
  api.storage.local.set({ [MRU_KEY]: mruCache });
}

async function getSettings() {
  const got = await api.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(got[SETTINGS_KEY] ?? {}) };
}

// ---------- tracking ----------

function isTrackable(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

async function recordVisit(url, title, countVisit) {
  if (!isTrackable(url)) return;
  const visits = await getVisits();
  const entry = visits[url] ?? { url, title: "", visits: 0, last: 0 };
  if (title) entry.title = title;
  if (countVisit) {
    entry.visits += 1;
    entry.last = Date.now();
  }
  visits[url] = entry;
  saveVisitsSoon();
}

api.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") recordVisit(tab.url, tab.title, true);
  else if (changeInfo.title) recordVisit(tab.url, changeInfo.title, false);
});

api.tabs.onActivated.addListener(async ({ tabId }) => {
  const mru = await getMru();
  const i = mru.indexOf(tabId);
  if (i !== -1) mru.splice(i, 1);
  mru.unshift(tabId);
  mru.length = Math.min(mru.length, 200);
  saveMru();
});

api.tabs.onRemoved.addListener(async (tabId) => {
  const mru = await getMru();
  const i = mru.indexOf(tabId);
  if (i !== -1) {
    mru.splice(i, 1);
    saveMru();
  }
});

// ---------- matching ----------

function stripUrl(url) {
  return (url || "").replace(/^[a-z]+:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

// Returns a score > 0 if every query word appears in the title or URL, else 0.
function matchScore(q, title, url) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return 1;
  const t = (title || "").toLowerCase();
  const u = stripUrl(url).toLowerCase();
  if (!words.every((w) => t.includes(w) || u.includes(w))) return 0;

  const ql = q.toLowerCase().trim();
  let score = 1;
  if (u.startsWith(ql)) score += 100;
  else if (hostOf(url).includes(ql)) score += 40;
  if (t.startsWith(ql)) score += 30;
  else if (t.includes(ql)) score += 10;
  return score;
}

// ---------- queries ----------

async function searchLocal(query, excludeTabId) {
  const q = query.trim();
  const [tabs, mru] = await Promise.all([api.tabs.query({}), getMru()]);
  const rank = (id) => {
    const i = mru.indexOf(id);
    return i === -1 ? 1e6 : i;
  };

  const openTabs = tabs
    .filter((t) => t.id !== excludeTabId && t.url && !t.url.startsWith(api.runtime.getURL("")))
    .map((t) => ({ t, s: matchScore(q, t.title, t.url) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => (q ? b.s - a.s : 0) || rank(a.t.id) - rank(b.t.id))
    .map(({ t }) => ({
      kind: "tab",
      tabId: t.id,
      windowId: t.windowId,
      title: t.title || stripUrl(t.url),
      url: t.url,
      favicon: t.favIconUrl || null,
    }));

  let history = [];
  if (q) {
    const openUrls = new Set(openTabs.map((t) => t.url));
    const merged = new Map();

    const visits = await getVisits();
    for (const v of Object.values(visits)) merged.set(v.url, v);

    // Use Safari's real history too, when the browser exposes it.
    if (api.history?.search) {
      try {
        const items = await api.history.search({ text: q, maxResults: 100, startTime: 0 });
        for (const h of items) {
          if (!isTrackable(h.url)) continue;
          const prev = merged.get(h.url);
          merged.set(h.url, {
            url: h.url,
            title: h.title || prev?.title || "",
            visits: Math.max(prev?.visits ?? 0, h.visitCount ?? 1),
            last: Math.max(prev?.last ?? 0, h.lastVisitTime ?? 0),
          });
        }
      } catch {
        // history API unavailable — our own visit log still works
      }
    }

    const now = Date.now();
    history = [...merged.values()]
      .filter((v) => !openUrls.has(v.url))
      .map((v) => {
        const s = matchScore(q, v.title, v.url);
        if (!s) return null;
        const ageDays = (now - (v.last || 0)) / 864e5;
        const frecency = Math.log2(1 + (v.visits || 1)) * 8 + Math.max(0, 20 - ageDays);
        return { v, s: s + frecency };
      })
      .filter(Boolean)
      .sort((a, b) => b.s - a.s)
      .slice(0, 6)
      .map(({ v }) => ({ kind: "history", title: v.title || stripUrl(v.url), url: v.url, visits: v.visits || 1 }));
  }

  return { tabs: q ? openTabs.slice(0, 6) : openTabs, history };
}

let suggestAbort = null;
async function searchSuggestions(query) {
  const q = query.trim();
  if (!q) return [];
  suggestAbort?.abort();
  suggestAbort = new AbortController();
  const { engine } = await getSettings();
  try {
    const list = await (ENGINES[engine] ?? ENGINES.google).suggest(q, suggestAbort.signal);
    return list.slice(0, 5);
  } catch {
    return [];
  }
}

// ---------- actions ----------

async function switchToTab(tabId, windowId) {
  await api.tabs.update(tabId, { active: true });
  if (windowId != null && api.windows?.update) {
    try {
      await api.windows.update(windowId, { focused: true });
    } catch {}
  }
}

async function openUrl(url, { sender, where }) {
  const senderTab = sender.tab;
  if (where === "current" && senderTab) {
    await api.tabs.update(senderTab.id, { url });
  } else {
    await api.tabs.create({
      url,
      active: true,
      ...(senderTab ? { windowId: senderTab.windowId, index: senderTab.index + 1 } : {}),
    });
  }
}

async function searchUrl(text) {
  const { engine } = await getSettings();
  return (ENGINES[engine] ?? ENGINES.google).search(text);
}

// The palette couldn't be injected into this tab (Start Page, Safari settings,
// App Store pages, …): show the palette in a fresh new tab instead.
async function openPaletteFallback(tab) {
  const pageUrl = api.runtime.getURL("newtab.html");
  const blank = !tab?.url || /^(about:|favorites:|safari-|topsites:)/i.test(tab.url);
  if (tab && blank) await api.tabs.update(tab.id, { url: pageUrl });
  else await api.tabs.create({ url: pageUrl, ...(tab ? { index: tab.index + 1 } : {}) });
}

async function togglePalette(tab) {
  if (!tab) [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (tab?.url?.startsWith(api.runtime.getURL(""))) return; // already on the palette page
  try {
    const res = await api.tabs.sendMessage(tab.id, { type: "toggle" });
    if (!res?.ok) throw new Error("no palette");
  } catch {
    await openPaletteFallback(tab);
  }
}

api.commands?.onCommand.addListener((command) => {
  if (command === "toggle-palette") togglePalette();
});

api.action?.onClicked.addListener((tab) => togglePalette(tab));

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handle = async () => {
    switch (msg?.type) {
      case "searchLocal":
        return searchLocal(msg.query ?? "", sender.tab?.id);
      case "suggest":
        return searchSuggestions(msg.query ?? "");
      case "switchTab":
        await switchToTab(msg.tabId, msg.windowId);
        if (msg.closeSender && sender.tab) await api.tabs.remove(sender.tab.id);
        return { ok: true };
      case "open":
        await openUrl(msg.url, { sender, where: msg.where });
        return { ok: true };
      case "search":
        await openUrl(await searchUrl(msg.text), { sender, where: msg.where });
        return { ok: true };
      case "closeSender":
        if (sender.tab) await api.tabs.remove(sender.tab.id);
        return { ok: true };
      case "getSettings":
        return getSettings();
      case "setSettings": {
        const next = { ...(await getSettings()), ...msg.settings };
        await api.storage.local.set({ [SETTINGS_KEY]: next });
        return next;
      }
      default:
        return null;
    }
  };
  handle().then(sendResponse, (err) => sendResponse({ error: String(err) }));
  return true; // keep the channel open for the async response
});
