import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import { cardBox, billboardBox, boxesOverlap, intersectingPairs, coveringRadius, rotateBox } from './helpers/orbit-geometry.mjs';
import { withoutThemeHooks } from './helpers/ui-presentation-contract.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = readFileSync(path.join(root, 'js/home-orbit.js'), 'utf8');
const scope = vm.createContext({});
vm.runInContext(source, scope, { filename: 'home-orbit.js' });
const math = scope.JayflixOrbitMath;
const contract = JSON.parse(readFileSync(new URL('./fixtures/home-contract.json', import.meta.url), 'utf8'));
const near = (a, b, epsilon = 1e-9) => assert.ok(Math.abs(a - b) < epsilon, a + ' != ' + b);
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const points = slots => slots.map(slot => cardBox(slot, {radius:1, cardWidth:0, cardHeight:0, faceOffset:0}).center);
const multiply = (a, b) => Array.from({length:16}, (_, i) => [0,1,2,3].reduce((sum, k) => sum + a[k*4+i%4] * b[Math.floor(i/4)*4+k], 0));

test('16 centers are distinct, balanced, deterministic and on the whole spherical surface', () => {
    const slots = math.createSlots(16), p = points(slots);
    assert.equal(p.length, 16);
    for (const n of p) near(Math.hypot(...n), 1);
    for (let i=0;i<3;i++) near(p.reduce((sum,n)=>sum+n[i],0), 0);
    for (let i=0;i<16;i++) for(let j=i+1;j<16;j++) assert.ok(Math.hypot(...p[i].map((v,k)=>v-p[j][k]))>.8);
    assert.ok(Object.isFrozen(slots) && slots.every(Object.isFrozen));
    assert.ok(slots.every(slot => !('roll' in slot)), 'No independent card inclination');
    assert.equal(math.createSlots(16), slots);
    const fresh=vm.createContext({}); vm.runInContext(source,fresh);
    assert.equal(JSON.stringify(fresh.JayflixOrbitMath.createSlots(16)),JSON.stringify(slots));
});

test('Global centers balance all moments through degree five and have no privileged polar region', () => {
    const normals=points(math.createSlots(16)), doubleFactorial=n=>n<=0?1:n*doubleFactorial(n-2);
    for(let x=0;x<=5;x++)for(let y=0;y<=5-x;y++)for(let z=0;z<=5-x-y;z++){
        const expected=[x,y,z].some(n=>n%2)?0:doubleFactorial(x-1)*doubleFactorial(y-1)*doubleFactorial(z-1)/doubleFactorial(x+y+z+1);
        near(normals.reduce((s,n)=>s+n[0]**x*n[1]**y*n[2]**z,0)/16,expected,1e-13);
    }
    near(math.minimumSeparation(math.createSlots(16))*180/Math.PI,50.18051094520784);
    near(coveringRadius(normals)*180/Math.PI,34.14498959307081);
});

test('Complete upright card sizes include footer, border, conservative face envelope and 2% chord clearance', () => {
    const slots=math.createSlots(16), layout=math.computeLayout(1344,700,slots);
    near(layout.cardWidth/layout.radius,.4123447093418528);
    near(layout.cardHeight/layout.cardWidth,1.75); near(layout.footerHeight/layout.cardWidth,.25);
    near(Math.hypot(layout.cardWidth,layout.cardHeight,2*layout.faceOffset),layout.minimumChord*.98);
    const p=points(slots), chord=Math.min(...p.flatMap((a,i)=>p.slice(i+1).map(b=>layout.radius*Math.hypot(...a.map((v,k)=>v-b[k])))));
    near(layout.minimumChord,chord);
    near(math.computeLayout(1344,700,slots.map(s=>({...s}))).cardWidth,layout.cardWidth);
    assert.doesNotMatch(source,/PACKED_HALF_WIDTH_LIMIT|designRolls/);
});

