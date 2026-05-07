// CARS24 Internal Ops — shared upload library
// =============================================
// Authenticated CSV upload with end-to-end gzip and a live progress UI.
//
// Wire protocol (matches the Cloudflare Worker `c24-tracker-auth`):
//   - Upload: POST <workerUrl>/upload, raw gzipped body, headers:
//       Authorization: Basic <btoa(user:pass)>
//       X-Tool-Path:   <toolPath>
//       Content-Type:  application/gzip
//   - Verify: POST <workerUrl>/verify, no body, same Authorization header.
//
// Future tools just need this script tag in <head>:
//   <script src="/shared/c24-uploader.js"></script>
// then:
//   C24Uploader.upload({csvText, workerUrl, toolPath, auth: {username, password}})
//     .then(...).catch(err => { /* err.status === 401 etc. */ });
//   C24Uploader.verify({workerUrl, auth}).then(...).catch(...);
//
// The library injects its own progress UI lazily on first upload — pages that
// never call upload() see no DOM/CSS additions.

(function () {
  'use strict';

  if (window.C24Uploader) return; // already loaded

  // Pull in the shared skeleton-loader. Tool HTMLs already load this file;
  // injecting the script tag here means they get boneyard-style skeletons
  // during fetchText() with zero markup or per-tool wiring.
  if (!window.C24Skeleton && !document.getElementById('c24-skel-script')){
    var skelScript = document.createElement('script');
    skelScript.id = 'c24-skel-script';
    skelScript.src = '/shared/skeleton.js';
    skelScript.async = false; // keep it ahead of any later inline code that calls C24Skeleton
    (document.head || document.documentElement).appendChild(skelScript);
  }

  var BAR_ID   = 'c24-uploader-bar';
  var FILL_ID  = 'c24-uploader-fill';
  var PCT_ID   = 'c24-uploader-pct';
  var SIZE_ID  = 'c24-uploader-size';
  var LBL_ID   = 'c24-uploader-label';
  var STYLE_ID = 'c24-uploader-style';

  function fmtBytes(n){
    if (!isFinite(n) || n < 0) return '';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n/1024).toFixed(1) + ' KB';
    if (n < 1073741824) return (n/1048576).toFixed(1) + ' MB';
    return (n/1073741824).toFixed(2) + ' GB';
  }

  function ensureUI(){
    if (document.getElementById(BAR_ID)) return;
    if (!document.getElementById(STYLE_ID)){
      var s = document.createElement('style');
      s.id = STYLE_ID;
      s.textContent = ''
        + '#' + BAR_ID + '{'
        + 'position:fixed;top:0;left:0;right:0;z-index:99999;'
        + 'background:rgba(15,20,25,.95);color:#fff;'
        + 'font-family:Inter,-apple-system,BlinkMacSystemFont,sans-serif;font-size:12px;'
        + 'padding:8px 14px;box-shadow:0 2px 8px rgba(0,0,0,.2);display:none;'
        + '}'
        + '#' + BAR_ID + '.show{display:block}'
        + '#' + BAR_ID + ' .c24-up-row{display:flex;align-items:center;gap:12px;max-width:1200px;margin:0 auto}'
        + '#' + BAR_ID + ' .c24-up-track{flex:1;height:6px;background:rgba(255,255,255,.15);border-radius:3px;overflow:hidden}'
        + '#' + FILL_ID + '{height:100%;width:0%;background:linear-gradient(90deg,#ffc107,#ff6b35);transition:width .15s ease-out}'
        + '#' + LBL_ID  + '{font-weight:500}'
        + '#' + SIZE_ID + '{color:rgba(255,255,255,.7);font-variant-numeric:tabular-nums;min-width:140px;text-align:right}'
        + '#' + PCT_ID  + '{font-weight:600;font-variant-numeric:tabular-nums;min-width:40px;text-align:right}'
        ;
      document.head.appendChild(s);
    }
    var bar = document.createElement('div');
    bar.id = BAR_ID;
    bar.innerHTML = ''
      + '<div class="c24-up-row">'
      +   '<span id="' + LBL_ID + '">↑ Uploading CSV…</span>'
      +   '<div class="c24-up-track"><div id="' + FILL_ID + '"></div></div>'
      +   '<span id="' + SIZE_ID + '"></span>'
      +   '<span id="' + PCT_ID + '">0%</span>'
      + '</div>';
    (document.body || document.documentElement).appendChild(bar);
  }

  function show(label){
    ensureUI();
    document.getElementById(BAR_ID).classList.add('show');
    document.getElementById(FILL_ID).style.width = '0%';
    document.getElementById(PCT_ID).textContent = '0%';
    document.getElementById(SIZE_ID).textContent = '';
    document.getElementById(LBL_ID).textContent = label || '↑ Uploading CSV…';
  }
  function setProgress(loaded, total){
    var fill = document.getElementById(FILL_ID);
    var pct  = document.getElementById(PCT_ID);
    var sz   = document.getElementById(SIZE_ID);
    if (total > 0){
      var p = Math.min(100, Math.round((loaded/total)*100));
      if (fill) fill.style.width = p + '%';
      if (pct)  pct.textContent  = p + '%';
      if (sz)   sz.textContent   = fmtBytes(loaded) + ' / ' + fmtBytes(total);
    } else {
      if (sz) sz.textContent = fmtBytes(loaded);
    }
  }
  function setLabel(text){
    var l = document.getElementById(LBL_ID);
    if (l) l.textContent = text;
  }
  function hide(){
    var bar = document.getElementById(BAR_ID);
    if (bar) bar.classList.remove('show');
  }

  function basicAuthHeader(auth){
    return 'Basic ' + btoa(auth.username + ':' + auth.password);
  }

  // gzip a UTF-8 string with the standard browser API. Throws on legacy browsers.
  function gzipUtf8(str){
    if (!('CompressionStream' in window)){
      throw new Error('Browser too old — please update Chrome/Edge/Safari/Firefox.');
    }
    var bytes = new TextEncoder().encode(str);
    var stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Response(stream).arrayBuffer();
  }

  // ── Main upload ─────────────────────────────────────────────────────────
  function upload(opts){
    return new Promise(function(resolve, reject){
      opts = opts || {};
      var csvText  = opts.csvText;
      var workerUrl = opts.workerUrl;
      var toolPath = opts.toolPath;
      var auth     = opts.auth;
      if (typeof csvText !== 'string' || !csvText.length) return reject(new Error('csvText is required'));
      if (!workerUrl) return reject(new Error('workerUrl is required'));
      if (!toolPath)  return reject(new Error('toolPath is required'));
      if (!auth || !auth.username || !auth.password) return reject(new Error('auth is required'));

      // Ensure trailing slash isn't doubled when we append /upload.
      var base = workerUrl.replace(/\/+$/, '');

      show('↑ Compressing ' + toolPath + '.csv…');

      gzipUtf8(csvText).then(function(buf){
        var origBytes = csvText.length; // approximate UTF-8 byte length for very large inputs is close to char length for ASCII
        var compBytes = buf.byteLength;

        var xhr = new XMLHttpRequest();
        xhr.open('POST', base + '/upload', true);
        xhr.setRequestHeader('Content-Type', 'application/gzip');
        xhr.setRequestHeader('Authorization', basicAuthHeader(auth));
        xhr.setRequestHeader('X-Tool-Path', toolPath);

        setLabel('↑ Uploading ' + toolPath + '.csv (gzip ' + fmtBytes(compBytes) + ')…');

        xhr.upload.onprogress = function(e){
          if (e.lengthComputable) setProgress(e.loaded, e.total);
        };
        xhr.upload.onload = function(){
          setProgress(compBytes, compBytes);
          setLabel('Saving to R2…');
        };
        xhr.onload = function(){
          hide();
          var parsed = null;
          try { parsed = JSON.parse(xhr.responseText); } catch (_e) {}
          if (xhr.status === 200 && parsed && parsed.success){
            resolve(Object.assign({ origBytes: origBytes, compBytes: compBytes }, parsed));
          } else {
            var err = new Error((parsed && parsed.error) || ('HTTP ' + xhr.status));
            err.status = xhr.status;
            err.body = parsed;
            reject(err);
          }
        };
        xhr.onerror = function(){ hide(); reject(new Error('Network error')); };
        xhr.onabort = function(){ hide(); reject(new Error('Upload aborted')); };

        xhr.send(buf);
      }).catch(function(err){
        hide();
        reject(err);
      });
    });
  }

  // ── Auth-verify (login modal) — Basic auth header, no body ─────────────
  function verify(opts){
    opts = opts || {};
    var workerUrl = opts.workerUrl;
    var auth      = opts.auth;
    if (!workerUrl) return Promise.reject(new Error('workerUrl is required'));
    if (!auth || !auth.username || !auth.password) return Promise.reject(new Error('auth is required'));
    var base = workerUrl.replace(/\/+$/, '');
    return fetch(base + '/verify', {
      method: 'POST',
      headers: { 'Authorization': basicAuthHeader(auth) },
    }).then(function(r){
      return r.json().then(function(j){ return {status: r.status, body: j}; }, function(){ return {status: r.status, body: null}; });
    }).then(function(res){
      if (res.status === 200 && res.body && res.body.success) return res.body;
      var err = new Error((res.body && res.body.error) || ('HTTP ' + res.status));
      err.status = res.status;
      err.body = res.body;
      throw err;
    });
  }

  // Decompress an ArrayBuffer of CSV bytes (gzip-sniffed) into a UTF-8 string.
  function bufToText(buf){
    var u8 = new Uint8Array(buf);
    if (u8.length < 2 || u8[0] !== 0x1f || u8[1] !== 0x8b){
      return Promise.resolve(new TextDecoder('utf-8').decode(u8));
    }
    if (!('DecompressionStream' in window)){
      return Promise.reject(new Error('Browser too old — please update Chrome/Edge/Safari/Firefox.'));
    }
    var stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
  }

  var CACHE_NAME = 'c24-csv-v1';

  // Fetch a CSV with HTTP-conditional caching + transparent gzip decompression.
  //
  // Flow:
  //   1. Look up a cached Response in the Cache API (keyed by URL).
  //   2. If found, send the request with `If-None-Match: <cached ETag>`. The
  //      Worker compares against R2's etag and returns 304 with no body when
  //      it still matches — wire transfer = 0 payload bytes.
  //   3. On 304: decode bytes from the cached Response and return.
  //   4. On 200: store a clone of the new Response in the cache, decode bytes
  //      and return.
  //   5. If Cache API isn't available (older browsers, file://, third-party
  //      cookie blocking), skip the cache and just fetch+decode.
  //
  // The Worker streams raw R2 bytes through with Content-Type: application/
  // octet-stream and no Content-Encoding header (see CLAUDE.md "Cloudflare
  // double-gzip"). We sniff gzip magic 1F 8B and decompress here.
  function fetchTextRaw(url, init){
    init = init || {};
    if (!('caches' in window) || location.protocol === 'file:'){
      return fetch(url, init).then(function(r){
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.arrayBuffer().then(bufToText);
      });
    }
    return caches.open(CACHE_NAME).then(function(cache){
      return cache.match(url).then(function(cached){
        var headers = new Headers((init && init.headers) || {});
        var cachedEtag = cached && cached.headers.get('ETag');
        if (cachedEtag) headers.set('If-None-Match', cachedEtag);
        var fetchInit = {};
        for (var k in init) if (Object.prototype.hasOwnProperty.call(init, k)) fetchInit[k] = init[k];
        fetchInit.headers = headers;
        return fetch(url, fetchInit).then(function(r){
          if (r.status === 304 && cached){
            return cached.arrayBuffer().then(bufToText);
          }
          if (!r.ok) throw new Error('HTTP ' + r.status);
          // Stash a clone — `cache.put` may reject (quota, opaque, etc.); ignore.
          try { cache.put(url, r.clone()).catch(function(){}); } catch (_) {}
          return r.arrayBuffer().then(bufToText);
        });
      });
    });
  }

  // Public fetchText: same contract as fetchTextRaw, plus a skeleton overlay.
  // Skeleton appears only if the fetch takes >100ms — cache hits / 304s never
  // flash one. Pass `{skeleton: false}` to opt out for a specific call, or
  // `{skeletonTemplate: 'table'|'chart'|'cards'}` to pick a layout.
  // We re-check `window.C24Skeleton` inside the timer/done callbacks so this
  // works even if /shared/skeleton.js (loaded async above) lands after the
  // call begins but before the 100ms show threshold fires.
  function fetchText(url, init){
    init = init || {};
    if (init.skeleton === false) return fetchTextRaw(url, init);
    var template = init.skeletonTemplate || 'default';
    var shown = false;
    var t = setTimeout(function(){
      var s = window.C24Skeleton;
      if (s){ shown = true; s.show({ id: 'c24-fetch', template: template }); }
    }, 100);
    var done = function(){
      clearTimeout(t);
      if (shown && window.C24Skeleton) window.C24Skeleton.hide({ id: 'c24-fetch' });
    };
    var p = fetchTextRaw(url, init);
    p.then(done, done);
    return p;
  }

  window.C24Uploader = { upload: upload, verify: verify, fetchText: fetchText };
})();
