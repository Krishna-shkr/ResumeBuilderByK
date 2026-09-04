/* ============================================================
   Resume Tailor — frontend.
   The UI adapts to the API; it never re-implements resume styling
   (the preview iframe is ground truth from the export engine).
   Backend contract (unchanged):
     GET  /api/resume         -> resume JSON
     POST /api/resume         -> save (200 {ok})
     POST /api/preview        -> rendered HTML
     GET  /api/models         -> {choices:[{id,label}]}
     POST /api/tailor         -> {resume, violations, suggestedHidden, usedModel}
     POST /api/pagecount      -> {pages, scale, fit, maxPages, suggestion}
     POST /api/export         -> pdf/docx blob (+ X-Resume-Pages/Fit headers)
   ============================================================ */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

let resume = null;          // working copy (source of truth for edits)
let pendingTailored = null; // awaiting diff approval
let pendingHidden = [];      // AI hide-suggestions awaiting approval
let dirty = false;
let currentTemplate = 'classic'; // download/preview design

/* ---------- fetch helper ---------- */
async function api(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { msg = (await res.json()).error || msg; } catch (_) {}
    const err = new Error(msg); err.status = res.status; throw err;
  }
  return res;
}
const jsonBody = (obj) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });

/* ---------- toast ---------- */
let toastTimer = null;
function toast(msg, kind = '', ms = 3200) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast' + (kind ? ' ' + kind : ''); t.hidden = false;
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(() => (t.hidden = true), ms);
}

/* ---------- save-state indicator ---------- */
function setSaveState(state, text) {
  const el = $('#saveIndicator');
  el.className = 'save-indicator ' + state;
  $('#saveText').textContent = text;
}
function markDirty() {
  dirty = true;
  setSaveState('dirty', 'Unsaved changes');
  scheduleAutosave();
}

/* ============================================================
   Load
   ============================================================ */
async function load() {
  try {
    resume = await (await api('/api/resume')).json();
  } catch (e) {
    setSaveState('error', 'Load failed');
    toast('Could not load resume: ' + e.message, 'err', 0);
    return;
  }
  resume.hiddenSkills = resume.hiddenSkills || [];
  bindSimpleFields();
  renderAll();
  updateCounts();
  setSaveState('saved', 'Saved');
  schedulePreview(0);
  loadModels();
  loadTemplates();
}

// Populate the template selector and remember the choice (per-browser).
async function loadTemplates() {
  const sel = $('#templateSelect');
  const LABELS = { classic: 'Classic', twocolumn: 'Two-column', ats: 'ATS-plain' };
  try {
    const { templates } = await (await api('/api/templates')).json();
    sel.innerHTML = '';
    templates.forEach((t) => {
      const o = document.createElement('option');
      o.value = t; o.textContent = LABELS[t] || t; sel.appendChild(o);
    });
    let saved = 'classic';
    try { saved = localStorage.getItem('rt-template') || 'classic'; } catch (_) {}
    if (templates.includes(saved)) currentTemplate = saved;
    sel.value = currentTemplate;
  } catch (_) { /* keep default */ }
  sel.addEventListener('change', () => {
    currentTemplate = sel.value;
    try { localStorage.setItem('rt-template', currentTemplate); } catch (_) {}
    schedulePreview(0); // re-render preview + badge in the chosen template
  });
}

function renderAll() {
  renderSkills();
  renderExperience();
  renderProjects();
  renderEducation();
  renderCertifications();
  renderAdditional();
  autoGrowAll();
}

async function loadModels() {
  try {
    const { choices } = await (await api('/api/models')).json();
    const sel = $('#modelSelect');
    choices.forEach((c) => {
      const o = document.createElement('option');
      o.value = c.id; o.textContent = c.label; sel.appendChild(o);
    });
    if (!choices.length) $('#usedModel').textContent = 'No AI provider configured — set a key in .env';
  } catch (_) { /* keep Auto only */ }
}

/* ============================================================
   Simple top-level fields
   ============================================================ */
function bindSimpleFields() {
  $$('[data-path]').forEach((el) => {
    const key = el.getAttribute('data-path');
    el.value = resume[key] != null ? resume[key] : '';
    el.addEventListener('input', () => { resume[key] = el.value; autoGrow(el); markDirty(); schedulePreview(); });
  });
}

/* ============================================================
   Skills (category value editable + per-tech hide chips)
   ============================================================ */
