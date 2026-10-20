// Loaded in the Tizen app. Adds a "switch user" button to the header, next to
// the user button, that signs out and goes straight to the sign-in page: the
// same as Sign out at the bottom of the user menu, one press instead of four.
// Kept in ES5: this file is shipped as written.
(function () {
    'use strict';

    var LABEL = /^nl/i.test(document.documentElement.lang || navigator.language || '') ? 'Wissel gebruiker' : 'Switch user';

    function signOut() {
        // jellyfin-web's own sign-out, which the user menu uses as well
        if (window.Dashboard && typeof window.Dashboard.logout === 'function') {
            window.Dashboard.logout();
            return;
        }
        var menuItem = document.querySelector('.btnLogout');
        if (menuItem) menuItem.click();
    }

    function createButton() {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'headerButton headerButtonRight paper-icon-button-light headerSwitchUserButton hide';
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
