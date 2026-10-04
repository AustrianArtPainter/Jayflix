import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { officialPages, withoutThemeHooks } from './helpers/ui-presentation-contract.mjs';

const root = new URL('../', import.meta.url);
const read = file => readFileSync(new URL(file, root), 'utf8');
const source = read('js/ui-palette.js'), css = read('css/ui-palette.css');
const pure = { module: { exports: {} } };
vm.runInNewContext(source, pure);
const api = pure.module.exports;
const copy = value => JSON.parse(JSON.stringify(value));
const changed = { background: '#121522', module: '#24253d', accent: '#e6a95c', text: '#ffeedd' };

function harness({ saved, blocked = false, full = false, controls = true, loading = false } = {}) {
    class Target {
        constructor(id = '') { this.id = id; this.attrs = new Map(); this.listeners = new Map(); this.hidden = true; this.value = ''; }
        addEventListener(type, callback) { const list = this.listeners.get(type) || []; list.push(callback); this.listeners.set(type, list); }
        emit(type, extra = {}) { const event = { type, target: this, preventDefault() { this.prevented = true; }, ...extra }; for (const fn of this.listeners.get(type) || []) fn(event); return event; }
        setAttribute(name, value) { this.attrs.set(name, String(value)); }
        removeAttribute(name) { this.attrs.delete(name); }
        getAttribute(name) { return this.attrs.get(name) ?? null; }
        contains(target) { return target === this || (this.id === 'palettePanel' && target.id?.startsWith('palette-')); }
        focus() { document.activeElement = this; }
    }
    const document = new Target(), ids = new Map(), properties = new Map(), timers = new Map(), records = new Map();
    let writes = 0, timerId = 0, ready = !loading;
    document.readyState = loading ? 'loading' : 'complete';
    document.hidden = false;
    document.documentElement = new Target('html');
    document.documentElement.style = { setProperty: (name, value) => properties.set(name, value), removeProperty: name => properties.delete(name) };
    document.getElementById = id => ready ? ids.get(id) || null : null;
    if (controls) for (const id of ['paletteToggle', 'palettePanel', 'paletteClose', 'paletteReset', ...api.GROUPS.map(group => 'palette-' + group)]) ids.set(id, new Target(id));
    if (saved !== undefined) records.set(api.STORAGE_KEY, saved);
    const storage = { getItem: key => records.get(key) ?? null, setItem: (key, value) => { if (full) throw new Error('QuotaExceededError'); records.set(key, value); writes++; } };
    const window = new Target();
    window.document = document;
    Object.defineProperty(window, 'localStorage', { get() { if (blocked) throw new Error('SecurityError'); return storage; } });
    window.setTimeout = callback => { const id = ++timerId; timers.set(id, callback); return id; };
    window.clearTimeout = id => timers.delete(id);
    vm.runInNewContext(source, { window });
    return { document, window, ids, properties, timers, records, storage, get writes() { return writes; },
        ready() { ready = true; document.emit('DOMContentLoaded'); },
        input(group, colour) { const input = ids.get('palette-' + group); input.value = colour; input.emit('input'); },
        flush() { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } },
        saved() { return JSON.parse(records.get(api.STORAGE_KEY)); } };
}

test('Exactly four coarse groups match the approved palette, with no extra controls for derivatives', () => {
    assert.deepEqual(copy(api.GROUPS), ['background', 'module', 'accent', 'text']);
    assert.deepEqual(copy(api.DEFAULTS), { background: '#080d11', module: '#111e16', accent: '#a2e2ce', text: '#edf2ee' });
    const html = read('index.html');
    assert.equal([...html.matchAll(/type="color"/g)].length, 4);
    assert.equal([...html.matchAll(/id="paletteReset"/g)].length, 1);
    assert.match(html, /aria-label="强调颜色，包含进度条"/);
    assert.match(html, /home-tool home-palette-tool/);
    assert.match(html, /stroke="currentColor" viewBox="0 0 24 24"/);
    assert.ok(html.indexOf('id="paletteToggle"') < html.indexOf('aria-label="观看历史"'));
    assert.match(html, /id="palettePanel"[^>]*role="dialog"[^>]*hidden/);
});

