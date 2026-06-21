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
│     ├── INPUT: a GitHub repo (URL / owner/repo)  [GitHub-only by design]
│     ├── ANALYZE: GitHub REST API (README + .md docs first)
│     ├── WRITE:   ~20-provider AI catalog w/ auto-detect + failover chain
│     ├── DRAW:    SVG structure tree + radial feature mindmap
│     ├── CAPTURE: visible tab / select-area→annotation editor / full-page / window-screen / upload
│     ├── UI:      on-page floating overlay panel (injected iframe; not a popup, not a side panel); + desktop notifications + optional auto-save
│     └── OUTPUT:  client-side PDF (jsPDF) + DOCX (docx.js), flowing blocks + 2-up grid
│
└── (future extension folders…)
```

---

## 3. Extensions

### 3.1 `repo-doc-generator` — RepoDocs AI

**Goal:** Point at a public **GitHub repo** and generate a clean, concise **developer project
report** as **PDF + DOCX** — written by the user's *own* free AI key, assembled entirely
in-browser. Nothing is uploaded to any server. **GitHub-only by design** (no arbitrary-URL/
website mode — too many ways for random sites to break).

**Report content (in order):** facts strip → Project Summary → Tech Stack & Architecture →
Key Features → Repository Structure diagram → Feature Mindmap diagram → Setup & Development
Steps → Project Findings → Solved Gaps & Project Value → Conclusion → Screenshots grid.

**Content source:** primarily `README.md` + other `.md` docs (architecture/usage/contributing/
etc., gathered by `github.js` `getMarkdownDocs`), plus languages, top-level structure, and the
dependency manifest. The AI is prompted for a **concise, bullet-driven developer tone**
(~45–110 words/section), NOT academic prose.

**Layout:** the offscreen renderer flows a flat list of **blocks** onto pages
(`facts` / `section` / `diagram` / `gallery`) instead of one-section-per-page. White content
pages, amber headings, a running header + page-numbered footer. Screenshots render in a
**two-up, size-adjusted grid** (multiple per page).

#### Architecture / data flow
```
popup/  (injected as an ON-PAGE OVERLAY iframe — persistent, doesn't close on page-click; user-gesture context)
  │  provider connections, GitHub repo input, screenshot gallery, auto-save, ↻ reset, progress, downloads
  │  → sends "job:start" to background; live-syncs gallery via chrome.storage.onChanged
  ▼
editor/  (annotation editor — its own extension tab, opened after a select-area crop)
  editor.html/.css/.js  canvas tools (rect/ellipse/arrow/line/pen/text), colors, undo/redo,
                        Done→append repodocs_gallery, Copy→clipboard, Save→Downloads
  ▼
background/  (MV3 service worker, ES module — NO DOM)
  background.js        orchestrator: analyze → write → diagram → assemble (blocks) → store result;
                       also overlay inject/toggle (action.onClicked→executeScript), hide-overlay-
                       during-capture, notifications, auto-save, capture:area→editor
  github.js            GitHub REST: meta, branches, languages, tree, README, .md docs, manifest
  providers.js         ~20-provider catalog (PROVIDER_CATALOG), key auto-detect, testProviderKey,
                       connections[]→engine-chain failover (OpenAI-compat + Anthropic special case)
  diagrams.js          pure-string SVG builders (structure tree + radial mindmap)
  screenshot.js        captureVisibleTab / captureArea (drag-select crop) / captureFullPage (stitch)
  offscreen-client.js  ensureOffscreen() + sendToOffscreen() message helpers
  │  (service worker has no DOM/canvas → delegates to ↓)
  ▼
offscreen/  (offscreen document — the ONLY SW-reachable context with a real DOM)
  offscreen.html       loads vendored jsPDF + docx UMD/IIFE globals, then offscreen.js
  offscreen.js         svg→png raster, screenshot stitch, image measure,
                       build-pdf (jsPDF) / build-docx (docx.js) from {cover, blocks, footerLabel}
  vendor/
    jspdf.umd.min.js   v4.2.1
    docx.iife.js       exposes global `docx`
```

#### Why the split exists (important mental model)
- A **module service worker cannot load UMD/IIFE libraries** or use `document`/`canvas`.
  So all rendering (SVG→PNG, stitching, PDF/DOCX assembly) is delegated to the **offscreen
  document** via `chrome.runtime.sendMessage`.
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
desktopCapture` + host perms for GitHub/raw + every provider API host in `PROVIDER_CATALOG`
(~20). No `<all_urls>` — the live-app screenshot was removed. Select-area capture uses the
existing `activeTab`/`scripting` perms (it injects an overlay into the current tab).

#### Known gotchas / fragile spots
- **No auto live-app/website screenshot** — that feature was removed (it opened a throwaway
  tab and was the source of "No tab with id …"). Screenshots are now only added manually via
  the gallery. If re-adding any "open a tab and capture it" flow, the capture MUST be `await`ed
  inside its try/finally, or the `finally` closes the tab early and the rejection escapes the
  catch and crashes the whole job. (See changelog 2026-06-21.)
- Long AI jobs risk SW termination; an `alarms` keepalive (every 0.5 min) mitigates it.
- Very large repos → truncated structure diagram; may need a GitHub token (60 → 5,000 req/hr).
- Report quality tracks the repo's docs: thin/missing README + no other `.md` → less for the AI.
- The offscreen `gallery`/`diagram` flow math is approximate (fixed row reserves); very tall
  images or long captions can crowd a row. Fine for v1; revisit if layouts look tight.

---

## 4. How to test an extension locally
1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select the extension's folder (e.g. `repo-doc-generator`).
3. Open the service worker console from the extension card to watch background logs.
4. For RepoDocs AI: add at least one free AI key, paste a repo/URL, click **Generate**.

---

## 5. Changelog / decision log

- **2026-06-21** — **Replaced the floating window with an on-page overlay panel (injected iframe).**
  User feedback: a separate window still shows as its own sized thing, and they want the UI to
  *overlay the real page* — appear on icon click, stay put when clicking elsewhere on the page,
  close only via a button, and never dock/shrink the page (sites like GitHub block capture when the
  layout is reshaped). Implementation: removed the `chrome.windows.create` approach. `action.onClicked`
  now runs `chrome.scripting.executeScript` injecting `injectOverlay()` into the active tab — it
  creates a `position:fixed`, max-z-index host with a **Shadow DOM** (style isolation from the page)
  containing a draggable title bar (✕ close) and an `<iframe src=popup/popup.html>` (added to
  `web_accessible_resources` so the page can frame it). Clicking the icon again toggles it off.
  Because the panel is now part of the page DOM, it would otherwise appear in screenshots — so the
  three capture handlers (`capture:visible/fullpage/area`) are wrapped in `withOverlayHidden(tabId, fn)`
  which sets the host `visibility:hidden` around the capture. Restricted pages (chrome://, Web Store,
  PDF viewer) can't be injected — `onClicked` catches the failure and fires a notification telling the
  user to open a normal tab. `popup.css` body is `width:100%` to fill the iframe. The annotation
  editor still opens in its own tab (unchanged). **Removed `sidePanel` permission and `side_panel`
  manifest key in the prior step; this step adds `web_accessible_resources`.**
- **2026-06-21** — **Replaced the side panel with a standalone floating window.** (superseded same day
  by the on-page overlay above.) User feedback:
  the side panel docks into the browser frame and shrinks the page's viewport width, which breaks
  capture/layout on responsive sites (GitHub included) — "many sites even github not allow to
  capture this way." Reverted `manifest.json` (`side_panel` key + `sidePanel` permission removed)
  and `background.js`'s `chrome.sidePanel.setPanelBehavior(...)`. The toolbar icon now has a
  `chrome.action.onClicked` listener that opens `popup/popup.html` in its own `chrome.windows.create`
  popup-type window (440×760), tracking the window id in `chrome.storage.session` so a second click
  focuses the existing window instead of opening a duplicate; `chrome.windows.onRemoved` clears the
  tracked id when the user closes it. This keeps the "doesn't close when you click the page" fix
  (a real OS-level window is independent of the page tab) without embedding into the browser UI or
  resizing the page. `popup/popup.css` body width changed from a fixed `360px` to `100%` so it
  fills the new window instead of leaving dead space.
- **2026-06-21** — **Side panel UI, screenshot annotation editor, auto-save, desktop notifications.**
  - **Side panel instead of popup:** the action now opens a persistent **side panel**
    (`manifest` `side_panel.default_path` = `popup/popup.html`, `sidePanel` permission, background
    `chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true})`; removed `action.default_popup`).
    Fixes the user's "it closes/minimizes when I click the page while it's running" — a classic
    popup-blur close. The same `popup/` files render as the side panel content unchanged.
    **This also fixes the select-area crop being lost:** the old popup unloaded the moment the user
    clicked the page to drag, abandoning the in-flight `await`. The side panel stays open.
  - **Screenshot annotation editor** (`editor/` — `editor.html/.css/.js`, classic page in its own tab):
    `✂️ Select area` → background `capture:area` crops the region, stashes it in
    `repodocs_pending_crop`, and opens the editor tab. Tools: pointer, rectangle, ellipse, arrow,
    line, free pen, text; 8 color swatches; stroke-width slider; undo/redo (Ctrl+Z / Ctrl+Shift+Z /
    Ctrl+Y) + clear. Shapes are stored as objects and re-rendered each frame onto a canvas sized to
    the crop's natural resolution (display→image coord mapping via `getBoundingClientRect`). **Done**
    flattens canvas→PNG, appends to `repodocs_gallery`, optional auto-save, closes the tab. **Copy**
    → clipboard. **Save** → `Downloads/RepoDocs/screenshots/`. The side-panel gallery live-updates via
    a `chrome.storage.onChanged` listener on `repodocs_gallery` (editor and panel are separate
    contexts, so they sync through storage, not messages).
  - **Auto-save (optional):** new section-4 toggle + subfolder field (default `RepoDocs`) persisted in
    settings. On job done, background downloads the PDF+DOCX to `Downloads/<folder>/`; every gallery
    capture and the editor's output go to `Downloads/<folder>/screenshots/` (`autosave:image`
    message; `sanitizeFolder()` strips unsafe path chars). Chrome can only target subfolders of the
    user's Downloads dir — no arbitrary folder picker exists for extensions.
  - **Desktop notifications:** `notifications` permission; background fires a `chrome.notifications`
    toast "Documentation ready ✓" on success (and a failure toast on error) so the user is told even
    if the side panel is closed/minimized.

