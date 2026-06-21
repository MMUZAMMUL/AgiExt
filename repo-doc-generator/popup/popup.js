// RepoDocs AI — popup UI logic. ES module (so it can import the provider catalog), no build step.

import { PROVIDER_CATALOG, detectProviderFromKey } from '../background/providers.js';

const SETTINGS_KEY = 'repodocs_settings';
const GALLERY_KEY = 'repodocs_gallery';

const els = {
  setupView: document.getElementById('setup-view'),
  progressView: document.getElementById('progress-view'),
  doneView: document.getElementById('done-view'),
  errorView: document.getElementById('error-view'),

  connections: document.getElementById('connections'),
  addConnectionBtn: document.getElementById('add-connection-btn'),
  resetConnectionsBtn: document.getElementById('reset-connections-btn'),

  repoInput: document.getElementById('repo-input'),
  githubToken: document.getElementById('github-token'),
  generateBtn: document.getElementById('generate-btn'),
  setupError: document.getElementById('setup-error'),

  captureVisibleBtn: document.getElementById('capture-visible-btn'),
  captureAreaBtn: document.getElementById('capture-area-btn'),
  captureFullpageBtn: document.getElementById('capture-fullpage-btn'),
  captureWindowBtn: document.getElementById('capture-window-btn'),
  uploadImagesBtn: document.getElementById('upload-images-btn'),
  uploadImagesInput: document.getElementById('upload-images-input'),
  captureStatus: document.getElementById('capture-status'),
  gallery: document.getElementById('gallery'),

  progressRepo: document.getElementById('progress-repo'),
  progressStage: document.getElementById('progress-stage'),
  progressTimer: document.getElementById('progress-timer'),
  cancelBtn: document.getElementById('cancel-btn'),

  doneRepo: document.getElementById('done-repo'),
  downloadPdfBtn: document.getElementById('download-pdf-btn'),
  downloadDocxBtn: document.getElementById('download-docx-btn'),
  newJobBtn: document.getElementById('new-job-btn'),

  errorMessage: document.getElementById('error-message'),
  retryBtn: document.getElementById('retry-btn'),

  resetBtn: document.getElementById('reset-btn'),
};

let timerInterval = null;
let currentResult = null;
let currentRepoLabel = '';
let gallery = [];
let captureBusy = false;

function showView(name) {
  els.setupView.hidden = name !== 'setup';
  els.progressView.hidden = name !== 'progress';
  els.doneView.hidden = name !== 'done';
  els.errorView.hidden = name !== 'error';
}

// ---------- provider connections (AI keys) ----------
let connections = [];
let connSeq = 0;
function newConnection() {
  return { id: `c${++connSeq}`, providerId: '', key: '', status: 'idle', error: '' };
}

function providerOptionsHtml(selectedId) {
  const free = PROVIDER_CATALOG.filter(p => p.free);
  const paid = PROVIDER_CATALOG.filter(p => !p.free);
  const opt = p => `<option value="${p.id}" ${p.id === selectedId ? 'selected' : ''}>${p.label}</option>`;
  return `
    <option value="">Auto-detect from key…</option>
    <optgroup label="Free">${free.map(opt).join('')}</optgroup>
    <optgroup label="Paid">${paid.map(opt).join('')}</optgroup>
  `;
}

function statusBadgeHtml(conn) {
  if (conn.status === 'connected') return `<span class="status-dot status-green" title="Connected"></span><span class="status-text status-green">Connected</span>`;
  if (conn.status === 'testing') return `<span class="status-dot status-yellow" title="Testing…"></span><span class="status-text">Testing…</span>`;
  if (conn.status === 'error') return `<span class="status-dot status-red" title="${(conn.error || 'Error').replace(/"/g, '&quot;')}"></span><span class="status-text status-red">${conn.error || 'Failed'}</span>`;
  return `<span class="status-dot" title="Not tested"></span><span class="status-text">Not connected</span>`;
}

