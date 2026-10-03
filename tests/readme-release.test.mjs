import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = file => readFileSync(new URL(file, root), 'utf8');
const readme = read('README.md');

test('README uses JAYFLIX branding and excludes removed sections and outdated grid preview', () => {
    assert.match(readme, /^# JAYFLIX\n/);
    assert.doesNotMatch(readme, /JAY[- ]TV|感谢赞助|贡献者福利|readme-preview\.png/);
    assert.ok(readme.split('\n').length <= 75, 'Keep the release README concise');
    assert.ok(existsSync(new URL('image/logo-jayflix.png', root)));
});

test('Documented orbit limits agree with unchanged release constants', () => {
    const code = read('js/home-orbit.js');
    assert.match(code, /const MAX_DISPLAY_CARDS = 1322;/);
    for (const name of ['MIN_ZOOM', 'MIN_CARD_SCALE']) assert.match(code, new RegExp(`const ${name} = 0\\.5;`));
    for (const name of ['MAX_ZOOM', 'MAX_CARD_SCALE']) assert.match(code, new RegExp(`const ${name} = 5;`));
    assert.match(code, /const DEFAULT_SPEED_PERCENT = 50;/);
    assert.match(readme, /1–1322/);
    assert.match(readme, /前 1322 张/);
    assert.match(readme, /50%–500%/);
    assert.match(readme, /0%–100%/);
    assert.match(readme, /150% \| 150%/);
    assert.match(readme, /200% \| 70%/);
});

test('Deployment instructions retain Pages Functions and qualify empty-frame performance results', () => {
    for (const file of ['functions/_middleware.js', 'functions/image-proxy.js', 'functions/proxy/[[path]].js']) {
        assert.ok(existsSync(new URL(file, root)), file);
    }
    assert.match(readme, /Git 集成会编译 Pages Functions/);
    assert.match(readme, /不会编译 `functions\/`/);
    assert.match(readme, /node --test tests\/\*\.test\.mjs/);
    assert.match(readme, /空框结果不代表加载真实封面后的性能保证/);
    const ignored = read('.gitignore').split('\n');
    for (const pattern of ['node_modules/', 'exports/', '.env', '.DS_Store']) assert.ok(ignored.includes(pattern));
});
