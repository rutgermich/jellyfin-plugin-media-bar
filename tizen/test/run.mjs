// Renders the media bar twice in headless Chromium at the TV's resolution,
// once with the original assets and once with the lowered ones, against a
// mock Jellyfin server, and compares where every element ends up.
//
// It cannot prove the lowered build works on Chromium 63; it proves that the
// rewrites (static math, gap -> margins, dropped selectors) did not move
// anything on an engine that supports both versions.

import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import doiuse from 'doiuse';
import { chromium } from 'playwright';
import postcss from 'postcss';
import { buildAssets } from '../build.mjs';
import { TV } from '../lower-css.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const TOLERANCE_PX = 1;
const KNOWN_DIFFERENCES = [
    // `.ss-set-value` keeps its own `margin-left: auto` instead of the row gap,
    // which moves the number in a slider row by 2px.
    { key: /span\.ss-set-value\[\d+\]$/, props: ['x'] },
    // Wrapping rows carry the gap between their lines as a margin under every
    // item, so their own box is one gap taller. A negative margin keeps
    // everything after them in place, and they have no background or border.
    { key: /div\.(spec-line|misc-info|genre)\[\d+\]$/, props: ['height'] }
];

const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAUAAAAC0CAYAAADl5PURAAAAOklEQVR42u3BAQEAAACCIP+vbkhAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH8GkrQAAfrUu6IAAAAASUVORK5CYII=', 'base64');

const ITEMS = [1, 2, 3, 4].map(n => ({
    Id: `item${n}`,
    Name: `Test Movie ${n}`,
    Type: n % 2 ? 'Movie' : 'Series',
    Overview: 'A long synopsis that should wrap over several lines so the plot container is exercised. '.repeat(4),
    Taglines: [`Tagline number ${n}`],
    Genres: ['Action', 'Adventure', 'Science Fiction'],
    CommunityRating: 7.4,
    CriticRating: 88,
    OfficialRating: 'PG-13',
    ProductionYear: 2020 + n,
    PremiereDate: `${2020 + n}-05-01T00:00:00Z`,
    RunTimeTicks: 72000000000,
    ChildCount: 3,
    ImageTags: { Logo: 'logo', Primary: 'primary' },
    BackdropImageTags: ['backdrop'],
    UserData: { IsFavorite: false, Played: false }
}));

function page({ css, scripts, themeCss = '' }) {
    return `<!doctype html>
<html class="layout-tv" style="font-size:${TV.rootFontSize}px"><head><meta charset="utf-8">
<style>body{margin:0;background:#101010;color:#fff;font-family:sans-serif}.hide{display:none!important}
.verticalSection{height:15rem;border-top:1px solid #333}</style>
<style>${css}</style>
<script>
window.ApiClient = {
    isLoggedIn: function () { return !window.signedOut; },
    accessToken: function () { return window.testToken || 'token'; },
    getCurrentUserId: function () { return window.testUserId || 'user1'; },
    serverAddress: function () { return location.origin; },
    serverId: function () { return 'server1'; },
    appName: function () { return 'Test'; },
    appVersion: function () { return '1'; },
    deviceName: function () { return 'Test'; },
    deviceId: function () { return 'device1'; },
    getUrl: function (name) { return location.origin + '/' + name; },
    getJSON: function () { return Promise.reject(new Error('no plugin')); }
};
var seed = 7;
Math.random = function () { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
</script>
${scripts.map(src => `<script defer src="${src}"></script>`).join('\n')}
</head><body>
<div class="skinHeader" style="position:fixed;top:0;left:0;right:0;height:4rem"><button class="emby-tab-button emby-tab-button-active" data-index="0">Home</button></div>
<div class="mainAnimatedPages skinBody"><div class="page hide"></div></div>
<div class="skinBody"><div id="indexPage" class="page homePage" style="padding-top:4rem">
<div class="tabContent pageTabContent is-active" data-index="0"><div class="sections homeSectionsContainer">
${'<div class="verticalSection"></div>'.repeat(5)}
</div></div></div></div>
<style>${themeCss}</style>
</body></html>`;
}

