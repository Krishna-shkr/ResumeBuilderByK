/* eslint-disable no-console */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');

const { buildHtml, buildDocx, fitPdf, measurePages, MAX_PAGES } = require('./resumeEngine');
const { tailorResume, availableChoices } = require('./tailor');
const { isValidResume } = require('./schema');

const PORT = process.env.PORT || 3000;
const DATA_PATH = path.join(__dirname, '..', 'data', 'resume.json');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const app = express();
app.use(express.json({ limit: '2mb' }));
// Disable caching so edits to the UI always load fresh (no stale app.js).
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
app.use(express.static(PUBLIC_DIR, { etag: false, lastModified: false }));

function loadResume() {
  return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
}

function safeName(r) {
  return String(r.name || 'resume').replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '');
}

// ---- current stored resume ----
app.get('/api/resume', (req, res) => {
  try {
    res.json(loadResume());
  } catch (e) {
    res.status(500).json({ error: 'Could not read resume data.' });
  }
});

// ---- save edits ----
app.post('/api/resume', (req, res) => {
  const r = req.body;
  if (!isValidResume(r)) return res.status(400).json({ error: 'Invalid resume shape.' });
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(r, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not save resume.' });
  }
});

// ---- live HTML preview (rendered by the real engine) ----
app.post('/api/preview', (req, res) => {
  const r = req.body;
  if (!isValidResume(r)) return res.status(400).json({ error: 'Invalid resume shape.' });
  res.type('html').send(buildHtml(r));
});

// ---- list configured AI models for the UI dropdown ----
app.get('/api/models', (req, res) => {
  res.json({ choices: availableChoices() });
});

// ---- tailor to a job description ----
app.post('/api/tailor', async (req, res) => {
  const { resume, jobDescription, model } = req.body || {};
  if (!isValidResume(resume)) return res.status(400).json({ error: 'Invalid resume shape.' });
  try {
    const { resume: tailored, violations, suggestedHidden, usedModel } =
      await tailorResume(resume, jobDescription, model);
    res.json({ resume: tailored, violations, suggestedHidden, usedModel });
  } catch (e) {
    const status =
      e.code === 'NO_API_KEY' || e.code === 'NO_JD' ? 400 :
      e.code === 'UPSTREAM_BUSY' ? 503 : 502;
    res.status(status).json({ error: e.message, code: e.code || 'TAILOR_FAILED' });
  }
});

// ---- 2-page fit status (for the live badge; no download) ----
app.post('/api/pagecount', async (req, res) => {
  const r = req.body;
  if (!isValidResume(r)) return res.status(400).json({ error: 'Invalid resume shape.' });
  try {
    const { pages, scale, fit } = await measurePages(r);
    res.json({ pages, scale, fit, maxPages: MAX_PAGES, suggestion: fit ? null : trimSuggestion(r) });
  } catch (e) {
    res.status(500).json({ error: 'Page measurement failed: ' + e.message });
  }
});

// Identify the section a user could trim to get back under the limit — the one
// contributing the most text. Never auto-cuts; only advises.
function trimSuggestion(r) {
  const sizes = [];
  const chars = (arr) => (arr || []).reduce((n, b) => n + String(b).length, 0);
  (r.experience || []).forEach((e, i) =>
    sizes.push({ where: `Experience #${i + 1} (${e.company})`, n: chars(e.bullets) })
  );
  (r.projects || []).forEach((p, i) =>
    sizes.push({ where: `Project "${p.name}"`, n: chars(p.bullets) })
  );
  sizes.push({ where: 'Professional Summary', n: (r.summary || '').length });
  sizes.sort((a, b) => b.n - a.n);
  return sizes[0] ? sizes[0].where : null;
}

// ---- export PDF / DOCX ----
app.post('/api/export', async (req, res) => {
  const { resume, format } = req.body || {};
  if (!isValidResume(resume)) return res.status(400).json({ error: 'Invalid resume shape.' });
  const base = safeName(resume) + '_Resume';
  try {
    if (format === 'pdf') {
      const { buffer, pages, fit } = await fitPdf(resume);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${base}.pdf"`);
      res.setHeader('X-Resume-Pages', String(pages));
      res.setHeader('X-Resume-Fit', fit ? '1' : '0');
      return res.send(buffer);
    }
    if (format === 'docx') {
      const buf = await buildDocx(resume);
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );
      res.setHeader('Content-Disposition', `attachment; filename="${base}.docx"`);
      return res.send(buf);
    }
    res.status(400).json({ error: 'format must be "pdf" or "docx".' });
  } catch (e) {
    console.error('Export failed:', e);
    res.status(500).json({ error: 'Export failed: ' + e.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n  Resume Editor running →  http://localhost:${PORT}\n`);
  if (!process.env.GEMINI_API_KEY) {
    console.log('  Note: GEMINI_API_KEY not set — build/edit/export work; "Tailor" needs a key.\n');
  }
});
