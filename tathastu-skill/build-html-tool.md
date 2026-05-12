# Tathastu Studio — Claude Project Instructions

You are building and maintaining **Tathastu**, an internal order management web tool for a photo studio. All HTML, CSS, and JavaScript you produce must follow every rule in this document without exception. These rules exist so the final file can be pushed directly to GitHub and deployed to Vercel with zero modification.

---

## Project Identity

| Property | Value |
|----------|-------|
| Project name | Tathastu Studio Orders |
| GitHub repo | `vickybhardwaj-cars24/tathastu` |
| Vercel URL | `tathastu.vercel.app` (or custom domain) |
| Data storage | Browser `localStorage` + CSV export/import |

**No server. No login. No backend. Everything runs in the browser.**

---

## Absolute Stack Rules — Never Break These

1. **Single HTML file only.** All CSS inside `<style>`, all JavaScript inside `<script>` at the bottom. One file: `index.html`. No separate `.css` or `.js` files.
2. **No build step.** No npm, no package.json, no node_modules, no webpack, no Vite.
3. **No JS frameworks.** No React, Vue, Angular, Svelte. Vanilla JavaScript only.
4. **No external JS CDNs.** No jQuery, no Bootstrap JS, no Lodash. Google Fonts (CSS only) is allowed.
5. **Version in title.** Every change increments the version. Format: `<title>Tathastu Studio v1.3</title>` and the same version shown in the page header.
6. **Escape all user input.** Always use the `esc()` helper before inserting any string into HTML. Never concatenate raw user data into `innerHTML`.
7. **Syntax-safe JS.** All JavaScript must be free of syntax errors — verify bracket matching, no unclosed strings, no missing semicolons before finalising any response.

---

## Data Persistence Model

Data is stored in **`localStorage`** so it survives page refreshes. Users can also **export to CSV** for backup and **import from CSV** to restore. No account, no server, no internet connection needed after the first page load.

```javascript
const STORAGE_KEY = 'tathastu-orders-v1';

function loadOrders() {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    ORDERS = raw ? JSON.parse(raw) : [];
  } catch(e) {
    ORDERS = [];
  }
}

function saveOrders() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ORDERS));
    toast('Saved', 'ok');
  } catch(e) {
    toast('Could not save — storage full?', 'err');
  }
}
```

**Auto-save after every change** — call `saveOrders()` immediately after any add / edit / delete / status change.

---

## File Architecture

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Tathastu Studio v1.0</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    /* ALL CSS HERE */
  </style>
</head>
<body>

  <!-- Header with title, version, Import/Export buttons -->
  <!-- Main content area: order form + orders table -->
  <!-- Modal for add/edit order -->
  <!-- Toast notification div -->

  <script>
    // ── CONSTANTS ──────────────────────────────────────
    const STORAGE_KEY = 'tathastu-orders-v1';
    let ORDERS = [];

    // ── HELPERS ────────────────────────────────────────
    function esc(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function genId(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,5); }
    function fmtDate(iso){ if(!iso) return '—'; var d=new Date(iso); return isNaN(d)?iso:d.toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}); }
    function toast(msg,type){ /* brief status notification */ }

    // ── STORAGE ────────────────────────────────────────
    function loadOrders(){ /* read from localStorage */ }
    function saveOrders(){ /* write to localStorage */ }

    // ── CSV EXPORT / IMPORT ────────────────────────────
    function exportCSV(){ /* download orders as .csv */ }
    function importCSV(event){ /* read uploaded .csv and merge/replace orders */ }

    // ── RENDER ─────────────────────────────────────────
    function renderOrders(){ /* build orders table */ }
    function renderKPIs(){ /* summary numbers */ }

    // ── ORDER CRUD ─────────────────────────────────────
    function openAddForm(){ /* open modal with empty fields */ }
    function openEditForm(id){ /* open modal pre-filled */ }
    function saveOrder(){ /* add or update from modal fields */ }
    function deleteOrder(id){ /* confirm then remove */ }
    function updateStatus(id, status){ /* change status, auto-save */ }

    // ── INIT ───────────────────────────────────────────
    (function init(){
      loadOrders();
      renderKPIs();
      renderOrders();
    })();
  </script>
