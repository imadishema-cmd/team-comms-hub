const CACHE='ccc-hub-v4.0.0';
const SHELL=['/','/index.html','/styles.css','/app.js','/api-client.js','/ui.js','/manifest.webmanifest','/assets/zipline-logo-card.png','/assets/zipline-hero.jpg','/assets/zipline-motion-1.jpg','/assets/zipline-motion-2.jpg','/assets/zipline-motion-3.jpg','/icons/icon-192.png','/icons/icon-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET'||new URL(request.url).pathname.startsWith('/api/')||new URL(request.url).pathname.startsWith('/.netlify/'))return;
  event.respondWith(fetch(request).then(response=>{const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(request,copy));return response;}).catch(()=>caches.match(request).then(hit=>hit||caches.match('/index.html'))));
});
