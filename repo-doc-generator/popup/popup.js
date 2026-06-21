// RepoDocs AI — popup UI logic. Classic script, no build step.

const SETTINGS_KEY = 'repodocs_settings';
const GALLERY_KEY = 'repodocs_gallery';

const els = {
  setupView: document.getElementById('setup-view'),
  progressView: document.getElementById('progress-view'),
  doneView: document.getElementById('done-view'),
  errorView: document.getElementById('error-view'),

  keyGroq: document.getElementById('key-groq'),
  keyCerebras: document.getElementById('key-cerebras'),
  keyGemini: document.getElementById('key-gemini'),
  keyOpenrouter: document.getElementById('key-openrouter'),
  repoInput: document.getElementById('repo-input'),
  githubToken: document.getElementById('github-token'),
  captureScreenshot: document.getElementById('capture-screenshot'),
  generateBtn: document.getElementById('generate-btn'),
  setupError: document.getElementById('setup-error'),

  captureVisibleBtn: document.getElementById('capture-visible-btn'),
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

function readSettings() {
  return {
    groq: els.keyGroq.value.trim(),
    cerebras: els.keyCerebras.value.trim(),
    gemini: els.keyGemini.value.trim(),
    openrouter: els.keyOpenrouter.value.trim(),
    githubToken: els.githubToken.value.trim(),
    repoInput: els.repoInput.value.trim(),
    captureScreenshot: els.captureScreenshot.checked,
  };
}

async function saveSettings() {
  await chrome.storage.local.set({ [SETTINGS_KEY]: readSettings() });
}

async function loadSettings() {
  const { [SETTINGS_KEY]: s } = await chrome.storage.local.get(SETTINGS_KEY);
  if (!s) return;
  els.keyGroq.value = s.groq || '';
  els.keyCerebras.value = s.cerebras || '';
  els.keyGemini.value = s.gemini || '';
  els.keyOpenrouter.value = s.openrouter || '';
  els.githubToken.value = s.githubToken || '';
  els.repoInput.value = s.repoInput || '';
  els.captureScreenshot.checked = Boolean(s.captureScreenshot);
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

// ---------- visible tab / full page capture (round-trip through background) ----------
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
  const settings = readSettings();
  const hasKey = settings.groq || settings.cerebras || settings.gemini || settings.openrouter;
  if (!hasKey) {
    els.setupError.textContent = 'Add at least one free AI provider key above.';
    els.setupError.hidden = false;
    return;
  }
  if (!settings.repoInput) {
    els.setupError.textContent = 'Enter a GitHub repository URL, owner/repo, or website URL.';
    els.setupError.hidden = false;
    return;
  }

  await saveSettings();

  if (settings.captureScreenshot) {
    await sendToBackground('request-screenshot-permission');
  }

  currentRepoLabel = settings.repoInput;
  els.generateBtn.disabled = true;
  await sendToBackground('job:start', {
    repoInput: settings.repoInput,
    keys: { groq: settings.groq, cerebras: settings.cerebras, gemini: settings.gemini, openrouter: settings.openrouter },
    githubToken: settings.githubToken,
    captureScreenshot: settings.captureScreenshot,
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

els.newJobBtn.addEventListener('click', async () => {
  await chrome.storage.local.set({ repodocs_job: { status: 'idle', stage: '', result: null, error: null } });
  showView('setup');
});
els.retryBtn.addEventListener('click', async () => {
  await chrome.storage.local.set({ repodocs_job: { status: 'idle', stage: '', result: null, error: null } });
  showView('setup');
});

init();
