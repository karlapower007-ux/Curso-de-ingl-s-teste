// V6.0 PHANTOM DAEMON + resilience service worker.
// Browser note: a Service Worker may be suspended by the browser. The 3-minute cadence is enforced
// while the origin is active, and Periodic Background Sync is used when supported.
const CACHE_NAME="fns-consiencia-v10-1-private-offline-online-alias-v3";
const DAEMON_INTERVAL_MS=3*60*1000;
const OFFLINE_ASSET_HOSTS=new Set([
  "cdn.jsdelivr.net",
  "huggingface.co",
  "cdn-lfs.huggingface.co",
  "hf.co",
  "cdn-lfs.hf.co",
  "cas-bridge.xethub.hf.co"
]);
const BATCH_SIZE=200;
const DAEMON_DB="fns_omni_daemon_v6";
const DAEMON_DB_VERSION=1;
const RAG_DB="fns_rag_resilience_v1";
const RAG_DB_VERSION=1;

const CORE=[
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/biblioteca_backup.json",
  "/style.css",
  "/app.js",
  "/failover-v3.js",
  "/local-turbine-pool.js",
  "/local-turbine-worker.js",
  "/strict-match-core.js",
  "/omni-sync-worker.js",
  "/agent-swarm.js",
  "/agent-node-worker.js",
  "/rag-cascade.js",
  "/rag-search-worker.js",
  "/embedding-worker.js",
  "/whisper-local.js",
  "/whisper-worker.js",
  "/failover-manifest.json",
  "/steel/index.json",
  "/fabiano-fechado.png",
  "/fabiano-falando.png",
  "/fabiano-aberto.png"
];

let daemonRunning=false;
let lastDaemonAttempt=0;
let daemonTimer=0;
let sessionOwnerToken="";

function openDaemonDb(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DAEMON_DB,DAEMON_DB_VERSION);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains("meta"))db.createObjectStore("meta",{keyPath:"key"});
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}
async function metaGet(key){
  const db=await openDaemonDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction("meta","readonly"),req=tx.objectStore("meta").get(key);
    req.onsuccess=()=>{const v=req.result?.value;db.close();resolve(v);};
    req.onerror=()=>{const e=req.error;db.close();reject(e);};
  });
}
async function metaPut(key,value){
  const db=await openDaemonDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction("meta","readwrite");
    tx.objectStore("meta").put({key,value,updated_at:Date.now()});
    tx.oncomplete=()=>{db.close();resolve(true);};
    tx.onerror=()=>{const e=tx.error;db.close();reject(e);};
  });
}
async function metaDelete(key){
  const db=await openDaemonDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction("meta","readwrite");
    tx.objectStore("meta").delete(key);
    tx.oncomplete=()=>{db.close();resolve(true);};
    tx.onerror=()=>{const e=tx.error;db.close();reject(e);};
  });
}
function openRagDb(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(RAG_DB,RAG_DB_VERSION);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains("chunks")){
        const s=db.createObjectStore("chunks",{keyPath:"key"});
        s.createIndex("document_id","document_id",{unique:false});
      }
      if(!db.objectStoreNames.contains("vectors")){
        const s=db.createObjectStore("vectors",{keyPath:"key"});
        s.createIndex("document_id","document_id",{unique:false});
      }
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}
async function putChunkBatch(rows,generation){
  const db=await openRagDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(["chunks","vectors"],"readwrite");
    const chunkStore=tx.objectStore("chunks");
    const vectorStore=tx.objectStore("vectors");
    for(const row of rows){
      const cloudDocumentId=String(row?.document_id||"");
      const contentHash=String(row?.content_hash||"").toLowerCase();
      const documentId=/^[0-9a-f]{64}$/.test(contentHash)?contentHash:cloudDocumentId;
      const text=String(row?.text||"").trim();
      if(!documentId||!text)continue;
      const chunkIndex=Number(row?.chunk_index||0);
      const id=String(row?.id||documentId+":"+chunkIndex);
      const base={
        key:"omni:"+id,id,doc_key:documentId,document_id:documentId,
        cloud_document_id:cloudDocumentId,
        filename:String(row?.filename||row?.title||"Documento"),
        title:String(row?.title||row?.filename||"Documento"),
        author:String(row?.author||""),language:String(row?.language||"pt"),
        page:Number(row?.page||0)||null,chunk_index:chunkIndex,text,
        content_hash:String(row?.content_hash||""),
        source:"r2-hydration",sync_generation:generation,updated_at:Date.now()
      };
      chunkStore.put(base);
      const vector=Array.isArray(row?.vector)?row.vector.map(Number).filter(Number.isFinite):[];
      if(vector.length>=64)vectorStore.put({...base,vector});
    }
    tx.oncomplete=()=>{db.close();resolve(true);};
    tx.onerror=()=>{const e=tx.error;db.close();reject(e);};
    tx.onabort=()=>{const e=tx.error;db.close();reject(e);};
  });
}

