/* ── Site language ─────────────────────────────────────────────────────────
   English is the source. Everything else is a lookup on the English string,
   so the pages stay readable and editable in English and a missing
   translation degrades to English instead of to a blank or a raw key.

   Why replacement rather than data-i18n keys on every element: the pages this
   runs on are hundreds of KB of hand-written HTML with text set from
   JavaScript in dozens of places (step labels, phone errors, plan lines, the
   success screen). Keying every one of them by hand would mean touching all of
   that code, and every future edit would have to remember to do it again.
   Reading the text that is actually on the page catches all of it, including
   the parts written after load.

   Two kinds of dictionary:
   - AIS_I18N[lang]: short strings, matched per text node (buttons, labels,
     messages the page writes).
   - AIS_I18N_HTML[lang]: whole paragraphs, matched on the element's HTML and
     replaced with translated HTML. For long documents (Privacy, Terms, the
     blog), where a sentence carries links and bold text and the word order
     around them changes from language to language.

   How a page uses it, from <head>:
     <script src="/i18n.js"></script>
     <script src="/i18n.js" data-i18n-extra="privacy"></script>  also loads i18n-privacy-xx.js
     <script src="/i18n.js" data-i18n-wait></script>  the page decides, see AIS_USE_LANG

   For a non-English visitor the page is hidden until the dictionary is in and
   applied, so nobody reads a line in English and watches it change under
   them. The hide is capped at 1.2s and released on any error, so a missing
   dictionary file costs a moment, never the page.
──────────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  /* Stamped by scripts/stamp-cache-version.py. Also rides on dictFile()'s
     own URLs, so a changed dictionary is fetched fresh the same way a
     changed i18n.js is: see WHY THIS EXISTS at the top of that script. */
  var BUILD_VERSION = 'eb038aa7e9';
  var SUPPORTED = ['en', 'es', 'fr', 'de'];
  var LABEL = { en: 'English', es: 'Español', fr: 'Français', de: 'Deutsch' };
  var STORE = 'ais_lang';
  var REVEAL_MS = 1200;

  var SCRIPT = document.currentScript;
  /* Relative to this file, so it works from / and from a subfolder alike. */
  var HERE = (SCRIPT && SCRIPT.src) || 'i18n.js';
  var EXTRAS = ((SCRIPT && SCRIPT.getAttribute('data-i18n-extra')) || '')
    .split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  /* The settings page knows the person. It shows their own language, which it
     only learns once their profile loads, so it tells us (AIS_USE_LANG) rather
     than us guessing from this device. */
  var WAIT = !!(SCRIPT && SCRIPT.hasAttribute('data-i18n-wait'));

  function remember(code) {
    try { localStorage.setItem(STORE, code); } catch (e) {}
  }

  /* English unless the person asked for something else: ?lang= on the link
     they came from, or what they picked on the switcher last time.
     Deliberately NOT the browser's language. The ads run in English, and a
     visitor who clicked an English ad should land on the English page even
     if their phone happens to be set to Spanish (Mariam, Sep 16). */
  function fromLink() {
    var q = '';
    try { q = (new URLSearchParams(location.search).get('lang') || '').toLowerCase().slice(0, 2); } catch (e) {}
    if (q && SUPPORTED.indexOf(q) > -1) { remember(q); return q; }
    return '';
  }
  function fromDevice() {
    try {
      var saved = localStorage.getItem(STORE);
      if (saved && SUPPORTED.indexOf(saved) > -1) return saved;
    } catch (e) {}
    return '';
  }

  var LINK_LANG = fromLink();
  var DEVICE_LANG = fromDevice();
  var LANG = LINK_LANG || (WAIT ? '' : DEVICE_LANG) || 'en';
  window.AIS_LANG = LANG;
  /* What this device last picked on the switcher. A page that waits for a
     profile needs it for the case where no profile is coming: an expired or
     codeless settings link still has somebody reading it. */
  window.AIS_DEVICE_LANG = DEVICE_LANG;

  function markDocument(code) {
    try {
      document.documentElement.lang = code;
      if (code !== 'en' && !/(^|\s)ais-i18n(\s|$)/.test(document.documentElement.className)) {
        document.documentElement.className += ' ais-i18n';
      }
    } catch (e) {}
  }
  markDocument(LANG);

  /* ── Strings built from numbers or names ─────────────────────────────────
     A dictionary can only hold whole strings, and these are assembled at
     runtime. Each one is matched on the English it produces. */
  var PATTERNS = [
    { re: /^Step (\d+) of (\d+)$/,
      es: function (m) { return 'Paso ' + m[1] + ' de ' + m[2]; },
      fr: function (m) { return 'Étape ' + m[1] + ' sur ' + m[2]; },
      de: function (m) { return 'Schritt ' + m[1] + ' von ' + m[2]; } },

    { re: /^(\d+) selected$/,
      es: function (m) { return m[1] + (m[1] === '1' ? ' seleccionado' : ' seleccionados'); },
      fr: function (m) { return m[1] + (m[1] === '1' ? ' sélectionné' : ' sélectionnés'); },
      de: function (m) { return m[1] + ' ausgewählt'; } },

    { re: /^That is too long for a \+(\d+) number\.$/,
      es: function (m) { return 'Eso es demasiado largo para un número +' + m[1] + '.'; },
      fr: function (m) { return "C'est trop long pour un numéro +" + m[1] + '.'; },
      de: function (m) { return 'Das ist zu lang für eine +' + m[1] + '-Nummer.'; } },

    { re: /^A \+(\d+) number is (.+) digits\. You entered (\d+)\.$/,
      es: function (m) { return 'Un número +' + m[1] + ' tiene ' + m[2].replace(' or ', ' o ') + ' dígitos. Has escrito ' + m[3] + '.'; },
      fr: function (m) { return 'Un numéro +' + m[1] + ' compte ' + m[2].replace(' or ', ' ou ') + ' chiffres. Vous en avez saisi ' + m[3] + '.'; },
      de: function (m) { return 'Eine +' + m[1] + '-Nummer hat ' + m[2].replace(' or ', ' oder ') + ' Ziffern. Du hast ' + m[3] + ' eingegeben.'; } },

    /* The helpline card on the crisis screen. The fellowship's name is looked
       up on its own so it reads the same here as in the program list. */
    { re: /^(.+) Helpline:$/,
      es: function (m) { return 'Línea de ayuda de ' + (dict[m[1]] || m[1]) + ':'; },
      fr: function (m) { return "Ligne d'écoute " + (dict[m[1]] || m[1]) + ' :'; },
      de: function (m) { return (dict[m[1]] || m[1]) + ' Hotline:'; } },

    /* The mission counter's aria-label, which carries a live number. */
    { re: /^([\d.,  ]+) days of recovery and counting$/,
      es: function (m) { return m[1] + ' días de recuperación y subiendo'; },
      fr: function (m) { return m[1] + ' jours de rétablissement, et ça continue'; },
      de: function (m) { return m[1] + ' Tage Genesung, und es werden mehr'; } },

    { re: /^(\S+) [—-] Find local (help & )?meetings$/,
      es: function (m) { return m[1] + ' — Encuentra reuniones cerca de ti'; },
      fr: function (m) { return m[1] + ' — Trouver des réunions près de chez vous'; },
      de: function (m) { return m[1] + ' — Meetings in deiner Nähe finden'; } }
  ].concat(window.AIS_I18N_PATTERNS || []);

  var dict = {};
  var htmlDict = {};
  var regions = null;

  function norm(s) {
    return s.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  }

  /* Dictionary files add to what is there rather than replacing it, because the
     main file and a page's extra one arrive in either order. */
  function refreshDicts() {
    dict = (window.AIS_I18N && window.AIS_I18N[LANG]) || {};
    htmlDict = (window.AIS_I18N_HTML && window.AIS_I18N_HTML[LANG]) || {};
    PATTERNS = PATTERNS.concat((window.AIS_I18N_PATTERNS || []).filter(function (p) {
      return PATTERNS.indexOf(p) < 0;
    }));
  }

  /* The 17 countries this site spells differently from the browser's own
     English name, keyed by what is on the page. Without these they would sit
     in a translated list still reading "Turkey" and "Virgin Islands (US)". */
  var REGION_ALIAS = {
    'Antigua and Barbuda': 'AG', 'Bosnia and Herzegovina': 'BA', 'Congo': 'CG',
    'Congo (DRC)': 'CD', "Côte d'Ivoire": 'CI', 'Macau': 'MO', 'Myanmar': 'MM',
    'Saint Kitts and Nevis': 'KN', 'Saint Lucia': 'LC',
    'Saint Vincent and the Grenadines': 'VC', 'São Tomé and Príncipe': 'ST',
    'Trinidad and Tobago': 'TT', 'Turkey': 'TR', 'Turks and Caicos Islands': 'TC',
    'Virgin Islands (British)': 'VG', 'Virgin Islands (US)': 'VI', 'UAE': 'AE'
  };

  /* Country names come from the browser rather than from the dictionary.
     There are 224 of them in the phone pickers, they are pure data, and
     Intl has them in every language we ship. */
  function regionMap() {
    if (regions) return regions;
    regions = {};
    try {
      if (typeof Intl === 'undefined' || !Intl.DisplayNames) return regions;
      var en = new Intl.DisplayNames(['en'], { type: 'region' });
      var loc = new Intl.DisplayNames([LANG], { type: 'region' });
      var A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      for (var i = 0; i < 26; i++) {
        for (var j = 0; j < 26; j++) {
          var code = A[i] + A[j];
          var source, target;
          try { source = en.of(code); target = loc.of(code); } catch (e) { continue; }
          if (!source || !target || source === code || source === target) continue;
          regions[source] = target;
        }
      }
      for (var name in REGION_ALIAS) {
        if (!Object.prototype.hasOwnProperty.call(REGION_ALIAS, name)) continue;
        var t;
        try { t = loc.of(REGION_ALIAS[name]); } catch (e) { continue; }
        if (t && t !== name && t !== REGION_ALIAS[name]) regions[name] = t;
      }
    } catch (e) {}
    return regions;
  }

  function translate(text) {
    var key = norm(text);
    if (!key || !/[A-Za-z]/.test(key)) return null;
    var hit = dict[key];
    if (typeof hit === 'string') return hit;
    for (var i = 0; i < PATTERNS.length; i++) {
      var m = key.match(PATTERNS[i].re);
      if (m && PATTERNS[i][LANG]) return PATTERNS[i][LANG](m);
    }
    var r = regionMap()[key];
    return r || null;
  }

  /* Public helper for the few strings a page has to build itself: the web
     chat's opening message, the prefilled WhatsApp hello, an alert. Those are
     looked up exactly, spacing and line breaks and all, because the spacing is
     part of the sentence. Anything else falls back to the same matching the
     page text gets. */
  window.AIS_T = function (text) {
    if (LANG === 'en') return text;
    if (typeof dict[text] === 'string') return dict[text];
    return translate(text) || text;
  };

  /* ── Applying it ─────────────────────────────────────────────────────── */
  var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, CODE: 1, PRE: 1, SVG: 1 };
  /* A textarea's text is its value, not copy, so it is left alone. Its
     placeholder is copy, so the element itself still gets visited. */
  var TEXT_SKIP = { TEXTAREA: 1 };
  var ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
  var BLOCKS = 'h1,h2,h3,h4,h5,p,li,td,th,dt,dd,figcaption,blockquote,summary';

  function skipped(node) {
    for (var el = node; el; el = el.parentNode) {
      if (el.nodeType !== 1) continue;
      var name = (el.nodeName || '').toUpperCase();
      if (SKIP[name]) return true;
      if (el.hasAttribute && (el.hasAttribute('data-no-i18n') || el.getAttribute('translate') === 'no')) return true;
    }
    return false;
  }

  function doText(node) {
    var raw = node.nodeValue;
    if (!raw || !/[A-Za-z]/.test(raw)) return;
    if (node.parentNode && TEXT_SKIP[(node.parentNode.nodeName || '').toUpperCase()]) return;
    var out = translate(raw);
    if (out === null) return;
    /* Keep the spacing around it: several of these text nodes sit next to a
       <strong> holding a phone number, and eating the space joins the two. */
    var lead = raw.match(/^\s*/)[0];
    var tail = raw.match(/\s*$/)[0];
    var next = lead + out + tail;
    if (next !== raw) node.nodeValue = next;
  }

  function doAttrs(el) {
    if (!el.getAttribute) return;
    for (var i = 0; i < ATTRS.length; i++) {
      var v = el.getAttribute(ATTRS[i]);
      if (!v) continue;
      var out = translate(v);
      if (out && out !== v) el.setAttribute(ATTRS[i], out);
    }
  }

  /* Whole paragraphs first, so a translated paragraph is never then picked
     apart by the per-string pass. The HTML is our own, from our own
     dictionary files, never anything a visitor typed. */
  function doBlocks(root) {
    if (!root.querySelectorAll) return;
    var any = false;
    for (var k in htmlDict) { if (Object.prototype.hasOwnProperty.call(htmlDict, k)) { any = true; break; } }
    if (!any) return;
    var list = [];
    if (root.matches && root.matches(BLOCKS)) list.push(root);
    var found = root.querySelectorAll(BLOCKS);
    for (var i = 0; i < found.length; i++) list.push(found[i]);
    for (var j = 0; j < list.length; j++) {
      var el = list[j];
      if (!el.isConnected || skipped(el)) continue;
      var out = htmlDict[norm(el.innerHTML)];
      if (typeof out === 'string') el.innerHTML = out;
    }
  }

  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { if (!skipped(root.parentNode)) doText(root); return; }
    if (root.nodeType !== 1) return;
    if (skipped(root)) return;
    doBlocks(root);
    doAttrs(root);
    /* FILTER_REJECT drops the whole branch, which is how <script>, the chat
       transcript and anything marked data-no-i18n stay untouched. */
    var tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: function (n) {
        if (n.nodeType === 1) {
          var name = (n.nodeName || '').toUpperCase();
          if (SKIP[name]) return NodeFilter.FILTER_REJECT;
          if (n.hasAttribute && (n.hasAttribute('data-no-i18n') || n.getAttribute('translate') === 'no')) return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var n;
    while ((n = tw.nextNode())) {
      if (n.nodeType === 1) doAttrs(n);
      else doText(n);
    }
  }

  /* Carry the choice across pages, so the next page opens in the language this
     one was being read in even before localStorage is consulted. */
  function stampLinks() {
    var links;
    try { links = document.querySelectorAll('a[href]'); } catch (e) { return; }
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      var href = a.getAttribute('href');
      if (!href || href.charAt(0) === '#' || /^(mailto:|tel:|javascript:)/i.test(href)) continue;
      var u;
      try { u = new URL(href, location.href); } catch (e) { continue; }
      if (u.origin !== location.origin) continue;
      if (u.searchParams.get('lang') === LANG) continue;
      u.searchParams.set('lang', LANG);
      a.setAttribute('href', u.pathname + u.search + u.hash);
    }
  }

  var observer = null;
  var started = false;

  function applyAll() {
    walk(document.body || document.documentElement);
    stampLinks();
    /* The tab name. Only the title: the meta description and the structured
       data stay English, because a crawler reads the HTML, not this. */
    var t = document.title && dict[norm(document.title)];
    if (t) document.title = t;
    if (observer) observer.takeRecords();
  }

  function observe() {
    if (!window.MutationObserver || observer) return;
    observer = new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var r = records[i];
        if (r.type === 'characterData') {
          if (!skipped(r.target.parentNode)) doText(r.target);
        } else if (r.type === 'attributes') {
          if (!skipped(r.target)) doAttrs(r.target);
        } else {
          for (var j = 0; j < r.addedNodes.length; j++) walk(r.addedNodes[j]);
        }
      }
      /* Our own edits come back as mutations. Drop them here or the callback
         re-enters on every replacement. */
      observer.takeRecords();
    });
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRS
    });
  }

  /* ── The switcher ────────────────────────────────────────────────────── */
  function mountSwitchers() {
    var spots = document.querySelectorAll('[data-lang-switcher]');
    if (!spots.length) return;
    injectCss();
    for (var i = 0; i < spots.length; i++) build(spots[i]);
  }

  function build(spot) {
    if (spot.getAttribute('data-lang-built')) return;
    spot.setAttribute('data-lang-built', '1');
    var theme = spot.getAttribute('data-lang-switcher') || 'light';
    spot.className = (spot.className ? spot.className + ' ' : '') + 'ais-lang ais-lang-' + theme;

    var globe = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    globe.setAttribute('viewBox', '0 0 24 24');
    globe.setAttribute('class', 'ais-lang-globe');
    globe.setAttribute('aria-hidden', 'true');
    globe.innerHTML = '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/>' +
      '<path d="M3 12h18M12 3c2.5 2.6 2.5 15.4 0 18M12 3c-2.5 2.6-2.5 15.4 0 18" fill="none" stroke="currentColor" stroke-width="1.8"/>';

    /* The name is drawn by us and the real <select> sits invisibly on top of
       it, full size. That is what lets the control show the whole language
       name where there is room and just the two letters in a phone's nav,
       without giving up the native picker, the keyboard or the screen
       reader. */
    var label = document.createElement('span');
    label.className = 'ais-lang-label';
    label.setAttribute('aria-hidden', 'true');
    label.textContent = LABEL[LANG];

    var code = document.createElement('span');
    code.className = 'ais-lang-code';
    code.setAttribute('aria-hidden', 'true');
    code.textContent = LANG.toUpperCase();

    var caret = document.createElement('span');
    caret.className = 'ais-lang-caret';
    caret.setAttribute('aria-hidden', 'true');

    var sel = document.createElement('select');
    sel.className = 'ais-lang-sel';
    sel.setAttribute('aria-label', window.AIS_T('Language'));
    for (var i = 0; i < SUPPORTED.length; i++) {
      var o = document.createElement('option');
      o.value = SUPPORTED[i];
      o.textContent = LABEL[SUPPORTED[i]];
      if (SUPPORTED[i] === LANG) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener('change', function () {
      var chosenCode = sel.value;
      if (SUPPORTED.indexOf(chosenCode) < 0) return;
      remember(chosenCode);
      var u;
      try { u = new URL(location.href); } catch (e) { location.reload(); return; }
      u.searchParams.set('lang', chosenCode);
      location.href = u.toString();
    });

    spot.appendChild(globe);
    spot.appendChild(label);
    spot.appendChild(code);
    spot.appendChild(caret);
    spot.appendChild(sel);
  }

  function injectCss() {
    if (document.getElementById('ais-lang-css')) return;
    var css =
      '.ais-lang{position:relative;display:inline-flex;align-items:center;gap:6px;' +
      'border:1px solid;border-radius:999px;padding:6px 10px;line-height:1;flex:0 0 auto;' +
      'font-size:13px;font-weight:600;white-space:nowrap}' +
      '.ais-lang-globe{width:15px;height:15px;flex:0 0 auto;opacity:.85}' +
      '.ais-lang-caret{width:0;height:0;border-left:4px solid transparent;' +
      'border-right:4px solid transparent;border-top:5px solid currentColor;opacity:.7}' +
      '.ais-lang-code{display:none}' +
      /* The real control, invisible and exactly on top of what we drew. */
      '.ais-lang-sel{position:absolute;inset:0;width:100%;height:100%;opacity:0;margin:0;' +
      'padding:0;border:0;font:inherit;cursor:pointer;appearance:none;-webkit-appearance:none}' +
      '.ais-lang:focus-within{outline:2px solid currentColor;outline-offset:2px}' +
      '.ais-lang-sel option{color:#212529;background:#fff}' +
      '.ais-lang-light{border-color:#CED4DA;color:#6C757D;background:#fff}' +
      '.ais-lang-dark{border-color:rgba(255,255,255,.35);color:rgba(255,255,255,.85);background:transparent}' +
      '#nav.scrolled .ais-lang-dark{border-color:rgba(0,0,0,.12);color:#475569;background:#fff}' +
      '.ais-top-row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:20px}' +
      '.ais-top-row .back-home{margin-bottom:0}' +
      /* In a phone's nav the name would push the sign-up button off the
         screen, so there it shows the two letters instead. */
      '@media (max-width:768px){' +
      '#nav .ais-lang{padding:5px 8px;gap:4px;font-size:11px}' +
      '#nav .ais-lang-label{display:none}' +
      '#nav .ais-lang-code{display:inline}' +
      '#nav .ais-lang-globe{width:13px;height:13px}' +
      '.nav-right{gap:10px}}' +
      /* Narrower than a modern phone, the pill and the sign-up button cannot
         both fit. The button wins and the footer one carries the language. */
      '@media (max-width:340px){#nav .ais-lang{display:none}}' +
      /* German compounds are longer than the columns they sit in, so long
         words are allowed to break rather than run past the edge. */
      '.ais-i18n body{overflow-wrap:break-word}';
    var s = document.createElement('style');
    s.id = 'ais-lang-css';
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }

  /* ── Loading dictionaries ────────────────────────────────────────────── */
  function dictFile(name, code) {
    return HERE.replace(/i18n\.js(\?.*)?$/, 'i18n-' + (name ? name + '-' : '') + code + '.js') + '?v=' + BUILD_VERSION;
  }

  function loadScript(src) {
    return new Promise(function (resolve) {
      var tag = document.createElement('script');
      tag.src = src;
      tag.onload = resolve;
      tag.onerror = resolve; // a missing file means English for those strings, never a stuck page
      (document.head || document.documentElement).appendChild(tag);
    });
  }

  var extraLoads = {};

  /* For a page that needs more strings later, such as the homepage opening the
     Privacy Policy in a box. Resolves once they are in and applied. */
  window.AIS_I18N_LOAD = function (name) {
    if (LANG === 'en' || !name) return Promise.resolve();
    if (!extraLoads[name]) {
      extraLoads[name] = loadScript(dictFile(name, LANG)).then(function () {
        refreshDicts();
        if (started) applyAll();
      });
    }
    return extraLoads[name];
  };

  /* ── Boot ────────────────────────────────────────────────────────────── */
  var revealed = true;
  function reveal() {
    if (revealed) return;
    revealed = true;
    var el = document.documentElement;
    el.className = (el.className || '').replace(/(^|\s)ais-i18n-pending(\s|$)/, ' ').trim();
  }

  function hide() {
    revealed = false;
    var el = document.documentElement;
    el.className = (el.className ? el.className + ' ' : '') + 'ais-i18n-pending';
    var s = document.createElement('style');
    s.id = 'ais-i18n-hide';
    s.textContent = '.ais-i18n-pending body{visibility:hidden}';
    (document.head || el).appendChild(s);
    setTimeout(reveal, REVEAL_MS);
  }

  function whenReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  var activated = false;
  function activate(code, hideFirst) {
    if (activated || code === 'en' || SUPPORTED.indexOf(code) < 0) return;
    activated = true;
    LANG = code;
    window.AIS_LANG = code;
    regions = null;
    markDocument(code);
    if (hideFirst) hide();
    var names = [''].concat(EXTRAS);
    Promise.all(names.map(function (n) {
      extraLoads[n] = loadScript(dictFile(n, code));
      return extraLoads[n];
    })).then(function () {
      refreshDicts();
      whenReady(function () {
        observe();
        started = true;
        applyAll();
        mountSwitchers();
        reveal();
      });
    });
  }

  /* The settings page calls this with the language their sponsor talks to
     them in, once their profile is back. A ?lang= on the link still wins: that
     is somebody who has just chosen. Translating in place is safe here because
     the page is still the English it loaded as. */
  window.AIS_USE_LANG = function (code) {
    if (!WAIT || LINK_LANG) return;
    activate(code, false);
  };

  if (LANG !== 'en') activate(LANG, true);
  else whenReady(mountSwitchers);
})();
