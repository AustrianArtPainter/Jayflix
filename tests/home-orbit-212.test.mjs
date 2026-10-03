// Real production controller + image-free fixture generator in a Node DOM model.
// Geometry/work assertions are not screenshots or Chrome/GPU frame-rate evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createOrbitHarness } from './helpers/orbit-event-harness.mjs';
import { billboardBox, boxesOverlap, rotateBox } from './helpers/orbit-geometry.mjs';

const scope = vm.createContext({});
const fixtureSource = readFileSync(new URL('../js/orbit-test.js', import.meta.url), 'utf8');
vm.runInContext(readFileSync(new URL('../js/home-orbit.js', import.meta.url), 'utf8'), scope);
vm.runInContext(fixtureSource, scope);
const math = scope.JayflixOrbitMath, demo = scope.JayflixOrbitTest;
const near = (a, b, epsilon = 1e-9) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
const dimensions = h => ['--orbit-card-width', '--orbit-card-height', '--orbit-footer-height']
    .map(name => parseFloat(h.scene.style.getPropertyValue(name)));
const position = card => card.style.transform.slice(12, -1).split(',').map(parseFloat);
const nodes = root => [root, ...root.children.flatMap(nodes)];
const harness = (mode = 'reference', reducedMotion = true) => createOrbitHarness({
    reducedMotion, sceneData: { orbitTest: `212-${mode}` }, cardsFactory: document => demo.createFrames(document)
});

test('The fixture generator creates exactly 212 distinct numbered rectangles without any images or links', () => {
    const h = harness();
    assert.equal(demo.COUNT, 212);
    assert.equal(h.cards.length, 212);
    assert.equal(h.counter.textContent, '212');
    assert.equal(h.container.querySelectorAll('.orbit-card').length, 212);
    assert.equal(h.container.querySelectorAll('img').length, 0);
    assert.equal(h.container.querySelectorAll('a').length, 0);
    const labels = h.cards.map(card => card.querySelector('button').textContent);
    assert.equal(new Set(labels).size, 212);
    assert.equal(labels[0], '框 001'); assert.equal(labels.at(-1), '框 212');
    for (const card of h.cards) {
        assert.equal(card.dataset.orbitPlaceholder, 'true');
        assert.equal(card.querySelectorAll('.orbit-card-front').length, 1);
        assert.equal(card.draggable, false);
    }
});

test('The reference preset starts at radius-only 200% and the original 16-card reference size at 50%', () => {
    const h = harness(), reference = math.computeLayout(1344, 700, math.createSlots(16));
    assert.equal(h.scene.dataset.zoom, '2'); assert.equal(h.scene.dataset.cardScale, '0.5');
    assert.equal(h.actions.reset.textContent, '200%');
    assert.equal(h.actions['card-size-reset'].textContent, '50%');
    assert.equal(h.camera.style.transform, 'scale3d(1, 1, 1)');
    near(parseFloat(h.scene.style.getPropertyValue('--orbit-radius')), 490);
    near(dimensions(h)[0], reference.cardWidth / 2);
    near(dimensions(h)[1], reference.cardHeight / 2);
    for (const card of h.cards) {
        const p = position(card); near(Math.hypot(...p), 490);
        near(Number(card.querySelector('.orbit-card-front').style.opacity), .62 + .38 * p[2] / 490);
    }
    const autoSized = math.computeLayout(1344, 700, math.createSlots(212));
    assert.ok(dimensions(h)[0] > autoSized.cardWidth * 1.99, 'Reference cards were not secretly shrunk to the 212-point default');
});