function isHidden(tok) {
  return (resume.hiddenSkills || []).some((h) => h.toLowerCase() === tok.trim().toLowerCase());
}
function setHidden(tok, hide) {
  resume.hiddenSkills = resume.hiddenSkills || [];
  const t = tok.trim();
  const i = resume.hiddenSkills.findIndex((h) => h.toLowerCase() === t.toLowerCase());
  if (hide && i === -1) resume.hiddenSkills.push(t);
  if (!hide && i !== -1) resume.hiddenSkills.splice(i, 1);
}
function renderSkills() {
  const wrap = $('#skills'); wrap.innerHTML = '';
  resume.skills.forEach((pair, i) => {
    const g = document.createElement('div'); g.className = 'skill-group';
    const head = document.createElement('div'); head.className = 'skill-group-head';
    const label = document.createElement('input'); label.className = 'skill-group-label-input';
    label.value = pair[0]; label.placeholder = 'Category'; label.setAttribute('aria-label', 'Skill category name');
    label.addEventListener('input', () => { resume.skills[i][0] = label.value; markDirty(); schedulePreview(); });
    const del = document.createElement('button'); del.type = 'button'; del.className = 'inline-del';
    del.title = 'Remove category'; del.innerHTML = '&times;';
    del.addEventListener('click', () => { resume.skills.splice(i, 1); renderSkills(); updateCounts(); markDirty(); schedulePreview(); });
    head.append(label, del);
    const ta = document.createElement('textarea'); ta.className = 'grow'; ta.rows = 2; ta.value = pair[1];
    ta.placeholder = 'Comma-separated skills'; ta.setAttribute('aria-label', pair[0] + ' skills');
    ta.addEventListener('input', () => { resume.skills[i][1] = ta.value; autoGrow(ta); renderChips(); markDirty(); schedulePreview(); });
    const chips = document.createElement('div'); chips.className = 'chips';
    g.append(head, ta, chips); g._chips = chips; wrap.appendChild(g);
    requestAnimationFrame(() => autoGrow(ta));
  });
  const hint = document.createElement('div'); hint.className = 'chip-hint';
  hint.textContent = 'Click a chip to hide that tech from the resume (reversible). Struck-through = hidden.';
  wrap.appendChild(hint);
  wrap.appendChild(addButton('+ Add skill category', () => {
    resume.skills.push(['', '']); renderSkills(); updateCounts(); markDirty(); schedulePreview();
    wrap.querySelector('.skill-group:last-of-type input')?.focus();
  }));
  renderChips();
}
function renderChips() {
  const groups = $$('#skills .skill-group');
  resume.skills.forEach((pair, i) => {
    const g = groups[i]; if (!g || !g._chips) return;
    const chips = g._chips; chips.innerHTML = '';
    String(pair[1]).split(/\s*,\s*/).map((t) => t.trim()).filter(Boolean).forEach((tok) => {
      const c = document.createElement('button'); c.type = 'button';
      const hid = isHidden(tok);
      c.className = 'chip' + (hid ? ' hidden' : ''); c.textContent = tok;
      c.title = hid ? 'Hidden — click to show' : 'Shown — click to hide';
      c.addEventListener('click', () => { setHidden(tok, !isHidden(tok)); renderChips(); markDirty(); schedulePreview(); });
      chips.appendChild(c);
    });
  });
}

/* ============================================================
   Editable-entry helpers — every field is editable; entries can be
   added or removed. (Your manual edits are unrestricted; the AI's
   "no invented experience" guard still applies only when tailoring.)
   ============================================================ */

// A labeled text input bound to obj[key], live-updating preview.
function fieldInput(label, obj, key, opts = {}) {
  const f = document.createElement('div'); f.className = 'field';
  const l = document.createElement('label'); l.textContent = label;
  const inp = document.createElement(opts.textarea ? 'textarea' : 'input');
  if (opts.textarea) { inp.className = 'grow'; inp.rows = 1; }
  inp.value = obj[key] != null ? obj[key] : '';
  inp.placeholder = opts.placeholder || '';
  inp.setAttribute('aria-label', label);
  inp.addEventListener('input', () => {
    obj[key] = inp.value; if (opts.textarea) autoGrow(inp);
    if (opts.onInput) opts.onInput(); markDirty(); schedulePreview();
  });
  f.append(l, inp);
  if (opts.textarea) requestAnimationFrame(() => autoGrow(inp));
  return f;
}

// Header row for an entry card: a title + a "remove entry" button.
function entryBar(title, onRemove) {
  const bar = document.createElement('div'); bar.className = 'entry-bar';
  const t = document.createElement('span'); t.className = 'entry-kicker'; t.textContent = title;
  const del = document.createElement('button'); del.type = 'button'; del.className = 'entry-del';
  del.title = 'Remove this entry'; del.innerHTML = '&times;';
  del.addEventListener('click', onRemove);
  bar.append(t, del);
  return bar;
}