let flakySeen = false;

function startServer(variants) {
    const server = http.createServer((request, response) => {
        const url = new URL(request.url, 'http://localhost');
        const send = (type, body, status = 200) => {
            response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
            response.end(body);
        };

        for (const [name, variant] of Object.entries(variants)) {
            if (url.pathname === `/${name}/`) return send('text/html', page(variant.page));
            for (const [file, body] of Object.entries(variant.files)) {
                if (url.pathname === `/${name}/${file}`) return send('text/javascript', body);
            }
        }
        if (/\/Images\//.test(url.pathname)) return send('image/png', PIXEL);
        if (/\/web\/avatars\/list\.txt$/.test(url.pathname)) {
            if (url.searchParams.get('userId') === 'hang') return undefined; // never answers
            return send('text/plain', '', 404);
        }
        if (/\/Views$/.test(url.pathname)) return send('application/json', JSON.stringify({ Items: [] }));
        if (/^\/Items\/?$/.test(url.pathname)) {
            // the first request of a "flaky" client is never answered
            if (/Token="dead"/.test(request.headers.authorization || '')) return undefined; // never answers
            if (/Token="flaky"/.test(request.headers.authorization || '') && !flakySeen) {
                flakySeen = true;
                return undefined;
            }
            return send('application/json', JSON.stringify({ Items: ITEMS }));
        }
        return send('application/json', '{}', 404);
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// Position of every element of the bar, keyed by its place in the tree.
function snapshot() {
    const key = element => {
        const parts = [];
        for (let node = element; node && node !== document.body && node.id !== 'slides-container'; node = node.parentElement) {
            const index = Array.prototype.indexOf.call(node.parentElement.children, node);
            parts.unshift(`${node.tagName.toLowerCase()}.${String(node.className.baseVal ?? node.className).split(' ')[0]}[${index}]`);
        }
        return parts.join(' > ') || '#slides-container';
    };
    const container = document.getElementById('slides-container');
    const rows = document.querySelector('.homeSectionsContainer');
    const result = { '(home rows)': rows.getBoundingClientRect().toJSON() };
    const inBar = '.slide.active, .slide.active *, .dots-container, .dots-container *, .arrow';
    const elements = [container, ...container.querySelectorAll(inBar), ...document.querySelectorAll('.ss-settings, .ss-settings *')];
    for (const element of new Set(elements)) {
        if (element.closest('svg') && element.tagName.toLowerCase() !== 'svg') continue;
        // mid-animation (slow zoom, slide timer), so their size depends on timing
        if (element.classList.contains('backdrop') || element.classList.contains('spec-progress')) continue;
        const style = getComputedStyle(element);
        result[key(element)] = Object.assign(element.getBoundingClientRect().toJSON(), {
            fontSize: parseFloat(style.fontSize),
            hidden: style.display === 'none' ? 1 : 0
        });
    }
    return result;
}

async function capture(browser, url, errors) {
    const context = await browser.newContext({ viewport: { width: TV.width, height: TV.height } });
    const tab = await context.newPage();
    tab.on('pageerror', error => errors.push(`${url}: ${error.message}`));
    tab.on('console', message => {
        if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) {
            errors.push(`${url}: ${message.text()}`);
        }
    });
    await tab.goto(`${url}#/home.html`);
    await tab.waitForSelector('#slides-container .slide.active .button-container', { timeout: 20000 });
    await tab.waitForTimeout(2500);
    // open the settings panel so its layout is compared too
    await tab.click('.ss-settings-toggle');
    await tab.waitForSelector('.ss-settings.is-open');
    await tab.waitForTimeout(700);
    const result = await tab.evaluate(snapshot);
    const screenshot = await tab.screenshot();
    await context.close();
    return { result, screenshot };
}

// Features the support data flags for Chromium 63 that the build may keep.
const ACCEPTED_CSS_FEATURES = {
    'css-overflow': 'false positive: only `overflow: hidden/auto` is used',
    'css-masks': 'works with the -webkit- prefix that Lightning CSS adds',
    'css-appearance': 'works with the -webkit- prefix that Lightning CSS adds',
    'css-backdrop-filter': 'cosmetic: panels lose their blur',
    'css-container-query-units': 'trailer sizing only; tizen-config.js turns trailers off',
    'prefers-reduced-motion': 'the media query is simply ignored',
    'extended-system-fonts': 'falls back to the next font in the stack'
};

async function unsupportedCssFeatures(css) {
    const found = new Map();
    const plugin = doiuse({
        browsers: ['chrome 63'],
        onFeatureUsage: usage => found.set(usage.feature, (found.get(usage.feature) || 0) + 1)
    });
    await postcss([plugin]).process(css, { from: undefined });
    return found;
}

const assets = await buildAssets();
const unexpected = [...await unsupportedCssFeatures(assets.css)]
    .filter(([feature]) => !(feature in ACCEPTED_CSS_FEATURES));
console.log(`css: ${unexpected.length} features Chromium 63 lacks`);
for (const [feature, count] of unexpected) console.log(`  ${feature} (${count}x)`);

const original = {
    script: fs.readFileSync(path.join(repoRoot, 'slideshowpure.js'), 'utf8'),
    css: fs.readFileSync(path.join(repoRoot, 'slideshowpure.css'), 'utf8')
};

// What a server theme does to the bar, after the rules in a real one
// (NeutralFin): the stage is stretched under the header, the round buttons get
// the system button colour and lose their margins, the page gets more padding.
const THEME_CSS = `
:root { --appBarHeight: 5rem; }
#slides-container { margin-top: calc(var(--appBarHeight) * -1); height: calc(100% + var(--appBarHeight)); top: calc(-.5 * var(--appBarHeight)); }
.detailButton.detail-button, .detailButton.detail-button:not(.btnPlay), .favorite-button { margin: 0 !important; background: buttonface !important; color: inherit !important; }
.detailButton { padding: .5em !important; }
.detailButton:not(.btnPlay) { margin: .5em !important; border-radius: 50%; padding: .6em !important; }
.btnPlay.detailButton { height: 3em; min-width: 10em; margin-right: .5em !important; }
.skinHeader { height: 5rem !important; }
#indexPage { padding-top: 6rem !important; }
` + (process.env.THEME_CSS ? fs.readFileSync(process.env.THEME_CSS, 'utf8') : '');

const server = await startServer({
    original: {
        page: { css: original.css, scripts: ['slideshowpure.js', 'tizen-config.js'] },
        files: { 'slideshowpure.js': original.script, 'tizen-config.js': assets.config }
    },
    lowered: {
        page: { css: assets.css, scripts: ['polyfills.js', 'slideshowpure.js', 'tizen-config.js'] },
        files: { 'polyfills.js': assets.polyfills, 'slideshowpure.js': assets.script, 'tizen-config.js': assets.config }
    },
    // what the TV gets: the lowered assets plus the TV-only rules, under a theme
    tv: {
        page: { css: `${assets.css}\n${assets.tvCss}`, themeCss: THEME_CSS, scripts: ['polyfills.js', 'slideshowpure.js', 'tizen-config.js'] },
        files: { 'polyfills.js': assets.polyfills, 'slideshowpure.js': assets.script, 'tizen-config.js': assets.config }
    }
});
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const errors = [];
let failures = unexpected.length;

for (const layout of ['plate', 'marquee', 'classic']) {
    const query = `?ss_layout=${layout}`;
    const before = await capture(browser, `${base}/original/${query}`, errors);
    const after = await capture(browser, `${base}/lowered/${query}`, errors);

    if (process.env.SCREENSHOT_DIR) {
        fs.writeFileSync(path.join(process.env.SCREENSHOT_DIR, `${layout}-original.png`), before.screenshot);
        fs.writeFileSync(path.join(process.env.SCREENSHOT_DIR, `${layout}-lowered.png`), after.screenshot);
    }

    const keys = new Set([...Object.keys(before.result), ...Object.keys(after.result)]);
    const differences = [];
    for (const key of keys) {
        const a = before.result[key];
        const b = after.result[key];
        if (!a || !b) {
            differences.push(`${key}: only in ${a ? 'original' : 'lowered'}`);
            continue;
        }
        if (a.hidden && b.hidden) continue;
        const moved = ['x', 'y', 'width', 'height', 'fontSize', 'hidden']
            .filter(prop => Math.abs(a[prop] - b[prop]) > TOLERANCE_PX)
            .filter(prop => !KNOWN_DIFFERENCES.some(known => known.key.test(key) && known.props.includes(prop)))
            .map(prop => `${prop} ${Math.round(a[prop] * 10) / 10} -> ${Math.round(b[prop] * 10) / 10}`);
        if (moved.length) differences.push(`${key}: ${moved.join(', ')}`);
    }

    console.log(`${layout}: ${keys.size} elements compared, ${differences.length} differ`);
    for (const difference of differences) console.log(`  ${difference}`);
    failures += differences.length;
}

// Signing in after the bar's own timeout has passed must still start it.
{
    const context = await browser.newContext({ viewport: { width: TV.width, height: TV.height } });
    const tab = await context.newPage();
    await tab.addInitScript(() => { window.signedOut = true; });
    await tab.goto(`${base}/lowered/?ss_authWaitTimeoutMs=1000#/home.html`);
    await tab.waitForTimeout(2500);
    const before = await tab.evaluate(() => Boolean(document.querySelector('#slides-container .slide')));
    await tab.evaluate(() => { window.signedOut = false; });
    const started = await tab.waitForSelector('#slides-container .slide.active .button-container', { timeout: 15000 })
        .then(() => true, () => false);
    console.log(`late sign-in: bar ${before ? 'started too early' : started ? 'starts after sign-in' : 'never starts'}`);
    if (before || !started) failures += 1;
    await context.close();
}

// A request the server never answers must not leave the bar loading forever.
{
    const context = await browser.newContext({ viewport: { width: TV.width, height: TV.height } });
    const tab = await context.newPage();
    await tab.addInitScript(() => { window.testUserId = 'hang'; window.mediaBarRequestTimeoutMs = 1500; });
    await tab.goto(`${base}/lowered/#/home.html`);
    const started = await tab.waitForSelector('#slides-container .slide.active .button-container', { timeout: 15000 })
        .then(() => true, () => false);
    console.log(`unanswered request: bar ${started ? 'starts after the timeout' : 'never starts'}`);
    if (!started) failures += 1;
    await context.close();
}

// When loading the titles times out, the bar must try again by itself.
{
    const context = await browser.newContext({ viewport: { width: TV.width, height: TV.height } });
    const tab = await context.newPage();
    await tab.addInitScript(() => { window.testToken = 'flaky'; window.mediaBarRequestTimeoutMs = 1500; });
    await tab.goto(`${base}/lowered/#/home.html`);
    const started = await tab.waitForSelector('#slides-container .slide.active .button-container', { timeout: 30000 })
        .then(() => true, () => false);
    const chrome = await tab.evaluate(() => document.querySelectorAll('#slides-container .arrow').length);
    console.log(`titles time out once: bar ${started ? 'loads on the retry' : 'stays empty'}, ${chrome} arrows`);
    if (!started || chrome !== 2) failures += 1;
    await context.close();
}

// Under a server theme the text must stay below the header and above the
// rows, and the buttons must stay apart and readable.
{
    const context = await browser.newContext({ viewport: { width: TV.width, height: TV.height } });
    const tab = await context.newPage();
    await tab.goto(`${base}/tv/?ss_layout=marquee#/home.html`);
    await tab.waitForSelector('#slides-container .slide.active .button-container', { timeout: 20000 });
    await tab.waitForTimeout(2500);
    await tab.focus('#slides-container .slide.active .play-button');
    await tab.waitForTimeout(300);
    const found = await tab.evaluate(() => {
        const slide = document.querySelector('#slides-container .slide.active');
        const box = selector => (selector.nodeType ? selector : slide.querySelector(selector)).getBoundingClientRect();
        const content = slide.querySelector('.slide-content');
        const style = getComputedStyle(content);
        const detail = getComputedStyle(slide.querySelector('.detail-button'));
        const light = /rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?/.exec(detail.backgroundColor);
        return {
            header: box(document.querySelector('.skinHeader')).bottom,
            rows: box(document.querySelector('.homeSectionsContainer')).top,
            stageTop: box(document.getElementById('slides-container')).top,
            logoTop: box('.logo-container').top,
            buttonsBottom: box('.button-container').bottom,
            dotsBottom: box(document.querySelector('.dots-container')).bottom,
            playRight: box('.play-button').right,
            detailLeft: box('.detail-button').left,
            detailRight: box('.detail-button').right,
            favoriteLeft: box('.favorite-button').left,
            ringRoom: Math.min(parseFloat(style.paddingLeft), parseFloat(style.paddingBottom)),
            detailIsLight: Number(light[1]) + Number(light[2]) + Number(light[3]) > 380 && light[4] !== '0'
        };
    });
    if (process.env.SCREENSHOT_DIR) await tab.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, 'tv-themed.png') });
    const problems = [];
    if (Math.abs(found.stageTop) > 1) problems.push(`stage starts at ${found.stageTop}`);
    if (found.logoTop < found.header) problems.push(`logo starts at ${found.logoTop}, header ends at ${found.header}`);
    if (found.buttonsBottom > found.rows || found.dotsBottom > found.rows) problems.push(`buttons end at ${found.buttonsBottom}, dots at ${found.dotsBottom}, rows start at ${found.rows}`);
    if (found.detailLeft - found.playRight < 10 || found.favoriteLeft - found.detailRight < 10) problems.push('buttons touch');
    if (found.ringRoom < 19) problems.push(`only ${found.ringRoom}px around the buttons for the focus ring`);
    if (found.detailIsLight) problems.push('round buttons have a light background');
    console.log(`server theme: ${problems.length ? problems.join('; ') : `text between header (${Math.round(found.header)}) and rows (${Math.round(found.rows)}): ${Math.round(found.logoTop)}-${Math.round(found.buttonsBottom)}`}`);
    failures += problems.length;
    await context.close();
}

