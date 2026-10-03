import test from 'node:test';
import assert from 'node:assert/strict';
import { createOrbitHarness } from './helpers/orbit-event-harness.mjs';

const matrix = value => value.slice(value.indexOf('(') + 1, -1).split(',').map(Number);
const pose = harness => matrix(harness.wireframe.style.transform);
const inverse = value => value.map((_, i) => value[(i % 4) * 4 + Math.floor(i / 4)]);
const position = card => card.style.transform.match(/translate3d\(([^)]+)\)/)[1].split(',').map(parseFloat);
const move = (h, x, y, options) => { const event = h.pointer('pointermove', x, y, options); h.frame(0); return event; };
const near = (a, b, tolerance = 1e-10) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const same = (a, b) => a.forEach((value, index) => near(value, b[index]));
const multiply = (a, b) => Array.from({ length: 16 }, (_, i) => [0, 1, 2, 3].reduce((sum, k) => sum + a[k * 4 + i % 4] * b[Math.floor(i / 4) * 4 + k], 0));
const initial = h => h.math.rotateOrientation([1, 0, 0, 0], [0, -.2, 0]);
const rotated = (h, q, v) => Array.from(h.math.orientationMatrix(h.math.rotateOrientation(q, v)));
const cardDimensions = h => ['--orbit-card-width', '--orbit-card-height', '--orbit-footer-height']
    .map(name => parseFloat(h.scene.style.getPropertyValue(name)));