// A dashed "+ Add …" button used to append a new entry to a section.
function addButton(text, onAdd) {
  const b = document.createElement('button'); b.type = 'button';
  b.className = 'add-entry'; b.textContent = text;
  b.addEventListener('click', onAdd);
  return b;
}

function renderExperience() {
  const wrap = $('#experience'); wrap.innerHTML = '';
  resume.experience.forEach((e, i) => {
    const entry = document.createElement('div'); entry.className = 'entry';
    entry.appendChild(entryBar('Role ' + (i + 1), () => {
      resume.experience.splice(i, 1); renderExperience(); updateCounts(); markDirty(); schedulePreview();
    }));
    const grid = document.createElement('div'); grid.className = 'field-grid';
    grid.append(
      fieldInput('Role', e, 'role'),
      fieldInput('Company', e, 'company'),
      fieldInput('Location', e, 'location'),
      fieldInput('Dates', e, 'dates', { placeholder: 'e.g. Jan 2024 – Present' }),
    );
    entry.appendChild(grid);
    const bl = document.createElement('div'); bl.className = 'field';
    bl.appendChild(Object.assign(document.createElement('label'), { textContent: 'Bullets' }));
    bl.appendChild(buildBullets(e.bullets, (arr) => { resume.experience[i].bullets = arr; }));
    entry.appendChild(bl);
    wrap.appendChild(entry);
  });
  wrap.appendChild(addButton('+ Add role', () => {
    resume.experience.push({ role: '', company: '', location: '', dates: '', bullets: [''] });
    renderExperience(); updateCounts(); markDirty(); schedulePreview();
    wrap.querySelector('.entry:last-of-type input')?.focus();
  }));
}

function renderProjects() {
  const wrap = $('#projects'); wrap.innerHTML = '';
  resume.projects.forEach((p, i) => {
    const entry = document.createElement('div'); entry.className = 'entry';
    entry.appendChild(entryBar('Project ' + (i + 1), () => {
      resume.projects.splice(i, 1); renderProjects(); updateCounts(); markDirty(); schedulePreview();
    }));
    entry.append(
      fieldInput('Project name', p, 'name'),
      fieldInput('Stack', p, 'stack', { placeholder: 'e.g. .NET Core · Node.js · Azure' }),
    );
    const bl = document.createElement('div'); bl.className = 'field';
    bl.appendChild(Object.assign(document.createElement('label'), { textContent: 'Bullets' }));
    bl.appendChild(buildBullets(p.bullets, (arr) => { resume.projects[i].bullets = arr; }));
    entry.appendChild(bl);
    wrap.appendChild(entry);
  });
  wrap.appendChild(addButton('+ Add project', () => {
    resume.projects.push({ name: '', stack: '', bullets: [''] });
    renderProjects(); updateCounts(); markDirty(); schedulePreview();
    wrap.querySelector('.entry:last-of-type input')?.focus();
  }));
}