test('All 22,366 pairs pass the independent diagonal/chord bound at 212 reference cards; rotation preserves it', () => {
    const slots = math.createSlots(212), reference = math.computeLayout(1344, 700, math.createSlots(16));
    const layout = { radius: reference.radius * 2, faceOffset: reference.faceOffset * 2,
        cardWidth: reference.cardWidth / 2, cardHeight: reference.cardHeight / 2 };
    const base = slots.map(slot => billboardBox(slot, layout));
    const diagonal = Math.hypot(layout.cardWidth, layout.cardHeight, 2 * layout.faceOffset);
    let pairs = 0, minimum = Infinity;
    for (let i = 0; i < base.length; i++) for (let j = i + 1; j < base.length; j++) {
        const chord = Math.hypot(...base[i].center.map((value, axis) => value - base[j].center[axis]));
        assert.ok(diagonal <= chord * .98, `Unsafe pair ${i + 1}/${j + 1}`);
        minimum = Math.min(minimum, chord); pairs++;
    }
    assert.equal(pairs, 22366);
    near(diagonal, 101.85308871080144);
    assert.ok(minimum * .98 > diagonal);
    // The bound proves every rigid rotation safe. SAT samples independently
    // exercise the camera-aligned complete rectangles, not just their centers.
    for (const vector of [[0, 0, 0], [Math.PI / 2, 0, 0], [0, Math.PI / 2, 0], [1.1, -.8, .3], [4.1, 2.2, -1.4]]) {
        const boxes = base.map(box => ({ ...rotateBox(box, vector), axes: box.axes }));
        for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
            assert.equal(boxesOverlap(boxes[i], boxes[j]), false, `SAT ${vector}: ${i + 1}/${j + 1}`);
        }
    }
});

test('The 212/213 safety boundary uses fixed reference dimensions, and is proportional at each breakpoint', () => {
    for (const [width, height] of [[100, 520], [296, 520], [712, 1000], [1344, 1100]]) {
        const reference = math.computeLayout(width, height, math.createSlots(16));
        const yes = demo.describeLayout(math, width, height, 212, 'reference', 2, .5);
        const no = demo.describeLayout(math, width, height, 213, 'reference', 2, .5);
        near(yes.cardWidth, reference.cardWidth / 2);
        near(yes.cardHeight, reference.cardHeight / 2);
        assert.equal(yes.safe, true); assert.equal(no.safe, false);
        // Failing the conservative 2% gap rule is not, by itself, proof that
        // the actual zero-thickness front faces intersect.
        assert.ok(no.envelope < no.minimumChord);
    }
    assert.equal(demo.describeLayout(math, 0, 0, 212, 'reference', 2, .5).safe, false);
});

test('The current-home comparison uses the unmodified 212-point auto sizing and whole-container zoom', () => {
    const h = harness('current'), layout = math.computeLayout(1344, 700, math.createSlots(212));
    assert.equal(h.scene.dataset.zoom, '1'); assert.equal(h.scene.dataset.cardScale, '1');
    near(dimensions(h)[0], layout.cardWidth);
    assert.match(h.camera.style.transform, /scale3d\(1, 1, 1\)/);
    let variableWrites = 0;
    const writeVariable = h.scene.style.setProperty;
    h.scene.style.setProperty = function (...args) { variableWrites++; return writeVariable.apply(this, args); };
    for (let i = 0; i < 10; i++) h.actions['zoom-in'].click();
    assert.equal(variableWrites, 0, 'Normal-style whole-scene zoom must not invalidate inherited CSS dimensions');
    near(Number(h.scene.dataset.zoom), 2);
    assert.equal(h.camera.style.transform, `scale3d(${h.scene.dataset.zoom}, ${h.scene.dataset.zoom}, ${h.scene.dataset.zoom})`);
    near(dimensions(h)[0], layout.cardWidth);
    for (const zoom of [.5, 1, 2]) assert.equal(demo.describeLayout(math, 1344, 700, 212, 'current', zoom, 1).safe, true);
});

