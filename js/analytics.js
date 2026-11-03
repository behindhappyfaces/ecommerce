// Visitor tracking for Heart of Texas Organics.
// Loads Google Analytics 4 and Microsoft Clarity on public pages.
//
// Privacy rules:
// - Admin/customer pages (inventory, leads, subscription dashboard,
//   subscription success, paid recipe guide) do NOT include this file.
// - Only marketing parameters (utm_*, gclid, fbclid) are ever sent to Google.
//   Private codes in the URL (cart links ?rc=, checkout session_id, access
//   codes) are stripped before anything leaves the browser.
// - Clarity session replay is skipped entirely on any visit whose URL carries
//   a non-marketing parameter, since Clarity records the full address.
(function () {
  var GA_ID = 'G-1H5T1N58LS';      // Google Analytics 4 Measurement ID
  var CLARITY_ID = 'z7vf9vy3hm';   // Microsoft Clarity Project ID

  // Skip tracking on local development so test visits don't count.
  var host = location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return;

  function isMarketingParam(key) {
    return /^utm_/.test(key) || key === 'gclid' || key === 'fbclid';
  }

  // Rebuild a URL keeping only marketing parameters; drop the #hash too.
  function sanitize(url) {
    try {
      var u = new URL(url);
      var kept = new URLSearchParams();
      u.searchParams.forEach(function (v, k) { if (isMarketingParam(k)) kept.append(k, v); });
      var qs = kept.toString();
      return u.origin + u.pathname + (qs ? '?' + qs : '');
    } catch (e) {
      return '';
    }
  }

  var hasPrivateParam = false;
  new URLSearchParams(location.search).forEach(function (v, k) {
    if (!isMarketingParam(k)) hasPrivateParam = true;
  });

  if (GA_ID && GA_ID.indexOf('XXXX') === -1) {
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', GA_ID, {
      page_location: sanitize(location.href),
      page_referrer: document.referrer ? sanitize(document.referrer) : ''
    });
  }

  if (CLARITY_ID && CLARITY_ID.indexOf('XXXX') === -1 && !hasPrivateParam) {
    (function (c, l, a, r, i, t, y) {
      c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); };
      t = l.createElement(r); t.async = 1; t.src = 'https://www.clarity.ms/tag/' + i;
      y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y);
    })(window, document, 'clarity', 'script', CLARITY_ID);
  }
})();
