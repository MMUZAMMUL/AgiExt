# RepoDocs AI — Project Documentation Generator

A browser extension (Manifest V3 — Chrome, Edge, Brave, and other Chromium browsers) that
points at any public **GitHub repository** and generates a clean, professional **developer
project report** as **PDF and DOCX**. The report is concise and bullet-driven (not academic
prose): a facts strip, project summary, tech stack & architecture, key features, a repository
structure diagram, a feature mindmap, setup/development steps, project findings, solved gaps &
project value, a conclusion, and your own screenshots laid out in an organized grid.

It reads the project mainly from its **`README.md` and other `.md` docs** (plus languages, file
structure, and the dependency manifest) — the places a project actually explains itself — rather
than trying to understand every source file. Everything is written by an AI model using *your
own* free API key and assembled entirely client-side in your browser. Nothing is uploaded to any
server.

## Install (unpacked, developer mode)

1. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`).
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select this folder (`extensions/repo-doc-generator`).
4. Pin the extension and click its icon to open it in its **own floating window** (it stays open
   while you work, including while a report is generating, and won't close when you click back on
   the page — unlike the default popup. Unlike a side panel, it also doesn't dock into the browser
   frame, so it won't shrink the page's viewport and break capture/layout on sites like GitHub).

> Firefox: Manifest V3 service workers and the `chrome.offscreen` API used here are Chromium-specific.
> A Firefox build would need a background page instead of a service worker and a different
> rasterization approach — not included in this v1.

## Get a free AI provider key

You only need **one**. The popup ships with a dropdown of ~20 providers — free and paid — plus
an **auto-detect** mode: paste a key, click **Detect**, and the extension figures out which
provider it belongs to (from the key's format), tests it, and turns the status dot **green**
when it connects. A few of the free options:

| Provider | Free tier | Get a key |
|---|---|---|
| Groq | Yes, generous free tier | https://console.groq.com/keys |
| Cerebras | Yes | https://cloud.cerebras.ai/ |
| Google Gemini | Yes | https://aistudio.google.com/apikey |
| OpenRouter | Free models available | https://openrouter.ai/keys |
| Nvidia NIM | Free credits | https://build.nvidia.com/ |
| Together / SambaNova / Hugging Face / AI21 / Cohere | Free tiers | (see the dropdown) |

Paid providers (DeepSeek, OpenAI, Anthropic, Mistral, xAI/Grok, Fireworks, Perplexity, and
more) are in the same dropdown. Add as many as you like with **+ Add provider** — they form a
failover chain (if one is busy/rate-limited the next is tried), and **↻ Reset** clears them.
Keys are stored only in `chrome.storage.local` on your machine and are sent only to that
provider's own API — never to any third-party server.

## Using it

1. Add a provider key: pick a provider (or leave it on "Auto-detect"), paste your key, and click
   **Detect** until the dot turns green.
2. Under "Point at a GitHub repository," paste a GitHub repo URL or `owner/repo` shorthand.
3. (Optional) Add a GitHub personal access token if you're documenting a large repo — this
   raises GitHub's API rate limit from 60 to 5,000 requests/hour and avoids rate-limit errors.
4. (Optional) Add your own screenshots under "Screenshots & images" — see below. They're placed
   in an organized two-up grid (multiple per page), not one per page.
5. (Optional) Under **Auto-save**, tick the box and set a subfolder name to have captures and the
   finished PDF/DOCX automatically saved into `Downloads/<that folder>/`.
6. Click **Generate Documentation**. A progress view shows the current stage and an elapsed timer.
   When it finishes you also get a **desktop notification** ("Documentation ready ✓") even if the
   window is closed or minimized.
7. When done, click **⬇️ Download PDF file** and/or **⬇️ Download Word file (.docx)**.

Use the **↻ Reset** button in the header at any time to cancel and start a new document (your
keys, repo, and screenshots are kept).

> GitHub-only by design: arbitrary website URLs are not supported — different sites break in
> different ways, so the tool stays focused on analyzing GitHub repositories well.

### Screenshots & images

The "Screenshots & images" card lets you add pictures that get embedded in a "Screenshots &
Visual Reference" section of the generated document:

- **📷 Visible tab** — captures exactly what's visible in your current browser tab.
- **✂️ Select area** — dims the page and lets you drag a rectangle over any region; the crop opens
  in a full-size **annotation editor** in its own tab where you can draw rectangles, circles,
  arrows, lines, free-hand strokes and text in your choice of colors (with undo/redo and clear).
  Click **Done** to add it to the gallery, **Copy** to put it on the clipboard, or **Save** to write
  a PNG to disk. (Press Esc during selection to cancel.)
- **📜 Full page** — scrolls the current tab from top to bottom and stitches the slices into
  one tall image, capturing the entire page even if it's longer than your screen.
- **🖥️ Window/Screen** — opens Chrome's native picker (`chrome.desktopCapture`) so you can
  capture any open window, an entire screen, or another browser tab — useful for capturing a
  native app, a different program, or a second monitor.
- **⬆️ Upload** — pick one or more image files from your computer.

Every captured or uploaded image appears in a gallery where you can edit its caption, **copy
it to the clipboard** (📋), **download it to your computer** (⬇️), or remove it (🗑️) before
generating the document. The gallery persists across popup opens/closes until you remove an
item or it's bundled into a finished document.

## How it works

- `background/github.js` — fetches repo metadata, branches, languages, the full file tree,
  `README.md`, a handful of other `.md` docs (architecture/usage/contributing/etc.), and a
  dependency manifest (`package.json`, `requirements.txt`, etc.) via the GitHub REST API.
- `background/screenshot.js` — visible-tab capture, drag-to-select region capture (overlay +
  crop), and full-page scroll-and-stitch capture for the "Screenshots & images" gallery.
- `editor/` — a full-size screenshot annotation editor (its own tab) opened after a select-area
  crop: canvas-based rectangle/ellipse/arrow/line/pen/text tools with colors, undo/redo, and
  Done (→ gallery) / Copy / Save actions.
- `background/diagrams.js` — builds SVG diagrams: a folder/file structure tree and a radial
  feature mindmap derived from the detected languages, top-level modules, docs, branches, and
  manifest.
- `background/providers.js` — a catalog of ~20 AI providers (free + paid; most OpenAI-compatible,
  Anthropic handled as a special case), key-format auto-detection, a `testProviderKey` health
  check for the popup's green "connected" status, and an automatic failover chain across every
  configured key/model to write each report section in a concise, developer-facing tone.
- `offscreen/` — an MV3 offscreen document (the only context with a real DOM available to a
  service worker) rasterizes SVG diagrams to PNG, stitches full-page screenshot slices, and
  assembles the final PDF (via vendored `jsPDF`) and DOCX (via vendored `docx.js`) from a
  flowing list of content **blocks** (`facts` / `section` / `diagram` / `gallery`) — entirely
  in-browser. Sections flow onto pages and screenshots render in a two-up grid.
- `popup/` — the UI, opened as its **own floating browser window** (`chrome.windows.create`, type
  `popup`) rather than the default action popup (closes the instant you click the page) or a side
  panel (docks into the browser frame and shrinks the page's viewport, breaking capture/layout on
  some sites): provider connections with detect/green-status, repo input, the screenshot/upload
  gallery, auto-save settings, a header **↻ Reset**, live progress, and the two download buttons.
  Job and gallery state are persisted to `chrome.storage.local` so they survive reopening, and the
  gallery live-syncs (via `chrome.storage.onChanged`) when the annotation editor adds an image.
  Window/Screen capture and clipboard-copy run directly in the window's own DOM (rather than the
  background service worker), since `getUserMedia`/`<video>`/`<canvas>` and the Clipboard API need
  a real page context tied to a user gesture.
- Auto-save (optional) writes captures and the finished report into a `Downloads/<folder>`
  subfolder, and a desktop notification fires when generation completes.

## Known limitations

- Very large repositories (tens of thousands of files) will produce a truncated structure
  diagram and may need a GitHub token to avoid rate limiting.
- GitHub-only: arbitrary website URLs are intentionally not supported.
- There is no automatic live-app screenshot — add screenshots manually via the
  "Screenshots & images" gallery.
- Report quality depends on the repo's docs: projects with a thin or missing `README.md` and no
  other `.md` files give the AI less to work with.
- Private repositories require a GitHub token with appropriate access scopes.
- Window/Screen capture requires picking a source in Chrome's native picker each time — Chrome
  does not allow extensions to remember a previous selection.
- This is built for Chromium-based browsers; Firefox support would need a separate
  background-page build (no `chrome.offscreen`/`chrome.desktopCapture` equivalent).
