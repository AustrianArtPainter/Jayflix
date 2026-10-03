// Viewport and event-model checks, not a browser screenshot/FPS measurement.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createOrbitHarness } from './helpers/orbit-event-harness.mjs';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const dimensions = h => ['--orbit-card-width', '--orbit-card-height', '--orbit-footer-height']
    .map(name => parseFloat(h.scene.style.getPropertyValue(name)));
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const assertScales = (h, zoom, cover) => {
    near(Number(h.scene.dataset.zoom), zoom);
    near(Number(h.scene.dataset.cardScale), cover);
    assert.equal(h.zoomValue.textContent, `${Math.round(zoom * 100)}%`);
    assert.equal(h.cardValue.textContent, `${Math.round(cover * 100)}%`);
    assert.equal(h.camera.style.transform, `scale3d(${h.scene.dataset.zoom}, ${h.scene.dataset.zoom}, ${h.scene.dataset.zoom})`);
};

test('Mobile defaults are 150% / 150%, desktop defaults 200% / 70%, including the exact 600/601px boundary', () => {
    for (const viewportWidth of [320, 390, 600, 601, 1024, 1440, 2560]) {
        const mobile = viewportWidth <= 600, zoom = mobile ? 1.5 : 2, cover = mobile ? 1.5 : .7;
        const h = createOrbitHarness({ viewportWidth, reducedMotion: true });
        assertScales(h, zoom, cover);
        const layout = h.math.computeLayout(h.scene.clientWidth, h.scene.clientHeight, h.math.createSlots(16));
        dimensions(h).forEach((value, index) => near(value, [layout.cardWidth, layout.cardHeight, layout.footerHeight][index] * cover));
        assert.equal(h.actions.reset.textContent, '重置');
        assert.match(h.actions.reset.getAttribute('aria-label'), new RegExp(`球体至${zoom * 100}%、封面至${cover * 100}%`));
        assert.equal(h.actions.reset.getAttribute('title'), h.actions.reset.getAttribute('aria-label'));
        assert.equal(h.actions['card-size-reset'], undefined);
    }
});

test('One reset restores both proportions at either range extreme, never 100%, without resetting rotation or pause', () => {
    for (const viewportWidth of [390, 1440]) for (const extreme of ['in', 'out']) {
        const h = createOrbitHarness({ viewportWidth, reducedMotion: true });
        h.pointer('pointerdown', 0, 0); h.pointer('pointermove', 30, 40); h.frame(0); h.pointer('pointerup', 30, 40);
        const pose = h.wireframe.style.transform, paused = h.actions.pause.getAttribute('aria-pressed');
        for (let step = 0; step < 60; step++) {
            h.actions[`zoom-${extreme}`].click(); h.actions[`card-size-${extreme}`].click();
        }
        h.actions.reset.click();
        assertScales(h, viewportWidth <= 600 ? 1.5 : 2, viewportWidth <= 600 ? 1.5 : .7);
        assert.equal(h.wireframe.style.transform, pose);
        assert.equal(h.actions.pause.getAttribute('aria-pressed'), paused);
        for (const action of ['zoom-out', 'zoom-in', 'card-size-out', 'card-size-in']) assert.equal(h.actions[action].disabled, false);
    }
});

test('Viewport switching does not overwrite manual proportions; reset and its accessible target use the CURRENT viewport', () => {
    const h = createOrbitHarness({ reducedMotion: true });
    h.actions['zoom-in'].click(); h.actions['card-size-in'].click();
    assertScales(h, 2.1, .8);
    h.viewport(600); assertScales(h, 2.1, .8);
    assert.match(h.actions.reset.getAttribute('aria-label'), /球体至150%、封面至150%/);
    h.actions.reset.click(); assertScales(h, 1.5, 1.5);
    h.viewport(601); assertScales(h, 1.5, 1.5);
    assert.match(h.actions.reset.getAttribute('aria-label'), /球体至200%、封面至70%/);
    h.actions.reset.click(); assertScales(h, 2, .7);
});

