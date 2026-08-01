# Resume Editor (by K)

A small web app to **build, edit, and tailor a resume to a job description** — with two hard guarantees:

1. **Alignment never breaks.** The resume is structured JSON rendered into a fixed, code-controlled template. You edit text; the layout is not editable, so it can't misalign. PDF/DOCX come out of the same engine every time.
2. **No invented experience.** When you tailor to a job description, the AI may only **reword and reorder your existing content**. It cannot add skills, employers, dates, projects, or achievements you don't already have — enforced by the prompt, a deterministic post-check, and a diff you approve before anything is applied.
3. **Locked to 2 pages.** The engine measures the real rendered page count and auto-shrinks spacing/font (within a safe range) to fit 2 pages — never cutting content. If it still overflows, a warning names the section to trim.
4. **Reduce interview surface.** Tailoring also flags technologies in your Skills section that the job description doesn't need, so you can hide them (via a checklist or per-skill chips) and avoid being quizzed on off-topic tech. Hidden skills are reversible and stay in your master data — bullets and project stacks are untouched.

## Setup

```bash
cd c:\ResumeEditorbyK
npm install
```

### (Optional) enable AI tailoring — free
Set **one or both** free API keys in `.env` (copy from `.env.example`). The app
auto-falls-through between them, so a second key means real redundancy when one
provider is rate-limited or down.

1. **Google Gemini** — free, no card: https://aistudio.google.com/app/apikey
   ```
   GEMINI_API_KEY=your_key_here
   ```
2. **OpenRouter** — free key unlocks many `:free` models: https://openrouter.ai/keys
   ```
   OPENROUTER_API_KEY=your_key_here
   ```

Build / edit / export all work **without** any key — only "Tailor to this JD" needs one.

**Model selection:** a dropdown next to the Tailor button lets you pick a specific
model or leave it on **Auto** (tries Gemini models, then OpenRouter free models,
falling through on any failure/quota). Only configured providers appear. After a
tailor run the UI shows which model actually answered.

> Note on OpenRouter free models: the `:free` pool is shared and often rate-limited
> (429). The app treats that as a normal fallback signal and moves to the next
> model, so tailoring still succeeds. Free model slugs change over time — refresh
> the list in `server/tailor.js` (CHAIN) with:
> `curl https://openrouter.ai/api/v1/models -H "Authorization: Bearer $OPENROUTER_API_KEY"`
> and keep only ids ending in `:free`.

## Run

```bash
npm start
```
Open http://localhost:3000

## How it works

- **Left pane** — edit your resume. Locked fields (company, dates, project names, education) are shown read-only because they're factual. Editable fields are the ones you'd legitimately reword: summary, skill values, and bullets.
- **Paste a job description** and click **Tailor to this JD**. You get a **before/after diff** to review; nothing changes until you click **Apply**.
- **Right pane** — a live preview rendered by the exact same engine used for export, so what you see is what you download.
- **Download PDF / DOCX** — pixel-consistent with the preview.

## The three anti-fabrication layers

| Layer | File | What it does |
|------|------|--------------|
| 1. Prompt constraint | `server/tailor.js` | Instructs Gemini to only reword/reorder and lists the allowed technology tokens. |
| 2. Deterministic guard | `server/schema.js` (`stripInventedContent`) | Rebuilds the tailored resume from the original structure, dropping any added skill/tech/bullet/section. The AI is **not trusted** — this is what actually enforces the rule. |
| 3. Human approval | `public/app.js` | Shows a diff; you approve before it's applied. |

## Structure

```
server/
  index.js         Express API + static hosting
  resumeEngine.js  buildHtml / buildPdf / buildDocx  (fixed-template renderer)
  tailor.js        Gemini call + reword-only prompt
  schema.js        resume shape + stripInventedContent guard
public/            editor UI (index.html, app.js, styles.css)
data/resume.json   your resume content (edited via the UI, saved here)
```

The render engine is ported from the sibling `resume-build` project so exports match that proven layout.
