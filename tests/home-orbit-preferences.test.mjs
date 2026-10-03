// Run the real controller across separate page instances sharing browser storage.
// These are deterministic persistence/work-budget tests, not browser FPS claims.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createOrbitHarness } from './helpers/orbit-event-harness.mjs';

const KEY = 'jayflix.orbit.preferences.v1';
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
function createStorage(initial) {
    const data = new Map(initial === undefined ? [] : [[KEY, typeof initial === 'string' ? initial : JSON.stringify(initial)]]);
    const calls = { reads: 0, writes: 0 };
    return { data, calls,
        getItem(key) { calls.reads++; return data.get(key) ?? null; },
        setItem(key, value) { calls.writes++; data.set(key, String(value)); },
        clear() { data.clear(); }
    };
}
const harness = (storage, options = {}) => createOrbitHarness({ storage, deferTimers: true, ...options });
const saved = storage => JSON.parse(storage.data.get(KEY));
function assertSettings(h, zoom, cover, speed, paused) {
    near(Number(h.scene.dataset.zoom), zoom);
    near(Number(h.scene.dataset.cardScale), cover);
    assert.equal(Number(h.scene.dataset.speedPercent), speed);
    assert.equal(h.actions.pause.getAttribute('aria-pressed'), String(paused));
    assert.equal(h.actions.pause.querySelector('.orbit-pause-label').textContent, paused ? '继续' : '暂停');
    assert.equal(h.zoomValue.textContent, `${Math.round(zoom * 100)}%`);
    assert.equal(h.cardValue.textContent, `${Math.round(cover * 100)}%`);
    assert.equal(h.speedValue.textContent, `${Math.round(speed)}%`);
    assert.equal(h.camera.style.transform, `scale3d(${h.scene.dataset.zoom}, ${h.scene.dataset.zoom}, ${h.scene.dataset.zoom})`);
}

test('No cache uses current viewport/motion defaults and never overwrites storage on initialization', () => {
    for (const viewportWidth of [390, 600, 601, 1440]) for (const reducedMotion of [false, true]) {
        const storage = createStorage(), h = harness(storage, { viewportWidth, reducedMotion });
        const mobile = viewportWidth <= 600;
        assertSettings(h, mobile ? 1.5 : 2, mobile ? 1.5 : .7, 50, reducedMotion);
        assert.equal(storage.calls.reads, 1); assert.equal(storage.calls.writes, 0);
        assert.equal(h.timerCount, 0);
    }
});

test('Sphere, cover, speed and explicit pause/resume survive refresh and a new page instance', () => {
    for (const viewportWidth of [390, 1440]) {
        const storage = createStorage(), h = harness(storage, { viewportWidth });
        h.actions['zoom-in'].click(); h.actions['card-size-in'].click(); h.actions['speed-in'].click();
        h.actions.pause.click();
        const before = saved(storage);
        assert.deepEqual(Object.keys(before).sort(), ['cardScale', 'paused', 'speedPercent', 'version', 'zoom']);
        assert.equal(h.timerCount, 0); assert.equal(storage.calls.writes, 4);
        const refreshed = harness(storage, { viewportWidth });
        assertSettings(refreshed, before.zoom, before.cardScale, 60, true);
        assert.equal(refreshed.frameCount, 0, 'A restored pause must not create an auto-rotation loop');
        assert.equal(storage.calls.writes, 4, 'Restoring must not overwrite saved values');
        refreshed.actions.pause.click();
        assertSettings(harness(storage, { viewportWidth, reducedMotion: true }), before.zoom, before.cardScale, 60, false);
        assert.equal(saved(storage).paused, false, 'Explicit resume overrides the initial reduced-motion fallback');
    }
});

