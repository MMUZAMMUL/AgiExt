// RepoDocs AI — MV3 service worker. Orchestrates: GitHub repo analysis -> AI writing ->
// diagram rasterization (via offscreen doc) -> PDF/DOCX assembly (via offscreen doc) -> download.
import { analyzeRepository } from './github.js';
import { generateSection, hasAnyKey, testProviderKey } from './providers.js';
import { buildStructureDiagram, buildMindmap } from './diagrams.js';
import { ensureOffscreen, sendToOffscreen } from './offscreen-client.js';
import { captureVisibleTab, captureFullPage, captureArea, measureDataUrl } from './screenshot.js';

const JOB_KEY = 'repodocs_job';
const SETTINGS_KEY = 'repodocs_settings';
const PENDING_CROP_KEY = 'repodocs_pending_crop';
let cancelRequested = false;

// Open the UI as its own floating browser window instead of the default action popup (which
// closes the instant it loses focus) or a side panel (which docks into the browser frame and
// shrinks the page's viewport — breaking capture/layout on responsive sites, GitHub included).
// A standalone window is independent of the page tab, so clicking back on the page never closes it.
const POPUP_WINDOW_KEY = 'repodocs_window_id';

chrome.action.onClicked.addListener(async () => {
  const { [POPUP_WINDOW_KEY]: winId } = await chrome.storage.session.get(POPUP_WINDOW_KEY);
  if (winId) {
    try {
      await chrome.windows.update(winId, { focused: true });
      return;
    } catch {
      // Window was already closed; fall through and open a new one.
    }
  }
  const win = await chrome.windows.create({
    url: chrome.runtime.getURL('popup/popup.html'),
    type: 'popup',
    width: 440,
    height: 760,
  });
  await chrome.storage.session.set({ [POPUP_WINDOW_KEY]: win.id });
});

chrome.windows.onRemoved.addListener(async closedId => {
  const { [POPUP_WINDOW_KEY]: winId } = await chrome.storage.session.get(POPUP_WINDOW_KEY);
  if (closedId === winId) await chrome.storage.session.remove(POPUP_WINDOW_KEY);
});

// Sanitizes a user-supplied folder name into a safe relative download path segment.
function sanitizeFolder(name) {
  return String(name || '')
    .replace(/[^a-zA-Z0-9 _\-\/]/g, '')
    .replace(/\.+/g, '')
    .replace(/\/+/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .trim();
}

async function getSettings() {
  const { [SETTINGS_KEY]: s } = await chrome.storage.local.get(SETTINGS_KEY);
  return s || {};
}

function downloadDataUrl(url, filename) {
  return new Promise(resolve => {
    chrome.downloads.download({ url, filename, saveAs: false }, () => resolve(!chrome.runtime.lastError));
  });
}

function notify(title, message) {
  try {
    chrome.notifications.create('', {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title,
      message,
      priority: 2,
    });
  } catch { /* notifications may be unavailable; ignore */ }
}

async function getJob() {
  const { [JOB_KEY]: job } = await chrome.storage.local.get(JOB_KEY);
  return job || { status: 'idle', stage: '', result: null, error: null };
}

async function setJob(patch) {
  const job = await getJob();
  const next = { ...job, ...patch };
  await chrome.storage.local.set({ [JOB_KEY]: next });
  chrome.runtime.sendMessage({ target: 'popup', type: 'job:update', job: next }).catch(() => {});
  return next;
}

async function setStage(stage) {
  await setJob({ stage });
}

// ---------- keepalive ----------
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'repodocs-keepalive') chrome.storage.local.get('noop');
});
function startKeepalive() {
  chrome.alarms.create('repodocs-keepalive', { periodInMinutes: 0.5 });
}
function stopKeepalive() {
  chrome.alarms.clear('repodocs-keepalive');
}

// ---------- AI section writing ----------
// Developer-facing tone: tight, scannable, bullet-driven — NOT academic prose.
const SECTION_SYSTEM_PROMPT = `You are a senior software engineer writing a concise, professional project report for other developers. Be direct, technical, and factual based ONLY on the provided context (README and other .md docs, languages, file structure, and dependency manifest). Never invent features, numbers, URLs, or capabilities not present in the context. Style rules: NO markdown headers, NO code fences, NO bold/asterisks. Prefer short "- " bullet points over paragraphs. Keep sentences short. Be specific (name real tools, files, commands found in the context) rather than generic.`;