// Build a reorderable, editable bullet list. `commit(newArray)` writes back.
function buildBullets(bullets, commit) {
  const box = document.createElement('div'); box.className = 'bullets';
  const model = bullets.slice();

  function rerender() {
    box.innerHTML = '';
    model.forEach((text, j) => box.appendChild(row(text, j)));
    const actions = document.createElement('div'); actions.className = 'row-actions';
    const add = document.createElement('button'); add.type = 'button'; add.className = 'mini-btn'; add.textContent = '+ Add bullet';
    add.addEventListener('click', () => { model.push(''); commit(model.slice()); rerender(); markDirty(); schedulePreview();
      const tas = box.querySelectorAll('textarea'); const last = tas[tas.length - 1]; if (last) { last.focus(); autoGrow(last); } });
    actions.appendChild(add); box.appendChild(actions);
  }

  function row(text, j) {
    const r = document.createElement('div'); r.className = 'bullet-row'; r.draggable = false;
    const handle = document.createElement('div'); handle.className = 'drag-handle'; handle.title = 'Drag to reorder'; handle.draggable = true;
    const ta = document.createElement('textarea'); ta.className = 'grow'; ta.rows = 1; ta.value = text;
    ta.addEventListener('input', () => { model[j] = ta.value; commit(model.slice()); autoGrow(ta); markDirty(); schedulePreview(); });
    const del = document.createElement('button'); del.type = 'button'; del.className = 'bullet-del'; del.title = 'Remove bullet'; del.textContent = '×';
    del.addEventListener('click', () => { model.splice(j, 1); commit(model.slice()); rerender(); markDirty(); schedulePreview(); });
    r.append(handle, ta, del);
    requestAnimationFrame(() => autoGrow(ta));

    // drag reorder (handle initiates, row is the target)
    handle.addEventListener('dragstart', (ev) => { dragFrom = j; r.classList.add('dragging'); ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', String(j)); });
    handle.addEventListener('dragend', () => { r.classList.remove('dragging'); $$('.drop-target', box).forEach((x) => x.classList.remove('drop-target')); });
    r.addEventListener('dragover', (ev) => { ev.preventDefault(); r.classList.add('drop-target'); ev.dataTransfer.dropEffect = 'move'; });
    r.addEventListener('dragleave', () => r.classList.remove('drop-target'));
    r.addEventListener('drop', (ev) => {
      ev.preventDefault(); r.classList.remove('drop-target');
      if (dragFrom == null || dragFrom === j) return;
      const [moved] = model.splice(dragFrom, 1); model.splice(j, 0, moved);
      commit(model.slice()); rerender(); markDirty(); schedulePreview(); dragFrom = null;
    });
    return r;
  }

  rerender();
  return box;
}
let dragFrom = null;

/* ============================================================
   Education / Certifications / Additional
   ============================================================ */
function renderEducation() {
  const wrap = $('#education'); wrap.innerHTML = '';
  resume.education.forEach((e, i) => {
    const entry = document.createElement('div'); entry.className = 'entry';
    entry.appendChild(entryBar('Education ' + (i + 1), () => {
      resume.education.splice(i, 1); renderEducation(); updateCounts(); markDirty(); schedulePreview();
    }));
    entry.append(
      fieldInput('Degree', e, 'degree'),
      fieldInput('School', e, 'school'),
      fieldInput('Detail', e, 'detail', { placeholder: 'e.g. CGPA: 7.5 / 10 · 2020 – 2023' }),
    );
    wrap.appendChild(entry);
  });
  wrap.appendChild(addButton('+ Add education', () => {
    resume.education.push({ degree: '', school: '', detail: '' });
    renderEducation(); updateCounts(); markDirty(); schedulePreview();
    wrap.querySelector('.entry:last-of-type input')?.focus();
  }));
}

function renderCertifications() {
  const wrap = $('#certifications'); wrap.innerHTML = '';
  resume.certifications.forEach((c, i) => {
    const row = document.createElement('div'); row.className = 'inline-row';
    const inp = document.createElement('input'); inp.value = c;
    inp.setAttribute('aria-label', 'Certification ' + (i + 1));
    inp.addEventListener('input', () => { resume.certifications[i] = inp.value; markDirty(); schedulePreview(); });
    const del = document.createElement('button'); del.type = 'button'; del.className = 'inline-del';
    del.title = 'Remove'; del.innerHTML = '&times;';
    del.addEventListener('click', () => { resume.certifications.splice(i, 1); renderCertifications(); updateCounts(); markDirty(); schedulePreview(); });
    row.append(inp, del); wrap.appendChild(row);
  });
  wrap.appendChild(addButton('+ Add certification', () => {
    resume.certifications.push(''); renderCertifications(); updateCounts(); markDirty(); schedulePreview();
    wrap.querySelector('.inline-row:last-of-type input')?.focus();
  }));
}

function renderAdditional() {
  const wrap = $('#additional'); wrap.innerHTML = '';
  resume.additional.forEach((pair, i) => {
    const row = document.createElement('div'); row.className = 'inline-row inline-row--pair';
    const key = document.createElement('input'); key.className = 'inline-key'; key.value = pair[0];
    key.placeholder = 'Label'; key.setAttribute('aria-label', 'Label ' + (i + 1));
    key.addEventListener('input', () => { resume.additional[i][0] = key.value; markDirty(); schedulePreview(); });
    const val = document.createElement('input'); val.value = pair[1];
    val.placeholder = 'Value'; val.setAttribute('aria-label', 'Value ' + (i + 1));
    val.addEventListener('input', () => { resume.additional[i][1] = val.value; markDirty(); schedulePreview(); });
    const del = document.createElement('button'); del.type = 'button'; del.className = 'inline-del';
    del.title = 'Remove'; del.innerHTML = '&times;';
    del.addEventListener('click', () => { resume.additional.splice(i, 1); renderAdditional(); markDirty(); schedulePreview(); });
    row.append(key, val, del); wrap.appendChild(row);
  });
  wrap.appendChild(addButton('+ Add row', () => {
    resume.additional.push(['', '']); renderAdditional(); markDirty(); schedulePreview();
    wrap.querySelector('.inline-row:last-of-type input')?.focus();
  }));
}

/* ---------- card counts ---------- */
function updateCounts() {
  const set = (sec, txt) => { const el = $(`.card[data-section="${sec}"] [data-count]`); if (el) el.textContent = txt; };
  set('skills', resume.skills.length + ' groups');
  set('experience', resume.experience.length + (resume.experience.length === 1 ? ' role' : ' roles'));
  set('projects', resume.projects.length + (resume.projects.length === 1 ? ' project' : ' projects'));
  set('education', resume.education.length + ' entries');
  set('certifications', resume.certifications.length + ' certs');
}

/* ============================================================
   Auto-grow textareas
   ============================================================ */
function autoGrow(ta) {
  if (!ta || ta.tagName !== 'TEXTAREA') return;
  ta.style.height = 'auto';
  ta.style.height = Math.max(ta.scrollHeight, 30) + 'px';
}
function autoGrowAll() { requestAnimationFrame(() => $$('textarea.grow').forEach(autoGrow)); }

/* ============================================================
   Live preview (debounced) + zoom + page-break indicator
   ============================================================ */
let previewTimer = null, previewReq = 0;
function schedulePreview(delay = 400) {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderPreview, delay);
}
async function renderPreview() {
  const myReq = ++previewReq;
  $('#previewLoading').hidden = false;
  try {
    const html = await (await api('/api/preview?template=' + currentTemplate, jsonBody(resume))).text();
    if (myReq !== previewReq) return;
    const frame = $('#preview');
    frame.srcdoc = html;
    frame.onload = () => { fitFrameHeight(); };
  } catch (_) { /* keep last good preview */ }
  finally { if (myReq === previewReq) $('#previewLoading').hidden = true; }
  checkPages();
}
// size the iframe to its content so the whole resume shows without inner scroll
function fitFrameHeight() {
  const frame = $('#preview');
  try {
    const doc = frame.contentDocument;
    const h = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight);
    frame.style.height = h + 'px';
    positionPageBreak(h);
  } catch (_) {}
}
// place a page-break marker at ~11in boundaries (Letter @96dpi, 0.7in margins baked into engine)
function positionPageBreak(contentH) {
  const brk = $('#pageBreak');
  const PAGE_PX = 11 * 96; // one Letter page tall
  if (contentH > PAGE_PX + 8) {
    brk.hidden = false;
    brk.style.top = PAGE_PX + 'px';
  } else { brk.hidden = true; }
}

