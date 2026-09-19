import sqlite3InitModule from "https://cdn.jsdelivr.net/npm/@sqlite.org/sqlite-wasm@3.53.4-build1/+esm";
let dbPromise=null;
async function getDb(){
  if(dbPromise)return dbPromise;
  dbPromise=(async()=>{
    const sqlite3=await sqlite3InitModule({print:()=>{},printErr:()=>{}});
    const pool=await sqlite3.installOpfsSAHPoolVfs({name:"fns-rag-resilience",initialCapacity:4});
    const db=new pool.OpfsSAHPoolDb("/fns-rag-resilience.sqlite3");
    db.exec("CREATE TABLE IF NOT EXISTS chunks(key TEXT PRIMARY KEY,document_id TEXT,filename TEXT,title TEXT,author TEXT,page INTEGER,text TEXT,updated_at INTEGER)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(document_id)");
    return db;
  })();
  return dbPromise;
}
function fold(text){return String(text||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu," ").replace(/\s+/g," ").trim();}
function terms(q){return [...new Set(fold(q).split(" ").filter(x=>x.length>=3))].slice(0,8);}
async function persist(chunks){
  const db=await getDb();
  db.exec("BEGIN");
  try{
    for(const r of chunks){
      db.exec({sql:"INSERT OR REPLACE INTO chunks(key,document_id,filename,title,author,page,text,updated_at) VALUES(?,?,?,?,?,?,?,?)",bind:[String(r.key||""),String(r.document_id||r.doc_key||""),String(r.filename||""),String(r.title||""),String(r.author||""),Number(r.page||0),String(r.text||""),Number(r.updated_at||Date.now())]});
    }
    db.exec("COMMIT");
  }catch(e){try{db.exec("ROLLBACK");}catch{}throw e;}
}
async function search(question,topK){
  const db=await getDb(),qs=terms(question);
  if(!qs.length)return [];
  const rows=[];
  const like="%"+qs[0]+"%";
  db.exec({sql:"SELECT key,document_id,filename,title,author,page,text FROM chunks WHERE lower(text) LIKE ? LIMIT 1200",bind:[like],rowMode:"object",callback:r=>rows.push({...r})});
  const scored=[];
  for(const r of rows){const f=fold(r.text);let hit=0,freq=0;for(const t of qs){if(f.includes(t)){hit++;freq+=f.split(t).length-1;}}if(hit)scored.push({...r,score:(hit/qs.length)*4+Math.min(2,freq*.2)});}
  return scored.sort((a,b)=>b.score-a.score).slice(0,topK);
}
self.onmessage=async e=>{
  const d=e.data||{},id=d.id;
  try{
    if(d.type==="persist-chunks"){await persist(d.chunks||[]);self.postMessage({id,ok:true,count:(d.chunks||[]).length});return;}
    if(d.type==="search"){const matches=await search(d.question||"",Number(d.top_k||100));self.postMessage({id,ok:true,matches});return;}
    if(d.type==="delete-document"){const db=await getDb();db.exec({sql:"DELETE FROM chunks WHERE document_id=?",bind:[String(d.document_id||"")]});self.postMessage({id,ok:true});return;}
    self.postMessage({id,ok:false,error:"unknown operation"});
  }catch(error){self.postMessage({id,ok:false,error:String(error?.message||error)});}
};