- **2026-06-21** — **Provider overhaul + custom-area screenshot + connection status.**
  - **~20 AI providers via a catalog** (`providers.js` `PROVIDER_CATALOG`): Groq, Cerebras,
    Gemini, OpenRouter, Nvidia NIM, Together, SambaNova, Hugging Face, AI21, Cohere (free) +
    DeepSeek, Fireworks, Mistral, xAI/Grok, OpenAI, Anthropic, Perplexity, Novita, Replicate,
    Lepton (paid). Most are OpenAI-compatible `/chat/completions`; **Anthropic** uses its own
    `/v1/messages` shape (handled by `authStyle:'anthropic'` in `callEngine`). Added each host
    to `manifest.json` `host_permissions`.
  - **Key model changed** from a fixed `keys:{groq,cerebras,gemini,openrouter}` object to a
    `connections:[{providerId,key}]` array threaded through `background.js` `runJob` →
    `writeAllSections`/`writeSection` → `generateSection`/`hasAnyKey`. `buildEngineChain` now
    iterates connections × that provider's models for failover.
  - **Auto-detect + green status:** `detectProviderFromKey(key)` matches a key against each
    provider's `keyPrefix` regex (e.g. `gsk_`→Groq, `csk-`→Cerebras, `AIza`→Gemini, `sk-or-`→
    OpenRouter, `nvapi-`→Nvidia, `sk-ant-`→Anthropic, `hf_`, `xai-`, `pplx-`, `fw_`, `r8_`,
    `sk-proj-`). `testProviderKey(providerId,key)` does a tiny live request; the popup's
    **Detect** button flips a per-connection status dot idle→testing→green/red. New background
    message `provider:test`. Popup section 1 is now a dynamic list of connection rows (provider
    `<select>` grouped Free/Paid + "Auto-detect", password input, Detect, remove) with
    **+ Add provider** and a section-local **↻ Reset**. `popup.js` is now `type="module"` and
    imports `PROVIDER_CATALOG`/`detectProviderFromKey` from `providers.js`.
  - **Custom-area screenshot:** new `✂️ Select area` gallery button → background `capture:area`
    → `screenshot.js` `captureArea()` injects `selectAreaOverlay()` (dim overlay + drag-rect,
    Esc to cancel) via `chrome.scripting`, captures the visible tab, then offscreen `crop`
    (`cropToRect`, DPR-aware) returns just the selected region.
  - **PDF quality note:** the user's complaint PDF was an *old* pre-redesign build (one section
    per page, `**` literals, one screenshot per page). The shipped redesign (flowing blocks,
    bullet/`**` stripping, two-up screenshot grid) already addresses it — pending the user
    re-testing the new build. No further layout change made this round.
