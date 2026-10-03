// Run the actual homepage controller and independent geometry checks in Node.
// These tests do not claim real-image Chrome/GPU frame-rate measurements.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createOrbitHarness } from './helpers/orbit-event-harness.mjs';

const source = readFileSync(new URL('../js/home-orbit.js', import.meta.url), 'utf8');
const scope = vm.createContext({});
vm.runInContext(source, scope);
const math = scope.JayflixOrbitMath;
const near = (a, b, epsilon = 1e-9) => assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b}`);
const dimensions = h => ['--orbit-card-width', '--orbit-card-height', '--orbit-footer-height']
    .map(name => parseFloat(h.scene.style.getPropertyValue(name)));
const position = card => card.style.transform.match(/translate3d\(([^)]+)\)/)[1].split(',').map(parseFloat);
const nodes = element => [element, ...element.children.flatMap(nodes)];

function independentMinimumSquared(slots) {
    const coordinates = new Float64Array(slots.length * 3);
    slots.forEach((slot, index) => {
        const ring = Math.cos(slot.latitude);
        coordinates[index * 3] = ring * Math.sin(slot.longitude);
        coordinates[index * 3 + 1] = -Math.sin(slot.latitude);
        coordinates[index * 3 + 2] = ring * Math.cos(slot.longitude);
        near(Math.hypot(...coordinates.subarray(index * 3, index * 3 + 3)), 1);
    });
    let minimum = Infinity;
    // Exhaustive pair oracle: deliberately no production nearest-neighbor code,
    // no sampling, and no monotonic-spacing assumption when N changes.
    for (let first = 0; first < coordinates.length; first += 3) {
        const x = coordinates[first], y = coordinates[first + 1], z = coordinates[first + 2];
        for (let second = first + 3; second < coordinates.length; second += 3) {
            const dx = x - coordinates[second], dy = y - coordinates[second + 1], dz = z - coordinates[second + 2];
            const squared = dx * dx + dy * dy + dz * dz;
            if (squared < minimum) minimum = squared;
        }
    }
    return minimum;
}

test('Every integer count from 1 through 1,322 has distinct sphere points and a complete safe auto-sized envelope', () => {
    assert.equal(math.MAX_DISPLAY_CARDS, 1322);
    let checkedPairs = 0;
    for (let count = 1; count <= math.MAX_DISPLAY_CARDS; count++) {
        const slots = math.createSlots(count), layout = math.computeLayout(1344, 700, slots);
        assert.equal(slots.length, count);
        for (const slot of slots) assert.ok(Number.isFinite(slot.latitude) && Number.isFinite(slot.longitude));
        for (const value of Object.values(layout)) assert.ok(Number.isFinite(value));
        assert.ok(layout.cardWidth > 0);
        near(layout.cardHeight, layout.cardWidth * 1.75);
        near(layout.footerHeight, layout.cardWidth * .25);
        const minimumSquared = independentMinimumSquared(slots);
        checkedPairs += count * (count - 1) / 2;
        if (count === 1) continue;
        assert.ok(minimumSquared > 0, `Duplicate center at count ${count}`);
        near(layout.minimumChord / layout.radius, Math.sqrt(minimumSquared));
        const envelopeSquared = layout.cardWidth ** 2 + layout.cardHeight ** 2 + (2 * layout.faceOffset) ** 2;
        const minimumWorldSquared = minimumSquared * layout.radius ** 2;
        assert.ok(envelopeSquared <= minimumWorldSquared * .98 ** 2 + 1e-8, `Unsafe envelope at count ${count}`);
        // Rigid rotation and uniform sphere zoom preserve center distances.
        // An envelope diagonal below ALL pair distances excludes box intersection
        // at every rotation, not merely the currently visible projection.
        assert.ok(envelopeSquared < minimumWorldSquared, `No clearance at count ${count}`);
    }
    assert.equal(checkedPairs, 1322 * 1323 * 1321 / 6);
});

test('The real homepage uses its actual displayed count and auto-size, including empty and Fibonacci budget boundaries', () => {
    for (const count of [0, 1, 2, 15, 16, 17, 211, 212, 620, 621, 1322]) {
        const h = createOrbitHarness({ count, reducedMotion: true });
        assert.equal(h.container.children.length, count);
        assert.equal(Number(h.counter.textContent), count);
        assert.equal(h.scene.dataset.state, count ? 'ready' : 'empty');
        const layout = h.math.computeLayout(1344, 700, h.math.createSlots(count));
        dimensions(h).forEach((value, index) => near(value, [layout.cardWidth, layout.cardHeight, layout.footerHeight][index] * .7));
        for (const card of h.cards) {
            near(Math.hypot(...position(card)), layout.radius);
            assert.equal(card.querySelectorAll('.orbit-card-front').length, 1);
            assert.equal(card.querySelectorAll('img').length, 1);
        }
        assert.equal(h.observerStates.mutation.disconnectCalls, 0);
        assert.ok(h.frameCount <= 1);
    }
});

test('Over-limit homepage responses keep precisely the first 1,322 original cards without decorating or animating the excess', () => {
    for (const count of [1322, 1323, 1644]) {
        const h = createOrbitHarness({ count });
        assert.equal(h.container.childElementCount, 1322);
        assert.equal(Number(h.counter.textContent), 1322);
        assert.equal(h.cards.length, count, 'The original source sequence is not mutated');
        for (let index = 0; index < count; index++) {
            const card = h.cards[index];
            if (index < 1322) {
                assert.equal(h.container.children[index], card, 'Retain original data order and node identity');
                assert.equal(card.querySelector('img').getAttribute('id'), `original-image-${index}`);
                assert.equal(card.querySelector('button').getAttribute('onclick'), 'originalSearch()');
                assert.equal(card.querySelector('img').getAttribute('onerror'), 'originalFallback()');
                assert.equal(card.querySelector('a').getAttribute('href'), `https://movie.douban.com/subject/${index + 1}/`);
            } else {
                assert.equal(card.parentElement, null);
                assert.equal(card.classList.contains('orbit-card'), false);
                assert.equal(card.querySelector('.orbit-card-front'), null);
                assert.equal(card.style.transform, undefined);
            }
        }
        assert.equal(h.observerStates.mutation.disconnectCalls, count > 1322 ? 1 : 0);
        assert.equal(h.observerStates.mutation.connected, true);
        assert.equal(h.observerStates.mutation.target, h.container);
        assert.equal(h.observerStates.mutation.options.childList, true);
        h.observers.mutation();
        assert.equal(h.observerStates.mutation.disconnectCalls, count > 1322 ? 1 : 0, 'No removal/reconciliation loop');
        assert.equal(h.frameCount, 1);
    }
});

