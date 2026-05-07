// CARS24 Internal Ops — shared skeleton loader (boneyard-inspired)
// =================================================================
// Vanilla skeleton overlay with shimmer animation, auto-shown while async
// data is loading. Inspired by the boneyard-js framework but standalone —
// boneyard-js itself only ships React/Vue/Svelte/Angular adapters and
// requires a build step against real components, so it doesn't fit our
// static HTML + vanilla JS site (see PR discussion for context).
//
// Public API:
//   C24Skeleton.show({template, target, id})
//     template: 'default' | 'table' | 'chart' | 'cards' (default: 'default')
//     target:   element to overlay (default: document.body)
//     id:       optional name for refcount keying — same id can show()/hide()
//               multiple times and only fully hides on the last hide()
//   C24Skeleton.hide({id})
//   C24Skeleton.wrap(promise, opts) — show before, hide after; returns promise
//
// Delivery: c24-uploader.js auto-injects this script and instruments
// fetchText() to wrap every fetch in show/hide. Tools and pages that
// already call C24Uploader.fetchText() get skeletons with zero markup.

(function () {
  'use strict';

  if (window.C24Skeleton) return;

  var STYLE_ID   = 'c24-skel-style';
  var OVERLAY_ID = 'c24-skel-overlay';
  var refs = Object.create(null); // id -> active count

  function ensureStyles(){
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '#' + OVERLAY_ID + '{',
      '  position:fixed;inset:0;z-index:5000;',
      '  background:var(--bg,#1a1a1a);',
      '  padding:96px 40px 40px;overflow:hidden;',
      '  display:none;opacity:0;transition:opacity .18s ease-out;',
      '  font-family:Inter,-apple-system,BlinkMacSystemFont,sans-serif;',
      '}',
      '#' + OVERLAY_ID + '.c24-skel-show{display:block;opacity:1}',
      '#' + OVERLAY_ID + '.c24-skel-hide{opacity:0}',
      '#' + OVERLAY_ID + ' .c24-skel-inner{max-width:1200px;margin:0 auto}',
      '.c24-skel-bone{',
      '  position:relative;display:block;',
      '  background:rgba(255,255,255,.05);',
      '  border-radius:6px;overflow:hidden;',
      '  margin-bottom:12px;',
      '}',
      '.c24-skel-bone::after{',
      '  content:"";position:absolute;inset:0;transform:translateX(-100%);',
      '  background:linear-gradient(90deg,transparent 0%,rgba(255,255,255,.08) 50%,transparent 100%);',
      '  animation:c24-skel-shimmer 1.6s ease-in-out infinite;',
      '}',
      '@keyframes c24-skel-shimmer{',
      '  0%{transform:translateX(-100%)}',
      '  100%{transform:translateX(100%)}',
      '}',
      // Layout helpers — let templates compose with vanilla styles
      '.c24-skel-row{display:flex;gap:12px;margin-bottom:10px}',
      '.c24-skel-row .c24-skel-bone{flex:1;margin-bottom:0}',
      '.c24-skel-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px}',
      '.c24-skel-card{background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.06);border-radius:10px;padding:18px}',
      // Stagger: cascade shimmer delay across siblings for that "wave" feel
      '.c24-skel-stagger > *:nth-child(1) .c24-skel-bone::after,.c24-skel-stagger > .c24-skel-bone:nth-child(1)::after{animation-delay:0ms}',
      '.c24-skel-stagger > *:nth-child(2) .c24-skel-bone::after,.c24-skel-stagger > .c24-skel-bone:nth-child(2)::after{animation-delay:60ms}',
      '.c24-skel-stagger > *:nth-child(3) .c24-skel-bone::after,.c24-skel-stagger > .c24-skel-bone:nth-child(3)::after{animation-delay:120ms}',
      '.c24-skel-stagger > *:nth-child(4) .c24-skel-bone::after,.c24-skel-stagger > .c24-skel-bone:nth-child(4)::after{animation-delay:180ms}',
      '.c24-skel-stagger > *:nth-child(5) .c24-skel-bone::after,.c24-skel-stagger > .c24-skel-bone:nth-child(5)::after{animation-delay:240ms}',
      '.c24-skel-stagger > *:nth-child(6) .c24-skel-bone::after,.c24-skel-stagger > .c24-skel-bone:nth-child(6)::after{animation-delay:300ms}',
      '.c24-skel-stagger > *:nth-child(n+7) .c24-skel-bone::after,.c24-skel-stagger > .c24-skel-bone:nth-child(n+7)::after{animation-delay:360ms}',
      '@media (prefers-reduced-motion:reduce){',
      '  .c24-skel-bone::after{animation:none;background:rgba(255,255,255,.04)}',
      '}',
    ].join('\n');
    document.head.appendChild(s);
  }

  function bone(w, h){
    var d = document.createElement('div');
    d.className = 'c24-skel-bone';
    if (w) d.style.width = w;
    if (h) d.style.height = h;
    return d;
  }
  function row(){
    var r = document.createElement('div');
    r.className = 'c24-skel-row c24-skel-stagger';
    for (var i = 0; i < arguments.length; i++){
      var b = bone(null, arguments[i] || '14px');
      r.appendChild(b);
    }
    return r;
  }

  function buildDefault(){
    // Header strip + table-shaped rows. Works for projects-tracker and trendline alike.
    var wrap = document.createElement('div');
    wrap.className = 'c24-skel-inner';
    wrap.appendChild(bone('260px', '26px'));
    var sub = bone('420px', '14px');
    sub.style.marginBottom = '28px';
    wrap.appendChild(sub);
    // KPI strip
    var kpi = document.createElement('div');
    kpi.className = 'c24-skel-row c24-skel-stagger';
    for (var i = 0; i < 4; i++){
      var k = bone(null, '70px');
      kpi.appendChild(k);
    }
    kpi.style.marginBottom = '24px';
    wrap.appendChild(kpi);
    // Table head + rows
    wrap.appendChild(row('18px','18px','18px','18px','18px'));
    var body = document.createElement('div');
    body.className = 'c24-skel-stagger';
    for (var r = 0; r < 8; r++){
      body.appendChild(row('14px','14px','14px','14px','14px'));
    }
    wrap.appendChild(body);
    return wrap;
  }
  function buildTable(){
    var wrap = document.createElement('div');
    wrap.className = 'c24-skel-inner c24-skel-stagger';
    wrap.appendChild(row('18px','18px','18px','18px','18px'));
    for (var r = 0; r < 10; r++){
      wrap.appendChild(row('14px','14px','14px','14px','14px'));
    }
    return wrap;
  }
  function buildChart(){
    var wrap = document.createElement('div');
    wrap.className = 'c24-skel-inner';
    wrap.appendChild(bone('200px', '22px'));
    var sub = bone('320px', '14px'); sub.style.marginBottom = '24px';
    wrap.appendChild(sub);
    var chart = bone(null, '320px');
    chart.style.marginBottom = '24px';
    wrap.appendChild(chart);
    var legend = document.createElement('div');
    legend.className = 'c24-skel-row c24-skel-stagger';
    for (var i = 0; i < 4; i++) legend.appendChild(bone(null, '14px'));
    wrap.appendChild(legend);
    return wrap;
  }
  function buildCards(){
    var wrap = document.createElement('div');
    wrap.className = 'c24-skel-inner';
    wrap.appendChild(bone('220px', '24px'));
    var grid = document.createElement('div');
    grid.className = 'c24-skel-grid c24-skel-stagger';
    grid.style.marginTop = '20px';
    for (var i = 0; i < 6; i++){
      var card = document.createElement('div');
      card.className = 'c24-skel-card';
      var b1 = bone('60%', '16px');
      var b2 = bone('90%', '12px');
      var b3 = bone('40%', '12px');
      card.appendChild(b1); card.appendChild(b2); card.appendChild(b3);
      grid.appendChild(card);
    }
    wrap.appendChild(grid);
    return wrap;
  }

  var TEMPLATES = {
    'default': buildDefault,
    'table':   buildTable,
    'chart':   buildChart,
    'cards':   buildCards,
  };

  function ensureOverlay(template){
    ensureStyles();
    var o = document.getElementById(OVERLAY_ID);
    if (!o){
      o = document.createElement('div');
      o.id = OVERLAY_ID;
      (document.body || document.documentElement).appendChild(o);
    }
    var build = TEMPLATES[template] || TEMPLATES['default'];
    o.textContent = '';
    o.appendChild(build());
    return o;
  }

  function show(opts){
    opts = opts || {};
    var id = opts.id || 'default';
    refs[id] = (refs[id] || 0) + 1;
    if (refs[id] > 1) return; // already visible for this id
    var o = ensureOverlay(opts.template || 'default');
    o.classList.remove('c24-skel-hide');
    // force reflow so opacity transition kicks in
    void o.offsetWidth;
    o.classList.add('c24-skel-show');
  }

  function hide(opts){
    opts = opts || {};
    var id = opts.id || 'default';
    if (!refs[id]) return;
    refs[id]--;
    if (refs[id] > 0) return;
    var o = document.getElementById(OVERLAY_ID);
    if (!o) return;
    o.classList.add('c24-skel-hide');
    setTimeout(function(){
      // Only fully hide if no other id pushed it back up in the interim
      var anyActive = false;
      for (var k in refs) if (refs[k] > 0){ anyActive = true; break; }
      if (!anyActive){
        o.classList.remove('c24-skel-show');
        o.classList.remove('c24-skel-hide');
      }
    }, 200);
  }

  function wrap(promise, opts){
    show(opts);
    var done = function(){ hide(opts); };
    promise.then(done, done);
    return promise;
  }

  window.C24Skeleton = { show: show, hide: hide, wrap: wrap };
})();