test('Independent limiting-orientation witness detects envelope oversizing, but default 100% dimensions remain separated', () => {
    const slots=math.createSlots(16), layout=math.computeLayout(1344,700,slots), base=slots.map(s=>billboardBox(s,layout));
    let pair, chord=Infinity;
    for(let i=0;i<16;i++)for(let j=i+1;j<16;j++){
        const delta=base[j].center.map((v,k)=>v-base[i].center[k]), length=Math.hypot(...delta);
        if(length<chord){chord=length;pair=[i,j,delta];}
    }
    const [i,j,delta]=pair, width=Math.sqrt(chord**2-(2*layout.faceOffset)**2)/Math.hypot(1,1.75);
    const from=delta.map(v=>v/chord), target=[width,width*1.75,2*layout.faceOffset].map(v=>v/chord);
    const axis=cross(from,target), length=Math.hypot(...axis), angle=Math.acos(Math.max(-1,Math.min(1,dot(from,target))));
    const vector=axis.map(v=>v*angle/length);
    const boxes=base.map(box=>({...rotateBox(box,vector),axes:box.axes}));
    assert.equal(boxesOverlap(boxes[i],boxes[j]),false);
    const enlarged=boxes.map(box=>({...box,half:[width*1.001/2,width*1.75*1.001/2,layout.faceOffset]}));
    assert.equal(boxesOverlap(enlarged[i],enlarged[j]),true);
});

test('At default 100% card size, all 120 pairs remain separated at every sphere zoom and breakpoint', () => {
    const slots=math.createSlots(16), scenes=[[296,390],[366,436.8],[712,610],[1344,700],[1384,700]];
    let checked=0;
    for(const [width,height] of scenes){
        const layout=math.computeLayout(width,height,slots);
        for(const zoom of [math.MIN_ZOOM,1,math.MAX_ZOOM]){
            const base=slots.map(s=>billboardBox(s,layout,0,zoom));
            for(let pitch=0;pitch<360;pitch+=15)for(let yaw=0;yaw<360;yaw+=15){
                const boxes=base.map(box=>({...rotateBox(rotateBox(box,[pitch*Math.PI/180,0,0]),[0,yaw*Math.PI/180,0]),axes:box.axes}));
                for(let i=0;i<16;i++)for(let j=i+1;j<16;j++){
                    assert.equal(boxesOverlap(boxes[i],boxes[j]),false,[width,pitch,yaw,zoom,i,j].join('/')); checked++;
                }
            }
        }
    }
    assert.equal(checked,1036800);
});

test('Empty and non-16 responses retain their real counts and the same all-orientation dimension bound', () => {
    for(const count of [0,1,2,7,15,16,17,32]){
        const slots=math.createSlots(count), layout=math.computeLayout(296,390,slots), p=points(slots);
        assert.equal(slots.length,count); for(const v of Object.values(layout))assert.ok(Number.isFinite(v));
        const diagonal=Math.hypot(layout.cardWidth,layout.cardHeight,2*layout.faceOffset);
        for(let i=0;i<count;i++)for(let j=i+1;j<count;j++)assert.ok(diagonal<layout.radius*Math.hypot(...p[i].map((v,k)=>v-p[j][k])));
    }
    assert.equal(math.RELAX_ITERATIONS,1600);
});

test('Poster, footer and face offsets remain proportional at small widths without a width floor', () => {
    const slots=math.createSlots(16), large=math.computeLayout(1344,700,slots), small=math.computeLayout(100,390,slots);
    assert.ok(small.cardWidth<54);
    for(const name of ['cardWidth','cardHeight','footerHeight','faceOffset'])near(large[name]/large.radius,small[name]/small.radius);
    const hidden=math.computeLayout(0,0,slots);
    for(const v of Object.values(hidden))assert.ok(Number.isFinite(v)); assert.equal(hidden.cardWidth,0);
});

test('Independent oracle still reproduces the four historical tangent-card intersections', () => {
    const rings=[{count:3,latitude:54,offset:0},{count:5,latitude:18,offset:36},{count:5,latitude:-18,offset:0},{count:3,latitude:-54,offset:60}];
    const slots=rings.flatMap(r=>Array.from({length:r.count},(_,i)=>({latitude:r.latitude*Math.PI/180,longitude:(r.offset+i*360/r.count)*Math.PI/180})));
    const layout={radius:245,cardWidth:105.35,cardHeight:183.025,faceOffset:.8};
    assert.deepEqual(intersectingPairs(slots,layout),[[2,5],[3,7],[10,14],[13,16]]);
    const box=cardBox(slots[0],layout); assert.equal(boxesOverlap(box,box),true);
    assert.equal(boxesOverlap(box,{...box,center:box.center.map(v=>v+10000)}),false);
});

