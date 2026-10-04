import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const theme = read('css/ui-theme.css');
const palette = read('css/ui-palette.css');
const rules = [...theme.matchAll(/([^{}]+)\{([^{}]*)\}/g)];

test('Native player controls and menus stay white on dark backgrounds independently of palette', () => {
    const root = rules.find(([, selector]) => selector.trim() === '.jayflix-ui .art-video-player');
    assert.ok(root);
    assert.match(root[2], /--art-font-color:\s*#fff !important;/);
    assert.match(root[2], /--art-widget-background:\s*rgba\(0, 0, 0, \.85\);/);
    assert.match(root[2], /--art-tip-background:\s*rgba\(0, 0, 0, \.7\);/);
    const controls = rules.find(([, selector]) => selector.includes('.art-controls, .art-settings'));
    assert.ok(controls);
    assert.match(controls[2], /--art-theme:\s*#fff !important;/);
    for (const [, selector, declarations] of rules) {
        if (!/\.art-(controls|settings|selector|contextmenu|volume|info|notice|setting-item)/.test(selector)) continue;
        assert.doesNotMatch(declarations, /(?:color|background|--art-theme)\s*:[^;]*var\(/, selector);
        assert.doesNotMatch(declarations, /\b(?:display|position|opacity|transform|pointer-events|width|height)\s*:/, selector);
    }
});

test('Volume stays white while playback progress still follows the accent', () => {
    const volume = rules.find(([, selector]) => selector.includes('.art-volume-loaded'));
    assert.ok(volume);
    assert.match(volume[2], /background-color:\s*#fff !important;/);
    assert.doesNotMatch(palette, /--art-(?:font-color|scrollbar-background(?:-hover)?)\s*:/);
    assert.match(palette, /\.art-progress-played\s*\{\s*background:\s*var\(--home-accent\) !important;/);
    assert.match(palette, /--art-loaded-color:\s*var\(--palette-accent-loaded\)/);
});

test('README documents the player-control exception without removing progress colour support', () => {
    assert.match(read('README.md'), /播放器操作区固定白色图标／文字与深色背景，不参与调色，进度条仍随强调色联动/);
});