// Per-section guidance keeps each part short and developer-oriented.
const SECTION_GUIDE = {
  'Project Summary': 'In 2-3 short sentences then 2-3 bullets: what this project is, who it is for, and the core problem it solves.',
  'Tech Stack & Architecture': 'Bullet list of the languages, frameworks, and notable dependencies, and one line on how the codebase is organized.',
  'Key Features': '4-7 bullets, each a concrete capability stated plainly.',
  'Setup & Development Steps': 'Numbered-style "- " bullets of the steps a developer takes to install, configure, and run it, based on the README. Mention real commands/files if present.',
  'Project Findings': '3-5 bullets of objective observations about code quality, structure, docs, testing, and maturity — only what the context supports.',
  'Solved Gaps & Project Value': '3-5 bullets: what problems this solves, what gaps it fills, and its practical value.',
  'Conclusion': '2-3 sentences: a balanced wrap-up and who should use it.',
};

async function writeSection(connections, label, context, onStatus) {
  const guide = SECTION_GUIDE[label] || 'Write this section concisely.';
  const userPrompt = `Context:\n${context}\n\nWrite ONLY the "${label}" section (about 45-110 words). ${guide}`;
  try {
    return await generateSection(connections, SECTION_SYSTEM_PROMPT, userPrompt, onStatus);
  } catch (err) {
    return `(AI writing unavailable for this section: ${err.message})`;
  }
}

async function writeAllSections(connections, labels, context) {
  const sections = {};
  for (const label of labels) {
    if (cancelRequested) throw new Error('Cancelled.');
    await setStage(`Writing "${label}" (AI)…`);
    sections[label] = await writeSection(connections, label, context, s => setStage(`${label}: ${s}`));
  }
  return sections;
}

// ---------- GitHub context ----------
// A short top-level structure outline so the AI can speak accurately about layout.
function topLevelOutline(tree) {
  const dirs = [...new Set(tree.filter(t => t.type === 'tree' && !t.path.includes('/')).map(t => t.path))];
  const files = tree.filter(t => t.type === 'blob' && !t.path.includes('/')).map(t => t.path);
  const parts = [];
  if (dirs.length) parts.push('Top-level folders: ' + dirs.slice(0, 12).join(', '));
  if (files.length) parts.push('Top-level files: ' + files.slice(0, 12).join(', '));
  return parts.join('\n') || '(structure unavailable)';
}

function buildGithubContext(analysis) {
  const { meta, languages, manifest, readme, docs } = analysis;
  const langs = Object.keys(languages || {}).slice(0, 6).join(', ') || 'unknown';
  const docExcerpts = (docs || [])
    .map(d => `--- ${d.path} ---\n${d.excerpt}`)
    .join('\n\n') || '(no additional .md docs found)';
  return [
    `Name: ${meta.full_name || analysis.repo}`,
    `Description: ${meta.description || '(none provided)'}`,
    `Primary languages: ${langs}`,
    `Stars: ${meta.stargazers_count ?? 'n/a'}  Forks: ${meta.forks_count ?? 'n/a'}  License: ${meta.license?.name || 'unspecified'}`,
    topLevelOutline(analysis.tree || []),
    manifest ? `Dependency manifest (${manifest.file}):\n${manifest.content.slice(0, 1200)}` : 'No dependency manifest detected.',
    `README:\n${(readme || '(no README found)').slice(0, 3500)}`,
    `Other project docs (.md files):\n${docExcerpts.slice(0, 4000)}`,
  ].join('\n\n');
}

function deriveGithubMindmapItems(analysis) {
  const items = [];
  const langs = Object.keys(analysis.languages || {}).slice(0, 5);
  if (langs.length) items.push({ label: 'Tech Stack', children: langs });
  const topDirs = [...new Set(analysis.tree.filter(t => t.type === 'tree' && !t.path.includes('/')).map(t => t.path))].slice(0, 5);
  if (topDirs.length) items.push({ label: 'Project Modules', children: topDirs });
  if (analysis.manifest) items.push({ label: 'Dependencies', children: [analysis.manifest.file] });
  if (analysis.docs?.length) items.push({ label: 'Docs', children: ['README', ...analysis.docs.slice(0, 3).map(d => d.path)] });
  if (analysis.branches?.length) items.push({ label: 'Branches', children: analysis.branches.slice(0, 4).map(b => b.name) });
  items.push({ label: 'License', children: [analysis.meta.license?.name || 'Unspecified'] });
  return items;
}

