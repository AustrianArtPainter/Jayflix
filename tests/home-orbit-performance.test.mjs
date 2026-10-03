// Work-budget regressions in a Node event model, NOT browser FPS/GPU measurements.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createOrbitHarness } from './helpers/orbit-event-harness.mjs';

const matrix = h => h.wireframe.style.transform.slice(9, -1).split(',').map(Number);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
const same = (a, b) => a.forEach((value, index) => near(value, b[index]));
const nodes = root => [root, ...root.children.flatMap(nodes)];

function observeWork(h) {
    const stats = { renders: 0, transforms: 0, opacityWrites: 0, inheritedVariables: 0, queries: 0, geometryReads: 0 };
    for (const element of nodes(h.document)) {
        element.style = new Proxy(element.style, {
            set(target, name, value) {
                if (name === 'transform') {
                    stats.transforms++;
                    if (element === h.wireframe) stats.renders++;
                }
                if (String(name).startsWith('--')) stats.inheritedVariables++;
                if (name === 'opacity') stats.opacityWrites++;
                target[name] = value;
                return true;
            }
        });
        const query = element.querySelector;
        element.querySelector = function (...args) { stats.queries++; return query.apply(this, args); };
    }
    for (const dimension of ['clientWidth', 'clientHeight']) {
        const value = h.scene[dimension];
        Object.defineProperty(h.scene, dimension, { get() { stats.geometryReads++; return value; } });
    }
    return stats;
}

test('9,600 drag events retain their complete path but render only once per display frame', () => {
    const h = createOrbitHarness(), stats = observeWork(h);
    const originalNodeCount = nodes(h.document).length;
    let expected = h.math.rotateOrientation([1, 0, 0, 0], [0, -.2, 0]);
    let x = 0, y = 0;
    h.pointer('pointerdown', x, y);
    for (let frame = 0; frame < 600; frame++) {
        const before = matrix(h);
        for (let sample = 0; sample < 16; sample++) {
            const phase = (frame * 16 + sample) * .025;
            const dx = 12 * Math.cos(phase), dy = 12 * Math.sin(phase);
            x += dx; y += dy;
            expected = h.math.rotateOrientation(expected, h.math.gestureVector(dx, dy));
            h.pointer('pointermove', x, y, { elapsed: 1 });
            assert.equal(h.frameCount, 1, 'One pending callback, regardless of pointer frequency');
        }
        same(matrix(h), before); // Pointer listeners do not perform rendering.
        h.frame(0);
        same(matrix(h), Array.from(h.math.orientationMatrix(expected)));
        assert.equal(h.frameCount, 0, 'A held gesture without new input does not spin an idle loop');
    }
    assert.equal(stats.renders, 600);
    assert.equal(stats.transforms, 600 * 17); // Sixteen cards and one wireframe.
    assert.equal(stats.opacityWrites, 600 * 16);
    assert.equal(stats.inheritedVariables, 0);
    assert.equal(stats.queries, 0, 'Depth opacity uses cached front references');
    assert.equal(stats.geometryReads, 0, 'No per-frame layout measurement');
    assert.equal(nodes(h.document).length, originalNodeCount, 'No accumulating clones/nodes');
    h.pointer('pointerup', x, y);
    for (let frame = 0; frame < 600; frame++) {
        assert.equal(h.frameCount, 1, 'Release has one continuous animation chain');
        h.frame();
    }
    assert.equal(stats.renders, 1199); // First release frame establishes the clock.
    assert.equal(stats.opacityWrites, 1199 * 16);
    assert.equal(stats.inheritedVariables, 0);
    assert.equal(stats.queries, 0);
    assert.equal(stats.geometryReads, 0);
});

test('Release before the scheduled frame does not discard the last drag movement', () => {
    const h = createOrbitHarness({ reducedMotion: true }), before = matrix(h);
    h.pointer('pointerdown', 0, 0);
    h.pointer('pointermove', 40, 30);
    h.pointer('pointermove', 70, -20);
    h.pointer('pointerup', 70, -20);
    same(matrix(h), before);
    assert.equal(h.frameCount, 1);
    h.frame(0);
    let expected = h.math.rotateOrientation([1, 0, 0, 0], [0, -.2, 0]);
    expected = h.math.rotateOrientation(expected, h.math.gestureVector(40, 30));
    expected = h.math.rotateOrientation(expected, h.math.gestureVector(30, -50));
    same(matrix(h), Array.from(h.math.orientationMatrix(expected)));
    assert.equal(h.frameCount, 0);
});

