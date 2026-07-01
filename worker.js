// CARS24 Internal Ops Tracker — Cloudflare Worker (R2-backed, gzip-aware)
//
// Routes
// ─────────────────────────────────────────────────────────────────────────
// GET  /<tool>.csv             → returns the object from R2; Content-Encoding
//                                 is propagated from R2 metadata so the
//                                 browser auto-decompresses gzipped objects
//                                 transparently. No auth.
// GET  /<tool>-mappings.json   → returns the per-tool annotations JSON object
//                                 (e.g. manual task→reg mappings). Returns
//                                 `{}` if the object isn't seeded yet so the
//                                 client never has to special-case 404. No
//                                 auth.
// POST /upload                 → raw body upload (typically gzipped). Headers:
//                                  Authorization: Basic <btoa(user:pass)>
//                                  X-Tool-Path:   <tool>
//                                  Content-Type:  application/gzip
//                                 Streams request.body straight into R2 with
//                                 contentEncoding=gzip metadata.
// POST /mappings               → unauthenticated JSON-body write of the
//                                 `<tool>-mappings.json` object. Headers:
//                                   X-Tool-Path:  <tool>
//                                   Content-Type: application/json
//                                 Body must be a JSON object (5 MB cap). The
//                                 dashboard's manual-reg-mapping UI uses this
//                                 so any user (logged in or not) can fix the
//                                 task→reg mapping for everyone. The bucket
//                                 is private and the only writer to this key
//                                 is this endpoint, so the small abuse
//                                 surface is acceptable for an internal tool.
// POST /verify                 → Basic auth header, no body. {success:true}
//                                 on valid.
// POST /  (legacy)             → JSON {username,password,csv_content,
//                                 tool_path[,action]}. Kept ONE deploy cycle
//                                 for safe ordering — to be removed in a
//                                 follow-up commit.
// POST /slack/send              → { mode:'channel'|'dm', email?, text }.
//                                 Requires the same auth as /upload. Relays to
//                                 Slack's Web API using SLACK_BOT_TOKEN so the
//                                 token never touches client-side code.
//
// Required env (Worker → Settings → Variables and Secrets):
//   AUTH_USERNAME  - plaintext username
//   AUTH_PASSWORD  - plaintext password
//   ALLOWED_TOOLS  - (optional) comma-separated allowlist
//   SLACK_BOT_TOKEN         - Bot User OAuth Token (xoxb-...). Needs the
//                             chat:write, users:read, users:read.email
//                             Bot Token Scopes in the Slack app.
//   SLACK_CHANNEL_ID        - channel ID that channel-mode alerts post to
//   SLACK_AUTOMATION_ENABLED - set to '1' to arm the daily cron digest below;
//                             leave unset until manual /slack/send sends have
//                             been verified to actually land in Slack
// Required binding:
//   BUCKET         - R2 bucket binding (variable name BUCKET → bucket c24-tracker-data)

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Tool-Path, If-None-Match, X-Site-Name, X-Photo-Date, X-File-Name',
  'Access-Control-Expose-Headers': 'ETag',
  'Access-Control-Max-Age': '86400',
};

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

// Constant-time string comparison.
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) {
    let diff = ab.length ^ bb.length;
    for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ (bb[i % bb.length] || 0);
    return false;
  }
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

function checkAuth(env, username, password) {
  if (!env.AUTH_USERNAME || !env.AUTH_PASSWORD) return false;
  const okUser = timingSafeEqual(username || '', env.AUTH_USERNAME);
  const okPass = timingSafeEqual(password || '', env.AUTH_PASSWORD);
  return okUser && okPass;
}

// Accept either Basic auth (existing) or a Supabase Bearer JWT.
// Supabase JWTs are verified by checking they decode to a valid payload
// issued by our project (iss matches) and are not expired.
async function checkAnyAuth(request, env) {
  const h = request.headers.get('Authorization') || '';

  // Basic auth — existing flow unchanged
  if (h.startsWith('Basic ')) {
    const auth = parseBasicAuth(request);
    return auth && checkAuth(env, auth.user, auth.pass);
  }

  // Bearer — Supabase JWT
  if (h.startsWith('Bearer ')) {
    const token = h.slice(7).trim();
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return false;
      const payload = JSON.parse(atob(parts[1].replace(/-/g,'+').replace(/_/g,'/')));
      // Must be from our Supabase project and not expired
      if (!payload.iss || !payload.iss.includes('fnvylizldarvqejsfkbn')) return false;
      if (!payload.exp || Date.now() / 1000 > payload.exp) return false;
      // Must be a real user (not anon)
      if (payload.is_anonymous === true) return false;
      return true;
    } catch (_) { return false; }
  }

  return false;
}

function isValidToolPath(env, tp) {
  if (!tp || typeof tp !== 'string') return false;
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(tp)) return false;
  if (env.ALLOWED_TOOLS) {
    const allowed = env.ALLOWED_TOOLS.split(',').map(s => s.trim()).filter(Boolean);
    if (allowed.length && !allowed.includes(tp)) return false;
  }
  return true;
}