let zoomMode = 'fit';
function applyZoom() {
  const wrap = $('#previewFrameWrap');
  const stage = $('#previewStage');
  if (zoomMode === '100') {
    wrap.style.width = '816px';
    wrap.style.transform = 'none';
  } else {
    const avail = stage.clientWidth - 40; // padding
    const scale = Math.min(1, avail / 816);
    wrap.style.width = '816px';
    wrap.style.transform = `scale(${scale})`;
    wrap.style.marginBottom = (816 * scale - 816) + 'px'; // collapse gap from scaling
  }
  $('#zoomFit').classList.toggle('is-active', zoomMode === 'fit');
  $('#zoom100').classList.toggle('is-active', zoomMode === '100');
}
$('#zoomFit').addEventListener('click', () => { zoomMode = 'fit'; applyZoom(); });
$('#zoom100').addEventListener('click', () => { zoomMode = '100'; applyZoom(); });
window.addEventListener('resize', () => { if (zoomMode === 'fit') applyZoom(); });

/* ============================================================
   2-page fit badge (first-class) + clickable trim suggestion
   ============================================================ */
let pageReq = 0, lastSuggestion = null;
async function checkPages() {
  const badge = $('#pageBadge'), txt = $('.page-badge-text', badge), warn = $('#overflowWarn');
  const myReq = ++pageReq;
  badge.className = 'page-badge is-loading'; txt.textContent = 'Measuring…';
  try {
    const d = await (await api('/api/pagecount?template=' + currentTemplate, jsonBody(resume))).json();
    if (myReq !== pageReq) return;
    if (d.fit && d.scale >= 0.999) {
      badge.className = 'page-badge ok'; txt.textContent = `Fits · ${d.pages}/${d.maxPages} pages`;
      warn.hidden = true; lastSuggestion = null;
    } else if (d.fit) {
      badge.className = 'page-badge scaled'; txt.textContent = `Scaled to fit · ${d.pages}/${d.maxPages}`;
      warn.hidden = true; lastSuggestion = null;
    } else {
      badge.className = 'page-badge over'; txt.textContent = `Over ${d.maxPages} pages`;
      lastSuggestion = d.suggestion || null;
      warn.hidden = false;
      warn.innerHTML = d.suggestion
        ? `Over ${d.maxPages} pages — <span class="trim-link" role="button" tabindex="0">Trim: ${esc(d.suggestion)}</span>`
        : `Over ${d.maxPages} pages — shorten a bullet or two to fit.`;
      const link = $('.trim-link', warn);
      if (link) { link.addEventListener('click', jumpToSuggestion); link.addEventListener('keydown', (e) => { if (e.key === 'Enter') jumpToSuggestion(); }); }
    }
  } catch (_) {
    if (myReq !== pageReq) return;
    badge.className = 'page-badge'; txt.textContent = '— pages';
  }
}
$('#pageBadge').addEventListener('click', () => { if (lastSuggestion) jumpToSuggestion(); });

