// Rewrites slideshowpure.css so it works on the old Chromium builds in Samsung
// TVs (Tizen 5.0 = Chromium 63, Tizen 5.5 = Chromium 69).
//
// The TV viewport and root font size are fixed, so viewport- and rem-based
// math can be resolved at build time:
//   - clamp()/min()/max()  -> a px value
//   - flex `gap`           -> margins on the flex items
//   - :focus-visible       -> :focus (a TV is always keyboard driven)
//   - :has()               -> selector dropped (reported)
// Everything else (colour syntax, inset, prefixes) is left to Lightning CSS.

import postcss from 'postcss';
import valueParser from 'postcss-value-parser';
import { transform, browserslistToTargets } from 'lightningcss';
import browserslist from 'browserslist';

export const TV = {
    width: 1920,
    height: 1080,
    // jellyfin-web: `.layout-tv { font-size: 125% }` on <html>
    rootFontSize: 20
};

const UNIT_PX = {
    px: 1,
    rem: TV.rootFontSize,
    vw: TV.width / 100,
    vh: TV.height / 100,
    vmin: Math.min(TV.width, TV.height) / 100,
    vmax: Math.max(TV.width, TV.height) / 100
};

const MATH_FUNCTIONS = new Set(['clamp', 'min', 'max']);

// ---------------------------------------------------------------------------
// Static evaluation of length expressions
// ---------------------------------------------------------------------------

// Returns { px } for a length, { number } for a unitless number, or null when
// the expression depends on something only known at runtime (%, em, var()).
function evaluate(nodes) {
    const tokens = [];
    for (const node of nodes) {
        if (node.type === 'space' || node.type === 'comment') continue;
        if (node.type === 'word') {
            if (['+', '-', '*', '/'].includes(node.value)) {
                tokens.push(node.value);
                continue;
            }
            const unit = valueParser.unit(node.value);
            if (!unit) return null;
            const number = parseFloat(unit.number);
            if (unit.unit === '') tokens.push({ number });
            else if (unit.unit in UNIT_PX) tokens.push({ px: number * UNIT_PX[unit.unit] });
            else return null;
            continue;
        }
        if (node.type === 'div' && node.value === '/') {
            tokens.push('/');
            continue;
        }
        if (node.type === 'function') {
            const name = node.value.toLowerCase();
            let result;
            if (name === 'calc' || name === '') result = evaluate(node.nodes);
            else if (MATH_FUNCTIONS.has(name)) result = evaluateMath(name, node);
            else return null;
            if (!result) return null;
            tokens.push(result);
            continue;
        }
        return null;
    }
    return reduce(tokens);
}

function reduce(tokens) {
    // multiplication and division first
    const sums = [];
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (token === '*' || token === '/') {
            const left = sums.pop();
            const right = tokens[++i];
            if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return null;
            if (token === '*') {
                if ('px' in left && 'px' in right) return null;
                if ('px' in left) sums.push({ px: left.px * right.number });
                else if ('px' in right) sums.push({ px: left.number * right.px });
                else sums.push({ number: left.number * right.number });
            } else {
                if ('px' in right || right.number === 0) return null;
                if ('px' in left) sums.push({ px: left.px / right.number });
                else sums.push({ number: left.number / right.number });
            }
        } else {
            sums.push(token);
        }
    }

    let total = null;
    let sign = 1;
    for (const token of sums) {
        if (token === '+') { sign = 1; continue; }
        if (token === '-') { sign = -1; continue; }
        if (typeof token !== 'object') return null;
        if (total === null) {
            total = 'px' in token ? { px: sign * token.px } : { number: sign * token.number };
        } else if ('px' in total && 'px' in token) {
            total = { px: total.px + sign * token.px };
        } else if ('number' in total && 'number' in token) {
            total = { number: total.number + sign * token.number };
        } else {
            return null;
        }
        sign = 1;
    }
    return total;
}

