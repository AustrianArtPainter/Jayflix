// Deterministic speed, gesture and scheduler regressions, not browser FPS claims.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createOrbitHarness } from './helpers/orbit-event-harness.mjs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const near = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const pose = h => h.wireframe.style.transform.slice(9, -1).split(',').map(Number);
const same = (a, b) => a.forEach((value, index) => near(value, b[index]));
const inverse = matrix => matrix.map((_, index) => matrix[(index % 4) * 4 + Math.floor(index / 4)]);
const multiply = (a, b) => Array.from({ length: 16 }, (_, index) => [0, 1, 2, 3]
    .reduce((sum, k) => sum + a[k * 4 + index % 4] * b[Math.floor(index / 4) * 4 + k], 0));
const setPercent = (h, percent) => {
    const delta = percent - Number(h.scene.dataset.speedPercent);
    assert.equal(Math.abs(delta) % 10, 0);
    for (let step = 0; step < Math.abs(delta) / 10; step++) h.actions[delta > 0 ? 'speed-in' : 'speed-out'].click();
    assert.equal(Number(h.scene.dataset.speedPercent), percent);
};
const initial = h => h.math.rotateOrientation([1, 0, 0, 0], [0, -.2, 0]);

test('The original .075 rad/s is exactly 50%; speed mapping is linear, finite, clamped and 100% doubles it', () => {
    const h = createOrbitHarness({ count: 0 });
    assert.equal(h.math.AUTO_SPEED, .075);
    assert.equal(h.math.DEFAULT_SPEED_PERCENT, 50);
    assert.equal(h.math.MIN_SPEED_PERCENT, 0); assert.equal(h.math.MAX_SPEED_PERCENT, 100);
    for (let percent = 0; percent <= 100; percent++) near(h.math.autoSpeedFromPercent(percent), .0015 * percent);
    for (const value of [-5, -Infinity, 150, Infinity, NaN, undefined]) {
        const expected = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) * .0015 : .075;
        near(h.math.autoSpeedFromPercent(value), expected);
    }
    near(h.math.autoSpeedFromPercent(50) * 180 / Math.PI, 4.297183463481174);
    near(2 * Math.PI / h.math.autoSpeedFromPercent(50), 83.77580409572782);
});

test('Mobile and desktop start at 50%, controls change 10 percentage points and both ends clamp with disabled buttons', () => {
    for (const viewportWidth of [390, 1440]) {
        const h = createOrbitHarness({ viewportWidth, reducedMotion: true });
        assert.equal(h.speedValue.textContent, '50%');
        assert.match(h.speedValue.getAttribute('aria-label'), /当前自动旋转转速 50%/);
        const zoom = h.scene.dataset.zoom, cover = h.scene.dataset.cardScale;
        setPercent(h, 0); assert.equal(h.actions['speed-out'].disabled, true);
        h.actions['speed-out'].dispatch('click'); assert.equal(h.scene.dataset.speedPercent, '0');
        setPercent(h, 100); assert.equal(h.actions['speed-in'].disabled, true);
        h.actions['speed-in'].dispatch('click'); assert.equal(h.scene.dataset.speedPercent, '100');
        assert.equal(h.speedValue.textContent, '100%');
        assert.equal(h.scene.dataset.zoom, zoom); assert.equal(h.scene.dataset.cardScale, cover);
        h.speedValue.click(); assert.equal(h.scene.dataset.speedPercent, '100');
    }
});

test('Steady angular motion matches the selected physical speed, zero idles, and restarting has no elapsed-time jump', () => {
    const h = createOrbitHarness();
    for (const percent of [50, 100, 20, 0, 60]) {
        setPercent(h, percent);
        const before = pose(h);
        h.frame(0); same(pose(h), before);
        h.frame(100);
        const angle = Math.atan2(pose(h)[8], pose(h)[0]) - Math.atan2(before[8], before[0]);
        near(angle, percent * .0015 * .1);
        assert.equal(h.frameCount, percent === 0 ? 0 : 1);
        if (!percent) { h.wait(60000); h.frame(0); same(pose(h), before); }
    }
});

