/**
 * The script injected into the bundled console *before any page JS runs*
 * (`injectedJavaScriptBeforeContentLoaded`). It turns a static Next export
 * sitting on `file://` into a working client of the RN bridge:
 *
 *  1. **fetch override** — same-origin calls to `/api/…`, `/healthz` and
 *     `/readyz` are serialized (headers, body, FormData → data URLs) and
 *     posted to `console-bridge.ts`, which answers with a reconstructed
 *     `Response` via `window.__f13bridge.respond`. Every other fetch falls
 *     through to the real `fetch` and fails harmlessly under `file://`
 *     (RSC prefetches: Next swallows those).
 *  2. **link interception (capture phase)** — Next `<Link>` clicks never reach
 *     React's router: we stop propagation and load the full bundled HTML for
 *     the target route directly, so client-side navigation (which would need
 *     a server) is replaced by document swaps the WebView can actually do —
 *     and its history/back stack keeps working.
 *  3. **history hooks** — a stray `pushState/replaceState` from router code is
 *     swallowed instead of corrupting the `file://` location.
 *  4. **asset-relative media** — `<img src="/photos/…">` and
 *     `<img src="/api/v1/media/…">` are rewritten: bundled photos point at
 *     their asset file, API media is fetched through the bridge and swapped
 *     for a blob URL (no cookies/CORS under `file://` otherwise).
 *
 * Plain string (no template literals) so it can be embedded safely in TS.
 */