function splitArguments(node) {
    const args = [[]];
    for (const child of node.nodes) {
        if (child.type === 'div' && child.value === ',') args.push([]);
        else args[args.length - 1].push(child);
    }
    return args;
}

function evaluateMath(name, node) {
    const values = splitArguments(node).map(evaluate);
    if (values.some(value => !value || !('px' in value))) return null;
    const px = values.map(value => value.px);
    if (name === 'min') return { px: Math.min(...px) };
    if (name === 'max') return { px: Math.max(...px) };
    if (px.length !== 3) return null;
    return { px: Math.max(px[0], Math.min(px[1], px[2])) };
}

function formatPx(px) {
    const rounded = Math.round(px * 100) / 100;
    return rounded === 0 ? '0px' : `${rounded}px`;
}

// ---------------------------------------------------------------------------
// PostCSS plugin
// ---------------------------------------------------------------------------

function hasMathFunction(value) {
    return /(^|[^-\w])(clamp|min|max)\(/i.test(value);
}

function resolveMath(decl, report) {
    if (!hasMathFunction(decl.value)) return;

    const parsed = valueParser(decl.value);

    // `width: min(46%, 46rem)` cannot be folded into one value, but it is the
    // same as a width capped by a max-width.
    if (parsed.nodes.length === 1 && parsed.nodes[0].type === 'function' &&
        parsed.nodes[0].value.toLowerCase() === 'min' && ['width', 'height'].includes(decl.prop)) {
        const args = splitArguments(parsed.nodes[0]);
        const whole = evaluate(parsed.nodes);
        if (!whole && args.length === 2) {
            const cap = evaluate(args[1]);
            const maxProp = `max-${decl.prop}`;
            const alreadyCapped = decl.parent.some(node => node.type === 'decl' && node.prop === maxProp);
            if (cap && 'px' in cap && !alreadyCapped) {
                decl.cloneAfter({ prop: maxProp, value: formatPx(cap.px) });
                decl.value = valueParser.stringify(args[0]).trim();
                return;
            }
        }
    }

    let unresolved = false;
    parsed.walk(node => {
        if (node.type !== 'function' || !MATH_FUNCTIONS.has(node.value.toLowerCase())) return undefined;
        const result = evaluateMath(node.value.toLowerCase(), node);
        if (!result) {
            unresolved = true;
            return undefined;
        }
        node.type = 'word';
        node.value = formatPx(result.px);
        delete node.nodes;
        return false;
    });

    decl.value = parsed.toString();
    if (unresolved) {
        report.unresolvedMath.push(`${decl.source.start.line}: ${decl.prop}: ${decl.value}`);
    }
}

// The flex container facts needed to turn `gap` into margins, collected per
// selector and per trailing class so that overrides such as
// `#slides-container.layout-plate .slide-content` inherit from `.slide-content`.
function collectFlexFacts(root) {
    const facts = new Map();
    const remember = (key, prop, value) => {
        if (!facts.has(key)) facts.set(key, {});
        facts.get(key)[prop] = value;
    };
    root.walkRules(rule => {
        // rules inside @media describe other screen sizes than the TV's
        if (rule.parent.type !== 'root') return;
        rule.walkDecls(/^(display|flex-direction|flex-flow|justify-content)$/, decl => {
            for (const selector of rule.selectors) {
                remember(selector, decl.prop, decl.value);
                if (/^\.[\w-]+$/.test(selector.trim())) remember(`@${selector.trim()}`, decl.prop, decl.value);
            }
        });
    });
    return facts;
}

function lastCompoundClasses(selector) {
    const compound = selector.trim().replace(/:[\w-]+\([^)]*\)/g, '').split(/[\s>+~]+/).pop();
    return compound.match(/\.[\w-]+/g) || [];
}

