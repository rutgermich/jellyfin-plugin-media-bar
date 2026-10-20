// Loaded in the Tizen app. Recent Jellyfin servers report every user as having
// a password (UserDto.HasPassword is always true), so the sign-in
// page asks for one even for users who have none. This tries an empty
// password first when a user is picked and signs in directly when the server
// accepts it; otherwise the page continues as usual and asks for the password.
// Kept in ES5: this file is shipped as written.
(function () {
    'use strict';

    // Users found to have a password are not tried with an empty one again:
    // each try counts as a failed sign-in, and enough of those lock an account.
    var NEEDS_PASSWORD = 'mediaBarNeedsPassword:';
    var passing = false;

    function storageKey(api, userId) {
        var server = '';
        try { server = api.serverId() || ''; } catch (error) { /* unknown server */ }
        return NEEDS_PASSWORD + server + ':' + userId;
    }

    function knownToNeedPassword(key) {
        try { return localStorage.getItem(key) === '1'; } catch (error) { return false; }
    }

    function rememberNeedsPassword(key) {
        try { localStorage.setItem(key, '1'); } catch (error) { /* go without */ }
    }

    function authorization(api) {
        return 'MediaBrowser Client="' + api.appName() + '", Device="' + api.deviceName() +
            '", DeviceId="' + api.deviceId() + '", Version="' + api.appVersion() + '"';
    }

    // Hand the click back to the page, which then shows the password form.
    function passOn(card) {
        passing = true;
        try { card.click(); } finally { passing = false; }
    }

    // Sign in through the page's own form, so everything after a sign-in
    // (remembering the server, opening the home screen) happens as usual.
    function signInWithoutPassword(page, name) {
        page.querySelector('#txtManualName').value = name;
        page.querySelector('#txtManualPassword').value = '';
        var form = page.querySelector('.manualLoginForm');
        var event = document.createEvent('Event');
        event.initEvent('submit', true, true);
        form.dispatchEvent(event);
    }

    function log(message) {
        console.log('Media Bar quick login: ' + message);
    }

    document.addEventListener('click', function (event) {
        if (passing) return;
        var card = event.target && event.target.closest ? event.target.closest('#divUsers .card') : null;
        var content = card ? card.querySelector('.cardContent') : null;
        var page = card ? card.closest('.page') || document : null;
        var api = window.ApiClient;
        if (!content) return;
        if (!api || !page.querySelector('.manualLoginForm')) {
            log('not on a sign-in page (ApiClient ' + (api ? 'present' : 'missing') + ')');
            return;
        }

        var userId = content.getAttribute('data-userid');
        var name = content.getAttribute('data-username');
        if (!userId || userId === 'manual' || !name) return;
        // a server that still says which users have no password is handled by the page
        if (content.getAttribute('data-haspw') === 'false') {
            log('server says ' + name + ' has no password');
            return;
        }

        var key = storageKey(api, userId);
        if (knownToNeedPassword(key)) {
            log(name + ' is known to need a password');
            return;
        }
        log('trying ' + name + ' without a password');

        event.preventDefault();
        event.stopPropagation();

        fetch(api.serverAddress() + '/Users/AuthenticateByName', {
            method: 'POST',
            cache: 'no-store',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': authorization(api),
                'X-Emby-Authorization': authorization(api)
            },
            body: JSON.stringify({ Username: name, Pw: '' })
        }).then(function (response) {
            log(name + ': server answered ' + response.status);
            if (response.ok) {
                signInWithoutPassword(page, name);
                return;
            }
            if (response.status === 401 || response.status === 403) rememberNeedsPassword(key);
            passOn(card);
        }, function (error) {
            log(name + ': request failed (' + (error && error.message) + ')');
            passOn(card);
        });
    }, true);
})();
