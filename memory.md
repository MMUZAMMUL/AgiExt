# 🧠 AgiExt — Project Memory & Mind Map

> This file is the shared "brain" for the AgiExt repository. It is a living mind map:
> what this repo is, what lives inside it, how each extension is wired, and a running log
> of decisions and bug fixes. **Read this first** when picking up work, and **update it**
> whenever something meaningful changes.

---

## 1. What this repo is

`AgiExt` is a **monorepo for browser extensions** (Manifest V3, Chromium-based:
Chrome / Edge / Brave). It is intended to hold **multiple independent extensions**, each in
its own top-level folder. They are built with **plain HTML/CSS/JS — no build step, no
framework** — so any folder can be loaded directly via `chrome://extensions → Load unpacked`.

```
AgiExt/
├── README.md
├── memory.md                  ← you are here (project mind map)
└── repo-doc-generator/        ← Extension #1: "RepoDocs AI"
    └── (more extensions will be added as sibling folders)
```

### Conventions for new extensions
- One self-contained folder per extension at the repo root.
- Each folder has its own `manifest.json`, `README.md`, and (if vendored) a `vendor/` dir.
- No bundler: ship readable source. Background = ES module service worker; popup/offscreen
  = classic scripts when they need UMD/global libraries (a module SW can't load UMD globals).
- Keep secrets/keys in `chrome.storage.local`, never hard-coded, never sent to our servers.
- When you add an extension, add a section for it below (§3) and append to the changelog (§5).

---

## 2. Mind map (at a glance)

```
AgiExt (MV3 extension monorepo)
│
├── repo-doc-generator  ── "RepoDocs AI"
│     ├── INPUT: a GitHub repo (URL / owner/repo) OR any website URL
│     ├── ANALYZE: GitHub REST API  |  website HTML fetch + DOMParser
│     ├── WRITE:   multi-provider AI (Groq → Cerebras → Gemini → OpenRouter failover)
│     ├── DRAW:    SVG structure tree + radial feature mindmap
│     ├── CAPTURE: visible tab / full-page stitch / window-screen / live-app screenshot
│     └── OUTPUT:  client-side PDF (jsPDF) + DOCX (docx.js)
│
└── (future extension folders…)
```

---

## 3. Extensions

### 3.1 `repo-doc-generator` — RepoDocs AI

**Goal:** Point at any public GitHub repo or website and generate a professional 5–10 page
**PDF + DOCX** (overview, architecture, feature mindmap, structure diagram, screenshots,
conclusion) — written by the user's *own* free AI key, assembled entirely in-browser. Nothing
is uploaded to any server.

#### Architecture / data flow
```
popup/  (UI, user gesture context)
  │  provider keys, repo/website input, screenshot gallery, progress, downloads
  │  → sends "job:start" to background
  ▼
background/  (MV3 service worker, ES module — NO DOM)
  background.js        orchestrator: analyze → write → diagram → assemble → store result
  github.js            GitHub REST: meta, branches, languages, tree, README, manifest, liveUrl
  website.js           non-GitHub: fetch HTML, hand to offscreen for parsing, screenshot
  providers.js         AI failover cascade across Groq/Cerebras/Gemini/OpenRouter
  diagrams.js          pure-string SVG builders (structure tree + radial mindmap)
  screenshot.js        captureVisibleTab / captureFullPage (scroll+stitch) / openAndCaptureUrl
  offscreen-client.js  ensureOffscreen() + sendToOffscreen() message helpers
  │  (service worker has no DOM/canvas/DOMParser → delegates to ↓)
  ▼
offscreen/  (offscreen document — the ONLY SW-reachable context with a real DOM)
  offscreen.html       loads vendored jsPDF + docx UMD/IIFE globals, then offscreen.js
  offscreen.js         svg→png raster, screenshot stitch, image measure, HTML parse,
                       build-pdf (jsPDF), build-docx (docx.js)
  vendor/
    jspdf.umd.min.js   v4.2.1
    docx.iife.js       exposes global `docx`
```

#### Why the split exists (important mental model)
- A **module service worker cannot load UMD/IIFE libraries** or use `document`/`canvas`/
  `DOMParser`. So all rendering (SVG→PNG, stitching, PDF/DOCX assembly, HTML parsing) is
  delegated to the **offscreen document** via `chrome.runtime.sendMessage`.
- **Window/Screen capture and clipboard** run in the **popup** (not background), because
  `getUserMedia` / `<video>` / `<canvas>` / Clipboard API need a real page tied to a user
  gesture.

#### Job state machine
`chrome.storage.local["repodocs_job"]` holds `{ status, stage, result, error, startedAt }`.
Status: `idle → running → done | error`. The popup re-renders from this on open and on
`job:update` broadcasts, so progress survives closing/reopening the popup.

#### Message routing (all via `chrome.runtime.sendMessage`)
Every message carries a `target` field: `"background"`, `"offscreen"`, or `"popup"`. Each
listener early-returns if `msg.target` isn't theirs. Async handlers `return true` to keep the
channel open for `sendResponse`.

#### Permissions of note
`storage, unlimitedStorage, downloads, offscreen, alarms, tabs, activeTab, scripting,
desktopCapture` + host perms for GitHub/raw + the 4 AI providers. `<all_urls>` is **optional**
(requested only when capturing a live-app / website screenshot).

#### Known gotchas / fragile spots
- **No auto live-app/website screenshot** — that feature was removed (it opened a throwaway
  tab and was the source of "No tab with id …"). Screenshots are now only added manually via
  the gallery. If re-adding any "open a tab and capture it" flow, the capture MUST be `await`ed
  inside its try/finally, or the `finally` closes the tab early and the rejection escapes the
  catch and crashes the whole job. (See changelog 2026-06-21.)
- Long AI jobs risk SW termination; an `alarms` keepalive (every 0.5 min) mitigates it.
- Very large repos → truncated structure diagram; may need a GitHub token (60 → 5,000 req/hr).
- Website mode still `fetch`es page HTML, which needs the optional `<all_urls>` host grant;
  there is no longer in-app UI to request it, so website mode may need the permission granted
  manually. GitHub mode is unaffected (its host permissions are declared in the manifest).

---

## 4. How to test an extension locally
1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select the extension's folder (e.g. `repo-doc-generator`).
3. Open the service worker console from the extension card to watch background logs.
4. For RepoDocs AI: add at least one free AI key, paste a repo/URL, click **Generate**.

---

## 5. Changelog / decision log

- **2026-06-21** — UX: added a global **↻ Reset** button in the popup header (always visible)
  that cancels any in-flight job, clears the result/error, and returns to the setup screen so
  the user can run again — while keeping their saved keys, repo/URL, and screenshot gallery.
  Reused the same `resetToSetup()` for the done-screen "Start a new document" and the
  error-screen "Try again". Relabeled the two done-screen downloads to "⬇️ Download PDF file"
  and "⬇️ Download Word file (.docx)" for clarity. Files: `popup/popup.html`, `popup/popup.css`,
  `popup/popup.js`.
- **2026-06-21** — **Removed the automatic live-app / website screenshot feature** from
  RepoDocs AI. Even after the `await` fix, opening a throwaway tab to screenshot a live URL
  was still the source of "Something went wrong / No tab with id …" on Generate, and it isn't
  needed — users add their own images via the manual gallery (visible-tab / full-page /
  window-screen / upload), which is unaffected. Removed: the "capture live app" checkbox
  (popup.html/.js), the GitHub `Live Application` page + capture block and the website
  `Live Page Screenshot` page + auto-capture (background.js), the website screenshot step
  (website.js), the now-unused `openAndCaptureUrl()` (screenshot.js), and the
  `request-screenshot-permission` handler. Manual capture helpers
  (`captureVisibleTab` / `captureFullPage` / `measureDataUrl`) are kept — the gallery uses them.
- **2026-06-21** — Fixed job-crashing bug `No tab with id: …` / "Something went wrong" on
  Generate. Root cause: in `repo-doc-generator/background/screenshot.js`,
  `openAndCaptureUrl()` returned `captureFullPage(...)` / `measureDataUrl(...)` **without
  `await`**, so the `finally` closed the captured tab before the async capture finished and the
  rejection bypassed the `catch { return null }`. Fix: `await` both inside the `try` so the tab
  stays alive until capture completes and failures degrade to a skipped (null) screenshot.
- **2026-06-21** — Created this `memory.md` as the repo's shared mind map; established the
  multi-extension monorepo conventions (§1).
- _(earlier)_ — Imported the RepoDocs AI extension into AgiExt from AgiForge.
