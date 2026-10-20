# Media Bar for Jellyfin on Samsung TVs (Tizen)

The [Media Bar plugin](../README.md) puts a slideshow of featured titles at the
top of the Jellyfin home screen. It works by adding a script to the web client
that the Jellyfin server hands out. The Samsung TV app ships its own copy of
the web client and never loads that page, so on a TV the bar does not appear,
whatever is installed on the server.

This folder builds a Jellyfin TV app with the bar inside it.

## Download

Ready-made packages are on the
[releases page](https://github.com/rutgermich/jellyfin-plugin-media-bar/releases),
under the releases whose name starts with **Tizen**:

| File | Use |
|---|---|
| `Jellyfin-12.z-OblongIcon-mediabar.wgt` | The app with the media bar. This is the one to install. |
| `Jellyfin-12.z-OblongIcon-mediabar-debug.wgt` | The same, with an overlay that shows script errors, request timings and the bar's state on screen. Only for finding out why something does not work. |

Both are a
[jellyfin-tizen-builds](https://github.com/jeppevinkel/jellyfin-tizen-builds)
package (`Jellyfin-12.z-OblongIcon.wgt`) with the bar added. Nothing else in
the app is changed.

## Install

The packages are signed the same way as the
[jellyfin-tizen-builds](https://github.com/jeppevinkel/jellyfin-tizen-builds)
packages, with the same public "Jellyfin" developer certificate (see
`signing/README.md`). A TV in developer mode installs them like any other
sideloaded jellyfin-tizen build, for example with Apps2Samsung (used for
testing) or with `sdb install`. The
[jellyfin-tizen](https://github.com/jellyfin/jellyfin-tizen) README describes
the developer-mode setup on the TV.

The package has the same app id and certificate as the jellyfin-tizen-builds
packages, so it replaces one of those without uninstalling, and the other way
round. A Jellyfin app installed some other way (a different certificate) has to
be removed on the TV first.

Tizen 7 and newer TVs (2023 models on) only install packages signed with a
Samsung certificate for that TV; tools such as Apps2Samsung take care of that.

## What to expect

- **Tested on one TV:** a Samsung with Tizen 5.5, against Jellyfin 12.2, with
  the bar's *marquee* layout. The build targets Tizen 5.0 (Chromium 63) and
  up; other models and layouts have not been tried on a real TV.
- **No server plugin needed.** If the Media Bar plugin is installed on the
  server, its settings (interval, number of titles and so on) are used;
  otherwise the defaults apply.
- **First start is slow.** While the TV's home screen loads, the request for
  the list of titles can take 15 to 20 seconds. The answer is kept on the TV,
  so from the second start the bar is there at once. It shows the selection
  fetched during the previous start and fetches a new one in the background.
- **Fewer effects than in a browser.** No trailers, no blur behind panels, no
  blur-in or slow zoom on the backdrop: the TV cannot draw these smoothly.
  Titles cross-fade.
- **Remote control:** left and right move between the buttons and on to the
  previous or next title, OK activates the focused button. When the bar moves
  on by itself, focus stays on the same button of the new title.
- **Users without a password sign in at once.** Recent Jellyfin servers no
  longer tell the app which users have a password, so it asks every user for
  one. The build first tries an empty password when you pick a user. For a user
  who does have a password this costs one failed sign-in the first time on that
  TV; after that the TV remembers it and goes straight to the password form.
- **Switch user in one press.** A button next to the user button at the top
  right signs out and goes straight to the sign-in page of the same server,
  without the server choice that Sign out in the user menu shows first.
- **Starts at the top.** When the home screen opens, the Home tab has focus
  and the bar is in view, instead of the first tile of the first row.
- **Follows the signed-in user.** After switching user the bar loads the new
  user's titles, from the libraries that user can see.
- **Server themes still apply.** Custom CSS set under Dashboard > Branding
  loads in the TV app as well. The build keeps the bar's position and buttons
  intact under a theme (tested with NeutralFin); colours from the theme, such
  as a red Play button, come through.

## Build it yourself

Needs Node.js (built and tested with version 22).

```
cd tizen
npm ci
node build.mjs Jellyfin-12.z-OblongIcon.wgt
```

This writes `Jellyfin-12.z-OblongIcon-mediabar.wgt` next to the input. Add
`--debug` for the build with the overlay, and a second path to choose the
output name.

Every push to the `tizen-build` branch that touches the bar or this folder runs
`.github/workflows/tizen.yml`, which tests, builds against the newest
jellyfin-tizen-builds release and publishes both packages as a new release.
The text of the release comes from `RELEASE_NOTES.md`.

## What the build changes

Samsung TVs run old Chromium versions (Tizen 5.0 → 63, Tizen 5.5 → 69), so the
bar's assets are lowered before they go into `www/mediabar/`:

- `slideshowpure.js` is transpiled with esbuild; `polyfills.src.js` adds
  `ResizeObserver` and `replaceChildren`.
- `slideshowpure.css` goes through `lower-css.mjs`. A TV app always renders at
  1920×1080 with a 27px root font, so `clamp()`/`min()`/`max()` are resolved to
  pixels at build time, flex `gap` becomes margins, `:focus-visible` becomes
  `:focus`, and Lightning CSS handles colour syntax and prefixes. Rules that
  need `:has()` are dropped (the build lists them).
- `tv-overrides.css` is appended to the stylesheet: the position of the stage
  and the text block, the buttons and their focus ring, and the lighter
  effects described above.
- `tizen-config.js` applies the plugin's server settings and the TV-specific
  ones (trailers, hover pause and motion effects off), starts the bar once
  someone is signed in, retries when no titles could be loaded and keeps the
  remote's focus on the title that is showing.
- `quick-login.js` signs in users without a password when they are picked on
  the sign-in page (see above), through the page's own sign-in form.
- `switch-user.js` adds the switch-user button to the header; it uses
  jellyfin-web's own sign-out.
- The bar's requests go through `mediaBarFetch` (in `polyfills.src.js`), which
  adds a 45 second timeout and keeps the answers that decide which titles are
  shown in `localStorage`. A start uses the stored answer at once and asks the
  server again 30 seconds later, for the next start.
- The package is signed again (`sign.mjs`), because the original signatures
  no longer match. `test/signature.mjs` checks that signing the untouched
  original gives exactly the signature files `tizen package` made.

## Test

`npm test` renders the bar in headless Chromium at TV resolution with the
original and the lowered assets, in all three layouts and with the settings
panel open, and fails when any element ends up somewhere else. It checks the
lowered CSS against Chromium 63 support data, and covers late sign-in,
requests that are never answered, a server theme, the slideshow moving on with
focus following, OK on the buttons, signing in without a password, the switch-user button,
a change of user, focus when the home screen opens and the stored titles.

It does not run Chromium 63 itself, so it cannot replace a test on a TV.

## Credits

The TV app is [jellyfin-tizen](https://github.com/jellyfin/jellyfin-tizen),
packaged by [jellyfin-tizen-builds](https://github.com/jeppevinkel/jellyfin-tizen-builds).
The Media Bar plugin is by
[IAmParadox27](https://github.com/IAmParadox27/jellyfin-plugin-media-bar),
with the slideshow script originally by [MakD](https://github.com/MakD/Jellyfin-Media-Bar). This fork adds the
TV build and a few fixes.