test('Both 212-card modes reach 50% and 500%, preserve independent resets and have finite perspective at the extremes', () => {
    for (const mode of ['reference', 'current']) {
        const h = harness(mode);
        const slots = math.createSlots(212);
        const original = (mode === 'reference' ? math.computeReferenceLayout : math.computeLayout)(1344, 700, slots);
        for (const zoom of [.5, 5]) for (const cardScale of [.5, 5]) {
            h.actions['card-size-reset'].click();
            const action = cardScale === 5 ? 'card-size-in' : 'card-size-out';
            for (let i = 0; i < 60; i++) h.actions[action].click();
            h.scene.dispatch('wheel', { ctrlKey: true, deltaY: zoom === 5 ? -10000 : 10000, deltaMode: 0 });
            h.frame(0);
            near(Number(h.scene.dataset.zoom), zoom);
            near(Number(h.scene.dataset.cardScale), cardScale);
            assert.equal(h.actions.reset.textContent, `${zoom * 100}%`);
            assert.equal(h.actions['card-size-reset'].textContent, `${cardScale * 100}%`);
            assert.equal(h.actions[zoom === 5 ? 'zoom-in' : 'zoom-out'].disabled, true);
            assert.equal(h.actions[action].disabled, true);
            near(dimensions(h)[0], original.cardWidth * cardScale);
            const report = demo.describeLayout(math, 1344, 700, 212, mode, zoom, cardScale);
            for (const field of ['radius', 'cardWidth', 'cardHeight', 'minimumChord', 'envelope']) {
                assert.ok(Number.isFinite(report[field]) && report[field] > 0);
            }
            if (cardScale === 5) assert.equal(report.safe, false, 'Large overlapping covers are not mislabeled as safe');
            const sceneScale = mode === 'reference' ? 1 : zoom;
            const faceOffset = parseFloat(h.scene.style.getPropertyValue('--orbit-face-offset')) * sceneScale;
            const perspective = parseFloat(h.scene.style.perspective);
            // A positive lower bound proves no face can reach/cross the camera
            // plane at any orientation throughout the new 500% zoom limit.
            assert.ok(perspective - original.radius * zoom - faceOffset > 0);
            for (const card of h.cards) {
                const p = position(card).map(value => value * sceneScale);
                near(Math.hypot(...p), original.radius * zoom);
                const denominator = perspective - p[2] - faceOffset;
                assert.ok(denominator > 0);
                const projectedWidth = dimensions(h)[0] * sceneScale * perspective / denominator;
                assert.ok(Number.isFinite(projectedWidth) && projectedWidth > 0);
                const alpha = Number(card.querySelector('.orbit-card-front').style.opacity);
                near(alpha, .62 + .38 * p[2] / (original.radius * zoom));
            }
            h.actions.reset.click(); h.frame(0);
            near(Number(h.scene.dataset.zoom), 1);
            near(Number(h.scene.dataset.cardScale), cardScale);
            h.actions['card-size-reset'].click();
            near(Number(h.scene.dataset.cardScale), 1);
            near(Number(h.scene.dataset.zoom), 1);
        }
        h.actions['card-size-out'].click();
        const before = dimensions(h);
        for (const [distance, expectedZoom] of [[10000, 5], [.1, .5]]) {
            h.actions.reset.click(); h.frame(0);
            h.pointer('pointerdown', 0, 0, { id: 1, pointerType: 'touch' });
            h.pointer('pointerdown', 100, 0, { id: 2, pointerType: 'touch' });
            h.pointer('pointermove', distance, 0, { id: 2, pointerType: 'touch' }); h.frame(0);
            near(Number(h.scene.dataset.zoom), expectedZoom);
            before.forEach((value, index) => near(dimensions(h)[index], value));
            h.pointer('pointerup', distance, 0, { id: 2, pointerType: 'touch' });
            h.pointer('pointerup', 0, 0, { id: 1, pointerType: 'touch' });
        }
        assert.equal(h.container.querySelectorAll('.orbit-card').length, 212);
        assert.equal(h.container.querySelectorAll('.orbit-card-front').length, 212);
        assert.equal(h.container.querySelectorAll('img').length, 0);
    }
});

