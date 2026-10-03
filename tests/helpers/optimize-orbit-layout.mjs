// Optional, bounded offline calculation; never shipped or run by the homepage.
// node tests/helpers/optimize-orbit-layout.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { cardBox, radialOverlapArea, solidAngle, footprint, distanceToFootprint } from './orbit-geometry.mjs';

const scope = vm.createContext({});
vm.runInContext(readFileSync(new URL('../../js/home-orbit.js', import.meta.url), 'utf8'), scope);
const points = scope.JayflixOrbitMath.createSlots(16).map(slot => ({ ...slot }));
const fixture = JSON.parse(readFileSync(new URL('../fixtures/orbit-packing.json', import.meta.url), 'utf8'));
let seed = fixture.optimizer.seed;
const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
const boxAt = (index, roll, a) => cardBox({ ...points[index], roll }, { radius: 1, cardWidth: 2 * a, cardHeight: 3.5 * a, faceOffset: 0 });
const penalty = (a, b) => radialOverlapArea(a, b) + radialOverlapArea(b, a);
const cost = boxes => {
    let sum = 0;
    for (let i = 0; i < 16; i++) for (let j = i + 1; j < 16; j++) sum += penalty(boxes[i], boxes[j]);
    return sum;
};
const fit = rolls => {
    let low = 0, high = .4;
    for (let pass = 0; pass < 40; pass++) {
        const a = (low + high) / 2, boxes = rolls.map((roll, index) => boxAt(index, roll, a));
        if (cost(boxes) < 1e-15) low = a; else high = a;
    }
    return low;
};
let best = { rolls: fixture.optimizer.initialRollsDegrees.map(value => value * Math.PI / 180) };
best.a = fit(best.rolls);
// Fixed budgets and deterministic PRNG make this an experiment, not an
// unbounded promise to find the global maximum of rectangle packing.
for (const target of [.28, .29, .30, .31]) {
    for (let start = 0; start < 6; start++) {
        const rolls = start ? best.rolls.map(roll => roll + (random() - .5) * .8) : best.rolls.slice();
        let boxes = rolls.map((roll, index) => boxAt(index, roll, target)), energy = cost(boxes);
        let snapshot = rolls.slice(), lowest = energy;
        for (let pass = 0; pass < 18000; pass++) {
            const fraction = pass / 18000, index = Math.floor(random() * 16);
            const temperature = .002 * (1e-6 ** fraction);
            const candidateRoll = rolls[index] + (random() - .5) * (.7 * (1 - fraction) + .004);
            const candidate = boxAt(index, candidateRoll, target);
            let delta = 0;
            for (let other = 0; other < 16; other++) if (other !== index) delta += penalty(candidate, boxes[other]) - penalty(boxes[index], boxes[other]);
            if (delta < 0 || random() < Math.exp(-delta / temperature)) {
                rolls[index] = candidateRoll;
                boxes[index] = candidate;
                energy = Math.max(0, energy + delta);
                if (energy < lowest) { lowest = energy; snapshot = rolls.slice(); }
            }
            if (lowest < 1e-15) break;
        }
        const a = fit(snapshot);
        if (a > best.a) best = { a, rolls: snapshot };
    }
    process.stdout.write(`target ${target}: verified half-width ${best.a.toFixed(9)}\n`);
}
const rolls = best.rolls.map(roll => ((roll % Math.PI) + Math.PI) % Math.PI);
const a = best.a * .997 * .98;
const boxes = rolls.map((roll, index) => boxAt(index, roll, a));
const shapes = boxes.map(footprint);
let largestGap = 0, gapDirection;
for (let index = 0; index < 12000; index++) {
    const y = 1 - 2 * (index + .5) / 12000, r = Math.sqrt(1 - y * y), longitude = index * Math.PI * (3 - Math.sqrt(5));
    const ray = [r * Math.sin(longitude), y, r * Math.cos(longitude)];
    const gap = Math.min(...shapes.map(shape => distanceToFootprint(ray, shape)));
    if (gap > largestGap) { largestGap = gap; gapDirection = ray; }
}
console.log(JSON.stringify({ halfWidth: best.a, rollsDegrees: rolls.map(roll => roll * 180 / Math.PI),
    widthRatio: 2 * a, heightRatio: 3.5 * a, coverage: boxes.reduce((sum, box) => sum + solidAngle(box), 0) / (4 * Math.PI),
    sampledLargestGapDegrees: largestGap * 180 / Math.PI, gapDirection,
    budgets: { targets: 4, starts: 6, annealingSteps: 18000, bisectionSteps: 40, gapSamples: 12000 },
    globalOptimalityProved: false }, null, 2));
