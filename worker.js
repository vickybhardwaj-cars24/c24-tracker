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
//
// Required env (Worker → Settings → Variables and Secrets):
//   AUTH_USERNAME  - plaintext username
//   AUTH_PASSWORD  - plaintext password
//   ALLOWED_TOOLS  - (optional) comma-separated allowlist
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

export default {
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