async function cleanupOldGeneration(generation){
  const db=await openRagDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(["chunks","vectors"],"readwrite");
    let deleted=0;
    for(const name of ["chunks","vectors"]){
      const store=tx.objectStore(name),req=store.openCursor();
      req.onsuccess=()=>{
        const cursor=req.result;
        if(!cursor)return;
        const row=cursor.value||{};
        if((row.source==="supabase-omni-sync"||row.source==="r2-hydration") &&
           String(row.sync_generation||"")!==generation){
          cursor.delete();deleted++;
        }
        cursor.continue();
      };
    }
    tx.oncomplete=()=>{db.close();resolve(deleted);};
    tx.onerror=()=>{const e=tx.error;db.close();reject(e);};
  });
}
async function countRagChunks(){
  const db=await openRagDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction("chunks","readonly"),req=tx.objectStore("chunks").count();
    req.onsuccess=()=>{const n=Number(req.result||0);db.close();resolve(n);};
    req.onerror=()=>{const e=req.error;db.close();reject(e);};
  });
}
function authHeaders(token){
  const h={"Accept":"application/json","Cache-Control":"no-store"};
  if(token)h["X-FNS-Owner-Token"]=token;
  return h;
}
async function fetchJson(url,token){
  const res=await fetch(url,{headers:authHeaders(token),cache:"no-store"});
  const data=await res.json().catch(()=>({}));
  if(!res.ok){
    const err=new Error(data?.message||data?.error||("HTTP "+res.status));
    err.status=res.status;throw err;
  }
  return data;
}
async function notifyClients(payload){
  const clients=await self.clients.matchAll({type:"window",includeUncontrolled:true});
  for(const client of clients)client.postMessage(payload);
}
async function runPhantomDaemon({force=false,reason="daemon"}={}){
  if(daemonRunning)return {ok:false,busy:true};
  const operatingMode=String(await metaGet("operating_mode").catch(()=>"auto")||"auto");
  if(operatingMode==="offline")return {ok:true,skipped:"offline-mode"};
  const token=String(sessionOwnerToken||"");
  if(!token)return {ok:false,code:"DAEMON_AUTH_NOT_CONFIGURED"};
  const now=Date.now();
  const persistedAttempt=Number(await metaGet("last_attempt").catch(()=>0)||0);
  if(!force&&now-Math.max(lastDaemonAttempt,persistedAttempt)<DAEMON_INTERVAL_MS)return {ok:true,skipped:"interval"};
  daemonRunning=true;lastDaemonAttempt=now;
  await metaPut("last_attempt",now).catch(()=>{});
  try{
    const state=await fetchJson("/api/admin/omni-sync-state",token);
    const previous=String(await metaGet("cloud_signature").catch(()=>"")||"");
    const signature=String(state?.signature||"");
    const localChunkCount=await countRagChunks().catch(()=>0);
    if(!force&&signature&&previous===signature&&localChunkCount>=Number(state?.total||0)){
      await metaPut("last_success",Date.now()).catch(()=>{});
      await notifyClients({type:"omni-daemon-idle",signature,total:Number(state?.total||0),reason,local_chunks:localChunkCount});
      return {ok:true,changed:false,total:Number(state?.total||0)};
    }

    const generation="r2-"+String(state?.generation||Date.now().toString(36));
    let offset=0,totalWritten=0,done=false,batches=0;
    while(!done){
      let payload=await fetchJson("/api/admin/omni-sync-page?offset="+encodeURIComponent(offset)+"&limit="+BATCH_SIZE,token);
      let rows=Array.isArray(payload?.rows)?payload.rows:[];
      const count=rows.length;
      if(count){
        await putChunkBatch(rows,generation);
        totalWritten+=count;
      }
      batches++;
      done=payload?.done===true;
      const nextOffset=Number(payload?.next_offset||offset+count);
      if(!done && nextOffset<=offset)done=true;
      offset=nextOffset;
      await notifyClients({
        type:"omni-daemon-progress",written:totalWritten,total:Number(payload?.total||state?.total||0),
        batch:batches,batch_size:BATCH_SIZE,reason,
        backend:String(payload?.backend||"cloudflare-r2")
      });
      // bounded-memory flush before requesting the next R2 shard
      rows.length=0;
      rows=null;
      payload=null;
      await Promise.resolve();
    }
    const deleted=await cleanupOldGeneration(generation);
    if(signature)await metaPut("cloud_signature",signature);
    await metaPut("last_success",Date.now());
    await metaPut("last_generation",generation);
    await notifyClients({
      type:"omni-daemon-synced",written:totalWritten,deleted,total:Number(state?.total||totalWritten),
      batches,signature,reason,memory_bounded:true,backend:"cloudflare-r2"
    });
    return {ok:true,changed:true,written:totalWritten,deleted,batches};
  }catch(error){
    if(Number(error?.status)===401){sessionOwnerToken="";await metaDelete("owner_token").catch(()=>{});}
    await metaPut("last_error",String(error?.message||error)).catch(()=>{});
    await notifyClients({type:"omni-daemon-error",message:String(error?.message||error),reason});
    return {ok:false,error:String(error?.message||error)};
  }finally{
    daemonRunning=false;
  }
}
function armBestEffortTimer(){
  if(daemonTimer)clearTimeout(daemonTimer);
  daemonTimer=setTimeout(()=>{
    runPhantomDaemon({reason:"service-worker-timer"}).finally(()=>armBestEffortTimer());
  },DAEMON_INTERVAL_MS);
}
function maybeRunOnActivity(event){
  const now=Date.now();
  if(now-lastDaemonAttempt<DAEMON_INTERVAL_MS)return;
  lastDaemonAttempt=now;
  event.waitUntil(runPhantomDaemon({reason:"origin-activity"}).catch(()=>{}));
}

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
    // Purge any admin token persisted by pre-v10.1 service workers.
    await metaDelete("owner_token").catch(()=>{});
    await self.clients.claim();
    armBestEffortTimer();
    await runPhantomDaemon({reason:"activate"}).catch(()=>{});
  })());
});

