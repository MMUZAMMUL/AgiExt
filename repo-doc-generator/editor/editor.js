// RepoDocs AI — screenshot annotation editor. Classic script, runs in its own extension tab.
// Loads the pending crop from storage, lets the user annotate (shapes/text/colors/undo/redo),
// then either adds the flattened result to the document gallery, copies it, or saves it to disk.

const PENDING_CROP_KEY = 'repodocs_pending_crop';
const GALLERY_KEY = 'repodocs_gallery';

const COLORS = ['#ef4444', '#f59e0b', '#eab308', '#22c55e', '#3b82f6', '#a855f7', '#ffffff', '#111111'];

const els = {
  canvas: document.getElementById('canvas'),
  wrap: document.getElementById('canvas-wrap'),
  tools: document.getElementById('tools'),
  colors: document.getElementById('colors'),
  width: document.getElementById('width'),
  undo: document.getElementById('undo'),
  redo: document.getElementById('redo'),
  clear: document.getElementById('clear'),
  copy: document.getElementById('copy'),
  save: document.getElementById('save'),
  cancel: document.getElementById('cancel'),
  done: document.getElementById('done'),
  textInput: document.getElementById('text-input'),
  status: document.getElementById('status'),
};

const ctx = els.canvas.getContext('2d');

let baseImage = null;       // the cropped screenshot, drawn underneath every annotation
let shapes = [];            // committed annotation objects
let redoStack = [];
let tool = 'pointer';
let color = COLORS[0];
let lineWidth = 4;
let drawing = false;
let current = null;         // in-progress shape during a drag

function setStatus(text) { els.status.textContent = text || ''; }

function sendToBackground(type, payload) {
  return new Promise(resolve => chrome.runtime.sendMessage({ target: 'background', type, payload }, resolve));
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image.'));
    img.src = src;
  });
}

// ---------- palette / tool UI ----------
function buildColors() {
  els.colors.innerHTML = COLORS.map(c => `<button class="swatch" data-color="${c}" style="background:${c}"></button>`).join('');
  highlightColor();
}
function highlightColor() {
  [...els.colors.children].forEach(b => b.classList.toggle('active', b.dataset.color === color));
}
els.colors.addEventListener('click', e => {
  const b = e.target.closest('.swatch');
  if (!b) return;
  color = b.dataset.color;
  highlightColor();
});
els.tools.addEventListener('click', e => {
  const b = e.target.closest('.tool');
  if (!b) return;
  tool = b.dataset.tool;
  [...els.tools.children].forEach(t => t.classList.toggle('active', t === b));
  els.canvas.style.cursor = tool === 'pointer' ? 'default' : (tool === 'text' ? 'text' : 'crosshair');
});
els.width.addEventListener('input', () => { lineWidth = Number(els.width.value); });

// ---------- coordinate mapping (display px -> image px) ----------
function toImageCoords(e) {
  const r = els.canvas.getBoundingClientRect();
  const sx = els.canvas.width / r.width;
  const sy = els.canvas.height / r.height;
  return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
}

// ---------- drawing ----------
function drawArrow(c, x1, y1, x2, y2, w) {
  c.beginPath();
  c.moveTo(x1, y1);
  c.lineTo(x2, y2);
  c.stroke();
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const head = Math.max(10, w * 3);
  c.beginPath();
  c.moveTo(x2, y2);
  c.lineTo(x2 - head * Math.cos(ang - Math.PI / 6), y2 - head * Math.sin(ang - Math.PI / 6));
  c.lineTo(x2 - head * Math.cos(ang + Math.PI / 6), y2 - head * Math.sin(ang + Math.PI / 6));
  c.closePath();
  c.fill();
}

function drawShape(c, s) {
  c.strokeStyle = s.color;
  c.fillStyle = s.color;
  c.lineWidth = s.width;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  if (s.tool === 'rect') {
    c.strokeRect(s.x, s.y, s.w, s.h);
  } else if (s.tool === 'ellipse') {
    c.beginPath();
    c.ellipse(s.x + s.w / 2, s.y + s.h / 2, Math.abs(s.w / 2), Math.abs(s.h / 2), 0, 0, Math.PI * 2);
    c.stroke();
  } else if (s.tool === 'line') {
    c.beginPath();
    c.moveTo(s.x1, s.y1);
    c.lineTo(s.x2, s.y2);
    c.stroke();
  } else if (s.tool === 'arrow') {
    drawArrow(c, s.x1, s.y1, s.x2, s.y2, s.width);
  } else if (s.tool === 'pen') {
    c.beginPath();
    s.points.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
    c.stroke();
  } else if (s.tool === 'text') {
    c.font = `${s.fontSize}px 'Segoe UI', Arial, sans-serif`;
    c.textBaseline = 'top';
    c.fillText(s.text, s.x, s.y);
  }
}

function redraw() {
  ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
  if (baseImage) ctx.drawImage(baseImage, 0, 0);
  for (const s of shapes) drawShape(ctx, s);
  if (current) drawShape(ctx, current);
  els.undo.disabled = shapes.length === 0;
  els.redo.disabled = redoStack.length === 0;
}

function commit(shape) {
  shapes.push(shape);
  redoStack = [];
  redraw();
}

