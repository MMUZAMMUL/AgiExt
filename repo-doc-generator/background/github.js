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

// Picks the most report-worthy markdown docs (besides the main README) — these are where the
// project actually explains itself, so they're far more useful than reading all the source.
// Prioritizes well-known doc names, then any other .md, capped to keep the AI context tight.
const DOC_PRIORITY = [
  /(^|\/)readme[^/]*\.md$/i,        // secondary READMEs (e.g. docs/README.md, subproject READMEs)
  /(^|\/)architecture[^/]*\.md$/i,
  /(^|\/)overview[^/]*\.md$/i,
  /(^|\/)usage[^/]*\.md$/i,
  /(^|\/)getting[-_]?started[^/]*\.md$/i,
  /(^|\/)contributing[^/]*\.md$/i,
  /(^|\/)features?[^/]*\.md$/i,
  /(^|\/)roadmap[^/]*\.md$/i,
  /(^|\/)changelog[^/]*\.md$/i,
];

function rankDocPath(path) {
  for (let i = 0; i < DOC_PRIORITY.length; i++) if (DOC_PRIORITY[i].test(path)) return i;
  return DOC_PRIORITY.length; // any other .md
}

// Returns [{ path, excerpt }] for up to `max` markdown docs (excluding the root README, which is
// fetched separately). Prefers shallow paths and recognized doc names.
export async function getMarkdownDocs(owner, repo, tree, token, max = 4) {
  const candidates = tree
    .filter(t => t.type === 'blob' && /\.md$/i.test(t.path) && !/^readme\.md$/i.test(t.path))
    .map(t => ({ path: t.path, depth: t.path.split('/').length, rank: rankDocPath(t.path) }))
    .sort((a, b) => (a.rank - b.rank) || (a.depth - b.depth) || a.path.localeCompare(b.path))
    .slice(0, max);

  const docs = [];
  for (const c of candidates) {
    const content = await getFileContent(owner, repo, c.path, token);
    if (content && content.trim()) docs.push({ path: c.path, excerpt: content.slice(0, 1800) });
  }
  return docs;
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

  onProgress?.('Reading project docs (.md files)…');
  const docs = await getMarkdownDocs(owner, repo, tree, token).catch(() => []);

  onProgress?.('Detecting tech stack manifest…');
  const manifest = await findManifest(owner, repo, tree, token).catch(() => null);

  return { owner, repo, meta, branches, languages, tree, readme, docs, manifest };
}