// Decode `Authorization: Basic <btoa(user:pass)>`. Returns {user, pass} or null.
function parseBasicAuth(request) {
  const h = request.headers.get('Authorization') || '';
  if (!h.startsWith('Basic ')) return null;
  let decoded = '';
  try { decoded = atob(h.slice(6)); } catch (_) { return null; }
  const idx = decoded.indexOf(':');
  if (idx === -1) return null;
  return { user: decoded.slice(0, idx), pass: decoded.slice(idx + 1) };
}

async function handleGet(request, env) {
  const url = new URL(request.url);
  const path = decodeURIComponent(url.pathname.replace(/^\/+/, ''));

  // Per-tool annotations JSON (currently: manual task_id → reg mappings used
  // by the delivery-data-report dashboard). Read-only, no auth, returns `{}`
  // when the object hasn't been seeded yet so callers don't have to branch
  // on 404.
  const mm = path.match(/^([a-z0-9][a-z0-9-]{0,40})-mappings\.json$/);
  if (mm) return handleGetMappings(mm[1], env);

  const m = path.match(/^([a-z0-9][a-z0-9-]{0,40})\.csv$/);
  if (!m) return json(400, { success: false, error: 'Invalid path; expected /<tool>.csv or /<tool>-mappings.json' });
  const tool = m[1];
  if (!isValidToolPath(env, tool)) return json(404, { success: false, error: 'Unknown tool' });
  if (!env.BUCKET) return json(500, { success: false, error: 'Worker is missing BUCKET binding' });

  // Conditional GET: if the client sent If-None-Match and R2's etag matches,
  // R2's `etagDoesNotMatch` precondition fails and the binding returns the
  // R2Object metadata WITHOUT a body — that's our 304 cue. Lets the page-side
  // Cache API serve the previous body from disk and skip the wire transfer
  // entirely. R2 still bills us for the head-style request, but those are
  // negligible compared to 5+ MB body reads on every page load.
  //
  // R2's onlyIf wants the RAW etag (e.g. `abc123`), but the HTTP If-None-Match
  // header carries the quoted form (`"abc123"`) and may have a weak prefix
  // (`W/"abc123"`). Strip both before handing to R2 — passing quotes through
  // throws inside the binding (CF Worker error 1101 → 500 to the client).
  const ifNoneMatch = request.headers.get('If-None-Match');
  const rawEtag = ifNoneMatch
    ? ifNoneMatch.trim().replace(/^W\//, '').replace(/^"/, '').replace(/"$/, '')
    : null;
  const opts = rawEtag ? { onlyIf: { etagDoesNotMatch: rawEtag } } : undefined;
  const obj = await env.BUCKET.get(`${tool}.csv`, opts);
  if (!obj) return json(404, { success: false, error: 'CSV not found' });

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers': 'ETag',
  };

  if (!obj.body) {
    return new Response(null, {
      status: 304,
      headers: { ETag: obj.httpEtag, ...corsHeaders },
    });
  }

  // Stream the R2 body through untouched as opaque bytes. We don't set
  // Content-Encoding: gzip on the response, even when the R2 object is
  // gzipped, because Cloudflare's workers.dev edge double-gzips Worker
  // responses that carry Content-Encoding (see CLAUDE.md "Cloudflare double-
  // gzip"). The page-side fetcher (C24Uploader.fetchText) sniffs gzip magic
  // bytes and decompresses with DecompressionStream.
  const headers = new Headers();
  headers.set('Content-Type', 'application/octet-stream');
  headers.set('Cache-Control', 'no-store');
  headers.set('ETag', obj.httpEtag);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Expose-Headers', 'ETag');
  return new Response(obj.body, { status: 200, headers });
}

// Authenticated raw-body upload. The body is treated as opaque bytes and stored
// in R2 with contentEncoding=gzip so subsequent GETs serve the proper header.
async function handleUpload(request, env) {
  if (!await checkAnyAuth(request, env)) {
    return json(401, { success: false, error: 'Invalid credentials' });
  }
  const tool = request.headers.get('X-Tool-Path') || '';
  if (!isValidToolPath(env, tool)) {
    return json(400, { success: false, error: 'Invalid or disallowed tool_path' });
  }
  if (!request.body) {
    return json(400, { success: false, error: 'Empty body' });
  }
  if (!env.BUCKET) {
    return json(500, { success: false, error: 'Worker is missing BUCKET binding' });
  }
  try {
    await env.BUCKET.put(`${tool}.csv`, request.body, {
      httpMetadata: {
        contentType: 'text/csv; charset=utf-8',
        contentEncoding: 'gzip',
        cacheControl: 'no-store, no-transform',
      },
    });
    return json(200, { success: true, path: `${tool}.csv` });
  } catch (e) {
    return json(502, { success: false, error: String(e && e.message || e) });
  }
}

async function handleVerify(request, env) {
  if (!await checkAnyAuth(request, env)) {
    return json(401, { success: false, error: 'Invalid credentials' });
  }
  return json(200, { success: true });
}