test('212-card extreme scaling adds no per-frame dimension writes, layout reads, queries or additional animation chains', () => {
    for (const mode of ['reference', 'current']) {
        const h = harness(mode, false);
        for (let i = 0; i < 60; i++) h.actions['card-size-in'].click();
        h.scene.dispatch('wheel', { ctrlKey: true, deltaY: -10000, deltaMode: 0 });
        h.frame();
        const originalNodes = nodes(h.document).length;
        let variableWrites = 0, geometryReads = 0, queries = 0;
        const setProperty = h.scene.style.setProperty;
        h.scene.style.setProperty = function (...args) { variableWrites++; return setProperty.apply(this, args); };
        for (const name of ['clientWidth', 'clientHeight']) {
            const value = h.scene[name];
            Object.defineProperty(h.scene, name, { get() { geometryReads++; return value; } });
        }
        for (const element of nodes(h.document)) {
            const query = element.querySelector;
            element.querySelector = function (...args) { queries++; return query.apply(this, args); };
        }
        h.pointer('pointerdown', 0, 0);
        for (let frame = 0; frame < 120; frame++) {
            h.pointer('pointermove', frame * 10 + 10, frame * 5 + 5);
            assert.equal(h.frameCount, 1); h.frame(0);
        }
        h.pointer('pointerup', 1200, 600);
        for (let frame = 0; frame < 120; frame++) { assert.equal(h.frameCount, 1); h.frame(); }
        assert.equal(variableWrites, 0); assert.equal(geometryReads, 0); assert.equal(queries, 0);
        assert.equal(nodes(h.document).length, originalNodes);
    }
});

test('Blank diagnostic cards are ignored by a normal, non-test homepage', () => {
    const h = createOrbitHarness({ cardsFactory: document => demo.createFrames(document), reducedMotion: true });
    assert.equal(h.container.querySelectorAll('.orbit-card').length, 0);
    assert.equal(h.scene.dataset.state, 'empty');
    assert.equal(h.counter.textContent, '00');
});

test('Reference zoom changes center distances and face offsets without changing card dimensions; resize keeps the reference', () => {
    const h = harness(), before = dimensions(h);
    h.actions['zoom-out'].click(); h.frame(0);
    near(Number(h.scene.dataset.zoom), 1.9);
    near(Math.hypot(...position(h.cards[0])), 245 * 1.9);
    before.forEach((value, index) => near(dimensions(h)[index], value));
    h.actions['card-size-in'].click();
    near(Number(h.scene.dataset.cardScale), .6);
    near(Math.hypot(...position(h.cards[0])), 245 * 1.9);
    for (const width of [100, 296, 712, 1344]) {
        h.scene.clientWidth = width; h.observers.resize();
        const reference = math.computeLayout(width, 700, math.createSlots(16));
        near(dimensions(h)[0], reference.cardWidth * .6);
        near(Math.hypot(...position(h.cards[0])), reference.radius * 1.9);
    }
    h.observers.mutation();
    assert.equal(h.container.querySelectorAll('.orbit-card').length, 212);
    assert.equal(h.container.querySelectorAll('.orbit-card-front').length, 212);
});

test('Two-finger reference zoom keeps the covers fixed, and dragging a blank cover follows arbitrary directions', () => {
    const h = harness(), before = dimensions(h), target = h.cards[0].querySelector('strong');
    assert.equal(h.pointer('pointerdown', 0, 0, { target }).defaultPrevented, true);
    h.pointer('pointermove', 60, -30, { target }); h.frame(0);
    const first = position(h.cards[0]);
    h.pointer('pointermove', 110, 40, { target }); h.frame(0);
    assert.notDeepEqual(position(h.cards[0]), first);
    h.pointer('pointerup', 110, 40, { target });
    h.pointer('pointerdown', 0, 0, { id: 1, pointerType: 'touch' });
    h.pointer('pointerdown', 100, 0, { id: 2, pointerType: 'touch' });
    h.pointer('pointermove', 50, 0, { id: 2, pointerType: 'touch' }); h.frame(0);
    near(Number(h.scene.dataset.zoom), 1);
    near(Math.hypot(...position(h.cards[0])), 245);
    before.forEach((value, index) => near(dimensions(h)[index], value));
    h.pointer('pointerup', 0, 0, { id: 1, pointerType: 'touch' });
    h.pointer('pointerup', 50, 0, { id: 2, pointerType: 'touch' });
});

