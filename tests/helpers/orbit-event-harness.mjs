// A small, deterministic Node-only DOM/event model. It runs the production
// controller without launching a browser or asserting visual rendering.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

class Element {
    constructor(tag = 'div') {
        this.tagName = tag.toUpperCase();
        this.children = [];
        this.parentElement = null;
        this.dataset = {};
        this.attrs = new Map();
        this.listeners = new Map();
        this.textContent = '';
        this.className = '';
        this.style = { setProperty(name, value) { this[name] = value; }, getPropertyValue(name) { return this[name] || ''; } };
        this.classList = {
            contains: name => this.className.split(/\s+/).includes(name),
            add: name => { if (!this.classList.contains(name)) this.className = (this.className + ' ' + name).trim(); },
            remove: name => { this.className = this.className.split(/\s+/).filter(item => item !== name).join(' '); }
        };
    }
    get childNodes() { return this.children; }
    get childElementCount() { return this.children.length; }
    get firstChild() { return this.children[0] || null; }
    get attributes() { return Array.from(this.attrs, ([name, value]) => ({ name, value })); }
    appendChild(child) {
        if (child.tagName === '#FRAGMENT') {
            Array.from(child.children).forEach(node => this.appendChild(node));
            return child;
        }
        if (child.parentElement) child.parentElement.children.splice(child.parentElement.children.indexOf(child), 1);
        this.children.push(child);
        child.parentElement = this;
        return child;
    }
    append(...children) { children.forEach(child => this.appendChild(child)); }
    replaceChildren(...children) {
        this.children.forEach(child => { child.parentElement = null; });
        this.children = [];
        this.append(...children);
    }
    remove() {
        if (!this.parentElement) return;
        this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
        this.parentElement = null;
    }
    setAttribute(name, value) { this.attrs.set(name, String(value)); }
    getAttribute(name) { return this.attrs.get(name) ?? null; }
    removeAttribute(name) { this.attrs.delete(name); }
    toggleAttribute(name, present) { present ? this.setAttribute(name, '') : this.removeAttribute(name); }
    matches(selector) {
        if (selector.includes(',')) return selector.split(',').some(part => this.matches(part.trim()));
        if (selector === '*') return true;
        if (selector === ':focus-visible') return Boolean(this.focusVisible);
        if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
        if (selector.startsWith('[')) {
            const [, name, value] = selector.match(/^\[([^=\]]+)(?:="([^"]+)")?\]$/);
            const actual = name.startsWith('data-') ? this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] : this.getAttribute(name);
            return value === undefined ? actual != null : actual === value;
        }
        return this.tagName === selector.toUpperCase();
    }
    closest(selector) {
        for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node;
        return null;
    }
    querySelectorAll(selector) {
        if (selector.includes(',')) {
            const matches = new Set(selector.split(',').flatMap(part => this.querySelectorAll(part.trim())));
            return this.querySelectorAll('*').filter(node => matches.has(node));
        }
        const pieces = selector.trim().split(/\s+/);
        const result = [];
        const visit = node => {
            for (const child of node.children) {
                if (child.matches(pieces.at(-1))) {
                    let ancestor = child.parentElement, index = pieces.length - 2;
                    while (index >= 0 && ancestor && ancestor !== this.parentElement) {
                        if (ancestor.matches(pieces[index])) index--;
                        ancestor = ancestor.parentElement;
                    }
                    if (index < 0) result.push(child);
                }
                visit(child);
            }
        };
        visit(this);
        return result;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    cloneNode(deep) {
        const clone = new Element(this.tagName);
        clone.className = this.className;
        clone.textContent = this.textContent;
        clone.src = this.src;
        clone.alt = this.alt;
        clone.attrs = new Map(this.attrs);
        clone.dataset = { ...this.dataset };
        if (deep) this.children.forEach(child => clone.appendChild(child.cloneNode(true)));
        return clone;
    }
    addEventListener(type, callback, options) {
        const capture = options === true || Boolean(options?.capture);
        const handlers = this.listeners.get(type) || [];
        handlers.push({ callback, capture });
        this.listeners.set(type, handlers);
    }
    get eventRoot() {
        let root = this;
        while (root.parentElement) root = root.parentElement;
        return root;
    }
    setPointerCapture(id) {
        const root = this.eventRoot;
        if (!root.activePointers?.has(id)) throw new Error('NotFoundError');
        this.lastCapturedPointer = id;
        root.pendingCaptures.set(id, this);
    }
    hasPointerCapture(id) { return this.eventRoot.pendingCaptures?.get(id) === this; }
    releasePointerCapture(id) {
        if (this.hasPointerCapture(id)) this.eventRoot.pendingCaptures.delete(id);
    }
    dispatch(type, values = {}) {
        const event = {
            type, target: this, currentTarget: null, cancelable: true,
            defaultPrevented: false, stopped: false, immediateStopped: false,
            preventDefault() { if (this.cancelable) this.defaultPrevented = true; },
            stopPropagation() { this.stopped = true; },
            stopImmediatePropagation() { this.stopped = true; this.immediateStopped = true; },
            ...values
        };
        const path = [];
        for (let node = this; node; node = node.parentElement) path.push(node);
        for (const capture of [true, false]) {
            for (const node of capture ? path.slice().reverse() : path) {
                event.currentTarget = node;
                for (const handler of node.listeners.get(type) || []) {
                    if (event.immediateStopped) break;
                    if (handler.capture === capture) handler.callback(event);
                }
                if (event.stopped) { event.currentTarget = null; return event; }
            }
        }
        event.currentTarget = null;
        return event;
    }
    click() { if (!this.disabled) return this.dispatch('click'); }
    dispatchEvent(event) { return !this.dispatch(event.type, event).defaultPrevented; }
}