test('Production initialization decorates all original cards without duplicating actions', () => {
    const h = createOrbitHarness();
    assert.equal(h.scene.dataset.state, 'ready');
    assert.equal(h.counter.textContent, '16');
    assert.equal(h.loading.hidden, true);
    assert.equal(h.frameCount, 1);
    for (const card of h.cards) {
        const front = card.querySelector('.orbit-card-front');
        assert.ok(front);
        assert.equal(card.querySelector('.orbit-card-back'), null);
        assert.equal(card.querySelectorAll('img').length, 1);
        assert.equal(card.querySelectorAll('button').length, 1);
        assert.equal(front.querySelector('button').getAttribute('onclick'), 'originalSearch()');
        assert.equal(front.querySelector('img').getAttribute('onerror'), 'originalFallback()');
        assert.equal(front.getAttribute('inert'), null);
        assert.equal(front.getAttribute('aria-hidden'), null);
        assert.match(card.style.transform, /^translate3d\(/);
        near(Math.hypot(...position(card)), 245);
        assert.equal(h.world.style.getPropertyValue('--orbit-upright-transform'), '');
    }
    h.observers.mutation();
    assert.equal(h.cards[0].querySelectorAll('.orbit-card-front').length, 1);
    const frontImage = h.cards[0].querySelector('.orbit-card-front img');
    frontImage.src = 'fallback.jpg';
    frontImage.dispatch('load');
    assert.equal(h.cards[0].querySelector('img').src, 'fallback.jpg');
});

test('Actual pointer controller accepts diagonal starts and direction changes within one gesture', () => {
    for (const pointerType of ['mouse', 'touch']) for (const horizontal of [true, false]) {
        const h = createOrbitHarness({ reducedMotion: true });
        h.pointer('pointerdown', 0, 0, { pointerType });
        move(h, horizontal ? 40 : 2, horizontal ? 2 : 40, { pointerType });
        const first = h.math.rotateOrientation(initial(h), horizontal ? [-.01, .2, 0] : [-.2, .01, 0]);
        same(pose(h), Array.from(h.math.orientationMatrix(first)));
        move(h, horizontal ? 40 : 100, horizontal ? 100 : 40, { pointerType });
        same(pose(h), rotated(h, first, horizontal ? [-.49, 0, 0] : [0, .49, 0]));
        assert.equal(h.scene.lastCapturedPointer, 1);
        h.pointer('pointerup', 40, 100, { pointerType });
        assert.equal(h.scene.classList.contains('is-dragging'), false);
    }
});

test('Diagonal motion rotates immediately after the distance threshold and still suppresses accidental clicks', () => {
    const h = createOrbitHarness({ reducedMotion: true });
    h.pointer('pointerdown', 0, 0);
    move(h, 30, 30);
    const first = h.math.rotateOrientation(initial(h), [-.15, .15, 0]);
    same(pose(h), Array.from(h.math.orientationMatrix(first)));
    move(h, 130, 30);
    same(pose(h), rotated(h, first, [0, .5, 0]));
    h.pointer('pointerup', 130, 30, { elapsed: 700 });
    assert.equal(h.cards[0].querySelector('.orbit-card-front button').click().defaultPrevented, true);
    assert.equal(h.actionCount, 0);
    h.wait(500);
    h.cards[0].querySelector('.orbit-card-front button').click();
    assert.equal(h.actionCount, 1);
});

test('Small click jitter does not rotate and a slow accumulated diagonal uses the complete gesture duration', () => {
    const h = createOrbitHarness({ reducedMotion: true }), before = pose(h);
    h.pointer('pointerdown', 0, 0);
    move(h, 3, 3, { elapsed: 100 });
    same(pose(h), before);
    h.pointer('pointerup', 3, 3);
    h.cards[0].querySelector('.orbit-card-front button').click();
    assert.equal(h.actionCount, 1);
    h.pointer('pointerdown', 0, 0);
    move(h, 3, 3, { elapsed: 100 });
    move(h, 6, 6, { elapsed: 100 });
    same(pose(h), rotated(h, initial(h), [-.03, .03, 0]));
    h.pointer('pointerup', 6, 6);
    h.actions.pause.click(); // Resume after measuring a slow threshold crossing.
    h.frame();
    const inverseBefore = inverse(pose(h));
    h.frame(16);
    const relative = multiply(pose(h), inverseBefore);
    const angle = Math.acos(Math.max(-1, Math.min(1, (relative[0] + relative[5] + relative[10] - 1) / 2)));
    const initialSpeed = Math.hypot(.03, .03) / .2 * .65;
    near(angle, h.math.advanceRotation(0, initialSpeed, h.math.AUTO_SPEED, .016).angle);
});

test('All card screen bases stay upright after changing-direction diagonal pointer gestures', () => {
    const h = createOrbitHarness({ reducedMotion: true });
    for (let step = 0; step < 30; step++) {
        h.pointer('pointerdown', 0, 0);
        const x = 300 * Math.cos(step), y = 300 * Math.sin(step);
        move(h, x, y);
        move(h, x + 20, y - 30);
        h.pointer('pointerup', x + 20, y - 30);
        const parent = pose(h), layout = h.math.computeLayout(1344, 700, h.math.createSlots(16));
        for (const [index, card] of h.cards.entries()) {
            const actual = position(card), base = h.math.positionOnSphere(h.math.createSlots(16)[index], layout.radius);
            const local = [base.x, base.y, base.z];
            for (let axis = 0; axis < 3; axis++) near(actual[axis], local.reduce((sum, value, i) => sum + value * parent[i * 4 + axis], 0));
            // A pure translation has an identity basis: every complete card is upright.
            assert.match(card.style.transform, /^translate3d\([^)]*\)$/);
            const front = card.querySelector('.orbit-card-front');
            near(Number(front.style.opacity), .62 + .38 * actual[2] / layout.radius);
            assert.equal(front.getAttribute('aria-hidden'), null);
            assert.equal(front.getAttribute('inert'), null);
        }
    }
});

