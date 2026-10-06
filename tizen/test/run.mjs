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
// `.ss-set-value` keeps its own `margin-left: auto` instead of the row gap,
// which moves the number in a slider row by 2px.
const KNOWN_DIFFERENCES = [/span\.ss-set-value\[\d+\]$/];

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

function page({ css, scripts }) {
    return `<!doctype html>
<html class="layout-tv" style="font-size:125%"><head><meta charset="utf-8">
<style>body{margin:0;background:#101010;color:#fff;font-family:sans-serif}.hide{display:none!important}
.verticalSection{height:15rem;border-top:1px solid #333}</style>
<style>${css}</style>
<script>
window.ApiClient = {
    isLoggedIn: function () { return true; },
    accessToken: function () { return 'token'; },
    getCurrentUserId: function () { return 'user1'; },
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
</body></html>`;
}

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
        if (/\/web\/avatars\/list\.txt$/.test(url.pathname)) return send('text/plain', '', 404);
        if (/\/Views$/.test(url.pathname)) return send('application/json', JSON.stringify({ Items: [] }));
        if (/^\/Items\/?$/.test(url.pathname)) return send('application/json', JSON.stringify({ Items: ITEMS }));
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

const server = await startServer({
    original: {
        page: { css: original.css, scripts: ['slideshowpure.js', 'tizen-config.js'] },
        files: { 'slideshowpure.js': original.script, 'tizen-config.js': assets.config }
    },
    lowered: {
        page: { css: assets.css, scripts: ['polyfills.js', 'slideshowpure.js', 'tizen-config.js'] },
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
        if (KNOWN_DIFFERENCES.some(pattern => pattern.test(key))) continue;
        const moved = ['x', 'y', 'width', 'height', 'fontSize', 'hidden']
            .filter(prop => Math.abs(a[prop] - b[prop]) > TOLERANCE_PX)
            .map(prop => `${prop} ${Math.round(a[prop] * 10) / 10} -> ${Math.round(b[prop] * 10) / 10}`);
        if (moved.length) differences.push(`${key}: ${moved.join(', ')}`);
    }

    console.log(`${layout}: ${keys.size} elements compared, ${differences.length} differ`);
    for (const difference of differences) console.log(`  ${difference}`);
    failures += differences.length;
}

await browser.close();
server.close();

for (const error of errors) console.log(`page error: ${error}`);
if (failures || errors.length) process.exit(1);
