// RepoDocs AI — MV3 service worker. Orchestrates: GitHub/website analysis -> AI writing ->
// diagram rasterization (via offscreen doc) -> PDF/DOCX assembly (via offscreen doc) -> download.
import { analyzeRepository } from './github.js';
import { analyzeWebsite, isLikelyGithubInput } from './website.js';
import { generateSection, hasAnyKey } from './providers.js';
import { buildStructureDiagram, buildMindmap } from './diagrams.js';
import { ensureOffscreen, sendToOffscreen } from './offscreen-client.js';
import { captureVisibleTab, captureFullPage, measureDataUrl, openAndCaptureUrl } from './screenshot.js';

const JOB_KEY = 'repodocs_job';
let cancelRequested = false;

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
const SECTION_SYSTEM_PROMPT = `You are a senior technical writer producing a professional documentation PDF for developers and stakeholders. Write in clear, confident, selling-but-accurate prose. No markdown headers, no code fences — short paragraphs and occasional "- " bullet lines only. Stay factual based only on the provided context; never invent features, metrics, or URLs.`;

async function writeSection(keys, label, context, onStatus) {
  const userPrompt = `Section: ${label}\n\nContext:\n${context}\n\nWrite the "${label}" section of the documentation (120-220 words).`;
  try {
    return await generateSection(keys, SECTION_SYSTEM_PROMPT, userPrompt, onStatus);
  } catch (err) {
    return `(AI writing unavailable for this section: ${err.message})`;
  }
}

async function writeAllSections(keys, labels, context) {
  const sections = {};
  for (const label of labels) {
    if (cancelRequested) throw new Error('Cancelled.');
    await setStage(`Writing "${label}" (AI)…`);
    sections[label] = await writeSection(keys, label, context, s => setStage(`${label}: ${s}`));
  }
  return sections;
}

// ---------- GitHub context ----------
function buildGithubContext(analysis) {
  const { meta, languages, manifest, readme } = analysis;
  const langs = Object.keys(languages || {}).slice(0, 6).join(', ') || 'unknown';
  return [
    `Name: ${meta.full_name || analysis.repo}`,
    `Description: ${meta.description || '(none provided)'}`,
    `Primary languages: ${langs}`,
    `Stars: ${meta.stargazers_count ?? 'n/a'}  Forks: ${meta.forks_count ?? 'n/a'}  License: ${meta.license?.name || 'unspecified'}`,
    manifest ? `Manifest (${manifest.file}):\n${manifest.content.slice(0, 1200)}` : 'No dependency manifest detected.',
    `README excerpt:\n${(readme || '').slice(0, 2500)}`,
  ].join('\n\n');
}

function deriveGithubMindmapItems(analysis) {
  const items = [];
  const langs = Object.keys(analysis.languages || {}).slice(0, 5);
  if (langs.length) items.push({ label: 'Tech Stack', children: langs });
  const topDirs = [...new Set(analysis.tree.filter(t => t.type === 'tree' && !t.path.includes('/')).map(t => t.path))].slice(0, 5);
  if (topDirs.length) items.push({ label: 'Project Modules', children: topDirs });
  if (analysis.manifest) items.push({ label: 'Dependencies', children: [analysis.manifest.file] });
  if (analysis.branches?.length) items.push({ label: 'Branches', children: analysis.branches.slice(0, 4).map(b => b.name) });
  if (analysis.liveUrl) items.push({ label: 'Live App', children: ['Deployed & reachable'] });
  items.push({ label: 'Documentation', children: ['README', 'AI-generated breakdown'] });
  items.push({ label: 'License', children: [analysis.meta.license?.name || 'Unspecified'] });
  return items;
}

const GITHUB_SECTION_LABELS = ['Executive Overview', 'Architecture & Tech Stack', 'Features & Functionality', 'Setup & Usage', 'Testing & Quality Notes', 'Conclusion & Recommendations'];

// ---------- Website context ----------
function buildWebsiteContext(site) {
  return [
    `URL: ${site.url}`,
    `Title: ${site.title || '(none)'}`,
    `Meta description: ${site.description || '(none)'}`,
    `Headings: ${site.headings.join(' | ') || '(none found)'}`,
    `Navigation links: ${site.navLinks.join(' | ') || '(none found)'}`,
    `Visible text excerpt:\n${site.textExcerpt}`,
  ].join('\n\n');
}

function deriveWebsiteMindmapItems(site) {
  const items = [];
  if (site.navLinks?.length) items.push({ label: 'Navigation', children: site.navLinks.slice(0, 6) });
  if (site.headings?.length) items.push({ label: 'Key Sections', children: site.headings.slice(0, 6) });
  items.push({ label: 'Documentation', children: ['AI-generated breakdown'] });
  return items;
}

const WEBSITE_SECTION_LABELS = ['Executive Overview', 'Purpose & Audience', 'Features & Functionality', 'Content & Navigation', 'Design & UX Notes', 'Conclusion & Recommendations'];