function flexLayout(selector, facts) {
    const sources = [
        facts.get(selector) || {},
        ...lastCompoundClasses(selector).reverse().map(name => facts.get(`@${name}`) || {})
    ];
    const pick = prop => sources.map(source => source[prop]).find(Boolean);

    const display = pick('display');
    const flow = pick('flex-direction') || pick('flex-flow') || 'row';
    const baseFlow = sources.slice(1).map(source => source['flex-direction'] || source['flex-flow']).find(Boolean) || 'row';
    const ownFlow = sources[0]['flex-direction'] || sources[0]['flex-flow'];
    if (!display) return null;
    if (/grid/.test(display)) return { type: 'grid' };
    if (!/flex/.test(display)) return null;
    return {
        type: 'flex',
        column: /column/.test(flow),
        // refines a class that lays its items out along the other axis, whose
        // margins would otherwise stay in effect
        flips: Boolean(ownFlow) && sources.length > 1 && /column/.test(ownFlow) !== /column/.test(baseFlow),
        // an extra ::before item would take part in space-between/around
        distributes: /space-/.test(pick('justify-content') || '')
    };
}

// Classes whose ::before already renders something (an icon, say). There the
// pseudo-element is the first flex item itself and cannot be borrowed.
function collectBeforeOwners(root) {
    const owners = new Set();
    root.walkRules(/::?before/, rule => {
        for (const selector of rule.selectors) {
            const match = selector.match(/(\.[\w-]+)[^\s>+~]*::?before\s*$/);
            if (match) owners.add(match[1]);
        }
    });
    return owners;
}

function negate(length) {
    return /^0[a-z%]*$/.test(length) ? '0' : `calc(-1 * ${length})`;
}

// Flex items that bring their own margin along the gap axis. A margin rule on
// `container > *` would replace that margin instead of adding to it, so these
// are left out of it and get the gap added to their own margin through a
// custom property. test/run.mjs fails when this list is out of date.
const ITEMS_WITH_OWN_MARGIN = {
    '.slide-content': ['.button-container', '.spec-rail']
};
// Flex containers whose content is an element followed by bare text. Text has
// no element to carry a margin, so the element gets a trailing one instead.
const ELEMENT_THEN_TEXT = ['.critic-rating'];
const TRAILING = { 'margin-top': 'margin-bottom', 'margin-left': 'margin-right' };
const GAP_PROPERTY = { 'margin-top': '--media-bar-gap-top', 'margin-left': '--media-bar-gap-left' };

function ownMarginItems(selector) {
    return lastCompoundClasses(selector).flatMap(name => ITEMS_WITH_OWN_MARGIN[name] || []);
}

function addGapToOwnMargins(root) {
    const items = Object.values(ITEMS_WITH_OWN_MARGIN).flat();

    root.walkDecls('margin-top', decl => {
        const targetsItem = decl.parent.selectors.every(selector =>
            lastCompoundClasses(selector).some(name => items.includes(name)));
        if (!targetsItem) return;
        const own = /^0[a-z%]*$/.test(decl.value) ? '0px' : decl.value;
        decl.value = `calc(${own} + var(${GAP_PROPERTY['margin-top']}, 0px))`;
    });

    // Fallback for layouts in which the item declares no margin of its own.
    root.prepend(postcss.rule({
        selectors: items,
        nodes: [postcss.decl({ prop: 'margin-top', value: `var(${GAP_PROPERTY['margin-top']}, 0px)` })]
    }));
}