test('Enlarging the 212 reference covers is not falsely certified safe: an independent SAT witness detects overlap', () => {
    const slots = math.createSlots(212), reference = math.computeLayout(1344, 700, math.createSlots(16));
    const layout = { radius: reference.radius * 2, faceOffset: reference.faceOffset * 2,
        cardWidth: reference.cardWidth * 2, cardHeight: reference.cardHeight * 2 };
    const base = slots.map(slot => billboardBox(slot, layout));
    let first, second, delta, distance = Infinity;
    for (let i = 0; i < base.length; i++) for (let j = i + 1; j < base.length; j++) {
        const vector = base[j].center.map((value, axis) => value - base[i].center[axis]);
        if (Math.hypot(...vector) < distance) { first = i; second = j; delta = vector; distance = Math.hypot(...vector); }
    }
    const from = delta.map(value => value / distance), axis = [-from[2], 0, from[0]];
    const angle = Math.acos(from[1]), vector = axis.map(value => value * angle / Math.hypot(...axis));
    const rotated = base.map(box => ({ ...rotateBox(box, vector), axes: box.axes }));
    assert.equal(boxesOverlap(rotated[first], rotated[second]), true);
    assert.equal(demo.describeLayout(math, 1344, 700, 212, 'reference', 2, 2).safe, false);
});

test('212-card long dragging still renders once per display frame without queries, inherited variables or accumulating nodes', () => {
    const h = harness('reference', false), originalNodes = nodes(h.document).length;
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
    for (let frame = 0; frame < 600; frame++) {
        for (let sample = 0; sample < 16; sample++) {
            const phase = (frame * 16 + sample) * .025;
            x += 12 * Math.cos(phase); y += 12 * Math.sin(phase);
            h.pointer('pointermove', x, y, { elapsed: 1 });
            assert.equal(h.frameCount, 1);
        }
        h.frame(0);
        assert.equal(h.frameCount, 0);
    }
    assert.equal(stats.transforms, 600 * 213);
    assert.equal(stats.opacities, 600 * 212);
    assert.equal(stats.inherited, 0); assert.equal(stats.queries, 0); assert.equal(stats.geometry, 0);
    assert.equal(nodes(h.document).length, originalNodes);
    h.pointer('pointerup', x, y);
    for (let frame = 0; frame < 600; frame++) { assert.equal(h.frameCount, 1); h.frame(); }
    assert.equal(stats.transforms, 1199 * 213);
    assert.equal(stats.opacities, 1199 * 212);
    assert.equal(stats.inherited, 0); assert.equal(stats.queries, 0); assert.equal(stats.geometry, 0);
    assert.equal(nodes(h.document).length, originalNodes);
});