test('At zero, manual dragging and original actions work; inertia decays to a real stop and the last direction survives restart', () => {
    const h = createOrbitHarness(); setPercent(h, 0); h.frame(0);
    const before = pose(h);
    const target = h.cards[0].querySelector('img');
    h.pointer('pointerdown', 0, 0, { target }); h.pointer('pointermove', 40, 60, { target }); h.frame(0);
    assert.notDeepEqual(pose(h), before);
    h.pointer('pointerup', 40, 60, { target });
    const release = pose(h); h.frame(0); h.frame(16);
    assert.notDeepEqual(pose(h), release);
    for (let frame = 0; frame < 600; frame++) h.frame(16);
    assert.equal(h.frameCount, 0, 'No infinite animation chain for a decaying zero-speed tail');
    const stopped = pose(h); h.frame(1000); same(pose(h), stopped);
    h.wait(500); h.cards[0].querySelector('button').click(); assert.equal(h.actionCount, 1);
    setPercent(h, 50); h.frame(0); h.frame(100);
    const relative = multiply(pose(h), inverse(stopped));
    const axis = [-3 / Math.sqrt(13), 2 / Math.sqrt(13), 0];
    same(relative, Array.from(h.math.orientationMatrix(h.math.rotateOrientation([1, 0, 0, 0], axis.map(value => value * .075 * .1)))));
});

test('Changing speed during release preserves gesture velocity and the original exponential damping, with only its target changing', () => {
    const h = createOrbitHarness();
    h.pointer('pointerdown', 0, 0); h.pointer('pointermove', 40, 60); h.frame(0); h.pointer('pointerup', 40, 60);
    setPercent(h, 30); h.frame(0);
    const orientation = h.math.rotateOrientation(initial(h), h.math.gestureVector(40, 60));
    const velocity = Array.from(h.math.velocityFromGesture(40, 60, .016)).map(value => value * .65);
    const target = velocity.map(value => value * .045 / Math.hypot(...velocity));
    const expected = h.math.advanceOrientation(orientation, velocity, target, .1);
    h.frame(100); same(pose(h), Array.from(h.math.orientationMatrix(expected.orientation)));
    setPercent(h, 0); h.frame(0);
    const next = h.math.advanceOrientation(expected.orientation, expected.velocity, [0, 0, 0], .1);
    h.frame(100); same(pose(h), Array.from(h.math.orientationMatrix(next.orientation)));
});

test('The same single reset restores BOTH viewport scales and 50% speed without overriding pause or orientation', () => {
    for (const viewportWidth of [390, 1440]) {
        const h = createOrbitHarness({ viewportWidth, reducedMotion: true });
        h.actions['zoom-out'].click(); h.actions['card-size-in'].click(); setPercent(h, 100);
        h.pointer('pointerdown', 0, 0); h.pointer('pointermove', 20, -40); h.frame(0); h.pointer('pointerup', 20, -40);
        const before = pose(h), paused = h.actions.pause.getAttribute('aria-pressed');
        h.actions.reset.click();
        near(Number(h.scene.dataset.zoom), viewportWidth <= 600 ? 1.5 : 2);
        near(Number(h.scene.dataset.cardScale), viewportWidth <= 600 ? 1.5 : .7);
        assert.equal(h.speedValue.textContent, '50%'); assert.equal(h.scene.dataset.speedPercent, '50');
        assert.match(h.actions.reset.getAttribute('aria-label'), /转速至50%/);
        assert.equal(h.actions.pause.getAttribute('aria-pressed'), paused); same(pose(h), before);
        assert.equal(h.actions['speed-in'].disabled, false); assert.equal(h.actions['speed-out'].disabled, false);
    }
});

