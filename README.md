# Arc Palette for Safari

An Arc-style command palette: search open tabs, history and the web from one box.

## Shortcuts
- **⌘T**: a new tab opens as the palette. Pick an open tab and the blank tab closes; Esc cancels.
- **⌥T** (or the toolbar button): the palette opens on top of the current page.
- ↑/↓ or Tab to move · → accepts the inline completion · ↩ opens in a new tab · ⇧↩ opens in the current tab · Esc closes.

## Search engine
Google by default. To switch to DuckDuckGo, open Safari → Develop → Web Extension Background Content → Arc Palette and run:
`browser.storage.local.set({settings:{engine:"duckduckgo"}})`

## History
Visits are recorded from the moment the extension is installed. Safari's own history is also used if the browser exposes it to extensions.

## Files
- `extension/`: the web extension (manifest, background.js, palette.js, content.js, newtab page)
- `Arc Palette/`: the Xcode wrapper app that Safari requires