// Map the server's suggestion string to an editor section and scroll+flash it.
function jumpToSuggestion() {
  if (!lastSuggestion) return;
  let sel = null;
  if (/^Professional Summary/i.test(lastSuggestion)) sel = 'summary';
  else if (/^Experience/i.test(lastSuggestion)) sel = 'experience';
  else if (/^Project/i.test(lastSuggestion)) sel = 'projects';
  const card = sel ? $(`.card[data-section="${sel}"]`) : null;
  if (!card) return;
  card.open = true;
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash');
}

/* ============================================================
   Autosave + manual save
   ============================================================ */
let autosaveTimer = null;
function scheduleAutosave() { clearTimeout(autosaveTimer); autosaveTimer = setTimeout(saveResume, 1200); }
async function saveResume(manual = false) {
  clearTimeout(autosaveTimer);
  setSaveState('saving', 'Saving…');
  try {
    await api('/api/resume', jsonBody(resume));
    dirty = false;
    setSaveState('saved', 'Saved · just now');
    if (manual) toast('Saved', 'ok', 1400);
  } catch (e) {
    setSaveState('error', 'Save failed');
    toast('Save failed: ' + e.message, 'err');
  }
}
$('#saveBtn').addEventListener('click', () => saveResume(true));

/* ============================================================
   Tailor flow
   ============================================================ */
async function tailor() {
  const jd = $('#jd').value.trim();
  const btn = $('#tailorBtn');
  if (!jd) { toast('Paste a job description first.', 'err'); $('#jd').focus(); return; }
  if (btn.classList.contains('is-busy')) return; // no double-submit
  btn.classList.add('is-busy'); btn.disabled = true;
  $('#usedModel').textContent = 'Tailoring…';
  try {
    const data = await (await api('/api/tailor', jsonBody({ resume, jobDescription: jd, model: $('#modelSelect').value }))).json();
    pendingTailored = data.resume;
    pendingHidden = data.suggestedHidden || [];
    $('#usedModel').textContent = data.usedModel ? 'Answered by ' + data.usedModel.replace(':free', '') : '';
    showDiff(resume, pendingTailored, data.violations || []);
  } catch (e) {
    $('#usedModel').textContent = '';
    toast(e.status === 503 ? 'All AI providers are busy — try again in a moment.' : ('Tailor failed: ' + e.message), 'err', 5000);
  } finally {
    btn.classList.remove('is-busy'); btn.disabled = false;
  }
}
$('#tailorBtn').addEventListener('click', tailor);