// Read the per-tool annotations object. Stored in R2 as `<tool>-mappings.json`
// alongside the CSV. We don't propagate ETags here — the file is tiny and
// gets read once at page load, so the round-trip cost is negligible.
async function handleGetMappings(tool, env) {
  if (!isValidToolPath(env, tool)) return json(404, { success: false, error: 'Unknown tool' });
  if (!env.BUCKET) return json(500, { success: false, error: 'Worker is missing BUCKET binding' });
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  };
  const obj = await env.BUCKET.get(`${tool}-mappings.json`);
  if (!obj || !obj.body) return new Response('{}', { status: 200, headers });
  return new Response(obj.body, { status: 200, headers });
}

// Unauthenticated JSON-object write to `<tool>-mappings.json`. Any user of
// the dashboard can amend manual task→reg mappings, so we deliberately skip
// auth here. A 20 MB cap keeps a hostile client from filling R2 with a
// single write — mappings are tiny (task_id key + ~10-char reg value),
// so a fully-mapped task table at today's volume sits at ~3-4 MB; 20 MB
// leaves comfortable headroom for the dataset growing several-fold before
// any legitimate write would brush against the cap.
//
// The cap is enforced BEFORE parsing JSON: an oversized body would otherwise
// be fully buffered + parsed by `request.json()` before we got to check it,
// defeating the cap and risking the Worker's CPU/memory limits. We trust
// Content-Length when it's declared, and otherwise read the stream with a
// running counter that bails the moment it overruns.
const MAPPINGS_MAX_BYTES = 20 * 1024 * 1024;

async function handleMappings(request, env) {
  const tool = request.headers.get('X-Tool-Path') || '';
  if (!isValidToolPath(env, tool)) {
    return json(400, { success: false, error: 'Invalid or disallowed tool_path' });
  }
  if (!env.BUCKET) {
    return json(500, { success: false, error: 'Worker is missing BUCKET binding' });
  }

  const declaredLen = parseInt(request.headers.get('Content-Length') || '', 10);
  if (Number.isFinite(declaredLen) && declaredLen > MAPPINGS_MAX_BYTES) {
    return json(413, { success: false, error: 'Mappings payload too large (max 20MB)' });
  }

  let bodyText;
  try {
    bodyText = await readBodyCapped(request, MAPPINGS_MAX_BYTES);
  } catch (e) {
    if (e && e.code === 'TOO_LARGE') {
      return json(413, { success: false, error: 'Mappings payload too large (max 20MB)' });
    }
    return json(400, { success: false, error: 'Failed to read request body' });
  }

  let payload;
  try { payload = JSON.parse(bodyText); }
  catch (_e) { return json(400, { success: false, error: 'Invalid JSON body' }); }
  if (typeof payload !== 'object' || Array.isArray(payload) || payload === null) {
    return json(400, { success: false, error: 'Body must be a JSON object' });
  }

  try {
    // Store the captured text as-is. It already passed the size check and
    // round-tripped through JSON.parse for validation, so re-serialising
    // would just burn cycles producing the same bytes.
    await env.BUCKET.put(`${tool}-mappings.json`, bodyText, {
      httpMetadata: {
        contentType: 'application/json; charset=utf-8',
        cacheControl: 'no-store, no-transform',
      },
    });
    return json(200, { success: true, count: Object.keys(payload).length });
  } catch (e) {
    return json(502, { success: false, error: String(e && e.message || e) });
  }
}

// Read a request body fully into a UTF-8 string, but bail early once the
// cumulative byte count exceeds `limit`. Lets us reject oversized uploads
// without first buffering them — a chunked-encoded request that lies about
// (or omits) Content-Length still can't push us past the cap.
async function readBodyCapped(request, limit) {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > limit) {
      try { await reader.cancel(); } catch (_) {}
      const err = new Error('Body exceeds cap');
      err.code = 'TOO_LARGE';
      throw err;
    }
    chunks.push(value);
  }
  if (!chunks.length) return '';
  if (chunks.length === 1) return new TextDecoder('utf-8').decode(chunks[0]);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  return new TextDecoder('utf-8').decode(out);
}

// ═══ SLACK INTEGRATION ═══════════════════════════════════════════════════
// Bot token never leaves this Worker — the frontend only ever calls our own
// POST /slack/send, never slack.com directly. See header comment for the
// required SLACK_BOT_TOKEN / SLACK_CHANNEL_ID / SLACK_AUTOMATION_ENABLED env.