test('All production entries restore colours before body paint; the diagnostic page remains excluded', () => {
    for (const page of officialPages) {
        const html = read(page);
        for (const asset of ['css/ui-palette.css?v=20261003-1', 'js/ui-palette.js?v=20261003-1']) {
            assert.equal(html.split(asset).length, 2, page);
            assert.ok(html.indexOf(asset) < html.indexOf('</head>'));
        }
        assert.ok(html.indexOf('css/ui-palette.css') > html.indexOf('css/ui-theme.css'));
        if (page !== 'index.html') assert.doesNotMatch(html, /paletteToggle|palettePanel/);
    }
    assert.doesNotMatch(read('orbit-test.html'), /ui-palette|paletteToggle/);
});

test('Uncustomized startup neither writes defaults nor activates any colour override', () => {
    const h = harness();
    assert.equal(h.writes, 0);
    assert.equal(h.properties.size, 0);
    assert.equal(h.document.documentElement.getAttribute('data-ui-palette'), null);
    for (const group of api.GROUPS) assert.equal(h.ids.get('palette-' + group).value, api.DEFAULTS[group]);
    assert.equal(h.ids.get('palettePanel').hidden, true);
});

test('Persisted groups are applied in head and their inputs receive values at DOM ready', () => {
    const h = harness({ saved: JSON.stringify({ version: 1, colors: changed }), loading: true });
    assert.equal(h.properties.get('--home-ink'), changed.background);
    assert.equal(h.properties.get('--home-accent'), changed.accent);
    assert.equal(h.document.documentElement.getAttribute('data-ui-palette'), 'custom');
    assert.equal(h.writes, 0);
    h.ready();
    for (const group of api.GROUPS) assert.equal(h.ids.get('palette-' + group).value, changed[group]);
});

test('Malformed versions, data types, CSS injection and invalid fields safely fall back without rewriting storage', () => {
    for (const saved of ['bad json', 'null', '[]', '{"version":2,"colors":{"accent":"#ff0000"}}']) {
        const h = harness({ saved });
        assert.equal(h.properties.size, 0);
        assert.equal(h.writes, 0);
    }
    assert.deepEqual(copy(api.normalize({ background: '#12AB34', module: 'url(https://evil.test)', accent: '#fff', text: 123 })),
        { ...copy(api.DEFAULTS), background: '#12ab34' });
    const h = harness();
    h.input('accent', '#fff; background: red');
    assert.equal(h.properties.size, 0);
    assert.equal(h.timers.size, 0);
});

test('Native colour input previews instantly and debounces storage writes rather than saving every sample', () => {
    const h = harness();
    for (let i = 0; i < 40; i++) h.input('accent', '#' + i.toString(16).padStart(6, '0'));
    assert.equal(h.properties.get('--home-accent'), '#000027');
    assert.equal(h.timers.size, 1);
    assert.equal(h.writes, 0);
    h.flush();
    assert.equal(h.writes, 1);
    assert.equal(h.saved().colors.accent, '#000027');
    assert.equal(h.records.size, 1, 'No history, orbit or API keys are touched');
});

test('Commit, pagehide and hidden-tab events flush changes; a new controller restores all four groups', () => {
    for (const flush of [h => h.ids.get('palette-text').emit('change'), h => h.window.emit('pagehide'), h => { h.document.hidden = true; h.document.emit('visibilitychange'); }]) {
        const h = harness();
        for (const group of api.GROUPS) h.input(group, changed[group]);
        flush(h);
        assert.equal(h.writes, 1);
        assert.equal(h.timers.size, 0);
        assert.deepEqual(h.saved().colors, changed);
        const next = harness({ saved: h.records.get(api.STORAGE_KEY) });
        for (const group of api.GROUPS) assert.equal(next.ids.get('palette-' + group).value, changed[group]);
    }
});

