import path from "node:path";
import {mkdir} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {exactAndMatches,splitConcepts} from "./v2-local-core.mjs";

const VERSION="v3-incremental-1";
const MAX_PAGE_CHARS=700000;
const CHUNK_TARGET=1200;
const CHUNK_OVERLAP=160;

async function sqliteApi(){
  try{return await import("node:sqlite");}
  catch{return null;}
}
function clean(value,max=500){
  return String(value||"").replace(/\u0000/g,"").replace(/\s+/g," ").trim().slice(0,max);
}
function cleanText(value,max=MAX_PAGE_CHARS){
  return String(value||"").replace(/\u0000/g,"").replace(/\r\n?/g,"\n").trim().slice(0,max);
}
function fold(value=""){
  return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^\p{L}\p{N}\s:+-]/gu," ").replace(/\s+/g," ").trim();
}
function safeDocId(sha){
  const v=String(sha||"").toLowerCase().replace(/[^0-9a-f]/g,"").slice(0,64);
  if(v.length!==64)throw Object.assign(new Error("SHA-256 inválido para o PDF."),{status:400});
  return v;
}
function chunkPage(text,target=CHUNK_TARGET,overlap=CHUNK_OVERLAP){
  const raw=cleanText(text);
  if(!raw)return [];
  const paragraphs=raw.split(/\n\s*\n+/).map(x=>x.replace(/\s+/g," ").trim()).filter(Boolean);
  const source=paragraphs.length?paragraphs:[raw.replace(/\s+/g," ").trim()];
  const out=[];
  for(const para of source){
    if(para.length<=target){out.push(para);continue;}
    let at=0;
    while(at<para.length){
      let end=Math.min(para.length,at+target);
      if(end<para.length){
        const window=para.slice(at,end);
        const cut=Math.max(window.lastIndexOf(". "),window.lastIndexOf("; "),window.lastIndexOf(": "));
        if(cut>Math.floor(target*0.55))end=at+cut+1;
      }
      const piece=para.slice(at,end).trim();
      if(piece.length>=35)out.push(piece);
      if(end>=para.length)break;
      at=Math.max(at+1,end-overlap);
    }
  }
  return out;
}