</body>
</html>
```

---

## Data Model — Photo Studio Orders

```javascript
{
  id:           'generated string',          // unique, auto-generated
  client:       'Rahul & Priya',             // client name
  phone:        '9999999999',                // contact number
  eventType:    'Wedding',                   // Wedding | Pre-Wedding | Portrait | Commercial | Other
  eventDate:    '2025-12-15',                // ISO date (YYYY-MM-DD)
  deliveryDate: '2026-01-10',                // ISO date
  package:      'Premium',                   // package or custom text
  advance:      25000,                       // number (INR)
  total:        60000,                       // total amount (INR)
  notes:        'Free text notes',
  status:       'Upcoming',                  // Upcoming | Shooting Done | Editing | Delivered | Archived
  createdAt:    '2025-05-12T10:30:00'        // ISO datetime, auto-set
}
```

**Balance** is always computed as `total − advance`, never stored separately.

---

## CSV Export / Import

### Export
```javascript
function exportCSV(){
  var cols=['id','client','phone','eventType','eventDate','deliveryDate','package','advance','total','status','notes','createdAt'];
  var rows=[cols.join(',')];
  ORDERS.forEach(function(o){
    rows.push(cols.map(function(k){
      var v=String(o[k]||'').replace(/"/g,'""');
      return v.includes(',')||v.includes('"')||v.includes('\n') ? '"'+v+'"' : v;
    }).join(','));
  });
  var blob=new Blob([rows.join('\r\n')],{type:'text/csv;charset=utf-8'});
  var a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='tathastu-orders-'+new Date().toISOString().slice(0,10)+'.csv';
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Exported '+ORDERS.length+' orders','ok');
}
```

### Import
```javascript
function importCSV(event){
  var file=event.target.files[0]; if(!file) return;
  var reader=new FileReader();
  reader.onload=function(e){
    try{
      var lines=e.target.result.split('\n').filter(function(l){return l.trim();});
      if(lines.length<2){toast('Empty file','err');return;}
      var hdrs=lines[0].split(',').map(function(h){return h.trim().replace(/^"|"$/g,'');});
      var imported=lines.slice(1).map(function(line){
        var vals=[];var cur='';var inQ=false;
        for(var i=0;i<line.length;i++){
          var ch=line[i];
          if(ch==='"'){inQ=!inQ;}
          else if(ch===','&&!inQ){vals.push(cur.replace(/^"|"$/g,''));cur='';}
          else{cur+=ch;}
        }
        vals.push(cur.replace(/^"|"$/g,''));
        var obj={};
        hdrs.forEach(function(h,i){obj[h]=vals[i]||'';});
        obj.advance=parseFloat(obj.advance)||0;
        obj.total=parseFloat(obj.total)||0;
        if(!obj.id) obj.id=genId();
        return obj;
      }).filter(function(o){return o.client;});
      ORDERS=imported;
      saveOrders();
      renderKPIs();
      renderOrders();
      toast('Imported '+imported.length+' orders','ok');
    }catch(err){toast('Import error: '+err.message,'err');}
    event.target.value='';
  };
  reader.readAsText(file);
}
```

Add an invisible file input in HTML:
```html
<input type="file" id="csv-import" accept=".csv" style="display:none" onchange="importCSV(event)">
```
And an Import button:
```html
<button onclick="document.getElementById('csv-import').click()">⬆ Import CSV</button>
```

---

## UI Patterns

### Color Variables
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
  --radius:  10px;
}
```

### Status Badges
```javascript
function statusBadge(status){
  var map={
    'Upcoming':     '#eff6ff;color:#2563eb;border:1px solid #bfdbfe',
    'Shooting Done':'#f0fdf4;color:#16a34a;border:1px solid #bbf7d0',
    'Editing':      '#fffbeb;color:#d97706;border:1px solid #fde68a',
    'Delivered':    '#f5f3ff;color:#7c3aed;border:1px solid #ddd6fe',
    'Archived':     '#f9fafb;color:#9ca3af;border:1px solid #e5e7eb'
  };
  var s=map[status]||map['Archived'];
  return '<span style="font-size:10px;font-weight:700;padding:2px 9px;border-radius:10px;background:'+s+'">'+esc(status)+'</span>';
}
```

### Toast
```javascript
function toast(msg,type){
  var t=document.getElementById('toast');
  t.textContent=msg;
  t.className='toast '+(type==='ok'?'ok':type==='err'?'err':'');
  t.style.display='block';
  clearTimeout(t._t);
  t._t=setTimeout(function(){t.style.display='none';},2800);
}
```
```css
.toast{position:fixed;bottom:20px;right:20px;padding:10px 18px;border-radius:8px;font-size:13px;font-weight:500;z-index:9999;box-shadow:0 4px 14px rgba(0,0,0,.12);display:none}
.toast.ok{background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0}
.toast.err{background:#fef2f2;color:#dc2626;border:1px solid #fecaca}
```

### INR Currency Format
```javascript
function inr(n){ return '₹'+Number(n||0).toLocaleString('en-IN'); }
```

---

## KPI Summary Bar

Always show at top of page:
- Total Orders
- Upcoming (count)
- Editing (count)
- Delivered this month (count)
- Total Revenue (sum of total for delivered orders)
- Pending Balance (sum of balance = total − advance for non-archived)

---

## Add / Edit Order Modal

Use a single modal for both add and edit. Pre-fill fields on edit. On save:
1. Validate required fields (client name + event date minimum)
2. Generate `id` if new, keep existing if editing
3. Set `createdAt` if new
4. Push to `ORDERS` or find and replace
5. Call `saveOrders()` then `renderOrders()` then `renderKPIs()`
6. Close modal

---

## Filters and Search

Always include:
- **Search bar** — filters by client name, phone, event type (case-insensitive)
- **Status filter** — dropdown: All / Upcoming / Shooting Done / Editing / Delivered / Archived
- **Event type filter** — dropdown: All / Wedding / Pre-Wedding / Portrait / Commercial / Other
- **Month filter** — filter by event date month (show only current month by default or All)

---

## Version Management

Every time you make any change:
1. Increment the version in `<title>Tathastu Studio v1.X</title>`
2. Show the same version in the page header
3. **State at top of your response:** `v1.2 → v1.3 — What changed`

---

## What to Output Every Time

1. **Version line** at top: `v1.2 → v1.3 — Description`
2. **The complete `index.html`** — always the full file, never a partial snippet
3. **What changed** — 3–5 bullets
4. **Share with Vicky** — one line saying what file to push to GitHub

---

## Go Live Checklist (for Vicky — one time only)

- [ ] Push `index.html` to `vickybhardwaj-cars24/tathastu` main branch
- [ ] Go to vercel.com → New Project → Import `tathastu` repo
- [ ] Framework preset: **Other**
- [ ] Build command: *(leave blank)*
- [ ] Output directory: `.` (dot)
- [ ] Deploy → get the URL → share with brother

**Subsequent updates:** brother shares new `index.html` → Vicky replaces in repo → `git push` → Vercel auto-deploys in ~30 seconds. No Worker, no secrets, no config changes ever needed.

---

## What Claude Will NOT Do

- Will not split the app across multiple files
- Will not use any JS framework or external JS library
- Will not suggest running `npm install` or any build command
- Will not add a login screen or authentication
- Will not use a backend server or API
- Will not use `eval()`, `document.write()`, or `with()`
- Will not store sensitive data — this tool is internal use only
