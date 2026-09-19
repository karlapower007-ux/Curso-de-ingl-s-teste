const CACHE_NAME="fns-ultimate-resilience-v3";
const CORE=[
  "/",
  "/index.html",
  "/style.css",
  "/app.js",
  "/failover-v3.js",
  "/failover-manifest.json",
  "/steel/index.json",
  "/fabiano-fechado.png",
  "/fabiano-falando.png",
  "/fabiano-aberto.png"
];

self.addEventListener("install",event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE_NAME);
    for(const url of CORE){
      try{await cache.add(new Request(url,{cache:"reload"}));}catch{}
    }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate",event=>{
  event.waitUntil((async()=>{
    const names=await caches.keys();
    await Promise.all(names.filter(n=>n!==CACHE_NAME).map(n=>caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch",event=>{
  const req=event.request;
  if(req.method!=="GET") return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin) return;
  if(url.pathname.startsWith("/api/") || url.pathname.startsWith("/health")) return;

  const isSteel=url.pathname.startsWith("/steel/");
  const isResilienceAsset=isSteel || [
    "/failover-v3.js","/failover-manifest.json","/rag-cascade.js","/rag-search-worker.js","/opfs-sqlite-worker.js"
  ].includes(url.pathname);

  if(isResilienceAsset){
    event.respondWith((async()=>{
      const cache=await caches.open(CACHE_NAME);
      const cached=await cache.match(req);
      if(cached) return cached;
      try{
        const res=await fetch(req);
        if(res.ok) await cache.put(req,res.clone());
        return res;
      }catch{
        return cached || new Response("",{status:503});
      }
    })());
    return;
  }

  event.respondWith((async()=>{
    try{
      const res=await fetch(req);
      const cache=await caches.open(CACHE_NAME);
      if(res.ok) cache.put(req,res.clone()).catch(()=>{});
      return res;
    }catch{
      return (await caches.match(req)) || (await caches.match("/index.html")) || new Response("Offline",{status:503});
    }
  })());
});