export function createOrbitHarness({ count = 16, reducedMotion = false, source, sceneData = {}, cardsFactory,
    setupDocument, bootstrapSource, query = '', viewportWidth = 1440, storage, deferTimers = false } = {}) {
    const document = new Element('document');
    document.readyState = 'complete';
    document.hidden = false;
    // Model pending/current capture separately: transfer emits a bubbling loss
    // on the OLD owner before movement reaches the new owner (Pointer Events).
    // This is an event regression model, not evidence of Chrome's event trace.
    document.activePointers = new Set();
    document.pendingCaptures = new Map();
    document.currentCaptures = new Map();
    document.createElement = tag => new Element(tag);
    document.createDocumentFragment = () => new Element('#fragment');
    const ids = new Map();
    document.getElementById = id => ids.get(id) || null;
    const add = (parent, tag, className, id) => {
        const element = new Element(tag);
        element.className = className;
        parent.appendChild(element);
        if (id) ids.set(id, element);
        return element;
    };
    const scene = add(document, 'section', 'orbit-scene', 'recommendationOrbit');
    Object.assign(scene.dataset, sceneData);
    scene.clientWidth = viewportWidth <= 600 ? Math.max(0, viewportWidth - 24) : 1344;
    scene.clientHeight = 700;
    const camera = add(scene, 'div', 'orbit-camera');
    const world = add(camera, 'div', 'orbit-world');
    const wireframe = add(world, 'div', 'orbit-wireframe');
    const container = add(world, 'div', '', 'douban-results');
    const loading = add(scene, 'div', 'orbit-loading');
    const counter = add(document, 'span', '', 'orbitCount');
    const controls = add(document, 'div', 'orbit-control-stack');
    const sphereControls = add(controls, 'div', 'orbit-controls');
    const cardControls = add(controls, 'div', 'orbit-controls orbit-card-controls');
    const actions = {};
    const diagnosticControls = Boolean(sceneData.orbitTest || bootstrapSource);
    const addAction = (parent, action, id) => {
        const button = add(parent, 'button', '', id);
        button.dataset.orbitAction = action;
        actions[action] = button;
        return button;
    };
    addAction(sphereControls, 'zoom-out');
    const zoomValue = diagnosticControls ? addAction(sphereControls, 'reset', 'orbitZoom') :
        add(sphereControls, 'span', 'orbit-value', 'orbitZoom');
    addAction(sphereControls, 'zoom-in');
    addAction(sphereControls, 'pause', 'orbitPause');
    add(actions.pause, 'span', 'orbit-pause-label');
    addAction(cardControls, 'card-size-out');
    const cardValue = diagnosticControls ? addAction(cardControls, 'card-size-reset', 'orbitCardScale') :
        add(cardControls, 'span', 'orbit-value', 'orbitCardScale');
    addAction(cardControls, 'card-size-in');
    if (!diagnosticControls) {
        addAction(cardControls, 'reset', 'orbitReset').textContent = '重置';
    }
    const speedControls = diagnosticControls ? null : add(controls, 'div', 'orbit-controls orbit-speed-controls');
    let speedValue = null;
    if (speedControls) {
        addAction(speedControls, 'speed-out');
        speedValue = add(speedControls, 'span', 'orbit-value', 'orbitSpeed');
        addAction(speedControls, 'speed-in');
    }
    let actionCount = 0, linkCount = 0;
    const cards = cardsFactory ? Array.from(cardsFactory(document), card => container.appendChild(card)) : Array.from({ length: count }, (_, index) => {
        const card = add(container, 'div', 'original-card');
        const poster = add(card, 'div', 'original-poster');
        poster.setAttribute('onclick', 'originalSearch()');
        poster.addEventListener('click', () => { actionCount++; });
        const image = add(poster, 'img', '');
        image.src = `poster-${index}.jpg`;
        image.alt = `Film ${index}`;
        image.setAttribute('id', `original-image-${index}`);
        image.setAttribute('onerror', 'originalFallback()');
        add(poster, 'div', 'original-overlay');
        const link = add(poster, 'a', 'original-link');
        link.setAttribute('href', `https://movie.douban.com/subject/${index + 1}/`);
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener noreferrer');
        link.setAttribute('onclick', 'event.stopPropagation();');
        link.addEventListener('click', event => { event.stopPropagation(); linkCount++; });
        const footer = add(card, 'div', 'original-footer');
        const button = add(footer, 'button', '');
        button.textContent = `Film ${index}`;
        button.setAttribute('onclick', 'originalSearch()');
        button.addEventListener('click', () => { actionCount++; });
        return card;
    });
    let now = 1000, nextFrame = 1, nextTimer = 1;
    const timers = new Map(), windowEvents = new Element('window');
    const processCapture = values => {
        const id = values.pointerId, old = document.currentCaptures.get(id);
        if (old === document.pendingCaptures.get(id)) return;
        if (old) old.dispatch('lostpointercapture', { ...values, cancelable: false });
        const next = document.pendingCaptures.get(id);
        if (next) next.dispatch('gotpointercapture', { ...values, cancelable: false });
        if (next) document.currentCaptures.set(id, next);
        else document.currentCaptures.delete(id);
    };
    const frames = new Map(), observers = {}, observerStates = {};
    const media = new Element('media');
    media.matches = reducedMotion;
    const mobileMedia = new Element('media');
    mobileMedia.matches = viewportWidth <= 600;
    const observer = name => class {
        constructor(callback) {
            observers[name] = callback;
            observerStates[name] = { connected: false, observeCalls: 0, disconnectCalls: 0 };
        }
        observe(target, options) {
            Object.assign(observerStates[name], { target, options, connected: true });
            observerStates[name].observeCalls++;
        }
        disconnect() {
            observerStates[name].connected = false;
            observerStates[name].disconnectCalls++;
        }
    };
    if (setupDocument) setupDocument({ document, scene, container });
    const context = vm.createContext({
        document, performance: { now: () => now }, matchMedia: query => query === '(max-width: 600px)' ? mobileMedia : media,
        localStorage: storage, addEventListener: (...args) => windowEvents.addEventListener(...args),
        URLSearchParams, location: { search: query },
        CustomEvent: class { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } },
        requestAnimationFrame: callback => { const id = nextFrame++; frames.set(id, callback); return id; },
        cancelAnimationFrame: id => frames.delete(id),
        MutationObserver: observer('mutation'), ResizeObserver: observer('resize'), IntersectionObserver: observer('intersection'),
        setTimeout: (callback, delay = 0) => {
            if (!deferTimers) { callback(); return 0; }
            const id = nextTimer++;
            timers.set(id, { callback, due: now + delay });
            return id;
        },
        clearTimeout: id => timers.delete(id)
    });
    if (bootstrapSource) vm.runInContext(bootstrapSource, context, { filename: 'orbit-test.js' });
    vm.runInContext(source ?? readFileSync(new URL('../../js/home-orbit.js', import.meta.url), 'utf8'), context, { filename: 'home-orbit.js' });
    return {
        scene, world, wireframe, camera, container, cards, controls, sphereControls, cardControls, speedControls, actions, zoomValue, cardValue, speedValue,
        counter, loading, media, mobileMedia, observers, observerStates, document, windowEvents,
        math: context.JayflixOrbitMath,
        get actionCount() { return actionCount; },
        get linkCount() { return linkCount; },
        get frameCount() { return frames.size; },
        get timerCount() { return timers.size; },
        advanceTimers(milliseconds = 150) {
            now += milliseconds;
            for (const [id, timer] of timers) if (timer.due <= now) {
                timers.delete(id); timer.callback();
            }
        },
        viewport(width) {
            const before = mobileMedia.matches;
            mobileMedia.matches = width <= 600;
            if (before !== mobileMedia.matches) mobileMedia.dispatch('change', { matches: mobileMedia.matches });
        },
        pointer(type, x, y, { id = 1, elapsed = 16, pointerType = 'mouse', button = 0, target = scene } = {}) {
            now += elapsed;
            const ended = type === 'pointerup' || type === 'pointercancel';
            const values = { pointerId: id, clientX: x, clientY: y, timeStamp: now, pointerType, button,
                buttons: ended ? 0 : 1 << button, isPrimary: id === 1, cancelable: type !== 'pointercancel' };
            if (type === 'pointerdown') {
                document.activePointers.add(id);
                if (pointerType === 'touch') target.setPointerCapture(id);
            } else processCapture(values);
            const actualTarget = document.currentCaptures.get(id) || target;
            const event = actualTarget.dispatch(type, values);
            if (ended) {
                document.pendingCaptures.delete(id);
                processCapture(values);
                document.activePointers.delete(id);
            }
            return event;
        },
        wait(milliseconds) { now += milliseconds; },
        frame(milliseconds = 16) {
            now += milliseconds;
            const callbacks = Array.from(frames.values());
            frames.clear();
            callbacks.forEach(callback => callback(now));
        },
        key(key, target = scene) { return target.dispatch('keydown', { key }); }
    };
}
