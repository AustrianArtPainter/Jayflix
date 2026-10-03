/* A homepage presentation layer: existing cards, requests and handlers are reused. */
(function (global) {
    'use strict';

    const AUTO_SPEED = 0.075;
    const DEFAULT_SPEED_PERCENT = 50;
    const MIN_SPEED_PERCENT = 0;
    const MAX_SPEED_PERCENT = 100;
    const INERTIA_STOP_SPEED = 0.0001;
    const DRAG_SENSITIVITY = 0.005;
    const DAMPING = 1.35;
    const MIN_ZOOM = 0.5;
    const MAX_ZOOM = 5;
    const MIN_CARD_SCALE = 0.5;
    const MAX_CARD_SCALE = 5;
    const MAX_DISPLAY_CARDS = 1322;
    const MAX_SPEED = 4.5;
    const RELAX_ITERATIONS = 1600;
    const RELAX_PAIR_BUDGET = 192000;
    const CARD_ASPECT = 1.75;
    const FACE_OFFSET_RATIO = 0.003;
    const CARD_CLEARANCE = 0.98;
    const DRAG_THRESHOLD = 6;
    const REAR_OPACITY = 0.24;
    const FRONT_OPACITY = 1;
    // Hardin–Sloane's 16-point spherical 5-design, not latitude rings:
    // https://neilsloane.com/sphdesigns/dim3/des.3.16.5.txt
    // The centers preserve direction-balanced moments through degree five.
    // Only centers rotate. All complete rectangles stay parallel to the screen.
    // Their default 100% size is bounded by the minimum center chord, retaining
    // the conservative face-offset envelope. Independently enlarging cards is
    // explicitly allowed to overlap; it never repacks centers or grows the radius.
    // No random work runs on load, resize or animation; no global optimum claim.
    const designT = 1 / Math.sqrt(3);
    const designA = 0.9030073291598593, designB = 0.1826964031330545, designC = 0.3888441690006706;
    const designPoints = [
        [designT, designT, designT], [designT, -designT, -designT], [-designT, designT, -designT], [-designT, -designT, designT],
        [-designA, -designB, -designC], [-designA, designB, designC], [designA, -designB, designC], [designA, designB, -designC],
        [-designC, -designA, -designB], [designC, -designA, designB], [designC, designA, -designB], [-designC, designA, designB],
        [-designB, -designC, -designA], [designB, designC, -designA], [-designB, designC, designA], [designB, -designC, designA]
    ];
    const PACKED_SLOTS = Object.freeze(designPoints.map(([x, y, z]) => Object.freeze({
        latitude: -Math.asin(y), longitude: Math.atan2(x, z)
    })));
    const slotCache = new Map();
    const separationCache = new WeakMap();
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

    function createSlots(count) {
        count = Number.isFinite(Number(count)) ? Math.max(0, Math.floor(Number(count))) : 0;
        if (count === 16) return PACKED_SLOTS;
        if (slotCache.has(count)) return slotCache.get(count);
        // Use the actual displayed count, without padding or duplicate cards.
        // Keep this pure geometry function uncapped for capacity calculations;
        // the homepage enforces its DOM limit before requesting these slots.
        const goldenAngle = Math.PI * (3 - Math.sqrt(5));
        let points = Array.from({ length: count }, (_, index) => {
            const y = 1 - 2 * (index + 0.5) / count;
            const ring = Math.sqrt(Math.max(0, 1 - y * y));
            return [ring * Math.sin(index * goldenAngle), y, ring * Math.cos(index * goldenAngle)];
        });
        let best = points, bestDistance = 0;
        const pairs = count * (count - 1) / 2;
        const iterations = pairs ? Math.min(RELAX_ITERATIONS, Math.floor(RELAX_PAIR_BUDGET / pairs)) : 0;
        // Minimise a steep repulsion energy on the unit sphere with a fixed work budget.
        // Keep the best minimum spacing encountered; resize/rotation never reruns this.
        // With zero iterations the old pass only measured/allocated forces;
        // it never moved the Fibonacci seed. Skip that quadratic no-op.
        for (let pass = 0; iterations && pass <= iterations && pairs; pass++) {
            const forces = points.map(() => [0, 0, 0]);
            let minimum = Infinity;
            for (let first = 0; first < count; first++) {
                for (let second = first + 1; second < count; second++) {
                    const delta = points[first].map((value, axis) => value - points[second][axis]);
                    const distance = Math.hypot(...delta);
                    minimum = Math.min(minimum, distance);
                    const weight = Math.max(0.1, distance) ** -10;
                    for (let axis = 0; axis < 3; axis++) {
                        forces[first][axis] += delta[axis] * weight;
                        forces[second][axis] -= delta[axis] * weight;
                    }
                }
            }
            if (minimum > bestDistance) {
                bestDistance = minimum;
                best = points;
            }
            if (pass === iterations) break;
            const step = 0.004 * (1 - pass / (iterations + 200));
            points = points.map((point, index) => {
                const radial = forces[index].reduce((sum, value, axis) => sum + value * point[axis], 0);
                const tangent = forces[index].map((value, axis) => value - radial * point[axis]);
                const limit = Math.min(1, 0.03 / (Math.hypot(...tangent) * step || 1));
                const next = point.map((value, axis) => value + tangent[axis] * step * limit);
                const length = Math.hypot(...next);
                return next.map(value => value / length);
            });
        }
        const slots = Object.freeze(best.map(point => Object.freeze({
            latitude: Math.asin(clamp(-point[1], -1, 1)),
            longitude: Math.atan2(point[0], point[2])
        })));
        if (slotCache.size >= 8) slotCache.delete(slotCache.keys().next().value);
        slotCache.set(count, slots);
        return slots;
    }

    function minimumSeparation(slots) {
        if (separationCache.has(slots)) return separationCache.get(slots);
        const normals = slots.map(slot => positionOnSphere(slot, 1));
        let minimum = Math.PI;
        if (normals.length <= 512) {
            for (let first = 0; first < normals.length; first++) {
                for (let second = first + 1; second < normals.length; second++) {
                    const a = normals[first], b = normals[second];
                    minimum = Math.min(minimum, Math.acos(clamp(a.x * b.x + a.y * b.y + a.z * b.z, -1, 1)));
                }
            }
        } else {
            // Exact nearest pair, not approximate sampling: an initial pair
            // bounds the answer. Every closer pair lies in one of 27 adjacent
            // cubes of that side length. Positions themselves are unchanged.
            const squared = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
            let best = squared(normals[0], normals[3]);
            if (best === 0) return 0;
            const cell = Math.sqrt(best), side = Math.ceil(2 / cell) + 4;
            const numeric = Number.isSafeInteger(side ** 3);
            const key = numeric ? (x, y, z) => x + side * (y + side * z)
                : (x, y, z) => `${x},${y},${z}`;
            const buckets = new Map();
            for (const point of normals) {
                const x = Math.floor((point.x + 1) / cell) + 1;
                const y = Math.floor((point.y + 1) / cell) + 1;
                const z = Math.floor((point.z + 1) / cell) + 1;
                for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
                    const neighbors = buckets.get(key(x + dx, y + dy, z + dz));
                    if (neighbors) for (const other of neighbors) best = Math.min(best, squared(point, other));
                }
                const ownKey = key(x, y, z), bucket = buckets.get(ownKey);
                if (bucket) bucket.push(point); else buckets.set(ownKey, [point]);
            }
            minimum = 2 * Math.asin(Math.min(1, Math.sqrt(best) / 2));
        }
        if (Object.isFrozen(slots) && slots.every(Object.isFrozen)) separationCache.set(slots, minimum);
        return minimum;
    }

    function computeLayout(width, height, slots) {
        const radius = Math.max(0, Math.min(width * 0.34, height * 0.35, 245));
        const faceOffset = radius * FACE_OFFSET_RATIO;
        const minimumAngle = minimumSeparation(slots);
        const minimumChord = 2 * radius * Math.sin(minimumAngle / 2);
        // Retain the conservative W x 1.75W x 2t camera-space envelope, even
        // though only its original +t content face now needs to be rendered.
        // Its Minkowski difference has diagonal sqrt(W² + H² + (2t)²).
        // A smaller diagonal than every center chord excludes intersections for
        // ALL rotations of the centers while the cards stay camera-aligned.
        // Without clearance this is the chosen envelope's size boundary, not
        // an exact planar-card or global point-layout optimality certificate.
        const cardWidth = Math.sqrt(Math.max(0,
            (minimumChord * CARD_CLEARANCE) ** 2 - (2 * faceOffset) ** 2)) / Math.hypot(1, CARD_ASPECT);
        return {
            radius, faceOffset, minimumAngle, minimumChord, cardWidth,
            cardHeight: cardWidth * CARD_ASPECT,
            footerHeight: cardWidth * 0.25,
            perspective: radius * 5.5
        };
    }

    function positionOnSphere(slot, radius) {
        const ringRadius = radius * Math.cos(slot.latitude);
        return {
            x: ringRadius * Math.sin(slot.longitude),
            y: -radius * Math.sin(slot.latitude),
            z: ringRadius * Math.cos(slot.longitude),
            yaw: slot.longitude * 180 / Math.PI,
            pitch: slot.latitude * 180 / Math.PI
        };
    }

    function cardDimensionsFromScale(layout, scale = 1) {
        const cardScale = clamp(Number.isFinite(scale) ? scale : 1, MIN_CARD_SCALE, MAX_CARD_SCALE);
        return {
            cardScale,
            cardWidth: layout.cardWidth * cardScale,
            cardHeight: layout.cardHeight * cardScale,
            footerHeight: layout.footerHeight * cardScale
        };
    }

    // Diagnostic only: keep the original 16-card reference dimensions instead
    // of silently making each rectangle smaller when the point count grows.
    function computeReferenceLayout(width, height, slots) {
        const layout = computeLayout(width, height, slots);
        const reference = computeLayout(width, height, PACKED_SLOTS);
        return { ...layout, cardWidth: reference.cardWidth,
            cardHeight: reference.cardHeight, footerHeight: reference.footerHeight };
    }

    function advanceRotation(angle, velocity, targetVelocity, elapsed) {
        elapsed = Math.max(0, elapsed);
        const decay = Math.exp(-DAMPING * elapsed);
        // Exact integration of dv/dt = -DAMPING * (v - targetVelocity).
        return {
            angle: angle + targetVelocity * elapsed + (velocity - targetVelocity) * (1 - decay) / DAMPING,
            velocity: targetVelocity + (velocity - targetVelocity) * decay
        };
    }

    function velocityFromDrag(distance, elapsed) {
        return clamp(distance * DRAG_SENSITIVITY / Math.max(0.008, elapsed), -MAX_SPEED, MAX_SPEED);
    }

    function normalizeQuaternion(quaternion) {
        const length = Math.hypot(...quaternion);
        return length > 1e-12 && Number.isFinite(length) ? quaternion.map(value => value / length) : [1, 0, 0, 0];
    }

    function rotateOrientation(orientation, vector) {
        const angle = Math.hypot(...vector);
        if (angle < 1e-12) return normalizeQuaternion(orientation);
        const factor = Math.sin(angle / 2) / angle;
        const [a, b, c, d] = [Math.cos(angle / 2), ...vector.map(value => value * factor)];
        const [w, x, y, z] = orientation;
        // Left multiply: both screen-space drag components contribute together,
        // even after crossing the old poles. There is no axis lock or pitch clamp.
        return normalizeQuaternion([
            a * w - b * x - c * y - d * z,
            a * x + b * w + c * z - d * y,
            a * y - b * z + c * w + d * x,
            a * z + b * y - c * x + d * w
        ]);
    }

    function orientationMatrix(orientation) {
        const [w, x, y, z] = normalizeQuaternion(orientation);
        // CSS matrix3d is column-major, with no per-card depth/z-index override.
        return [
            1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y), 0,
            2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x), 0,
            2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y), 0,
            0, 0, 0, 1
        ];
    }

    function inverseOrientationMatrix(orientation) {
        const [w, x, y, z] = normalizeQuaternion(orientation);
        return orientationMatrix([w, -x, -y, -z]);
    }

    function gestureVector(horizontal, vertical) {
        return [vertical ? -vertical * DRAG_SENSITIVITY : 0, horizontal * DRAG_SENSITIVITY, 0];
    }

    function velocityFromGesture(horizontal, vertical, elapsed) {
        const vector = gestureVector(horizontal, vertical).map(value => value / Math.max(0.008, elapsed));
        const limit = Math.min(1, MAX_SPEED / (Math.hypot(...vector) || 1));
        return vector.map(value => value * limit);
    }

    function advanceOrientation(orientation, velocity, targetVelocity, elapsed) {
        elapsed = clamp(Number.isFinite(elapsed) ? elapsed : 0, 0, 1);
        // Keep every component of the release velocity. Its slow continuation
        // follows that same direction, so exponential damping does not snap axes.
        const components = velocity.map((value, axis) => advanceRotation(0, value, targetVelocity[axis], elapsed));
        const rotation = components.map(next => next.angle), speed = components.map(next => next.velocity);
        return { orientation: rotateOrientation(orientation, rotation), velocity: speed };
    }

    function autoSpeedFromPercent(percent) {
        const value = clamp(Number.isFinite(percent) ? percent : DEFAULT_SPEED_PERCENT, MIN_SPEED_PERCENT, MAX_SPEED_PERCENT);
        return AUTO_SPEED * value / DEFAULT_SPEED_PERCENT;
    }

    function zoomFromPinch(initialZoom, initialDistance, currentDistance) {
        if (initialDistance <= 0) return clamp(initialZoom, MIN_ZOOM, MAX_ZOOM);
        return clamp(initialZoom * currentDistance / initialDistance, MIN_ZOOM, MAX_ZOOM);
    }

    function opacityFromDepth(depth, radius) {
        // Spatial interpolation, not a time-based transition: opacity must match
        // the current position even while dragging quickly or reversing direction.
        const fraction = Number.isFinite(depth) && Number.isFinite(radius) && radius > 0
            ? clamp((depth / radius + 1) / 2, 0, 1) : 0.5;
        return REAR_OPACITY + (FRONT_OPACITY - REAR_OPACITY) * fraction;
    }

    global.JayflixOrbitMath = Object.freeze({
        AUTO_SPEED, DEFAULT_SPEED_PERCENT, MIN_SPEED_PERCENT, MAX_SPEED_PERCENT, INERTIA_STOP_SPEED,
        MIN_ZOOM, MAX_ZOOM, MIN_CARD_SCALE, MAX_CARD_SCALE, MAX_DISPLAY_CARDS, DAMPING, DRAG_SENSITIVITY,
        RELAX_ITERATIONS, CARD_ASPECT, DRAG_THRESHOLD,
        FACE_OFFSET_RATIO, CARD_CLEARANCE, REAR_OPACITY, FRONT_OPACITY,
        createSlots, minimumSeparation, computeLayout, computeReferenceLayout, positionOnSphere, cardDimensionsFromScale,
        advanceRotation, velocityFromDrag, autoSpeedFromPercent, zoomFromPinch, opacityFromDepth,
        normalizeQuaternion, rotateOrientation, orientationMatrix, inverseOrientationMatrix,
        gestureVector, velocityFromGesture, advanceOrientation
    });
    if (!global.document) return;

    function initializeOrbit() {
        const document = global.document;
        const scene = document.getElementById('recommendationOrbit');
        const container = document.getElementById('douban-results');
        if (!scene || !container || scene.dataset.orbitReady) return;
        // These opt-in attributes exist only on orbit-test.html. Normal home
        // cards, default sizing and whole-container zoom remain unchanged.
        const capacityTest = scene.dataset.orbitTest === 'capacity-reference';
        const referenceTest = capacityTest || scene.dataset.orbitTest === '212-reference';
        const placeholderTest = referenceTest || scene.dataset.orbitTest === '212-current';
        scene.dataset.orbitReady = 'true';
        container.classList.add('orbit-sphere');

        const wireframe = scene.querySelector('.orbit-wireframe');
        const camera = scene.querySelector('.orbit-camera');
        const loading = scene.querySelector('.orbit-loading');
        const counter = document.getElementById('orbitCount');
        const zoomButton = document.getElementById('orbitZoom');
        const cardSizeButton = document.getElementById('orbitCardScale');
        const speedDisplay = document.getElementById('orbitSpeed');
        const pauseButton = document.getElementById('orbitPause');
        const controls = document.querySelector('.orbit-control-stack');
        const reduceMotion = global.matchMedia('(prefers-reduced-motion: reduce)');
        // Responsive homepage defaults; fixed diagnostic presets remain independent.
        const mobileLayout = placeholderTest ? null : global.matchMedia('(max-width: 600px)');
        const resetButton = document.getElementById('orbitReset');
        function homeDefaults() {
            return mobileLayout?.matches ? { zoom: 1.5, cardScale: 1.5 } : { zoom: 2, cardScale: 0.7 };
        }
        const pointers = new Map();
        const state = {
            orientation: rotateOrientation([1, 0, 0, 0], [0, -0.2, 0]),
            velocity: [0, AUTO_SPEED, 0], autoVelocity: [0, AUTO_SPEED, 0],
            autoDirection: [0, 1, 0], speedPercent: DEFAULT_SPEED_PERCENT,
            zoom: 1, cardScale: 1, cardLayout: null, paused: capacityTest || reduceMotion.matches, dragging: false,
            pinching: false, visible: true, focused: false,
            cards: [], faces: [], positions: [], radius: 0, pinchDistance: 0, pinchZoom: 1,
            suppressClickUntil: 0, frame: 0, previousTime: 0, dirty: false
        };

        function paint() {
            const orientation = state.cards.length ? state.orientation : [1, 0, 0, 0];
            const matrix = orientationMatrix(orientation);
            const centerScale = referenceTest ? state.zoom : 1;
            if (wireframe) wireframe.style.transform = `matrix3d(${matrix.join(',')})`;
            state.cards.forEach((card, index) => {
                const point = state.positions[index];
                if (!point) return;
                // Q * T(p) * inverse(Q) = T(Qp). Flatten that identity here:
                // animate direct transforms, not inherited matrix CSS variables
                // that needlessly invalidate every poster/text descendant.
                const x = (matrix[0] * point.x + matrix[4] * point.y + matrix[8] * point.z) * centerScale;
                const y = (matrix[1] * point.x + matrix[5] * point.y + matrix[9] * point.z) * centerScale;
                const depth = (matrix[2] * point.x + matrix[6] * point.y + matrix[10] * point.z) * centerScale;
                card.style.transform = `translate3d(${x}px, ${y}px, ${depth}px)`;
                // Opacity belongs on the FLAT content face, never the preserve-3d
                // carrier. One real upright face stays interactive at every depth.
                state.faces[index].style.opacity = String(opacityFromDepth(depth, state.radius * centerScale));
            });
            state.dirty = false;
        }

        function canAutoRotate() {
            return !state.dragging && !state.pinching && !state.paused && !state.focused &&
                (state.speedPercent > 0 || Math.hypot(...state.velocity) > INERTIA_STOP_SPEED);
        }

        function schedule() {
            if (!state.frame && state.visible && !document.hidden && state.cards.length && (state.dirty || canAutoRotate())) {
                state.frame = global.requestAnimationFrame(animate);
            }
        }

        function requestPaint() {
            state.dirty = true;
            schedule();
        }

        function animate(time) {
            state.frame = 0;
            if (!state.visible || document.hidden) {
                state.previousTime = 0;
                return;
            }
            // Honor short stalls so inertia decays by wall time, rather than
            // stretching a slow frame into many extra high-speed frames.
            const elapsed = state.previousTime ? clamp((time - state.previousTime) / 1000, 0, 0.25) : 0;
            state.previousTime = time;
            if (canAutoRotate() && elapsed > 0) {
                const next = advanceOrientation(state.orientation, state.velocity, state.autoVelocity, elapsed);
                state.orientation = next.orientation;
                state.velocity = next.velocity;
                // Zero disables the slow continuation, not release inertia. Once
                // its tail is imperceptible, stop instead of running rAF forever.
                if (state.speedPercent === 0 && Math.hypot(...state.velocity) <= INERTIA_STOP_SPEED) state.velocity = [0, 0, 0];
                state.dirty = true;
            }
            if (state.dirty) paint();
            schedule();
        }

        function updateControls() {
            zoomButton.textContent = `${Math.round(state.zoom * 100)}%`;
            zoomButton.setAttribute('aria-label', `当前球体缩放 ${Math.round(state.zoom * 100)}%${placeholderTest ? '，点击重置至100%' : ''}`);
            cardSizeButton.textContent = `${Math.round(state.cardScale * 100)}%`;
            cardSizeButton.setAttribute('aria-label', `当前封面尺寸 ${Math.round(state.cardScale * 100)}%${placeholderTest ? '，点击重置至100%' : ''}`);
            if (speedDisplay) {
                speedDisplay.textContent = `${Math.round(state.speedPercent)}%`;
                speedDisplay.setAttribute('aria-label', `当前自动旋转转速 ${Math.round(state.speedPercent)}%，50%为默认转速`);
                controls.querySelector('[data-orbit-action="speed-out"]').disabled = state.speedPercent <= MIN_SPEED_PERCENT;
                controls.querySelector('[data-orbit-action="speed-in"]').disabled = state.speedPercent >= MAX_SPEED_PERCENT;
            }
            if (resetButton) {
                const defaults = homeDefaults();
                const label = `重置球体至${Math.round(defaults.zoom * 100)}%、封面至${Math.round(defaults.cardScale * 100)}%、转速至${DEFAULT_SPEED_PERCENT}%`;
                resetButton.setAttribute('aria-label', label);
                resetButton.setAttribute('title', label);
            }
            pauseButton.setAttribute('aria-pressed', String(state.paused));
            pauseButton.setAttribute('aria-label', state.paused ? '恢复自动旋转' : '暂停自动旋转');
            pauseButton.querySelector('.orbit-pause-label').textContent = state.paused ? '继续' : '暂停';
            controls.querySelector('[data-orbit-action="zoom-out"]').disabled = state.zoom <= MIN_ZOOM + 0.001;
            controls.querySelector('[data-orbit-action="zoom-in"]').disabled = state.zoom >= MAX_ZOOM - 0.001;
            controls.querySelector('[data-orbit-action="card-size-out"]').disabled = state.cardScale <= MIN_CARD_SCALE + 0.001;
            controls.querySelector('[data-orbit-action="card-size-in"]').disabled = state.cardScale >= MAX_CARD_SCALE - 0.001;
        }

        function setAutoSpeed(percent) {
            const followingAuto = !state.dragging && !state.pinching &&
                Math.hypot(...state.velocity.map((value, axis) => value - state.autoVelocity[axis])) <= INERTIA_STOP_SPEED;
            state.speedPercent = clamp(Number.isFinite(percent) ? percent : DEFAULT_SPEED_PERCENT, MIN_SPEED_PERCENT, MAX_SPEED_PERCENT);
            state.autoVelocity = state.autoDirection.map(value => value * autoSpeedFromPercent(state.speedPercent));
            // Apply a steady-speed adjustment immediately without throwing away
            // a faster, still-decaying gesture or changing its direction.
            if (followingAuto) state.velocity = state.autoVelocity.slice();
            state.previousTime = 0;
            scene.dataset.speedPercent = String(state.speedPercent);
            updateControls();
            schedule();
        }

        function setZoom(zoom) {
            state.zoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
            applySceneScale();
            scene.dataset.zoom = String(state.zoom);
            updateControls();
            if (referenceTest) requestPaint();
        }

        function applySceneScale(updateDimensions = false) {
            camera.style.transform = referenceTest ? 'scale3d(1, 1, 1)'
                : `scale3d(${state.zoom}, ${state.zoom}, ${state.zoom})`;
            if (!state.cardLayout || (!referenceTest && !updateDimensions)) return;
            const centerScale = referenceTest ? state.zoom : 1;
            scene.style.setProperty('--orbit-radius', `${state.radius * centerScale}px`);
            scene.style.setProperty('--orbit-face-offset', `${state.cardLayout.faceOffset * centerScale}px`);
        }

        function applyCardDimensions() {
            if (!state.cardLayout) return;
            const dimensions = cardDimensionsFromScale(state.cardLayout, state.cardScale);
            for (const [name, value] of [
                ['--orbit-card-width', dimensions.cardWidth], ['--orbit-card-height', dimensions.cardHeight],
                ['--orbit-footer-height', dimensions.footerHeight]
            ]) scene.style.setProperty(name, `${value}px`);
        }

        function setCardScale(scale) {
            state.cardScale = clamp(scale, MIN_CARD_SCALE, MAX_CARD_SCALE);
            scene.dataset.cardScale = String(state.cardScale);
            // Only explicit size changes write inherited dimension variables.
            // Animation still updates cached transforms/leaf opacity once per frame.
            applyCardDimensions();
            updateControls();
        }

        function decorateCard(card, index) {
            if (card.classList.contains('orbit-card')) return;
            const title = card.querySelector('button')?.textContent.trim() || card.querySelector('img')?.alt || '影视推荐';
            const front = document.createElement('div');
            front.className = 'orbit-card-front';
            while (card.firstChild) front.appendChild(card.firstChild);
            const ordinal = document.createElement('span');
            ordinal.className = 'orbit-card-number';
            ordinal.textContent = String(index + 1).padStart(2, '0');
            ordinal.setAttribute('aria-hidden', 'true');
            front.appendChild(ordinal);

            // Every position now shows the same readable original face. Do not
            // clone posters, text or actions for an unused mirror/back layer.
            card.appendChild(front);
            card.classList.add('orbit-card');
            card.tabIndex = 0;
            card.setAttribute('role', 'group');
            card.setAttribute('aria-label', title);
            // Both images AND links are native drag sources. Keep their original
            // click handlers/hrefs, but reserve dragging for the sphere gesture.
            card.draggable = false;
            front.querySelectorAll('img, a').forEach(element => { element.draggable = false; });
        }

        function layout() {
            if (capacityTest && scene.dataset.orbitTestLoading === 'true') return;
            const slots = createSlots(state.cards.length);
            const layoutForMode = referenceTest ? computeReferenceLayout : computeLayout;
            state.cardLayout = layoutForMode(scene.clientWidth, scene.clientHeight, slots);
            const { radius, perspective } = state.cardLayout;
            state.radius = radius;
            applySceneScale(true);
            applyCardDimensions();
            scene.style.perspective = `${Math.max(1, perspective)}px`;
            state.positions = slots.map(slot => positionOnSphere(slot, radius));
            paint();
        }

        function reconcileCards() {
            if (capacityTest && scene.dataset.orbitTestLoading === 'true') return;
            const cards = Array.from(container.children).filter(child => child.querySelector('img') ||
                (placeholderTest && child.dataset.orbitPlaceholder === 'true'));
            // Limit only the real homepage presentation, in original DOM/data
            // order. Do not change source data, requests or original actions.
            // Remove excess carriers before decoration and geometry work, rather
            // than retaining thousands of hidden cards in the animation loop.
            state.cards = placeholderTest ? cards : cards.slice(0, MAX_DISPLAY_CARDS);
            if (!placeholderTest && cards.length > MAX_DISPLAY_CARDS) {
                cardObserver.disconnect();
                try { cards.slice(MAX_DISPLAY_CARDS).forEach(card => card.remove()); }
                finally { cardObserver.observe(container, { childList: true }); }
            }
            state.cards.forEach(decorateCard);
            state.faces = state.cards.map(card => card.querySelector('.orbit-card-front'));
            counter.textContent = String(state.cards.length).padStart(2, '0');
            loading.hidden = !Array.from(container.children).some(child => !child.classList.contains('orbit-card') && child.classList.contains('absolute'));
            scene.dataset.state = state.cards.length ? 'ready' : 'empty';
            layout();
            state.previousTime = 0;
            schedule();
        }

        function pointerDistance() {
            const [first, second] = Array.from(pointers.values());
            return Math.hypot(first.x - second.x, first.y - second.y);
        }

        function capture(pointerId) {
            try { scene.setPointerCapture(pointerId); } catch (_) { /* A pointer may already have ended. */ }
        }

        function rememberDirection(vector) {
            const length = Math.hypot(...vector);
            if (length > 1e-12) {
                state.autoDirection = vector.map(value => value / length);
                state.autoVelocity = state.autoDirection.map(value => value * autoSpeedFromPercent(state.speedPercent));
            }
        }

        scene.addEventListener('pointerdown', event => {
            if (event.pointerType === 'mouse' && event.button !== 0) return;
            // Cancel mouse defaults before the first movement can start a native
            // image/link drag. Pointer-event cancellation does not cancel click.
            // Do NOT capture yet: a simple click must still target the original
            // poster/button/link rather than being retargeted to the scene.
            if (event.pointerType === 'mouse') event.preventDefault();
            pointers.set(event.pointerId, {
                x: event.clientX, y: event.clientY,
                startX: event.clientX, startY: event.clientY, startTime: event.timeStamp, time: event.timeStamp
            });
            state.previousTime = 0;
            if (pointers.size >= 2) {
                state.pinching = true;
                state.dragging = false;
                state.velocity = [0, 0, 0];
                state.pinchDistance = pointerDistance();
                state.pinchZoom = state.zoom;
                state.suppressClickUntil = performance.now() + 450;
                for (const pointerId of pointers.keys()) capture(pointerId);
                scene.classList.add('is-dragging');
            }
        }, { capture: true, passive: false });

        scene.addEventListener('pointermove', event => {
            const pointer = pointers.get(event.pointerId);
            if (!pointer) return;
            let horizontal = event.clientX - pointer.x;
            let vertical = event.clientY - pointer.y;
            let elapsed = (event.timeStamp - pointer.time) / 1000;
            pointer.x = event.clientX;
            pointer.y = event.clientY;
            pointer.time = event.timeStamp;
            if (state.pinching && pointers.size >= 2) {
                event.preventDefault();
                setZoom(zoomFromPinch(state.pinchZoom, state.pinchDistance, pointerDistance()));
                state.suppressClickUntil = performance.now() + 450;
                return;
            }
            if (!state.dragging) {
                horizontal = event.clientX - pointer.startX;
                vertical = event.clientY - pointer.startY;
                if (Math.hypot(horizontal, vertical) < DRAG_THRESHOLD) return;
                elapsed = (event.timeStamp - pointer.startTime) / 1000;
                state.dragging = true;
                state.velocity = [0, 0, 0];
                capture(event.pointerId);
                scene.classList.add('is-dragging');
            }
            event.preventDefault();
            const rotation = gestureVector(horizontal, vertical);
            state.orientation = rotateOrientation(state.orientation, rotation);
            if (Math.hypot(horizontal, vertical) > 0.2) {
                rememberDirection(rotation);
                const velocity = velocityFromGesture(horizontal, vertical, elapsed);
                state.velocity = state.velocity.map((value, axis) => value * 0.35 + velocity[axis] * 0.65);
            }
            state.suppressClickUntil = performance.now() + 450;
            // Input may arrive much faster than the screen refresh rate. Keep
            // every rotation sample, but commit DOM/style changes once per frame.
            requestPaint();
        }, { passive: false });

        function finishPointer(event) {
            // A capture transfer emits a BUBBLING loss on the old child owner.
            // That is not pointer cancellation or the end of our new capture.
            // Also ignore a loss if capture has already been re-established.
            if (event.type === 'lostpointercapture' &&
                (event.target !== scene || scene.hasPointerCapture(event.pointerId))) return;
            if (!pointers.has(event.pointerId)) return;
            const lastPointer = pointers.get(event.pointerId);
            const wasGesture = state.dragging || state.pinching;
            if (event.type !== 'pointerup' || (state.dragging && (event.timeStamp - lastPointer.time) > 100)) {
                state.velocity = state.autoVelocity.slice();
            } else if (state.dragging) {
                rememberDirection(state.velocity);
            }
            pointers.delete(event.pointerId);
            if (state.pinching && pointers.size < 2) {
                state.pinching = false;
                for (const point of pointers.values()) {
                    point.startX = point.x;
                    point.startY = point.y;
                    point.time = event.timeStamp;
                    point.startTime = event.timeStamp;
                }
            }
            state.dragging = false;
            scene.classList.remove('is-dragging');
            if (wasGesture) state.suppressClickUntil = performance.now() + 450;
            state.previousTime = 0;
            schedule();
        }

        scene.addEventListener('pointerup', finishPointer);
        scene.addEventListener('pointercancel', finishPointer);
        scene.addEventListener('lostpointercapture', finishPointer);
        // Capture phase runs even if a descendant stops dragstart propagation.
        scene.addEventListener('dragstart', event => event.preventDefault(), { capture: true });
        scene.addEventListener('click', event => {
            if (performance.now() < state.suppressClickUntil) {
                event.preventDefault();
                event.stopImmediatePropagation();
                return;
            }
            // Empty carrier space keeps the card action. Content buttons, links
            // and poster wrappers retain their original handlers without relaying
            // their clicks recursively or duplicating search/API logic.
            const card = event.target.closest('.orbit-card');
            if (card && event.target === card) {
                card.querySelector('.orbit-card-front button')?.click();
            }
        }, true);

        scene.addEventListener('wheel', event => {
            if (!event.ctrlKey && !event.metaKey && !event.altKey) return;
            event.preventDefault();
            const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scene.clientHeight : 1);
            setZoom(state.zoom * Math.exp(-delta * 0.002));
        }, { passive: false });

        scene.addEventListener('keydown', event => {
            const card = event.target.closest('.orbit-card');
            if (card && (event.key === 'Enter' || event.key === ' ')) {
                event.preventDefault();
                card.querySelector('.orbit-card-front button')?.click();
                return;
            }
            if (event.target !== scene) return;
            const arrows = { ArrowLeft: [0, -1, 0], ArrowRight: [0, 1, 0], ArrowUp: [1, 0, 0], ArrowDown: [-1, 0, 0] };
            if (arrows[event.key]) {
                event.preventDefault();
                const axis = arrows[event.key];
                state.orientation = rotateOrientation(state.orientation, axis.map(value => value * 0.18));
                state.velocity = axis.map(value => value * 0.5);
                rememberDirection(axis);
                state.previousTime = 0;
                requestPaint();
            } else if (event.key === '+' || event.key === '=') {
                event.preventDefault();
                setZoom(state.zoom + 0.1);
            } else if (event.key === '-') {
                event.preventDefault();
                setZoom(state.zoom - 0.1);
            } else if (event.key === ' ') {
                event.preventDefault();
                pauseButton.click();
            }
        });

        container.addEventListener('focusin', event => {
            state.focused = Boolean(event.target.closest('.orbit-card') && event.target.matches(':focus-visible'));
        });
        container.addEventListener('focusout', () => {
            state.focused = false;
            state.previousTime = 0;
            schedule();
        });

        controls.addEventListener('click', event => {
            const action = event.target.closest('[data-orbit-action]')?.dataset.orbitAction;
            if (action === 'zoom-in') setZoom(state.zoom + 0.1);
            if (action === 'zoom-out') setZoom(state.zoom - 0.1);
            if (action === 'reset') {
                if (placeholderTest) setZoom(1);
                else {
                    const defaults = homeDefaults();
                    setZoom(defaults.zoom);
                    setCardScale(defaults.cardScale);
                    setAutoSpeed(DEFAULT_SPEED_PERCENT);
                }
            }
            if (action === 'card-size-in') setCardScale(Math.round((state.cardScale + 0.1) * 100) / 100);
            if (action === 'card-size-out') setCardScale(Math.round((state.cardScale - 0.1) * 100) / 100);
            if (action === 'card-size-reset') setCardScale(1);
            if (action === 'speed-in') setAutoSpeed(state.speedPercent + 10);
            if (action === 'speed-out') setAutoSpeed(state.speedPercent - 10);
            if (action === 'pause') {
                state.paused = !state.paused;
                state.previousTime = 0;
                updateControls();
                schedule();
            }
        });

        const cardObserver = new MutationObserver(reconcileCards);
        cardObserver.observe(container, { childList: true });
        if (capacityTest) {
            // Prepare a bounded batch offscreen; only the completed fixture set
            // triggers geometry/paint. Production/API mutation handling is intact.
            scene.addEventListener('orbit-fixtures-batch', event => {
                if (scene.dataset.orbitTestLoading !== 'true') return;
                event.detail.cards.forEach((card, index) => decorateCard(card, event.detail.start + index));
            });
            scene.addEventListener('orbit-fixtures-ready', () => {
                state.paused = true;
                updateControls();
                reconcileCards();
            });
        }
        new ResizeObserver(layout).observe(scene);
        new IntersectionObserver(entries => {
            state.visible = entries[0].isIntersecting;
            state.previousTime = 0;
            schedule();
        }).observe(scene);
        document.addEventListener('visibilitychange', () => {
            state.previousTime = 0;
            schedule();
        });
        reduceMotion.addEventListener('change', event => {
            state.paused = event.matches;
            state.previousTime = 0;
            updateControls();
            schedule();
        });
        // Keep manual sizes across viewport changes; only the reset target updates.
        mobileLayout?.addEventListener('change', updateControls);

        const defaults = homeDefaults();
        setZoom(capacityTest ? MAX_ZOOM : referenceTest ? 2 : placeholderTest ? 1 : defaults.zoom);
        setCardScale(capacityTest ? MIN_CARD_SCALE : referenceTest ? 0.5 : placeholderTest ? 1 : defaults.cardScale);
        setAutoSpeed(DEFAULT_SPEED_PERCENT);
        reconcileCards();
    }

    if (global.document.readyState === 'loading') {
        global.document.addEventListener('DOMContentLoaded', initializeOrbit, { once: true });
    } else {
        initializeOrbit();
    }
})(typeof window !== 'undefined' ? window : globalThis);
