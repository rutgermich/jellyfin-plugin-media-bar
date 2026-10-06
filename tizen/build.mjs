// Adds the media bar to a jellyfin-tizen package.
//
//   node build.mjs <jellyfin-tizen.wgt> [output.wgt]
//
// The output is unsigned: Samsung TVs only install packages signed with a
// certificate that lists the TV, so sign it with your own certificate.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';
import * as acorn from 'acorn';
import esbuild from 'esbuild';
import { lowerCss } from './lower-css.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

// Tizen 5.0 (2019 TVs) runs Chromium 63, Tizen 5.5 (2020) Chromium 69.
const JS_TARGET = 'chrome63';
const CSS_TARGET = 'chrome 63';
// Newest syntax Chromium 63 parses; the lowered script must fit in it.
const JS_SYNTAX_LIMIT = 2018;

const ASSET_DIR = 'www/mediabar';
const INDEX = 'www/index.html';
const SIGNATURES = ['author-signature.xml', 'signature1.xml'];
const MARKER = '<!-- media-bar -->';

export async function buildAssets() {
    const script = fs.readFileSync(path.join(repoRoot, 'slideshowpure.js'), 'utf8');
    const { code } = await esbuild.transform(script, { target: JS_TARGET, charset: 'utf8' });
    acorn.parse(code, { ecmaVersion: JS_SYNTAX_LIMIT, sourceType: 'script' });

    const styles = fs.readFileSync(path.join(repoRoot, 'slideshowpure.css'), 'utf8');
    const { css, report } = await lowerCss(styles, { targets: CSS_TARGET });

    const config = fs.readFileSync(path.join(here, 'tizen-config.js'), 'utf8');
    acorn.parse(config, { ecmaVersion: 5, sourceType: 'script' });

    const bundle = await esbuild.build({
        entryPoints: [path.join(here, 'polyfills.src.js')],
        bundle: true,
        format: 'iife',
        target: JS_TARGET,
        write: false
    });
    const polyfills = bundle.outputFiles[0].text;
    acorn.parse(polyfills, { ecmaVersion: JS_SYNTAX_LIMIT, sourceType: 'script' });

    return { script: code, css, config, polyfills, report };
}

export function injectIntoIndex(html) {
    if (html.includes(MARKER)) throw new Error('This package already contains the media bar.');
    if (!html.includes('</head>')) throw new Error(`${INDEX} has no </head> to inject before.`);

    const tags = MARKER +
        '<link rel="stylesheet" href="mediabar/slideshowpure.css">' +
        '<script defer src="mediabar/polyfills.js"></script>' +
        '<script defer src="mediabar/slideshowpure.js"></script>' +
        '<script defer src="mediabar/tizen-config.js"></script>';

    return html.replace('</head>', `${tags}</head>`);
}

async function main() {
    const [input, output = input?.replace(/\.wgt$/i, '') + '-mediabar.wgt'] = process.argv.slice(2);
    if (!input) {
        console.error('Usage: node build.mjs <jellyfin-tizen.wgt> [output.wgt]');
        process.exit(1);
    }

    const assets = await buildAssets();
    const zip = new AdmZip(input);

    const index = zip.getEntry(INDEX);
    if (!index) throw new Error(`${input} has no ${INDEX}; is this a jellyfin-tizen package?`);
    zip.updateFile(index, Buffer.from(injectIntoIndex(index.getData().toString('utf8'))));

    zip.addFile(`${ASSET_DIR}/polyfills.js`, Buffer.from(assets.polyfills));
    zip.addFile(`${ASSET_DIR}/slideshowpure.js`, Buffer.from(assets.script));
    zip.addFile(`${ASSET_DIR}/slideshowpure.css`, Buffer.from(assets.css));
    zip.addFile(`${ASSET_DIR}/tizen-config.js`, Buffer.from(assets.config));

    // The original signatures no longer match the contents.
    for (const name of SIGNATURES) {
        if (zip.getEntry(name)) zip.deleteFile(name);
    }

    zip.writeZip(output);

    console.log(`Wrote ${output} (unsigned)`);
    for (const selector of assets.report.droppedHas) console.log(`  dropped :has() rule  ${selector}`);
    for (const line of assets.report.unresolvedMath) console.log(`  unresolved math      ${line}`);
    for (const line of assets.report.unknownGap) console.log(`  gap left as is       ${line}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(error => {
        console.error(error.message);
        process.exit(1);
    });
}
