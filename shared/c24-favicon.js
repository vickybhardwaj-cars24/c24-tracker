// CARS24 Internal Ops — shared favicon installer.
//
// Centralises the brand favicon URL so every tool stays in sync. New tools
// add this single tag in <head> instead of pasting the CDN URL each time:
//
//   <script src="/shared/c24-favicon.js"></script>
//
// The script runs synchronously during head parsing, removes any pre-existing
// `<link rel="icon">` tags so it stays the single source of truth, and
// injects the canonical brand icon. Rotating the favicon now means editing
// this file once.
(function () {
  if (window.__c24FaviconInstalled) return;
  window.__c24FaviconInstalled = true;

  var FAVICON_URL = 'https://static-cdn.cars24.com/prod/cms/2026/01/22/7637dd96-ffb0-4cde-837b-f1f0f9f8bc66favicon.ico';

  var existing = document.querySelectorAll('link[rel~="icon"], link[rel="shortcut icon"]');
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].parentNode) existing[i].parentNode.removeChild(existing[i]);
  }

  var link = document.createElement('link');
  link.rel = 'icon';
  link.type = 'image/x-icon';
  link.href = FAVICON_URL;
  (document.head || document.documentElement).appendChild(link);
})();
