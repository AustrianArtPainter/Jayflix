import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { officialPages, themeLink, withoutThemeHooks } from './helpers/ui-presentation-contract.mjs';

const root = new URL('../', import.meta.url);
const read = file => readFileSync(new URL(file, root), 'utf8');
const theme = read('css/ui-theme.css');
const tokens = read('css/ui-tokens.css');

test('Every production page shares one theme after its original styles; the diagnostic page is excluded', () => {
    for (const file of officialPages) {
        const html = read(file);
        assert.equal(html.split(themeLink).length, 2, file);
        assert.match(html, /<body class="[^"]*\bjayflix-ui\b/);
        assert.ok(html.indexOf(themeLink) > html.lastIndexOf('<link rel="stylesheet"', html.indexOf(themeLink) - 1));
        const references = [...html.matchAll(/href="(css\/[^"?]+)(?:\?[^"]*)?"/g)].map(match => match[1]);
        for (const css of references) assert.ok(read(css).length);
    }
    assert.doesNotMatch(read('orbit-test.html'), /jayflix-ui|ui-theme\.css/);
});

test('Homepage colors and typography are extracted unchanged and reused, not replaced with a second palette', () => {
    const palette = { 'home-ink': '#080d11', 'home-surface': '#10181d', 'home-line': 'rgba(210, 229, 223, .12)',
        'home-muted': '#82938f', 'home-accent': '#a2e2ce', 'home-white': '#edf2ee',
        'ui-panel': '#0e1812', 'ui-dialog': '#111e16', 'ui-inset': '#142019', 'ui-control': '#17241e' };
    for (const [name, value] of Object.entries(palette)) assert.ok(tokens.includes(`--${name}: ${value};`));
    assert.match(tokens, /--ui-font: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;/);
    for (const file of ['css/home-orbit.css', 'css/ui-theme.css']) assert.match(read(file), /^@import url\("ui-tokens\.css"\);/);
    const home = read('css/home-orbit.css');
    assert.doesNotMatch(home, /--home-(?:ink|surface|line|muted|accent|white):/);
    assert.match(home, /font-family: var\(--ui-font\)/);
    assert.match(theme, /body\.jayflix-ui[\s\S]*background: var\(--home-ink\)/);
    assert.doesNotMatch(theme, /#00ccff|#ff3c78|#23ade5|#3b82f6|linear-gradient/);
});

test('Player root canvas uses the same background as its body without changing layout or other pages', () => {
    const rule = theme.match(/html:has\(> body\.jayflix-ui\.player-page\)\s*\{([^}]+)\}/);
    assert.ok(rule, 'Transparent content below the viewport must not reveal the legacy html color');
    assert.match(rule[1], /^\s*background: var\(--home-ink\);\s*$/);
    const body = theme.match(/body\.jayflix-ui\s*\{([^}]+)\}/)[1];
    assert.match(body, /background: var\(--home-ink\);/);
    assert.doesNotMatch(theme, /(?:^|\n)html\s*\{/);
});

test('Background fix leaves all approved button, selected episode and footer colors byte-for-byte unchanged', () => {
    const patch = `/* The legacy player fixes html/body to one viewport. Overflowing transparent
   content therefore exposes the root canvas; match it without changing layout. */
html:has(> body.jayflix-ui.player-page) {
    background: var(--home-ink);
}

`;
    assert.ok(theme.includes(patch));
    const hash = text => createHash('sha256').update(text).digest('hex');
    assert.equal(hash(theme.replace(patch, '')), '8b97a7c5acc89422261680bf67ea97c0ef2a31ee2ae27ee57fa727b3cd8c4d5a');
    assert.equal(hash(tokens), 'ce6154fbc5b78f38575ba5e1973bf46786feacf11f98050c7fc452769a3e5f03');
});