// Without trailers the bar must move on by itself, and the remote's focus
// must move along to the title that is showing.
{
    const context = await browser.newContext({ viewport: { width: TV.width, height: TV.height } });
    const tab = await context.newPage();
    await tab.goto(`${base}/tv/?ss_layout=marquee&ss_shuffleInterval=2000#/home.html`);
    await tab.waitForSelector('#slides-container .slide.active .button-container', { timeout: 20000 });
    await tab.focus('#slides-container .slide.active .detail-button');
    const shown = () => tab.evaluate(() => {
        const active = document.querySelector('#slides-container .slide.active');
        const focused = document.activeElement;
        return { title: active.dataset.itemId, focusOnIt: active.contains(focused), button: focused.className };
    });
    const first = await shown();
    const moved = await tab.waitForFunction(
        title => document.querySelector('#slides-container .slide.active').dataset.itemId !== title,
        first.title, { timeout: 8000 }
    ).then(() => true, () => false);
    await tab.waitForTimeout(300);
    const second = await shown();
    // the progress line must run as a transform, not as a changing width
    const progress = await tab.evaluate(() => {
        const bar = document.querySelector('#slides-container .slide.active .spec-progress');
        const style = getComputedStyle(bar);
        const backdrop = getComputedStyle(document.querySelector('#slides-container .slide.active .backdrop'));
        return { animation: style.animationName, duration: style.animationDuration, effects: backdrop.animationName + ' ' + backdrop.filter };
    });
    if (progress.animation !== 'media-bar-progress' || progress.duration !== '2s' || progress.effects !== 'none none') {
        console.log(`  progress line: ${JSON.stringify(progress)}`);
        failures += 1;
    }
    const follows = second.focusOnIt && /detail-button/.test(second.button);
    console.log(`slideshow: ${moved ? 'moves to the next title by itself' : 'stays on the first title'}, focus ${follows ? 'follows' : 'stays behind'}`);
    if (!moved || !follows) failures += 1;
    await context.close();
}