test('Released diagonal and curved motion preserve their full inertia direction while slowing', () => {
    for (const [x, y, curve] of [[50, 0, false], [0, 50, false], [50, 50, false], [-50, 25, false], [50, 0, true]]) {
        const h = createOrbitHarness();
        h.pointer('pointerdown', 0, 0);
        move(h, x, y);
        let release = Array.from(h.math.velocityFromGesture(x, y, .016)).map(value => value * .65);
        if (curve) {
            move(h, x, y + 50);
            const last = Array.from(h.math.velocityFromGesture(0, 50, .016));
            release = release.map((value, index) => value * .35 + last[index] * .65);
        }
        h.pointer('pointerup', x, y + (curve ? 50 : 0));
        h.frame();
        const start = pose(h);
        const inverseBefore = inverse(pose(h));
        for (let i = 0; i < 600; i++) h.frame();
        const relative = multiply(pose(h), inverseBefore);
        const direction = release.map(value => value / Math.hypot(...release));
        for (let axis = 0; axis < 3; axis++) near([0, 1, 2].reduce((sum, index) => sum + relative[index * 4 + axis] * direction[index], 0), direction[axis]);
        assert.notDeepEqual(pose(h), start);
        const previous = pose(h), inversePrevious = inverse(previous);
        h.frame(16);
        const nextRelative = multiply(pose(h), inversePrevious);
        const angle = Math.acos(Math.max(-1, Math.min(1, (nextRelative[0] + nextRelative[5] + nextRelative[10] - 1) / 2)));
        near(angle, h.math.AUTO_SPEED * .016, 2e-7);
        assert.notDeepEqual(pose(h), previous);
    }
});

test('Pinch only zooms, clamps its range, and restarts a fresh free drag with the remaining pointer', () => {
    const h = createOrbitHarness({ reducedMotion: true });
    h.pointer('pointerdown', 0, 0, { pointerType: 'touch' });
    move(h, 40, 0, { pointerType: 'touch' });
    h.pointer('pointerdown', 140, 0, { id: 2, pointerType: 'touch' });
    const before = pose(h);
    const inverseBefore = inverse(before);
    h.pointer('pointermove', 240, 0, { id: 2, pointerType: 'touch' });
    assert.equal(h.scene.dataset.zoom, '4');
    same(pose(h), before);
    h.pointer('pointermove', 1040, 0, { id: 2, pointerType: 'touch' });
    assert.equal(h.scene.dataset.zoom, '5');
    same(pose(h), before);
    h.pointer('pointermove', 41, 0, { id: 2, pointerType: 'touch' });
    assert.equal(h.scene.dataset.zoom, '0.5');
    h.pointer('pointerup', 41, 0, { id: 2, pointerType: 'touch' });
    move(h, 60, 40, { pointerType: 'touch' });
    const relative = multiply(pose(h), inverseBefore);
    same(relative, Array.from(h.math.orientationMatrix(h.math.rotateOrientation([1, 0, 0, 0], [-.2, .1, 0]))));
    assert.notDeepEqual(pose(h), before);
    h.pointer('pointercancel', 60, 40, { pointerType: 'touch' });
    assert.equal(h.scene.classList.contains('is-dragging'), false);
});

test('Clicks and keyboard activation at all depths call the original action once without clones', () => {
    const h = createOrbitHarness({ reducedMotion: true });
    const back = h.cards.find(card => position(card)[2] < 0);
    back.click();
    assert.equal(h.actionCount, 1);
    h.key('Enter', back);
    assert.equal(h.actionCount, 2);
    const front = h.cards.find(card => position(card)[2] > 0);
    front.querySelector('.orbit-card-front button').click();
    assert.equal(h.actionCount, 3);
    h.pointer('pointerdown', 0, 0);
    move(h, 40, 0);
    h.pointer('pointerup', 40, 0);
    back.click();
    assert.equal(h.actionCount, 3);
});