// Reconstructed from the removed SLACK_HANDLES map (frontend index.html had
// the same 26-name table before the old Slack tab was deleted) — converts
// '@vicky.bhardwaj' style handles into real emails for users.lookupByEmail.
// Kept in sync manually with the PM_EMAIL_MAP in index.html; there is no
// shared module between the two runtimes.
const PM_EMAIL_MAP = {
  'Ajeet':'ajeet.sharma@cars24.com','Akhtar':'md.fasih.akhtar@cars24.com','Arun':'arun.varghese@cars24.com',
  'Chetan':'chetan.jaskalyan@cars24.com','Danish':'danish.sharrma@cars24.com','Gaurav':'gaurav.pandey@cars24.com',
  'Harshit':'harshit.pandey@cars24.com','Indranil':'indranil.roy.chowdhury@cars24.com','Kamal':'kamal.saini@cars24.com',
  'Karan':'karan.dhar.singh.bharti@cars24.com','Nitesh':'nitesh.kumar@cars24.com','Pallavi':'pallavi.priya@cars24.com',
  'Pradeep':'pradeep.yadav@cars24.com','Rahul':'rahul.panwar@cars24.com','Rajat':'rajat.sharma@cars24.com',
  'Raman':'raman.kumar@cars24.com','Riya':'riya.kumari@cars24.com','Sachin':'sachin.lohchab@cars24.com',
  'Saurabh':'saurabh.girdhar@cars24.com','Shivam':'shivam.shukla@cars24.com','Shubhita':'shubhita.jain@cars24.com',
  'Sumit':'sumit.kumar@cars24.com','Swatesh':'swatesh.kumar@cars24.com','Tanuj':'tanuj.singh@cars24.com',
  'Vicky':'vicky.bhardwaj@cars24.com','Vinod':'vinod.yadav@cars24.com',
};

async function slackApi(env, method, params) {
  if (!env.SLACK_BOT_TOKEN) { const e = new Error('SLACK_BOT_TOKEN not configured'); e.code = 'NOT_CONFIGURED'; throw e; }
  const resp = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(params),
  });
  const data = await resp.json();
  if (!data.ok) throw new Error(`Slack ${method} failed: ${data.error || 'unknown_error'}`);
  return data;
}

async function resolveSlackUserId(env, email) {
  const url = `https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(email)}`;
  const resp = await fetch(url, { headers: { 'Authorization': `Bearer ${env.SLACK_BOT_TOKEN}` } });
  const data = await resp.json();
  if (!data.ok) throw new Error(`users.lookupByEmail failed for ${email}: ${data.error || 'unknown_error'}`);
  return data.user.id;
}

async function postSlackMessage(env, channel, text) {
  return slackApi(env, 'chat.postMessage', { channel, text, unfurl_links: false });
}

// POST /slack/send — { mode:'channel'|'dm', email?, text }. Same auth gate as
// /upload so only logged-in dashboard users can trigger a send.
async function handleSlackSend(request, env) {
  if (!await checkAnyAuth(request, env)) return json(401, { success: false, error: 'Invalid credentials' });

  let body;
  try { body = await request.json(); } catch (_e) { return json(400, { success: false, error: 'Invalid JSON body' }); }
  const { mode, email, text } = body || {};
  if (!text || typeof text !== 'string') return json(400, { success: false, error: 'Missing text' });

  try {
    if (mode === 'dm') {
      if (!email) return json(400, { success: false, error: 'Missing email for DM' });
      let userId;
      try { userId = await resolveSlackUserId(env, email); }
      catch (e) {
        // No Slack account for this email — fall back to the channel so the
        // message isn't silently dropped.
        if (!env.SLACK_CHANNEL_ID) return json(502, { success: false, error: String(e && e.message || e) });
        await postSlackMessage(env, env.SLACK_CHANNEL_ID, text);
        return json(200, { success: true, fellBackToChannel: true });
      }
      await postSlackMessage(env, userId, text);
    } else {
      if (!env.SLACK_CHANNEL_ID) return json(500, { success: false, error: 'SLACK_CHANNEL_ID not configured' });
      await postSlackMessage(env, env.SLACK_CHANNEL_ID, text);
    }
    return json(200, { success: true });
  } catch (e) {
    return json(502, { success: false, error: String(e && e.message || e) });
  }
}

// Decompress a gzip R2 object body into UTF-8 text — used by the cron job
// below to read projects-tracker.csv / tickets.csv directly from R2 the same
// way the browser's C24Uploader.fetchText does client-side.
async function gunzipText(body) {
  return new Response(body.pipeThrough(new DecompressionStream('gzip'))).text();
}

// ── Minimal ports of index.html business logic, needed ONLY by the
// automatic cron digest below (manual /slack/send sends build their text in
// the browser, which already has the full logic). Keep these in sync with
// the real implementations in projects-tracker/index.html and with
// CLAUDE.md's "Business Logic — Critical" section — that doc is the source
// of truth for these rules.
const META_COLS_W = ['S.No.','BU','Cost Center','Site Name','Zone','Owner','Vendor','Vendor Rating',
  'Percentage Completion','Status','PO Date','Kickoff Date','Work Start Date','SAT Date','UAT DATE',
  'Planned Completion','Revised Completion','Reason for Delay'];
const BLOCKER_PREFIXES_W = ['BD','Design','Branding','HEM','Commercial','Ops','HRC','Legal','Govt','Mall','BOQ','IT','Finance','Infra','CS'];
const UAT_WARN_DAYS_W = 15;
const STALE_WARN_DAYS_W = 5;
const STALE_CRIT_DAYS_W = 10;