test('Counter-orientation keeps the complete card basis upright after arbitrary diagonal drag histories', () => {
    let orientation=[1,0,0,0];
    for(let step=0;step<2000;step++){
        orientation=math.rotateOrientation(orientation,[.17*Math.sin(step),-.23*Math.cos(step),0]);
        const parent=math.orientationMatrix(orientation), inverse=math.inverseOrientationMatrix(orientation), effective=multiply(parent,inverse);
        for(let i=0;i<16;i++)near(effective[i],i%5===0?1:0);
        const p=math.positionOnSphere(math.createSlots(16)[step%16],245), local=inverse.slice();
        local[12]=p.x;local[13]=p.y;local[14]=p.z;
        const world=multiply(parent,local);
        for(let i=0;i<12;i++)near(world[i],i%5===0?1:0);
        near(Math.hypot(world[12],world[13],world[14]),245);
    }
    assert.doesNotMatch(source,/rotateZ\(/);
});

test('Free dragging uses both components in all quadrants, including small moves after the initial threshold', () => {
    assert.deepEqual(Array.from(math.gestureVector(0,0)),[0,0,0]);
    assert.deepEqual(Array.from(math.gestureVector(3,3)),[-.015,.015,0]);
    for(const x of [-40,40])for(const y of [-40,40]){
        assert.deepEqual(Array.from(math.gestureVector(x,y)),[-y*.005,x*.005,0]);
    }
    assert.doesNotMatch(source,/classifyDragAxis|AXIS_BIAS|pointer\.axis|'rejected'/);
    assert.match(source,/Math\.hypot\(horizontal, vertical\) < DRAG_THRESHOLD/);
});

test('Diagonal velocity caps magnitude without dropping components or changing direction', () => {
    for(const [x,y] of [[1000,1000],[-1000,1000],[1000,-1000],[-1000,-1000],[300,400]]){
        const v=math.velocityFromGesture(x,y,.001);
        near(Math.hypot(...v),4.5);
        near(v[0]/v[1],-y/x);near(v[2],0);
    }
    const slow=math.velocityFromGesture(3,4,1);
    assert.deepEqual(Array.from(slow),[-.02,.015,0]);
});

test('Drag components have identical sensitivity and correct right, left, down and up signs', () => {
    const right=math.gestureVector(40,0), down=math.gestureVector(0,40);
    near(right[1],-down[0]);near(right[0],0);near(down[1],0);
    const front=v=>{const m=math.orientationMatrix(math.rotateOrientation([1,0,0,0],v));return [m[8],m[9],m[10]];};
    assert.ok(front(right)[0]>0);assert.ok(front(math.gestureVector(-40,0))[0]<0);
    assert.ok(front(down)[1]>0);assert.ok(front(math.gestureVector(0,-40))[1]<0);
    const initial=math.rotateOrientation([1,0,0,0],[1.8,0,0]), before=math.orientationMatrix(initial);
    const box=billboardBox({latitude:0,longitude:0},{radius:1,cardWidth:0,cardHeight:0,faceOffset:0});
    const expected=rotateBox({...box,center:[before[8],before[9],before[10]]},right).center;
    const after=math.orientationMatrix(math.rotateOrientation(initial,right));
    for(let i=0;i<3;i++)near(after[8+i],expected[i]);
});

test('Vertical rotation passes through 90, 180, 360 and 720 degrees without poles or resets', () => {
    const base=billboardBox({latitude:0,longitude:0},{radius:1,cardWidth:0,cardHeight:0,faceOffset:0});
    let orientation=[1,0,0,0], previous=[0,0,1];
    for(let degree=1;degree<=720;degree++){
        orientation=math.rotateOrientation(orientation,[Math.PI/180,0,0]);
        const m=math.orientationMatrix(orientation), actual=[m[8],m[9],m[10]], expected=rotateBox(base,[degree*Math.PI/180,0,0]).center;
        for(let i=0;i<3;i++)near(actual[i],expected[i]);
        assert.ok(Math.hypot(...actual.map((v,i)=>v-previous[i]))<.018); previous=actual;
    }
});

test('Long changing-direction diagonal histories remain orthonormal without deformation', () => {
    let orientation=[1,0,0,0];
    for(let i=0;i<15000;i++)orientation=math.rotateOrientation(orientation,[.013*Math.sin(i),.015*Math.cos(i),0]);
    near(Math.hypot(...orientation),1);
    const m=math.orientationMatrix(orientation), c=[[m[0],m[1],m[2]],[m[4],m[5],m[6]],[m[8],m[9],m[10]]];
    for(let i=0;i<3;i++)for(let j=0;j<3;j++)near(dot(c[i],c[j]),i===j?1:0); near(dot(c[0],cross(c[1],c[2])),1);
    const input=[2,0,0,0];near(math.normalizeQuaternion(input)[0],1);assert.deepEqual(input,[2,0,0,0]);
});

test('Free-direction inertia retains every component and decays consistently across frame rates', () => {
    for(const input of [[1,0,0],[0,1,0],[-3,4,0],[3,-4,0],[-3,-4,0]]){
        const direction=input.map(value=>value/Math.hypot(...input));
        const target=direction.map(value=>value*math.AUTO_SPEED), velocity=direction.map(value=>value*4);
        const outcomes=[30,60,120].map(rate=>{
            let state={orientation:[1,0,0,0],velocity};
            for(let frame=0;frame<rate*10;frame++){
                const next=math.advanceOrientation(state.orientation,state.velocity,target,1/rate);
                for(let i=0;i<3;i++)assert.ok(Math.abs(next.velocity[i]-target[i])<=Math.abs(state.velocity[i]-target[i])+1e-12);
                near(dot(next.velocity,direction),Math.hypot(...next.velocity));
                state=next;
            }
            return state;
        });
        for(const state of outcomes){
            for(let i=0;i<3;i++)near(state.velocity[i],target[i],1e-5);
            const actual=math.orientationMatrix(state.orientation), expected=math.orientationMatrix(outcomes[0].orientation);
            for(let i=0;i<16;i++)near(actual[i],expected[i]);
        }
    }
    const next=math.advanceOrientation([1,0,0,0],[3,4,2],[0,.075,0],1/60);
    for(let i=0;i<3;i++)near(next.velocity[i],math.advanceRotation(0,[3,4,2][i],[0,.075,0][i],1/60).velocity);
    assert.ok(next.velocity[0]>0 && next.velocity[2]>0, 'No component is discarded by axis selection');
});

test('Pinch zoom retains distance ratios, limits and clean gesture-state resets', () => {
    assert.equal(math.MIN_ZOOM, .5); assert.equal(math.MAX_ZOOM, 5);
    near(math.zoomFromPinch(1,100,125),1.25);near(math.zoomFromPinch(1,100,75),.75);
    near(math.zoomFromPinch(1,100,10000),math.MAX_ZOOM);near(math.zoomFromPinch(1,100,1),math.MIN_ZOOM);
    near(math.zoomFromPinch(1,0,100),1);assert.match(source,/point\.startTime = event\.timeStamp/);
});

test('Independent cover dimensions retain portrait/footer proportions over the full 50%–500% range without mutating geometry', () => {
    assert.equal(math.MIN_CARD_SCALE, .5); assert.equal(math.MAX_CARD_SCALE, 5);
    for (const [width, height] of [[0, 0], [100, 390], [296, 390], [712, 610], [1344, 700]]) {
        const layout = math.computeLayout(width, height, math.createSlots(16)), before = JSON.stringify(layout);
        for (const scale of [.5, .6, .9, 1, 1.5, 2, 5]) {
            const dimensions = math.cardDimensionsFromScale(layout, scale);
            near(dimensions.cardScale, scale);
            for (const name of ['cardWidth', 'cardHeight', 'footerHeight']) near(dimensions[name], layout[name] * scale);
            near(dimensions.cardHeight, dimensions.cardWidth * 1.75);
            near(dimensions.footerHeight, dimensions.cardWidth * .25);
            assert.equal('radius' in dimensions, false);
            assert.equal('perspective' in dimensions, false);
        }
        assert.equal(JSON.stringify(layout), before);
        near(math.cardDimensionsFromScale(layout, .01).cardScale, .5);
        near(math.cardDimensionsFromScale(layout, 20).cardScale, 5);
        near(math.cardDimensionsFromScale(layout, NaN).cardScale, 1);
    }
});

test('Subpixel covers keep a proportional border without introducing a fixed minimum card width', () => {
    const css = readFileSync(path.join(root, 'css/home-orbit.css'), 'utf8');
    const face = css.match(/\.orbit-card-front\s*\{([^}]+)\}/)[1];
    assert.match(face, /box-sizing:\s*border-box/);
    assert.match(face, /border-width:\s*min\(1px, calc\(var\(--orbit-card-width\) \* \.25\)\)/);
    for (const count of [16, 212]) for (const width of [100, 296, 1344]) {
        const layout = math.computeLayout(width, 700, math.createSlots(count));
        const card = math.cardDimensionsFromScale(layout, math.MIN_CARD_SCALE);
        const border = Math.min(1, card.cardWidth * .25);
        assert.ok(2 * border < card.cardWidth);
        assert.ok(2 * border < card.cardHeight);
    }
});