function renderConnections() {
  els.connections.innerHTML = connections.map(conn => {
    const provider = PROVIDER_CATALOG.find(p => p.id === conn.providerId);
    const placeholder = provider?.placeholder || 'Paste API key…';
    return `
      <div class="conn-row" data-id="${conn.id}">
        <div class="conn-row-top">
          <select class="conn-select" data-action="provider" data-id="${conn.id}">${providerOptionsHtml(conn.providerId)}</select>
          ${connections.length > 1 ? `<button type="button" class="icon-btn remove" data-action="remove" data-id="${conn.id}" title="Remove">🗑️</button>` : ''}
        </div>
        <div class="conn-row-bottom">
          <input type="password" class="conn-key" data-action="key" data-id="${conn.id}" placeholder="${placeholder}" autocomplete="off" value="${(conn.key || '').replace(/"/g, '&quot;')}" />
          <button type="button" class="chip-btn detect-btn" data-action="detect" data-id="${conn.id}">Detect</button>
        </div>
        <div class="conn-status">${statusBadgeHtml(conn)}</div>
      </div>
    `;
  }).join('');
}

function persistConnections() {
  return chrome.storage.local.set({ [SETTINGS_KEY]: { ...currentNonConnSettings(), connections } });
}

function currentNonConnSettings() {
  return { repoInput: els.repoInput.value.trim(), githubToken: els.githubToken.value.trim() };
}

els.connections.addEventListener('change', e => {
  const select = e.target.closest('[data-action="provider"]');
  if (!select) return;
  const conn = connections.find(c => c.id === select.dataset.id);
  if (!conn) return;
  conn.providerId = select.value;
  conn.status = 'idle';
  conn.error = '';
  renderConnections();
  persistConnections();
});

els.connections.addEventListener('input', e => {
  const input = e.target.closest('[data-action="key"]');
  if (!input) return;
  const conn = connections.find(c => c.id === input.dataset.id);
  if (!conn) return;
  conn.key = input.value;
  if (conn.status !== 'idle') {
    conn.status = 'idle';
    conn.error = '';
    const badge = els.connections.querySelector(`.conn-row[data-id="${conn.id}"] .conn-status`);
    if (badge) badge.innerHTML = statusBadgeHtml(conn);
  }
  persistConnections();
});

els.connections.addEventListener('click', async e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const conn = connections.find(c => c.id === btn.dataset.id);
  if (!conn) return;

  if (btn.dataset.action === 'remove') {
    connections = connections.filter(c => c.id !== conn.id);
    renderConnections();
    await persistConnections();
    return;
  }
  if (btn.dataset.action === 'detect') {
    const key = conn.key.trim();
    if (!key) {
      conn.status = 'error';
      conn.error = 'Paste a key first.';
      renderConnections();
      return;
    }
    let providerId = conn.providerId;
    if (!providerId) {
      providerId = detectProviderFromKey(key);
      if (!providerId) {
        conn.status = 'error';
        conn.error = "Couldn't auto-detect — pick a provider above.";
        renderConnections();
        return;
      }
      conn.providerId = providerId;
    }
    conn.status = 'testing';
    conn.error = '';
    renderConnections();
    const res = await sendToBackground('provider:test', { providerId, key });
    if (res?.ok) {
      conn.status = 'connected';
      conn.error = '';
    } else {
      conn.status = 'error';
      conn.error = res?.error || 'Connection failed.';
    }
    renderConnections();
    await persistConnections();
  }
});

els.addConnectionBtn.addEventListener('click', () => {
  connections.push(newConnection());
  renderConnections();
  persistConnections();
});

els.resetConnectionsBtn.addEventListener('click', () => {
  connections = [newConnection()];
  renderConnections();
  persistConnections();
});

function hasAnyConfiguredKey() {
  return connections.some(c => c.providerId && c.key.trim());
}

// ---------- settings (repo/token) ----------
async function saveSettings() {
  await chrome.storage.local.set({ [SETTINGS_KEY]: { ...currentNonConnSettings(), connections } });
}

async function loadSettings() {
  const { [SETTINGS_KEY]: s } = await chrome.storage.local.get(SETTINGS_KEY);
  els.repoInput.value = s?.repoInput || '';
  els.githubToken.value = s?.githubToken || '';
  connections = Array.isArray(s?.connections) && s.connections.length
    ? s.connections.map(c => ({ ...newConnection(), ...c, status: c.status === 'connected' ? 'connected' : 'idle', error: '' }))
    : [newConnection()];
  renderConnections();
}