function pdW(s) {
  if (!s || !s.trim()) return null;
  const ml = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
  const parts = s.trim().split(/[\s/\-]/);
  let day = null, mo = null, yr = null;
  parts.forEach(p => {
    const n = parseInt(p);
    if (!isNaN(n) && n > 31) yr = n;
    else if (!isNaN(n) && n >= 1 && n <= 31 && day === null) day = n;
    const mk = ml[p.toLowerCase().substring(0,3)];
    if (mk !== undefined) mo = mk;
  });
  if (day === null || mo === null) {
    const nd = new Date(s);
    if (!isNaN(nd.getTime())) return new Date(nd.getFullYear(), nd.getMonth(), nd.getDate());
    return null;
  }
  if (yr === null) {
    const today = new Date(); today.setHours(0,0,0,0);
    yr = today.getFullYear();
  }
  return new Date(yr, mo, day);
}

function parseCSVRows(txt) {
  txt = txt.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows = [];
  let row = [], cell = '', inQ = false, i = 0;
  while (i < txt.length) {
    const ch = txt[i];
    if (inQ) {
      if (ch === '"' && txt[i+1] === '"') { cell += '"'; i += 2; }
      else if (ch === '"') { inQ = false; i++; }
      else { cell += ch; i++; }
    } else {
      if (ch === '"') { inQ = true; i++; }
      else if (ch === ',') { row.push(cell.trim()); cell = ''; i++; }
      else if (ch === '\n') {
        row.push(cell.trim());
        if (row.some(c => c)) rows.push(row);
        row = []; cell = ''; i++;
      } else { cell += ch; i++; }
    }
  }
  if (cell || row.length > 0) { row.push(cell.trim()); if (row.some(c => c)) rows.push(row); }
  if (rows.length < 2) return { rows: [], dateCols: [] };
  const hdrs = rows[0].map(h => h.replace(/^﻿/, '').trim());
  const dateCols = hdrs.filter(h => !META_COLS_W.includes(h));
  const out = rows.slice(1).map(r => {
    const o = {}; hdrs.forEach((h, idx) => { o[h] = (r[idx] || '').trim(); }); return o;
  });
  return { rows: out, dateCols };
}

function extractBlockersW(text) {
  if (!text) return [];
  const found = [];
  BLOCKER_PREFIXES_W.forEach(p => {
    if (new RegExp('(?:^|[\\n.\\s])' + p + '\\s*:', 'i').test(text) && !found.includes(p)) found.push(p);
  });
  return found;
}

function getLatestUpdateW(r, dateCols) {
  for (let i = dateCols.length - 1; i >= 0; i--) {
    const v = (r[dateCols[i]] || '').trim();
    if (v) return v;
  }
  return '';
}

function getStaleDaysW(row, dateCols) {
  const st = (row['Status'] || '').trim().toLowerCase();
  if (st === 'uat done' || st === 'completed' || st === 'comleted') return 0;
  if ((row['UAT DATE'] || '').trim()) return 0;
  const today = new Date(); today.setHours(0,0,0,0);
  for (let i = dateCols.length - 1; i >= 0; i--) {
    const v = (row[dateCols[i]] || '').trim();
    if (v && v.toLowerCase() !== 'completed' && v.toLowerCase() !== 'uat done') {
      const d = pdW(dateCols[i]);
      if (d) return Math.round((today - d) / 86400000);
    }
  }
  return 0;
}

function committedDateW(r) {
  return pdW(r['Revised Completion']) || pdW(r['Planned Completion']) || null;
}

// ── Daily Slack digest (cron-driven, no browser involved) ──────────────────
// Reads the same R2 objects the frontend reads on page load, so the digest
// is exactly as fresh as the last manual CSV upload — same freshness
// contract the rest of this app already has.

async function fetchCsvFromR2(env, tool) {
  if (!env.BUCKET) return null;
  const obj = await env.BUCKET.get(`${tool}.csv`);
  if (!obj || !obj.body) return null;
  try { return await gunzipText(obj.body); }
  catch (e) { console.error(`gunzip failed for ${tool}.csv:`, e); return null; }
}

function pickCol(row, names) {
  for (let i = 0; i < names.length; i++) { if (row[names[i]] !== undefined) return row[names[i]] || ''; }
  return '';
}

async function postCrossFunctionalBlockers(env, sitesText) {
  if (!env.SLACK_CHANNEL_ID) return;
  const { rows, dateCols } = parseCSVRows(sitesText);
  const buckets = {};
  rows.forEach(r => {
    const site = (r['Site Name'] || '').trim(); if (!site) return;
    const st = (r['Status'] || '').toLowerCase();
    if (st.includes('uat done') || st.includes('completed')) return;
    const bl = extractBlockersW(getLatestUpdateW(r, dateCols));
    bl.forEach(tag => { (buckets[tag] = buckets[tag] || []).push(site); });
  });
  const tags = Object.keys(buckets);
  if (!tags.length) return;
  const lines = ['*🚦 Cross-Functional Blockers — Daily Digest*', ''];
  tags.forEach(tag => {
    lines.push('*' + tag + '* — ' + buckets[tag].length + ' site' + (buckets[tag].length > 1 ? 's' : ''));
    buckets[tag].forEach(s => lines.push('  • ' + s));
  });
  await postSlackMessage(env, env.SLACK_CHANNEL_ID, lines.join('\n'));
}