test('Test entry keeps normal homepage and all business scripts separate, with correct fixture-before-controller ordering', () => {
    const html = readFileSync(new URL('../orbit-test.html', import.meta.url), 'utf8');
    const normal = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const fixture = readFileSync(new URL('../js/orbit-test.js', import.meta.url), 'utf8');
    assert.ok(html.indexOf('src="js/orbit-test.js') < html.indexOf('src="js/home-orbit.js'));
    assert.match(html, /src="js\/orbit-test\.js[^\"]*" defer/);
    assert.match(html, /src="js\/home-orbit\.js[^\"]*" defer/);
    assert.doesNotMatch(normal, /orbit-test|data-orbit-test/);
    assert.doesNotMatch(html, /<img\b|src="js\/(?:douban|app|api|search|config|password|pwa-register)\.js/);
    assert.doesNotMatch(fixture, /\bfetch\s*\(|XMLHttpRequest|localStorage|sessionStorage/);
    assert.match(html, /非GPU帧率/);
    assert.match(html, /空框测试不能证明212张真实图片也流畅/);
    assert.match(html, /正常前后遮挡不等于面片相交/);
    for (const page of [html, normal]) {
        assert.match(page, /球体缩放50%–500%/);
        assert.match(page, /封面尺寸50%–500%/);
        assert.doesNotMatch(page, /50%–200%|(?:缩放|尺寸|range[^>]*>)(?:5|20)%–500%/);
        assert.match(page, /src="js\/home-orbit\.js\?v=20261003-14"/);
        assert.match(page, page === normal ? /href="css\/home-orbit\.css\?v=20261003-18"/ : /href="css\/home-orbit\.css\?v=20261003-16"/);
    }
});

test('Actual diagnostic script bootstraps before the real controller and reports 212 cards after DOMContentLoaded', () => {
    for (const query of ['', '?mode=current', '?mode=invalid']) {
        const widgets = new Map(), links = [];
        const h = createOrbitHarness({ count: 0, reducedMotion: true, bootstrapSource: fixtureSource, query,
            setupDocument({ document, scene }) {
                // defer scripts execute after parsing (interactive) but before
                // DOMContentLoaded. The fixture listener must see an initialized controller.
                document.readyState = 'interactive';
                scene.dataset.orbitTest = '212-reference';
                for (const id of ['orbitTestModeDescription', 'orbitTestCount', 'orbitTestDimensions',
                    'orbitTestSpacing', 'orbitTestSafety', 'orbitTestCadence']) {
                    const node = document.createElement('span');
                    document.appendChild(node); widgets.set(id, node);
                }
                const originalLookup = document.getElementById;
                document.getElementById = id => widgets.get(id) || originalLookup(id);
                for (const mode of ['reference', 'current']) {
                    const link = document.createElement('a'); link.dataset.orbitMode = mode;
                    document.appendChild(link); links.push(link);
                }
            }
        });
        const mode = query === '?mode=current' ? 'current' : 'reference';
        assert.equal(h.scene.dataset.orbitTest, `212-${mode}`);
        assert.equal(h.container.querySelectorAll('.orbit-card').length, 212);
        h.document.readyState = 'complete'; h.document.dispatch('DOMContentLoaded');
        assert.equal(widgets.get('orbitTestCount').textContent, '212');
        assert.equal(widgets.get('orbitTestSafety').dataset.pass, 'true');
        assert.ok(widgets.get('orbitTestModeDescription').textContent.length > 20);
        assert.equal(links.find(link => link.dataset.orbitMode === mode).getAttribute('aria-current'), 'page');
        const expected = demo.describeLayout(math, 1344, 700, 212, mode, mode === 'reference' ? 2 : 1, mode === 'reference' ? .5 : 1);
        assert.equal(widgets.get('orbitTestDimensions').textContent,
            `${expected.cardWidth.toFixed(2)} × ${expected.cardHeight.toFixed(2)} px`);
        h.frame(16); h.frame(16); h.frame(500);
        assert.match(widgets.get('orbitTestCadence').textContent, /P95.*ms/);
        assert.equal(h.container.querySelectorAll('img').length, 0);
        h.document.hidden = true; h.document.dispatch('visibilitychange');
        assert.equal(h.frameCount, 0, 'Diagnostic sampling pauses while the page is hidden');
        h.document.hidden = false; h.document.dispatch('visibilitychange');
        assert.equal(h.frameCount, 1, 'One diagnostic chain resumes, without duplicating controller initialization');
    }
});

test('rAF cadence diagnostics summarize bounded samples without mislabeling them GPU frames', () => {
    assert.equal(demo.summarizeCadence([]), null);
    assert.equal(demo.summarizeCadence([0, -1, NaN, Infinity]), null);
    const fast = demo.summarizeCadence(Array(180).fill(1000 / 60));
    near(fast.fps, 60); near(fast.p95, 1000 / 60);
    const slow = demo.summarizeCadence([...Array(90).fill(16), ...Array(10).fill(100)]);
    assert.ok(slow.fps < fast.fps); assert.equal(slow.p95, 100);
});