test('Reset persists current-device scale defaults and 50% speed but preserves pause and orientation', () => {
    for (const viewportWidth of [390, 1440]) for (const paused of [true, false]) {
        const storage = createStorage({ version: 1, zoom: 5, cardScale: 5, speedPercent: 100, paused });
        const h = harness(storage);
        h.viewport(viewportWidth);
        const beforePose = h.wireframe.style.transform;
        h.actions.reset.click();
        const mobile = viewportWidth <= 600;
        assertSettings(h, mobile ? 1.5 : 2, mobile ? 1.5 : .7, 50, paused);
        assert.equal(h.wireframe.style.transform, beforePose);
        assert.equal(storage.calls.writes, 1, 'Combined reset saves one complete snapshot, not intermediate values');
        assert.equal(h.timerCount, 0);
        assertSettings(harness(storage, { viewportWidth }), mobile ? 1.5 : 2, mobile ? 1.5 : .7, 50, paused);
    }
});

test('Saved settings win over responsive defaults, delayed cards and later viewport/recommendation changes', () => {
    const storage = createStorage({ version: 1, zoom: 3.25, cardScale: 2.15, speedPercent: 0, paused: true });
    const h = harness(storage, { count: 0, viewportWidth: 390 });
    assertSettings(h, 3.25, 2.15, 0, true);
    const donor = createOrbitHarness();
    h.container.appendChild(donor.cards[0]); h.observers.mutation();
    h.viewport(1440); h.observers.resize();
    assertSettings(h, 3.25, 2.15, 0, true);
    assert.equal(storage.calls.writes, 0);
});

test('Bad JSON, null, primitives, arrays and unknown schema fall back safely without destroying the cache', () => {
    for (const value of ['{', 'null', 'true', '7', '"bad"', '[]', '{}', '{"version":2,"zoom":4}']) {
        const storage = createStorage(value), h = harness(storage);
        assertSettings(h, 2, .7, 50, false);
        assert.equal(storage.data.get(KEY), value); assert.equal(storage.calls.writes, 0);
        h.actions['zoom-in'].click();
        assert.equal(saved(storage).version, 1); near(saved(storage).zoom, 2.1);
    }
});

test('Validate each field independently; reject wrong types/out-of-range values and retain exact endpoints', () => {
    for (const bad of [null, '1', true, [], {}, -.1, 5.01]) {
        const storage = createStorage({ version: 1, zoom: bad, cardScale: bad, speedPercent: 80, paused: true });
        assertSettings(harness(storage), 2, .7, 80, true);
    }
    for (const bad of [null, '50', true, -1, 101]) {
        assertSettings(harness(createStorage({ version: 1, zoom: 3, cardScale: 4, speedPercent: bad, paused: 'true' })), 3, 4, 50, false);
    }
    for (const [zoom, cover, speed] of [[.5, 5, 0], [5, .5, 100]]) {
        const h = harness(createStorage({ version: 1, zoom, cardScale: cover, speedPercent: speed, paused: true }));
        assertSettings(h, zoom, cover, speed, true);
        assert.equal(h.actions[zoom === 5 ? 'zoom-in' : 'zoom-out'].disabled, true);
        assert.equal(h.actions[cover === 5 ? 'card-size-in' : 'card-size-out'].disabled, true);
        assert.equal(h.actions[speed === 100 ? 'speed-in' : 'speed-out'].disabled, true);
    }
});

test('Unavailable/full storage cannot break controls, reset, gestures or the single animation chain', () => {
    const broken = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceededError'); } };
    for (const storage of [undefined, broken]) {
        const h = harness(storage);
        h.actions['zoom-in'].click(); h.actions['card-size-in'].click(); h.actions['speed-in'].click();
        h.actions.pause.click(); assertSettings(h, 2.1, .8, 60, true);
        h.actions.reset.click(); assertSettings(h, 2, .7, 50, true);
        h.pointer('pointerdown', 0, 0); h.pointer('pointermove', 30, 20); h.frame(); h.pointer('pointerup', 30, 20);
        h.actions.pause.click(); assert.equal(h.frameCount, 1);
    }
});

test('Buttons/keyboard save immediately and bounded repeated input does not write duplicate snapshots', () => {
    const storage = createStorage(), h = harness(storage);
    h.key('+'); near(saved(storage).zoom, 2.1);
    h.key('-'); near(saved(storage).zoom, 2);
    for (let i = 0; i < 80; i++) h.actions['card-size-out'].dispatch('click');
    const writes = storage.calls.writes;
    assert.equal(saved(storage).cardScale, .5);
    for (let i = 0; i < 200; i++) h.actions['card-size-out'].dispatch('click');
    assert.equal(storage.calls.writes, writes); assert.equal(h.timerCount, 0);
});

