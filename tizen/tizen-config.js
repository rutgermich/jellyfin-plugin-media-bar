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

    setInterval(function () {
        if (window.slideshowPure && window.slideshowPure.STATE) startWhenSignedIn(window.slideshowPure);
    }, 3000);

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
