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
async function countStore(store){
  const db=await openDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(store,"readonly"),req=tx.objectStore(store).count();
    req.onsuccess=()=>{const v=Number(req.result||0);db.close();resolve(v);};
    req.onerror=()=>{const e=req.error;db.close();reject(e);};
  });
}
async function pageStore(store,offset=0,limit=50){
  const db=await openDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(store,"readonly"),os=tx.objectStore(store),rows=[];
    const req=os.openCursor();
    let skipped=false;
    req.onsuccess=()=>{
      const cursor=req.result;
      if(!cursor || rows.length>=limit){db.close();resolve(rows);return;}
      if(!skipped && offset>0){skipped=true;cursor.advance(offset);return;}
      skipped=true;
      rows.push(cursor.value);
      cursor.continue();
    };
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
function terms(q){const stop=new Set(["a","o","as","os","de","da","do","das","dos","e","em","no","na","nos","nas","um","uma","que","sobre","para","por","com","como","quero","saber","saiba","conhecer","conheca","informacao","informação","versiculo","versículo","passagem","citacao","citação","referencia","referência"]);return [...new Set(fold(q).split(" ").filter(x=>x.length>=3&&!stop.has(x)))].slice(0,18);}
async function semantic(query,topK,minScore){
  const rows=await all("vectors"),out=[];
  for(const r of rows){const score=cosine(query,r.vector);if(score>=minScore)out.push({...r,score});}
  return out.sort((a,b)=>b.score-a.score).slice(0,topK);
}
async function literalAnchorSearch(question,topK){
  const rows=await all("chunks"),qs=terms(question);
  if(!rows.length||!qs.length)return [];
  const out=[];
  for(const row of rows){
    const f=fold(row.text);
    let matched=0,hits=0;
    for(const term of qs){
      if(!f.includes(term))continue;
      matched++;
      let at=0,count=0;
      while((at=f.indexOf(term,at))>=0 && count<12){count++;at+=term.length;}
      hits+=count;
    }
    if(matched){
      const coverage=matched/qs.length;
      out.push({...row,score:8+coverage*5+Math.min(3,hits*.25),retrieval_mode:"literal-anchor-local"});
    }
  }
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

const EXACT_SWARM_NODE_COUNT=1000;
const EXACT_MAX_CONCURRENCY=50;
const EXACT_OVERLAP_SCAN=360;

function directIntent(question){
  const raw=String(question||"");
  const q=fold(raw);
  const chapter=q.match(/\b(?:capitulo|chapter)\s+(\d{1,4})\b/);
  const verse=raw.match(/\b(\d{1,4})\s*:\s*(\d{1,4})\b/);
  const full=/\b(?:capitulo|chapter)\b.*\b(?:completo|inteiro|integral|na integra|full|whole|entire)\b/i.test(q)||
    /\b(?:completo|inteiro|integral|na integra|full|whole|entire)\b.*\b(?:capitulo|chapter)\b/i.test(q);
  const exactVerse=/\b(?:versiculo|verse)\b.*\b(?:exato|literal|integral|exact|verbatim)\b/i.test(q)||
    (/\b(?:exato|literal|exact|verbatim)\b/i.test(q)&&Boolean(verse));
  const rawText=/\b(?:texto exato|texto literal|texto integral|na integra|sem resumir|sem resumo|raw text|verbatim|transcreva|transcricao integral|copie exatamente|mostre exatamente)\b/i.test(q);
  return {
    triggered:full||exactVerse||rawText,
    mode:full?"full-chapter":exactVerse?"exact-verse":rawText?"raw-text":"",
    chapter_number:chapter?Number(chapter[1]):(verse?Number(verse[1]):null),
    verse_number:verse?Number(verse[2]):null
  };
}
function sortDirect(rows){
  return Array.from(rows||[]).filter(r=>String(r?.text||"").length).sort((a,b)=>{
    const ai=Number.isFinite(Number(a?.chunk_index))?Number(a.chunk_index):Number.MAX_SAFE_INTEGER;
    const bi=Number.isFinite(Number(b?.chunk_index))?Number(b.chunk_index):Number.MAX_SAFE_INTEGER;
    if(ai!==bi)return ai-bi;
    const ap=Number(a?.page||0),bp=Number(b?.page||0);
    if(ap!==bp)return ap-bp;
    return String(a?.key||a?.id||"").localeCompare(String(b?.key||b?.id||""));
  });
}
function stitchDirect(rows){
  let out="";
  for(const row of sortDirect(rows)){
    const next=String(row?.text||"");
    if(!next)continue;
    if(!out){out=next;continue;}
    const max=Math.min(EXACT_OVERLAP_SCAN,out.length,next.length);
    let overlap=0;
    for(let n=max;n>=12;n--){if(out.slice(-n)===next.slice(0,n)){overlap=n;break;}}
    out+=overlap?next.slice(overlap):"\n"+next;
  }
  return out;
}
function chapterSlice(text,n){
  const raw=String(text||"");n=Number(n||0);if(!raw||!n)return null;
  const startRe=new RegExp("(?:^|\\n)\\s*(?:CAP[ÍI]TULO|CAPITULO|CHAPTER)\\s+"+n+"\\b","im");
  const m=startRe.exec(raw);if(!m)return null;
  let start=m.index;if(raw[start]==="\n")start++;
  const tail=m.index+m[0].length;
  const endRe=new RegExp("(?:^|\\n)\\s*(?:CAP[ÍI]TULO|CAPITULO|CHAPTER)\\s+"+(n+1)+"\\b","im");
  const next=endRe.exec(raw.slice(tail));
  return raw.slice(start,next?tail+next.index:raw.length).replace(/\s+$/,"")||null;
}
function verseSlice(text,v){
  const raw=String(text||"");v=Number(v||0);if(!raw||!v)return null;
  const startRe=new RegExp("(^|[\\n\\r]|\\s)"+v+"\\s+(?=[A-ZÁÀÂÃÉÊÍÓÔÕÚÇa-záàâãéêíóôõúç])","mu");
  const m=startRe.exec(raw);if(!m)return null;
  const start=m.index+(m[1]?.length||0);
  const tail=raw.slice(start+String(v).length);
  const endRe=new RegExp("(^|[\\n\\r]|\\s)"+(v+1)+"\\s+(?=[A-ZÁÀÂÃÉÊÍÓÔÕÚÇa-záàâãéêíóôõúç])","mu");
  const next=endRe.exec(tail);
  const end=next?start+String(v).length+next.index+(next[1]?.length||0):raw.length;
  return raw.slice(start,end).replace(/\s+$/,"")||null;
}
async function pool(tasks,limit,fn){
  const list=Array.from(tasks||[]),out=new Array(list.length);let cursor=0;
  const count=Math.max(1,Math.min(Number(limit)||1,list.length||1));
  await Promise.all(Array.from({length:count},async()=>{
    while(true){
      const i=cursor++;if(i>=list.length)return;
      out[i]=await fn(list[i],i);
    }
  }));
  return out;
}
async function directRetrieve(question){
  const intent=directIntent(question);
  if(!intent.triggered)return {ok:false,direct:false,code:"DIRECT_INTENT_NOT_DETECTED"};
  const anchors=await literalAnchorSearch(question,50);
  const anchor=anchors[0];
  if(!anchor)return {ok:false,direct:true,code:"LOCAL_DIRECT_ANCHOR_NOT_FOUND"};
  const doc=String(anchor.document_id||anchor.doc_key||"");
  const allRows=sortDirect((await all("chunks")).filter(r=>String(r.document_id||r.doc_key||"")===doc));
  const pos=Math.max(0,allRows.findIndex(r=>String(r.key||r.id||"")===String(anchor.key||anchor.id||"")));
  const before=intent.mode==="full-chapter"?300:intent.mode==="exact-verse"?80:12;
  const max=intent.mode==="full-chapter"?1000:intent.mode==="exact-verse"?240:48;
  const start=Math.max(0,pos-before);
  const windowRows=allRows.slice(start,Math.min(allRows.length,start+max, start+EXACT_SWARM_NODE_COUNT));
  const ordered=await pool(windowRows,EXACT_MAX_CONCURRENCY,async(row,index)=>({...row,__node:index+1}));
  const stitched=stitchDirect(ordered);
  let text="",scope="";
  if(intent.mode==="full-chapter"&&intent.chapter_number){
    text=chapterSlice(stitched,intent.chapter_number)||"";
    if(text)scope="full-chapter";
  }
  if(!text&&intent.mode==="exact-verse"){
    const base=(intent.chapter_number&&chapterSlice(stitched,intent.chapter_number))||stitched;
    text=(intent.verse_number&&verseSlice(base,intent.verse_number))||String(anchor.text||"");
    scope=intent.verse_number&&text!==String(anchor.text||"")?"exact-verse":"exact-anchor-chunk";
  }
  if(!text&&intent.mode==="raw-text"){
    const idx=Math.max(0,sortDirect(ordered).findIndex(r=>String(r.key||r.id||"")===String(anchor.key||anchor.id||"")));
    text=stitchDirect(sortDirect(ordered).slice(Math.max(0,idx-2),idx+3));
    scope="raw-exact-window";
  }
  if(!text){text=stitched;scope="ordered-raw-window";}
  return {
    ok:Boolean(text),direct:true,bypass_llm:true,text,scope,intent,
    provider:"indexeddb-local",document_id:doc,
    filename:String(anchor.filename||anchor.title||"Documento local"),
    title:String(anchor.title||anchor.filename||"Documento local"),
    author:String(anchor.author||""),page:Number(anchor.page||0)||null,
    anchor_chunk_index:Number(anchor.chunk_index||0),
    logical_swarm_size:EXACT_SWARM_NODE_COUNT,
    logical_nodes_used:ordered.length,max_concurrency:EXACT_MAX_CONCURRENCY,
    ordered_buffer:true,chunks_reassembled:ordered.length,llm_calls:0
  };
}

self.onmessage=async e=>{
  const d=e.data||{},id=d.id;
  try{
    if(d.type==="persist-chunks"){const count=await putMany("chunks",d.chunks||[]);self.postMessage({id,ok:true,count});return;}
    if(d.type==="persist-vectors"){const count=await putMany("vectors",d.records||[]);self.postMessage({id,ok:true,count});return;}
    if(d.type==="search-semantic"){const matches=await semantic(d.query||[],Number(d.top_k||500),Number(d.min_score||.38));self.postMessage({id,ok:true,matches});return;}
    if(d.type==="search-bm25"){const topK=Number(d.top_k||500);const anchored=await literalAnchorSearch(d.question||"",topK);const matches=anchored.length?anchored:await bm25(d.question||"",topK);self.postMessage({id,ok:true,matches,mode:anchored.length?"literal-anchor":"bm25"});return;}
    if(d.type==="local-stats"){
      const [chunks,vectors]=await Promise.all([countStore("chunks"),countStore("vectors")]);
      self.postMessage({id,ok:true,chunks,vectors});
      return;
    }
    if(d.type==="export-vectors"){
      const offset=Math.max(0,Number(d.offset||0));
      const limit=Math.max(1,Math.min(100,Number(d.limit||50)));
      const total=await countStore("vectors");
      const records=await pageStore("vectors",offset,limit);
      self.postMessage({id,ok:true,total,offset,records,next_offset:offset+records.length,done:(offset+records.length)>=total});
      return;
    }
    if(d.type==="list-documents"){const documents=await listDocuments();self.postMessage({id,ok:true,documents});return;}
    if(d.type==="get-document-chunks"){
      const documentId=String(d.document_id||"");
      const offset=Math.max(0,Number(d.offset||0));
      const limit=Math.max(1,Math.min(EXACT_SWARM_NODE_COUNT,Number(d.limit||20)));
      const rows=sortDirect((await all("chunks"))
        .filter(r=>String(r.document_id||r.doc_key||"")===documentId))
        .slice(offset,offset+limit);
      self.postMessage({id,ok:true,chunks:rows});
      return;
    }
    if(d.type==="direct-retrieve"){
      const result=await directRetrieve(d.question||"");
      self.postMessage({id,...result});
      return;
    }
    if(d.type==="delete-document"){const documentId=String(d.document_id||"");const a=await deleteByDocument("chunks",documentId);const b=await deleteByDocument("vectors",documentId);self.postMessage({id,ok:true,deleted:a+b});return;}
    self.postMessage({id,ok:false,error:"unknown operation"});
  }catch(error){self.postMessage({id,ok:false,error:String(error?.message||error)});}
};
