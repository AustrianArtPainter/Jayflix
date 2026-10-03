// CSS contracts/free-space arithmetic, not browser font or pixel measurements.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const css = read('css/home-orbit.css'), html = read('index.html');
const tagRules = [...css.matchAll(/\.home-page #douban-tags\s*\{([^}]*)\}/g)];
const declarations = Object.fromEntries(tagRules[0][1].split(';').filter(value => value.trim())
    .map(value => value.split(':').map(part => part.trim())));

test('The same homepage-only rule centers category tags at all mobile and desktop breakpoints', () => {
    assert.equal(tagRules.length, 1, 'No mobile override may revert the tags to left alignment');
    assert.deepEqual(declarations, { width: 'max-content', 'min-width': '100%', 'justify-content': 'center', gap: '7px' });
    assert.match(html, /<div class="overflow-x-auto pb-2 home-tags-viewport">\s*<div id="douban-tags" class="flex space-x-2 min-w-max"><\/div>/);
    assert.match(css, /\.home-page #douban-tags > button \{ flex: none;[^}]*margin-left: 0 !important/);
    assert.doesNotMatch(tagRules[0][1], /position:|transform:|flex-wrap:|width:\s*\d+px/);
});

test('Centering has equal side margins when tags fit and never makes either overflow end unreachable', () => {
    const gap = parseFloat(declarations.gap);
    // Arbitrary intrinsic button widths cover short/custom labels and changed
    // counts. They are inputs to the declared flex sizing, not measured fonts.
    for (const available of [240, 284, 354, 545, 564, 712, 1024, 1344, 1384]) {
        for (const count of [0, 1, 2, 8, 17, 30]) {
            const buttonWidths = Array.from({ length: count }, (_, index) => 44 + (index % 5) * 17);
            const content = buttonWidths.reduce((sum, value) => sum + value, 0) + Math.max(0, count - 1) * gap;
            const row = Math.max(content, available); // max-content width, 100% minimum
            const left = (row - content) / 2; // justify-content: center
            assert.ok(left >= 0, 'Centering must never create negative leading overflow');
            if (content <= available) {
                assert.equal(left, available - (left + content));
                assert.equal(left + content / 2, available / 2);
            } else {
                assert.equal(left, 0, 'The first button starts inside the scroll area');
                const maximumScroll = row - available;
                assert.equal(left + content - maximumScroll, available, 'The last button is reachable by scrolling');
            }
        }
    }
});

test('Tag scrolling, selection/management behavior and diagnostic layout remain unchanged', () => {
    const fixture = JSON.parse(read('tests/fixtures/home-contract.json'));
    assert.equal(createHash('sha256').update(read('js/douban.js')).digest('hex'), fixture.hashes['js/douban.js']);
    assert.match(css, /\.home-tags-viewport \{[^}]*scrollbar-width: thin;[^}]*border-bottom: 1px solid var\(--home-line\)/);
    assert.doesNotMatch(read('orbit-test.html'), /id="douban-tags"/);
    assert.match(html, /id="orbitToolbar" data-collapsed="true"/);
    for (const page of [html, read('orbit-test.html')]) assert.match(page, /css\/home-orbit\.css\?v=20261003-16/);
});
