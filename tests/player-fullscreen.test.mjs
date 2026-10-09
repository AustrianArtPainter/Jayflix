import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { withoutThemeHooks } from './helpers/ui-presentation-contract.mjs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const source = read('js/player.js');
const start = source.indexOf('const isWebkit =');
const end = source.indexOf('// 页面加载\ndocument.addEventListener');
assert.ok(start > 0 && end > start);

function harness({ ios = true, enabled = true, presentation = true, legacy = true } = {}) {
    const calls = [], listeners = new Map(), timers = new Map();
    let id = 0, fullscreen = false;
    const video = {
        controls: false, playsInline: true,
        webkitDisplayingFullscreen: false, webkitPresentationMode: 'inline',
        addEventListener(name, listener) {
            if (!listeners.has(name)) listeners.set(name, new Set());
            listeners.get(name).add(listener);
        },
        removeEventListener(name, listener) { listeners.get(name)?.delete(listener); },
        emit(name) { for (const listener of [...(listeners.get(name) || [])]) listener({ type: name }); },
        ...(presentation ? {
            webkitSupportsPresentationMode: () => true,
            webkitSetPresentationMode(mode) { calls.push(`mode:${mode}`); },
        } : {}),
        ...(legacy ? {
            webkitEnterFullscreen() { calls.push('native-enter'); },
            webkitExitFullscreen() { calls.push('native-exit'); },
        } : {}),
    };
    const player = {
        video, fullscreenWeb: false, notice: { show: '' },
        template: { $player: { requestFullscreen() { calls.push('container'); } } },
        controls: { add(control) { this.control = control; } },
        i18n: { get: text => text }, icons: { fullscreenOn: '<svg></svg>' },
        get fullscreen() { return fullscreen; },
        set fullscreen(value) { fullscreen = value; calls.push(value ? 'standard-enter' : 'standard-exit'); },
    };
    const scope = vm.createContext({
        window: {}, navigator: { maxTouchPoints: ios ? 5 : 0 },
        CSS: { supports: () => ios }, document: { fullscreenEnabled: enabled },
        Artplayer: {}, art: player, console,
        setTimeout(fn, delay) { timers.set(++id, { fn, delay }); return id; },
        clearTimeout(timer) { timers.delete(timer); },
    });
    vm.runInContext(source.slice(start, end), scope);
    function expire() { for (const [id, { fn }] of [...timers]) { timers.delete(id); fn(); } }
    function assertClean() {
        assert.equal(timers.size, 0);
        assert.equal([...listeners.values()].reduce((sum, set) => sum + set.size, 0), 0);
    }
    return { calls, video, player, scope, timers, expire, assertClean };
}

test('iPad uses system video mode even when container fullscreen is supported; inline controls stay unchanged', () => {
    for (const enabled of [true, false]) {
        const h = harness({ enabled });
        h.scope.togglePreferredFullscreen();
        assert.deepEqual(h.calls, ['mode:fullscreen']);
        assert.equal(h.player.fullscreen, false);
        assert.equal(h.player.fullscreenWeb, false);
        assert.equal(h.video.controls, false);
        assert.equal(h.video.playsInline, true);
        h.video.webkitPresentationMode = 'fullscreen';
        h.video.emit('webkitpresentationmodechanged');
        h.assertClean();
        h.scope.togglePreferredFullscreen();
        assert.deepEqual(h.calls, ['mode:fullscreen', 'mode:inline']);
        h.video.webkitPresentationMode = 'inline';
        h.video.emit('webkitpresentationmodechanged');
        h.assertClean();
    }
});

test('Installed iOS control calls the native API synchronously on its own player, preserving the click gesture', () => {
    const h = harness();
    h.scope.installIOSNativeFullscreenControl(h.player);
    const control = h.player.controls.control;
    assert.equal(control.name, 'ios-native-fullscreen');
    assert.equal(control.position, 'right');
    assert.equal(control.html, '<svg></svg>');
    h.scope.art = null;
    control.click();
    assert.deepEqual(h.calls, ['mode:fullscreen']);
    h.video.emit('webkitbeginfullscreen');
    h.assertClean();
});

test('A native API returning normally without fullscreen is detected as failure, never substituted with web fullscreen', () => {
    const h = harness();
    h.scope.togglePreferredFullscreen();
    assert.equal(h.scope.isIOSNativeFullscreen(h.video), false);
    assert.equal(h.player.notice.show, '');
    h.expire();
    assert.match(h.player.notice.show, /未能进入 iOS 系统全屏/);
    assert.deepEqual(h.calls, ['mode:fullscreen']);
    assert.equal(h.player.fullscreenWeb, false);
    h.assertClean();
});

test('Rapid repeat clicks cannot race pending native enter/exit requests', () => {
    const h = harness();
    h.scope.togglePreferredFullscreen();
    h.scope.togglePreferredFullscreen();
    assert.deepEqual(h.calls, ['mode:fullscreen']);
    h.video.webkitDisplayingFullscreen = true;
    h.video.emit('webkitbeginfullscreen');
    h.scope.togglePreferredFullscreen();
    h.scope.togglePreferredFullscreen();
    assert.deepEqual(h.calls, ['mode:fullscreen', 'mode:inline']);
    h.video.webkitDisplayingFullscreen = false;
    h.video.emit('webkitendfullscreen');
    h.assertClean();
});

