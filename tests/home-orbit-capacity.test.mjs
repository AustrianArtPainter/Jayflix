// Geometry/DOM-model regressions only, not a Chrome/GPU performance claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createOrbitHarness } from './helpers/orbit-event-harness.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const source = read('js/home-orbit.js'), fixture = read('js/orbit-test.js'), capacity = read('js/orbit-capacity.js');
const scope = vm.createContext({});
for (const code of [source, capacity, fixture]) vm.runInContext(code, scope);
const math = scope.JayflixOrbitMath, demo = scope.JayflixOrbitTest, calculator = scope.JayflixOrbitCapacity;
const result = calculator.calculateCapacity(math);
const near = (a, b, epsilon = 1e-10) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
const chord = slots => 2 * Math.sin(math.minimumSeparation(slots) / 2);

test('The fixed-reference 50% cover / 500% radius capacity is exactly 1,322 under the unchanged envelope rule', () => {
    assert.equal(result.count, 1322);
    assert.equal(result.cardScale, math.MIN_CARD_SCALE);
    assert.equal(result.zoom, math.MAX_ZOOM);
    assert.equal(result.pointUpperBound, 2212);
    near(result.requiredChord, .08502758190110705);
    near(result.minimumChord, .08503823092132054);
    assert.ok(result.minimumChord > result.requiredChord);
    assert.ok(chord(math.createSlots(result.count + 1)) < result.requiredChord);
    assert.ok(result.nextPairChord < result.requiredChord);
    assert.equal(result.count * (result.count - 1) / 2, 873181);
});

test('No larger count up to the independent disjoint-cap bound can pass: exhaustive necessary pair rejection', () => {
    const theta = 2 * Math.asin(result.requiredChord / 2);
    const areaUpper = Math.floor(2 / (1 - Math.cos(theta / 2)));
    assert.equal(areaUpper, result.pointUpperBound);
    // All N above this bound fail even for arbitrary point placements. Every
    // intervening N fails this specific deterministic seed's pair (0,3).
    let rejected = 0;
    for (let count = result.count + 1; count <= areaUpper; count++) {
        assert.ok(calculator.endpointChord(count) < result.requiredChord, `Unexpected candidate ${count}`);
        rejected++;
    }
    assert.equal(rejected, 890);
});

test('Fixed reference dimensions and capacity are proportional on desktop and mobile, with no secret auto-shrink', () => {
    for (const [width, height] of [[100, 520], [296, 520], [712, 1000], [1344, 1200]]) {
        const reference = math.computeLayout(width, height, math.createSlots(16));
        const layout = demo.describeLayout(math, width, height, result.count, 'capacity', 5, .5);
        near(layout.radius, reference.radius * 5);
        near(layout.cardWidth, reference.cardWidth * .5);
        near(layout.cardHeight, reference.cardHeight * .5);
        assert.equal(layout.safe, true);
        assert.equal(demo.describeLayout(math, width, height, result.count + 1, 'capacity', 5, .5).safe, false);
    }
    const desktop = demo.describeLayout(math, 1344, 1200, result.count, 'capacity', 5, .5);
    near(desktop.radius, 1225);
    near(desktop.cardWidth, 50.51222689437697);
    near(desktop.cardHeight, 88.3963970651597);
});

test('Skipping zero-relaxation work preserves every original Fibonacci slot exactly, including all capacity points', () => {
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    for (const count of [621, 847, 1024, result.count]) {
        const slots = math.createSlots(count);
        assert.equal(slots.length, count);
        for (let index = 0; index < count; index++) {
            const y = 1 - 2 * (index + .5) / count, ring = Math.sqrt(Math.max(0, 1 - y * y));
            assert.equal(slots[index].latitude, Math.asin(Math.min(1, Math.max(-1, -y))));
            assert.equal(slots[index].longitude, Math.atan2(ring * Math.sin(index * goldenAngle), ring * Math.cos(index * goldenAngle)));
        }
    }
});

test('Exact neighbor search agrees with an independent full-pair distance oracle; mutable inputs never get stale cache', () => {
    for (const count of [513, 621, 847, 1500]) {
        const slots = math.createSlots(count), points = slots.map(slot => math.positionOnSphere(slot, 1));
        let shortest = Infinity;
        for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) {
            shortest = Math.min(shortest, Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y, points[i].z - points[j].z));
        }
        near(chord(slots), shortest);
        const mutable = slots.map(slot => ({ ...slot }));
        const before = chord(mutable);
        mutable[1] = { ...mutable[0] };
        assert.equal(chord(mutable), 0);
        assert.ok(before > 0);
        const duplicate = slots.map(slot => ({ ...slot }));
        duplicate[3] = { ...duplicate[0] };
        assert.equal(chord(duplicate), 0);
    }
});

