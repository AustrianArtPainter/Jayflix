import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('README states the native-only iOS fullscreen contract and preserves the pending device-validation caveat', () => {
    const readme = read('README.md');
    assert.match(readme, /iPhone／iPad 全屏入口已恢复为 iOS 系统视频接口，不使用网页容器全屏/);
    assert.match(readme, /非全屏 UI 不变/);
    assert.match(readme, /系统全屏实机效果及灵动岛行为仍待验证/);
    assert.ok(readme.split('\n').length <= 75);
    assert.doesNotMatch(readme, /已验证.*灵动岛|灵动岛.*已修复|全屏问题.*彻底解决/);
});

test('The published player entry references the corrective native-only asset, not the withdrawn container-fullscreen version', () => {
    const html = read('player.html');
    const update = JSON.parse(read('tests/fixtures/player-fullscreen-update.json'));
    assert.equal(update.assetVersion, '20261009-2');
    assert.match(html, /js\/player\.js\?v=20261009-2/);
    assert.doesNotMatch(html, /js\/player\.js\?v=20261009-1/);
});