test('Chosen option A intentionally allows enlarged card overlap without moving centers or increasing sphere radius', () => {
    const slots = math.createSlots(16), layout = math.computeLayout(1344, 700, slots);
    const base = slots.map(slot => billboardBox(slot, layout));
    let first, second, delta, minimum = Infinity;
    for (let i = 0; i < 16; i++) for (let j = i + 1; j < 16; j++) {
        const vector = base[j].center.map((value, axis) => value - base[i].center[axis]);
        const distance = Math.hypot(...vector);
        if (distance < minimum) { minimum = distance; first = i; second = j; delta = vector; }
    }
    // Align the closest center chord vertically in the screen plane. The
    // doubled portrait envelopes then overlap; only the centers rotate.
    const direction = delta.map(value => value / minimum), axis = cross(direction, [0, 1, 0]);
    const angle = Math.acos(direction[1]), vector = axis.map(value => value * angle / Math.hypot(...axis));
    const upright = base.map(box => ({ ...rotateBox(box, vector), axes: box.axes }));
    const enlargedLayout = { ...layout, ...math.cardDimensionsFromScale(layout, 2) };
    const enlarged = slots.map(slot => billboardBox(slot, enlargedLayout))
        .map((box, index) => ({ ...box, center: upright[index].center }));
    assert.equal(boxesOverlap(upright[first], upright[second]), false);
    assert.equal(boxesOverlap(enlarged[first], enlarged[second]), true);
    near(enlargedLayout.radius, layout.radius);
    for (let i = 0; i < 16; i++) assert.deepEqual(enlarged[i].center, upright[i].center);
});