function sendToBackground(type, payload) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ target: 'background', type, payload }, resolve);
  });
}

function startTimer(startedAt) {
  stopTimer();
  function tick() {
    const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    const m = Math.floor(elapsed / 60);
    const s = elapsed % 60;
    els.progressTimer.textContent = `${m}:${String(s).padStart(2, '0')}`;
  }
  tick();
  timerInterval = setInterval(tick, 1000);
}
function stopTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
}

function renderJob(job) {
  if (!job || job.status === 'idle') {
    stopTimer();
    showView('setup');
    return;
  }
  if (job.status === 'running') {
    showView('progress');
    els.progressRepo.textContent = currentRepoLabel ? `(${currentRepoLabel})` : '';
    els.progressStage.textContent = job.stage || 'Working…';
    if (job.startedAt) startTimer(job.startedAt);
    return;
  }
  if (job.status === 'done') {
    stopTimer();
    showView('done');
    currentResult = job.result;
    els.doneRepo.textContent = job.result?.repoName ? `${job.result.repoName} — ready to download.` : 'Ready to download.';
    return;
  }
  if (job.status === 'error') {
    stopTimer();
    showView('error');
    els.errorMessage.textContent = job.error || 'Unknown error.';
  }
}

// ---------- gallery (manual + captured screenshots) ----------
function setCaptureStatus(text) {
  if (!text) {
    els.captureStatus.hidden = true;
    els.captureStatus.textContent = '';
    return;
  }
  els.captureStatus.hidden = false;
  els.captureStatus.textContent = text;
}

function setCaptureButtonsDisabled(disabled) {
  captureBusy = disabled;
  els.captureVisibleBtn.disabled = disabled;
  els.captureAreaBtn.disabled = disabled;
  els.captureFullpageBtn.disabled = disabled;
  els.captureWindowBtn.disabled = disabled;
  els.uploadImagesBtn.disabled = disabled;
}

function persistGallery() {
  return chrome.storage.local.set({ [GALLERY_KEY]: gallery });
}

async function loadGallery() {
  const { [GALLERY_KEY]: g } = await chrome.storage.local.get(GALLERY_KEY);
  gallery = Array.isArray(g) ? g : [];
  renderGallery();
}

function addImageToGallery({ dataUrl, width, height, caption }) {
  gallery.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, dataUrl, width, height, caption: caption || '' });
  renderGallery();
  return persistGallery();
}

function renderGallery() {
  els.gallery.innerHTML = gallery.map(item => `
    <div class="gallery-item" data-id="${item.id}">
      <img src="${item.dataUrl}" alt="" />
      <input type="text" class="gallery-caption" data-id="${item.id}" placeholder="Caption (optional)" value="${(item.caption || '').replace(/"/g, '&quot;')}" />
      <div class="gallery-actions">
        <button type="button" class="icon-btn" data-action="copy" data-id="${item.id}" title="Copy to clipboard">📋</button>
        <button type="button" class="icon-btn" data-action="download" data-id="${item.id}" title="Download">⬇️</button>
        <button type="button" class="icon-btn remove" data-action="remove" data-id="${item.id}" title="Remove">🗑️</button>
      </div>
    </div>
  `).join('');
}

async function copyImageToClipboard(dataUrl) {
  const blob = await (await fetch(dataUrl)).blob();
  await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'image/png']: blob })]);
}

els.gallery.addEventListener('click', async e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  const item = gallery.find(g => g.id === id);
  if (!item) return;

  if (btn.dataset.action === 'remove') {
    gallery = gallery.filter(g => g.id !== id);
    renderGallery();
    await persistGallery();
    return;
  }
  if (btn.dataset.action === 'download') {
    const ext = item.dataUrl.startsWith('data:image/png') ? 'png' : 'jpg';
    await sendToBackground('download', { url: item.dataUrl, filename: `repodocs-screenshot-${id}.${ext}` });
    return;
  }
  if (btn.dataset.action === 'copy') {
    try {
      await copyImageToClipboard(item.dataUrl);
      setCaptureStatus('Copied to clipboard.');
      setTimeout(() => setCaptureStatus(''), 1800);
    } catch (err) {
      setCaptureStatus(`Copy failed: ${err.message}`);
    }
  }
});

