// Arc Palette — background service worker.
// Answers search queries from the palette (tabs, history, web suggestions)
// and performs the chosen action (switch tab / open URL).

const api = globalThis.browser ?? globalThis.chrome;

const HISTORY_KEY = "visits";
const MRU_KEY = "mru";
const SETTINGS_KEY = "settings";
const ACTIVITY_KEY = "activity";
const ARCHIVE_KEY = "archive";
const MAX_HISTORY = 3000;
const MAX_ARCHIVE = 300;
const ARCHIVE_ALARM = "auto-archive";

// archiveAfterHours: 0 turns auto-archive off.
const DEFAULT_SETTINGS = { engine: "google", archiveAfterHours: 12 };

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
  const prev = mru[0];
  const i = mru.indexOf(tabId);
  if (i !== -1) mru.splice(i, 1);
  mru.unshift(tabId);
  mru.length = Math.min(mru.length, 200);
  saveMru();

  // The tab we're leaving was in use until now; the new one is in use from now.
  const activity = await getActivity();
  const now = Date.now();
  if (prev != null) activity[prev] = now;
  activity[tabId] = now;
  saveActivity();
});

api.tabs.onRemoved.addListener(async (tabId) => {
  const mru = await getMru();
  const i = mru.indexOf(tabId);
  if (i !== -1) {
    mru.splice(i, 1);
    saveMru();
  }
  const activity = await getActivity();
  if (tabId in activity) {
    delete activity[tabId];
    saveActivity();
  }
});

// ---------- auto-archive (Arc closes tabs you haven't used in a while) ----------

let activityCache = null; // tabId -> last time the tab was in use

async function getActivity() {
  if (!activityCache) {
    const got = await api.storage.local.get(ACTIVITY_KEY);
    activityCache = got[ACTIVITY_KEY] ?? {};
  }
  return activityCache;
}

function saveActivity() {
  api.storage.local.set({ [ACTIVITY_KEY]: activityCache });
}

async function getArchive() {
  const got = await api.storage.local.get(ARCHIVE_KEY);
  return got[ARCHIVE_KEY] ?? [];
}

async function archiveTabs(tabs) {
  const keep = tabs.filter((t) => isTrackable(t.url));
  if (!keep.length) return 0;
  const now = Date.now();
  const entries = keep.map((t) => ({
    url: t.url,
    title: t.title || stripUrl(t.url),
    favicon: t.favIconUrl || null,
    archivedAt: now,
  }));
  const archive = (await getArchive()).filter((a) => !entries.some((e) => e.url === a.url));
  await api.storage.local.set({ [ARCHIVE_KEY]: [...entries, ...archive].slice(0, MAX_ARCHIVE) });
  await api.tabs.remove(keep.map((t) => t.id));
  return keep.length;
}

async function runAutoArchive() {
  const { archiveAfterHours } = await getSettings();
  const tabs = await api.tabs.query({});
  const activity = await getActivity();
  const now = Date.now();

  // Forget tabs that no longer exist (tab ids change when Safari restarts).
  const live = new Set(tabs.map((t) => String(t.id)));
  for (const id of Object.keys(activity)) if (!live.has(id)) delete activity[id];

  const stale = [];
  for (const t of tabs) {
    // Visible tabs are in use; tabs we've never seen start their clock now.
    if (t.active || activity[t.id] == null) {
      activity[t.id] = now;
      continue;
    }
    if (!archiveAfterHours || t.pinned || t.audible) continue;
    if (now - activity[t.id] > archiveAfterHours * 36e5) stale.push(t);
  }
  saveActivity();
  if (stale.length) await archiveTabs(stale);
}

function ensureAlarm() {
  api.alarms?.get(ARCHIVE_ALARM).then((a) => {
    if (!a) api.alarms.create(ARCHIVE_ALARM, { periodInMinutes: 10, delayInMinutes: 1 });
  });
}

