// Independent geometric oracle. Do not reuse the production layout/size calculation.
const dot = (a, b) => a.reduce((sum, value, axis) => sum + value * b[axis], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export function rotateBox(box, vector) {
    const magnitude = Math.hypot(...vector), axis = magnitude ? vector.map(value => value / magnitude) : [0, 1, 0];
    const rotate = point => {
        const perpendicular = cross(axis, point), projection = dot(axis, point);
        return point.map((value, index) => value * Math.cos(magnitude) + perpendicular[index] * Math.sin(magnitude) + axis[index] * projection * (1 - Math.cos(magnitude)));
    };
    return { ...box, center: rotate(box.center), axes: box.axes.map(rotate) };
}

export function cardBox(slot, layout, angle = 0, zoom = 1) {
    const { latitude: lat, longitude: lon } = slot;
    const normal = [Math.sin(lon) * Math.cos(lat), -Math.sin(lat), Math.cos(lon) * Math.cos(lat)];
    const horizontal = [Math.cos(lon), 0, -Math.sin(lon)];
    const vertical = [Math.sin(lon) * Math.sin(lat), Math.cos(lat), Math.cos(lon) * Math.sin(lat)];
    const roll = slot.roll || 0;
    const right = horizontal.map((value, axis) => value * Math.cos(roll) + vertical[axis] * Math.sin(roll));
    const down = vertical.map((value, axis) => value * Math.cos(roll) - horizontal[axis] * Math.sin(roll));
    // An independent Rodrigues rotation, not the production quaternion code.
    const vector = Array.isArray(angle) ? angle : [0, angle, 0];
    const magnitude = Math.hypot(...vector);
    const axis = magnitude ? vector.map(value => value / magnitude) : [0, 1, 0];
    const rotate = point => {
        const perpendicular = cross(axis, point), projection = dot(axis, point);
        return point.map((value, index) => value * Math.cos(magnitude) + perpendicular[index] * Math.sin(magnitude) + axis[index] * projection * (1 - Math.cos(magnitude)));
    };
    return {
        center: rotate(normal).map(value => value * layout.radius * zoom),
        axes: [rotate(right), rotate(down), rotate(normal)],
        half: [layout.cardWidth / 2, layout.cardHeight / 2, layout.faceOffset].map(value => value * zoom)
    };
}

export function billboardBox(slot, layout, angle = 0, zoom = 1) {
    // Independent Rodrigues rotation moves the CENTER only. Screen-facing
    // cards keep this common camera-space basis at every sphere orientation.
    const box = cardBox(slot, layout, angle, zoom);
    return { ...box, axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] };
}

export function footprint(box) {
    const unit = point => { const length = Math.hypot(...point); return point.map(value => value / length); };
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => unit(box.center.map((value, axis) =>
        value + u * box.half[0] * box.axes[0][axis] + v * box.half[1] * box.axes[1][axis])));
    const edges = corners.map((first, index) => {
        const second = corners[(index + 1) % 4], normal = unit(cross(first, second));
        return { first, second, normal };
    });
    return { corners, edges };
}

export function distanceToFootprint(ray, shape) {
    if (shape.edges.every(edge => dot(edge.normal, ray) >= -1e-12)) return 0;
    let closest = Math.max(...shape.corners.map(corner => dot(corner, ray)));
    for (const edge of shape.edges) {
        const projection = dot(ray, edge.normal);
        const point = ray.map((value, axis) => value - projection * edge.normal[axis]);
        const length = Math.hypot(...point);
        if (length < 1e-12) continue;
        const candidate = point.map(value => value / length);
        if (dot(cross(edge.first, candidate), edge.normal) >= -1e-12 &&
            dot(cross(candidate, edge.second), edge.normal) >= -1e-12) closest = Math.max(closest, dot(candidate, ray));
    }
    return Math.acos(Math.max(-1, Math.min(1, closest)));
}

export function coveringRadius(normals) {
    // Enumerate supporting triangular faces of the convex hull. Their normals
    // are the spherical Voronoi vertices: this examines the whole sphere.
    let largest = 0;
    for (let i = 0; i < normals.length; i++) for (let j = i + 1; j < normals.length; j++) for (let k = j + 1; k < normals.length; k++) {
        const first = normals[j].map((value, axis) => value - normals[i][axis]);
        const second = normals[k].map((value, axis) => value - normals[i][axis]);
        const axis = cross(first, second), length = Math.hypot(...axis);
        if (length < 1e-10) continue;
        for (const sign of [-1, 1]) {
            const direction = axis.map(value => sign * value / length), contact = dot(direction, normals[i]);
            if (normals.every(normal => dot(normal, direction) <= contact + 1e-10)) largest = Math.max(largest, Math.acos(Math.max(-1, Math.min(1, contact))));
        }
    }
    return largest;
}

