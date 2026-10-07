# Media bar for jellyfin-tizen

The Media Bar plugin injects its script into the web client that the Jellyfin
server hands out. The Samsung TV app ships its own copy of the web client and
never loads that page, so the bar has to be built into the app package.

`build.mjs` takes a jellyfin-tizen `.wgt` (for example from
[jellyfin-tizen-builds](https://github.com/jeppevinkel/jellyfin-tizen-builds/releases))
and adds the bar to it:

```
npm ci
node build.mjs Jellyfin-12.z-OblongIcon.wgt
```

Add `--debug` for a build that shows script errors and the bar's state in an
overlay on the TV, which has no console to look at.

The result, `Jellyfin-12.z-OblongIcon-mediabar.wgt`, is **unsigned**. Sign it
with your own Samsung certificate when installing, as with any sideloaded build.

## What the build changes

Samsung TVs run old Chromium versions (Tizen 5.0 → 63, Tizen 5.5 → 69), so the
bar's assets are lowered before they go into `www/mediabar/`:

- `slideshowpure.js` is transpiled with esbuild; `polyfills.src.js` adds
  `ResizeObserver` and `replaceChildren`.
- `slideshowpure.css` goes through `lower-css.mjs`. A TV app always renders at
  1920×1080 with a 27px root font, so `clamp()`/`min()`/`max()` are resolved to
  pixels at build time, flex `gap` becomes margins, `:focus-visible` becomes
  `:focus`, and Lightning CSS handles colour syntax and prefixes.
- `tizen-config.js` applies the plugin's server settings and turns trailers off.
- `tv-overrides.css` is appended to the stylesheet. Server themes (custom CSS)
  load in the TV app as well; these rules keep the stage, the text block and
  the buttons in place under one.
- The bar's requests go through `mediaBarFetch` (in `polyfills.src.js`), which
  adds a timeout and keeps the answers that decide which titles are shown in
  `localStorage`. On a TV those requests take 15-20 seconds while the home
  screen loads, so a start uses the stored answer at once and asks the server
  again 30 seconds later, for the next start. The first start after installing
  still has to wait.

Known limits: rules that need `:has()` are dropped (the build lists them),
panels have no background blur, and trailers are disabled.

## Test

`npm test` renders the bar in headless Chromium at TV resolution with the
original and the lowered assets, in all three layouts and with the settings
panel open, and fails when any element ends up somewhere else. It also checks
the lowered CSS against Chromium 63 support data, and covers late sign-in,
requests that are never answered, a server theme and the stored titles.

It does not run Chromium 63 itself, so it cannot replace a test on a TV.
