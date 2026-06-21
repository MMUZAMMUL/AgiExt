// RepoDocs AI — multi-provider AI failover. Pure fetch, no DOM. ES module, imported by background.js.
// Supports ~20 providers (free + paid). Most expose an OpenAI-compatible /chat/completions endpoint;
// Anthropic uses its own /v1/messages shape, handled as a special case in chatWithRetry.

// Each entry: id, label, free (bool, shown in the popup dropdown), url, authStyle, models,
// keyPrefix (RegExp used for auto-detection from a pasted key, or null if the format is ambiguous
// and the user must pick the provider from the dropdown themselves).
export const PROVIDER_CATALOG = [
  { id: 'groq', label: 'Groq', free: true, authStyle: 'bearer', keyPrefix: /^gsk_/, url: 'https://api.groq.com/openai/v1/chat/completions', models: ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile', 'gemma2-9b-it'], keyHelp: 'console.groq.com/keys', placeholder: 'gsk_…' },
  { id: 'cerebras', label: 'Cerebras', free: true, authStyle: 'bearer', keyPrefix: /^csk-/, url: 'https://api.cerebras.ai/v1/chat/completions', models: ['llama-3.3-70b', 'llama3.1-8b'], keyHelp: 'cloud.cerebras.ai', placeholder: 'csk-…' },
  { id: 'gemini', label: 'Google Gemini', free: true, authStyle: 'bearer', keyPrefix: /^AIza/, url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', models: ['gemini-2.0-flash', 'gemini-1.5-flash'], keyHelp: 'aistudio.google.com/apikey', placeholder: 'AIza…' },
  { id: 'openrouter', label: 'OpenRouter', free: true, authStyle: 'bearer', keyPrefix: /^sk-or-/, url: 'https://openrouter.ai/api/v1/chat/completions', models: ['meta-llama/llama-3.3-70b-instruct:free', 'google/gemini-2.0-flash-exp:free', 'qwen/qwen-2.5-72b-instruct:free', 'mistralai/mistral-small-3.1-24b-instruct:free', 'meta-llama/llama-3.1-8b-instruct:free'], keyHelp: 'openrouter.ai/keys', placeholder: 'sk-or-…' },
  { id: 'nvidia', label: 'Nvidia NIM', free: true, authStyle: 'bearer', keyPrefix: /^nvapi-/, url: 'https://integrate.api.nvidia.com/v1/chat/completions', models: ['meta/llama-3.1-70b-instruct', 'mistralai/mixtral-8x7b-instruct-v0.1'], keyHelp: 'build.nvidia.com', placeholder: 'nvapi-…' },
  { id: 'together', label: 'Together AI', free: true, authStyle: 'bearer', keyPrefix: null, url: 'https://api.together.xyz/v1/chat/completions', models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo-Free', 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo'], keyHelp: 'api.together.xyz/settings/api-keys', placeholder: 'API key…' },
  { id: 'sambanova', label: 'SambaNova', free: true, authStyle: 'bearer', keyPrefix: null, url: 'https://api.sambanova.ai/v1/chat/completions', models: ['Meta-Llama-3.3-70B-Instruct', 'Meta-Llama-3.1-8B-Instruct'], keyHelp: 'cloud.sambanova.ai/apis', placeholder: 'API key…' },
  { id: 'huggingface', label: 'Hugging Face', free: true, authStyle: 'bearer', keyPrefix: /^hf_/, url: 'https://router.huggingface.co/v1/chat/completions', models: ['meta-llama/Llama-3.1-8B-Instruct', 'Qwen/Qwen2.5-72B-Instruct'], keyHelp: 'huggingface.co/settings/tokens', placeholder: 'hf_…' },
  { id: 'ai21', label: 'AI21 Labs', free: true, authStyle: 'bearer', keyPrefix: null, url: 'https://api.ai21.com/studio/v1/chat/completions', models: ['jamba-mini', 'jamba-large'], keyHelp: 'studio.ai21.com/account/api-key', placeholder: 'API key…' },
  { id: 'cohere', label: 'Cohere', free: true, authStyle: 'bearer', keyPrefix: null, url: 'https://api.cohere.ai/compatibility/v1/chat/completions', models: ['command-r7b-12-2024', 'command-r-plus'], keyHelp: 'dashboard.cohere.com/api-keys', placeholder: 'API key…' },
  { id: 'deepseek', label: 'DeepSeek', free: false, authStyle: 'bearer', keyPrefix: null, url: 'https://api.deepseek.com/chat/completions', models: ['deepseek-chat', 'deepseek-reasoner'], keyHelp: 'platform.deepseek.com/api_keys', placeholder: 'sk-…' },
  { id: 'fireworks', label: 'Fireworks AI', free: false, authStyle: 'bearer', keyPrefix: /^fw_/, url: 'https://api.fireworks.ai/inference/v1/chat/completions', models: ['accounts/fireworks/models/llama-v3p1-8b-instruct'], keyHelp: 'fireworks.ai/account/api-keys', placeholder: 'fw_…' },
  { id: 'mistral', label: 'Mistral AI', free: false, authStyle: 'bearer', keyPrefix: null, url: 'https://api.mistral.ai/v1/chat/completions', models: ['mistral-small-latest', 'open-mistral-nemo'], keyHelp: 'console.mistral.ai/api-keys', placeholder: 'API key…' },
  { id: 'xai', label: 'xAI (Grok)', free: false, authStyle: 'bearer', keyPrefix: /^xai-/, url: 'https://api.x.ai/v1/chat/completions', models: ['grok-2-latest'], keyHelp: 'console.x.ai', placeholder: 'xai-…' },
  { id: 'openai', label: 'OpenAI', free: false, authStyle: 'bearer', keyPrefix: /^sk-proj-/, url: 'https://api.openai.com/v1/chat/completions', models: ['gpt-4o-mini', 'gpt-4o'], keyHelp: 'platform.openai.com/api-keys', placeholder: 'sk-…' },
  { id: 'anthropic', label: 'Anthropic (Claude)', free: false, authStyle: 'anthropic', keyPrefix: /^sk-ant-/, url: 'https://api.anthropic.com/v1/messages', models: ['claude-3-5-haiku-20241022'], keyHelp: 'console.anthropic.com', placeholder: 'sk-ant-…' },
  { id: 'perplexity', label: 'Perplexity', free: false, authStyle: 'bearer', keyPrefix: /^pplx-/, url: 'https://api.perplexity.ai/chat/completions', models: ['sonar'], keyHelp: 'perplexity.ai/settings/api', placeholder: 'pplx-…' },
  { id: 'novita', label: 'Novita AI', free: false, authStyle: 'bearer', keyPrefix: null, url: 'https://api.novita.ai/v3/openai/chat/completions', models: ['meta-llama/llama-3.1-8b-instruct'], keyHelp: 'novita.ai/settings/key-management', placeholder: 'API key…' },
  { id: 'replicate', label: 'Replicate', free: false, authStyle: 'bearer', keyPrefix: /^r8_/, url: 'https://api.replicate.com/v1/chat/completions', models: ['meta/meta-llama-3.1-8b-instruct'], keyHelp: 'replicate.com/account/api-tokens', placeholder: 'r8_…' },
  { id: 'lepton', label: 'Lepton AI', free: false, authStyle: 'bearer', keyPrefix: null, url: 'https://llama3-1-8b.lepton.run/api/v1/chat/completions', models: ['llama3.1-8b'], keyHelp: 'dashboard.lepton.ai', placeholder: 'API key…' },
];

export function getProvider(id) {
  return PROVIDER_CATALOG.find(p => p.id === id) || null;
}

// Best-effort provider detection from a pasted key's format. Returns null if ambiguous
// (several providers share a generic "sk-..." style key) — the caller should then fall
// back to whatever provider the user picked in the dropdown.
export function detectProviderFromKey(key) {
  const k = String(key || '').trim();
  if (!k) return null;
  for (const p of PROVIDER_CATALOG) {
    if (p.keyPrefix && p.keyPrefix.test(k)) return p.id;
  }
  return null;
}

function parseRetryAfter(msg) {
  const m = String(msg).match(/try again in ([\d.]+)s/i);
  return m ? Math.ceil(parseFloat(m[1]) * 1000) + 500 : 8000;
}

// connections = [{ providerId, key }, …] — any subset, all optional
function buildEngineChain(connections) {
  const chain = [];
  for (const conn of connections || []) {
    if (!conn?.key || !conn?.providerId) continue;
    const provider = getProvider(conn.providerId);
    if (!provider) continue;
    for (const model of provider.models) {
      chain.push({ prov: provider.id, model, url: provider.url, key: conn.key, authStyle: provider.authStyle });
    }
  }
  return chain;
}

async function callEngine(eng, messages) {
  if (eng.authStyle === 'anthropic') {
    const sys = messages.find(m => m.role === 'system')?.content || '';
    const userMsgs = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content }));
    const res = await fetch(eng.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': eng.key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: eng.model, max_tokens: 2048, system: sys, messages: userMsgs }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      const err = new Error(e.error?.message || eng.prov + ' error ' + res.status);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    return data.content?.[0]?.text || '';
  }

  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + eng.key };
  if (eng.prov === 'openrouter') {
    headers['HTTP-Referer'] = 'https://github.com/mmuzammul/AgiForge';
    headers['X-Title'] = 'RepoDocs AI';
  }
  const res = await fetch(eng.url, { method: 'POST', headers, body: JSON.stringify({ model: eng.model, max_tokens: 2048, messages }) });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    const err = new Error(e.error?.message || eng.prov + ' error ' + res.status);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