async function postPmDigests(env, sitesText) {
  const { rows, dateCols } = parseCSVRows(sitesText);
  const byPM = {};
  rows.forEach(r => {
    const site = (r['Site Name'] || '').trim(); if (!site) return;
    const owner = (r['Owner'] || '').trim(); if (!owner) return;
    (byPM[owner] = byPM[owner] || []).push(r);
  });
  const today = new Date();
  const ds = today.getDate() + ' ' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][today.getMonth()];
  for (const owner of Object.keys(byPM)) {
    const email = PM_EMAIL_MAP[owner];
    if (!email) continue; // no mapped Slack account — skip rather than guess
    const lines = ['*Your Site Updates — ' + ds + '*', ''];
    byPM[owner].forEach(r => {
      const status = r['Status'] || '', pct = r['Percentage Completion'] || '';
      const stale = getStaleDaysW(r, dateCols);
      lines.push('*' + r['Site Name'] + '* (' + status + (pct ? ' · ' + pct : '') + ')' + (stale >= STALE_WARN_DAYS_W ? ' ⏸ ' + stale + 'd stale' : ''));
    });
    try {
      const userId = await resolveSlackUserId(env, email);
      await postSlackMessage(env, userId, lines.join('\n'));
    } catch (e) { console.error('PM digest DM failed for ' + owner + ':', e); }
  }
}

// Approximates index.html's SAT Delay / UAT Warning rules (CLAUDE.md
// "Business Logic — Critical"): SAT overdue = Planned Completion passed with
// no SAT Date; UAT overdue = > UAT_WARN_DAYS_W since SAT with no UAT Date.
async function postDelayReminders(env, sitesText) {
  if (!env.SLACK_CHANNEL_ID) return;
  const { rows } = parseCSVRows(sitesText);
  const today = new Date(); today.setHours(0,0,0,0);
  const satOverdue = [], uatOverdue = [];
  rows.forEach(r => {
    const site = (r['Site Name'] || '').trim(); if (!site) return;
    const satDate = (r['SAT Date'] || '').trim();
    const uatDate = (r['UAT DATE'] || '').trim();
    if (!satDate) {
      const planned = committedDateW(r);
      if (planned) {
        const days = Math.round((today - planned) / 86400000);
        if (days >= 7) satOverdue.push({ site, days, owner: r['Owner'] || '' });
      }
    } else if (!uatDate) {
      const satD = pdW(satDate);
      if (satD) {
        const days = Math.round((today - satD) / 86400000);
        if (days > UAT_WARN_DAYS_W) uatOverdue.push({ site, days, owner: r['Owner'] || '' });
      }
    }
  });
  if (!satOverdue.length && !uatOverdue.length) return;
  const lines = ['*⏳ Delay Reminders — Daily Digest*', ''];
  if (satOverdue.length) {
    lines.push('*SAT Overdue* (' + satOverdue.length + '):');
    satOverdue.sort((a,b) => b.days - a.days).forEach(x => lines.push('  • ' + x.site + ' — ' + x.days + 'd overdue (' + (x.owner || 'Unassigned') + ')'));
    lines.push('');
  }
  if (uatOverdue.length) {
    lines.push('*UAT Overdue* (' + uatOverdue.length + '):');
    uatOverdue.sort((a,b) => b.days - a.days).forEach(x => lines.push('  • ' + x.site + ' — ' + x.days + 'd since SAT (' + (x.owner || 'Unassigned') + ')'));
  }
  await postSlackMessage(env, env.SLACK_CHANNEL_ID, lines.join('\n'));
}

async function postTicketSummary(env, ticketsText) {
  if (!env.SLACK_CHANNEL_ID) return;
  const { rows } = parseCSVRows(ticketsText);
  if (!rows.length) return;
  const total = rows.length;
  const urgent = rows.filter(r => pickCol(r, ['Priority']).toLowerCase() === 'urgent').length;
  const over30 = rows.filter(r => parseInt(pickCol(r, ['Open Since Days','TAT']) || 0) > 30).length;
  const unassigned = rows.filter(r => { const a = pickCol(r, ['Assigned To']); return !a || a.toLowerCase() === 'unassigned'; }).length;
  const today = new Date();
  const dateStr = today.getDate() + ' ' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][today.getMonth()];
  const lines = ['*🎫 Ticket Summary — ' + dateStr + '*', '', '📊 *' + total + ' open* · 🚨 ' + urgent + ' urgent · ⏰ ' + over30 + ' over 30d · ❓ ' + unassigned + ' unassigned'];
  await postSlackMessage(env, env.SLACK_CHANNEL_ID, lines.join('\n'));
}

async function runSlackDailyDigest(env) {
  const [sitesText, ticketsText] = await Promise.all([
    fetchCsvFromR2(env, 'projects-tracker'),
    fetchCsvFromR2(env, 'tickets'),
  ]);
  if (sitesText) {
    try { await postCrossFunctionalBlockers(env, sitesText); } catch (e) { console.error('Slack blockers digest failed:', e); }
    try { await postPmDigests(env, sitesText); } catch (e) { console.error('Slack PM digest failed:', e); }
    try { await postDelayReminders(env, sitesText); } catch (e) { console.error('Slack delay reminders failed:', e); }
  }
  if (ticketsText) {
    try { await postTicketSummary(env, ticketsText); } catch (e) { console.error('Slack ticket summary failed:', e); }
  }
}