els.gallery.addEventListener('input', e => {
  const input = e.target.closest('.gallery-caption');
  if (!input) return;
  const item = gallery.find(g => g.id === input.dataset.id);
  if (!item) return;
  item.caption = input.value;
  persistGallery();
});

function loadImageEl(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image.'));
    img.src = src;
  });
}

// ---------- visible tab / select-area / full page capture (round-trip through background) ----------
els.captureVisibleBtn.addEventListener('click', async () => {
  if (captureBusy) return;
  setCaptureButtonsDisabled(true);
  setCaptureStatus('Capturing visible tab…');
  try {
    const res = await sendToBackground('capture:visible');
    if (res?.error) throw new Error(res.error);
    await addImageToGallery({ ...res.result, caption: 'Visible tab capture' });
    setCaptureStatus('Captured.');
  } catch (err) {
    setCaptureStatus(`Capture failed: ${err.message}`);
  } finally {
    setCaptureButtonsDisabled(false);
    setTimeout(() => setCaptureStatus(''), 2000);
  }
});

els.captureAreaBtn.addEventListener('click', async () => {
  if (captureBusy) return;
  setCaptureButtonsDisabled(true);
  setCaptureStatus('Drag to select an area on the page (Esc to cancel)…');
  try {
    const res = await sendToBackground('capture:area');
    if (res?.error) throw new Error(res.error);
    await addImageToGallery({ ...res.result, caption: 'Custom area capture' });
    setCaptureStatus('Captured.');
  } catch (err) {
    setCaptureStatus(err.message === 'Selection cancelled.' ? '' : `Capture failed: ${err.message}`);
  } finally {
    setCaptureButtonsDisabled(false);
    setTimeout(() => setCaptureStatus(''), 2000);
  }
});

function onCaptureProgress(msg) {
  if (msg?.target === 'popup' && msg.type === 'capture:progress') setCaptureStatus(msg.stage);
}

els.captureFullpageBtn.addEventListener('click', async () => {
  if (captureBusy) return;
  setCaptureButtonsDisabled(true);
  setCaptureStatus('Capturing full page…');
  try {
    const res = await sendToBackground('capture:fullpage');
    if (res?.error) throw new Error(res.error);
    await addImageToGallery({ ...res.result, caption: 'Full page capture' });
    setCaptureStatus('Captured.');
  } catch (err) {
    setCaptureStatus(`Capture failed: ${err.message}`);
  } finally {
    setCaptureButtonsDisabled(false);
    setTimeout(() => setCaptureStatus(''), 2000);
  }
});

// ---------- window/screen capture (entirely client-side in the popup, needs a real DOM) ----------
function chooseDesktopMedia() {
  return new Promise((resolve, reject) => {
    chrome.desktopCapture.chooseDesktopMedia(['screen', 'window', 'tab'], streamId => {
      if (!streamId) return reject(new Error('Capture cancelled.'));
      resolve(streamId);
    });
  });
}

async function captureFromStreamId(streamId) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: streamId } },
  });
  const video = document.createElement('video');
  video.srcObject = stream;
  await new Promise(resolve => {
    video.onloadedmetadata = resolve;
  });
  await video.play();
  // Give the frame a brief moment to actually paint before grabbing it.
  await new Promise(r => setTimeout(r, 200));

  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);

  stream.getTracks().forEach(t => t.stop());

  return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
}

