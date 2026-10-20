// Loaded in the Tizen app. Adds a "switch user" button to the header, next to
// the user button, that signs out and goes straight to the sign-in page of the
// same server: Sign out at the bottom of the user menu, without the server
// choice that follows it.
// Kept in ES5: this file is shipped as written.
(function () {
    'use strict';

    var LABEL = /^nl/i.test(document.documentElement.lang || navigator.language || '') ? 'Wissel gebruiker' : 'Switch user';

    // After signing out, jellyfin-web sends an app that can hold several
    // servers to the server choice, and asks the app's shell first. For this
    // one sign-out, answer that by going to the sign-in page of the server
    // that was in use, which skips a menu with a single entry.
    function skipServerChoice(serverId) {
        var shell = window.NativeShell;
        var page = window.Emby && window.Emby.Page;
        if (!shell || !serverId || !page || typeof page.showLocalLogin !== 'function' || shell.selectServer) return;
        var restore = function () { delete shell.selectServer; };
        shell.selectServer = function () {
            restore();
            page.showLocalLogin(serverId);
        };
        setTimeout(restore, 15000);
    }

    function signOut() {
        // jellyfin-web's own sign-out, which the user menu uses as well
        if (window.Dashboard && typeof window.Dashboard.logout === 'function') {
            var serverId = null;
            try { serverId = window.ApiClient.serverId(); } catch (error) { /* no server */ }
            skipServerChoice(serverId);
            window.Dashboard.logout();
            return;
        }
        var menuItem = document.querySelector('.btnLogout');
        if (menuItem) menuItem.click();
    }

    function createButton() {
        var button = document.createElement('button');
        button.type = 'button';
        // what jellyfin-web's paper-icon-button-light gives its header buttons;
        // show-focus is what draws the focus on a TV
        button.className = 'headerButton headerButtonRight paper-icon-button-light headerSwitchUserButton hide' +
            (document.documentElement.classList.contains('layout-tv') ? ' show-focus' : '');
        button.title = LABEL;
        button.setAttribute('aria-label', LABEL);
        button.innerHTML = '<span class="material-icons switch_account" aria-hidden="true"></span>';
        button.addEventListener('click', function (event) {
            event.preventDefault();
            signOut();
        });
        return button;
    }

    // Shown exactly when the user button is: only with someone signed in.
    function follow(userButton, button) {
        button.classList.toggle('hide', userButton.classList.contains('hide'));
    }

    var waiting = setInterval(function () {
        var userButton = document.querySelector('.skinHeader .headerRight .headerUserButton');
        if (!userButton) return;
        clearInterval(waiting);

        var button = createButton();
        userButton.parentNode.insertBefore(button, userButton);
        follow(userButton, button);
        new MutationObserver(function () { follow(userButton, button); })
            .observe(userButton, { attributes: true, attributeFilter: ['class'] });
    }, 500);
})();
