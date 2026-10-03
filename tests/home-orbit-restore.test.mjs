// Pin the approved release by hashes so uploads and shallow clones can test it
// without the workstation's private Git history.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { withoutThemeHooks } from './helpers/ui-presentation-contract.mjs';

const root = new URL('../', import.meta.url);
const read = file => readFileSync(new URL(file, root), 'utf8');
const release = JSON.parse(read('tests/fixtures/release-75d0364.json'));
const toolbarUpdate = JSON.parse(read('tests/fixtures/toolbar-disclosure-update.json'));
const preferencesUpdate = JSON.parse(read('tests/fixtures/orbit-preferences-update.json'));

test('Approved release retains only the requested toolbar, theme hooks and preference persistence changes', () => {
    assert.equal(release.revision, '75d0364');
    assert.equal(toolbarUpdate.baseRevision, release.revision);
    assert.deepEqual(Object.keys(toolbarUpdate.hashes).sort(), ['css/home-orbit.css', 'index.html', 'js/home-orbit-toolbar.js']);
    assert.equal(preferencesUpdate.baseRevision, '4feb49e');
    assert.deepEqual(Object.keys(preferencesUpdate.hashes).sort(), ['index.html', 'js/home-orbit.js', 'orbit-test.html']);
    const files = Object.keys(release.hashes);
    for (const required of ['AGENTS.md', 'index.html', 'css/home-orbit.css', 'js/home-orbit.js',
        'orbit-test.html', 'js/home-orbit-toolbar.js']) assert.ok(files.includes(required));
    for (const file of files) {
        const hash = createHash('sha256').update(withoutThemeHooks(file, read(file))).digest('hex');
        assert.equal(hash, preferencesUpdate.hashes[file] || toolbarUpdate.hashes[file] || release.hashes[file], `Unexpected release change: ${file}`);
    }
    assert.equal(existsSync(new URL('tests/home-orbit-rollback.test.mjs', root)), false,
        'The obsolete selective-rollback test must not enforce the rejected page state');
});

test('Preference persistence leaves every formula and the entire animation/render loop byte-for-byte unchanged', () => {
    const code = read('js/home-orbit.js');
    const sections = {
        math: code.slice(0, code.indexOf('    function initializeOrbit()')),
        render: code.slice(code.indexOf('        function paint()'), code.indexOf('        function updateControls()'))
    };
    for (const [name, source] of Object.entries(sections)) {
        assert.equal(createHash('sha256').update(source).digest('hex'), preferencesUpdate.unchangedSections[name], name);
    }
});

test('The complete three-line homepage intro is removed, not hidden, and the search form is its first content block', () => {
    const html = read('index.html');
    assert.doesNotMatch(html, /THE CINEMA ORBIT|好故事，自有引力|在光影之间，发现下一部心动|home-intro|home-eyebrow|home-intro-caption/);
    assert.match(html, /id="searchArea"[^>]*>\s*<div class="w-full max-w-2xl home-search-wrap">/);
    assert.match(html, /<h1[^>]*>JAYFLIX<\/h1>/);
    assert.match(html, /Thought unchained, tech untamed\./);
    assert.ok(html.indexOf('id="searchArea"') < html.indexOf('id="doubanArea"'));
    assert.ok(html.indexOf('id="doubanArea"') < html.indexOf('id="recommendationOrbit"'));
});

test('Desktop and mobile whitespace above and below the search form shrink without replacing it with a spacer', () => {
    const css = read('css/home-orbit.css'), html = read('index.html');
    assert.match(css, /\.home-page #searchArea \{ flex: none; padding: 20px 0 16px; \}/);
    assert.match(css, /@media \(max-width: 600px\)[\s\S]*\.home-page #searchArea \{ padding: 16px 0 12px; \}/);
    assert.doesNotMatch(css, /padding: 40px 0 24px|padding: 29px 0 15px/);
    assert.doesNotMatch(html, /home-intro[^>]*(?:hidden|display|height)/);
    assert.match(html, /css\/home-orbit\.css\?v=20261003-18/);
    assert.match(read('orbit-test.html'), /css\/home-orbit\.css\?v=20261003-16/);
});
