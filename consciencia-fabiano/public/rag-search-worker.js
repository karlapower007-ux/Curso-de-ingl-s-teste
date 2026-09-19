const DB_NAME="fns_rag_resilience_v1";
const DB_VERSION=1;
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
async function putMany(store,items){
  const db=await openDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(store,"readwrite"),os=tx.objectStore(store);
    for(const item of items)os.put(item);
    tx.oncomplete=()=>{db.close();resolve(items.length);};
    tx.onerror=()=>{const e=tx.error;db.close();reject(e);};
  });
}
async function all(store){
  const db=await openDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(store,"readonly"),req=tx.objectStore(store).getAll();
    req.onsuccess=()=>{const v=req.result||[];db.close();resolve(v);};
    req.onerror=()=>{const e=req.error;db.close();reject(e);};
  });
}
function cosine(a,b){
  if(!a||!b||a.length!==b.length||!a.length)return -1;
  let dot=0,na=0,nb=0;
  for(let i=0;i<a.length;i++){const x=Number(a[i])||0,y=Number(b[i])||0;dot+=x*y;na+=x*x;nb+=y*y;}
  return (!na||!nb)?-1:dot/(Math.sqrt(na)*Math.sqrt(nb));
}
function fold(text){return String(text||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu," ").replace(/\s+/g," ").trim();}
function terms(q){const stop=new Set(["a","o","as","os","de","da","do","das","dos","e","em","no","na","um","uma","que","sobre","para","por","com","como","quero","versiculo","passagem","citacao","referencia"]);return [...new Set(fold(q).split(" ").filter(x=>x.length>=3&&!stop.has(x)))].slice(0,12);}
async function semantic(query,topK,minScore){
  const rows=await all("vectors"),out=[];
  for(const r of rows){const score=cosine(query,r.vector);if(score>=minScore)out.push({...r,score});}
  return out.sort((a,b)=>b.score-a.score).slice(0,topK);
}
async function bm25(question,topK){
  const rows=await all("chunks"),qs=terms(question);
  if(!rows.length||!qs.length)return [];
  const docs=rows.map(row=>{const tokens=fold(row.text).split(" ").filter(Boolean),tf=new Map();for(const t of tokens)tf.set(t,(tf.get(t)||0)+1);return {row,tokens,tf,dl:Math.max(1,tokens.length)};});
  const N=docs.length,avgdl=docs.reduce((s,d)=>s+d.dl,0)/N||1,df=new Map(),k1=1.35,b=.75;
  for(const term of qs){let n=0;for(const d of docs)if(d.tf.has(term))n++;df.set(term,n);}
  const out=[];
  for(const d of docs){
    let score=0,matched=0;
    for(const term of qs){const f=d.tf.get(term)||0;if(!f)continue;matched++;const n=df.get(term)||0;const idf=Math.log(1+((N-n+.5)/(n+.5)));score+=idf*((f*(k1+1))/(f+k1*(1-b+b*(d.dl/avgdl))));}
    if(matched)out.push({...d.row,score:score+(matched/qs.length)*2});
  }
  return out.sort((a,b)=>b.score-a.score).slice(0,topK);
}
async function deleteByDocument(store,documentId){
  const rows=await all(store);
  const keys=rows.filter(r=>String(r.document_id||r.doc_key||"")===String(documentId)).map(r=>r.key);
  if(!keys.length)return 0;
  const db=await openDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(store,"readwrite"),os=tx.objectStore(store);
    for(const key of keys)os.delete(key);
    tx.oncomplete=()=>{db.close();resolve(keys.length);};
    tx.onerror=()=>{const e=tx.error;db.close();reject(e);};
  });
}
async function listDocuments(){
  const chunks=await all("chunks"),vectors=await all("vectors"),map=new Map();
  const consume=(r,isVector=false)=>{
    const id=String(r.document_id||r.doc_key||"");
    if(!id)return;
    const x=map.get(id)||{document_id:id,filename:r.filename||"Documento local",title:r.title||r.filename||"Documento local",author:r.author||"",language:r.language||"pt",pages:new Set(),chunks:0,status:"local"};
    if(Number(r.page||0))x.pages.add(Number(r.page));
    if(isVector)x.chunks++;
    x.filename=x.filename||r.filename||"Documento local";
    x.title=x.title||r.title||x.filename;
    map.set(id,x);
  };
  for(const r of chunks)consume(r,false);
  for(const r of vectors)consume(r,true);
  return [...map.values()].map(x=>({document_id:x.document_id,filename:x.filename,title:x.title,author:x.author,language:x.language,pages:x.pages.size,chunks:x.chunks||x.pages.size,status:"local-ready"}));
}

self.onmessage=async e=>{
  const d=e.data||{},id=d.id;
  try{
    if(d.type==="persist-chunks"){const count=await putMany("chunks",d.chunks||[]);self.postMessage({id,ok:true,count});return;}
    if(d.type==="persist-vectors"){const count=await putMany("vectors",d.records||[]);self.postMessage({id,ok:true,count});return;}
    if(d.type==="search-semantic"){const matches=await semantic(d.query||[],Number(d.top_k||15),Number(d.min_score||.38));self.postMessage({id,ok:true,matches});return;}
    if(d.type==="search-bm25"){const matches=await bm25(d.question||"",Number(d.top_k||15));self.postMessage({id,ok:true,matches});return;}
    if(d.type==="list-documents"){const documents=await listDocuments();self.postMessage({id,ok:true,documents});return;}
    if(d.type==="get-document-chunks"){
      const documentId=String(d.document_id||"");
      const offset=Math.max(0,Number(d.offset||0));
      const limit=Math.max(1,Math.min(100,Number(d.limit||20)));
      const rows=(await all("chunks"))
        .filter(r=>String(r.document_id||r.doc_key||"")===documentId)
        .sort((a,b)=>Number(a.page||0)-Number(b.page||0))
        .slice(offset,offset+limit);
      self.postMessage({id,ok:true,chunks:rows});
      return;
    }
    if(d.type==="delete-document"){const documentId=String(d.document_id||"");const a=await deleteByDocument("chunks",documentId);const b=await deleteByDocument("vectors",documentId);self.postMessage({id,ok:true,deleted:a+b});return;}
    self.postMessage({id,ok:false,error:"unknown operation"});
  }catch(error){self.postMessage({id,ok:false,error:String(error?.message||error)});}
};