test('Full-capacity fixture builder produces ALL 1,322 numbered image-free frames in bounded batches, without virtualization', async () => {
    const h = createOrbitHarness({ count: 0, reducedMotion: true });
    const labels = new Set();
    let generated = 0, yields = 0, batches = 0;
    const built = await demo.buildFramesInBatches(h.document, result.count, {
        schedule: async () => { yields++; },
        onBatch(cards, start) {
            assert.equal(start, generated);
            assert.ok(cards.length <= 256);
            batches++;
            for (const card of cards) {
                assert.equal(card.dataset.orbitPlaceholder, 'true');
                assert.equal(card.querySelectorAll('img, a').length, 0);
                labels.add(card.querySelector('button').textContent);
                generated++;
            }
        }
    });
    assert.equal(built.created, result.count);
    assert.equal(built.cancelled, false);
    assert.equal(generated, result.count);
    assert.equal(labels.size, result.count);
    assert.ok(labels.has('框 0001') && labels.has('框 1322'));
    assert.equal(batches, 6); assert.equal(yields, batches);
});

test('Batch loading cancels promptly, validates counts, and never retains a full-array fixture', async () => {
    const h = createOrbitHarness({ count: 0, reducedMotion: true }), signal = { cancelled: false };
    let batches = 0;
    const built = await demo.buildFramesInBatches(h.document, result.count, {
        signal, onBatch: () => { batches++; }, schedule: async () => { signal.cancelled = true; }
    });
    assert.equal(built.created, 256); assert.equal(built.cancelled, true); assert.equal(batches, 1);
    await assert.rejects(demo.buildFramesInBatches(h.document, -1, { onBatch() {}, schedule() {} }), /Invalid fixture/);
});

test('Capacity controller starts paused at 500% / 50%, defers geometry during batches, paints once ready, and clears', () => {
    const h = createOrbitHarness({ count: 0, sceneData: { orbitTest: 'capacity-reference' } });
    assert.equal(h.scene.dataset.zoom, '5'); assert.equal(h.scene.dataset.cardScale, '0.5');
    assert.equal(h.actions.pause.getAttribute('aria-pressed'), 'true'); assert.equal(h.frameCount, 0);
    h.scene.dataset.orbitTestLoading = 'true';
    const cards = demo.createFrames(h.document, 32);
    h.scene.dispatch('orbit-fixtures-batch', { detail: { cards, start: 0 } });
    const fragment = h.document.createDocumentFragment();
    cards.forEach(card => fragment.appendChild(card)); h.container.appendChild(fragment);
    h.observers.mutation(); h.observers.resize();
    assert.equal(h.counter.textContent, '00');
    assert.equal(h.container.childElementCount, 32);
    assert.equal(cards[0].querySelectorAll('.orbit-card-front').length, 1);
    assert.equal(cards[0].style.transform, undefined);
    h.scene.dataset.orbitTestLoading = 'false'; h.scene.dispatch('orbit-fixtures-ready');
    assert.equal(h.counter.textContent, '32'); assert.equal(h.frameCount, 0);
    for (const card of cards) {
        const xyz = card.style.transform.slice(12, -1).split(',').map(parseFloat);
        near(Math.hypot(...xyz), 1225);
        assert.equal(card.querySelectorAll('.orbit-card-front').length, 1);
    }
    h.pointer('pointerdown', 0, 0); h.pointer('pointermove', 40, 30); assert.equal(h.frameCount, 1);
    h.frame(); h.pointer('pointerup', 40, 30); assert.equal(h.frameCount, 0);
    h.actions.pause.click(); assert.equal(h.frameCount, 1); h.frame();
    h.container.replaceChildren(); h.scene.dispatch('orbit-fixtures-ready'); h.frame();
    assert.equal(h.counter.textContent, '00'); assert.equal(h.frameCount, 0);
    assert.equal(h.actions.pause.getAttribute('aria-pressed'), 'true');
});

function capacityHarness(count = 513, realCalculator = false, controllerSource) {
    const widgets = new Map();
    const bootstrapSource = `${realCalculator ? capacity : `globalThis.JayflixOrbitCapacity = {calculateCapacity: () => ({count:${count}})};`}\n${fixture}`;
    const h = createOrbitHarness({ count: 0, query: '?mode=capacity', bootstrapSource, source: controllerSource,
        setupDocument({ document, scene }) {
            document.readyState = 'interactive';
            scene.dataset.orbitExpectedMin = '0.5';
            scene.dataset.orbitExpectedMax = '5';
            for (const id of ['orbitTestModeDescription', 'orbitTestCount', 'orbitTestDimensions', 'orbitTestSpacing',
                'orbitTestSafety', 'orbitTestCadence', 'orbitTestHeading', 'orbitTestPointLabel', 'orbitCapacityPanel',
                'orbitCapacityLoad', 'orbitCapacityClear', 'orbitCapacityProgress', 'orbitCapacityStatus', 'orbitCapacityWarning', 'orbitTestVersion']) {
                const node = document.createElement(id.includes('Load') || id.includes('Clear') ? 'button' : 'span');
                document.appendChild(node); widgets.set(id, node);
            }
            const original = document.getElementById;
            document.getElementById = id => widgets.get(id) || original(id);
        }
    });
    h.document.readyState = 'complete'; h.document.dispatch('DOMContentLoaded');
    return { h, widgets };
}

