// Disclosure contracts and deterministic DOM/events, not browser screenshots.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createOrbitHarness } from './helpers/orbit-event-harness.mjs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const disclosureSource = read('js/home-orbit-toolbar.js');
const controllerSource = read('js/home-orbit.js');

function createToolbarHarness({ readyState = 'complete', home = true, diagnostic = false,
    missing = '', viewportWidth = 1440, reducedMotion = false, count = 16 } = {}) {
    let toolbar, toggle, content, hint;
    const h = createOrbitHarness({ viewportWidth, reducedMotion, count,
        source: controllerSource + '\n' + disclosureSource,
        setupDocument({ document }) {
            document.readyState = readyState;
            document.body = document;
            if (home) document.classList.add('home-page');
            if (diagnostic) document.classList.add('orbit-test-page');
            const ids = new Map();
            const create = (parent, tag, id, className = '') => {
                const node = document.createElement(tag);
                node.id = id; node.className = className;
                parent.appendChild(node); ids.set(id, node);
                return node;
            };
            toolbar = create(document, 'div', 'orbitToolbar', 'orbit-toolbar');
            toolbar.dataset.collapsed = 'true';
            toggle = create(toolbar, 'button', 'orbitToolbarToggle', 'orbit-gesture-icon orbit-toolbar-toggle');
            toggle.setAttribute('type', 'button');
            toggle.setAttribute('aria-expanded', 'false');
            toggle.setAttribute('aria-controls', 'orbitToolbarContent');
            toggle.textContent = '→';
            content = create(toolbar, 'div', 'orbitToolbarContent', 'orbit-toolbar-content');
            content.hidden = true;
            hint = create(content, 'p', 'orbitHint');
            hint.textContent = '任意方向拖动 · 卡片始终朝上 · 双指缩放 · Ctrl + 滚轮缩放';
            content.appendChild(document.querySelector('.orbit-control-stack'));
            const originalGet = document.getElementById;
            document.getElementById = id => id === missing ? null : ids.get(id) || originalGet(id);
        }
    });
    return Object.assign(h, { toolbar, toggle, content, hint });
}

function assertExpanded(h, expanded) {
    assert.equal(h.content.hidden, !expanded);
    assert.equal(h.toolbar.dataset.collapsed, String(!expanded));
    assert.equal(h.toggle.textContent, expanded ? '↗' : '→');
    assert.equal(h.toggle.getAttribute('aria-expanded'), String(expanded));
    const label = expanded ? '收起球体提示和控制栏' : '展开球体提示和控制栏';
    assert.equal(h.toggle.getAttribute('aria-label'), label);
    assert.equal(h.toggle.getAttribute('title'), label);
}

const nodes = root => [root, ...root.children.flatMap(nodes)];
const settings = h => JSON.stringify({ scene: h.scene.dataset, camera: h.camera.style.transform,
    pose: h.wireframe.style.transform, zoom: h.zoomValue.textContent, cover: h.cardValue.textContent,
    speed: h.speedValue.textContent, paused: h.actions.pause.getAttribute('aria-pressed') });

test('The toolbar starts collapsed on every load, including before DOMContentLoaded', () => {
    for (const readyState of ['complete', 'loading']) for (const viewportWidth of [390, 1440]) {
        const h = createToolbarHarness({ readyState, viewportWidth });
        assert.equal(h.content.hidden, true);
        assert.equal(h.toolbar.dataset.collapsed, 'true');
        assert.equal(h.toggle.textContent, '→');
        if (readyState === 'loading') {
            assert.equal(h.toggle.listeners.get('click'), undefined);
            h.document.dispatch('DOMContentLoaded');
        }
        assertExpanded(h, false);
        h.toggle.click(); assertExpanded(h, true);
        const reloaded = createToolbarHarness({ viewportWidth });
        assertExpanded(reloaded, false);
    }
});

test('Arrow clicks toggle the complete existing toolbar without replacing text or control nodes', () => {
    const h = createToolbarHarness(), original = nodes(h.content), copy = h.hint.textContent;
    for (let iteration = 0; iteration < 50; iteration++) {
        const event = h.toggle.click();
        assertExpanded(h, iteration % 2 === 0);
        assert.equal(event.defaultPrevented, false);
        assert.deepEqual(nodes(h.content), original);
        assert.equal(h.hint.textContent, copy);
        assert.equal(h.controls.parentElement, h.content);
    }
});

