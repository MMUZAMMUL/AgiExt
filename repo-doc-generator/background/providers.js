// RepoDocs AI — multi-provider AI failover. Pure fetch, no DOM. ES module, imported by background.js.
// Adapted from AgentForge's own assets/js/providers.js cascade pattern (Groq → Cerebras → Gemini → OpenRouter).

const GROQ_MODELS = ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile', 'gemma2-9b-it'];
const CEREBRAS_MODELS = ['llama-3.3-70b', 'llama3.1-8b'];
const GEMINI_MODELS = ['gemini-2.0-flash', 'gemini-1.5-flash'];
const OPENROUTER_MODELS = [
  'meta-llama/llama-3.3-70b-instruct:free',
  'google/gemini-2.0-flash-exp:free',
  'qwen/qwen-2.5-72b-instruct:free',
  'mistralai/mistral-small-3.1-24b-instruct:free',
  'meta-llama/llama-3.1-8b-instruct:free',
];

function parseRetryAfter(msg) {
  const m = String(msg).match(/try again in ([\d.]+)s/i);
  return m ? Math.ceil(parseFloat(m[1]) * 1000) + 500 : 8000;
}

// keys = { groq, cerebras, gemini, openrouter } — any subset, all optional
function buildEngineChain(keys) {
  const chain = [];
  if (keys.groq) GROQ_MODELS.forEach(m => chain.push({ prov: 'groq', model: m, url: 'https://api.groq.com/openai/v1/chat/completions', key: keys.groq }));
  if (keys.cerebras) CEREBRAS_MODELS.forEach(m => chain.push({ prov: 'cerebras', model: m, url: 'https://api.cerebras.ai/v1/chat/completions', key: keys.cerebras }));
  if (keys.gemini) GEMINI_MODELS.forEach(m => chain.push({ prov: 'gemini', model: m, url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', key: keys.gemini }));
  if (keys.openrouter) OPENROUTER_MODELS.forEach(m => chain.push({ prov: 'openrouter', model: m, url: 'https://openrouter.ai/api/v1/chat/completions', key: keys.openrouter }));
  return chain;
}

// Sends one chat-completion request, automatically failing over across providers/models on 429 or error.
async function chatWithRetry(keys, messages, onStatus) {
  const chain = buildEngineChain(keys);
  if (!chain.length) throw new Error('No AI provider connected — add a free API key in the extension popup.');
  let lastErr;
  for (let i = 0; i < chain.length; i++) {
    const eng = chain[i];
    const body = { model: eng.model, max_tokens: 2048, messages };
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + eng.key };
    if (eng.prov === 'openrouter') {
      headers['HTTP-Referer'] = 'https://github.com/mmuzammul/AgiForge';
      headers['X-Title'] = 'RepoDocs AI';
    }
    let res;
    try {
      res = await fetch(eng.url, { method: 'POST', headers, body: JSON.stringify(body) });
    } catch (err) {
      lastErr = err;
      continue;
    }
    if (res.status === 429) {
      const hasNext = i < chain.length - 1;
      if (hasNext) {
        onStatus?.(`${eng.prov} busy, switching engine…`);
        continue;
      }
      const e = await res.json().catch(() => ({}));
      const wait = parseRetryAfter(e.error?.message || '');
      onStatus?.(`All engines busy, retrying in ${Math.ceil(wait / 1000)}s…`);
      await new Promise(r => setTimeout(r, wait));
      try {
        res = await fetch(eng.url, { method: 'POST', headers, body: JSON.stringify(body) });
      } catch (err) {
        lastErr = err;
        continue;
      }
    }
    if (res.ok) {
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || '';
      if (text) return text;
      lastErr = new Error('Empty response from ' + eng.prov);
      continue;
    }
    const e = await res.json().catch(() => ({}));
    lastErr = new Error(e.error?.message || eng.prov + ' error ' + res.status);
  }
  throw lastErr || new Error('All AI engines are busy — try again in a moment.');
}

// Generates a single section of the document. Returns plain text (markdown-lite: short paragraphs, occasional bullet lists).
export async function generateSection(keys, systemPrompt, userPrompt, onStatus) {
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
  return chatWithRetry(keys, messages, onStatus);
}

export function hasAnyKey(keys) {
  return Boolean(keys?.groq || keys?.cerebras || keys?.gemini || keys?.openrouter);
}