test('Restore default removes every owned override, saves defaults and never touches sphere settings', () => {
    const h = harness({ saved: JSON.stringify({ version: 1, colors: changed }) });
    h.input('accent', '#ff0000');
    h.ids.get('paletteReset').emit('click');
    assert.equal(h.properties.size, 0);
    assert.equal(h.document.documentElement.getAttribute('data-ui-palette'), null);
    assert.deepEqual(h.saved().colors, copy(api.DEFAULTS));
    assert.equal(h.timers.size, 0);
    assert.equal(h.records.size, 1);
    const next = harness({ saved: h.records.get(api.STORAGE_KEY) });
    assert.equal(next.properties.size, 0);
});

test('Blocked or full storage cannot break colour previews, reset or disclosure', () => {
    for (const options of [{ blocked: true }, { full: true }]) {
        const h = harness(options);
        h.input('accent', changed.accent);
        h.flush();
        assert.equal(h.properties.get('--home-accent'), changed.accent);
        h.ids.get('paletteToggle').emit('click');
        assert.equal(h.ids.get('palettePanel').hidden, false);
        h.ids.get('paletteReset').emit('click');
        assert.equal(h.properties.size, 0);
    }
});

test('Same-origin tab updates and clears synchronize without echo writes; unrelated storage events are ignored', () => {
    const h = harness();
    h.records.set(api.STORAGE_KEY, JSON.stringify({ version: 1, colors: changed }));
    h.window.emit('storage', { key: 'searchHistory', storageArea: h.storage });
    assert.equal(h.properties.size, 0);
    h.window.emit('storage', { key: api.STORAGE_KEY, storageArea: {} });
    assert.equal(h.properties.size, 0);
    h.window.emit('storage', { key: api.STORAGE_KEY, storageArea: h.storage });
    assert.equal(h.properties.get('--home-accent'), changed.accent);
    assert.equal(h.writes, 0);
    h.records.delete(api.STORAGE_KEY);
    h.window.emit('storage', { key: null, storageArea: h.storage });
    assert.equal(h.properties.size, 0);
});

test('Popover supports native button activation, Escape, close and outside click without blocking page interaction', () => {
    const h = harness(), toggle = h.ids.get('paletteToggle'), panel = h.ids.get('palettePanel');
    toggle.emit('click');
    assert.equal(panel.hidden, false);
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    h.document.emit('pointerdown', { target: h.ids.get('palette-accent') });
    assert.equal(panel.hidden, false);
    const outside = h.document.emit('pointerdown', { target: {} });
    assert.equal(panel.hidden, true);
    assert.equal(outside.prevented, undefined);
    toggle.emit('click');
    h.document.emit('keydown', { key: 'Escape' });
    assert.equal(panel.hidden, true);
    assert.equal(h.document.activeElement, toggle);
    toggle.emit('click');
    h.ids.get('paletteClose').emit('click');
    assert.equal(panel.hidden, true);
});

