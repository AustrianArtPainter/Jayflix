import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('README concisely documents history activation without changing the underlying search API', () => {
    const readme = read('README.md');
    assert.match(readme, /最近搜索按需展开，点击记录直接搜索/);
    assert.match(readme, /保留鼠标、触屏及键盘操作，避免输入框失焦导致点击失效/);
    assert.ok(readme.split('\n').length <= 75);
    assert.doesNotMatch(readme, /感谢赞助|贡献者福利|JAY[- ]TV/);
});

test('The released homepage references the fixed history controller version', () => {
    const html = read('index.html');
    const release = JSON.parse(read('tests/fixtures/search-history-activation-update.json'));
    assert.equal(release.assetVersion, '20261009-1');
    assert.ok(html.includes(`js/home-search-history.js?v=${release.assetVersion}`));
    assert.match(read('js/home-search-history.js'), /history\.addEventListener\('pointerdown'/);
    assert.match(read('js/ui.js'), /tag\.onclick = function\(\) \{\s*document\.getElementById\('searchInput'\)\.value = item\.text;\s*search\(\);/);
});
