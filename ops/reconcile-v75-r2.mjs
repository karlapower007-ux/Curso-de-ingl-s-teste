import fs from "node:fs/promises";
import path from "node:path";

const BASE=String(process.env.FNS_BASE_URL || "https://consciencia-fabiano.focoeepoder2.workers.dev").replace(/\/$/,"");
const OWNER=String(process.env.FNS_OWNER_TOKEN || "").trim();
const STATUS_PATH=path.resolve(process.env.R2_RECONCILE_STATUS_PATH || ".ci-results/v75-r2-reconciliation.json");
const PAGE_SIZE=200;
const MAX_FETCH_RETRIES=4;

async function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function writeStatus(data){
  await fs.mkdir(path.dirname(STATUS_PATH),{recursive:true});
  const safe={
    state:String(data.state||"unknown"),
    primary_total:Number(data.primary_total||0),
    exported_chunks:Number(data.exported_chunks||0),
    vectors:Number(data.vectors||0),
    shards:Number(data.shards||0),
    generation:String(data.generation||""),
    reason:String(data.reason||"")
  };
  await fs.writeFile(STATUS_PATH,JSON.stringify(safe,null,2)+"\n");
  console.log("FNS_R2_RECONCILE_STATE="+safe.state);
}

function quotaLike(status,text){
  return status===429 || /quota|free tier|exceeded allowed rows read|too many requests/i.test(String(text||""));
}

async function adminRequest(url,options={}){
  let last=null;
  for(let attempt=1;attempt<=MAX_FETCH_RETRIES;attempt++){
    try{
      const res=await fetch(url,{
        ...options,
        headers:{
          "X-FNS-Owner-Token":OWNER,
          "Accept":"application/json",
          ...(options.headers||{})
        }
      });
      const text=await res.text();
      let data={};
      try{ data=JSON.parse(text||"{}"); }catch{}
      if(res.ok && data?.ok!==false) return {ok:true,status:res.status,data,text};
      if(quotaLike(res.status,text)) return {ok:false,waiting:true,status:res.status,data,text};
      last=new Error("HTTP "+res.status+" "+String(data?.code||text).slice(0,320));
      if(res.status<500 || res.status===409) throw last;
    }catch(error){
      last=error;
    }
    await sleep(Math.min(12000,1200*(2**(attempt-1))));
  }
  throw last || new Error("request failed");
}

function vectorOf(row){
  if(Array.isArray(row?.vector)) return row.vector;
  if(Array.isArray(row?.embedding)) return row.embedding;
  if(typeof row?.embedding==="string"){
    try{
      const parsed=JSON.parse(row.embedding);
      if(Array.isArray(parsed)) return parsed;
    }catch{}
  }
  return [];
}

if(!OWNER){
  await writeStatus({state:"blocked",reason:"missing FNS_OWNER_TOKEN"});
  process.exit(2);
}

let probe;
try{
  probe=await adminRequest(BASE+"/api/admin/export-library?mode=cursor&limit=1&include_total=1");
}catch(error){
  const message=String(error?.message||error);
  await writeStatus({
    state:"waiting",
    reason:/Error 1101|Worker threw exception/i.test(message)
      ? "primary Cloudflare Worker 1101; wait for quota reset"
      : "primary export unavailable: "+message.slice(0,220)
  });
  process.exit(0);
}
if(probe.waiting){
  await writeStatus({state:"waiting",reason:"primary quota/read limit not reset"});
  process.exit(0);
}
const primaryTotal=Math.max(0,Number(probe.data?.total||0));
if(!probe.ok || probe.data?.ok!==true || primaryTotal<=0){
  await writeStatus({state:"waiting",reason:"primary export endpoint not ready"});
  process.exit(0);
}

const existing=await adminRequest(BASE+"/api/admin/omni-sync-state").catch(()=>null);
if(existing?.ok && existing.data?.ok===true &&
   existing.data?.authoritative===true &&
   Number(existing.data?.total||0)===primaryTotal &&
   Number(existing.data?.vectors||0)>0){
  await writeStatus({
    state:"reconciled",
    primary_total:primaryTotal,
    exported_chunks:primaryTotal,
    vectors:Number(existing.data.vectors||0),
    shards:Number(existing.data.shards||0),
    generation:String(existing.data.generation||""),
    reason:"authoritative R2 snapshot already current"
  });
  process.exit(0);
}

const generation="v75-r2-"+Date.now().toString(36);
let cursorId="";
let exported=0;
let vectors=0;
let shards=0;

try{
  while(exported<primaryTotal){
    const params=new URLSearchParams({mode:"cursor",limit:String(PAGE_SIZE)});
    if(cursorId) params.set("after_id",cursorId);
    const page=await adminRequest(BASE+"/api/admin/export-library?"+params.toString());

    if(page.waiting){
      await writeStatus({
        state:"waiting",primary_total:primaryTotal,exported_chunks:exported,vectors,shards,generation,
        reason:"quota returned during DO to R2 reconciliation"
      });
      process.exit(0);
    }
    if(!page.ok || page.data?.ok!==true) throw new Error("Primary cursor page failed after "+exported);

    const raw=Array.isArray(page.data?.records)?page.data.records:[];
    if(!raw.length){
      if(page.data?.done===true && exported===primaryTotal) break;
      throw new Error("Primary cursor ended early at "+exported+" of "+primaryTotal);
    }

    const groups=new Map();
    for(const row of raw){
      const documentId=String(row?.document_id||row?.doc_key||"").slice(0,180);
      if(!documentId) throw new Error("record without document_id");
      if(vectorOf(row).length>=64) vectors++;
      if(!groups.has(documentId)) groups.set(documentId,[]);
      groups.get(documentId).push(row);
    }

    let groupNo=0;
    for(const [documentId,records] of groups){
      const stored=await adminRequest(BASE+"/api/admin/r2-library-shard",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          generation,
          document_id:documentId,
          offset:exported+groupNo,
          records
        })
      });
      if(Number(stored.data?.records||0)!==records.length){
        throw new Error("R2 shard count mismatch for "+documentId);
      }
      shards++;
      groupNo++;
    }

    exported+=raw.length;
    const next=page.data?.next_cursor||null;
    if(page.data?.done===true) break;
    if(!next?.id) throw new Error("Primary cursor missing next_cursor");
    if(String(next.id)===cursorId) throw new Error("Primary cursor did not advance");
    cursorId=String(next.id);
  }

  if(exported!==primaryTotal){
    throw new Error("R2 reconciliation count mismatch: exported="+exported+" primary="+primaryTotal);
  }
  if(vectors<=0){
    throw new Error("Primary export returned zero vectors");
  }

  const final=await adminRequest(BASE+"/api/admin/r2-reconcile-finalize",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({generation,chunks:primaryTotal,vectors,shards})
  });

  if(final.data?.authoritative!==true ||
     Number(final.data?.total_chunks||0)!==primaryTotal ||
     Number(final.data?.vectors||0)<=0){
    throw new Error("Authoritative R2 finalize verification failed");
  }

  await writeStatus({
    state:"reconciled",
    primary_total:primaryTotal,
    exported_chunks:exported,
    vectors:Number(final.data.vectors||vectors),
    shards:Number(final.data.shards||shards),
    generation:String(final.data.generation||generation)
  });
}catch(error){
  await writeStatus({
    state:"failed",
    primary_total:primaryTotal,
    exported_chunks:exported,
    vectors,
    shards,
    generation,
    reason:String(error?.message||error)
  });
  process.exitCode=1;
}