test('Pause, hidden/offscreen states and reduced motion remain independent of speed settings and zero does not undo them', () => {
    const h = createOrbitHarness({ reducedMotion: true }), before = pose(h);
    setPercent(h, 100); h.frame(100); same(pose(h), before); assert.equal(h.frameCount, 0);
    h.actions.reset.click(); assert.equal(h.actions.pause.getAttribute('aria-pressed'), 'true');
    h.actions.pause.click(); h.frame(0); h.frame(100); assert.notDeepEqual(pose(h), before);
    h.document.hidden = true; h.document.dispatch('visibilitychange'); setPercent(h, 80); h.frame(100);
    assert.equal(h.frameCount, 0);
    h.document.hidden = false; h.document.dispatch('visibilitychange'); h.frame(0); assert.equal(h.frameCount, 1);
    h.observers.intersection([{ isIntersecting: false }]); setPercent(h, 0); h.frame(100); assert.equal(h.frameCount, 0);
    h.observers.intersection([{ isIntersecting: true }]); assert.equal(h.frameCount, 0);
});

test('Zero and nonzero speeds survive delayed cards, resize and viewport changes; adjusting controls adds no nodes or extra frame chains', () => {
    const h = createOrbitHarness({ count: 0 }); setPercent(h, 80);
    const count = h.controls.querySelectorAll('*').length;
    h.viewport(390); h.scene.clientWidth = 366; h.observers.resize();
    assert.equal(h.scene.dataset.speedPercent, '80');
    const card = h.document.createElement('div'); card.append(h.document.createElement('img'), h.document.createElement('button'));
    h.container.appendChild(card); h.observers.mutation(); assert.equal(h.frameCount, 1);
    for (let step = 0; step < 100; step++) { setPercent(h, 100); setPercent(h, 10); }
    assert.equal(h.frameCount, 1); assert.equal(h.controls.querySelectorAll('*').length, count);
    setPercent(h, 0); h.frame(0); assert.equal(h.frameCount, 0);
    h.observers.mutation(); h.observers.resize(); h.frame(0); assert.equal(h.scene.dataset.speedPercent, '0'); assert.equal(h.frameCount, 0);
});

test('Diagnostic pages retain the original speed and fixed presets without acquiring homepage-only speed controls', () => {
    for (const orbitTest of ['212-reference', '212-current', 'capacity-reference']) {
        const h = createOrbitHarness({ count: 0, sceneData: { orbitTest } });
        assert.equal(h.scene.dataset.speedPercent, '50'); assert.equal(h.speedControls, null); assert.equal(h.speedValue, null);
        assert.equal(h.actions['speed-in'], undefined);
    }
    assert.doesNotMatch(read('orbit-test.html'), /orbit-speed-controls|id="orbitSpeed"/);
});

test('Speed row reuses the cover controls below them, reads 50% initially, has a 0–100% range and shares the existing reset', () => {
    const html = read('index.html'), css = read('css/home-orbit.css');
    assert.match(html, /class="orbit-controls orbit-speed-controls" role="group" aria-label="自动旋转转速控制"/);
    assert.ok(html.indexOf('orbit-card-controls') < html.indexOf('orbit-speed-controls'));
    assert.match(html, /<span id="orbitSpeed" class="orbit-value"[^>]*>50%<\/span>/);
    for (const action of ['speed-in', 'speed-out']) assert.match(html, new RegExp(`<button type="button" data-orbit-action="${action}"[^>]*10个百分点`));
    assert.match(html, /自动转速0%–100%，50%为默认转速/);
    assert.equal([...html.matchAll(/data-orbit-action="reset"/g)].length, 1);
    assert.match(css, /#orbitCardScale, \.orbit-controls #orbitSpeed \{ min-width: 49px; font-size: 10px; \}/);
    assert.match(css, /@media \(max-width: 600px\)[\s\S]*#orbitCardScale, \.orbit-controls #orbitSpeed \{ min-width: 40px; \}/);
});
