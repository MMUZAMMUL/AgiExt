// RepoDocs AI — thin client for talking to the MV3 offscreen document. ES module, shared by
// background.js and screenshot.js (both need to ask the offscreen doc to rasterize/stitch images,
// since a service worker has no DOM/canvas of its own).

const OFFSCREEN_URL = 'offscreen/offscreen.html';

export async function ensureOffscreen() {
  const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (existing.length > 0) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['DOM_PARSER', 'BLOBS'],
    justification: 'Rasterize/stitch images, parse HTML, and assemble the final PDF/DOCX files.',
  });
}

export function sendToOffscreen(type, payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ target: 'offscreen', type, payload }, response => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (response?.error) return reject(new Error(response.error));
      resolve(response?.result);
    });
  });
}
