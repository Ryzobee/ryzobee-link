import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

async function list(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory()
    ? list(path.join(directory, entry.name)) : path.join(directory, entry.name)))).flat();
}
const files = (await list('dist')).filter(file => !file.endsWith('/sw.js') && !file.endsWith('.map')).sort();
const hash = createHash('sha256');
for (const file of files) hash.update(file).update(await readFile(file));
const cache = `ryzobee-link-${hash.digest('hex').slice(0, 16)}`;
const assets = files.map(file => './' + file.slice(5));
await writeFile('dist/sw.js', `const CACHE=${JSON.stringify(cache)};
const ASSETS=${JSON.stringify(assets)};
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS))));
self.addEventListener('activate', event => event.waitUntil(Promise.all([
  caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('ryzobee-link-') && key !== CACHE).map(key => caches.delete(key)))),
  self.clients.claim()
])));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    // This cache contains only build-time static assets, never API/user responses.
    // Static servers may send Vary: Origin; module requests have an Origin header
    // while cache.addAll() requests do not. They are still the identical asset.
    const hit = await cache.match(event.request, { ignoreVary: true });
    if (hit) return hit;
    try { return await fetch(event.request); }
    catch(error) { if(event.request.mode === 'navigate') return await cache.match('./index.html'); throw error; }
  }));
});
`);
console.log(`Offline cache: ${assets.length} local assets (${cache})`);