// Flex `gap` only spaces the items that are actually rendered. Margins on
// `> * + *` would also count hidden items, so every item gets a leading margin
// and an empty ::before item with the opposite margin cancels the first one.
function lowerGap(root, report) {
    const facts = collectFlexFacts(root);
    const beforeOwners = collectBeforeOwners(root);

    root.walkDecls(/^(gap|row-gap|column-gap)$/, decl => {
        const rule = decl.parent;
        const parts = valueParser(decl.value).nodes.filter(node => node.type !== 'space');
        const rowGap = valueParser.stringify(parts[0]);
        const columnGap = parts[1] ? valueParser.stringify(parts[1]) : rowGap;

        const newGroup = (prop, gap) => ({ prop, gap, items: [], spacers: [], siblings: [], trailing: [], resets: [] });
        const groups = {
            column: newGroup('margin-top', rowGap),
            row: newGroup('margin-left', columnGap)
        };
        let grid = false;

        for (const selector of rule.selectors) {
            const layout = flexLayout(selector, facts);
            if (!layout) {
                report.unknownGap.push(`${decl.source.start.line}: ${selector} { ${decl.prop}: ${decl.value} }`);
                continue;
            }
            if (layout.type === 'grid') {
                grid = true;
                continue;
            }
            if (layout.column ? decl.prop === 'column-gap' : decl.prop === 'row-gap') continue;

            const group = layout.column ? groups.column : groups.row;
            const classes = lastCompoundClasses(selector);
            if (layout.flips) group.resets.push(`${selector} > *`);

            if (classes.some(name => ELEMENT_THEN_TEXT.includes(name))) {
                group.trailing.push(`${selector} > *`);
            } else if (layout.distributes) {
                group.siblings.push(`${selector} > * + *`);
            } else {
                const excluded = ownMarginItems(selector);
                group.items.push(`${selector} > *${excluded.map(name => `:not(${name})`).join('')}`);
                if (excluded.length) group.publish = true;
                if (!classes.some(name => beforeOwners.has(name))) {
                    group.spacers.push(`${selector}::before`);
                }
            }
        }

        let anchor = rule;
        const emit = (selectors, declarations) => {
            if (!selectors.length) return;
            anchor = anchor.cloneAfter({ selectors, nodes: [] });
            for (const [prop, value] of declarations) anchor.append({ prop, value });
        };
        for (const group of Object.values(groups)) {
            emit(group.spacers, [['content', '""'], [group.prop, negate(group.gap)]]);
            emit(group.items, [[group.prop, group.gap]]);
            emit(group.siblings, [[group.prop, group.gap]]);
            emit(group.trailing, [[TRAILING[group.prop], group.gap]]);
            emit(group.resets, [[group.prop === 'margin-top' ? 'margin-left' : 'margin-top', '0']]);
        }

        for (const group of Object.values(groups)) {
            if (group.publish) decl.cloneBefore({ prop: GAP_PROPERTY[group.prop], value: group.gap });
        }

        if (grid) {
            // Chromium < 66 only knows the prefixed grid properties
            decl.cloneBefore({ prop: `grid-${decl.prop}`, value: decl.value });
        } else {
            // Old engines ignore `gap` on flex containers; removing it keeps
            // newer engines from adding it on top of the margins.
            decl.remove();
        }
    });
}

function lowerSelectors(root, report) {
    root.walkRules(rule => {
        if (rule.selector.includes(':has(')) {
            const kept = rule.selectors.filter(selector => !selector.includes(':has('));
            const dropped = rule.selectors.filter(selector => selector.includes(':has('));
            report.droppedHas.push(...dropped.map(selector => `${rule.source.start.line}: ${selector}`));
            if (!kept.length) {
                rule.remove();
                return;
            }
            rule.selectors = kept;
        }
        if (rule.selector.includes(':focus-visible')) {
            rule.selector = rule.selector.replace(/:focus-visible/g, ':focus');
        }
    });
}

const tizenPlugin = report => ({
    postcssPlugin: 'media-bar-tizen',
    Once(root) {
        lowerSelectors(root, report);
        root.walkDecls(decl => resolveMath(decl, report));
        addGapToOwnMargins(root);
        lowerGap(root, report);
    }
});

export async function lowerCss(css, { targets = 'chrome 63' } = {}) {
    const report = { unresolvedMath: [], unknownGap: [], droppedHas: [] };
    const processed = await postcss([tizenPlugin(report)]).process(css, { from: undefined });

    const { code } = transform({
        filename: 'slideshowpure.css',
        code: Buffer.from(processed.css),
        targets: browserslistToTargets(browserslist(targets)),
        minify: false
    });

    return { css: code.toString(), report };
}
