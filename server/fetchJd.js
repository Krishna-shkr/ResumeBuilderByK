// Fetch a job description from a URL. Best-effort: many job sites (LinkedIn,
// Naukri, Indeed) hide their JD behind login walls / bot protection and will
// return a sign-in page instead of the posting. We detect that and tell the
// caller to paste the JD text instead. Public company career pages and simpler
// boards usually work.

const BLOCKED_HINTS = [
  'sign in', 'log in', 'login', 'join now', 'authwall', 'captcha',
  'verify you are human', 'enable javascript', 'access denied', 'are you a robot',
];

// Strip tags, scripts, styles → readable text.
function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|h[1-6]|br|tr|section)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&#39;/gi, "'").replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

// Some sites embed the JD as JSON-LD (schema.org JobPosting) — the reliable path.
function extractJsonLdJd(html) {
  const blocks = [...String(html).matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const b of blocks) {
    try {
      const data = JSON.parse(b[1].trim());
      const items = Array.isArray(data) ? data : (data['@graph'] || [data]);
      for (const it of items) {
        if (it && (it['@type'] === 'JobPosting' || (Array.isArray(it['@type']) && it['@type'].includes('JobPosting')))) {
          const desc = it.description || '';
          const title = it.title || '';
          const text = htmlToText(`${title}\n\n${desc}`);
          if (text.length > 120) return text;
        }
      }
    } catch (_) { /* not valid JSON-LD, ignore */ }
  }
  return null;
}

/**
 * @returns {Promise<{ text: string }>} the extracted JD text
 * @throws  Error with .code 'BLOCKED' | 'TOO_SHORT' | 'BAD_URL' | 'FETCH_FAILED'
 */
async function fetchJdFromUrl(url) {
  let u;
  try { u = new URL(url); } catch (_) {
    const e = new Error('That does not look like a valid URL.'); e.code = 'BAD_URL'; throw e;
  }
  if (!/^https?:$/.test(u.protocol)) {
    const e = new Error('Only http(s) links are supported.'); e.code = 'BAD_URL'; throw e;
  }

  let res;
  try {
    res = await fetch(u.href, {
      redirect: 'follow',
      headers: {
        // A realistic UA improves the odds on public pages.
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    const err = new Error('Could not reach that URL (' + (e.name === 'TimeoutError' ? 'timed out' : e.message) + ').');
    err.code = 'FETCH_FAILED'; throw err;
  }

  if (res.status === 401 || res.status === 403) {
    const e = new Error('That site requires sign-in / blocks automated access. Paste the job description text instead.');
    e.code = 'BLOCKED'; throw e;
  }
  if (!res.ok) {
    const e = new Error('The page returned HTTP ' + res.status + '. Paste the job description text instead.');
    e.code = 'FETCH_FAILED'; throw e;
  }

  const html = await res.text();

  // Prefer structured JobPosting data when present.
  const jsonLd = extractJsonLdJd(html);
  if (jsonLd) return { text: jsonLd };

  const text = htmlToText(html);
  const lower = text.toLowerCase().slice(0, 600);

  // Heuristic: a short page dominated by login prompts is a wall, not a JD.
  const looksBlocked = BLOCKED_HINTS.some((h) => lower.includes(h)) && text.length < 900;
  if (looksBlocked) {
    const e = new Error('That link shows a sign-in / verification page, not the job description. Paste the JD text instead.');
    e.code = 'BLOCKED'; throw e;
  }
  if (text.length < 200) {
    const e = new Error('Could not find enough job-description text on that page. Paste the JD text instead.');
    e.code = 'TOO_SHORT'; throw e;
  }

  // Cap what we return so a huge page doesn't blow up the tailor prompt.
  return { text: text.slice(0, 12000) };
}

module.exports = { fetchJdFromUrl };