// Sends one chat-completion request, automatically failing over across providers/models on 429 or error.
async function chatWithRetry(connections, messages, onStatus) {
  const chain = buildEngineChain(connections);
  if (!chain.length) throw new Error('No AI provider connected — add a free API key in the extension popup.');
  let lastErr;
  for (let i = 0; i < chain.length; i++) {
    const eng = chain[i];
    try {
      const text = await callEngine(eng, messages);
      if (text) return text;
      lastErr = new Error('Empty response from ' + eng.prov);
      continue;
    } catch (err) {
      lastErr = err;
      if (err.status === 429) {
        const hasNext = i < chain.length - 1;
        if (hasNext) {
          onStatus?.(`${eng.prov} busy, switching engine…`);
          continue;
        }
        const wait = parseRetryAfter(err.message);
        onStatus?.(`All engines busy, retrying in ${Math.ceil(wait / 1000)}s…`);
        await new Promise(r => setTimeout(r, wait));
        try {
          const text = await callEngine(eng, messages);
          if (text) return text;
        } catch (err2) {
          lastErr = err2;
        }
      }
    }
  }
  throw lastErr || new Error('All AI engines are busy — try again in a moment.');
}

// Generates a single section of the document. Returns plain text (markdown-lite: short paragraphs, occasional bullet lists).
export async function generateSection(connections, systemPrompt, userPrompt, onStatus) {
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
  return chatWithRetry(connections, messages, onStatus);
}

export function hasAnyKey(connections) {
  return Boolean((connections || []).some(c => c?.key && c?.providerId));
}

// Verifies a single key actually works against its provider with a minimal request.
// Used by the popup's "Detect" button to flip a connection's status to green/red.
export async function testProviderKey(providerId, key) {
  const provider = getProvider(providerId);
  if (!provider) return { ok: false, error: 'Unknown provider.' };
  const eng = { prov: provider.id, model: provider.models[0], url: provider.url, key, authStyle: provider.authStyle };
  try {
    await callEngine(eng, [{ role: 'user', content: 'Reply with OK.' }]);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