// ---------- page-model builders ----------
function sectionPage(title, sections) {
  return { type: 'section', title, text: sections[title] };
}
function imagePage(title, image, caption) {
  return image ? { type: 'image', title, image, caption } : null;
}

async function rasterizeDiagrams(items) {
  if (!items.length) return {};
  return sendToOffscreen('rasterize-svgs', { items });
}

function manualImagePages(manualImages) {
  return (manualImages || []).map((m, i) => ({
    type: 'image',
    title: i === 0 ? 'Screenshots & Visual Reference' : 'Screenshots & Visual Reference (cont.)',
    image: { dataUrl: m.dataUrl, width: m.width, height: m.height },
    caption: m.caption || '',
  }));
}

// ---------- main job ----------
async function runJob({ repoInput, keys, githubToken, captureScreenshot, manualImages }) {
  cancelRequested = false;
  startKeepalive();
  await setJob({ status: 'running', stage: 'Starting…', result: null, error: null, startedAt: Date.now() });

  try {
    if (!hasAnyKey(keys)) throw new Error('Add at least one free AI provider key in the popup before generating.');

    const isGithub = isLikelyGithubInput(repoInput);
    let cover, footerLabel, pages, fileBaseName;

    if (isGithub) {
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
      const sections = await writeAllSections(keys, GITHUB_SECTION_LABELS, context);

      let screenshot = null;
      if (captureScreenshot && analysis.liveUrl) {
        await setStage('Capturing live app screenshot…');
        screenshot = await openAndCaptureUrl(analysis.liveUrl, 'fullpage', s => setStage(s));
      }

      cover = { title: `${analysis.owner}/${analysis.repo}`, subtitle: analysis.meta.description, generatedLabel: `Generated by RepoDocs AI · ${new Date().toLocaleDateString()}` };
      footerLabel = `RepoDocs AI · ${analysis.owner}/${analysis.repo}`;
      fileBaseName = analysis.repo;

      pages = [
        sectionPage('Executive Overview', sections),
        sectionPage('Architecture & Tech Stack', sections),
        imagePage('Repository Structure', images.structure, 'Top-level folder & file layout (truncated for readability).'),
        sectionPage('Features & Functionality', sections),
        imagePage('Feature Mindmap', images.mindmap, 'Key capabilities derived from the codebase, manifest, and README.'),
        sectionPage('Setup & Usage', sections),
        sectionPage('Testing & Quality Notes', sections),
        imagePage('Live Application', screenshot, 'Full-page capture of the deployed app.'),
        ...manualImagePages(manualImages),
        sectionPage('Conclusion & Recommendations', sections),
      ].filter(Boolean);
    } else {
      const site = await analyzeWebsite(repoInput, stage => setStage(stage));
      if (cancelRequested) throw new Error('Cancelled.');

      await setStage('Building feature mindmap…');
      const diagramItems = [{ key: 'mindmap', title: 'Site Map & Feature Mindmap', svg: buildMindmap(new URL(site.url).hostname, deriveWebsiteMindmapItems(site)) }];
      await ensureOffscreen();
      const images = await rasterizeDiagrams(diagramItems);

      const context = buildWebsiteContext(site);
      const sections = await writeAllSections(keys, WEBSITE_SECTION_LABELS, context);

      const hostname = new URL(site.url).hostname;
      cover = { title: hostname, subtitle: site.description || site.title, generatedLabel: `Generated by RepoDocs AI · ${new Date().toLocaleDateString()}` };
      footerLabel = `RepoDocs AI · ${hostname}`;
      fileBaseName = hostname;

      pages = [
        sectionPage('Executive Overview', sections),
        sectionPage('Purpose & Audience', sections),
        imagePage('Site Map & Feature Mindmap', images.mindmap, 'Navigation and key sections detected on the page.'),
        sectionPage('Features & Functionality', sections),
        sectionPage('Content & Navigation', sections),
        sectionPage('Design & UX Notes', sections),
        imagePage('Live Page Screenshot', site.screenshot, 'Full-page capture of the live website.'),
        ...manualImagePages(manualImages),
        sectionPage('Conclusion & Recommendations', sections),
      ].filter(Boolean);
    }

    await setStage('Assembling PDF…');
    const pdfDataUrl = await sendToOffscreen('build-pdf', { cover, pages, footerLabel });

    await setStage('Assembling DOCX…');
    const docxDataUrl = await sendToOffscreen('build-docx', { cover, pages, footerLabel });

    await setJob({
      status: 'done',
      stage: 'Done',
      finishedAt: Date.now(),
      result: { repoName: fileBaseName, pdfDataUrl, docxDataUrl },
    });
  } catch (err) {
    await setJob({ status: 'error', stage: 'Failed', error: err.message, finishedAt: Date.now() });
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
  if (msg.type === 'request-screenshot-permission') {
    chrome.permissions.request({ origins: ['<all_urls>'] }, granted => sendResponse({ granted }));
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
});
