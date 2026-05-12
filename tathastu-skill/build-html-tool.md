# Tathastu Studio — Claude Project Instructions

You are building and maintaining **Tathastu**, an internal order management web tool for a photo studio. All HTML, CSS, and JavaScript you produce must follow every rule in this document without exception. These rules exist so the final file can be pushed directly to GitHub and deployed to Vercel with zero modification.

---

## Project Identity

| Property | Value |
|----------|-------|
| Project name | Tathastu Studio Orders |
| GitHub repo | `vickybhardwaj-cars24/tathastu` |
| Vercel URL | `tathastu.vercel.app` (or custom domain) |
| Worker URL | `[FILL IN: your Cloudflare Worker URL, e.g. https://tathastu.your-name.workers.dev/]` |
| Tool path | `tathastu-orders` |
| R2 bucket | `tathastu-data` |

---

## Absolute Stack Rules — Never Break These

1. **Single HTML file only.** All CSS inside `<style>`, all JavaScript inside `<script>` at the bottom. One file: `index.html`. No separate `.css` or `.js` files.
2. **No build step.** No npm, no package.json, no node_modules, no webpack, no Vite.
3. **No JS frameworks.** No React, Vue, Angular, Svelte. Vanilla JavaScript only.
4. **No external JS CDNs.** No jQuery, no Bootstrap JS, no Lodash. Google Fonts (CSS only) is allowed.
5. **Version in title.** Every change increments the version. Format: `<title>Tathastu Studio v1.3</title>` and the same version shown in the page header.
6. **Escape all user input.** Always use the `esc()` helper before inserting any string into HTML. Never concatenate raw user data into innerHTML.
7. **Syntax-safe JS.** All JavaScript must be free of syntax errors. Before finalising any response, mentally verify bracket matching, missing semicolons, and unclosed strings.

---

## File Structure

```
index.html          ← the entire app (CSS + JS all inline)
```

That is the complete file structure. Nothing else is needed for Vercel deployment.

---

## Page Architecture

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Tathastu Studio v1.0</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    /* ALL CSS HERE — no external stylesheets */
  </style>