test('Future functions share the disclosure container and the CSS hides every toolbar child except the trigger', () => {
    const h = createToolbarHarness();
    const future = h.document.createElement('div'), input = h.document.createElement('input');
    input.value = 'user preference'; future.appendChild(input); h.content.appendChild(future);
    let clicks = 0;
    const action = h.document.createElement('button');
    action.addEventListener('click', () => clicks++); future.appendChild(action);
    const directFuture = h.document.createElement('div'); h.toolbar.appendChild(directFuture);
    assertExpanded(h, false);
    assert.equal(future.parentElement.hidden, true);
    assert.match(read('css/home-orbit.css'), /#orbitToolbar\[data-collapsed="true"\] > :not\(#orbitToolbarToggle\) \{ display: none !important; \}/);
    h.toggle.click(); assertExpanded(h, true); action.click();
    h.toggle.click(); assertExpanded(h, false);
    h.toggle.click(); action.click();
    assert.equal(input.value, 'user preference'); assert.equal(clicks, 2);
    assert.equal(future.parentElement, h.content);
    assert.equal(directFuture.parentElement, h.toolbar);
    assert.doesNotMatch(disclosureSource, /orbit-control-stack|orbit-controls|querySelectorAll|MutationObserver/);
});

test('Automatic rotation, dragging and release inertia remain identical while the toolbar toggles', () => {
    const h = createToolbarHarness(), baseline = createOrbitHarness();
    assertExpanded(h, false);
    const initialPose = h.wireframe.style.transform;
    for (let frame = 0; frame < 60; frame++) {
        if (frame % 5 === 0) h.toggle.click();
        h.frame(); baseline.frame();
        assert.equal(settings(h), settings(baseline));
        assert.equal(h.frameCount, baseline.frameCount);
    }
    assert.notEqual(h.wireframe.style.transform, initialPose);
    h.pointer('pointerdown', 0, 0); baseline.pointer('pointerdown', 0, 0);
    for (let step = 1; step <= 30; step++) {
        h.toggle.click();
        h.pointer('pointermove', step * 3, step * 2);
        baseline.pointer('pointermove', step * 3, step * 2);
        h.frame(); baseline.frame();
        assert.equal(settings(h), settings(baseline));
    }
    h.pointer('pointerup', 90, 60); baseline.pointer('pointerup', 90, 60);
    for (let frame = 0; frame < 120; frame++) {
        h.toggle.click(); h.frame(); baseline.frame();
        assert.equal(settings(h), settings(baseline));
        assert.equal(h.frameCount, baseline.frameCount);
    }
});

test('User settings, pause and zero speed survive toggling on mobile and desktop; controls still work when expanded', () => {
    for (const viewportWidth of [390, 1440]) for (const speedEnd of ['in', 'out']) {
        const h = createToolbarHarness({ viewportWidth });
        h.toggle.click();
        h.actions['zoom-in'].click(); h.actions['card-size-in'].click();
        for (let step = 0; step < 5; step++) h.actions[`speed-${speedEnd}`].click();
        h.actions.pause.click();
        const previous = settings(h), frameCount = h.frameCount;
        for (let step = 0; step < 20; step++) h.toggle.click();
        assert.equal(settings(h), previous);
        assert.equal(h.frameCount, frameCount);
        assertExpanded(h, true);
        h.actions.reset.click();
        assert.equal(h.zoomValue.textContent, viewportWidth <= 600 ? '150%' : '200%');
        assert.equal(h.cardValue.textContent, viewportWidth <= 600 ? '150%' : '70%');
        assert.equal(h.speedValue.textContent, '50%');
        assert.equal(h.actions.pause.getAttribute('aria-pressed'), 'true');
        assertExpanded(h, true);
    }
});

test('Toggling adds no animation chains, card nodes, geometry work or observer registrations', () => {
    const h = createToolbarHarness(), originalNodes = nodes(h.document), frameCount = h.frameCount;
    const registrations = Object.values(h.observerStates).map(value => [value.observeCalls, value.disconnectCalls]);
    const original = settings(h);
    for (let iteration = 0; iteration < 200; iteration++) h.toggle.click();
    assert.equal(settings(h), original);
    assert.deepEqual(nodes(h.document), originalNodes);
    assert.equal(h.frameCount, frameCount);
    assert.deepEqual(Object.values(h.observerStates).map(value => [value.observeCalls, value.disconnectCalls]), registrations);
    assert.doesNotMatch(disclosureSource, /requestAnimationFrame|cancelAnimationFrame|setTimeout|setInterval|fetch|XMLHttpRequest|localStorage|sessionStorage|ResizeObserver|IntersectionObserver|\bstate\.[A-Za-z_$]|orbitZoom|orbitCardScale|orbitSpeed|orbitPause/);
});

test('The disclosure script leaves unrelated pages, diagnostic pages and missing widgets untouched', () => {
    for (const options of [{ home: false }, { diagnostic: true },
        { missing: 'orbitToolbar' }, { missing: 'orbitToolbarToggle' }, { missing: 'orbitToolbarContent' }]) {
        const h = createToolbarHarness({ count: 0, ...options });
        assert.equal(h.toggle.listeners.get('click'), undefined);
        assert.equal(h.content.hidden, true);
        h.toggle.click();
        assert.equal(h.toolbar.dataset.collapsed, 'true');
        assert.equal(h.toggle.textContent, '→');
    }
});

test('HTML/CSS provide default hiding, accessible native-button semantics, compact layout and mobile wrapping', () => {
    const html = read('index.html'), css = read('css/home-orbit.css');
    assert.match(html, /<div class="orbit-toolbar" id="orbitToolbar" data-collapsed="true">/);
    assert.match(html, /<button type="button" id="orbitToolbarToggle"[^>]*aria-expanded="false" aria-controls="orbitToolbarContent"[^>]*>→<\/button>/);
    assert.match(html, /<div id="orbitToolbarContent" class="orbit-toolbar-content" hidden>\s*<p id="orbitHint">/);
    assert.match(css, /\.orbit-toolbar-content\[hidden\] \{ display: none; \}/);
    assert.match(css, /\.orbit-toolbar-toggle:focus-visible \{ outline: 1px solid var\(--home-accent\); outline-offset: 1px; \}/);
    assert.match(css, /@media \(max-width: 600px\)[\s\S]*\.orbit-toolbar-content \{ gap: 8px; flex-wrap: wrap; \}/);
    assert.match(css, /\.orbit-toolbar-toggle \{[^}]*width: 28px; height: 28px/);
    assert.doesNotMatch(css, /#orbitToolbar[^{}]*\{[^}]*height:/);
    assert.doesNotMatch(disclosureSource, /addEventListener\('keydown'/);
    assert.match(html, /js\/home-orbit-toolbar\.js\?v=20261003-1/);
    assert.doesNotMatch(read('orbit-test.html'), /orbitToolbar|home-orbit-toolbar\.js/);
});
