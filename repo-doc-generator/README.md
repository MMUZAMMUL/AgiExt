# RepoDocs AI — Project Documentation Generator

A browser extension (Manifest V3 — Chrome, Edge, Brave, and other Chromium browsers) that
points at any public GitHub repository **or any website URL** and generates a professional,
5–10 page **PDF and DOCX** document: an executive overview, architecture/feature breakdown, a
repository structure diagram or site map, a feature mindmap, setup/usage or UX notes, an
optional live screenshot, your own manually captured or uploaded screenshots, and a
conclusion — all written by an AI model using *your own* free API key, and assembled entirely
client-side in your browser. Nothing is uploaded to any server.

## Install (unpacked, developer mode)

1. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`).
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select this folder (`extensions/repo-doc-generator`).
4. Pin the extension and click its icon to open the popup.

> Firefox: Manifest V3 service workers and the `chrome.offscreen` API used here are Chromium-specific.
> A Firefox build would need a background page instead of a service worker and a different
> rasterization approach — not included in this v1.

## Get a free AI provider key

You only need **one**:

| Provider | Free tier | Get a key |
|---|---|---|
| Groq | Yes, generous free tier | https://console.groq.com/keys |
| Cerebras | Yes | https://cloud.cerebras.ai/ |
| Google Gemini | Yes | https://aistudio.google.com/apikey |
| OpenRouter | Free models available | https://openrouter.ai/keys |

Paste it into the popup's "Connect a free AI provider" section. The key is stored only in
`chrome.storage.local` on your machine and is sent only to that provider's own API — never to
any third-party server.

## Using it

1. Add a provider key.
2. Under "Point at a repository or website," paste a GitHub repo URL, `owner/repo` shorthand,
   or any other website URL — the extension detects which it is automatically.
3. (Optional, GitHub only) Add a GitHub personal access token if you're documenting a large
   repo — this raises GitHub's API rate limit from 60 to 5,000 requests/hour and avoids
   rate-limit errors.
4. (Optional, GitHub only) Check "Try to capture a screenshot of the live app" if the repo
   links to a live deployment. This requests a one-time browser permission and briefly
   opens/closes a tab. For website URLs, a full-page screenshot of the site itself is always
   captured automatically.
5. (Optional) Add your own screenshots under "Screenshots & images" — see below.
6. Click **Generate Documentation**. A progress view shows the current stage and an elapsed
   timer — full analysis typically takes a few minutes.
7. When done, click **Download PDF** and/or **Download DOCX**.

### Screenshots & images

The "Screenshots & images" card lets you add pictures that get embedded in a "Screenshots &
Visual Reference" section of the generated document, in addition to (or instead of) the
automatic live-app/site screenshot:

- **📷 Visible tab** — captures exactly what's visible in your current browser tab.
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
  README, and a dependency manifest (`package.json`, `requirements.txt`, etc.) via the GitHub
  REST API.
- `background/website.js` — for non-GitHub input: fetches the page HTML (via the optional
  `<all_urls>` permission) and hands it to the offscreen document for `DOMParser`-based
  extraction of title, description, headings, and navigation links.
- `background/screenshot.js` — visible-tab capture, full-page scroll-and-stitch capture, and
  capturing an arbitrary URL in a throwaway tab (used for the optional live-app/site
  screenshot).
- `background/diagrams.js` — builds SVG diagrams: a folder/file structure tree (GitHub) or a
  radial feature mindmap derived from the detected languages, top-level modules, branches/nav
  links, and manifest.
- `background/providers.js` — sends the gathered context to your chosen AI provider (with
  automatic failover across Groq → Cerebras → Gemini → OpenRouter if you've added more than
  one key) to write each documentation section.
- `offscreen/` — an MV3 offscreen document (the only context with a real DOM available to a
  service worker) rasterizes SVG diagrams to PNG, stitches full-page screenshot slices, parses
  website HTML, and assembles the final PDF (via vendored `jsPDF`) and DOCX (via vendored
  `docx.js`) from a generic `{cover, pages, footerLabel}` model — entirely in-browser.
- `popup/` — the UI: provider keys, repo/website input, the screenshot/upload gallery, live
  progress, and download buttons. Job and gallery state are persisted to
  `chrome.storage.local` so they survive closing and reopening the popup. Window/Screen
  capture and clipboard-copy run directly in the popup's own DOM (rather than the background
  service worker), since `getUserMedia`/`<video>`/`<canvas>` and the Clipboard API need a real
  page context tied to a user gesture.

## Known limitations

- Very large repositories (tens of thousands of files) will produce a truncated structure
  diagram and may need a GitHub token to avoid rate limiting.
- The live-app/site screenshot is best-effort: it requires the optional `<all_urls>`
  permission, briefly opens the target tab, and silently skips if the page doesn't finish
  loading in time.
- Private repositories require a GitHub token with appropriate access scopes.
- Window/Screen capture requires picking a source in Chrome's native picker each time — Chrome
  does not allow extensions to remember a previous selection.
- This is built for Chromium-based browsers; Firefox support would need a separate
  background-page build (no `chrome.offscreen`/`chrome.desktopCapture` equivalent).