test('Cover buttons are placed below the sphere zoom controls with stacked responsive layout and accessible labels', () => {
    const html = readFileSync(path.join(root, 'index.html'), 'utf8'), css = readFileSync(path.join(root, 'css/home-orbit.css'), 'utf8');
    assert.ok(html.indexOf('id="orbitZoom"') < html.indexOf('id="orbitCardScale"'));
    assert.match(html, /class="orbit-control-stack"/);
    assert.match(html, /class="orbit-controls orbit-card-controls" role="group" aria-label="封面尺寸控制"/);
    for (const action of ['card-size-out', 'reset', 'card-size-in']) {
        assert.match(html, new RegExp(`<button type="button" data-orbit-action="${action}"[^>]*aria-label="[^"]+"`));
    }
    assert.match(css, /\.orbit-control-stack\s*\{[^}]*flex-direction:\s*column/);
    assert.match(css, /\.orbit-control-stack\s*\{[^}]*margin-left:\s*auto/);
    assert.match(html, /封面尺寸50%–500%/);
    assert.match(html, /球体缩放50%–500%/);
    assert.equal([...html.matchAll(/data-orbit-action="reset"/g)].length, 1);
    assert.doesNotMatch(html, /data-orbit-action="card-size-reset"/);
});

test('Only the homepage sphere captures touch; free-drag hints and four arrow keys are present', () => {
    const css=readFileSync(path.join(root,'css/home-orbit.css'),'utf8'), html=readFileSync(path.join(root,'index.html'),'utf8');
    const scene=css.match(/\.orbit-scene\s*\{([^}]+)\}/)[1];
    assert.match(scene,/touch-action:\s*none/);assert.equal([...css.matchAll(/touch-action:\s*none/g)].length,1);
    for(const key of ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'])assert.ok(source.includes(key));
    assert.ok(html.includes('任意方向拖动'));assert.ok(html.includes('卡片始终朝上'));
    assert.doesNotMatch(html,/固定十字轴|固定轴上下/);
    assert.equal([...html.matchAll(/class="orbit-great-circle"/g)].length,3);
});