test('Actual manual-load UI appends every batch, stays paused on completion, cancels/clears, and can reload', async () => {
    const { h, widgets } = capacityHarness();
    assert.equal(h.container.childElementCount, 0, 'Never auto-load the stress test');
    assert.equal(h.scene.dataset.capacity, '513');
    widgets.get('orbitCapacityLoad').click();
    assert.equal(h.container.childElementCount, 256);
    assert.equal(h.scene.dataset.orbitTestLoading, 'true');
    for (let i = 0; i < 3; i++) { h.frame(); await Promise.resolve(); await Promise.resolve(); }
    assert.equal(h.container.childElementCount, 513);
    assert.equal(h.counter.textContent, '513');
    assert.equal(h.scene.dataset.orbitTestLoading, 'false');
    assert.equal(h.actions.pause.getAttribute('aria-pressed'), 'true');
    assert.match(widgets.get('orbitCapacityStatus').textContent, /完整 513 个空框已就绪/);
    widgets.get('orbitCapacityClear').click();
    assert.equal(h.container.childElementCount, 0);
    widgets.get('orbitCapacityLoad').click();
    assert.equal(h.container.childElementCount, 256);
    widgets.get('orbitCapacityClear').click(); h.frame(); await Promise.resolve(); await Promise.resolve();
    assert.equal(h.container.childElementCount, 0);
    assert.match(widgets.get('orbitCapacityStatus').textContent, /已清空/);
});

test('Actual capacity bootstrap agrees with the new range, generates 1,322 cards and reports all text/element nodes', async () => {
    const { h, widgets } = capacityHarness(result.count, true);
    assert.equal(h.scene.dataset.cardScale, '0.5');
    assert.equal(h.scene.dataset.zoom, '5');
    assert.equal(h.scene.dataset.capacity, '1322');
    assert.match(widgets.get('orbitTestModeDescription').textContent, /封面50%/);
    assert.match(widgets.get('orbitCapacityWarning').textContent, /13,220.*DOM节点（含文字）/);
    assert.doesNotMatch(widgets.get('orbitCapacityWarning').textContent, /61万/);
    widgets.get('orbitCapacityLoad').click();
    for (let i = 0; i < Math.ceil(result.count / 256); i++) {
        h.frame(); await Promise.resolve(); await Promise.resolve();
    }
    assert.equal(h.container.childElementCount, 1322);
    assert.equal(h.container.querySelectorAll('.orbit-card-front').length, 1322);
    assert.equal(h.container.querySelectorAll('img').length, 0);
    assert.equal(h.counter.textContent, '1322');
    assert.equal(h.scene.dataset.orbitTestLoading, 'false');
    assert.equal(h.actions.pause.getAttribute('aria-pressed'), 'true');
    const base = math.computeLayout(1344, 700, math.createSlots(16));
    near(parseFloat(h.scene.style.getPropertyValue('--orbit-card-width')), base.cardWidth * .5);
    const originalPoints = h.container.children.map(card => card.style.transform);
    for (let i = 0; i < 60; i++) h.actions['card-size-out'].click();
    assert.equal(h.actions['card-size-reset'].textContent, '50%');
    assert.equal(h.actions['card-size-out'].disabled, true);
    assert.deepEqual(h.container.children.map(card => card.style.transform), originalPoints);
    for (let i = 0; i < 60; i++) h.actions['zoom-out'].click();
    h.frame();
    near(Number(h.scene.dataset.zoom), .5);
    assert.equal(h.actions.reset.textContent, '50%');
    assert.equal(h.actions['zoom-out'].disabled, true);
    const p = h.container.children[0].style.transform.slice(12, -1).split(',').map(parseFloat);
    near(Math.hypot(...p), base.radius * .5);
    widgets.get('orbitCapacityClear').click();
    assert.equal(h.container.childElementCount, 0);
});