// Fetch a JD from a job link into the textarea (best-effort; many sites block bots).
async function fetchJd() {
  const url = $('#jdUrl').value.trim();
  const btn = $('#fetchJdBtn');
  const note = $('#jdFetchNote');
  if (!url) { toast('Paste a job link first.', 'err'); $('#jdUrl').focus(); return; }
  if (btn.classList.contains('is-busy')) return;
  btn.classList.add('is-busy'); btn.disabled = true;
  note.hidden = true; note.className = 'jd-fetch-note';
  try {
    const data = await (await api('/api/fetch-jd', jsonBody({ url }))).json();
    $('#jd').value = data.text;
    note.hidden = false; note.classList.add('ok');
    note.textContent = 'Fetched the job description — review it below, then Tailor.';
    $('#jd').focus();
  } catch (e) {
    note.hidden = false; note.classList.add('warn');
    // BLOCKED / TOO_SHORT (422) get a friendly "paste instead" message from the server.
    note.textContent = e.message || 'Could not fetch that link — paste the job description below instead.';
    $('#jd').focus();
  } finally {
    btn.classList.remove('is-busy'); btn.disabled = false;
  }
}
$('#fetchJdBtn').addEventListener('click', fetchJd);
$('#jdUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); fetchJd(); } });

/* ============================================================
   Diff review — word-level, grouped by section
   ============================================================ */
// Ordered rewordable fields as [group, label, value].
function collectFields(r) {
  const rows = [];
  rows.push(['Header', 'Title', r.title]);
  rows.push(['Summary', 'Summary', r.summary]);
  r.skills.forEach(([k, v]) => rows.push(['Skills', k, v]));
  r.experience.forEach((e, i) => e.bullets.forEach((b, j) => rows.push(['Experience', `${e.company} · bullet ${j + 1}`, b])));
  r.projects.forEach((p, i) => {
    rows.push(['Projects', `${shortName(p.name)} · stack`, p.stack]);
    p.bullets.forEach((b, j) => rows.push(['Projects', `${shortName(p.name)} · bullet ${j + 1}`, b]));
  });
  return rows;
}
const shortName = (n) => String(n).split(/[—-]/)[0].trim();

function showDiff(oldR, newR, violations) {
  const oldRows = collectFields(oldR), newRows = collectFields(newR);
  const body = $('#diffBody'); body.innerHTML = '';
  renderViolations(violations);

  const groups = {}; let changeCount = 0;
  for (let i = 0; i < newRows.length; i++) {
    const [group, label, nv] = newRows[i];
    const ov = oldRows[i] ? oldRows[i][2] : '';
    if ((ov || '') === (nv || '')) continue;
    changeCount++;
    (groups[group] = groups[group] || []).push({ label, ov: ov || '', nv: nv || '' });
  }

  if (!changeCount) {
    body.innerHTML = '<div class="diff-empty">No wording changes suggested for this job description.<br>Your content already aligns.</div>';
  } else {
    Object.keys(groups).forEach((g) => {
      const sec = document.createElement('div'); sec.className = 'diff-group';
      const title = document.createElement('div'); title.className = 'diff-group-title'; title.textContent = g;
      sec.appendChild(title);
      groups[g].forEach(({ label, ov, nv }) => {
        const item = document.createElement('div'); item.className = 'diff-item';
        const lab = document.createElement('div'); lab.className = 'diff-label'; lab.textContent = label;
        const txt = document.createElement('div'); txt.className = 'diff-text'; txt.innerHTML = wordDiff(ov, nv);
        item.append(lab, txt); sec.appendChild(item);
      });
      body.appendChild(sec);
    });
  }

  const vCount = (violations || []).length;
  $('#diffSummary').textContent =
    `${changeCount} change${changeCount === 1 ? '' : 's'}` +
    (vCount ? ` · ${vCount} blocked` : '') +
    (pendingHidden.length ? ` · ${pendingHidden.length} hide-suggestion${pendingHidden.length === 1 ? '' : 's'}` : '');

  renderHideSuggestions();
  openModal('#diffModal');
  $('#diffApply').focus();
}

function renderViolations(violations) {
  const box = $('#violations');
  if (!violations || !violations.length) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  box.innerHTML =
    '<div class="v-title">Blocked — not in your experience</div>' +
    '<div class="v-sub">The AI tried to add content you don\'t have. These were automatically removed to keep every claim true.</div>' +
    '<ul>' + violations.map((v) => `<li>${esc(v)}</li>`).join('') + '</ul>';
}

function renderHideSuggestions() {
  const box = $('#hideSuggest');
  if (!pendingHidden.length) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  box.innerHTML =
    '<div class="hide-title">Reduce interview surface</div>' +
    '<p class="hide-sub">These skills aren\'t relevant to this job. Hiding them means fewer off-topic interview questions. Uncheck any you want to keep — reversible anytime via chips.</p>' +
    pendingHidden.map((t) => `<label class="hide-item"><input type="checkbox" data-hide="${esc(t)}" checked> ${esc(t)}</label>`).join('');
}

// Word-level diff via LCS. Returns HTML with <del>/<ins>.
function wordDiff(a, b) {
  const A = tokenizeWords(a), B = tokenizeWords(b);
  const n = A.length, m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  let i = 0, j = 0; const out = [];
  const flush = (tag, buf) => { if (buf.length) out.push(`<${tag}>${esc(buf.join(''))}</${tag}>`); };
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push(esc(A[i])); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { const buf = []; while (i < n && (j >= m || dp[i + 1][j] >= dp[i][j + 1]) && A[i] !== B[j]) buf.push(A[i++]); flush('del', buf); }
    else { const buf = []; while (j < m && (i >= n || dp[i + 1][j] < dp[i][j + 1]) && A[i] !== B[j]) buf.push(B[j++]); flush('ins', buf); }
  }
  if (i < n) flush('del', A.slice(i));
  if (j < m) flush('ins', B.slice(j));
  return out.join('');
}
function tokenizeWords(s) { return String(s || '').match(/\s+|[^\s]+/g) || []; }

