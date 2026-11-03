// Visitor tracking for Heart of Texas Organics.
// Loads Google Analytics 4 and Microsoft Clarity on public pages.
// Admin/customer-account pages (inventory, leads, subscription dashboard)
// do NOT include this file, so no private data is tracked or recorded.
(function () {
  var GA_ID = 'G-1H5T1N58LS';      // Google Analytics 4 Measurement ID
  var CLARITY_ID = 'z7vf9vy3hm';   // Microsoft Clarity Project ID

  // Skip tracking on local development so test visits don't count.
  var host = location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return;

  if (GA_ID && GA_ID.indexOf('XXXX') === -1) {
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', GA_ID);
  }

  if (CLARITY_ID && CLARITY_ID.indexOf('XXXX') === -1) {
    (function (c, l, a, r, i, t, y) {
      c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); };
      t = l.createElement(r); t.async = 1; t.src = 'https://www.clarity.ms/tag/' + i;
      y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y);
    })(window, document, 'clarity', 'script', CLARITY_ID);
  }
})();
