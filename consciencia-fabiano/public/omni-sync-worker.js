// V4.0 OMNI-LIBRARY SYNC — micro-batches de 200 com descarte explícito de referências.
const DB_NAME="fns_rag_resilience_v1";
const DB_VERSION=1;
const BATCH_SIZE=200;

function openDb(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
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
async function putBatch(rows){
  const db=await openDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction("chunks","readwrite");
    const store=tx.objectStore("chunks");
    for(const row of rows){
      const documentId=String(row?.document_id||"");
      const chunkIndex=Number(row?.chunk_index||0);
      const id=String(row?.id||"");
      if(!documentId||!String(row?.text||"").trim())continue;
      store.put({
        key:"omni:"+String(id||documentId+":"+chunkIndex),
        id,
        doc_key:documentId,
        document_id:documentId,
        filename:String(row?.filename||row?.title||"Documento"),
        title:String(row?.title||row?.filename||"Documento"),
        author:String(row?.author||""),
        language:String(row?.language||"pt"),
        page:Number(row?.page||0)||null,
        chunk_index:chunkIndex,
        text:String(row?.text||""),
        source:"supabase-omni-sync",
        updated_at:Date.now()
      });
    }
    tx.oncomplete=()=>{db.close();resolve(true);};
    tx.onerror=()=>{const e=tx.error;db.close();reject(e);};
    tx.onabort=()=>{const e=tx.error;db.close();reject(e);};
  });
}
function authHeaders(token){
  const headers={"Accept":"application/json"};
  if(token)headers["X-FNS-Owner-Token"]=token;
  return headers;
}
async function fetchPage(endpoint,token,offset){
  const url=new URL(endpoint,self.location.origin);
  url.searchParams.set("offset",String(offset));
  url.searchParams.set("limit",String(BATCH_SIZE));
  const res=await fetch(url.toString(),{headers:authHeaders(token),cache:"no-store"});
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(data?.message||data?.error||("HTTP "+res.status));
  return data;
}
async function syncAll({endpoint,token}){
  let offset=0,totalWritten=0,pageNo=0,done=false;
  const docs=new Map();
  while(!done){
    let payload=await fetchPage(endpoint,token,offset);
    let rows=Array.isArray(payload?.rows)?payload.rows:[];
    if(rows.length){
      await putBatch(rows);
      totalWritten+=rows.length;
      for(const row of rows){
        const id=String(row?.document_id||"");
        if(!id)continue;
        const meta=docs.get(id)||{
          document_id:id,
          arquivo:String(row?.filename||row?.title||"Documento"),
          titulo:String(row?.title||row?.filename||"Documento"),
          autor:String(row?.author||""),
          idioma:String(row?.language||"pt"),
          paginas:new Set(),
          chunks:0
        };
        if(Number(row?.page||0))meta.paginas.add(Number(row.page));
        meta.chunks++;
        docs.set(id,meta);
      }
    }
    pageNo++;
    self.postMessage({
      type:"progress",page:pageNo,offset,
      batch_count:rows.length,total_written:totalWritten,
      cloud_total:Number(payload?.total||0)||null,
      batch_size:BATCH_SIZE
    });
    done=payload?.done===true||rows.length<BATCH_SIZE;
    offset=Number(payload?.next_offset??(offset+rows.length));
    // MEMORY FLUSH: remove as referências do payload antes da próxima página.
    rows.length=0;
    rows=null;
    payload=null;
    await new Promise(resolve=>setTimeout(resolve,0));
  }
  const catalog=[...docs.values()].map(d=>({
    ...d,paginas:d.paginas.size,status:"omni-local-ready",source:"supabase-omni-sync",updated_at:Date.now()
  }));
  return {ok:true,total_written:totalWritten,documents:catalog.length,catalog,batch_size:BATCH_SIZE,memory_bounded:true};
}
self.onmessage=async event=>{
  const data=event.data||{};
  if(data.type!=="start")return;
  try{
    const result=await syncAll(data);
    self.postMessage({type:"done",...result});
  }catch(error){
    self.postMessage({type:"error",message:String(error?.message||error)});
  }
};
