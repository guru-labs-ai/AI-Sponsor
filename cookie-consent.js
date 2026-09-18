/* Cookie consent gate for AI Sponsor's marketing pages.

   Until now GA4, the Meta pixel and Clarity all fired unconditionally on page
   load — no banner, nothing asked first. The new "Analytics and cookies"
   section in the privacy policy discloses them, but disclosure after the fact
   is not the same as consent before the fact, which is what UK/EEA visitors
   are owed. This is the missing half: nothing below loads until somebody has
   actually chosen, and declining costs nothing — the product itself runs
   entirely over WhatsApp and has never depended on any of these three.

   The choice lives in localStorage, not a cookie, so the choice itself never
   becomes one more thing this file would have to disclose.

   Deliberately does NOT touch Hyros or the OpenAI pixel. Hyros staying
   unconsented and undisclosed is a decided, separate call (Mariam, 18 Sep
   2026) — not an oversight here. The OpenAI pixel has no live id yet and
   loads nothing regardless. This only gates the three actually named in the
   privacy policy's cookies section. */
(function () {
  const KEY = 'ais_cookie_consent'; // 'accepted' | 'declined'
  const GA4_ID = 'G-S6Y7JPLC0G';
  const META_PIXEL_ID = '1018553221183175';
  const CLARITY_ID = 'ygsnblpdd3';

  function loadGA4() {
    const s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA4_ID;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    gtag('js', new Date());
    gtag('config', GA4_ID);
  }

  // AI Sponsor's own pixel. Its conversions have to stay separate from DRM's
  // or Meta optimises one product's ads on the other's signups.
  function loadMetaPixel() {
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
    n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
    document,'script','https://connect.facebook.net/en_US/fbevents.js');
    fbq('init', META_PIXEL_ID);
    fbq('track', 'PageView');
    const img = document.createElement('img');
    img.height = 1; img.width = 1; img.style.display = 'none';
    img.src = 'https://www.facebook.com/tr?id=' + META_PIXEL_ID + '&ev=PageView&noscript=1';
    document.body.appendChild(img);
  }

  function loadClarity() {
    (function(c,l,a,r,i,t,y){
        c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
        t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
        y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
    })(window, document, "clarity", "script", CLARITY_ID);
  }

  function loadAccepted(withClarity) {
    loadGA4();
    loadMetaPixel();
    // Same restriction as before consent existed at all: never on chat, never
    // on settings, because both authenticate or converse in ways a session
    // recording would capture. withClarity is false only from ai-sponsor-chat.html.
    if (withClarity) loadClarity();
  }

  function injectStyles() {
    if (document.getElementById('ais-cb-style')) return;
    const style = document.createElement('style');
    style.id = 'ais-cb-style';
    style.textContent =
      '#ais-cookie-banner{position:fixed;left:0;right:0;bottom:0;z-index:9999;' +
        'background:#0F2942;color:#EAF1FB;padding:14px 16px;' +
        'box-shadow:0 -2px 16px rgba(0,0,0,.25);' +
        'font-family:Inter,system-ui,-apple-system,sans-serif}' +
      '.ais-cb-body{max-width:920px;margin:0 auto;display:flex;gap:16px;' +
        'align-items:center;flex-wrap:wrap}' +
      '.ais-cb-body p{flex:1;min-width:220px;margin:0;font-size:13.5px;' +
        'line-height:1.55;color:#EAF1FB}' +
      '.ais-cb-body a{color:#7EC1FF;text-decoration:underline}' +
      '.ais-cb-actions{display:flex;gap:10px;flex-shrink:0}' +
      '.ais-cb-actions button{font-family:inherit;font-size:13.5px;font-weight:600;' +
        'padding:9px 16px;border-radius:8px;cursor:pointer;border:1px solid transparent}' +
      '.ais-cb-decline{background:transparent;border-color:rgba(255,255,255,.35)!important;' +
        'color:#EAF1FB}' +
      '.ais-cb-accept{background:#0080D4;color:#fff}' +
      '@media (max-width:520px){.ais-cb-body{flex-direction:column;align-items:stretch}' +
        '.ais-cb-actions{justify-content:stretch}.ais-cb-actions button{flex:1}}';
    document.head.appendChild(style);
  }

  function renderBanner(onAccept, onDecline) {
    injectStyles();
    const el = document.createElement('div');
    el.id = 'ais-cookie-banner';
    el.innerHTML =
      '<div class="ais-cb-body">' +
        '<p>We use cookies for site analytics and ad measurement. This never touches your ' +
        'WhatsApp conversation. <a href="/privacy#cookies">Read more</a></p>' +
        '<div class="ais-cb-actions">' +
          '<button type="button" class="ais-cb-decline">Decline</button>' +
          '<button type="button" class="ais-cb-accept">Accept</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el);
    el.querySelector('.ais-cb-accept').addEventListener('click', function () {
      el.remove();
      onAccept();
    });
    el.querySelector('.ais-cb-decline').addEventListener('click', function () {
      el.remove();
      onDecline();
    });
  }

  function init(opts) {
    opts = opts || {};
    const withClarity = opts.clarity !== false;

    // Every page calls this from a synchronous <head> script, before <body>
    // exists — GA4 only touches document.head so it was never affected, but
    // the Meta pixel's noscript <img> and the banner itself both append to
    // document.body, which is null at that point and threw instead of ever
    // showing anything. Defer the body-touching half until it's safe.
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', function () { init(opts); });
      return;
    }

    let choice = null;
    try { choice = localStorage.getItem(KEY); } catch (e) {}

    if (choice === 'accepted') { loadAccepted(withClarity); return; }
    if (choice === 'declined') { return; }

    renderBanner(
      function () {
        try { localStorage.setItem(KEY, 'accepted'); } catch (e) {}
        loadAccepted(withClarity);
      },
      function () {
        try { localStorage.setItem(KEY, 'declined'); } catch (e) {}
      }
    );
  }

  // Reopens the choice. Wired to a "Cookie preferences" footer link so
  // declining once is never a life sentence and accepting once can be undone.
  function reset(opts) {
    try { localStorage.removeItem(KEY); } catch (e) {}
    const existing = document.getElementById('ais-cookie-banner');
    if (existing) existing.remove();
    init(opts);
  }

  window.AISCookieConsent = { init: init, reset: reset };
})();