/* apply / discard */
function closeDiff() { pendingTailored = null; pendingHidden = []; closeModal('#diffModal'); }
$('#diffCancel').addEventListener('click', closeDiff);
$('#diffClose').addEventListener('click', closeDiff);
$('#diffApply').addEventListener('click', () => {
  if (!pendingTailored) { closeModal('#diffModal'); return; }
  resume = pendingTailored;
  resume.hiddenSkills = resume.hiddenSkills || [];
  $$('#hideSuggest input[data-hide]:checked').forEach((cb) => {
    const t = cb.getAttribute('data-hide');
    if (!resume.hiddenSkills.some((h) => h.toLowerCase() === t.toLowerCase())) resume.hiddenSkills.push(t);
  });
  pendingTailored = null; pendingHidden = [];
  bindSimpleFields(); renderAll(); updateCounts();
  closeModal('#diffModal');
  markDirty();
  schedulePreview(0);
  toast('Tailored content applied — review and export.', 'ok');
});

/* ============================================================
   Export
   ============================================================ */
async function exportAs(format, btn) {
  if (btn.classList.contains('is-busy')) return;
  btn.classList.add('is-busy'); btn.disabled = true;
  try {
    const res = await api('/api/export', jsonBody({ resume, format, template: currentTemplate }));
    const pages = res.headers.get('X-Resume-Pages');
    const fit = res.headers.get('X-Resume-Fit');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (resume.name || 'resume').replace(/[^a-z0-9]+/gi, '_') + '_Resume.' + format;
    a.click(); URL.revokeObjectURL(url);
    if (format === 'pdf' && fit === '0') toast(`PDF downloaded — but it's ${pages} pages. Trim to lock to 2.`, 'err', 5000);
    else toast(format.toUpperCase() + ' downloaded', 'ok', 1800);
  } catch (e) {
    toast('Export failed: ' + e.message, 'err', 5000);
  } finally {
    btn.classList.remove('is-busy'); btn.disabled = false;
  }
}
$('#pdfBtn').addEventListener('click', (e) => exportAs('pdf', e.currentTarget));
$('#docxBtn').addEventListener('click', (e) => exportAs('docx', e.currentTarget));

/* ============================================================
   Modals (generic open/close + focus trap-lite)
   ============================================================ */
function openModal(sel) { $(sel).hidden = false; }
function closeModal(sel) { $(sel).hidden = true; }
$$('.modal').forEach((m) => m.addEventListener('mousedown', (e) => { if (e.target === m) m.hidden = true; }));

/* ============================================================
   Theme
   ============================================================ */
function initTheme() {
  const saved = localStorage.getItem('rt-theme');
  const sys = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', saved || sys);
}
$('#themeBtn').addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('rt-theme', next);
});

/* ============================================================
   Help / shortcuts
   ============================================================ */
$('#helpBtn').addEventListener('click', () => openModal('#helpModal'));
$('#helpClose').addEventListener('click', () => closeModal('#helpModal'));

document.addEventListener('keydown', (e) => {
  // Esc closes any open modal
  if (e.key === 'Escape') {
    if (!$('#diffModal').hidden) return closeDiff();
    if (!$('#helpModal').hidden) return closeModal('#helpModal');
  }
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key === 'Enter') { e.preventDefault(); tailor(); return; }
  if (mod && (e.key === 's' || e.key === 'S')) { e.preventDefault(); saveResume(true); return; }
  if (mod && (e.key === 'e' || e.key === 'E')) { e.preventDefault(); exportAs('pdf', $('#pdfBtn')); return; }
  // "?" toggles cheatsheet when not typing
  if (e.key === '?' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
    e.preventDefault();
    const h = $('#helpModal'); h.hidden = !h.hidden;
  }
});

// warn on unsaved close
window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

/* ---------- util ---------- */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ---------- boot ---------- */
initTheme();
applyZoom();
load();
