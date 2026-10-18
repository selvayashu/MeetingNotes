/// <reference lib="webworker" />
// Service worker (Workbox, injectManifest): precaches the app shell for offline use and lets the
// app know when connectivity returns so queued recordings are processed.
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { ExpirationPlugin } from 'workbox-expiration';

declare let self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// SPA: serve the cached index.html for every navigation, so deep links work offline.
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));

// ONNX Runtime WebAssembly for in-browser Whisper (~20 MB, too big to precache): cached on first use,
// i.e. when the user downloads the offline model in Settings. Covers the bundled copy and the CDN copy.
// Model weights are cached separately by transformers.js in Cache Storage.
registerRoute(
  ({ url }) =>
    (url.origin === self.location.origin && url.pathname.endsWith('.wasm')) ||
    (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('onnxruntime-web')),
  new CacheFirst({
    cacheName: 'ort-runtime',
    plugins: [new CacheableResponsePlugin({ statuses: [0, 200] }), new ExpirationPlugin({ maxEntries: 20 })],
  }),
);

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});

interface SyncEvent extends ExtendableEvent {
  tag: string;
}

// Background Sync (Chromium): when the device is back online, wake open windows to process the queue.
self.addEventListener('sync', ((event: SyncEvent) => {
  if (event.tag !== 'meetnotes-queue') return;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      clients.forEach((client) => client.postMessage({ type: 'PROCESS_QUEUE' }));
    }),
  );
}) as EventListener);