api.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name === ARCHIVE_ALARM) runAutoArchive();
});
api.runtime.onInstalled?.addListener(ensureAlarm);
api.runtime.onStartup?.addListener(ensureAlarm);
ensureAlarm();

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

  let archived = [];
  if (q) {
    archived = (await getArchive())
      .map((a) => ({ a, s: matchScore(q, a.title, a.url) }))
      .filter((x) => x.s > 0)
      .sort((x, y) => y.s - x.s || y.a.archivedAt - x.a.archivedAt)
      .slice(0, 4)
      .map(({ a }) => ({ kind: "archived", ...a }));
  }

  return { tabs: q ? openTabs.slice(0, 6) : openTabs, history, archived };
}

async function listArchived(query) {
  const q = query.trim();
  return (await getArchive())
    .filter((a) => matchScore(q, a.title, a.url) > 0)
    .slice(0, 50)
    .map((a) => ({ kind: "archived", ...a }));
}

// The tab that actions ("Close Tab", "Copy Link", split view…) apply to.
// From the overlay that's the page it sits on; from the new-tab palette it's
// the tab you were on before pressing ⌘T.
async function targetTabFor(sender) {
  const self = sender.tab;
  if (self && !self.url?.startsWith(api.runtime.getURL(""))) return self;
  const mru = await getMru();
  for (const id of mru) {
    if (id === self?.id) continue;
    try {
      const t = await api.tabs.get(id);
      if (!self || t.windowId === self.windowId) return t;
    } catch {}
  }
  return null;
}

async function paletteContext(sender) {
  const [target, settings] = await Promise.all([targetTabFor(sender), getSettings()]);
  return {
    target: target && {
      id: target.id,
      url: target.url,
      title: target.title,
      pinned: !!target.pinned,
      muted: !!target.mutedInfo?.muted,
    },
    archiveAfterHours: settings.archiveAfterHours,
    archivedCount: (await getArchive()).length,
  };
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

// ---------- palette actions ----------

// Runs a named action on the target tab. Returns { ok, toast? } — the toast is
// shown on whatever page the user ends up looking at.
async function runAction(id, msg, sender) {
  const target = await targetTabFor(sender);
  const needTarget = !["new-window", "auto-archive", "clear-archive"].includes(id);
  if (needTarget && !target) return { ok: false, toast: "No tab to act on" };

  switch (id) {
    case "close-tab":
      await api.tabs.remove(target.id);
      return { ok: true };
    case "duplicate-tab":
      if (api.tabs.duplicate) await api.tabs.duplicate(target.id);
      else await api.tabs.create({ url: target.url, index: target.index + 1, windowId: target.windowId });
      return { ok: true };
    case "reload-tab":
      await api.tabs.reload(target.id);
      await switchToTab(target.id, target.windowId);
      return { ok: true };
    case "pin-tab":
      await api.tabs.update(target.id, { pinned: !target.pinned });
      await switchToTab(target.id, target.windowId);
      return { ok: true, toast: target.pinned ? "Unpinned" : "Pinned" };
    case "mute-tab": {
      const muted = !target.mutedInfo?.muted;
      await api.tabs.update(target.id, { muted });
      await switchToTab(target.id, target.windowId);
      return { ok: true, toast: muted ? "Muted" : "Unmuted" };
    }
    case "new-window":
      await api.windows.create({ focused: true });
      return { ok: true };
    case "move-to-window":
      await moveTabToNewWindow(target);
      return { ok: true };
    case "archive-tab":
      await archiveTabs([target]);
      return { ok: true, toast: "Tab archived" };
    case "auto-archive": {
      const hours = Number(msg.hours) || 0;
      const settings = { ...(await getSettings()), archiveAfterHours: hours };
      await api.storage.local.set({ [SETTINGS_KEY]: settings });
      await switchToTab(target?.id ?? sender.tab.id, target?.windowId);
      return { ok: true, toast: hours ? `Tabs auto-archive after ${formatHours(hours)}` : "Auto-archive off" };
    }
    case "clear-archive":
      await api.storage.local.set({ [ARCHIVE_KEY]: [] });
      return { ok: true, toast: "Archive cleared" };
    default:
      return { ok: false, toast: "Unknown action" };
  }
}

function formatHours(h) {
  return h % 24 === 0 ? `${h / 24} day${h === 24 ? "" : "s"}` : `${h} hours`;
}

// Moves a tab into its own window. Returns that window. If Safari won't move
// the tab itself, reopens its URL in the new window and closes the original.
async function moveTabToNewWindow(tab) {
  let win = null;
  try {
    win = await api.windows.create({ tabId: tab.id, focused: true });
    const moved = await api.tabs.get(tab.id);
    if (moved.windowId === win.id) return win;
  } catch {}
  if (win) {
    const [blank] = await api.tabs.query({ windowId: win.id });
    if (blank && blank.id !== tab.id) await api.tabs.update(blank.id, { url: tab.url });
  } else {
    win = await api.windows.create({ url: tab.url, focused: true });
  }
  await api.tabs.remove(tab.id).catch(() => {});
  return win;
}

// Split view: the target tab on the left half of the screen, `otherTabId` on
// the right, each in its own window. Window placement is done by the native
// handler (AppleScript), since Safari extensions can't position windows reliably.
async function splitView(otherTabId, screen, sender) {
  const left = await targetTabFor(sender);
  if (!left) return { ok: false, toast: "No tab to split with" };
  if (left.id === otherTabId) return { ok: false, toast: "Pick a different tab" };
  const right = await api.tabs.get(otherTabId);

  // If the palette page itself was the new tab, get rid of it first.
  const self = sender.tab;
  if (self && self.id !== left.id && self.url?.startsWith(api.runtime.getURL(""))) {
    await api.tabs.remove(self.id).catch(() => {});
  }

  await switchToTab(left.id, left.windowId);
  await moveTabToNewWindow(right);
  await new Promise((r) => setTimeout(r, 250)); // let Safari finish opening the window

  try {
    const res = await api.runtime.sendNativeMessage("com.saurabhkulkarni.ArcPalette", {
      action: "tile",
      leftURL: left.url,
      frame: screen,
      gap: 8,
    });
    if (res?.ok) return { ok: true };
    if (res?.code === -1743) {
      return { ok: false, toast: "Allow Arc Palette to control Safari in System Settings → Privacy & Security → Automation" };
    }
    return { ok: false, toast: `Couldn't arrange windows: ${res?.error ?? "unknown error"}` };
  } catch (err) {
    return { ok: false, toast: "Couldn't reach the Arc Palette app — open it once and try again" };
  }
}

// Shows a toast on whichever tab is now in front.
async function toastActiveTab(text) {
  if (!text) return;
  const [tab] = await api.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab) api.tabs.sendMessage(tab.id, { type: "toast", text }).catch(() => {});
}