test('Non-card loading/error messages never consume the card limit or disappear during truncation', () => {
    let overlay, message;
    const h = createOrbitHarness({ count: 1325, setupDocument({ document, container }) {
        overlay = document.createElement('div'); overlay.className = 'absolute';
        message = document.createElement('div'); message.textContent = 'Original status message';
        container.replaceChildren(overlay, ...Array.from(container.children), message);
    } });
    assert.equal(h.container.childElementCount, 1324);
    assert.equal(h.container.children[0], overlay);
    assert.equal(h.container.children.at(-1), message);
    assert.equal(h.loading.hidden, false);
    assert.equal(Number(h.counter.textContent), 1322);
    assert.deepEqual(h.container.children.slice(1, -1), h.cards.slice(0, 1322));
});

test('Changing response counts, refreshing past the limit and resizing recompute the base dimensions without resetting user multipliers', () => {
    const h = createOrbitHarness({ count: 1350, reducedMotion: true });
    for (let step = 0; step < 6; step++) h.actions['card-size-in'].click();
    for (let step = 0; step < 3; step++) h.actions['zoom-in'].click();
    for (const count of [1, 16, 212, 1322, 0, 1323]) {
        const visible = Math.min(count, 1322);
        h.container.replaceChildren(...h.cards.slice(0, count));
        h.observers.mutation();
        assert.equal(h.container.childElementCount, visible);
        assert.equal(Number(h.counter.textContent), visible);
        for (const width of [100, 296, 712, 1344]) {
            h.scene.clientWidth = width;
            h.observers.resize();
            const layout = h.math.computeLayout(width, 700, h.math.createSlots(visible));
            dimensions(h).forEach((value, index) => near(value, [layout.cardWidth, layout.cardHeight, layout.footerHeight][index] * 1.3));
            near(Number(h.scene.dataset.zoom), 2.3);
            near(Number(h.scene.dataset.cardScale), 1.3);
            assert.equal(h.cardValue.textContent, '130%');
        }
    }
    h.container.replaceChildren(); h.observers.mutation();
    h.container.append(...h.cards.slice(0, 16)); h.observers.mutation();
    const small = dimensions(h)[0];
    h.container.replaceChildren(...h.cards.slice(0, 212)); h.observers.mutation();
    const medium = dimensions(h)[0];
    h.container.replaceChildren(...h.cards.slice(0, 1322)); h.observers.mutation();
    assert.ok(small > medium && medium > dimensions(h)[0]);
});