test('3D carriers preserve depth and the decorative wireframe no longer represents locked axes', () => {
    const css=readFileSync(path.join(root,'css/home-orbit.css'),'utf8');
    const carrier=css.match(/\.orbit-camera, \.orbit-world, \.orbit-sphere\s*\{([^}]+)\}/)[1];
    for(const rule of ['transform-style: preserve-3d','overflow: visible','opacity: 1','filter: none','isolation: auto'])assert.ok(carrier.includes(rule));
    assert.match(css,/height:\s*var\(--orbit-footer-height\)/);assert.match(css,/box-sizing:\s*border-box/);
    const wireframe=css.match(/\.orbit-wireframe\s*\{([^}]+)\}/)[1];
    assert.doesNotMatch(wireframe,/transform:\s*var\(--orbit-upright-transform\)/);
    assert.doesNotMatch(source,/zIndex\s*=|(?:card|world|camera)\.style\.opacity\s*=/);
});

test('All existing interfaces, business scripts, shared styles and page content remain unchanged after stripping theme hooks', () => {
    for(const [file,expected] of Object.entries(contract.hashes))assert.equal(createHash('sha256').update(withoutThemeHooks(file, readFileSync(path.join(root,file), 'utf8'))).digest('hex'),expected,'Protected file changed: '+file);
});

test('Every original homepage DOM id, inline action and script dependency is preserved', () => {
    const html=readFileSync(path.join(root,'index.html'),'utf8'), ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
    assert.equal(new Set(ids).size,ids.length);for(const id of contract.ids)assert.equal(ids.filter(v=>v===id).length,1);
    assert.deepEqual([...html.matchAll(/\bon(?:click|submit|change|error|input)="([^"]*)"/g)].map(m=>m[1]),contract.handlers);
    const scripts=[...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(m=>m[1]);
    assert.deepEqual(scripts.filter(s=>contract.scripts.includes(s)),contract.scripts);
    assert.ok(html.includes('window.__ENV__.PASSWORD = "{{PASSWORD}}";'));assert.ok(html.includes('window.__ENV__.ADMINPASSWORD = "{{ADMINPASSWORD}}";'));
});

test('One upright original face fades with depth; no mirror, hidden rear actions or duplicate content remain', () => {
    const css=readFileSync(path.join(root,'css/home-orbit.css'),'utf8');
    assert.doesNotMatch(source,/\b(?:fetch|XMLHttpRequest|sessionStorage)\s*[.(]/);
    assert.doesNotMatch(css,/orbit-card-back|orbit-back-content|scaleX\(-1\)|rotateY\(180deg\)|data-side/);
    assert.doesNotMatch(source,/cloneNode|syncReflection|dataset\.side|toggleAttribute\('inert'/);
    assert.match(source,/state\.faces\[index\]\.style\.opacity = String\(opacityFromDepth\(depth, state\.radius \* centerScale\)\)/);
    assert.match(source,/stopImmediatePropagation\(\)/);
    assert.match(source,/card && event\.target === card/);
});

test('Opacity is a depth-linear mapping with exact rear, middle and front endpoints', () => {
    assert.equal(math.REAR_OPACITY,.24);assert.equal(math.FRONT_OPACITY,1);
    for(const radius of [1,34,100.64,245,1000]){
        for(const [fraction,alpha] of [[-1,.24],[-.5,.43],[0,.62],[.5,.81],[1,1]])near(math.opacityFromDepth(fraction*radius,radius),alpha);
        let previous=math.opacityFromDepth(-radius,radius);
        for(let sample=1;sample<=1000;sample++){
            const alpha=math.opacityFromDepth(radius*(-1+sample/500),radius);
            near(alpha-previous,.76/1000);assert.ok(alpha>=previous);previous=alpha;
        }
        // Passing z=0 cannot suddenly change brightness or flip the content.
        const epsilon=radius*1e-8;
        near(math.opacityFromDepth(epsilon,radius)-math.opacityFromDepth(-epsilon,radius),.76e-8,1e-14);
    }
});

test('Opacity clamps numerical overshoot and stays finite when the scene has no radius', () => {
    near(math.opacityFromDepth(-100,1),.24);near(math.opacityFromDepth(100,1),1);
    for(const [depth,radius] of [[0,0],[20,0],[20,-1],[NaN,245],[Infinity,245],[10,Infinity],[undefined,245]])near(math.opacityFromDepth(depth,radius),.62);
});

test('Temporary diagnostics and obsolete independent card tilt are absent from delivered code', () => {
    assert.doesNotMatch(source,/orbitDiagnostic|designRolls|rotateZ\(/);
    assert.doesNotMatch(readFileSync(path.join(root,'index.html'),'utf8'),/home-orbit\.(?:js|css)[^"'\s]*debug/);
});
