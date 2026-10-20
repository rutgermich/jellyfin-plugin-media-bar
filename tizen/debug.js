// Diagnostic overlay for `node build.mjs --debug`. A TV has no console to look
// at, so this puts script errors, the media bar's log lines and a summary of
// its state on screen. Loaded before every other media bar script. ES5 only.
(function () {
    'use strict';

    var MAX_LINES = 14;
    var lines = [];
    var box;

    function text(value) {
        if (value instanceof Error) return value.name + ': ' + value.message;
        if (typeof value === 'object' && value !== null) {
            try { return JSON.stringify(value).slice(0, 160); } catch (error) { return String(value); }
        }
        return String(value);
    }

    function add(kind, args) {
        var message = Array.prototype.map.call(args, text).join(' ').slice(0, 220);
        lines.push(kind + ' ' + message);
        if (lines.length > MAX_LINES) lines.shift();
        render();
    }

    ['log', 'warn', 'error'].forEach(function (level) {
        var original = console[level];
        console[level] = function () {
            var first = arguments.length ? text(arguments[0]) : '';
            // every warning and error, but only the bar's own log lines
            if (level !== 'log' || /slideshow|media ?bar/i.test(first)) add(level.charAt(0).toUpperCase(), arguments);
            return original.apply(console, arguments);
        };
    });

    window.addEventListener('error', function (event) {
        var where = event.filename ? ' @' + String(event.filename).split('/').pop() + ':' + event.lineno + ':' + event.colno : '';
        if (event.target && event.target !== window && event.target.tagName) {
            add('X', ['failed to load <' + event.target.tagName.toLowerCase() + '> ' + (event.target.src || event.target.href || '')]);
        } else {
            add('X', [(event.message || 'error') + where]);
        }
    }, true);

    // What the remote's OK key and the bar's buttons do.
    function label(element) {
        if (!element || !element.tagName) return String(element);
        return element.tagName.toLowerCase() + (element.className ? '.' + String(element.className).trim().split(/\s+/).join('.') : '');
    }
    window.addEventListener('keydown', function (event) {
        if (/Arrow|Left|Right|Up|Down/.test(event.key || '')) return;
        add('K', ['keydown key=' + event.key + ' code=' + event.keyCode + ' on ' + label(document.activeElement)]);
    }, true);
    window.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.keyCode === 13) {
            add('K', ['after handlers: defaultPrevented=' + event.defaultPrevented]);
        }
    }, false);
    document.addEventListener('click', function (event) {
        var container = document.getElementById('slides-container');
        if (container && container.contains(event.target)) {
            add('C', ['click on ' + label(event.target) + ' (Emby.Page ' + (window.Emby && window.Emby.Page ? 'present' : 'missing') + ')']);
        }
    }, true);

    window.addEventListener('unhandledrejection', function (event) {
        add('X', ['unhandled rejection:', event.reason]);
    });

    // Every fetch the page makes, to see whether requests pile up.
    var inFlight = [];
    var finished = 0;
    var nativeFetch = window.fetch;
    window.fetch = function (url) {
        var entry = { url: String(url && url.url || url).replace(/^https?:\/\/[^/]+/, '').slice(0, 60), started: Date.now() };
        inFlight.push(entry);
        var done = function () {
            var index = inFlight.indexOf(entry);
            if (index !== -1) inFlight.splice(index, 1);
            finished += 1;
        };
        var promise = nativeFetch.apply(window, arguments);
        promise.then(done, done);
        return promise;
    };

    // A cheap and a heavy request with the bar's own headers, timed.
    var probes = [];
    function probe(label, path) {
        var bar = window.slideshowPure;
        var entry = { label: label, result: 'pending', started: Date.now() };
        probes.push(entry);
        var finish = function (result) { entry.result = result + ' in ' + (Date.now() - entry.started) + 'ms'; };
        nativeFetch(bar.STATE.jellyfinData.serverAddress + path, { headers: bar.ApiUtils.getAuthHeaders() }).then(function (response) {
            return response.text().then(function (body) { finish(response.status + ', ' + body.length + ' bytes'); });
        }).then(null, function (error) { finish('failed: ' + (error && error.message)); });
    }
    var probing = setInterval(function () {
        var bar = window.slideshowPure;
        if (!bar || !bar.STATE.jellyfinData || !bar.STATE.jellyfinData.accessToken) return;
        clearInterval(probing);
        probe('one item', '/Items?IncludeItemTypes=Movie&Recursive=true&Limit=1');
        probe('random 50', '/Items?IncludeItemTypes=Movie,Series&Recursive=true&SortBy=Random&Limit=50');
        probe('bar query', '/Items?IncludeItemTypes=Movie,Series&Recursive=true&hasOverview=true&imageTypes=Logo,Backdrop&SortBy=Random&isPlayed=False&Limit=50');
    }, 1000);

    function style(element, prop) {
        return element ? getComputedStyle(element)[prop] : '-';
    }

    function rect(element) {
        if (!element) return '-';
        var r = element.getBoundingClientRect();
        return Math.round(r.left) + ',' + Math.round(r.top) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height);
    }

    function describe(label, element) {
        if (!element) return label + ': missing';
        return label + ': ' + rect(element) + ' display=' + style(element, 'display') +
            ' opacity=' + style(element, 'opacity') + ' visibility=' + style(element, 'visibility');
    }

    // Every request the page makes (data, images, stylesheets), from the
    // browser's resource timing. The default buffer only holds 150 entries.
    if (performance.setResourceTimingBufferSize) performance.setResourceTimingBufferSize(2000);
    // jellyfin-web changes the address without a hashchange event, so watch
    // it, and log when each screen opens and when the sign-in screen's parts
    // arrive, counted from the moment that screen opened.
    var pageSince = 0;
    var lastRoute = location.hash.split('?')[0];
    function secondsOnPage(time) { return ((time - pageSince) / 1000).toFixed(1) + 's'; }
    setInterval(function () {
        var route = location.hash.split('?')[0];
        if (route === lastRoute) return;
        lastRoute = route;
        pageSince = performance.now();
        add('P', ['screen ' + route]);
    }, 200);
    var MILESTONES = /\/Users\/Public|\/Users\/[^/]+\/Images\/|\/System\/Info\/Public|\/QuickConnect\/Enabled|\/Users\/AuthenticateByName|\/Branding\/|fonts\.g/;
    if (window.PerformanceObserver) {
        try {
            new PerformanceObserver(function (list) {
                list.getEntries().forEach(function (entry) {
                    if (!MILESTONES.test(entry.name)) return;
                    add('R', [Math.round(entry.duration) + 'ms, ready at ' + secondsOnPage(entry.responseEnd) + ' ' + shortUrl(entry.name)]);
                });
            }).observe({ entryTypes: ['resource'] });
        } catch (error) { /* not supported */ }
    }

    function shortUrl(url) {
        return String(url).replace(/^https?:\/\/[^/]+/, '').replace(/[?&](api_key|ApiKey)=[^&]*/g, '').slice(0, 70);
    }

    function slowRequests() {
        var entries = performance.getEntriesByType ? performance.getEntriesByType('resource') : [];
        var recent = entries.filter(function (entry) { return entry.startTime >= pageSince; });
        var out = ['requests since this page opened: ' + recent.length +
            (recent.length ? ', last ended ' + ((Math.max.apply(null, recent.map(function (e) { return e.responseEnd; })) - pageSince) / 1000).toFixed(1) + 's after opening' : '')];
        recent.slice().sort(function (a, b) { return b.duration - a.duration; }).slice(0, 4).forEach(function (entry) {
            out.push('  ' + Math.round(entry.duration) + 'ms, started +' + ((entry.startTime - pageSince) / 1000).toFixed(1) + 's ' +
                entry.initiatorType + ' ' + shortUrl(entry.name));
        });
        return out;
    }

    // Frame rate over the last two seconds, and the slowest frame in it.
    var frames = [];
    function countFrame(time) {
        frames.push(time);
        while (frames.length && time - frames[0] > 2000) frames.shift();
        requestAnimationFrame(countFrame);
    }
    requestAnimationFrame(countFrame);
    function frameRate() {
        if (frames.length < 2) return 'frames: -';
        var slowest = 0;
        for (var i = 1; i < frames.length; i++) slowest = Math.max(slowest, frames[i] - frames[i - 1]);
        var fps = (frames.length - 1) * 1000 / (frames[frames.length - 1] - frames[0]);
        return 'frames: ' + Math.round(fps) + ' fps, slowest ' + Math.round(slowest) + 'ms (last 2 s), scrollY ' + Math.round(window.pageYOffset);
    }

    function state() {
        var out = [];
        var chrome = /Chrom(?:e|ium)\/([\d.]+)/.exec(navigator.userAgent);
        var tizen = /Tizen ([\d.]+)/.exec(navigator.userAgent);
        out.push('engine: Chromium ' + (chrome ? chrome[1] : '?') + ', Tizen ' + (tizen ? tizen[1] : '?') +
            ', viewport ' + window.innerWidth + 'x' + window.innerHeight +
            ', root font ' + style(document.documentElement, 'fontSize') +
            ', html.' + document.documentElement.className.replace(/\s+/g, '.'));
        out.push(frameRate());
        out.push('page: ' + location.hash.slice(0, 60) +
            ', tab=' + (document.querySelector('.emby-tab-button-active') ? document.querySelector('.emby-tab-button-active').getAttribute('data-index') : 'none') +
            ', rows=' + rect(document.querySelector('.homeSectionsContainer')));

        var api = window.ApiClient;
        var signedIn = '-';
        try { signedIn = api ? String(Boolean(api.isLoggedIn && api.isLoggedIn())) + ' server=' + (api.serverAddress ? api.serverAddress() : '?') : 'no ApiClient'; } catch (error) { signedIn = 'threw ' + error.message; }
        out.push('api: signedIn=' + signedIn);

        var bar = window.slideshowPure;
        if (!bar) {
            out.push('script: window.slideshowPure is missing (script did not finish loading)');
        } else {
            var s = bar.STATE.slideshow;
            out.push('script: initialized=' + s.hasInitialized + ' bootstrapping=' + s.isBootstrapping + ' loading=' + s.isLoading +
                ' items=' + s.totalItems + ' index=' + s.currentSlideIndex + ' layout=' + bar.CONFIG.layout);
        }

        var oldest = inFlight[0];
        out.push('fetches: ' + inFlight.length + ' open, ' + finished + ' done' +
            (oldest ? ', oldest open ' + Math.round((Date.now() - oldest.started) / 1000) + 's ' + oldest.url : ''));
        probes.forEach(function (entry) {
            out.push('probe ' + entry.label + ': ' + entry.result +
                (entry.result === 'pending' ? ' (' + Math.round((Date.now() - entry.started) / 1000) + 's so far)' : ''));
        });
        (window.mediaBarRequests || []).slice(-4).forEach(function (request) {
            var age = request.status === 'pending' ? Math.round((Date.now() - request.started) / 1000) + 's so far' : request.ms + 'ms';
            out.push('request: ' + request.status + ' (' + age + ') ' + request.url);
        });

        var container = document.getElementById('slides-container');
        out.push(describe('container', container) + (container ? ' class=' + container.className + ' slides=' + container.querySelectorAll('.slide').length : ''));
        if (container) {
            var slide = container.querySelector('.slide.active') || container.querySelector('.slide');
            out.push(describe('slide', slide) + (slide ? ' class=' + slide.className : ''));
            if (slide) {
                var backdrop = slide.querySelector('.backdrop');
                out.push(describe('backdrop', backdrop) + (backdrop ? ' class=' + backdrop.className + ' loaded=' + backdrop.complete + ' natural=' + backdrop.naturalWidth + 'x' + backdrop.naturalHeight : ''));
                out.push('mask: ' + String(style(slide.querySelector('.backdrop-container') || slide, 'webkitMaskImage')).slice(0, 90));
                out.push(describe('content', slide.querySelector('.slide-content')));
                out.push(describe('logo', slide.querySelector('.logo')) + ' | ' + describe('buttons', slide.querySelector('.button-container')));
            }
        }
        try { out = out.concat(slowRequests()); } catch (error) { out.push('requests: ' + error.message); }
        return out;
    }

    function render() {
        if (!document.body) return;
        if (!box) {
            box = document.createElement('pre');
            box.style.cssText = 'position:fixed;right:10px;bottom:10px;width:1250px;margin:0;padding:10px 12px;z-index:2147483647;' +
                'background:rgba(0,0,0,.86);color:#9f9;font:15px/1.3 monospace;white-space:pre-wrap;word-break:break-all;' +
                'pointer-events:none;border:1px solid #4a4;';
        }
        if (box.parentNode !== document.body) document.body.appendChild(box);
        var summary;
        try { summary = state(); } catch (error) { summary = ['state failed: ' + error.message]; }
        box.textContent = 'MEDIA BAR DEBUG\n' + summary.join('\n') + '\n--- log (newest last) ---\n' + (lines.join('\n') || '(nothing logged)');
    }

    setInterval(render, 2000);
})();