const GITHUB_SECTION_LABELS = [
  'Project Summary',
  'Tech Stack & Architecture',
  'Key Features',
  'Setup & Development Steps',
  'Project Findings',
  'Solved Gaps & Project Value',
  'Conclusion',
];

// ---------- page-model (block) builders ----------
// The document is a flat list of blocks the offscreen renderer flows onto pages:
//   { type:'facts',  items:[[label,value],…] }
//   { type:'section', title, text }
//   { type:'diagram', title, image:{dataUrl,width,height}, caption }
//   { type:'gallery', title, images:[{dataUrl,width,height,caption}] }
function sectionBlock(title, sections) {
  return { type: 'section', title, text: sections[title] || '' };
}
function diagramBlock(title, image, caption) {
  return image ? { type: 'diagram', title, image, caption } : null;
}

async function rasterizeDiagrams(items) {
  if (!items.length) return {};
  return sendToOffscreen('rasterize-svgs', { items });
}

function galleryBlock(manualImages) {
  const imgs = (manualImages || []).map(m => ({ dataUrl: m.dataUrl, width: m.width, height: m.height, caption: m.caption || '' }));
  return imgs.length ? { type: 'gallery', title: 'Screenshots & Visual Reference', images: imgs } : null;
}

// ---------- main job ----------
async function runJob({ repoInput, connections, githubToken, manualImages }) {
  cancelRequested = false;
  startKeepalive();
  await setJob({ status: 'running', stage: 'Starting…', result: null, error: null, startedAt: Date.now() });

  try {
    if (!hasAnyKey(connections)) throw new Error('Add at least one free AI provider key in the popup before generating.');

    const analysis = await analyzeRepository(repoInput, githubToken, stage => setStage(stage));
    if (cancelRequested) throw new Error('Cancelled.');

    await setStage('Building diagrams…');
    const diagramItems = [
      { key: 'structure', title: 'Repository Structure', svg: buildStructureDiagram(analysis.tree, analysis.repo) },
      { key: 'mindmap', title: 'Feature Mindmap', svg: buildMindmap(analysis.repo, deriveGithubMindmapItems(analysis)) },
    ];
    await ensureOffscreen();
    const images = await rasterizeDiagrams(diagramItems);

    const context = buildGithubContext(analysis);
    const sections = await writeAllSections(connections, GITHUB_SECTION_LABELS, context);

    const cover = {
      title: `${analysis.owner}/${analysis.repo}`,
      subtitle: analysis.meta.description,
      generatedLabel: `Developer Project Report · ${new Date().toLocaleDateString()}`,
    };
    const footerLabel = `RepoDocs AI · ${analysis.owner}/${analysis.repo}`;
    const fileBaseName = analysis.repo;

    const facts = [
      ['Repository', `${analysis.owner}/${analysis.repo}`],
      ['Languages', Object.keys(analysis.languages || {}).slice(0, 4).join(', ') || 'n/a'],
      ['Stars', String(analysis.meta.stargazers_count ?? 'n/a')],
      ['Forks', String(analysis.meta.forks_count ?? 'n/a')],
      ['License', analysis.meta.license?.name || 'Unspecified'],
      ['Default branch', analysis.meta.default_branch || 'n/a'],
    ];

    // Block order: a tight, summary-first layout (facts + summary + stack + features), then the
    // diagrams, then the remaining developer findings, then the screenshot gallery.
    const blocks = [
      { type: 'facts', items: facts },
      sectionBlock('Project Summary', sections),
      sectionBlock('Tech Stack & Architecture', sections),
      sectionBlock('Key Features', sections),
      diagramBlock('Repository Structure', images.structure, 'Top-level folder & file layout (truncated for readability).'),
      diagramBlock('Feature Mindmap', images.mindmap, 'Key capabilities derived from the docs, manifest, and structure.'),
      sectionBlock('Setup & Development Steps', sections),
      sectionBlock('Project Findings', sections),
      sectionBlock('Solved Gaps & Project Value', sections),
      sectionBlock('Conclusion', sections),
      galleryBlock(manualImages),
    ].filter(Boolean);

    await setStage('Assembling PDF…');
    const pdfDataUrl = await sendToOffscreen('build-pdf', { cover, blocks, footerLabel });

    await setStage('Assembling DOCX…');
    const docxDataUrl = await sendToOffscreen('build-docx', { cover, blocks, footerLabel });

    await setJob({
      status: 'done',
      stage: 'Done',
      finishedAt: Date.now(),
      result: { repoName: fileBaseName, pdfDataUrl, docxDataUrl },
    });

    // Optional auto-save of the finished report into a Downloads subfolder.
    const settings = await getSettings();
    if (settings.autoSave) {
      const folder = sanitizeFolder(settings.autoSaveFolder || 'RepoDocs') || 'RepoDocs';
      await downloadDataUrl(pdfDataUrl, `${folder}/${fileBaseName}-documentation.pdf`);
      await downloadDataUrl(docxDataUrl, `${folder}/${fileBaseName}-documentation.docx`);
    }

    // Desktop notification so the user sees it even if the side panel is closed/minimized.
    notify('Documentation ready ✓', `${fileBaseName} — your PDF and Word report are ready to download.`);
  } catch (err) {
    await setJob({ status: 'error', stage: 'Failed', error: err.message, finishedAt: Date.now() });
    if (err.message !== 'Cancelled.') notify('Documentation failed', err.message);
  } finally {
    stopKeepalive();
  }
}