test('Keyboard, controls, visibility and reduced motion retain their production behavior', () => {
    const h = createOrbitHarness();
    h.actions.pause.click();
    assert.equal(h.actions.pause.getAttribute('aria-pressed'), 'true');
    const before = pose(h);
    h.frame(); h.frame(); same(pose(h), before);
    h.key('ArrowUp');
    h.frame(0);
    same(pose(h), rotated(h, initial(h), [.18, 0, 0]));
    h.actions['zoom-in'].click(); near(Number(h.scene.dataset.zoom), 2.1);
    h.actions.reset.click(); near(Number(h.scene.dataset.zoom), 2);
    const ordinaryWheel = h.scene.dispatch('wheel', { deltaY: 200, deltaMode: 0 });
    assert.equal(ordinaryWheel.defaultPrevented, false);
    const zoomWheel = h.scene.dispatch('wheel', { deltaY: 200, deltaMode: 0, ctrlKey: true });
    assert.equal(zoomWheel.defaultPrevented, true);
    near(Number(h.scene.dataset.zoom), 2 * Math.exp(-.4));
    h.media.dispatch('change', { matches: false });
    h.frame(); h.frame();
    const visible = pose(h);
    h.observers.intersection([{ isIntersecting: false }]);
    h.frame();
    assert.equal(h.frameCount, 0);
    h.observers.intersection([{ isIntersecting: true }]);
    h.frame();
    same(pose(h), visible);
    h.frame(); assert.notDeepEqual(pose(h), visible);
});

test('Empty results and resizing do not introduce imaginary cards or fail initialization', () => {
    const empty = createOrbitHarness({ count: 0 });
    assert.equal(empty.scene.dataset.state, 'empty');
    assert.equal(empty.counter.textContent, '00');
    assert.equal(empty.frameCount, 0);
    const h = createOrbitHarness({ reducedMotion: true });
    h.scene.clientWidth = 100;
    h.observers.resize();
    near(parseFloat(h.scene.style.getPropertyValue('--orbit-radius')), 34);
    assert.ok(parseFloat(h.scene.style.getPropertyValue('--orbit-card-width')) < 54);
    assert.equal(h.cards.length, 16);
});

test('An entire rotation continuously fades the same readable face without a midpoint switch', () => {
    const h=createOrbitHarness({reducedMotion:true}), card=h.cards[0], face=card.querySelector('.orbit-card-front');
    const center=position(card).map(value=>value/245);
    const angle=Math.acos(Math.max(-1,Math.min(1,center[2]))), axis=[center[1],-center[0],0], length=Math.hypot(...axis);
    const vector=axis.map(value=>value*angle/length);
    h.pointer('pointerdown',0,0);
    move(h,vector[1]/h.math.DRAG_SENSITIVITY,-vector[0]/h.math.DRAG_SENSITIVITY);
    h.pointer('pointerup',0,0);
    near(Number(face.style.opacity),1);
    const originalImage=face.querySelector('img'), originalButton=face.querySelector('button');
    h.pointer('pointerdown',0,0);
    let previous=Number(face.style.opacity);
    // A two-degree first move clears the existing six-pixel click-jitter threshold.
    for(let degree=2;degree<=360;degree+=2){
        move(h,0,-degree*Math.PI/180/h.math.DRAG_SENSITIVITY);
        const opacity=Number(face.style.opacity);
        near(opacity,.62+.38*Math.cos(degree*Math.PI/180));
        assert.ok(Math.abs(opacity-previous)<=.38*2*Math.PI/180+1e-10);
        assert.equal(card.querySelector('.orbit-card-front'),face);
        assert.equal(face.querySelector('img'),originalImage);
        assert.equal(face.querySelector('button'),originalButton);
        assert.equal(card.querySelector('.orbit-card-back'),null);
        assert.equal(face.getAttribute('inert'),null);
        assert.match(card.style.transform,/^translate3d\([^)]*\)$/);
        previous=opacity;
    }
    h.pointer('pointerup',0,0);
    h.wait(500);
    originalButton.click();assert.equal(h.actionCount,1);
});

