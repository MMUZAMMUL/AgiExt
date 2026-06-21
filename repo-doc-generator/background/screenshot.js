// RepoDocs AI — screenshot capture: visible tab, full page (scroll + stitch), and a given tab/window.
// ES module, imported by background.js (popup-triggered captures route through background since
// chrome.tabs.captureVisibleTab and chrome.scripting are background/extension-page APIs).

import { ensureOffscreen, sendToOffscreen } from './offscreen-client.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function captureVisibleTab(windowId) {
  return chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
}

export async function measureDataUrl(dataUrl) {
  await ensureOffscreen();
  const [measured] = await sendToOffscreen('measure', { dataUrls: [dataUrl] });
  return measured;
}

function readPageMetrics() {
  return {
    scrollHeight: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
    viewportHeight: window.innerHeight,
    viewportWidth: window.innerWidth,
    dpr: window.devicePixelRatio || 1,
    originalY: window.scrollY,
  };
}

function scrollPageTo(y) {
  window.scrollTo(0, y);
  return window.scrollY;
}

// Injected into the page: draws a dim overlay + drag-to-select rectangle, resolves with the
// selected rect in CSS pixels (or null if the user pressed Escape / clicked without dragging).
function selectAreaOverlay() {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(0,0,0,0.25);';
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;border:2px solid #f59e0b;background:rgba(245,158,11,0.15);display:none;pointer-events:none;';
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    let startX = 0, startY = 0, dragging = false;

    function cleanup() {
      overlay.remove();
      document.removeEventListener('keydown', onKeyDown, true);
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        cleanup();
        resolve(null);
      }
    }
    document.addEventListener('keydown', onKeyDown, true);

    overlay.addEventListener('mousedown', e => {
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      box.style.left = startX + 'px';
      box.style.top = startY + 'px';
      box.style.width = '0px';
      box.style.height = '0px';
      box.style.display = 'block';
    });
    overlay.addEventListener('mousemove', e => {
      if (!dragging) return;
      const x = Math.min(e.clientX, startX);
      const y = Math.min(e.clientY, startY);
      box.style.left = x + 'px';
      box.style.top = y + 'px';
      box.style.width = Math.abs(e.clientX - startX) + 'px';
      box.style.height = Math.abs(e.clientY - startY) + 'px';
    });
    overlay.addEventListener('mouseup', e => {
      dragging = false;
      const x = Math.min(e.clientX, startX);
      const y = Math.min(e.clientY, startY);
      const width = Math.abs(e.clientX - startX);
      const height = Math.abs(e.clientY - startY);
      cleanup();
      if (width < 4 || height < 4) {
        resolve(null);
      } else {
        resolve({ x, y, width, height, dpr: window.devicePixelRatio || 1 });
      }
    });
  });
}

// Lets the user drag-select a region of the visible tab, captures it, and crops to that region.
export async function captureArea(tabId, windowId) {
  const [{ result: rect }] = await chrome.scripting.executeScript({ target: { tabId }, func: selectAreaOverlay });
  if (!rect) throw new Error('Selection cancelled.');
  const dataUrl = await captureVisibleTab(windowId);
  await ensureOffscreen();
  return sendToOffscreen('crop', { dataUrl, rect });
}

export async function captureFullPage(tabId, windowId, onProgress) {
  const [{ result: metrics }] = await chrome.scripting.executeScript({ target: { tabId }, func: readPageMetrics });
  const steps = Math.max(1, Math.ceil(metrics.scrollHeight / metrics.viewportHeight));
  const slices = [];

  for (let i = 0; i < steps; i++) {
    const targetY = i * metrics.viewportHeight;
    const [{ result: actualY }] = await chrome.scripting.executeScript({ target: { tabId }, func: scrollPageTo, args: [targetY] });
    await sleep(350);
    const dataUrl = await captureVisibleTab(windowId);
    slices.push({ dataUrl, y: actualY });
    onProgress?.(`Capturing full page… (${i + 1}/${steps})`);
  }

  await chrome.scripting.executeScript({ target: { tabId }, func: scrollPageTo, args: [metrics.originalY] });

  await ensureOffscreen();
  return sendToOffscreen('stitch', {
    slices,
    viewportWidth: metrics.viewportWidth,
    viewportHeight: metrics.viewportHeight,
    scrollHeight: metrics.scrollHeight,
  });
}