test('HUD reuses geometry when inputs are unchanged instead of scanning a large point set every half second', () => {
    const { h } = capacityHarness();
    let queries = 0;
    h.container.querySelectorAll = () => { queries++; throw new Error('HUD must not query every card'); };
    for (let i = 0; i < 20; i++) h.frame(500);
    assert.equal(queries, 0);
    assert.doesNotMatch(fixture, /container\.querySelectorAll/);
    assert.match(fixture, /key !== previousKey/);
});

test('An unloaded, loading or cleared fixture has no fabricated center distance or false safety failure', async () => {
    const { h, widgets } = capacityHarness();
    const safety = widgets.get('orbitTestSafety');
    assert.equal(widgets.get('orbitTestCount').textContent, '0');
    assert.equal(widgets.get('orbitTestSpacing').textContent, '—');
    assert.equal(widgets.get('orbitTestDimensions').textContent, '—');
    assert.equal(safety.dataset.status, 'empty');
    assert.equal(safety.dataset.pass, undefined);
    assert.match(safety.textContent, /尚未加载/);
    widgets.get('orbitCapacityLoad').click();
    h.frame(500); await Promise.resolve(); await Promise.resolve();
    assert.equal(safety.dataset.status, 'loading');
    assert.equal(safety.dataset.pass, undefined);
    assert.equal(widgets.get('orbitTestSpacing').textContent, '—');
    for (let i = 0; i < 3; i++) { h.frame(500); await Promise.resolve(); await Promise.resolve(); }
    assert.equal(safety.dataset.status, 'safe');
    assert.equal(safety.dataset.pass, 'true');
    assert.notEqual(widgets.get('orbitTestSpacing').textContent, '—');
    for (let i = 0; i < 60; i++) h.actions['zoom-out'].click();
    h.frame(500);
    assert.equal(safety.dataset.status, 'unsafe', 'An actual completed layout failure still must be reported');
    assert.equal(safety.dataset.pass, 'false');
    widgets.get('orbitCapacityClear').click(); h.frame(500);
    assert.equal(safety.dataset.status, 'empty');
    assert.equal(safety.dataset.pass, undefined);
    assert.equal(widgets.get('orbitTestSpacing').textContent, '—');
});

test('A stale 20% controller is detected and cannot generate an 8,046-card preset on the 50% page', () => {
    const stale = source.replace('const MIN_ZOOM = 0.5;', 'const MIN_ZOOM = 0.2;')
        .replace('const MIN_CARD_SCALE = 0.5;', 'const MIN_CARD_SCALE = 0.2;');
    const { h, widgets } = capacityHarness(result.count, true, stale);
    assert.equal(widgets.get('orbitCapacityLoad').disabled, true);
    assert.match(widgets.get('orbitTestHeading').textContent, /版本不一致/);
    assert.match(widgets.get('orbitCapacityStatus').textContent, /50%–500%/);
    assert.equal(widgets.get('orbitTestSafety').dataset.status, 'error');
    widgets.get('orbitCapacityLoad').click();
    assert.equal(h.container.childElementCount, 0);
    assert.equal(h.scene.dataset.capacity, undefined);
    assert.equal(h.frameCount, 0);
});

test('The diagnostic build is visible on narrow screens and all mode links point to the versioned HTML entry', () => {
    const { h, widgets } = capacityHarness(result.count, true);
    assert.equal(demo.BUILD, '20261003-11');
    assert.equal(h.scene.dataset.orbitLoadedBuild, demo.BUILD);
    assert.equal(widgets.get('orbitTestVersion').textContent, `测试版本：${demo.BUILD}`);
    const html = read('orbit-test.html');
    assert.match(html, /id="orbitTestVersion" class="orbit-test-version"/);
    assert.match(html, /data-orbit-expected-min="0.5" data-orbit-expected-max="5"/);
    for (const mode of ['reference', 'current', 'capacity']) {
        assert.ok(html.includes(`orbit-test.html?mode=${mode}&amp;v=${demo.BUILD}`));
    }
});

test('Stress mode is explicit/manual with real DOM and clear control; normal homepage never loads capacity code', () => {
    const html = read('orbit-test.html'), normal = read('index.html'), css = read('css/orbit-test.css');
    assert.match(html, /mode=capacity/); assert.match(html, /orbitCapacityLoad/); assert.match(html, /orbitCapacityClear/);
    assert.match(html, /默认暂停/); assert.match(html, /不保证浏览器流畅/);
    assert.match(css, /data-orbit-test-loading="true".*display: none/);
    assert.ok(html.indexOf('src="js/orbit-capacity.js') < html.indexOf('src="js/orbit-test.js'));
    assert.doesNotMatch(normal, /orbit-capacity|orbit-test|data-orbit-test/);
    assert.doesNotMatch(capacity, /\bfetch\s*\(|XMLHttpRequest|localStorage|sessionStorage/);
});