test('Zoom and resize preserve opacity at each normalized depth without duplicate faces', () => {
    const h=createOrbitHarness({reducedMotion:true});
    h.pointer('pointerdown',0,0);move(h,130,-80);h.pointer('pointerup',130,-80);
    const alphas=h.cards.map(card=>Number(card.querySelector('.orbit-card-front').style.opacity));
    h.actions['zoom-in'].click();h.actions['zoom-out'].click();h.actions.reset.click();
    for(const width of [296,100,1344]){
        h.scene.clientWidth=width;h.observers.resize();
        const radius=parseFloat(h.scene.style.getPropertyValue('--orbit-radius'));
        for(const [index,card] of h.cards.entries()){
            const face=card.querySelector('.orbit-card-front');
            near(Number(face.style.opacity),alphas[index]);
            near(Number(face.style.opacity),.62+.38*position(card)[2]/radius);
            assert.equal(card.querySelectorAll('img').length,1);
        }
    }
});

test('Poster, title and link starts prevent mouse defaults before descendant handlers without early click retargeting', () => {
    for (const selector of ['.original-overlay', 'button', 'a']) {
        const h = createOrbitHarness({ reducedMotion: true }), target = h.cards[0].querySelector(selector);
        let preventedAtTarget = false;
        target.addEventListener('pointerdown', event => { preventedAtTarget = event.defaultPrevented; });
        const down = h.pointer('pointerdown', 0, 0, { target });
        assert.equal(down.defaultPrevented, true);
        assert.equal(preventedAtTarget, true);
        assert.equal(h.scene.hasPointerCapture(1), false, 'A plain click must retain its original target');
        move(h, 3, 3, { target });
        h.pointer('pointerup', 3, 3, { target });
        const click = target.click();
        assert.equal(click.defaultPrevented, false);
        assert.equal(h.actionCount, selector === 'a' ? 0 : 1);
        assert.equal(h.linkCount, selector === 'a' ? 1 : 0);
    }
});

test('Images and links opt out of native dragging without replacing original handlers or hrefs', () => {
    const h = createOrbitHarness();
    for (const [index, card] of h.cards.entries()) {
        assert.equal(card.draggable, false);
        assert.equal(card.querySelector('img').draggable, false);
        const link = card.querySelector('a');
        assert.equal(link.draggable, false);
        assert.equal(link.getAttribute('href'), `https://movie.douban.com/subject/${index + 1}/`);
        assert.equal(link.getAttribute('target'), '_blank');
        assert.equal(link.getAttribute('rel'), 'noopener noreferrer');
        assert.equal(link.getAttribute('onclick'), 'event.stopPropagation();');
    }
    const button = h.cards[0].querySelector('button');
    h.pointer('pointerdown', 0, 0, { target: button });
    h.pointer('pointerup', 0, 0, { target: button });
    const modified = h.cards[0].querySelector('a').dispatch('click', { ctrlKey: true, metaKey: true });
    assert.equal(modified.defaultPrevented, false);
    assert.equal(h.linkCount, 1);
});

test('Implicit touch capture transfer from a poster must not finish the continuing sphere drag', () => {
    const h = createOrbitHarness({ reducedMotion: true });
    const target = h.cards[0].querySelector('.original-overlay');
    let childLosses = 0;
    target.addEventListener('lostpointercapture', () => { childLosses++; });
    h.pointer('pointerdown', 0, 0, { target, pointerType: 'touch' });
    move(h, 12, 0, { target, pointerType: 'touch' });
    const first = h.math.rotateOrientation(initial(h), [0, .06, 0]);
    same(pose(h), Array.from(h.math.orientationMatrix(first)));
    move(h, 72, 30, { target, pointerType: 'touch' });
    assert.equal(childLosses, 1);
    assert.equal(h.scene.hasPointerCapture(1), true);
    assert.equal(h.scene.classList.contains('is-dragging'), true);
    same(pose(h), rotated(h, first, [-.15, .3, 0]));
    h.pointer('pointerup', 72, 30, { target, pointerType: 'touch' });
    assert.equal(h.scene.classList.contains('is-dragging'), false);
});