- **2026-06-21** — **Major redesign → focused GitHub developer-report tool.**
  - **GitHub-only:** deleted `background/website.js`, removed website mode / `isLikelyGithubInput`
    / `analyzeWebsite` / `parse-html` / `detectLiveUrl`+`liveUrl`, and dropped the
    `optional_host_permissions: <all_urls>` from the manifest. Popup now says "Point at a GitHub
    repository". Non-GitHub input gives a clear parse error.
  - **Docs-first content:** `github.js` now gathers `README.md` + up to 4 other prioritized
    `.md` docs (`getMarkdownDocs`) and feeds their excerpts + a top-level structure outline to
    the AI, instead of relying on whole-project understanding.
  - **Developer tone:** new concise, bullet-driven system prompt + per-section guides
    (`SECTION_GUIDE`), ~45–110 words/section. New section set: Project Summary, Tech Stack &
    Architecture, Key Features, Setup & Development Steps, Project Findings, Solved Gaps &
    Project Value, Conclusion.
  - **Flowing layout + screenshot grid:** the page model changed from `{cover, pages}`
    (one-section-per-page) to `{cover, blocks}` flowed by a rewritten `offscreen.js` renderer
    (`facts` / `section` / `diagram` / `gallery` block types). Bullets are detected and rendered;
    screenshots now render in a **two-up size-adjusted grid**. Same change applied to DOCX.
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