export function boxesOverlap(a, b) {
    // Separating Axis Theorem for two oriented boxes: 3+3 face normals and 9 edge axes.
    // The box contains both real card faces, all four corners, footer and border.
    const delta = b.center.map((value, axis) => value - a.center[axis]);
    const axes = [...a.axes, ...b.axes, ...a.axes.flatMap(first => b.axes.map(second => cross(first, second)))];
    for (const candidate of axes) {
        const length = Math.hypot(...candidate);
        if (length < 1e-10) continue;
        const axis = candidate.map(value => value / length);
        const extent = box => box.axes.reduce((sum, basis, index) => sum + Math.abs(dot(axis, basis)) * box.half[index], 0);
        if (Math.abs(dot(delta, axis)) > extent(a) + extent(b) + 1e-7) return false;
    }
    return true;
}

export function intersectingPairs(slots, layout, angle = 0, zoom = 1) {
    const boxes = slots.map(slot => cardBox(slot, layout, angle, zoom));
    const pairs = [];
    for (let first = 0; first < boxes.length; first++) {
        for (let second = first + 1; second < boxes.length; second++) {
            if (boxesOverlap(boxes[first], boxes[second])) pairs.push([first + 1, second + 1]);
        }
    }
    return pairs;
}

export function radialOverlapArea(a, b) {
    // Project both complete boxes radially. The nearer face contains every ray
    // through a front/back edge, so this also covers the finite face thickness.
    const nearCenter = box => box.center.map((value, axis) => value - box.axes[2][axis] * box.half[2]);
    const centerA = nearCenter(a), centerB = nearCenter(b);
    const distanceB = dot(centerB, b.axes[2]);
    let polygon = [[-a.half[0], -a.half[1]], [a.half[0], -a.half[1]],
        [a.half[0], a.half[1]], [-a.half[0], a.half[1]]];
    // In A's tangent plane, the four edges of B's radial cone are linear
    // half-planes. Clip exactly against all edges; no circle/center proxy.
    for (let axis = 0; axis < 2; axis++) {
        for (const sign of [-1, 1]) {
            const plane = b.axes[2].map((value, index) => b.half[axis] * value + sign * distanceB * b.axes[axis][index]);
            const constant = dot(plane, centerA), u = dot(plane, a.axes[0]), v = dot(plane, a.axes[1]);
            const clipped = [];
            for (let index = 0; index < polygon.length; index++) {
                const p = polygon[index], q = polygon[(index + 1) % polygon.length];
                const first = constant + u * p[0] + v * p[1], second = constant + u * q[0] + v * q[1];
                if (first >= 0) clipped.push(p);
                if ((first >= 0) !== (second >= 0)) {
                    const fraction = first / (first - second);
                    clipped.push(p.map((value, component) => value + fraction * (q[component] - value)));
                }
            }
            polygon = clipped;
            if (polygon.length < 3) return 0;
        }
    }
    return Math.abs(polygon.reduce((sum, p, index) => {
        const q = polygon[(index + 1) % polygon.length];
        return sum + p[0] * q[1] - p[1] * q[0];
    }, 0)) / 2;
}

export function radialOverlappingPairs(slots, layout, angle = 0, zoom = 1) {
    const boxes = slots.map(slot => cardBox(slot, layout, angle, zoom));
    const pairs = [];
    for (let first = 0; first < boxes.length; first++) {
        for (let second = first + 1; second < boxes.length; second++) {
            if (radialOverlapArea(boxes[first], boxes[second]) > layout.cardWidth * layout.cardHeight * zoom * zoom * 1e-10) pairs.push([first + 1, second + 1]);
        }
    }
    return pairs;
}

export function solidAngle(box) {
    // Independently triangulate the four normalized corners using atan2(det,...).
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => {
        const point = box.center.map((value, axis) => value + u * box.half[0] * box.axes[0][axis] + v * box.half[1] * box.axes[1][axis]);
        const length = Math.hypot(...point);
        return point.map(value => value / length);
    });
    const triangle = (a, b, c) => 2 * Math.atan2(Math.abs(dot(a, cross(b, c))), 1 + dot(a, b) + dot(b, c) + dot(c, a));
    return triangle(corners[0], corners[1], corners[2]) + triangle(corners[0], corners[2], corners[3]);
}