// OK on the remote must activate the focused button.
{
    const context = await browser.newContext({ viewport: { width: TV.width, height: TV.height } });
    const tab = await context.newPage();
    await tab.addInitScript(() => {
        window.activated = [];
        window.Emby = { Page: { show: url => window.activated.push('details ' + url) } };
    });
    await tab.goto(`${base}/tv/?ss_layout=marquee#/home.html`);
    await tab.waitForSelector('#slides-container .slide.active .button-container', { timeout: 20000 });
    await tab.evaluate(() => {
        window.slideshowPure.ApiUtils.playItem = id => { window.activated.push('play ' + id); return Promise.resolve(true); };
        window.slideshowPure.ApiUtils.toggleFavorite = id => { window.activated.push('favorite ' + id); return Promise.resolve(true); };
    });
    for (const name of ['play-button', 'detail-button', 'favorite-button']) {
        await tab.focus(`#slides-container .slide.active .${name}`);
        await tab.keyboard.press('Enter');
        await tab.waitForTimeout(200);
    }
    const activated = await tab.evaluate(() => window.activated);
    console.log(`OK on the buttons: ${activated.length}/3 activated ${JSON.stringify(activated)}`);
    if (activated.length !== 3) failures += 1;
    await context.close();
}

// The second start must show the stored titles without waiting for the
// server, and ask the server again afterwards.
{
    const context = await browser.newContext({ viewport: { width: TV.width, height: TV.height } });
    const tab = await context.newPage();
    await tab.addInitScript(() => {
        window.testToken = localStorage.getItem('testToken') || 'token';
        window.mediaBarRefreshDelayMs = 500;
    });
    await tab.goto(`${base}/lowered/#/home.html`);
    await tab.waitForSelector('#slides-container .slide.active .button-container', { timeout: 20000 });
    await tab.waitForTimeout(500);
    const stored = await tab.evaluate(() => Object.keys(localStorage).filter(name => name.indexOf('mediaBarCache:') === 0).length);
    // from here on the server no longer answers requests for titles
    await tab.evaluate(() => localStorage.setItem('testToken', 'dead'));
    await tab.reload();
    const started = await tab.waitForSelector('#slides-container .slide.active .button-container', { timeout: 4000 })
        .then(() => true, () => false);
    await tab.waitForTimeout(1000);
    const refreshed = await tab.evaluate(() => window.mediaBarRequests.some(request => /^refresh .*Items/.test(request.url)));
    console.log(`stored titles: ${stored} answers kept, second start ${started ? 'shows the bar without the server' : 'waits for the server'}, ${refreshed ? 'refresh requested' : 'no refresh'}`);
    if (stored < 2 || !started || !refreshed) failures += 1;
    await context.close();
}

await browser.close();
server.closeAllConnections();
server.close();

for (const error of errors) console.log(`page error: ${error}`);
if (failures || errors.length) process.exit(1);
