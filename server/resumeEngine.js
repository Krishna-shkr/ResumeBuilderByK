/* eslint-disable no-console */
// Render engine — ported from resume-build/build.js, refactored to take a
// `resume` object as an argument. Layout lives entirely here in code, so no
// text edit (by the user or the AI) can ever move or misalign an element.
const puppeteer = require('puppeteer');
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  BorderStyle,
} = require('docx');

function escape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Return each skill category's value with any hidden tokens removed. Hidden
// tokens live in r.hiddenSkills (normalized, lowercased). This is how the app
// lets a user drop JD-irrelevant technologies from the Skills section only —
// bullets and project stacks are untouched. A category whose tokens are all
// hidden is dropped entirely so no empty "Category:" line is rendered.
function visibleSkills(r) {
  const hidden = new Set((r.hiddenSkills || []).map((t) => String(t).trim().toLowerCase()));
  if (!hidden.size) return r.skills || [];
  const out = [];
  for (const [k, v] of r.skills || []) {
    const kept = String(v)
      .split(/\s*,\s*/)
      .filter((tok) => tok && !hidden.has(tok.trim().toLowerCase()));
    if (kept.length) out.push([k, kept.join(', ')]);
  }
  return out;
}

// ---------- HTML (used as the PDF source AND the browser live preview) ----------
// `scale` (0.80–1.0) uniformly shrinks font size and vertical spacing so the
// auto-fit routine can compress content onto 2 pages without changing layout
// structure. scale = 1 is the original design.
function buildHtml(r, scale = 1) {
  const s = Math.max(0.8, Math.min(1, scale));
  const base = (11.5 * s).toFixed(2);   // body font size in pt
  const sp = s;                          // spacing multiplier
  const skillsHtml = visibleSkills(r)
    .map(([k, v]) => `<p class="skill"><strong>${escape(k)}:</strong> ${escape(v)}</p>`)
    .join('\n');

  const expHtml = (r.experience || [])
    .map(
      (e) => `
        <div class="job">
          <p class="role">${escape(e.role)}</p>
          <p class="meta"><strong>${escape(e.company)}</strong> — ${escape(e.location)} · <em>${escape(e.dates)}</em></p>
          <ul>
            ${(e.bullets || []).map((b) => `<li>${escape(b)}</li>`).join('\n')}
          </ul>
        </div>`
    )
    .join('\n');

  const projHtml = (r.projects || [])
    .map(
      (p) => `
        <div class="project">
          <p class="projectName">${escape(p.name)}</p>
          <p class="stack"><em>${escape(p.stack)}</em></p>
          <ul>
            ${(p.bullets || []).map((b) => `<li>${escape(b)}</li>`).join('\n')}
          </ul>
        </div>`
    )
    .join('\n');

  const eduHtml = (r.education || [])
    .map(
      (e) => `
        <div class="edu">
          <p class="eduDegree"><strong>${escape(e.degree)}</strong> — ${escape(e.school)} · <span class="eduDetail">${escape(e.detail)}</span></p>
        </div>`
    )
    .join('\n');

  const certsHtml = (r.certifications || [])
    .map((c) => `<li><strong>${escape(c)}</strong></li>`)
    .join('\n');

  const additionalHtml = (r.additional || [])
    .map(([k, v]) => `<p class="addl"><strong>${escape(k)}:</strong> ${escape(v)}</p>`)
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escape(r.name)} — Resume</title>
<style>
  @page { size: Letter; margin: 0.7in; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    color: #1f1f1f;
    font-family: Calibri, Arial, "Helvetica Neue", Helvetica, sans-serif;
    font-size: ${base}pt;
    line-height: ${(1.4 * sp).toFixed(3)};
  }
  h1 {
    font-size: ${(24 * s).toFixed(2)}pt;
    font-weight: 700;
    margin: 0;
    letter-spacing: 0.4px;
  }
  .legal { font-style: italic; color: #555; margin: ${(2 * sp).toFixed(1)}px 0 ${(6 * sp).toFixed(1)}px; font-size: ${(11 * s).toFixed(2)}pt; }
  .title { font-weight: 600; margin: 0 0 2px; font-size: ${(12 * s).toFixed(2)}pt; }
  .contact, .cert { margin: 1px 0; font-size: ${(11 * s).toFixed(2)}pt; color: #333; }
  hr.rule {
    border: 0;
    border-top: 1px solid #c8c8c8;
    margin: ${(12 * sp).toFixed(1)}px 0 ${(8 * sp).toFixed(1)}px;
  }
  h2 {
    font-size: ${(13 * s).toFixed(2)}pt;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin: ${(16 * sp).toFixed(1)}px 0 ${(7 * sp).toFixed(1)}px;
    padding-bottom: 3px;
    border-bottom: 1px solid #d8d8d8;
    color: #1f1f1f;
  }
  p { margin: ${(4 * sp).toFixed(1)}px 0; }
  ul { margin: ${(5 * sp).toFixed(1)}px 0 ${(8 * sp).toFixed(1)}px 20px; padding: 0; }
  li { margin: ${(3 * sp).toFixed(1)}px 0; }
  .skill { margin: ${(4 * sp).toFixed(1)}px 0; }
  .job, .project, .edu { margin-bottom: ${(8 * sp).toFixed(1)}px; }
  .role, .projectName { font-weight: 700; margin: ${(6 * sp).toFixed(1)}px 0 1px; font-size: ${(12 * s).toFixed(2)}pt; }
  .meta, .stack { color: #444; margin: 1px 0 ${(3 * sp).toFixed(1)}px; font-size: ${(11 * s).toFixed(2)}pt; }
  .eduDegree { margin: ${(3 * sp).toFixed(1)}px 0; font-size: ${(11.5 * s).toFixed(2)}pt; }
  .eduDetail { color: #444; }
  .eduNote { font-style: italic; color: #555; margin-top: ${(5 * sp).toFixed(1)}px; font-size: ${(11 * s).toFixed(2)}pt; }
  .addl { margin: ${(3 * sp).toFixed(1)}px 0; }
</style>
</head>
<body>
  <header>
    <h1>${escape(r.name)}</h1>
    <p class="legal">${escape(r.legalName)}</p>
    <p class="title">${escape(r.title)}</p>
    <p class="contact">${escape(r.contact)}</p>
    <p class="cert">${escape(r.cert)}</p>
  </header>
  <hr class="rule" />

  <h2>Professional Summary</h2>
  <p>${escape(r.summary)}</p>

  <h2>Technical Skills</h2>
  ${skillsHtml}

  <h2>Professional Experience</h2>
  ${expHtml}

  <h2>Key Projects</h2>
  ${projHtml}

  <h2>Education</h2>
  ${eduHtml}
  <p class="eduNote">${escape(r.educationNote)}</p>

  <h2>Certifications &amp; Languages</h2>
  <ul>${certsHtml}</ul>
  ${additionalHtml}
</body>
</html>`;
}

// ---------- PDF (Puppeteer) with 2-page auto-fit ----------
const MAX_PAGES = 2;
// Scale steps tried from largest to smallest. 1.0 = original design; 0.80 is the
// smallest we allow before readability suffers.
const SCALE_STEPS = [1.0, 0.97, 0.94, 0.91, 0.88, 0.85, 0.82, 0.80];

// Render `html` to a PDF buffer and report how many pages it actually spans.
async function renderAndCount(page, html) {
  await page.setContent(html, { waitUntil: 'networkidle0' });
  const buffer = await page.pdf({
    format: 'Letter',
    printBackground: true,
    margin: { top: '0.7in', right: '0.7in', bottom: '0.7in', left: '0.7in' },
    preferCSSPageSize: true,
  });
  // Letter content height at 96dpi minus 0.7in top+bottom margins: (11 - 1.4)*96
  const CONTENT_PX = (11 - 1.4) * 96;
  const pages = await page.evaluate((h) => {
    return Math.max(1, Math.ceil(document.body.scrollHeight / h));
  }, CONTENT_PX);
  return { buffer, pages };
}

// Auto-fit to <= 2 pages by stepping the scale down. Returns the fitted buffer
// plus metadata so callers can warn the user if it still overflows at min scale.
// Never drops content — only compresses spacing/font within a safe range.
async function fitPdf(r) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    let last = null;
    for (const scale of SCALE_STEPS) {
      const res = await renderAndCount(page, buildHtml(r, scale));
      last = { ...res, scale };
      if (res.pages <= MAX_PAGES) {
        return { buffer: res.buffer, pages: res.pages, scale, fit: true };
      }
    }
    // Even at min scale it overflows — return the smallest version + fit:false.
    return { buffer: last.buffer, pages: last.pages, scale: last.scale, fit: false };
  } finally {
    await browser.close();
  }
}

// Backwards-compatible: return just the fitted PDF buffer.
async function buildPdf(r) {
  const { buffer } = await fitPdf(r);
  return buffer;
}

// Measure page count without keeping the PDF — used by the live preview badge.
// Returns { pages, scale, fit } describing the best fit found.
async function measurePages(r) {
  const { pages, scale, fit } = await fitPdf(r);
  return { pages, scale, fit };
}

// ---------- DOCX ----------
async function buildDocx(r) {
  const children = [];

  // DOCX sizes are half-points (size:23 = 11.5pt body, size:48 = 24pt heading)
  children.push(
    new Paragraph({
      alignment: AlignmentType.LEFT,
      children: [new TextRun({ text: r.name, bold: true, size: 48 })],
    }),
    new Paragraph({
      children: [new TextRun({ text: r.legalName, italics: true, color: '555555', size: 22 })],
    }),
    new Paragraph({
      children: [new TextRun({ text: r.title, bold: true, size: 24 })],
    }),
    new Paragraph({
      children: [new TextRun({ text: r.contact, size: 22 })],
    }),
    new Paragraph({
      children: [new TextRun({ text: r.cert, size: 22 })],
      spacing: { after: 140 },
    })
  );

  children.push(sectionHeading('PROFESSIONAL SUMMARY'));
  children.push(body(r.summary));

  children.push(sectionHeading('TECHNICAL SKILLS'));
  for (const [k, v] of visibleSkills(r)) {
    children.push(
      new Paragraph({
        spacing: { before: 40, after: 40 },
        children: [
          new TextRun({ text: `${k}: `, bold: true, size: 23 }),
          new TextRun({ text: v, size: 23 }),
        ],
      })
    );
  }

  children.push(sectionHeading('PROFESSIONAL EXPERIENCE'));
  for (const e of r.experience || []) {
    children.push(
      new Paragraph({
        spacing: { before: 100, after: 20 },
        children: [new TextRun({ text: e.role, bold: true, size: 24 })],
      }),
      new Paragraph({
        spacing: { after: 40 },
        children: [
          new TextRun({ text: e.company, bold: true, size: 23 }),
          new TextRun({ text: ` — ${e.location} · `, size: 23 }),
          new TextRun({ text: e.dates, italics: true, size: 23 }),
        ],
      })
    );
    for (const b of e.bullets || []) children.push(bullet(b));
  }

  children.push(sectionHeading('KEY PROJECTS'));
  for (const p of r.projects || []) {
    children.push(
      new Paragraph({
        spacing: { before: 100, after: 20 },
        children: [new TextRun({ text: p.name, bold: true, size: 24 })],
      }),
      new Paragraph({
        spacing: { after: 40 },
        children: [new TextRun({ text: p.stack, italics: true, color: '444444', size: 22 })],
      })
    );
    for (const b of p.bullets || []) children.push(bullet(b));
  }

  children.push(sectionHeading('EDUCATION'));
  for (const e of r.education || []) {
    children.push(
      new Paragraph({
        spacing: { before: 50, after: 30 },
        children: [
          new TextRun({ text: e.degree, bold: true, size: 23 }),
          new TextRun({ text: ` — ${e.school} · ${e.detail}`, size: 23 }),
        ],
      })
    );
  }
  children.push(body(r.educationNote, { italic: true }));

  children.push(sectionHeading('CERTIFICATIONS & LANGUAGES'));
  for (const c of r.certifications || []) children.push(bullet(c, { bold: true }));
  for (const [k, v] of r.additional || []) {
    children.push(
      new Paragraph({
        spacing: { before: 40, after: 40 },
        children: [
          new TextRun({ text: `${k}: `, bold: true, size: 23 }),
          new TextRun({ text: v, size: 23 }),
        ],
      })
    );
  }

  const doc = new Document({
    creator: r.name || 'Resume Editor',
    title: `${r.name} — Resume`,
    description: 'Resume',
    styles: {
      default: { document: { run: { font: 'Calibri' } } },
    },
    sections: [
      {
        properties: {
          page: { margin: { top: 1008, right: 1008, bottom: 1008, left: 1008 } },
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}

function sectionHeading(text) {
  return new Paragraph({
    spacing: { before: 200, after: 80 },
    border: {
      bottom: { color: 'D8D8D8', space: 1, value: BorderStyle.SINGLE, size: 6 },
    },
    children: [new TextRun({ text, bold: true, size: 26, characterSpacing: 18 })],
  });
}

function body(text, opts = {}) {
  return new Paragraph({
    spacing: { before: 40, after: 40 },
    children: [
      new TextRun({ text, italics: !!opts.italic, bold: !!opts.bold, size: 23 }),
    ],
  });
}

function bullet(text, opts = {}) {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { before: 30, after: 30 },
    children: [new TextRun({ text, bold: !!opts.bold, size: 23 })],
  });
}

module.exports = { buildHtml, buildPdf, buildDocx, fitPdf, measurePages, MAX_PAGES };
