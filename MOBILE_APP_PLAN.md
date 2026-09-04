# Building the Mobile App (Ionic + Cordova) — Thin-Client Plan

## The one thing to understand first

Your app's PDF export and 2-page measurement use **Puppeteer (headless Chrome)**, which
only runs on a **server**. A phone can't run it. So the mobile app is **not** a wrapper of
the whole app — it's a **thin client**: a mobile UI that calls your already-deployed Render
backend (`https://resume-builder-by-k.onrender.com`) for tailoring, preview, and PDF/DOCX.

**Result:** you reuse 100% of the backend you built. The mobile work is all frontend.

```
┌─────────────────────────┐        HTTPS         ┌──────────────────────────┐
│  Ionic app (on phone)   │  ───────────────►    │  Render server (existing)│
│  - editor UI            │   /api/tailor        │  - Express + Puppeteer   │
│  - live preview (iframe)│   /api/preview       │  - Gemini / OpenRouter   │
│  - triggers PDF/DOCX    │   /api/export …      │  - PDF/DOCX engine       │
└─────────────────────────┘  ◄───────────────    └──────────────────────────┘
```

## Note on the stack: Cordova vs Capacitor

Ionic today ships with **Capacitor** (its modern native runtime) rather than Cordova —
Cordova still works but is legacy. This plan uses **Capacitor** (what `ionic start` gives you).
If your assignment specifically requires Cordova, Ionic supports `--cordova`, but prefer
Capacitor unless told otherwise. Both wrap a webview + native plugins the same way.

## What changes vs. the current web frontend

The current `public/` app is vanilla JS. Two realistic routes:

### Route 1 — Reuse the existing vanilla UI inside Ionic (fastest, best for learning the wrapper)
Drop your current `index.html` / `styles.css` / `app.js` into an Ionic "blank" project's
web assets, change **one thing** — the API base URL — and package it. You learn the
Cordova/Capacitor build + device deploy without rewriting UI.

### Route 2 — Rebuild the UI with Ionic components (more work, "proper" Ionic)
Recreate the editor with `<ion-card>`, `<ion-input>`, `<ion-textarea>`, `<ion-modal>`,
etc. Better native look/feel, but you rewrite the frontend. Do this only if the goal is
learning Ionic's component system, not just shipping.

**Recommendation for "exploring/learning": start with Route 1**, then refactor pieces to
Ionic components once the device build works.

## The single required code change (either route)

Your frontend calls the API through one function ([public/app.js:24](public/app.js#L24)):
```js
async function api(path, opts) {
  const res = await fetch(path, opts);   // relative path
  ...
}
```
On a phone there's no local server, so relative `/api/...` must point at Render. Add a base:
```js
const API_BASE = 'https://resume-builder-by-k.onrender.com';
async function api(path, opts) {
  const res = await fetch(API_BASE + path, opts);
  ...
}
```
That's the core of the whole port. (The export download also uses an `<a download>` click —
on device you'll swap that for the Capacitor Filesystem + Share plugins; see below.)

## Step-by-step (Route 1, Capacitor)

Prereqs: Node 18+, Android Studio (for Android) and/or Xcode (for iOS, Mac only).

```bash
# 1. Scaffold a blank Ionic app (no framework, plain JS/HTML — matches your current code)
npm install -g @ionic/cli
ionic start ResumeTailorMobile blank --type=html
cd ResumeTailorMobile

# 2. Replace the generated www/ contents with your existing frontend
#    Copy public/index.html, public/styles.css, public/app.js into www/
#    Then apply the API_BASE change above in app.js.

# 3. Add the native platform
ionic build
npx cap add android      # and/or: npx cap add ios
npx cap sync

# 4. Open in the native IDE and run on a device/emulator
npx cap open android     # builds/runs via Android Studio
```

## Native gaps to handle (where mobile ≠ browser)

| Concern | Browser today | On device (fix) |
|---|---|---|
| **API base URL** | relative `/api` | absolute Render URL (above) |
| **CORS** | same-origin, no CORS | cross-origin now → add `cors` on the server (small, safe change) |
| **PDF/DOCX download** | `<a download>` click | Capacitor **Filesystem** (write blob) + **Share** plugin to save/share |
| **Cold starts** | — | Render free tier sleeps; add a "waking server…" state so the app doesn't look frozen |
| **Local save** | POST `/api/resume` (server file) | server save is shared/global; better to store the resume in device storage (Capacitor **Preferences**) so each user keeps their own |
| **Keyboard/scroll** | desktop | test the editor with the on-screen keyboard; Ionic handles most of this |

### The one required backend change: enable CORS
Right now the server only serves its own frontend (same origin). A phone app is a
*different* origin, so the browser/webview will block the calls unless the server sends
CORS headers. This is a ~3-line, safe addition to `server/index.js`:
```js
const cors = require('cors');            // npm i cors
app.use(cors());                          // or restrict to your app's origin
```
This does **not** affect the existing web app. It's the only server touch needed.

## Honest scope estimate

- **Route 1 to a running Android app:** ~half a day, mostly toolchain setup (Android Studio,
  SDK, emulator) + the API_BASE change + CORS + the download→Share swap.
- **Route 2 (real Ionic components):** several days; it's a UI rewrite.
- **App store publishing:** separate effort — developer accounts ($25 Google one-time,
  $99/yr Apple), signing, store listings. Not needed to run on your own device.

## What stays exactly as-is
The entire backend: tailoring, the no-invented-experience guard, 2-page auto-fit, skill
hiding, multi-provider AI, PDF/DOCX engine. The mobile app just calls it.
```
