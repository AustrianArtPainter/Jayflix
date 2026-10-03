/* Fixed 16-card reference, unchanged point algorithm, conservative envelope capacity. */
(function (global) {
    'use strict';
    function fibonacciPoint(index, count) {
        const y = 1 - 2 * (index + .5) / count;
        const ring = Math.sqrt(Math.max(0, 1 - y * y));
        const angle = index * (Math.PI * (3 - Math.sqrt(5)));
        return [ring * Math.sin(angle), y, ring * Math.cos(angle)];
    }
    function endpointChord(count) {
        const a = fibonacciPoint(0, count), b = fibonacciPoint(3, count);
        return Math.hypot(...a.map((value, axis) => value - b[axis]));
    }
    function calculateCapacity(math) {
        const zoom = math.MAX_ZOOM, cardScale = math.MIN_CARD_SCALE;
        const reference = math.computeLayout(1000, 1000, math.createSlots(16));
        const unitWidth = reference.cardWidth / reference.radius * cardScale;
        const unitHeight = reference.cardHeight / reference.radius * cardScale;
        const unitOffset = reference.faceOffset / reference.radius * zoom;
        const requiredChord = Math.hypot(unitWidth, unitHeight, 2 * unitOffset) / (math.CARD_CLEARANCE * zoom);
        // Disjoint caps of angular radius half the required center separation:
        // N <= 2 / (1 - cos(theta/2)). Rationalized to avoid cancellation.
        const pointUpperBound = Math.floor(8 * (1 + Math.sqrt(1 - requiredChord ** 2 / 4)) / requiredChord ** 2);
        // >=621 has zero relaxation iterations under the existing work budget.
        // Exhaustively reject larger N by a necessary pair bound, then verify
        // ALL potentially closer pairs. No monotonic-minimum assumption.
        for (let count = pointUpperBound; count >= 621; count--) {
            if (endpointChord(count) < requiredChord) continue;
            const minimumChord = 2 * Math.sin(math.minimumSeparation(math.createSlots(count)) / 2);
            if (minimumChord < requiredChord) continue;
            return Object.freeze({ count, zoom, cardScale, requiredChord, minimumChord,
                pointUpperBound, nextPairChord: endpointChord(count + 1), unitWidth, unitHeight });
        }
        throw new Error('This preset no longer has a capacity in the unrelaxed Fibonacci range; recalculate explicitly.');
    }
    global.JayflixOrbitCapacity = Object.freeze({ calculateCapacity, endpointChord });
})(typeof window !== 'undefined' ? window : globalThis);