// GET /pf-tickets                              — fetch all tickets (page-load style)
// GET /pf-tickets?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD  — date-filtered fetch
// Server-side proxy to processflows.ai — bypasses browser CORS.
// Env vars (set in Cloudflare dashboard → Settings → Variables and Secrets):
//   PF_CSRFTOKEN  — value of the csrftoken cookie from a logged-in browser session
//   PF_SESSIONID  — value of the sessionid cookie from a logged-in browser session
async function handlePFTickets(request, env) {
  const url = new URL(request.url);
  const startDate = url.searchParams.get('start_date') || '';
  const endDate   = url.searchParams.get('end_date')   || '';

  const department = url.searchParams.get('department') || '';

  // Build processflows URL — department first, then dates (matches API expectation)
  let pfUrl = 'https://processflows.ai/api/ticket-list/?';
  if (department) {
    pfUrl += `department=${encodeURIComponent(department)}&`;
  }
  if (startDate && endDate) {
    pfUrl += `start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}&`;
  }

  // Build Cookie header from individual env vars
  const cookieParts = [];
  if (env.PF_CSRFTOKEN) cookieParts.push(`csrftoken=${env.PF_CSRFTOKEN}`);
  if (env.PF_SESSIONID) cookieParts.push(`sessionid=${env.PF_SESSIONID}`);

  const fetchHeaders = {
    'Accept':               '*/*',
    'Accept-Language':      'en-US,en;q=0.9',
    'Referer':              'https://processflows.ai/ticket_dashboard/',
    'User-Agent':           'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
    'sec-ch-ua':            '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
    'sec-ch-ua-mobile':     '?0',
    'sec-ch-ua-platform':   '"Windows"',
    'sec-fetch-dest':       'empty',
    'sec-fetch-mode':       'cors',
    'sec-fetch-site':       'same-origin',
    'priority':             'u=1, i',
  };
  if (cookieParts.length) fetchHeaders['Cookie'] = cookieParts.join('; ');

  try {
    const resp = await fetch(pfUrl, { headers: fetchHeaders });
    const text = await resp.text();
    if (!resp.ok) {
      return json(resp.status, { success: false, error: `ProcessFlows API returned ${resp.status}`, detail: text.slice(0, 500) });
    }
    return new Response(text, {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
    });
  } catch (e) {
    return json(502, { success: false, error: 'Proxy fetch failed: ' + String(e && e.message || e) });
  }
}

// GET /pf-attendance — proxy to processflows.ai attendance records CSV export.
// Uses same cookie credentials as /pf-tickets.
async function handlePFAttendance(request, env) {
  const url = new URL(request.url);
  const startDate  = url.searchParams.get('start_date')  || '2026-01-01';
  const endDate    = url.searchParams.get('end_date')    || new Date().toISOString().slice(0, 10);
  const workflowId = url.searchParams.get('workflow_id') || '6';

  const pfUrl = `https://processflows.ai/api/attendance/records/?employee_id=&workflow_id=${encodeURIComponent(workflowId)}&store_id=&start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}&is_manual=&export=csv`;

  const cookieParts = [];
  if (env.PF_CSRFTOKEN) cookieParts.push(`csrftoken=${env.PF_CSRFTOKEN}`);
  if (env.PF_SESSIONID) cookieParts.push(`sessionid=${env.PF_SESSIONID}`);

  const fetchHeaders = {
    'Accept':           'text/csv,*/*',
    'Accept-Language':  'en-US,en;q=0.9',
    'Referer':          'https://processflows.ai/attendance/',
    'User-Agent':       'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
    'sec-fetch-dest':   'empty',
    'sec-fetch-mode':   'cors',
    'sec-fetch-site':   'same-origin',
  };
  if (cookieParts.length) fetchHeaders['Cookie'] = cookieParts.join('; ');

  try {
    const resp = await fetch(pfUrl, { headers: fetchHeaders });
    const text = await resp.text();
    if (!resp.ok) {
      return json(resp.status, { success: false, error: `ProcessFlows API returned ${resp.status}`, detail: text.slice(0, 500) });
    }
    return new Response(text, {
      status: 200,
      headers: { 'Content-Type': 'text/csv; charset=utf-8', ...CORS_HEADERS },
    });
  } catch (e) {
    return json(502, { success: false, error: 'Proxy fetch failed: ' + String(e && e.message || e) });
  }
}

