// HTML/CSS contracts and event-model checks, not browser pixel measurements.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createOrbitHarness } from './helpers/orbit-event-harness.mjs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const rows = [...read('index.html').matchAll(/<div class="orbit-controls(?: [^"]+)?"[^>]*>([\s\S]*?)<\/div>/g)].map(match => match[1]);

test('All three homepage rows retain current percentages but remove trailing range labels', () => {
    assert.equal(rows.length, 3);
    assert.doesNotMatch(read('index.html'), /class="orbit-control-range"/);
    for (const [index, id, value] of [[0, 'orbitZoom', '200%'], [1, 'orbitCardScale', '70%'], [2, 'orbitSpeed', '50%']]) {
        assert.match(rows[index], new RegExp(`<span id="${id}" class="orbit-value"[^>]*>${value}<\\/span>`));
        const visible = rows[index].replace(/<[^>]*>/g, '');
        assert.equal([...visible.matchAll(/\d+%/g)].length, 1, 'Only the current percentage is visible');
    }
    assert.match(rows[0], /id="orbitPause"/);
    assert.match(rows[1], /id="orbitReset"/);
    assert.match(rows[2], /data-orbit-action="speed-in"[^>]*>\+<\/button>\s*$/);
});

test('Homepage controls use one shared content width with stretched rows, not an arbitrary pixel width', () => {
    const css = read('css/home-orbit.css');
    assert.match(css, /\.home-page #doubanArea \.orbit-control-stack \{ width: max-content; align-items: stretch; \}/);
    assert.match(css, /\.orbit-control-stack \{ display: flex; flex-direction: column; gap: 6px; flex-shrink: 0; \}/);
    assert.match(css, /@media \(max-width: 600px\)[\s\S]*\.orbit-control-stack \{ margin-left: auto; \}/);
    assert.doesNotMatch(css, /\.orbit-control-stack[^{}]*\{[^}]*width:\s*\d+(?:px|vw|%)/);
    assert.doesNotMatch(css, /\.orbit-(?:card|speed)-controls\s*\{[^}]*(?:align-self|width):/);
    assert.match(css, /\.orbit-controls button \{[^}]*min-width: 30px; height: 28px/);
    assert.match(css, /@media \(max-width: 600px\)[\s\S]*\.orbit-controls button \{ min-width: 24px; height: 25px/);
});

test('Normal homepage sizing is scoped away from diagnostic controls and both entries load fresh CSS', () => {
    const home = read('index.html'), diagnostic = read('orbit-test.html');
    assert.match(home, /id="doubanArea"/);
    assert.doesNotMatch(diagnostic, /id="doubanArea"/);
    assert.match(diagnostic, /<span class="orbit-control-range">50%–500%<\/span>/);
    for (const page of [home, diagnostic]) {
        assert.match(page, page === home ? /css\/home-orbit\.css\?v=20261003-18/ : /css\/home-orbit\.css\?v=20261003-16/);
        assert.match(page, /js\/home-orbit\.js\?v=20261003-15/);
    }
});

test('Mobile and desktop readouts, pause and combined reset still work with the same controller', () => {
    for (const viewportWidth of [320, 390, 600, 601, 1440]) {
        const h = createOrbitHarness({ viewportWidth, reducedMotion: true });
        const mobile = viewportWidth <= 600, zoom = mobile ? '150%' : '200%', cover = mobile ? '150%' : '70%';
        assert.equal(h.zoomValue.textContent, zoom);
        assert.equal(h.cardValue.textContent, cover);
        assert.equal(h.speedValue.textContent, '50%');
        h.actions['zoom-in'].click(); h.actions['card-size-in'].click(); h.actions['speed-in'].click();
        assert.equal(h.speedValue.textContent, '60%');
        h.actions.pause.click();
        assert.equal(h.actions.pause.getAttribute('aria-pressed'), 'false');
        h.actions.pause.click();
        assert.equal(h.actions.pause.getAttribute('aria-pressed'), 'true');
        h.actions.reset.click();
        assert.equal(h.zoomValue.textContent, zoom);
        assert.equal(h.cardValue.textContent, cover);
        assert.equal(h.speedValue.textContent, '50%');
        assert.equal(h.actions.pause.getAttribute('aria-pressed'), 'true', 'Reset does not unpause');
    }
});