</head>
<body>

  <!-- All HTML here -->

  <!-- Login modal (required — see Login Modal section) -->

  <script>
    // ── CONSTANTS ──────────────────────────────────────────────
    const WORKER_URL = '[FILL IN YOUR WORKER URL]';
    const TOOL_PATH  = 'tathastu-orders';

    // ── DATA ───────────────────────────────────────────────────
    let ORDERS = []; // loaded from Worker on page init

    // ── HELPERS ────────────────────────────────────────────────
    function esc(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function toast(msg,type){ /* show brief status message */ }
    function pd(str){ /* parse date string to Date object */ }

    // ── AUTH + WORKER ──────────────────────────────────────────
    // (see sections below)

    // ── RENDER ─────────────────────────────────────────────────
    function renderOrders(){ /* build and set innerHTML of orders container */ }

    // ── INIT ───────────────────────────────────────────────────
    (function init(){
      loadOrders();
      renderOrders();
    })();
  </script>
</body>
</html>
```

---

## Login Modal — Required

Every tool must have a login modal. Users must authenticate before saving data. The modal is shown on login button click. Credentials are kept in memory only (never localStorage).

```javascript
// Session credentials — never persist to localStorage
let __auth = null; // { username, password } once logged in

function openLoginModal(){
  document.getElementById('login-modal').style.display = 'flex';
}
function closeLoginModal(){
  document.getElementById('login-modal').style.display = 'none';
}
function doLogin(){
  var u = document.getElementById('login-username').value.trim();
  var p = document.getElementById('login-password').value;
  if(!u||!p){ showLoginError('Enter username and password'); return; }
  verifyAuth(u, p).then(function(ok){
    if(ok){
      __auth = {username:u, password:p};
      closeLoginModal();
      // show logout button, hide login button
      document.getElementById('login-btn').style.display='none';
      document.getElementById('logout-btn').style.display='inline-flex';
      toast('Logged in as '+u,'ok');
    } else {
      showLoginError('Invalid credentials');
    }
  });
}
function doLogout(){
  __auth = null;
  document.getElementById('login-btn').style.display='inline-flex';
  document.getElementById('logout-btn').style.display='none';
}
function showLoginError(msg){
  var el=document.getElementById('login-error');
  el.textContent=msg; el.style.display='block';
}
```

The login modal HTML:
```html
<div id="login-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9000;align-items:center;justify-content:center" onclick="if(event.target===this)closeLoginModal()">
  <div style="background:#fff;border-radius:12px;padding:24px;width:320px;max-width:92vw;box-shadow:0 12px 40px rgba(0,0,0,.2)">
    <h2 style="margin:0 0 16px;font-size:16px;font-weight:700">Login</h2>
    <p style="font-size:12px;color:#6b7280;margin:0 0 14px">Required to save orders. Not stored after closing tab.</p>
    <form onsubmit="event.preventDefault();doLogin()">
      <label style="display:block;font-size:11px;font-weight:600;margin-bottom:4px">Username</label>
      <input id="login-username" type="text" autocomplete="username" style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;margin-bottom:10px">
      <label style="display:block;font-size:11px;font-weight:600;margin-bottom:4px">Password</label>
      <input id="login-password" type="password" autocomplete="current-password" style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;margin-bottom:14px">
      <div id="login-error" style="display:none;font-size:11px;color:#dc2626;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:6px 10px;margin-bottom:10px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button type="button" onclick="closeLoginModal()" style="padding:7px 16px;border:1px solid #d1d5db;border-radius:6px;background:#fff;cursor:pointer;font-size:13px">Cancel</button>
        <button type="submit" style="padding:7px 16px;border:none;border-radius:6px;background:#4736FE;color:#fff;cursor:pointer;font-size:13px;font-weight:600">Login</button>
      </div>
    </form>
  </div>
</div>
```

---

## Cloudflare Worker Integration

The Worker handles all data reads and writes. The HTML talks to it directly from the browser.

### Reading data (no auth required)

```javascript
function loadOrders(){
  fetch(WORKER_URL + TOOL_PATH + '.json')
    .then(function(r){ return r.ok ? r.json() : []; })
    .then(function(data){
      ORDERS = Array.isArray(data) ? data : [];
      renderOrders();
    })
    .catch(function(){ ORDERS=[]; renderOrders(); });
}
```

### Writing data (auth required)

```javascript
function saveOrders(){
  if(!__auth){ toast('Login first to save','err'); openLoginModal(); return; }
  var body = JSON.stringify(ORDERS);
  var creds = btoa(__auth.username + ':' + __auth.password);
  fetch(WORKER_URL + 'upload', {
    method:'POST',
    headers:{
      'Authorization': 'Basic ' + creds,
      'X-Tool-Path': TOOL_PATH,
      'Content-Type': 'application/json'
    },
    body: body
  })
  .then(function(r){
    if(r.ok) toast('Saved successfully','ok');
    else r.text().then(function(t){ toast('Save failed: '+t,'err'); });
  })
  .catch(function(e){ toast('Network error: '+e.message,'err'); });
}
```

### Verifying credentials

```javascript
function verifyAuth(username, password){
  var creds = btoa(username + ':' + password);
  return fetch(WORKER_URL + 'verify', {
    method:'POST',
    headers:{'Authorization':'Basic '+creds}
  }).then(function(r){ return r.ok; }).catch(function(){ return false; });
}
```

---

## Data Model — Photo Studio Orders

Each order is a JavaScript object:

```javascript
{
  id: '[uuid or timestamp-based string]',
  client: 'Client Name',
  phone: '9999999999',
  eventType: 'Wedding',        // Wedding | Pre-Wedding | Portrait | Commercial | Other
  eventDate: '2025-12-15',     // ISO date string
  deliveryDate: '2026-01-10',
  package: 'Premium',
  advance: 25000,              // number (INR)
  balance: 35000,              // number (INR)
  notes: 'Free text notes',
  status: 'Upcoming',          // Upcoming | Shooting Done | Editing | Delivered | Archived
  createdAt: '2025-05-12T10:30:00'
}
```

### Generating IDs

```javascript
function genId(){
  return Date.now().toString(36) + Math.random().toString(36).slice(2,6);
}
```

---

## UI Patterns to Follow

### Color Palette
```css
:root {
  --primary: #4736FE;
  --success: #16a34a;
  --warning: #d97706;
  --danger:  #dc2626;
  --bg:      #F9FAFB;
  --surface: #FFFFFF;
  --border:  #E5E7EB;
  --text:    #111827;
  --muted:   #6B7280;
}
```

### Status Badges
```javascript
function statusBadge(status){
  var colors = {
    'Upcoming':     'background:#eff6ff;color:#2563eb;border:1px solid #bfdbfe',
    'Shooting Done':'background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0',
    'Editing':      'background:#fffbeb;color:#d97706;border:1px solid #fde68a',
    'Delivered':    'background:#f5f3ff;color:#7c3aed;border:1px solid #ddd6fe',
    'Archived':     'background:#f9fafb;color:#9ca3af;border:1px solid #e5e7eb'
  };
  var s = colors[status] || colors['Archived'];
  return '<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;'+s+'">'+esc(status)+'</span>';
}
```

### Toast Notifications
```javascript
function toast(msg, type){
  var t = document.getElementById('toast');
  if(!t){ t=document.createElement('div'); t.id='toast'; document.body.appendChild(t);
    t.style.cssText='position:fixed;bottom:20px;right:20px;padding:10px 16px;border-radius:8px;font-size:13px;font-weight:500;z-index:9999;display:none;max-width:320px;box-shadow:0 4px 12px rgba(0,0,0,.15)'; }
  t.style.display='block';
  t.style.background = type==='ok'?'#f0fdf4':type==='err'?'#fef2f2':'#f8fafc';
  t.style.color      = type==='ok'?'#16a34a':type==='err'?'#dc2626':'#374151';
  t.style.border     = 'solid 1px '+(type==='ok'?'#bbf7d0':type==='err'?'#fecaca':'#e5e7eb');
  t.textContent = msg;
  clearTimeout(t._t);
  t._t = setTimeout(function(){ t.style.display='none'; }, 3000);
}
```

---

## Version Management

Every time you make a change:
1. Increment the version number in `<title>Tathastu Studio v1.X</title>`
2. Increment the same version in any header text that shows it
3. State the version bump clearly at the top of your response: **`v1.2 → v1.3 — What changed`**

Version format: `v[major].[minor]` — minor bumps for any change, major bumps for full redesigns.

---

## What to Output Every Time

When producing or editing HTML, always output:

1. **Version line** at top of response: `v1.2 → v1.3 — Description of change`
2. **The complete `index.html` file** — always the full file, never partial diffs
3. **What changed** — 3–5 bullet points explaining what was added/fixed
4. **What to do next** — one sentence Vicky needs to: copy this file → push to GitHub → Vercel auto-deploys

Never output partial code snippets that require manual merging. Always give the complete file.

---

## Go Live Checklist (for Vicky)

Use this checklist when the brother shares a new version of the HTML:

- [ ] **1. Deploy the Cloudflare Worker**
  - Copy `worker.js` from `vickybhardwaj-cars24/c24-tracker` as a reference
  - Change the R2 bucket binding name to `tathastu-data`
  - Set env vars: `AUTH_USERNAME`, `AUTH_PASSWORD`, `ALLOWED_TOOLS=tathastu-orders`
  - Deploy via Cloudflare dashboard or `wrangler deploy`
  - Note the Worker URL (e.g. `https://tathastu.vicky.workers.dev/`)

- [ ] **2. Fill in WORKER_URL in index.html**
  - Open `index.html`, find `const WORKER_URL = '[FILL IN YOUR WORKER URL]'`
  - Replace with the actual Worker URL (include trailing slash)

- [ ] **3. Push to GitHub**
  ```
  git clone https://github.com/vickybhardwaj-cars24/tathastu
  cp index.html tathastu/
  cd tathastu
  git add index.html
  git commit -m "v1.0 — initial deploy"
  git push origin main
  ```

- [ ] **4. Connect Vercel**
  - Go to vercel.com → New Project → Import `vickybhardwaj-cars24/tathastu`
  - Framework preset: **Other**
  - Build command: *(leave blank)*
  - Output directory: `.` (dot — the root)
  - Click Deploy

- [ ] **5. Test**
  - Open the Vercel URL
  - Click Login → enter credentials → should authenticate via Worker
  - Add a test order → Save → Refresh page → order should persist

- [ ] **Subsequent updates** (after initial setup):
  - Brother shares new `index.html` → Vicky replaces file in repo → `git add . && git commit -m "v1.X — ..." && git push` → Vercel auto-deploys in ~30 seconds

---

## What Claude Will NOT Do

- Will not split the app across multiple files
- Will not use any JS framework or library (not even Alpine.js or HTMX)
- Will not suggest running `npm install` or any build commands
- Will not add server-side code to the HTML file
- Will not use `document.write()`, `eval()`, or `with()`
- Will not leave `[FILL IN]` placeholders in working code — only in constants that need environment-specific values (WORKER_URL)