test('Dragging starts on any original card descendant, stays captured outside the scene and suppresses only gesture clicks', () => {
    for (const selector of ['img', '.original-overlay', 'button', 'a']) {
        const h = createOrbitHarness({ reducedMotion: true }), target = h.cards[0].querySelector(selector);
        h.pointer('pointerdown', 0, 0, { target });
        move(h, 12, 0, { target });
        const first = h.math.rotateOrientation(initial(h), [0, .06, 0]);
        move(h, 72, 30, { target: h.document }); // Mouse has left every card and the scene.
        same(pose(h), rotated(h, first, [-.15, .3, 0]));
        assert.equal(h.scene.classList.contains('is-dragging'), true);
        h.pointer('pointerup', 72, 30, { target: h.document });
        assert.equal(target.click().defaultPrevented, true);
        assert.equal(h.actionCount + h.linkCount, 0);
        h.wait(500);
        assert.equal(target.click().defaultPrevented, false);
        assert.equal(h.actionCount + h.linkCount, 1);
    }
});

test('Capture-phase native drag cancellation survives a descendant stopping propagation and does not terminate the gesture', () => {
    const h = createOrbitHarness({ reducedMotion: true }), link = h.cards[0].querySelector('a');
    link.addEventListener('dragstart', event => event.stopPropagation());
    h.pointer('pointerdown', 0, 0, { target: link });
    move(h, 12, 0, { target: link });
    assert.equal(link.dispatch('dragstart').defaultPrevented, true);
    move(h, 72, 30, { target: link });
    assert.equal(h.scene.classList.contains('is-dragging'), true);
    const first = h.math.rotateOrientation(initial(h), [0, .06, 0]);
    same(pose(h), rotated(h, first, [-.15, .3, 0]));
});

test('Real capture loss and pointer cancellation finish safely; a subsequent gesture still works', () => {
    for (const cancel of [true, false]) {
        const h = createOrbitHarness({ reducedMotion: true });
        h.pointer('pointerdown', 0, 0);
        move(h, 20, 0);
        move(h, 40, 0); // Commit the scene's pending capture.
        const before = pose(h);
        if (cancel) h.pointer('pointercancel', 40, 0);
        else h.scene.releasePointerCapture(1);
        move(h, 100, 100);
        same(pose(h), before);
        assert.equal(h.scene.classList.contains('is-dragging'), false);
        h.pointer('pointerdown', 0, 0);
        move(h, 30, 30);
        assert.notDeepEqual(pose(h), before);
    }
});

test('Pinch transfers capture from both card descendants without an accidental single-pointer cancellation', () => {
    const h = createOrbitHarness({ reducedMotion: true });
    const first = h.cards[0].querySelector('button'), second = h.cards[1].querySelector('button');
    h.pointer('pointerdown', 0, 0, { pointerType: 'touch', target: first });
    h.pointer('pointermove', 3, 0, { pointerType: 'touch', target: first });
    h.pointer('pointerdown', 103, 0, { pointerType: 'touch', target: second, id: 2 });
    h.pointer('pointermove', -47, 0, { pointerType: 'touch', target: first });
    h.pointer('pointermove', 153, 0, { pointerType: 'touch', target: second, id: 2 });
    assert.equal(h.scene.dataset.zoom, '4');
    assert.equal(h.scene.hasPointerCapture(1), true);
    assert.equal(h.scene.hasPointerCapture(2), true);
    h.pointer('pointerup', 153, 0, { pointerType: 'touch', target: second, id: 2 });
    move(h, -17, 30, { pointerType: 'touch', target: first });
    same(pose(h), rotated(h, initial(h), [-.15, .15, 0]));
});