test('Hidden/offscreen scenes do not render, and paused gestures still redraw when visible', () => {
    const h = createOrbitHarness({ reducedMotion: true }), stats = observeWork(h), before = matrix(h);
    h.document.hidden = true;
    h.document.dispatch('visibilitychange');
    h.pointer('pointerdown', 0, 0);
    h.pointer('pointermove', 40, 30);
    h.pointer('pointerup', 40, 30);
    assert.equal(h.frameCount, 0);
    same(matrix(h), before);
    h.document.hidden = false;
    h.document.dispatch('visibilitychange');
    assert.equal(h.frameCount, 1);
    h.frame(0);
    assert.equal(stats.renders, 1);
    assert.notDeepEqual(matrix(h), before);
    assert.equal(h.frameCount, 0);
    h.pointer('pointerdown', 0, 0);
    h.pointer('pointermove', 20, 20);
    h.observers.intersection([{ isIntersecting: false }]);
    h.frame();
    assert.equal(stats.renders, 1, 'A previously queued frame also respects invisibility');
    assert.equal(h.frameCount, 0);
    h.observers.intersection([{ isIntersecting: true }]);
    h.frame(0);
    assert.equal(stats.renders, 2);
});

test('A short stall decays release inertia by elapsed time, not the old 50 ms ceiling', () => {
    const h = createOrbitHarness();
    h.pointer('pointerdown', 0, 0);
    h.pointer('pointermove', 50, 50);
    h.pointer('pointerup', 50, 50);
    h.frame();
    const before = matrix(h);
    const velocity = Array.from(h.math.velocityFromGesture(50, 50, .016)).map(value => value * .65);
    const length = Math.hypot(...velocity), target = velocity.map(value => value * h.math.AUTO_SPEED / length);
    const expected = h.math.advanceOrientation(h.math.rotateOrientation(h.math.rotateOrientation([1, 0, 0, 0], [0, -.2, 0]), h.math.gestureVector(50, 50)), velocity, target, .12);
    h.frame(120);
    assert.notDeepEqual(matrix(h), before);
    same(matrix(h), Array.from(h.math.orientationMatrix(expected.orientation)));
});

test('Animation styles only move direct transforms and fade leaf opacity, not inherited matrices/visibility', () => {
    const css = readFileSync(new URL('../css/home-orbit.css', import.meta.url), 'utf8');
    const source = readFileSync(new URL('../js/home-orbit.js', import.meta.url), 'utf8');
    assert.doesNotMatch(css, /--orbit-upright-transform|--orbit-card-transform/);
    assert.doesNotMatch(source, /setProperty\('--orbit-(?:upright|card)-transform'/);
    const rule = css.match(/\.home-page #douban-results > \.orbit-card\s*\{([^}]+)\}/)[1];
    assert.match(rule, /will-change:\s*transform/);
    assert.doesNotMatch(rule, /transform:[^;]*!important/);
    const face = css.match(/\.orbit-card-front\s*\{([^}]+)\}/)[1];
    assert.match(face, /will-change:\s*opacity/);
    assert.doesNotMatch(css, /data-side|orbit-card-back|orbit-back-content/);
    assert.doesNotMatch(source, /(?:card|world|camera)\.style\.opacity\s*=/);
    assert.doesNotMatch(face, /transition:\s*[^;]*(?:opacity|all)/);
});

test('Maximum sphere and cover scaling add no per-frame CSS dimension writes, geometry reads or extra animation chains', () => {
    const h = createOrbitHarness();
    for (let i = 0; i < 50; i++) { h.actions['zoom-in'].click(); h.actions['card-size-in'].click(); }
    near(Number(h.scene.dataset.zoom), 5);
    near(Number(h.scene.dataset.cardScale), 5);
    const stats = observeWork(h), count = nodes(h.document).length;
    h.pointer('pointerdown', 0, 0, { target: h.cards[0].querySelector('.original-overlay') });
    stats.queries = 0;
    for (let frame = 0; frame < 120; frame++) {
        h.pointer('pointermove', frame * 10 + 10, frame * 5 + 5);
        h.frame(0);
    }
    assert.equal(stats.renders, 120);
    assert.equal(stats.transforms, 120 * 17);
    assert.equal(stats.opacityWrites, 120 * 16);
    assert.equal(stats.inheritedVariables, 0);
    assert.equal(stats.geometryReads, 0);
    assert.equal(stats.queries, 0);
    assert.equal(nodes(h.document).length, count);
    h.pointer('pointerup', 1200, 600);
    assert.equal(h.frameCount, 1);
    h.frame(); h.frame();
    assert.equal(h.frameCount, 1);
});
