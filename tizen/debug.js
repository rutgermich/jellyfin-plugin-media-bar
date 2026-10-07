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

    window.addEventListener('unhandledrejection', function (event) {
        add('X', ['unhandled rejection:', event.reason]);
    });

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

    function state() {
        var out = [];
        var chrome = /Chrom(?:e|ium)\/([\d.]+)/.exec(navigator.userAgent);
        var tizen = /Tizen ([\d.]+)/.exec(navigator.userAgent);
        out.push('engine: Chromium ' + (chrome ? chrome[1] : '?') + ', Tizen ' + (tizen ? tizen[1] : '?') +
            ', viewport ' + window.innerWidth + 'x' + window.innerHeight +
            ', root font ' + style(document.documentElement, 'fontSize') +
            ', html.' + document.documentElement.className.replace(/\s+/g, '.'));
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
        return out;
    }

    function render() {
        if (!document.body) return;
        if (!box) {
            box = document.createElement('pre');
            box.style.cssText = 'position:fixed;right:10px;bottom:10px;width:1180px;margin:0;padding:10px 12px;z-index:2147483647;' +
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