test('Right and middle mouse presses retain defaults and cannot start sphere dragging', () => {
    for (const button of [1, 2]) {
        const h = createOrbitHarness({ reducedMotion: true }), target = h.cards[0].querySelector('a'), before = pose(h);
        const down = h.pointer('pointerdown', 0, 0, { button, target });
        assert.equal(down.defaultPrevented, false);
        move(h, 40, 40, { button, target });
        same(pose(h), before);
        assert.equal(h.scene.hasPointerCapture(1), false);
        assert.equal(target.dispatch('contextmenu').defaultPrevented, false);
    }
});

test('Independent card controls scale complete portrait cards without changing centers, radius, depth opacity or camera zoom', () => {
    const h = createOrbitHarness({ reducedMotion: true }), baseDimensions = cardDimensions(h);
    move(h, 0, 0);
    const transforms = h.cards.map(card => card.style.transform);
    const alphas = h.cards.map(card => card.querySelector('.orbit-card-front').style.opacity);
    const radius = h.scene.style.getPropertyValue('--orbit-radius'), camera = h.camera.style.transform;
    assert.equal(h.scene.dataset.cardScale, '0.7');
    assert.equal(h.cardValue.textContent, '70%');
    for (let click = 1; click <= 43; click++) {
        h.actions['card-size-in'].click();
        const scale = Math.round((.7 + click / 10) * 100) / 100;
        cardDimensions(h).forEach((value, index) => near(value, baseDimensions[index] * scale / .7));
        assert.equal(h.cardValue.textContent, `${70 + click * 10}%`);
        assert.equal(h.scene.dataset.cardScale, String(scale));
        assert.equal(h.camera.style.transform, camera);
        assert.equal(h.scene.style.getPropertyValue('--orbit-radius'), radius);
        assert.equal(h.scene.dataset.zoom, '2');
        assert.deepEqual(h.cards.map(card => card.style.transform), transforms);
        assert.deepEqual(h.cards.map(card => card.querySelector('.orbit-card-front').style.opacity), alphas);
    }
    assert.equal(h.actions['card-size-in'].disabled, true);
    // Even a synthetic click bypassing the disabled UI must clamp the range.
    h.actions['card-size-in'].dispatch('click');
    assert.equal(h.scene.dataset.cardScale, '5');
    for (let click = 0; click < 50; click++) h.actions['card-size-out'].click();
    assert.equal(h.scene.dataset.cardScale, '0.5');
    assert.equal(h.actions['card-size-out'].disabled, true);
    h.actions['card-size-out'].dispatch('click');
    assert.equal(h.scene.dataset.cardScale, '0.5');
    cardDimensions(h).forEach((value, index) => near(value, baseDimensions[index] * .5 / .7));
    h.actions.reset.click();
    assert.equal(h.scene.dataset.cardScale, '0.7');
    assert.equal(h.actions['card-size-in'].disabled, false);
    assert.equal(h.actions['card-size-out'].disabled, false);
    same(cardDimensions(h), baseDimensions);
});

test('Sphere buttons reach 50% and 500% without changing covers; the single reset restores both desktop defaults', () => {
    const h = createOrbitHarness({ reducedMotion: true });
    for (let i = 0; i < 5; i++) h.actions['card-size-in'].click();
    const cover = cardDimensions(h);
    for (let i = 0; i < 50; i++) h.actions['zoom-in'].click();
    near(Number(h.scene.dataset.zoom), 5);
    assert.equal(h.zoomValue.textContent, '500%');
    assert.equal(h.actions['zoom-in'].disabled, true);
    assert.equal(h.camera.style.transform, `scale3d(${h.scene.dataset.zoom}, ${h.scene.dataset.zoom}, ${h.scene.dataset.zoom})`);
    h.actions['zoom-in'].dispatch('click');
    near(Number(h.scene.dataset.zoom), 5);
    for (let i = 0; i < 60; i++) h.actions['zoom-out'].click();
    near(Number(h.scene.dataset.zoom), .5);
    assert.equal(h.zoomValue.textContent, '50%');
    assert.equal(h.actions['zoom-out'].disabled, true);
    assert.equal(h.scene.dataset.cardScale, '1.2');
    same(cardDimensions(h), cover);
    h.actions.reset.click();
    assert.equal(h.actions.reset.textContent, '重置');
    near(Number(h.scene.dataset.zoom), 2);
    cardDimensions(h).forEach((value, index) => near(value, cover[index] * .7 / 1.2));
    assert.equal(h.cardValue.textContent, '70%');
    assert.match(h.zoomValue.getAttribute('aria-label'), /球体缩放 200%/);
    assert.match(h.cardValue.getAttribute('aria-label'), /封面尺寸 70%/);
});

