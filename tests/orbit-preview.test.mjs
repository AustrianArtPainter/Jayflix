import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { applyOrbitPreviewHeaders, installLocalPreviewPolicy } from '../scripts/start-local-preview.mjs';

test('Local orbit HTML, JS and CSS responses are no-store, including versioned entry URLs', () => {
    for (const url of ['/orbit-test.html?mode=capacity&v=20261003-11', '/js/home-orbit.js?v=20261003-11',
        '/js/orbit-test.js?v=20261003-11', '/js/orbit-capacity.js?v=20261003-2', '/css/orbit-test.css', '/css/home-orbit.css']) {
        const headers = new Map();
        applyOrbitPreviewHeaders({ url }, { setHeader: (name, value) => headers.set(name, value) });
        assert.equal(headers.get('Cache-Control'), 'no-store');
    }
});

test('The preview hook does not intercept or alter API/image response caching or other pages', () => {
    for (const url of ['/api/search?q=test', '/api/image?url=poster', '/proxy/stream', '/watch.html', '/player.html', '/']) {
        applyOrbitPreviewHeaders({ url }, { setHeader() { assert.fail(`Unexpected change to ${url}`); } });
    }
    const entry = readFileSync(new URL('../scripts/start-local-preview.mjs', import.meta.url), 'utf8');
    assert.match(entry, /process\.env\.CACHE_MAX_AGE = '0'/);
    assert.match(entry, /import\('\.\.\/server\.mjs'\)/);
    // The original backend and all business files are additionally hash-checked
    // by home-orbit.test.mjs. This launcher does not replace their request logic.
});

test('Preview policy binds only to 127.0.0.1 and restores the listen method after one server', () => {
    class Server extends EventEmitter {
        listen(...args) { this.listenArgs = args; return this; }
    }
    const original = Server.prototype.listen, server = new Server();
    const restore = installLocalPreviewPolicy(Server);
    const callback = () => {};
    const result = server.listen(8080, callback);
    assert.equal(result, server);
    assert.deepEqual(server.listenArgs, [8080, '127.0.0.1', callback]);
    assert.equal(Server.prototype.listen, original);
    const headers = new Map();
    server.emit('request', { url: '/orbit-test.html' }, { setHeader: (name, value) => headers.set(name, value) });
    assert.equal(headers.get('Cache-Control'), 'no-store');
    restore();
});