test('Derived shades preserve defaults, stay valid at extreme colours and retain contrasting accent text', () => {
    const original = api.buildVariables(api.DEFAULTS);
    assert.equal(original['--ui-panel'], '#0e1812');
    assert.equal(original['--ui-accent-ink'], '#0b2118');
    for (const background of ['#000000', '#ffffff']) for (const module of ['#000000', '#ffffff', '#ff0000'])
        for (const accent of ['#000000', '#ffffff', '#ff0000', '#0000ff']) for (const text of ['#000000', '#ffffff']) {
            const colours = { background, module, accent, text }, variables = api.buildVariables(colours);
            assert.equal(variables['--home-ink'], background);
            assert.equal(variables['--home-accent'], accent);
            assert.equal(variables['--home-white'], text);
            for (const colour of Object.values(variables)) assert.match(colour, /^(?:#[\da-f]{6}|rgba\(\d+, \d+, \d+, 0\.\d+\))$/);
            assert.ok(['#000000', '#ffffff'].includes(variables['--ui-accent-ink']));
        }
    assert.equal(api.buildVariables({ accent: '#000000' })['--ui-accent-ink'], '#ffffff');
    assert.equal(api.buildVariables({ accent: '#ffffff' })['--ui-accent-ink'], '#000000');
});

test('Played, buffered, hover and history progress colours all follow the accent family', () => {
    for (const selector of ['.art-progress-played', '.art-progress-loaded', '.art-progress-hover', '.art-progress-indicator', '.history-progress .progress-filled']) assert.ok(css.includes(selector));
    assert.match(css, /\.art-progress-played \{ background: var\(--home-accent\) !important;/);
    assert.match(css, /--art-loaded-color: var\(--palette-accent-loaded\)/);
    assert.match(css, /--art-highlight-color: var\(--palette-accent-loaded\)/);
    assert.doesNotMatch(css, /--art-font-color:\s*var\(/);
    assert.match(read('css/ui-theme.css'), /--art-font-color: #fff !important/);
    const first = api.buildVariables({ accent: '#e6a95c' }), second = api.buildVariables({ accent: '#5c9ee6' });
    for (const name of ['--home-accent', '--palette-accent-track', '--palette-accent-loaded', '--palette-accent-hover']) assert.notEqual(first[name], second[name]);
});

test('About-page primary links retain contrasting accent ink instead of inheriting the chosen normal text colour', () => {
    assert.match(css, /\.jayflix-ui\.about-page main \.text-white:not\(a\)/);
    assert.doesNotMatch(css, /:is\(\.player-container, \.about-page main\) \.text-white/);
    assert.match(read('css/ui-theme.css'), /\.jayflix-ui\.about-page main a\[href="https:\/\/github\.com\/AustrianArtPainter\/Jayflix"\][\s\S]*?color: var\(--ui-accent-ink\);/);
});

test('Only the new header entry and popover alter layout; custom-colour bindings contain no geometry, filtering or opacity', () => {
    assert.match(css, /@media \(max-width: 600px\)[\s\S]*right: 110px/);
    assert.match(read('css/home-orbit.css'), /\.home-tool span \{ display: none; \}/);
    const bindings = css.slice(css.indexOf('html[data-ui-palette]')).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(bindings, /\b(?:transform|filter|opacity|display|position|perspective|touch-action|width|height|margin|padding|overflow|z-index)\s*:/);
    assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|requestAnimationFrame|MutationObserver|setInterval|location\.|home-orbit|player\.|searchHistory|viewingHistory|\.innerHTML/);
    assert.doesNotMatch(css, /--ui-danger\s*:|--ui-warning\s*:|\bimg\s*\{|\bvideo\s*\{/);
    const variables = api.buildVariables(changed);
    assert.equal(variables['--ui-danger'], undefined);
    assert.equal(variables['--ui-warning'], undefined);
});

test('New palette hooks strip precisely while original source files and business behavior stay pinned', () => {
    for (const page of officialPages) {
        const html = read(page), stripped = withoutThemeHooks(page, html);
        assert.doesNotMatch(stripped, /ui-palette|paletteToggle|palettePanel/);
        assert.match(withoutThemeHooks(page, html + '\nUNAUTHORIZED_CHANGE'), /UNAUTHORIZED_CHANGE$/);
    }
    const hashes = {
        'css/home-orbit.css': '125d14cdd6042764fd3ea5e231d802c195be91bd8702b0d6ea49774bd07c2e3f',
        'css/ui-theme.css': '81cac2994b942b0b9a6848276614170d0638700f032be84686bc5d6f5928f43e',
        'css/ui-tokens.css': 'ce6154fbc5b78f38575ba5e1973bf46786feacf11f98050c7fc452769a3e5f03',
        'js/home-orbit.js': '50194ceb8b526325918af1acff9e2dc06d4e0084a826e0dad14ea14394ec6d4f',
    };
    for (const [file, expected] of Object.entries(hashes)) assert.equal(createHash('sha256').update(read(file)).digest('hex'), expected, file);
});

test('README describes four-group, local-only theme settings and includes progress colour coverage', () => {
    assert.match(read('README.md'), /背景、模块、强调、文字四组调色/);
    assert.match(read('README.md'), /播放器操作区固定白色图标／文字与深色背景，不参与调色，进度条仍随强调色联动/);
    assert.match(read('README.md'), /全站共用、浏览器本地保存，支持恢复默认/);
});