test('Native state can confirm synchronous or asynchronous success even without a mode event', () => {
    for (const synchronous of [true, false]) {
        const h = harness();
        h.video.webkitSetPresentationMode = mode => {
            h.calls.push(`mode:${mode}`);
            if (synchronous) h.video.webkitPresentationMode = mode;
        };
        h.scope.togglePreferredFullscreen();
        if (!synchronous) { h.video.webkitPresentationMode = 'fullscreen'; h.expire(); }
        assert.equal(h.player.notice.show, '');
        h.assertClean();
    }
});

test('Older iPhone/iPad uses native legacy enter/exit including historical capitalization', () => {
    for (const alternate of [true, false]) {
        const h = harness({ presentation: false });
        if (alternate) {
            h.video.webkitEnterFullScreen = h.video.webkitEnterFullscreen;
            h.video.webkitExitFullScreen = h.video.webkitExitFullscreen;
            delete h.video.webkitEnterFullscreen;
            delete h.video.webkitExitFullscreen;
        }
        h.scope.togglePreferredFullscreen();
        h.video.webkitDisplayingFullscreen = true;
        h.video.emit('webkitbeginfullscreen');
        h.scope.togglePreferredFullscreen();
        h.video.webkitDisplayingFullscreen = false;
        h.video.emit('webkitendfullscreen');
        assert.deepEqual(h.calls, ['native-enter', 'native-exit']);
        assert.equal(h.player.fullscreenWeb, false);
        h.assertClean();
    }
});

test('Unsupported or throwing mode API only tries another native video API in the same gesture', () => {
    for (const throws of [true, false]) {
        const h = harness();
        if (throws) h.video.webkitSetPresentationMode = () => { throw new Error('Unsupported'); };
        else h.video.webkitSupportsPresentationMode = () => false;
        h.scope.togglePreferredFullscreen();
        assert.deepEqual(h.calls, ['native-enter']);
        h.expire();
        assert.match(h.player.notice.show, /未能进入/);
        h.assertClean();
    }
});

test('Missing or failing native APIs report failure rather than replacing system controls with webpage controls', () => {
    for (const throws of [true, false]) {
        const h = harness({ presentation: false, legacy: throws });
        if (throws) h.video.webkitEnterFullscreen = () => { throw new Error('Not supported'); };
        h.scope.togglePreferredFullscreen();
        assert.match(h.player.notice.show, /未能进入/);
        assert.equal(h.player.fullscreen, false);
        assert.equal(h.player.fullscreenWeb, false);
        assert.deepEqual(h.calls, []);
        h.assertClean();
    }
});

test('Timeout cannot display an error on a destroyed or replaced player', () => {
    for (const destroy of [true, false]) {
        const h = harness();
        h.scope.togglePreferredFullscreen();
        if (destroy) h.player.isDestroy = true;
        else h.player.video = {};
        h.expire();
        assert.equal(h.player.notice.show, '');
        h.assertClean();
    }
});

test('Desktop keeps its existing ArtPlayer fullscreen controls and route', () => {
    const h = harness({ ios: false });
    h.scope.installIOSNativeFullscreenControl(h.player);
    assert.equal(h.player.controls.control, undefined);
    h.scope.togglePreferredFullscreen();
    h.scope.togglePreferredFullscreen();
    assert.deepEqual(h.calls, ['standard-enter', 'standard-exit']);
    h.scope.art = null;
    assert.doesNotThrow(() => h.scope.togglePreferredFullscreen());
    h.assertClean();
});

test('Only fullscreen helpers and asset version change; playback business code is preserved', () => {
    const update = JSON.parse(read('tests/fixtures/player-fullscreen-update.json'));
    assert.equal(update.baseRevision, '73561ba');
    assert.equal(update.assetVersion, '20261009-2');
    assert.deepEqual(Object.keys(update.hashes), ['js/player.js', 'player.html']);
    const hash = text => createHash('sha256').update(text).digest('hex');
    for (const [file, expected] of Object.entries(update.hashes)) {
        assert.equal(hash(withoutThemeHooks(file, read(file))), expected, file);
    }
    const before = source.indexOf('const iosFullscreenRequests =');
    assert.equal(hash(source.slice(0, before) + source.slice(end)), update.unchangedPlayback);
    const html = read('player.html');
    assert.equal(hash(html.replace(`js/player.js?v=${update.assetVersion}`, 'js/player.js')), update.originalPlayerHtml);
    assert.equal(html.split(`js/player.js?v=${update.assetVersion}`).length, 2);
    assert.match(source, /click: function \(\) \{\s*togglePreferredFullscreen\(player\);/);
    assert.match(source, /fullscreen: !isIOS,/);
    assert.match(source, /fullscreenWeb: !isIOS,/);
});