els.captureWindowBtn.addEventListener('click', async () => {
  if (captureBusy) return;
  setCaptureButtonsDisabled(true);
  setCaptureStatus('Choose a window or screen…');
  try {
    const streamId = await chooseDesktopMedia();
    setCaptureStatus('Capturing…');
    const result = await captureFromStreamId(streamId);
    await addImageToGallery({ ...result, caption: 'Window/Screen capture' });
    setCaptureStatus('Captured.');
  } catch (err) {
    setCaptureStatus(err.message === 'Capture cancelled.' ? '' : `Capture failed: ${err.message}`);
  } finally {
    setCaptureButtonsDisabled(false);
    setTimeout(() => setCaptureStatus(''), 2000);
  }
});

// ---------- manual upload ----------
els.uploadImagesBtn.addEventListener('click', () => {
  if (captureBusy) return;
  els.uploadImagesInput.click();
});

els.uploadImagesInput.addEventListener('change', async () => {
  const files = [...els.uploadImagesInput.files];
  els.uploadImagesInput.value = '';
  if (!files.length) return;

  setCaptureButtonsDisabled(true);
  setCaptureStatus(`Uploading ${files.length} image(s)…`);
  try {
    for (const file of files) {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const img = await loadImageEl(dataUrl);
      const caption = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
      await addImageToGallery({ dataUrl, width: img.naturalWidth || img.width, height: img.naturalHeight || img.height, caption });
    }
    setCaptureStatus('Uploaded.');
  } catch (err) {
    setCaptureStatus(`Upload failed: ${err.message}`);
  } finally {
    setCaptureButtonsDisabled(false);
    setTimeout(() => setCaptureStatus(''), 2000);
  }
});

async function init() {
  await loadSettings();
  await loadGallery();
  const job = await sendToBackground('job:status');
  renderJob(job);
}

chrome.runtime.onMessage.addListener(msg => {
  if (msg?.target === 'popup' && msg.type === 'job:update') renderJob(msg.job);
  if (msg?.target === 'popup' && msg.type === 'capture:progress') onCaptureProgress(msg);
});

els.generateBtn.addEventListener('click', async () => {
  els.setupError.hidden = true;
  if (!hasAnyConfiguredKey()) {
    els.setupError.textContent = 'Add and detect at least one AI provider key above.';
    els.setupError.hidden = false;
    return;
  }
  const repoInput = els.repoInput.value.trim();
  if (!repoInput) {
    els.setupError.textContent = 'Enter a GitHub repository URL or owner/repo.';
    els.setupError.hidden = false;
    return;
  }

  await saveSettings();

  currentRepoLabel = repoInput;
  els.generateBtn.disabled = true;
  await sendToBackground('job:start', {
    repoInput,
    connections: connections.filter(c => c.providerId && c.key.trim()).map(c => ({ providerId: c.providerId, key: c.key.trim() })),
    githubToken: els.githubToken.value.trim(),
    manualImages: gallery.map(g => ({ dataUrl: g.dataUrl, width: g.width, height: g.height, caption: g.caption })),
  });
  els.generateBtn.disabled = false;
  showView('progress');
  els.progressStage.textContent = 'Starting…';
  startTimer(Date.now());
});

els.cancelBtn.addEventListener('click', async () => {
  await sendToBackground('job:cancel');
  showView('setup');
});

els.downloadPdfBtn.addEventListener('click', () => {
  if (!currentResult) return;
  sendToBackground('download', { url: currentResult.pdfDataUrl, filename: `${currentResult.repoName}-documentation.pdf` });
});
els.downloadDocxBtn.addEventListener('click', () => {
  if (!currentResult) return;
  sendToBackground('download', { url: currentResult.docxDataUrl, filename: `${currentResult.repoName}-documentation.docx` });
});

// Cancels any in-flight job, clears the result/error, and returns to the setup screen so the
// user can run again. Keeps their saved keys, repo/URL, and screenshot gallery for convenience.
async function resetToSetup() {
  await sendToBackground('job:cancel');
  await chrome.storage.local.set({ repodocs_job: { status: 'idle', stage: '', result: null, error: null } });
  currentResult = null;
  stopTimer();
  els.generateBtn.disabled = false;
  els.setupError.hidden = true;
  showView('setup');
}

els.newJobBtn.addEventListener('click', resetToSetup);
els.retryBtn.addEventListener('click', resetToSetup);
els.resetBtn.addEventListener('click', resetToSetup);

init();