// the gzip migration. Will be removed in a follow-up commit.
async function handlePostLegacy(request, env) {
  let payload;
  try { payload = await request.json(); }
  catch (_e) { return json(400, { success: false, error: 'Invalid JSON body' }); }

  const { username, password, csv_content, tool_path, action } = payload || {};

  if (!checkAuth(env, username, password)) {
    return json(401, { success: false, error: 'Invalid credentials' });
  }
  if (action === 'verify' && !csv_content) {
    return json(200, { success: true });
  }
  if (!isValidToolPath(env, tool_path)) {
    return json(400, { success: false, error: 'Invalid or disallowed tool_path' });
  }
  if (typeof csv_content !== 'string' || !csv_content.length) {
    return json(400, { success: false, error: 'csv_content is required' });
  }
  if (!env.BUCKET) {
    return json(500, { success: false, error: 'Worker is missing BUCKET binding' });
  }
  try {
    // Legacy clients send plaintext — store without contentEncoding so GETs
    // don't claim a gzip body that isn't gzipped.
    await env.BUCKET.put(`${tool_path}.csv`, csv_content, {
      httpMetadata: {
        contentType: 'text/csv; charset=utf-8',
        cacheControl: 'no-store, no-transform',
      },
    });
    return json(200, { success: true, path: `${tool_path}.csv` });
  } catch (e) {
    return json(502, { success: false, error: String(e && e.message || e) });
  }
}

const SUPABASE_URL      = 'https://fnvylizldarvqejsfkbn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZudnlsaXpsZGFydnFlanNma2JuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0ODgzMDgsImV4cCI6MjA5NTA2NDMwOH0.YQwAIwpZCQGOev5kAABMSVFqdf36cZLwnrwPVFrhNfY';

export default {
  async scheduled(event, env, ctx) {
    if (event.cron === '0 9 */3 * *') {
      // Keep Supabase free-tier project alive — fires every 3 days via cron
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/sites?select=id&limit=1`, {
          headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
        });
      } catch(e) { console.error('Supabase ping failed:', e); }
    }

    if (event.cron === '30 3 * * *') {
      // Daily Slack digest — no-op until explicitly armed, so shipping this
      // code can't start posting before SLACK_BOT_TOKEN/CHANNEL are verified.
      if (env.SLACK_AUTOMATION_ENABLED === '1') {
        await runSlackDailyDigest(env);
      }
    }
  },

  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method === 'GET') {
      const gPath = new URL(request.url).pathname;
      if (gPath === '/pf-tickets')         return handlePFTickets(request, env);
      if (gPath === '/pf-attendance')      return handlePFAttendance(request, env);
      if (gPath.startsWith('/photos/'))    return handlePhotoGet(request, env);
      return handleGet(request, env);
    }
    if (request.method === 'POST') {
      const path = new URL(request.url).pathname;
      if (path === '/upload')        return handleUpload(request, env);
      if (path === '/verify')        return handleVerify(request, env);
      if (path === '/mappings')      return handleMappings(request, env);
      if (path === '/photo-upload')  return handlePhotoUpload(request, env);
      if (path === '/photo-delete')  return handlePhotoDelete(request, env);
      if (path === '/slack/send')    return handleSlackSend(request, env);
      if (path === '/')              return handlePostLegacy(request, env);

      return json(404, { success: false, error: 'Unknown POST endpoint' });
    }
    return json(405, { success: false, error: 'Method not allowed' });
  },
};

// ── Photo upload: POST /photo-upload ─────────────────────────────
// Headers: Authorization: Basic ..., X-Site-Name, X-Photo-Date, X-File-Name
// Body: raw JPEG blob (already compressed client-side)
async function handlePhotoUpload(request, env) {
  if (!await checkAnyAuth(request, env)) {
    return json(401, { success: false, error: 'Unauthorized' });
  }
  const siteName  = (request.headers.get('X-Site-Name')  || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
  const photoDate = (request.headers.get('X-Photo-Date') || new Date().toISOString().split('T')[0]);
  const fileName  = (request.headers.get('X-File-Name')  || Date.now() + '.jpg').replace(/[^a-zA-Z0-9._-]/g, '_');
  const key = `photos/${siteName}/${photoDate}/${fileName}`;
  const body = await request.arrayBuffer();
  if (!body || body.byteLength === 0) return json(400, { success: false, error: 'Empty body' });
  if (body.byteLength > 5 * 1024 * 1024) return json(413, { success: false, error: 'File too large (max 5MB after compression)' });
  await env.BUCKET.put(key, body, { httpMetadata: { contentType: 'image/jpeg' } });
  return json(200, { success: true, key, size_kb: Math.round(body.byteLength / 1024) });
}

// ── Photo delete: POST /photo-delete ────────────────────────────
async function handlePhotoDelete(request, env) {
  if (!await checkAnyAuth(request, env)) {
    return json(401, { success: false, error: 'Unauthorized' });
  }
  let body;
  try { body = await request.json(); } catch(_) { return json(400, { success: false, error: 'Invalid JSON' }); }
  const key = (body && body.key) ? String(body.key) : '';
  if (!key || !key.startsWith('photos/')) return json(400, { success: false, error: 'Invalid key' });
  await env.BUCKET.delete(key);
  return json(200, { success: true });
}

// ── Photo get: GET /photos/<key> ────────────────────────────────
async function handlePhotoGet(request, env) {
  const url   = new URL(request.url);
  const key   = decodeURIComponent(url.pathname.replace(/^\/photos\//, ''));
  if (!key) return json(400, { success: false, error: 'Missing key' });
  const obj = await env.BUCKET.get(key);
  if (!obj) return json(404, { success: false, error: 'Not found' });
  return new Response(obj.body, {
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400', ...CORS_HEADERS }
  });
}