test('Empty or delayed recommendations and resize retain the viewport defaults and later manual settings', () => {
    for (const viewportWidth of [390, 1440]) {
        const mobile = viewportWidth <= 600, h = createOrbitHarness({ viewportWidth, count: 0, reducedMotion: true });
        assertScales(h, mobile ? 1.5 : 2, mobile ? 1.5 : .7);
        h.actions['zoom-in'].click(); h.actions['card-size-in'].click();
        const zoom = mobile ? 1.6 : 2.1, cover = mobile ? 1.6 : .8;
        const card = h.document.createElement('div');
        card.append(h.document.createElement('img'), h.document.createElement('button'));
        h.container.appendChild(card); h.observers.mutation();
        h.scene.clientWidth = 500; h.observers.resize();
        assertScales(h, zoom, cover);
        assert.equal(h.container.childElementCount, 1);
        const layout = h.math.computeLayout(500, 700, h.math.createSlots(1));
        near(dimensions(h)[0], layout.cardWidth * cover);
    }
});

test('Percentages are read-only, never reset actions; repeated reset keeps exactly one animation chain', () => {
    const h = createOrbitHarness(), count = h.controls.querySelectorAll('*').length;
    h.actions['zoom-in'].click(); h.actions['card-size-in'].click();
    h.zoomValue.click(); h.cardValue.click(); assertScales(h, 2.1, .8);
    for (let step = 0; step < 200; step++) h.actions.reset.click();
    assertScales(h, 2, .7);
    assert.equal(h.frameCount, 1);
    assert.equal(h.controls.querySelectorAll('*').length, count);
    assert.equal(h.zoomValue.getAttribute('data-orbit-action'), null);
    assert.equal(h.cardValue.getAttribute('data-orbit-action'), null);
});

test('Fixed reference, capacity and legacy diagnostic presets are unchanged on either viewport', () => {
    for (const viewportWidth of [390, 1440]) for (const [orbitTest, zoom, cover] of [
        ['212-reference', 2, .5], ['212-current', 1, 1], ['capacity-reference', 5, .5]
    ]) {
        const h = createOrbitHarness({ viewportWidth, count: 0, sceneData: { orbitTest } });
        near(Number(h.scene.dataset.zoom), zoom); near(Number(h.scene.dataset.cardScale), cover);
        assert.equal(h.mobileMedia.listeners.get('change'), undefined);
        assert.equal(h.document.getElementById('orbitReset'), null);
    }
});

test('Homepage has exactly one named combined reset and two noninteractive percentage readouts with responsive spacing', () => {
    const html = read('index.html'), css = read('css/home-orbit.css');
    assert.match(html, /<span id="orbitZoom" class="orbit-value"[^>]*>200%<\/span>/);
    assert.match(html, /<span id="orbitCardScale" class="orbit-value"[^>]*>70%<\/span>/);
    assert.equal([...html.matchAll(/data-orbit-action="reset"/g)].length, 1);
    assert.match(html, /<button type="button" data-orbit-action="reset" id="orbitReset"[^>]*>重置<\/button>/);
    assert.doesNotMatch(html, /card-size-reset|重置(?:球体缩放|封面尺寸)至100%/);
    assert.match(css, /\.orbit-controls \.orbit-value \{[^}]*height: 28px/);
    assert.match(css, /@media \(max-width: 600px\)[\s\S]*\.orbit-controls \.orbit-value \{ height: 25px/);
    assert.match(read('js/home-orbit.js'), /matchMedia\('\(max-width: 600px\)'\)/);
    for (const page of [html, read('orbit-test.html')]) {
        assert.match(page, /home-orbit\.js\?v=20261003-14/);
        assert.match(page, page === html ? /home-orbit\.css\?v=20261003-18/ : /home-orbit\.css\?v=20261003-16/);
    }
});