api.commands?.onCommand.addListener(async (command) => {
  if (command === "toggle-palette") togglePalette();
  if (command === "copy-url") {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    if (tab) api.tabs.sendMessage(tab.id, { type: "copyUrl" }).catch(() => {});
  }
});

api.action?.onClicked.addListener((tab) => togglePalette(tab));

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handle = async () => {
    switch (msg?.type) {
      case "searchLocal":
        return searchLocal(msg.query ?? "", sender.tab?.id);
      case "suggest":
        return searchSuggestions(msg.query ?? "");
      case "context":
        return paletteContext(sender);
      case "listArchived":
        return listArchived(msg.query ?? "");
      case "action": {
        const res = await runAction(msg.id, msg, sender);
        if (res.toast) setTimeout(() => toastActiveTab(res.toast), 300);
        // Actions launched from the new-tab palette shouldn't leave that tab behind.
        if (sender.tab?.url?.startsWith(api.runtime.getURL(""))) {
          api.tabs.remove(sender.tab.id).catch(() => {});
        }
        return res;
      }
      case "split": {
        const res = await splitView(msg.tabId, msg.screen, sender);
        if (res.toast) setTimeout(() => toastActiveTab(res.toast), 300);
        return res;
      }
      case "reopenArchived": {
        const archive = await getArchive();
        await api.storage.local.set({ [ARCHIVE_KEY]: archive.filter((a) => a.url !== msg.url) });
        await openUrl(msg.url, { sender, where: msg.where });
        return { ok: true };
      }
      case "switchTab":
        await switchToTab(msg.tabId, msg.windowId);
        if (msg.closeSender && sender.tab) await api.tabs.remove(sender.tab.id);
        if (msg.toast) setTimeout(() => toastActiveTab(msg.toast), 300);
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
