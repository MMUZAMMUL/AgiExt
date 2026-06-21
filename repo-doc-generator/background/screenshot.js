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