// ---------- pointer interaction ----------
els.canvas.addEventListener('mousedown', e => {
  if (tool === 'pointer') return;
  if (tool === 'text') { placeTextInput(e); return; }
  drawing = true;
  const { x, y } = toImageCoords(e);
  if (tool === 'pen') current = { tool, color, width: lineWidth, points: [{ x, y }] };
  else if (tool === 'line' || tool === 'arrow') current = { tool, color, width: lineWidth, x1: x, y1: y, x2: x, y2: y };
  else current = { tool, color, width: lineWidth, x, y, w: 0, h: 0 };
});

els.canvas.addEventListener('mousemove', e => {
  if (!drawing || !current) return;
  const { x, y } = toImageCoords(e);
  if (current.tool === 'pen') current.points.push({ x, y });
  else if (current.tool === 'line' || current.tool === 'arrow') { current.x2 = x; current.y2 = y; }
  else { current.w = x - current.x; current.h = y - current.y; }
  redraw();
});

function finishDrag() {
  if (!drawing || !current) return;
  drawing = false;
  // Discard degenerate (zero-size) shapes.
  const tiny = (current.tool === 'pen' && current.points.length < 2) ||
    ((current.tool === 'rect' || current.tool === 'ellipse') && Math.abs(current.w) < 3 && Math.abs(current.h) < 3) ||
    ((current.tool === 'line' || current.tool === 'arrow') && Math.hypot(current.x2 - current.x1, current.y2 - current.y1) < 3);
  const s = current;
  current = null;
  if (!tiny) commit(s);
  else redraw();
}
els.canvas.addEventListener('mouseup', finishDrag);
els.canvas.addEventListener('mouseleave', finishDrag);

// ---------- text tool ----------
function placeTextInput(e) {
  const r = els.canvas.getBoundingClientRect();
  const left = e.clientX - r.left;
  const top = e.clientY - r.top;
  const { x, y } = toImageCoords(e);
  const fontSize = Math.max(16, lineWidth * 6);
  els.textInput.style.left = `${left}px`;
  els.textInput.style.top = `${top}px`;
  els.textInput.style.color = color;
  els.textInput.style.fontSize = `${fontSize * (r.width / els.canvas.width)}px`;
  els.textInput.value = '';
  els.textInput.hidden = false;
  els.textInput.focus();

  const commitText = () => {
    const text = els.textInput.value.trim();
    els.textInput.hidden = true;
    if (text) commit({ tool: 'text', color, width: lineWidth, x, y, text, fontSize });
    els.textInput.removeEventListener('blur', commitText);
    els.textInput.removeEventListener('keydown', onKey);
  };
  const onKey = ev => {
    if (ev.key === 'Enter') { ev.preventDefault(); commitText(); }
    else if (ev.key === 'Escape') { els.textInput.hidden = true; els.textInput.removeEventListener('blur', commitText); els.textInput.removeEventListener('keydown', onKey); }
  };
  els.textInput.addEventListener('blur', commitText);
  els.textInput.addEventListener('keydown', onKey);
}

// ---------- history ----------
els.undo.addEventListener('click', () => { if (shapes.length) { redoStack.push(shapes.pop()); redraw(); } });
els.redo.addEventListener('click', () => { if (redoStack.length) { shapes.push(redoStack.pop()); redraw(); } });
els.clear.addEventListener('click', () => { if (shapes.length) { redoStack = []; shapes = []; redraw(); } });
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? els.redo.click() : els.undo.click(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); els.redo.click(); }
});

// ---------- output ----------
function flattenedDataUrl() {
  return els.canvas.toDataURL('image/png');
}

async function closeTab() {
  await chrome.storage.local.remove(PENDING_CROP_KEY);
  const tab = await chrome.tabs.getCurrent();
  if (tab) chrome.tabs.remove(tab.id);
}

els.done.addEventListener('click', async () => {
  const dataUrl = flattenedDataUrl();
  const { [GALLERY_KEY]: g } = await chrome.storage.local.get(GALLERY_KEY);
  const gallery = Array.isArray(g) ? g : [];
  gallery.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    dataUrl,
    width: els.canvas.width,
    height: els.canvas.height,
    caption: 'Custom area capture',
  });
  await chrome.storage.local.set({ [GALLERY_KEY]: gallery });
  await sendToBackground('autosave:image', { url: dataUrl, name: `area-${Date.now()}.png` });
  setStatus('Added to the document gallery.');
  await closeTab();
});

els.copy.addEventListener('click', async () => {
  try {
    const blob = await new Promise(res => els.canvas.toBlob(res, 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    setStatus('Copied to clipboard.');
  } catch (err) {
    setStatus(`Copy failed: ${err.message}`);
  }
});

els.save.addEventListener('click', async () => {
  await sendToBackground('download', { url: flattenedDataUrl(), filename: `RepoDocs/screenshots/area-${Date.now()}.png` });
  setStatus('Saved to your Downloads/RepoDocs/screenshots folder.');
});

els.cancel.addEventListener('click', closeTab);

// ---------- init ----------
async function init() {
  buildColors();
  const { [PENDING_CROP_KEY]: crop } = await chrome.storage.local.get(PENDING_CROP_KEY);
  if (!crop?.dataUrl) {
    setStatus('No screenshot to edit. You can close this tab.');
    return;
  }
  baseImage = await loadImage(crop.dataUrl);
  els.canvas.width = baseImage.naturalWidth || baseImage.width;
  els.canvas.height = baseImage.naturalHeight || baseImage.height;
  redraw();
  setStatus('Draw to annotate · Done adds it to your document · Esc cancels text.');
}

init();
