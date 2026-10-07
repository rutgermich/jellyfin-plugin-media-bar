// Browser APIs the media bar uses that Chromium 63/69 lacks. Bundled by
// build.mjs and loaded before slideshowpure.js.
import ResizeObserverPolyfill from 'resize-observer-polyfill';

if (typeof window.ResizeObserver === 'undefined') {
    window.ResizeObserver = ResizeObserverPolyfill;
}

function replaceChildren() {
    while (this.lastChild) {
        this.removeChild(this.lastChild);
    }
    this.append.apply(this, arguments);
}

[Element, Document, DocumentFragment].forEach(function (owner) {
    if (!owner.prototype.replaceChildren) {
        owner.prototype.replaceChildren = replaceChildren;
    }
});

// The bar's requests go through this instead of fetch (build.mjs rewrites the
// calls). A request that never settles would otherwise leave the bar loading
// forever; the bar already falls back when a request fails. The short history
// is what the debug overlay shows.
var REQUEST_TIMEOUT_MS = 45000;
var requests = window.mediaBarRequests = [];

function track(url, label) {
    var entry = { url: (label || '') + String(url).replace(/^https?:\/\/[^/]+/, '').slice(0, 70), status: 'pending', started: Date.now() };
    requests.push(entry);
    if (requests.length > 8) requests.shift();
    return entry;
}

function network(url, options, entry) {
    var settle = function (status) {
        if (entry.status === 'pending') {
            entry.status = status;
            entry.ms = Date.now() - entry.started;
        }
    };

    // Without `no-store` a retry of the same address waits behind the request
    // that is still hanging, because the browser cache serialises them.
    var settings = Object.assign({ cache: 'no-store' }, options);
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    if (controller) settings.signal = controller.signal;

    return new Promise(function (resolve, reject) {
        var timer = setTimeout(function () {
            settle('timeout');
            if (controller) controller.abort();
            reject(new Error('Request timed out: ' + entry.url));
        }, window.mediaBarRequestTimeoutMs || REQUEST_TIMEOUT_MS);

        window.fetch(url, settings).then(function (response) {
            clearTimeout(timer);
            settle(response.status);
            resolve(response);
        }, function (error) {
            clearTimeout(timer);
            settle('failed: ' + (error && error.message));
            reject(error);
        });
    });
}

// While the TV's home screen loads, the bar's requests take 15-20 seconds
// (the same ones take under two on a desktop). So the answers to the requests
// that decide which titles the bar shows are kept on the TV: the next start
// uses them at once and asks the server again once the home screen has
// settled, for the start after that.
var CACHE_PREFIX = 'mediaBarCache:';
var CACHE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
var REFRESH_DELAY_MS = 30000;
var servedFromCache = {};

function cacheKey(url, options) {
    if (options && options.method && String(options.method).toUpperCase() !== 'GET') return null;
    if (!/\/Items\?|\/web\/avatars\/list\.txt/.test(String(url))) return null;
    var user = '';
    try { user = window.ApiClient.getCurrentUserId() || ''; } catch (error) { /* not signed in yet */ }
    return CACHE_PREFIX + user + ':' + url;
}

function readCache(key) {
    try {
        var stored = JSON.parse(localStorage.getItem(key) || 'null');
        if (stored && Date.now() - stored.saved < CACHE_MAX_AGE_MS) return stored;
    } catch (error) { /* unreadable: treat as absent */ }
    return null;
}

function clearCache() {
    for (var i = localStorage.length - 1; i >= 0; i--) {
        var name = localStorage.key(i);
        if (name && name.indexOf(CACHE_PREFIX) === 0) localStorage.removeItem(name);
    }
}

function writeCache(key, response) {
    var isList = /list\.txt/.test(key);
    // an answer the bar can start from: titles, or "there is no list.txt"
    if (response.status !== 200 && !(isList && response.status === 404)) return;
    response.clone().text().then(function (body) {
        if (!isList && !/"Items"\s*:\s*\[\s*\{/.test(body)) return;
        var value = JSON.stringify({
            saved: Date.now(),
            status: response.status,
            type: response.headers.get('content-type') || '',
            body: response.status === 200 ? body : ''
        });
        try {
            localStorage.setItem(key, value);
        } catch (error) {
            // storage full: drop the bar's older answers and try once more
            try { clearCache(); localStorage.setItem(key, value); } catch (again) { /* go without */ }
        }
    }).then(null, function () { /* body unreadable: go without */ });
}

window.mediaBarFetch = function (url, options) {
    var key = cacheKey(url, options);
    // Only the first request of a start is answered from storage. Retries and
    // later visits to the home screen get fresh titles from the server.
    var stored = key && !servedFromCache[key] ? readCache(key) : null;

    if (stored) {
        servedFromCache[key] = true;
        var hit = track(url, 'stored ');
        hit.status = stored.status;
        hit.ms = 0;
        setTimeout(function () {
            network(url, options, track(url, 'refresh ')).then(function (response) {
                writeCache(key, response);
            }, function () { /* keep what is stored */ });
        }, window.mediaBarRefreshDelayMs || REFRESH_DELAY_MS);
        return Promise.resolve(new Response(stored.body, {
            status: stored.status,
            headers: { 'Content-Type': stored.type || 'application/json' }
        }));
    }

    return network(url, options, track(url)).then(function (response) {
        if (key) {
            servedFromCache[key] = true;
            writeCache(key, response);
        }
        return response;
    });
};
