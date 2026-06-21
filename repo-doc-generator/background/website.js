// RepoDocs AI — non-GitHub website analysis. ES module, imported by background.js.
// Fetches the page HTML (relies on the optional <all_urls> host permission) and hands it to the
// offscreen document for DOMParser-based extraction (a service worker has no DOMParser).
import { ensureOffscreen, sendToOffscreen } from './offscreen-client.js';

export function isLikelyGithubInput(input) {
  const cleaned = input.trim();
  if (/github\.com[/:]/i.test(cleaned)) return true;
  if (/^[\w.-]+\/[\w.-]+$/.test(cleaned.replace(/\.git$/, ''))) return true; // owner/repo shorthand
  return false;
}

export async function analyzeWebsite(url, onProgress) {
  onProgress?.('Fetching website…');
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Could not fetch ${url} (HTTP ${res.status}).`);
  const html = await res.text();

  onProgress?.('Parsing page content…');
  await ensureOffscreen();
  const parsed = await sendToOffscreen('parse-html', { html: html.slice(0, 500000) });

  return { url, ...parsed };
}
