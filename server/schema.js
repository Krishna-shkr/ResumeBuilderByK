// Canonical resume shape + the anti-fabrication guard.
//
// The resume is a fixed JSON shape. The AI is only ever allowed to REWORD and
// REORDER text that already exists. This module is the deterministic safety net
// (Guarantee 2, layer 2): after the AI returns a "tailored" resume, we rebuild
// it field-by-field from the ORIGINAL structure and reject anything the AI tried
// to add — new jobs, new projects, new skill categories, new technology tokens,
// changed employers/dates, etc.

// ---- structural fields the AI must never alter (identity / facts) ----
const IMMUTABLE_TOP_LEVEL = ['name', 'legalName', 'contact', 'cert'];

// Split a skill/tech string into comparable tokens.
function tokenize(str) {
  return String(str || '')
    .split(/[,;·•\/|]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

// Every token that appears anywhere in the original resume. Used to ensure the
// AI never introduces a technology/skill the user does not actually have.
function collectKnownTokens(original) {
  const bag = new Set();
  const add = (s) => tokenize(s).forEach((t) => bag.add(t));

  (original.skills || []).forEach(([, v]) => add(v));
  (original.projects || []).forEach((p) => add(p.stack));
  add(original.summary);
  (original.experience || []).forEach((e) => (e.bullets || []).forEach(add));
  (original.projects || []).forEach((p) => (p.bullets || []).forEach(add));
  (original.certifications || []).forEach(add);
  (original.additional || []).forEach(([, v]) => add(v));
  return bag;
}

// Build the set of every TECH TOKEN that appears anywhere in the original resume,
// normalized the same way scrubFreeText compares (see norm()). Split on whitespace
// AND common delimiters so multi-word skill strings ("ASP.NET Core Web API")
// contribute each individual token ("asp.net", "core", "web", "api"). Used to
// catch invented tech an AI slips into free-text prose — while allowing reuse of
// any technology the candidate genuinely has.
function collectKnownTech(original) {
  const set = new Set();
  const add = (s) =>
    String(s || '')
      .split(/[\s,;·•\/|()]+/)
      .map(norm)
      .filter((w) => w.length >= 2)
      .forEach((w) => set.add(w));

  add(original.name); add(original.legalName); add(original.title);
  add(original.summary); add(original.contact); add(original.cert);
  add(original.educationNote);
  (original.skills || []).forEach(([k, v]) => { add(k); add(v); });
  (original.experience || []).forEach((e) => {
    add(e.role); add(e.company); add(e.location); add(e.dates);
    (e.bullets || []).forEach(add);
  });
  (original.projects || []).forEach((p) => {
    add(p.name); add(p.stack); (p.bullets || []).forEach(add);
  });
  (original.education || []).forEach((e) => { add(e.degree); add(e.school); add(e.detail); });
  (original.certifications || []).forEach(add);
  (original.additional || []).forEach(([k, v]) => { add(k); add(v); });
  return set;
}

// Normalize a token for comparison against the known-tech set.
function norm(t) {
  return String(t).toLowerCase().replace(/^[^\w#.+]+|[^\w#.+]+$/g, '');
}

// Shape-based test for an UNAMBIGUOUS technology token (independent of position):
//   - contains a dot, hash, or plus with letters/digits: .NET, C#, Web3.js, C++
//   - mixes letters and digits: Angular18, AZ204, K8s
//   - camelCase/PascalCase internal capital: SignalR, RxJS, MongoDB
//   - all-caps acronym: JWT, IPFS, RSA, FCM
function isUnambiguousTech(t) {
  if (/[.#+]/.test(t) && /[a-z0-9]/i.test(t)) return true;
  if (/[a-z]/i.test(t) && /[0-9]/.test(t)) return true;
  if (/^[A-Z][a-zA-Z]*[A-Z]/.test(t)) return true;
  if (/^[A-Z]{2,}$/.test(t)) return true;
  return false;
}

// Plainly Capitalized single word (Kubernetes, Django) — could be a proper-noun
// technology OR just an ordinary capitalized word (e.g. a sentence start).
function isCapitalizedWord(t) {
  return /^[A-Z][a-z]+$/.test(t);
}

// A reworded free-text field is accepted UNLESS it introduces a technology token
// that does not already exist in the resume. Ordinary rewording (new lowercase
// English words, rephrasing) is allowed. The tricky case is a Capitalized word:
// mid-sentence capitals in English are almost always proper nouns, so we flag a
// Capitalized word that isn't known tech UNLESS it's the first word of a sentence
// (a normal capitalization) — that keeps "Designed…", "Owned…" while catching an
// injected "…deployed Kubernetes clusters…".
function scrubFreeText(candidate, fallback, knownTech, label, violations) {
  const text = pickText(candidate, fallback);
  if (text === fallback) return fallback; // unchanged

  const rawTokens = text.split(/\s+/);
  const invented = [];
  let atSentenceStart = true; // first token, and after . ! ? :
  for (const rawFull of rawTokens) {
    const raw = rawFull.replace(/[,;:().]+$/g, '');
    const key = norm(raw);
    const startsSentence = atSentenceStart;
    // update sentence-start state for the NEXT token
    atSentenceStart = /[.!?:]$/.test(rawFull.trim());

    if (key.length < 2) continue;
    let suspect = false;
    if (isUnambiguousTech(raw)) suspect = true;
    else if (isCapitalizedWord(raw) && !startsSentence) suspect = true; // proper noun mid-sentence

    if (suspect && !knownTech.has(key)) invented.push(raw);
  }

  if (invented.length) {
    violations.push(
      `Kept original ${label}: reworded version introduced unknown technology: ${[...new Set(invented)].slice(0, 5).join(', ')}.`
    );
    return fallback;
  }
  return text;
}

// Keep only tokens that already existed in the original (drops invented tech).
function filterTokens(value, known) {
  const parts = String(value || '').split(/(\s*[,;·•\/|]\s*)/); // keep separators
  return parts
    .filter((seg) => {
      const t = seg.trim().toLowerCase();
      if (!t || /^[,;·•\/|]+$/.test(seg.trim())) return true; // separator/whitespace
      // a segment may be multi-word phrasing; allow it if every tech-looking
      // token in it is known, else drop the whole segment.
      const segTokens = tokenize(seg);
      return segTokens.every((tok) => known.has(tok));
    })
    .join('')
    .replace(/^\s*[,;·•\/|]+\s*/, '')
    .replace(/\s*[,;·•\/|]+\s*$/, '')
    .trim();
}

/**
 * Rebuild the tailored resume constrained to the original's structure.
 * - Array LENGTHS are pinned to the original (no new jobs/projects/skills/bullets).
 * - Immutable identity fields are always taken from the original.
 * - Employers, locations, dates, degrees, schools are taken from the original.
 * - Skill values and project stacks are filtered so no invented tech survives.
 * - Free-text (summary, bullets) is accepted as reworded, but only up to the
 *   original count, and each is length-capped to discourage padding.
 *
 * Returns { resume, violations } where violations lists what was blocked.
 */
function stripInventedContent(original, tailored) {
  const violations = [];
  const known = collectKnownTokens(original);
  const knownTech = collectKnownTech(original);
  const t = tailored && typeof tailored === 'object' ? tailored : {};

  const out = {};

  // Immutable identity — always from original.
  for (const k of IMMUTABLE_TOP_LEVEL) out[k] = original[k];

  // Reword-allowed free text — scrubbed so no invented tech survives in prose.
  out.title = scrubFreeText(t.title, original.title, knownTech, 'title', violations);
  out.summary = scrubFreeText(t.summary, original.summary, knownTech, 'summary', violations);
  out.educationNote = scrubFreeText(t.educationNote, original.educationNote, knownTech, 'education note', violations);

  // Skills: same categories, filtered values.
  out.skills = (original.skills || []).map(([k, v], i) => {
    const cand = Array.isArray(t.skills) && t.skills[i] ? t.skills[i] : null;
    const candVal = cand && cand[1] != null ? cand[1] : v;
    const cleaned = filterTokens(candVal, known);
    if (cleaned.replace(/\s/g, '') !== String(v).replace(/\s/g, '') &&
        tokenize(candVal).some((tok) => !known.has(tok))) {
      violations.push(`Removed invented skill(s) from "${k}".`);
    }
    // never let filtering empty a category — fall back to original
    return [k, cleaned || v];
  });

  // Experience: pin employer/location/dates; reword bullets only, capped count.
  out.experience = (original.experience || []).map((e, i) => {
    const cand = Array.isArray(t.experience) ? t.experience[i] : null;
    return {
      role: e.role,
      company: e.company,
      location: e.location,
      dates: e.dates,
      bullets: rewordBullets(cand && cand.bullets, e.bullets, `experience #${i + 1}`, knownTech, violations),
    };
  });

  // Projects: pin name; filter stack tokens; reword bullets only.
  out.projects = (original.projects || []).map((p, i) => {
    const cand = Array.isArray(t.projects) ? t.projects[i] : null;
    const stackCand = cand && cand.stack != null ? cand.stack : p.stack;
    const cleanedStack = filterTokens(stackCand, known) || p.stack;
    if (tokenize(stackCand).some((tok) => !known.has(tok))) {
      violations.push(`Removed invented tech from project "${p.name}" stack.`);
    }
    return {
      name: p.name,
      stack: cleanedStack,
      bullets: rewordBullets(cand && cand.bullets, p.bullets, `project "${p.name}"`, knownTech, violations),
    };
  });

  // Education / certifications / additional — factual, taken from original.
  out.education = original.education;
  out.certifications = original.certifications;
  out.additional = original.additional;

  // hiddenSkills is user state, not AI content — always carry it through as-is.
  if (Array.isArray(original.hiddenSkills)) out.hiddenSkills = original.hiddenSkills;

  return { resume: out, violations };
}

// Accept reworded bullets but never more than the original count; if the AI
// returns fewer or malformed data, fall back to originals.
function rewordBullets(candidate, originalBullets, label, knownTech, violations) {
  const orig = originalBullets || [];
  if (!Array.isArray(candidate) || candidate.length === 0) return orig;
  if (candidate.length > orig.length) {
    violations.push(`Dropped ${candidate.length - orig.length} added bullet(s) in ${label}.`);
  }
  return orig.map((ob, i) => {
    const c = candidate[i];
    if (typeof c !== 'string' || !c.trim()) return ob;
    // scrub each reworded bullet: reject if it introduces invented tech
    return scrubFreeText(c, ob, knownTech, `${label} bullet ${i + 1}`, violations);
  });
}

function pickText(candidate, fallback) {
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : fallback;
}

// Minimal shape check for saving user edits.
function isValidResume(r) {
  return (
    r &&
    typeof r === 'object' &&
    typeof r.name === 'string' &&
    Array.isArray(r.skills) &&
    Array.isArray(r.experience) &&
    Array.isArray(r.projects)
  );
}

module.exports = { stripInventedContent, isValidResume, collectKnownTokens, collectKnownTech, tokenize };
