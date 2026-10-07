// Loaded in the Tizen app after slideshowpure.js. Applies the Media Bar plugin
// settings from the server (when the plugin is installed there) and the
// TV-specific overrides. Kept in ES5: this file is shipped as written.
(function () {
    'use strict';

    var NUMERIC_SETTINGS = {
        ShuffleInterval: 'shuffleInterval',
        RetryInterval: 'retryInterval',
        MinSwipeDistance: 'minSwipeDistance',
        LoadingCheckInterval: 'loadingCheckInterval',
        MaxPlotLength: 'maxPlotLength',
        MaxMovies: 'maxMovies',
        MaxTvShows: 'maxTvShows',
        MaxItems: 'maxItems',
        PreloadCount: 'preloadCount',
        FadeTransitionDuration: 'fadeTransitionDuration'
    };

    function applyTvOverrides(config) {
        // Trailer sizing relies on container query units, which the TV's
        // browser engine does not have.
        config.enableTrailers = false;
        // A TV has no mouse to move away again; a stray pointer event would
        // hold the slideshow on one title for good.
        config.pauseOnHover = false;
    }

    function applyServerConfig(config, serverConfig) {
        Object.keys(NUMERIC_SETTINGS).forEach(function (key) {
            if (serverConfig[key] >= 0) {
                config[NUMERIC_SETTINGS[key]] = serverConfig[key];
            }
        });
        if (typeof serverConfig.SyncPageBackdrop === 'boolean') {
            config.syncPageBackdrop = serverConfig.SyncPageBackdrop;
        }
        if (typeof serverConfig.SlideAnimationEnabled === 'boolean') {
            config.slideAnimationEnabled = serverConfig.SlideAnimationEnabled;
        }
    }

    // The bar gives up when nobody is signed in within its timeout, and after
    // that only looks again when the page address changes. On a TV, picking a
    // server and typing a password easily takes longer, so keep checking.
    function startWhenSignedIn(bar) {
        var state = bar.STATE.slideshow;
        var apiClient = window.ApiClient;
        if (state.hasInitialized || state.isBootstrapping || typeof bar.bootstrap !== 'function') return;
        try {
            if (apiClient && apiClient.isLoggedIn() && apiClient.accessToken() && apiClient.getCurrentUserId()) {
                bar.bootstrap();
            }
        } catch (error) {
            // ApiClient is not ready yet
        }
    }

    // When loading the titles fails (the TV's home screen loads at the same
    // time and requests can time out), the bar stays empty for good. Ask again
    // a few times, with a pause in between.
    var MAX_RELOADS = 5;
    var RELOAD_PAUSE_MS = 10000;
    var reloads = 0;
    var idleSince = 0;

    function reloadWhenEmpty(bar) {
        var state = bar.STATE.slideshow;
        var empty = state.hasInitialized && !state.isBootstrapping && !state.isLoading && !state.totalItems;
        if (!empty) {
            idleSince = 0;
            return;
        }
        if (!idleSince) idleSince = Date.now();
        if (reloads < MAX_RELOADS && Date.now() - idleSince >= RELOAD_PAUSE_MS) {
            reloads += 1;
            idleSince = 0;
            console.log('Media Bar: no titles loaded, trying again (' + reloads + '/' + MAX_RELOADS + ')');
            bar.initSlideshowData();
        }
    }

    // When the bar moves on by itself, the remote's focus is still on a button
    // of the slide that just left, and OK would act on that title. Move it to
    // the same button of the slide now showing.
    function followSlide(container) {
        var focused = document.activeElement;
        if (!focused || !container.contains(focused)) return;
        var from = focused.closest ? focused.closest('.slide') : null;
        var active = container.querySelector('.slide.active');
        if (!from || !active || from === active) return;
        var kind = ['play-button', 'detail-button', 'favorite-button'].filter(function (name) {
            return focused.classList.contains(name);
        })[0];
        var target = active.querySelector('.' + (kind || 'play-button'));
        if (target) target.focus();
    }

    var watching = setInterval(function () {
        var container = document.getElementById('slides-container');
        if (!container) return;
        clearInterval(watching);
        new MutationObserver(function () { followSlide(container); })
            .observe(container, { subtree: true, attributes: true, attributeFilter: ['class'] });
    }, 1000);

    setInterval(function () {
        var bar = window.slideshowPure;
        if (!bar || !bar.STATE) return;
        startWhenSignedIn(bar);
        reloadWhenEmpty(bar);
    }, 3000);

    // This file runs right after slideshowpure.js, before the bar has loaded
    // anything; apply the overrides now so they hold from the first slide.
    if (window.slideshowPure && window.slideshowPure.CONFIG) {
        applyTvOverrides(window.slideshowPure.CONFIG);
    }

    var waiting = setInterval(function () {
        if (!window.slideshowPure || !window.slideshowPure.CONFIG) return;

        var config = window.slideshowPure.CONFIG;
        applyTvOverrides(config);

        var apiClient = window.ApiClient;
        if (!apiClient || !apiClient.serverAddress || !apiClient.serverAddress()) return;
        clearInterval(waiting);

        apiClient.getJSON(apiClient.getUrl('MediaBar/WebConfig')).then(function (serverConfig) {
            applyServerConfig(config, serverConfig);
            applyTvOverrides(config);
        }, function () {
            console.log('Media Bar: no plugin settings on this server, using defaults.');
        });
    }, 100);
})();
