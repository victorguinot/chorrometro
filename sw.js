/* Chorrómetro · funciona sin conexión: guarda la web en el móvil */
var V='chorro-1794667898';
var CORE=['./','index.html','fb.js','config.js','manifest.webmanifest','icon.svg','icon-192.png','apple-touch-icon.png','vendor/leaflet.js','vendor/leaflet.css','vendor/leaflet-heat.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js','https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js','https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'];
self.addEventListener('install',function(e){e.waitUntil(caches.open(V).then(function(c){return Promise.all(CORE.map(function(u){return c.add(u).catch(function(){});}));}).then(function(){return self.skipWaiting();}));});
self.addEventListener('activate',function(e){e.waitUntil(caches.keys().then(function(ks){return Promise.all(ks.filter(function(k){return k!==V&&k.indexOf('chorro-')===0;}).map(function(k){return caches.delete(k);}));}).then(function(){return self.clients.claim();}));});
function cacheable(u){return u.origin===self.location.origin||/(^|\.)gstatic\.com$/.test(u.hostname)||u.hostname==='cdnjs.cloudflare.com'||/fonts\.(googleapis|gstatic)\.com$/.test(u.hostname)||u.hostname==='tile.openstreetmap.org';}
self.addEventListener('fetch',function(e){
  var r=e.request;if(r.method!=='GET')return;var u=new URL(r.url);if(!cacheable(u))return;
  if(r.mode==='navigate'||(u.origin===self.location.origin&&/(\/|\.html|fb\.js|config\.js)$/.test(u.pathname))){
    e.respondWith(fetch(r).then(function(res){if(res&&res.ok){var cp=res.clone();caches.open(V).then(function(c){c.put(r,cp);});}return res;}).catch(function(){return caches.match(r,{ignoreSearch:true}).then(function(m){return m||caches.match('index.html');});}));return;}
  e.respondWith(caches.match(r).then(function(m){var net=fetch(r).then(function(res){if(res&&(res.ok||res.type==='opaque')){var cp=res.clone();caches.open(V).then(function(c){c.put(r,cp);});}return res;}).catch(function(){return m;});return m||net;}));
});