test('Wheel input coalesces into one pending save and flushes the final value on hide/page exit', () => {
    for (const exit of ['timeout', 'hidden', 'pagehide']) {
        const storage = createStorage(), h = harness(storage);
        for (let i = 0; i < 200; i++) h.scene.dispatch('wheel', { ctrlKey: true, deltaY: -1, deltaMode: 0 });
        assert.equal(storage.calls.writes, 0); assert.equal(h.timerCount, 1);
        if (exit === 'timeout') {
            h.advanceTimers(149); assert.equal(storage.calls.writes, 0); h.advanceTimers(1);
        } else if (exit === 'hidden') {
            h.document.hidden = true; h.document.dispatch('visibilitychange');
        } else h.windowEvents.dispatch('pagehide');
        assert.equal(storage.calls.writes, 1); assert.equal(h.timerCount, 0);
        near(saved(storage).zoom, Number(h.scene.dataset.zoom));
        assertSettings(harness(storage), saved(storage).zoom, .7, 50, false);
    }
});

test('Two-finger zoom saves final proportions on release or cancellation without per-move storage writes', () => {
    for (const ending of ['pointerup', 'pointercancel']) {
        const storage = createStorage(), h = harness(storage);
        h.pointer('pointerdown', 100, 100, { pointerType: 'touch' });
        h.pointer('pointerdown', 200, 100, { id: 2, pointerType: 'touch' });
        for (let i = 0; i < 100; i++) h.pointer('pointermove', 201 + i, 100, { id: 2, pointerType: 'touch', elapsed: 1 });
        assert.equal(storage.calls.writes, 0); assert.equal(h.timerCount, 1);
        h.pointer(ending, 300, 100, { id: 2, pointerType: 'touch' });
        assert.equal(storage.calls.writes, 1); assert.equal(h.timerCount, 0);
        assertSettings(harness(storage), 4, .7, 50, false);
    }
});

test('Continuous rotation/dragging, resize and recommendation refresh never access storage or start save timers', () => {
    const storage = createStorage(), h = harness(storage);
    const reads = storage.calls.reads;
    for (let i = 0; i < 600; i++) h.frame();
    h.pointer('pointerdown', 0, 0);
    for (let i = 1; i <= 1200; i++) { h.pointer('pointermove', i * 10, i * 5); h.frame(); }
    h.pointer('pointerup', 12000, 6000);
    h.observers.resize(); h.observers.mutation();
    assert.equal(storage.calls.reads, reads); assert.equal(storage.calls.writes, 0);
    assert.equal(h.timerCount, 0); assert.equal(h.frameCount, 1);
});

test('Diagnostic presets never read/write homepage preferences; clearing the cache restores defaults', () => {
    const storage = createStorage({ version: 1, zoom: 4, cardScale: 4, speedPercent: 90, paused: false });
    for (const [orbitTest, zoom, cardScale] of [['212-reference', 2, .5], ['212-current', 1, 1], ['capacity-reference', 5, .5]]) {
        const h = harness(storage, { sceneData: { orbitTest } });
        near(Number(h.scene.dataset.zoom), zoom); near(Number(h.scene.dataset.cardScale), cardScale);
        assert.equal(h.actions.pause.getAttribute('aria-pressed'), String(orbitTest === 'capacity-reference'));
        h.actions['zoom-in'].click(); h.actions['card-size-in'].click(); h.actions.pause.click();
        h.windowEvents.dispatch('pagehide');
    }
    assert.equal(storage.calls.reads, 0); assert.equal(storage.calls.writes, 0);
    storage.data.set('viewingHistory', 'untouched'); storage.data.set('searchHistory', 'untouched');
    const h = harness(storage); h.actions['zoom-in'].click();
    assert.equal(storage.data.get('viewingHistory'), 'untouched'); assert.equal(storage.data.get('searchHistory'), 'untouched');
    storage.clear(); assertSettings(harness(storage, { viewportWidth: 390 }), 1.5, 1.5, 50, false);
});