test('Wheel and keyboard sphere zoom respect the expanded range without changing cover size', () => {
    const h = createOrbitHarness({ reducedMotion: true });
    h.actions['card-size-out'].click();
    const cover = cardDimensions(h);
    h.scene.dispatch('wheel', { ctrlKey: true, deltaY: -10000, deltaMode: 0 });
    near(Number(h.scene.dataset.zoom), 5);
    assert.equal(h.actions['zoom-in'].disabled, true);
    h.scene.dispatch('wheel', { metaKey: true, deltaY: 10000, deltaMode: 0 });
    near(Number(h.scene.dataset.zoom), .5);
    assert.equal(h.actions['zoom-out'].disabled, true);
    for (let i = 0; i < 60; i++) h.key('+');
    near(Number(h.scene.dataset.zoom), 5);
    for (let i = 0; i < 60; i++) h.key('-');
    near(Number(h.scene.dataset.zoom), .5);
    same(cardDimensions(h), cover);
    assert.equal(h.scene.dataset.cardScale, '0.6');
});

test('Cover proportion persists through resize and card reconciliation, including an initially empty response', () => {
    for (const count of [0, 16]) {
        const h = createOrbitHarness({ count, reducedMotion: true });
        for (let i = 0; i < 10; i++) h.actions['card-size-in'].click();
        if (!count) {
            const card = h.document.createElement('div');
            card.append(h.document.createElement('img'), h.document.createElement('button'));
            h.container.appendChild(card);
        }
        h.observers.mutation();
        for (const width of [100, 296, 712, 1344]) {
            h.scene.clientWidth = width;
            h.observers.resize();
            const layout = h.math.computeLayout(width, 700, h.math.createSlots(h.container.children.length));
            same(cardDimensions(h), [layout.cardWidth * 1.7, layout.cardHeight * 1.7, layout.footerHeight * 1.7]);
            near(parseFloat(h.scene.style.getPropertyValue('--orbit-radius')), layout.radius);
            assert.equal(h.scene.dataset.cardScale, '1.7');
            assert.equal(h.cardValue.textContent, '170%');
        }
    }
});

test('Enlarged covers retain native-drag protection, free pointer rotation, readable faces and original actions', () => {
    const h = createOrbitHarness({ reducedMotion: true });
    for (let i = 0; i < 10; i++) h.actions['card-size-in'].click();
    const dimensions = cardDimensions(h), target = h.cards[0].querySelector('.original-overlay');
    assert.equal(h.pointer('pointerdown', 0, 0, { target }).defaultPrevented, true);
    move(h, 60, -40, { target });
    move(h, 120, 30, { target });
    h.pointer('pointerup', 120, 30, { target });
    assert.equal(target.click().defaultPrevented, true);
    h.wait(500);
    target.click();
    assert.equal(h.actionCount, 1);
    same(cardDimensions(h), dimensions);
    for (const card of h.cards) {
        assert.match(card.style.transform, /^translate3d\([^)]*\)$/);
        near(Number(card.querySelector('.orbit-card-front').style.opacity), .62 + .38 * position(card)[2] / 245);
        assert.equal(card.querySelectorAll('img').length, 1);
        assert.equal(card.querySelector('a').draggable, false);
    }
});