// ---------- popup-triggered manual capture ----------
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) throw new Error('No active tab found.');
  return tab;
}

// ---------- message router ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target !== 'background') return;

  if (msg.type === 'job:start') {
    runJob(msg.payload);
    sendResponse({ ok: true });
    return;
  }
  if (msg.type === 'job:status') {
    getJob().then(sendResponse);
    return true;
  }
  if (msg.type === 'job:cancel') {
    cancelRequested = true;
    sendResponse({ ok: true });
    return;
  }
  if (msg.type === 'download') {
    chrome.downloads.download({ url: msg.payload.url, filename: msg.payload.filename, saveAs: false }, () => {
      sendResponse({ ok: !chrome.runtime.lastError, error: chrome.runtime.lastError?.message });
    });
    return true;
  }
  if (msg.type === 'capture:visible') {
    (async () => {
      try {
        const tab = await getActiveTab();
        const dataUrl = await captureVisibleTab(tab.windowId);
        sendResponse({ result: await measureDataUrl(dataUrl) });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }
  if (msg.type === 'capture:fullpage') {
    (async () => {
      try {
        const tab = await getActiveTab();
        const result = await captureFullPage(tab.id, tab.windowId, stage => {
          chrome.runtime.sendMessage({ target: 'popup', type: 'capture:progress', stage }).catch(() => {});
        });
        sendResponse({ result });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }
  if (msg.type === 'capture:area') {
    (async () => {
      try {
        const tab = await getActiveTab();
        const result = await captureArea(tab.id, tab.windowId);
        // Stash the crop and open the full-size annotation editor in its own tab.
        await chrome.storage.local.set({ [PENDING_CROP_KEY]: result });
        await chrome.tabs.create({ url: chrome.runtime.getURL('editor/editor.html') });
        sendResponse({ result, opened: true });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }
  // The editor (its own page) asks the background to save its annotated PNG to disk.
  if (msg.type === 'autosave:image') {
    (async () => {
      const settings = await getSettings();
      if (!settings.autoSave) return sendResponse({ ok: false, skipped: true });
      const folder = sanitizeFolder(settings.autoSaveFolder || 'RepoDocs') || 'RepoDocs';
      const ok = await downloadDataUrl(msg.payload.url, `${folder}/screenshots/${msg.payload.name}`);
      sendResponse({ ok });
    })();
    return true;
  }
  if (msg.type === 'provider:test') {
    testProviderKey(msg.payload.providerId, msg.payload.key).then(sendResponse);
    return true;
  }
});