self.addEventListener("message",event=>{
  const data=event.data||{};
  if(data.type==="set-operating-mode"){
    event.waitUntil(metaPut("operating_mode",["auto","offline","online"].includes(String(data.mode))?String(data.mode):"auto"));
    return;
  }
  if(data.type==="configure-omni-daemon"){
    event.waitUntil((async()=>{
      const token=String(data.token||"");
      if(token)sessionOwnerToken=token;
      await metaDelete("owner_token").catch(()=>{});
      armBestEffortTimer();
      await runPhantomDaemon({force:Boolean(data.force),reason:"configure"}).catch(()=>{});
    })());
    return;
  }
  if(data.type==="omni-daemon-tick"){
    event.waitUntil(runPhantomDaemon({reason:"window-heartbeat"}).catch(()=>{}));
    return;
  }
  if(data.type==="hydrate-r2-library"){
    event.waitUntil((async()=>{
      const token=String(data.token||"");
      if(token)sessionOwnerToken=token;
      await metaDelete("owner_token").catch(()=>{});
      await runPhantomDaemon({force:data.force!==false,reason:"r2-self-heal"}).catch(()=>{});
    })());
  }
});

self.addEventListener("periodicsync",event=>{
  if(event.tag==="fns-omni-daemon-v7-r2"){
    event.waitUntil(runPhantomDaemon({reason:"periodic-background-sync"}).catch(()=>{}));
  }
});
self.addEventListener("sync",event=>{
  if(event.tag==="fns-omni-daemon-v7-r2"){
    event.waitUntil(runPhantomDaemon({force:true,reason:"background-sync"}).catch(()=>{}));
  }
});

self.addEventListener("fetch",event=>{
  const req=event.request;
  const url=new URL(req.url);

  // v10 Egress Firewall: in forced 100% offline mode, even a page opened while
  // the device still has Internet access cannot contact external hosts. Approved
  // static AI/PDF assets are served only from the local Cache Storage if present.
  if(url.origin!==self.location.origin){
    event.respondWith((async()=>{
      const mode=String(await metaGet("operating_mode").catch(()=>"auto")||"auto");
      const cache=await caches.open(CACHE_NAME);
      const cached=await cache.match(req,{ignoreVary:true});
      if(mode==="offline") return cached || Response.error();
      if(!OFFLINE_ASSET_HOSTS.has(url.hostname)) return fetch(req);
      try{
        const res=await fetch(req);
        if(res.ok || res.type==="opaque") await cache.put(req,res.clone()).catch(()=>{});
        return res;
      }catch{
        return cached || Response.error();
      }
    })());
    return;
  }

  if(url.pathname.startsWith("/api/") || url.pathname.startsWith("/health")){
    event.respondWith((async()=>{
      const mode=String(await metaGet("operating_mode").catch(()=>"auto")||"auto");
      if(mode==="offline"){
        return new Response(JSON.stringify({ok:false,offline:true,code:"OFFLINE_ONLY",message:"Modo 100% offline ativo."}),{
          status:503,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}
        });
      }
      return fetch(req);
    })());
    return;
  }
  maybeRunOnActivity(event);
  if(req.method!=="GET") return;

  if(url.pathname==="/api/v1/r2/library-manifest"){
    // Private stale-while-revalidate: never serve the private cache without the owner header.
    if(!req.headers.get("X-FNS-Owner-Token"))return;
    event.respondWith((async()=>{
      const cache=await caches.open(CACHE_NAME);
      const cached=await cache.match(req);
      const network=fetch(req).then(async res=>{
        if(res.ok)await cache.put(req,res.clone());
        return res;
      }).catch(()=>null);
      if(cached){
        event.waitUntil(network.then(()=>{}));
        return cached;
      }
      return (await network) || new Response(JSON.stringify({ok:false,offline:true,metadata:[]}),{
        status:503,headers:{"Content-Type":"application/json"}
      });
    })());
    return;
  }

  const isSteel=url.pathname.startsWith("/steel/");
  const isResilienceAsset=isSteel || [
    "/failover-v3.js","/local-turbine-pool.js","/local-turbine-worker.js","/strict-match-core.js","/omni-sync-worker.js",
    "/agent-swarm.js","/agent-node-worker.js","/embedding-worker.js",
    "/failover-manifest.json","/rag-cascade.js","/rag-search-worker.js","/opfs-sqlite-worker.js"
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
