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

window.mediaBarFetch = function (url, options) {
    var entry = { url: String(url).replace(/^https?:\/\/[^/]+/, '').slice(0, 70), status: 'pending', started: Date.now() };
    requests.push(entry);
    if (requests.length > 8) requests.shift();

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
};
