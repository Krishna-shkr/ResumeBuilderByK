// JD-aware tailoring via the free Google Gemini API.
//
// Guarantee 2 (no invented experience) is enforced in layers:
//   1. The prompt structurally forbids adding content (here).
//   2. schema.stripInventedContent() deterministically removes anything the AI
//      added anyway (belt-and-suspenders — the AI is not trusted).
//   3. The UI shows a diff for the user to approve (frontend).
const { stripInventedContent, collectKnownTokens } = require('./schema');
const { generate, isAvailable, PROVIDERS } = require('./providers');

// The auto-fallback chain: {provider, model} entries tried in order. Each entry
// is skipped if its provider isn't configured (no API key). Different providers
// mean true redundancy — if the whole Google account is down/quota'd, OpenRouter
// still works. Each model also has its own quota bucket, so a 429 on one recovers
// by falling to the next. Free OpenRouter models use the ":free" suffix.
// OpenRouter free slugs verified live via GET /api/v1/models (pricing.prompt === 0).
// Free slugs change over time — re-check with:
//   curl https://openrouter.ai/api/v1/models -H "Authorization: Bearer $OPENROUTER_API_KEY"
// and keep only ids ending in ":free". (deepseek-chat-v3.1:free was retired to paid.)
const CHAIN = [
  { provider: 'gemini', model: process.env.GEMINI_MODEL || 'gemini-flash-latest' },
  { provider: 'gemini', model: 'gemini-2.5-flash' },
  { provider: 'gemini', model: 'gemini-2.0-flash' },
  { provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct:free' },
  { provider: 'openrouter', model: 'qwen/qwen3-next-80b-a3b-instruct:free' },
  { provider: 'openrouter', model: 'google/gemma-4-31b-it:free' },
];

// The set of concrete choices a user may force from the UI (Auto = the full chain).
// Exposed via /api/models so the dropdown only shows configured providers.
function availableChoices() {
  const seen = new Set();
  return CHAIN.filter((c) => isAvailable(c.provider))
    .filter((c) => {
      const id = `${c.provider}:${c.model}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map((c) => ({
      id: `${c.provider}:${c.model}`,
      provider: c.provider,
      model: c.model,
      label: `${PROVIDERS[c.provider].label} — ${c.model.replace(':free', '')}`,
    }));
}

function buildPrompt(resume, jobDescription, knownTokens) {
  return `You are a resume-tailoring assistant. Your ONLY job is to REWORD and REORDER
the candidate's EXISTING resume content so it speaks more directly to the target
job description. You are strictly constrained:

ABSOLUTE RULES — violating any of these produces an unusable result:
1. NEVER invent, add, or imply any skill, technology, tool, employer, job title,
   date, degree, certification, metric, or achievement that is not already
   present in the ORIGINAL resume below.
2. NEVER add new array items: no new jobs, no new projects, no new skill
   categories, and no additional bullets. Keep the SAME number of bullets per
   section (you may reword each in place).
3. NEVER change: name, legalName, contact, cert, employer companies, locations,
   employment dates, project names, education, degrees, schools, or dates.
4. You MAY: rephrase the summary and each bullet to emphasize aspects relevant
   to the job description; reorder skill tokens WITHIN a category to put the most
   JD-relevant ones first (but do not add tokens); tighten wording.
5. Only use technologies/terms from this allowed list (case-insensitive). Do NOT
   introduce any term outside it:
   ${Array.from(knownTokens).join(', ')}

ADDITIONALLY, identify technologies in the candidate's Technical Skills that are
NOT relevant to this job description — technologies the interviewer is unlikely to
ask about for THIS role — so the candidate can optionally hide them and avoid
being quizzed on off-topic tech. Put these in a "suggestedHidden" array. Rules for
suggestedHidden:
 - Only include exact skill tokens that appear in the candidate's skills list.
 - Only include ones clearly unrelated to the JD. If the JD mentions or implies a
   technology (or its ecosystem), do NOT suggest hiding it.
 - Be conservative: when unsure, leave it OUT of suggestedHidden.
 - Never suggest hiding core general skills the role needs.

Return ONLY valid JSON with this shape: the SAME structure as the original resume
(same keys, same array lengths) PLUS a top-level "suggestedHidden" array of
strings. No markdown, no commentary, no code fences.

TARGET JOB DESCRIPTION:
"""
${jobDescription}
"""

ORIGINAL RESUME (JSON):
${JSON.stringify(resume, null, 2)}
`;
}

function extractJson(text) {
  // Gemini sometimes wraps output in ```json fences despite instructions.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object found in model output.');
  return JSON.parse(raw.slice(start, end + 1));
}

/**
 * Tailor a resume to a job description.
 * Returns { resume: <safe tailored resume>, violations: string[] }.
 * Throws if the API key is missing or the API call fails.
 */
// `preferred` is an optional "provider:model" id from the UI. When set, that
// entry is tried first; the rest of the chain still serves as fallback.
async function tailorResume(resume, jobDescription, preferred) {
  if (!jobDescription || !jobDescription.trim()) {
    const err = new Error('Job description is empty.');
    err.code = 'NO_JD';
    throw err;
  }

  // Build the effective chain: only configured providers, de-duped, preferred first.
  const seenIds = new Set();
  let chain = CHAIN.filter((c) => isAvailable(c.provider)).filter((c) => {
    const id = `${c.provider}:${c.model}`;
    if (seenIds.has(id)) return false;
    seenIds.add(id);
    return true;
  });
  if (!chain.length) {
    const err = new Error(
      'No AI provider is configured. Set GEMINI_API_KEY or OPENROUTER_API_KEY in .env ' +
      '(free keys: https://aistudio.google.com/app/apikey or https://openrouter.ai/keys).'
    );
    err.code = 'NO_API_KEY';
    throw err;
  }
  if (preferred) {
    const [pp, ...rest] = preferred.split(':');
    const pm = rest.join(':');
    const match = chain.find((c) => c.provider === pp && c.model === pm);
    if (match) chain = [match, ...chain.filter((c) => c !== match)];
  }

  const known = collectKnownTokens(resume);
  const prompt = buildPrompt(resume, jobDescription, known);

  // Try each provider/model with retry; fall through on failure/overload.
  let text, usedModel, lastErr;
  for (const { provider, model } of chain) {
    try {
      text = await withRetry(() => generate(provider, model, prompt));
      usedModel = `${provider}:${model}`;
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (text == null) {
    const err = new Error(
      'All AI providers failed or are overloaded (tried ' + chain.length + '). ' +
      (lastErr ? 'Last error: ' + String(lastErr.message).slice(0, 160) : '') +
      ' Please try again in a moment.'
    );
    err.code = 'UPSTREAM_BUSY';
    throw err;
  }

  let candidate;
  try {
    candidate = extractJson(text);
  } catch (e) {
    const err = new Error('The AI returned malformed output. Please try again.');
    err.code = 'BAD_OUTPUT';
    throw err;
  }

  // Deterministic guard — the AI is not trusted; this is what actually enforces
  // "no invented experience".
  const { resume: safe, violations } = stripInventedContent(resume, candidate);

  // Validate the AI's "hide these off-topic tech" suggestions: keep only tokens
  // that actually exist in the candidate's skills (never let it invent a chip),
  // and drop anything already hidden.
  const suggestedHidden = validateHiddenSuggestions(resume, candidate.suggestedHidden);

  return { resume: safe, violations, suggestedHidden, usedModel };
}

// Build the exact set of comma-separated skill tokens present in the resume, then
// keep only the AI's suggestions that match one (case-insensitive), returning the
// resume's original casing. Prevents the AI from suggesting anything off-list.
function validateHiddenSuggestions(resume, suggested) {
  if (!Array.isArray(suggested)) return [];
  const byLower = new Map();
  for (const [, v] of resume.skills || []) {
    for (const tok of String(v).split(/\s*,\s*/)) {
      const t = tok.trim();
      if (t) byLower.set(t.toLowerCase(), t);
    }
  }
  const alreadyHidden = new Set((resume.hiddenSkills || []).map((t) => String(t).toLowerCase()));
  const out = [];
  const seen = new Set();
  for (const s of suggested) {
    const key = String(s).trim().toLowerCase();
    if (byLower.has(key) && !alreadyHidden.has(key) && !seen.has(key)) {
      seen.add(key);
      out.push(byLower.get(key));
    }
  }
  return out;
}

// Retry transient upstream failures (503 high-demand, 429 rate-limit, 500) with
// exponential backoff. Non-transient errors (bad key, bad request) throw at once.
async function withRetry(fn, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = String(e && e.message);
      // Retry only overload/5xx on the SAME model. A 429 is a quota limit —
      // retrying the same model won't help, so throw fast and let the caller
      // fall through to the next model (which has its own quota).
      const retryable = /\b(500|503|Service Unavailable|high demand|overloaded)\b/i.test(msg);
      if (!retryable || i === attempts - 1) throw e;
      await new Promise((r) => setTimeout(r, 1200 * Math.pow(2, i))); // 1.2s, 2.4s
    }
  }
  throw lastErr;
}

module.exports = { tailorResume, availableChoices };