test('All nine static/dynamic modal and drawer families plus shared states have theme coverage', () => {
    for (const id of ['historyPanel', 'settingsPanel', 'modal', 'passwordModal', 'tagManageModal',
        'showImportBoxModal', 'importUrlModal', 'messageBoxModal', 'loading', 'toast']) assert.ok(theme.includes('#' + id), id);
    for (const selector of ['.modal-detail-info', '.detail-desc', '.episode-active', '.api-item', '.form-checkbox',
        '.history-progress', '.history-episode', '.history-source', '#resultsArea', '#dropZone', '.speed-indicator', '.position-restore-hint', '.shortcut-hint',
        '.player-loading-overlay', '.error-container', '.art-settings', '.art-selector-list', '.art-contextmenus']) assert.ok(theme.includes(selector), selector);
    // Source selection uses the existing player modal, not a new popup/handler.
    assert.match(read('js/player.js'), /function showSwitchResourceModal\(\)[\s\S]*getElementById\('modal'\)/);
    for (const name of ['tagManageModal', 'messageBoxModal', 'showImportBoxModal', 'importUrlModal']) {
        assert.ok(['js/app.js', 'js/ui.js', 'js/douban.js'].some(file => read(file).includes(`modal.id = '${name}'`)));
    }
});

test('Theme does not introduce layout, breakpoint, visibility, rotation or gesture behavior changes', () => {
    const css = theme.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(css, /@media|\b(?:display|position|transform|perspective|touch-action|pointer-events|z-index|width|height|padding|margin|grid-template-columns|overflow)\s*:/);
    assert.doesNotMatch(css, /\.orbit-|#orbit|#douban-results|#recommendationOrbit/);
    assert.doesNotMatch(css, /:is\([^{}]*\.player-container\) button/);
    assert.match(css, /\.player-container:not\(#playerContainer\)/);
    assert.match(css, /\.jayflix-ui :where\([^{}]*\.player-container:not\(#playerContainer\)\) button,/,
        'Region IDs must have zero specificity, so active/disabled button colors can win');
    assert.match(css, /#episodesList \.episode-active[\s\S]*background: var\(--home-accent\) !important/);
    assert.match(css, /button:disabled/);
});

test('Presentation exception cannot mask edited content, handlers, business scripts or sphere geometry', () => {
    for (const file of [...officialPages, 'css/home-orbit.css', 'js/home-orbit.js', 'js/app.js']) {
        const original = read(file), normalized = withoutThemeHooks(file, original);
        const changed = withoutThemeHooks(file, original + '\nUNAUTHORIZED_CHANGE');
        const hash = text => createHash('sha256').update(text).digest('hex');
        assert.notEqual(hash(changed), hash(normalized));
    }
    assert.equal(withoutThemeHooks('js/player.js', read('js/player.js')), read('js/player.js'));
    assert.equal(withoutThemeHooks('css/player.css', read('css/player.css')), read('css/player.css'));
});

test('Shared theme references defined tokens and retains semantic notification/warning colors', () => {
    const names = new Set([...tokens.matchAll(/(--[\w-]+)\s*:/g)].map(match => match[1]));
    for (const [, name] of theme.matchAll(/var\((--[\w-]+)\)/g)) assert.ok(names.has(name), name);
    for (const selector of ['#toast.bg-red-500', '#toast.bg-yellow-500', '.speed-indicator:is(.poor, .error)', '.speed-indicator.medium']) assert.ok(theme.includes(selector));
    assert.match(theme, /outline: 2px solid var\(--ui-focus\)/);
    assert.match(theme, /\.form-checkbox:checked::after \{ border-color: var\(--ui-accent-ink\)/);
    assert.match(theme, /\.art-video-player\.art-backdrop[\s\S]*background: var\(--ui-dialog\) !important/);
    assert.match(theme, /--art-widget-background: var\(--ui-dialog\)/);
    // Basic delimiter validation complements computed-style checks in Chrome.
    for (const source of [tokens, theme]) {
        const css = source.replace(/\/\*[\s\S]*?\*\//g, '');
        assert.equal((css.match(/\{/g) || []).length, (css.match(/\}/g) || []).length);
        assert.equal((css.match(/\(/g) || []).length, (css.match(/\)/g) || []).length);
    }
});