function openDb(DatabaseSync,dbPath){
  const db=new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec("PRAGMA synchronous=NORMAL;");
  db.exec("PRAGMA temp_store=MEMORY;");
  db.exec("PRAGMA foreign_keys=ON;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS documents(
      document_id TEXT PRIMARY KEY,
      content_sha256 TEXT NOT NULL UNIQUE,
      filename TEXT NOT NULL,
      title TEXT NOT NULL,
      author TEXT NOT NULL DEFAULT '',
      language TEXT NOT NULL DEFAULT '',
      page_count INTEGER NOT NULL DEFAULT 0,
      chunk_count INTEGER NOT NULL DEFAULT 0,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ready',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chunks(
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      page INTEGER,
      chunk_index INTEGER NOT NULL,
      title TEXT NOT NULL,
      author TEXT NOT NULL DEFAULT '',
      language TEXT NOT NULL DEFAULT '',
      text TEXT NOT NULL,
      folded_text TEXT NOT NULL,
      FOREIGN KEY(document_id) REFERENCES documents(document_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id,chunk_index);
    CREATE INDEX IF NOT EXISTS idx_chunks_page ON chunks(document_id,page);
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      id UNINDEXED,document_id UNINDEXED,text,title,
      tokenize='unicode61 remove_diacritics 2'
    );
    CREATE TABLE IF NOT EXISTS jobs(
      job_id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      content_sha256 TEXT NOT NULL,
      filename TEXT NOT NULL,
      title TEXT NOT NULL,
      author TEXT NOT NULL DEFAULT '',
      language TEXT NOT NULL DEFAULT '',
      page_count INTEGER NOT NULL DEFAULT 0,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      received_pages INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'receiving',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS job_pages(
      job_id TEXT NOT NULL,
      page INTEGER NOT NULL,
      text TEXT NOT NULL,
      PRIMARY KEY(job_id,page),
      FOREIGN KEY(job_id) REFERENCES jobs(job_id) ON DELETE CASCADE
    );
  `);
  db.prepare("INSERT INTO meta(key,value) VALUES('version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(VERSION);
  return db;
}
function ftsQuote(value){
  return '"'+String(value||"").replace(/"/g,'""')+'"';
}
function conceptFtsExpression(query,aliases={}){
  const concepts=splitConcepts(query,aliases);
  if(!concepts.length)return {concepts,expr:""};
  const groups=concepts.map(c=>{
    const values=[...new Set((c.aliases||[]).map(fold).filter(x=>x.length>=2))];
    if(!values.length)return "";
    return values.length===1?ftsQuote(values[0]):"("+values.map(ftsQuote).join(" OR ")+")";
  }).filter(Boolean);
  return {concepts,expr:groups.join(" AND ")};
}

export async function createIncrementalLibrary(root){
  const api=await sqliteApi();
  if(!api?.DatabaseSync)throw new Error("SQLite local é obrigatório para biblioteca incremental de grande escala.");
  const dir=path.join(root,".fns-local");
  await mkdir(dir,{recursive:true});
  const dbPath=path.join(dir,"v3-incremental.sqlite");
  const db=openDb(api.DatabaseSync,dbPath);

  const start=meta=>{
    const sha=safeDocId(meta?.content_sha256);
    const existing=db.prepare("SELECT document_id,filename,title,page_count,chunk_count,status FROM documents WHERE content_sha256=?").get(sha);
    if(existing)return {ok:true,duplicate:true,document:existing};

    const existingJob=db.prepare("SELECT job_id,document_id,received_pages,page_count,status FROM jobs WHERE content_sha256=? ORDER BY updated_at DESC LIMIT 1").get(sha);
    if(existingJob)return {ok:true,duplicate:false,resumed:true,...existingJob};

    const now=new Date().toISOString();
    const jobId="inc-"+randomUUID().replace(/-/g,"");
    const title=clean(meta?.title||meta?.filename||"Livro",300)||"Livro";
    const filename=clean(meta?.filename||title,300)||title;
    db.prepare("INSERT INTO jobs(job_id,document_id,content_sha256,filename,title,author,language,page_count,size_bytes,received_pages,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,0,'receiving',?,?)")
      .run(jobId,sha,sha,filename,title,clean(meta?.author,300),clean(meta?.language,30),Math.max(0,Number(meta?.page_count||0)),Math.max(0,Number(meta?.size_bytes||0)),now,now);
    return {ok:true,duplicate:false,resumed:false,job_id:jobId,document_id:sha,received_pages:0,page_count:Math.max(0,Number(meta?.page_count||0)),status:"receiving"};
  };

  const append=(jobId,pages=[])=>{
    const job=db.prepare("SELECT * FROM jobs WHERE job_id=?").get(String(jobId||""));
    if(!job)throw Object.assign(new Error("Job incremental não encontrado."),{status:404});
    const insert=db.prepare("INSERT INTO job_pages(job_id,page,text) VALUES(?,?,?) ON CONFLICT(job_id,page) DO UPDATE SET text=excluded.text");
    db.exec("BEGIN IMMEDIATE;");
    try{
      for(const entry of (Array.isArray(pages)?pages:[])){
        const page=Math.max(1,Number(entry?.page||0));
        const text=cleanText(entry?.text);
        if(!text)continue;
        insert.run(job.job_id,page,text);
      }
      const received=Number(db.prepare("SELECT COUNT(*) AS n FROM job_pages WHERE job_id=?").get(job.job_id)?.n||0);
      db.prepare("UPDATE jobs SET received_pages=?,status='receiving',updated_at=? WHERE job_id=?").run(received,new Date().toISOString(),job.job_id);
      db.exec("COMMIT;");
      return {ok:true,job_id:job.job_id,document_id:job.document_id,received_pages:received,page_count:Number(job.page_count||0)};
    }catch(error){
      try{db.exec("ROLLBACK;");}catch{}
      throw error;
    }
  };

  const commit=jobId=>{
    const job=db.prepare("SELECT * FROM jobs WHERE job_id=?").get(String(jobId||""));
    if(!job)throw Object.assign(new Error("Job incremental não encontrado."),{status:404});
    const duplicate=db.prepare("SELECT document_id,filename,title,page_count,chunk_count,status FROM documents WHERE content_sha256=?").get(job.content_sha256);
    if(duplicate){
      db.prepare("DELETE FROM jobs WHERE job_id=?").run(job.job_id);
      return {ok:true,duplicate:true,document:duplicate,rows:[]};
    }
    const pages=db.prepare("SELECT page,text FROM job_pages WHERE job_id=? ORDER BY page").all(job.job_id);
    if(!pages.length)throw Object.assign(new Error("Nenhuma página foi recebida para este PDF."),{status:400});

    const now=new Date().toISOString();
    const rows=[];
    let chunkIndex=0;
    for(const page of pages){
      for(const text of chunkPage(page.text)){
        const id=job.document_id+":"+chunkIndex;
        rows.push({
          id,key:id,document_id:job.document_id,filename:job.filename,title:job.title,
          author:job.author,language:job.language,page:Number(page.page||0)||null,
          pdf_page:Number(page.page||0)||null,page_basis:"pdf",
          chunk_index:chunkIndex++,text,source:"incremental-local"
        });
      }
    }
    if(!rows.length)throw Object.assign(new Error("O PDF não produziu trechos pesquisáveis."),{status:400});

    db.exec("BEGIN IMMEDIATE;");
    try{
      db.prepare("INSERT INTO documents(document_id,content_sha256,filename,title,author,language,page_count,chunk_count,size_bytes,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'ready',?,?)")
        .run(job.document_id,job.content_sha256,job.filename,job.title,job.author,job.language,Number(job.page_count||pages.length),rows.length,Number(job.size_bytes||0),now,now);
      const ins=db.prepare("INSERT INTO chunks(id,document_id,page,chunk_index,title,author,language,text,folded_text) VALUES(?,?,?,?,?,?,?,?,?)");
      const fts=db.prepare("INSERT INTO chunks_fts(id,document_id,text,title) VALUES(?,?,?,?)");
      for(const row of rows){
        ins.run(row.id,row.document_id,row.page,row.chunk_index,row.title,row.author,row.language,row.text,fold(row.text));
        fts.run(row.id,row.document_id,row.text,row.title);
      }
      db.prepare("DELETE FROM jobs WHERE job_id=?").run(job.job_id);
      db.exec("COMMIT;");
    }catch(error){
      try{db.exec("ROLLBACK;");}catch{}
      throw error;
    }
    return {
      ok:true,duplicate:false,
      document:{document_id:job.document_id,filename:job.filename,title:job.title,author:job.author,language:job.language,page_count:Number(job.page_count||pages.length),chunk_count:rows.length,status:"ready"},
      rows
    };
  };

  const listDocuments=({limit=5000,offset=0}={})=>{
    const safeLimit=Math.max(1,Math.min(10000,Number(limit||5000)));
    const safeOffset=Math.max(0,Number(offset||0));
    return db.prepare("SELECT document_id,filename,title,author,language,page_count,chunk_count,size_bytes,status,created_at,updated_at FROM documents ORDER BY created_at DESC LIMIT ? OFFSET ?").all(safeLimit,safeOffset);
  };
  const counts=()=>{
    const documents=Number(db.prepare("SELECT COUNT(*) AS n FROM documents").get()?.n||0);
    const chunks=Number(db.prepare("SELECT COUNT(*) AS n FROM chunks").get()?.n||0);
    const jobs=Number(db.prepare("SELECT COUNT(*) AS n FROM jobs").get()?.n||0);
    const pages_pending=Number(db.prepare("SELECT COUNT(*) AS n FROM job_pages").get()?.n||0);
    return {version:VERSION,documents,chunks,jobs,pages_pending,db_path:dbPath};
  };
  const getChunk=id=>{
    const row=db.prepare("SELECT id AS key,id,document_id,title,author,language,page,chunk_index,text FROM chunks WHERE id=?").get(String(id||""));
    return row?{...row,pdf_page:Number(row.page||0)||null,page_basis:"pdf",source:"incremental-local"}:null;
  };
  const getPage=(documentId,page)=>{
    return db.prepare("SELECT id AS key,id,document_id,title,author,language,page,chunk_index,text FROM chunks WHERE document_id=? AND page=? ORDER BY chunk_index")
      .all(String(documentId||""),Number(page||0)).map(r=>({...r,pdf_page:Number(r.page||0)||null,page_basis:"pdf",source:"incremental-local"}));
  };
  const rowsForDocument=documentId=>{
    return db.prepare("SELECT id AS key,id,document_id,title,author,language,page,chunk_index,text FROM chunks WHERE document_id=? ORDER BY chunk_index")
      .all(String(documentId||"")).map(r=>({...r,pdf_page:Number(r.page||0)||null,page_basis:"pdf",source:"incremental-local"}));
  };
  const allReadyDocumentIds=()=>db.prepare("SELECT document_id FROM documents WHERE status='ready' ORDER BY created_at").all().map(x=>String(x.document_id));

  const searchDictionary=(query,{aliases={},page=1,pageSize=50}={})=>{
    const safePage=Math.max(1,Number(page||1));
    const safeSize=Math.min(100,Math.max(1,Number(pageSize||50)));
    const {concepts,expr}=conceptFtsExpression(query,aliases);
    if(!concepts.length||!expr)return {query,concepts:[],total:0,page:safePage,page_size:safeSize,pages:0,matches:[]};
    let candidates=[];
    try{
      candidates=db.prepare("SELECT c.id AS key,c.id,c.document_id,c.title,c.author,c.language,c.page,c.chunk_index,c.text FROM chunks_fts f JOIN chunks c ON c.id=f.id WHERE chunks_fts MATCH ? ORDER BY c.document_id,c.chunk_index").all(expr);
    }catch{
      candidates=[];
    }
    const exact=exactAndMatches(candidates,query,{aliases,page:1,pageSize:100});
    // exactAndMatches pagina internamente; para preservar total sem teto, refazemos sobre candidatos em blocos lógicos.
    const allHits=[];
    for(let p=1;;p++){
      const batch=exactAndMatches(candidates,query,{aliases,page:p,pageSize:100});
      allHits.push(...batch.matches);
      if(p>=batch.pages)break;
    }
    const startAt=(safePage-1)*safeSize;
    return {
      query,
      concepts:exact.concepts,
      total:allHits.length,
      page:safePage,
      page_size:safeSize,
      pages:Math.ceil(allHits.length/safeSize),
      matches:allHits.slice(startAt,startAt+safeSize).map(x=>({...x,reference:[x.title,x.page?("PDF p. "+x.page):""].filter(Boolean).join(" • ")}))
    };
  };

  return {version:VERSION,db_path:dbPath,start,append,commit,listDocuments,counts,getChunk,getPage,rowsForDocument,allReadyDocumentIds,searchDictionary};
}
