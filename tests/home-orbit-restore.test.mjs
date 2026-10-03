// Pin the approved release by hashes so uploads and shallow clones can test it
// without the workstation's private Git history.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
const read = file => readFileSync(new URL(file, root), 'utf8');
const release = JSON.parse(read('tests/fixtures/release-75d0364.json'));

test('All approved release 75d0364 runtime files remain byte-for-byte unchanged', () => {
    assert.equal(release.revision, '75d0364');
    const files = Object.keys(release.hashes);
    for (const required of ['AGENTS.md', 'index.html', 'css/home-orbit.css', 'js/home-orbit.js',
        'orbit-test.html', 'js/home-orbit-toolbar.js']) assert.ok(files.includes(required));
    for (const file of files) {
        const hash = createHash('sha256').update(readFileSync(new URL(file, root))).digest('hex');
        assert.equal(hash, release.hashes[file], `Unexpected release change: ${file}`);
    }
    assert.equal(existsSync(new URL('tests/home-orbit-rollback.test.mjs', root)), false,
        'The obsolete selective-rollback test must not enforce the rejected page state');
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
    assert.match(html, /css\/home-orbit\.css\?v=20261003-16/);
    assert.match(read('orbit-test.html'), /css\/home-orbit\.css\?v=20261003-16/);
});
