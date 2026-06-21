// RepoDocs AI — GitHub REST API client. Pure fetch, no DOM. ES module, imported by background.js.

const API = 'https://api.github.com';

function parseRepoUrl(input) {
  const cleaned = input.trim().replace(/\.git$/, '').replace(/\/$/, '');
  const m = cleaned.match(/github\.com[/:]([^/]+)\/([^/]+)/i) || cleaned.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (!m) throw new Error('Could not parse a GitHub owner/repo from "' + input + '"');
  return { owner: m[1], repo: m[2] };
}

function authHeaders(token) {
  const h = { Accept: 'application/vnd.github+json' };
  if (token) h.Authorization = 'Bearer ' + token;
  return h;
}

async function ghFetch(path, token) {
  const res = await fetch(API + path, { headers: authHeaders(token) });
  if (!res.ok) {
    if (res.status === 403) throw new Error('GitHub API rate limit hit. Add a personal access token in Settings to raise the limit.');
    if (res.status === 404) throw new Error('Repository or resource not found: ' + path);
    throw new Error('GitHub API error ' + res.status + ' on ' + path);
  }
  return res.json();
}

export async function getRepoMeta(owner, repo, token) {
  return ghFetch(`/repos/${owner}/${repo}`, token);
}

export async function getBranches(owner, repo, token) {
  return ghFetch(`/repos/${owner}/${repo}/branches?per_page=100`, token);
}

export async function getLanguages(owner, repo, token) {
  return ghFetch(`/repos/${owner}/${repo}/languages`, token);
}

export async function getTree(owner, repo, branch, token) {
  const data = await ghFetch(`/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`, token);
  return data.tree || [];
}

export async function getReadme(owner, repo, token) {
  try {
    const data = await ghFetch(`/repos/${owner}/${repo}/readme`, token);
    const decoded = decodeBase64Utf8(data.content);
    return decoded;
  } catch {
    return '';
  }
}

export async function getFileContent(owner, repo, path, token) {
  try {
    const data = await ghFetch(`/repos/${owner}/${repo}/contents/${path}`, token);
    if (data.encoding === 'base64') return decodeBase64Utf8(data.content);
    return '';
  } catch {
    return '';
  }
}

function decodeBase64Utf8(b64) {
  const binary = atob(b64.replace(/\n/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

const MANIFEST_CANDIDATES = [
  'package.json', 'requirements.txt', 'pyproject.toml', 'Cargo.toml',
  'go.mod', 'composer.json', 'Gemfile', 'pom.xml', 'build.gradle',
];

export async function findManifest(owner, repo, tree, token) {
  const paths = new Set(tree.map(t => t.path));
  for (const candidate of MANIFEST_CANDIDATES) {
    if (paths.has(candidate)) {
      const content = await getFileContent(owner, repo, candidate, token);
      if (content) return { file: candidate, content: content.slice(0, 4000) };
    }
  }
  return null;
}

// Extracts the first plausible "live app" URL from repo metadata or README.
export function detectLiveUrl(repoMeta, readme) {
  if (repoMeta.homepage && /^https?:\/\//.test(repoMeta.homepage)) return repoMeta.homepage;
  const m = readme.match(/https?:\/\/[^\s)\]"'<>]+/gi) || [];
  const skip = /github\.com|shields\.io|img\.shields|badge|opensource\.org|w3\.org/i;
  const found = m.find(u => !skip.test(u));
  return found || null;
}

export async function analyzeRepository(repoInput, token, onProgress) {
  const { owner, repo } = parseRepoUrl(repoInput);
  onProgress?.('Fetching repository metadata…');
  const meta = await getRepoMeta(owner, repo, token);

  onProgress?.('Reading branches…');
  const branches = await getBranches(owner, repo, token).catch(() => []);

  onProgress?.('Reading language breakdown…');
  const languages = await getLanguages(owner, repo, token).catch(() => ({}));

  onProgress?.('Fetching full file tree…');
  const tree = await getTree(owner, repo, meta.default_branch, token).catch(() => []);

  onProgress?.('Reading README…');
  const readme = await getReadme(owner, repo, token);

  onProgress?.('Detecting tech stack manifest…');
  const manifest = await findManifest(owner, repo, tree, token).catch(() => null);

  const liveUrl = detectLiveUrl(meta, readme);

  return { owner, repo, meta, branches, languages, tree, readme, manifest, liveUrl };
}
