The Jellyfin app for Samsung TVs with the Media Bar built in. The TV app ships its own copy of the web client, so the server plugin alone never reaches it.

**Install `Jellyfin-12.z-OblongIcon-mediabar.wgt`.** The `-debug` file is the same build with an on-screen overlay for troubleshooting.

Both files are unsigned: install them like any sideloaded jellyfin-tizen build, with a tool that signs for your TV (Apps2Samsung was used for testing) or with Tizen Studio and your own certificate. The package replaces an installed Jellyfin TV app.

Good to know:

- Tested on one Samsung TV with Tizen 5.5, against Jellyfin 12.2, in the bar's marquee layout. Other models and layouts are untested on a real TV.
- The first start after installing can take 15 to 20 seconds before the bar appears. Later starts show it at once.
- No trailers and fewer visual effects than in a browser.
- The server plugin is not required; when it is installed, its settings are used.

Details, build instructions and what the build changes: [tizen/README.md](https://github.com/rutgermich/jellyfin-plugin-media-bar/blob/tizen-build/tizen/README.md)