test('The first and last retained cards keep their original click, link, keyboard and drag behavior at the limit', () => {
    const h = createOrbitHarness({ count: 1340, reducedMotion: true });
    for (const card of [h.cards[0], h.cards[1321]]) {
        card.querySelector('img').click();
        card.querySelector('button').click();
        h.key('Enter', card);
        card.querySelector('a').click();
    }
    assert.equal(h.actionCount, 6); assert.equal(h.linkCount, 2);
    const card = h.cards[1321], before = card.style.transform;
    h.pointer('pointerdown', 0, 0, { target: card.querySelector('img') });
    h.pointer('pointermove', 60, -40); h.frame(0);
    assert.notEqual(card.style.transform, before);
    h.pointer('pointerup', 60, -40);
    assert.equal(card.querySelector('button').click().defaultPrevented, true);
    h.wait(500); card.querySelector('button').click();
    assert.equal(h.actionCount, 7);
});

test('At 1,322 displayed cards, repeated free dragging still paints only once per frame with no layout reads, queries or node accumulation', () => {
    const h = createOrbitHarness({ count: 1400 }), originalNodes = nodes(h.document).length;
    const stats = { transforms: 0, opacities: 0, inherited: 0, queries: 0, geometry: 0 };
    for (const element of nodes(h.document)) {
        element.style = new Proxy(element.style, { set(target, name, value) {
            if (name === 'transform') stats.transforms++;
            if (name === 'opacity') stats.opacities++;
            if (String(name).startsWith('--')) stats.inherited++;
            target[name] = value; return true;
        } });
        const query = element.querySelector;
        element.querySelector = function (...args) { stats.queries++; return query.apply(this, args); };
    }
    for (const name of ['clientWidth', 'clientHeight']) {
        const value = h.scene[name];
        Object.defineProperty(h.scene, name, { get() { stats.geometry++; return value; } });
    }
    let x = 0, y = 0;
    h.pointer('pointerdown', x, y);
    for (let frame = 0; frame < 120; frame++) {
        for (let sample = 0; sample < 16; sample++) {
            const phase = (frame * 16 + sample) * .025;
            x += 12 * Math.cos(phase); y += 12 * Math.sin(phase);
            h.pointer('pointermove', x, y, { elapsed: 1 });
            assert.equal(h.frameCount, 1);
        }
        h.frame(0);
        assert.equal(h.frameCount, 0);
    }
    assert.equal(stats.transforms, 120 * 1323);
    assert.equal(stats.opacities, 120 * 1322);
    assert.equal(stats.inherited, 0); assert.equal(stats.queries, 0); assert.equal(stats.geometry, 0);
    assert.equal(nodes(h.document).length, originalNodes);
    for (const card of h.cards.slice(1322)) assert.equal(card.style.transform, undefined);
    h.pointer('pointerup', x, y);
    for (let frame = 0; frame < 120; frame++) { assert.equal(h.frameCount, 1); h.frame(); }
    assert.equal(stats.transforms, 239 * 1323);
    assert.equal(stats.opacities, 239 * 1322);
    assert.equal(nodes(h.document).length, originalNodes);
});

test('Homepage and diagnostic entry load the fresh shared controller without adding requests, fixtures or business dependencies', () => {
    for (const file of ['index.html', 'orbit-test.html']) {
        const page = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
        assert.match(page, /js\/home-orbit\.js\?v=20261003-14/);
    }
    assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|localStorage|sessionStorage/);
    const home = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    assert.doesNotMatch(home, /orbit-test|data-orbit-test/);
});
