// Multi-provider text generation. Each provider exposes the same contract:
//   generate(model, prompt) -> Promise<string>   (raw model text)
// so tailor.js can treat Gemini and OpenRouter (and future providers)
// uniformly and fall through between them.
//
// No heavy SDK for OpenRouter — it is OpenAI-compatible, so a plain fetch works.
const { GoogleGenerativeAI } = require('@google/generative-ai');

// ---- Google Gemini ----
function geminiAvailable() {
  return !!process.env.GEMINI_API_KEY;
}
async function geminiGenerate(model, prompt) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const m = genAI.getGenerativeModel({
    model,
    generationConfig: { temperature: 0.4, responseMimeType: 'application/json' },
  });
  const result = await m.generateContent(prompt);
  return result.response.text();
}

// ---- OpenRouter (OpenAI-compatible) ----
function openrouterAvailable() {
  return !!process.env.OPENROUTER_API_KEY;
}
async function openrouterGenerate(model, prompt) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      // Optional attribution headers OpenRouter recommends:
      'HTTP-Referer': 'http://localhost',
      'X-Title': 'Resume Editor',
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // Surface status in the message so withRetry / fall-through logic can react
    // (e.g. "429", "503") exactly as it does for Gemini.
    throw new Error(`OpenRouter ${res.status} ${res.statusText}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data && data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : '';
  if (!text) throw new Error('OpenRouter returned empty content');
  return text;
}

const PROVIDERS = {
  gemini: { available: geminiAvailable, generate: geminiGenerate, label: 'Google Gemini' },
  openrouter: { available: openrouterAvailable, generate: openrouterGenerate, label: 'OpenRouter' },
};

function isAvailable(provider) {
  return !!(PROVIDERS[provider] && PROVIDERS[provider].available());
}

async function generate(provider, model, prompt) {
  const p = PROVIDERS[provider];
  if (!p) throw new Error(`Unknown provider: ${provider}`);
  return p.generate(model, prompt);
}

module.exports = { generate, isAvailable, PROVIDERS };