export const CONSOLE_SHIM = `
(function () {
  if (window.__f13shim) return;
  window.__f13shim = true;

  // Breadcrumb → logcat (chromium CONSOLE tag): which bundled page booted.
  try { console.log('[F13] boot ' + window.location.href); } catch (e) {}

  var BASE = 'file:///android_asset/console';
  var seq = 0;
  var pending = {};
  var nativeFetch = window.fetch ? window.fetch.bind(window) : null;

  function post(msg) {
    try { window.ReactNativeWebView.postMessage(JSON.stringify(msg)); } catch (e) {}
  }

  function headerMap(h) {
    var out = {};
    try {
      if (!h) return out;
      if (typeof h.forEach === 'function') {
        h.forEach(function (v, k) { out[String(k).toLowerCase()] = String(v); });
      } else {
        Object.keys(h).forEach(function (k) { out[String(k).toLowerCase()] = String(h[k]); });
      }
    } catch (e) {}
    return out;
  }

  function fileToDataURL(file) {
    return new Promise(function (resolve) {
      try {
        var reader = new FileReader();
        reader.onload = function () { resolve(String(reader.result)); };
        reader.onerror = function () { resolve(''); };
        reader.readAsDataURL(file);
      } catch (e) { resolve(''); }
    });
  }

  function serializeBody(body) {
    if (body == null) return Promise.resolve({ body: null, form: null });
    if (typeof body === 'string') return Promise.resolve({ body: body, form: null });
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      var parts = [];
      var entries = [];
      try { body.forEach(function (v, k) { entries.push([k, v]); }); } catch (e) {}
      var chain = Promise.resolve();
      entries.forEach(function (entry) {
        var name = entry[0];
        var value = entry[1];
        chain = chain.then(function () {
          if (value && typeof value === 'object' && typeof value.arrayBuffer === 'function') {
            return fileToDataURL(value).then(function (dataUrl) {
              if (dataUrl) parts.push({ name: name, value: dataUrl });
            });
          }
          parts.push({ name: name, value: String(value) });
        });
      });
      return chain.then(function () { return { body: null, form: parts }; });
    }
    if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
      return Promise.resolve({ body: String(body), form: null });
    }
    if (typeof body === 'object') {
      try { return Promise.resolve({ body: JSON.stringify(body), form: null }); }
      catch (e) { return Promise.resolve({ body: null, form: null }); }
    }
    return Promise.resolve({ body: String(body), form: null });
  }

  function isBridgePath(pathname) {
    return pathname.indexOf('/api/') === 0 || pathname === '/healthz' || pathname === '/readyz';
  }

  window.fetch = function (input, init) {
    var url = '';
    try {
      url = typeof input === 'string' ? input : (input && input.url) || '';
      var abs = new URL(url, window.location.href);
      if (!isBridgePath(abs.pathname)) {
        return nativeFetch ? nativeFetch(input, init) : Promise.reject(new TypeError('fetch unavailable'));
      }
      var method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      var headers = headerMap((init && init.headers) || (input && input.headers));
      var rawBody = init && 'body' in init ? init.body : (input && input.body) || null;
      if (rawBody && typeof rawBody === 'object' && typeof rawBody.getReader === 'function') {
        rawBody = null; // streams never occur in this console
      }
      return serializeBody(rawBody).then(function (ser) {
        var id = ++seq;
        return new Promise(function (resolve, reject) {
          pending[id] = { resolve: resolve, reject: reject };
          post({
            t: 'api',
            id: id,
            method: method,
            url: abs.pathname + abs.search,
            headers: headers,
            body: ser.body,
            form: ser.form,
          });
        });
      });
    } catch (e) {
      return nativeFetch ? nativeFetch(input, init) : Promise.reject(e);
    }
  };

  window.__f13bridge = {
    respond: function (id, status, contentType, bodyText) {
      var p = pending[id];
      if (!p) return;
      delete pending[id];
      try {
        var headers = new Headers();
        if (contentType) headers.set('content-type', contentType);
        var code = status || 200;
        var body = code === 204 || code === 205 || code === 304 ? null : bodyText;
        p.resolve(new Response(body, { status: code, headers: headers }));
      } catch (e) {
        p.reject(new TypeError('bridge response failed'));
      }
    },
    fail: function (id, message) {
      var p = pending[id];
      if (!p) return;
      delete pending[id];
      p.reject(new TypeError(message || 'Network request failed'));
    },
  };

  var BASE_PATH = '/android_asset/console';

  function routeHref(href) {
    var abs = new URL(href, window.location.href);
    if (abs.protocol !== 'file:') return null;
    var path = abs.pathname;
    if (path.indexOf(BASE_PATH) === 0) path = path.slice(BASE_PATH.length);
    if (!path) path = '/';
    var file = /\\.html$/.test(path) ? path : (path === '/' ? '/index.html' : path + '.html');
    return BASE + file + abs.search + abs.hash;
  }

  document.addEventListener(
    'click',
    function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var el = e.target;
      while (el && el.tagName !== 'A') el = el.parentNode;
      if (!el || !el.getAttribute) return;
      var href = el.getAttribute('href');
      if (!href || href.charAt(0) === '#') return;
      try {
        var abs = new URL(href, window.location.href);
        if (abs.protocol !== 'file:') return; // external link: browser default
        var target = routeHref(href);
        if (!target || target === window.location.href) { e.preventDefault(); return; }
        e.preventDefault();
        e.stopPropagation();
        window.location.href = target;
      } catch (err) {}
    },
    true,
  );

  try {
    var wrap = function (fn, name) {
      history[name] = function (state, title, url) {
        if (url != null) {
          try {
            var target = routeHref(String(url));
            if (target && target !== window.location.href) { window.location.href = target; return; }
          } catch (e) {}
        }
        return fn.call(history, state, title, undefined);
      };
    };
    wrap(history.pushState.bind(history), 'pushState');
    wrap(history.replaceState.bind(history), 'replaceState');
  } catch (e) {}

  function rewriteMedia(root) {
    try {
      var imgs = (root || document).querySelectorAll('img');
      for (var i = 0; i < imgs.length; i++) {
        (function (img) {
          var src = img.getAttribute('src');
          if (!src || img.getAttribute('data-f13')) return;
          if (src.indexOf('/photos/') === 0) {
            // Bundled default photographs → their file in the APK assets.
            img.setAttribute('data-f13', '1');
            img.src = BASE + src;
          } else if (src.indexOf('/api/') === 0) {
            // Uploaded media is served PUBLIC by the API — point at it directly.
            var apiBase = window.__F13_API_BASE || '';
            if (!apiBase) return;
            img.setAttribute('data-f13', '1');
            img.src = apiBase + src;
          }
        })(imgs[i]);
      }
    } catch (e) {}
  }

  if (typeof MutationObserver !== 'undefined') {
    var start = function () {
      rewriteMedia(document);
      try {
        new MutationObserver(function (muts) {
          for (var i = 0; i < muts.length; i++) {
            var added = muts[i].addedNodes;
            for (var j = 0; j < added.length; j++) {
              if (added[j].nodeType === 1) rewriteMedia(added[j]);
            }
          }
        }).observe(document.documentElement, { childList: true, subtree: true });
      } catch (e) {}
    };
    if (document.documentElement) start();
    else document.addEventListener('DOMContentLoaded', start);
  }
})();
`;
