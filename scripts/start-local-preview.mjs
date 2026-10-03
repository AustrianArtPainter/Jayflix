// Local preview only: reuse server.mjs unchanged, bind to loopback, and keep
// rapidly edited orbit assets out of the HTTP cache. Production APIs are intact.
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const orbitAssets = new Set([
    '/orbit-test.html', '/js/home-orbit.js', '/js/orbit-test.js',
    '/js/orbit-capacity.js', '/css/home-orbit.css', '/css/orbit-test.css'
]);

export function applyOrbitPreviewHeaders(request, response) {
    if (orbitAssets.has((request.url || '').split('?')[0])) {
        response.setHeader('Cache-Control', 'no-store');
    }
}

export function installLocalPreviewPolicy(Server = net.Server) {
    const originalListen = Server.prototype.listen;
    const restore = () => { Server.prototype.listen = originalListen; };
    Server.prototype.listen = function (port, callback) {
        restore();
        this.prependListener('request', applyOrbitPreviewHeaders);
        return originalListen.call(this, port, '127.0.0.1', callback);
    };
    return restore;
}

export async function startLocalPreview() {
    // Existing configuration, not a source/API change. Other static files are
    // revalidated immediately; the orbit assets above are explicitly no-store.
    process.env.CACHE_MAX_AGE = '0';
    const restore = installLocalPreviewPolicy();
    try { await import('../server.mjs'); }
    catch (error) { restore(); throw error; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    await startLocalPreview();
}
