import path from "node:path";
import {mkdir} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {
  splitConcepts,paragraphBlocks,strictParagraphAudit,sanitizePublicTitle,queryTerms
} from "./v2-local-core.mjs";
import {searchV3Evidence} from "./v3-evidence-core.mjs";

const VERSION="v3-incremental-50k-2";
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
  return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase()
    .replace(/[“”„‟«»"'’]/g,"").replace(/[^\p{L}\p{N}\s:+-]/gu," ").replace(/\s+/g," ").trim();
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

function ensureColumn(db,table,name,definition){
  const columns=db.prepare("PRAGMA table_info("+table+")").all().map(x=>String(x.name));
  if(!columns.includes(name))db.exec("ALTER TABLE "+table+" ADD COLUMN "+name+" "+definition+";");
}
function openDb(DatabaseSync,dbPath){
  const db=new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec("PRAGMA synchronous=NORMAL;");
  db.exec("PRAGMA foreign_keys=ON;");
  db.exec("PRAGMA temp_store=MEMORY;");
  db.exec("PRAGMA cache_size=-32768;");
  db.exec("PRAGMA wal_autocheckpoint=2000;");
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
      block_count INTEGER NOT NULL DEFAULT 0,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ready',
      source_path TEXT NOT NULL DEFAULT '',
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
    CREATE TABLE IF NOT EXISTS blocks(
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      chunk_id TEXT NOT NULL,
      page INTEGER,
      block_index INTEGER NOT NULL,
      title TEXT NOT NULL,
      author TEXT NOT NULL DEFAULT '',
      language TEXT NOT NULL DEFAULT '',
      text TEXT NOT NULL,
      FOREIGN KEY(document_id) REFERENCES documents(document_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_blocks_document ON blocks(document_id,page,block_index);
    CREATE VIRTUAL TABLE IF NOT EXISTS blocks_fts USING fts5(
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
      source_path TEXT NOT NULL DEFAULT '',
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
    CREATE TABLE IF NOT EXISTS folder_queue(
      source_path TEXT PRIMARY KEY,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      mtime_ms INTEGER NOT NULL DEFAULT 0,
      content_sha256 TEXT NOT NULL DEFAULT '',
      document_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT NOT NULL DEFAULT '',
      discovered_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_folder_queue_status ON folder_queue(status,updated_at);
  `);
  ensureColumn(db,"documents","block_count","INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db,"documents","source_path","TEXT NOT NULL DEFAULT ''");
  ensureColumn(db,"jobs","source_path","TEXT NOT NULL DEFAULT ''");
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
function flexibleFtsExpression(query,extra=[]){
  const terms=queryTerms([query,...(extra||[])].join(" ")).slice(0,24);
  return terms.length?terms.map(ftsQuote).join(" OR "):"";
}
function rowToUnit(row={}){
  const title=sanitizePublicTitle(row);
  const page=Number(row.page||0)||null;
  return {
    id:"v3-inc:"+String(row.id||""),
    kind:"book-paragraph",
    document_id:String(row.document_id||""),
    source_chunk_id:String(row.chunk_id||row.id||""),
    title,author:String(row.author||""),language:String(row.language||""),
    page,reference:[title,page?("página "+page):""].filter(Boolean).join(" • "),
    text:String(row.text||""),verified:true,source:"incremental-local"
  };
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
    const existing=db.prepare("SELECT document_id,filename,title,page_count,chunk_count,block_count,status,source_path FROM documents WHERE content_sha256=?").get(sha);
    if(existing)return {ok:true,duplicate:true,document:existing};

    const existingJob=db.prepare("SELECT job_id,document_id,received_pages,page_count,status FROM jobs WHERE content_sha256=? ORDER BY updated_at DESC LIMIT 1").get(sha);
    if(existingJob)return {ok:true,duplicate:false,resumed:true,...existingJob};

    const now=new Date().toISOString();
    const jobId="inc-"+randomUUID().replace(/-/g,"");
    const title=clean(meta?.title||meta?.filename||"Livro",300)||"Livro";
    const filename=clean(meta?.filename||title,300)||title;
    db.prepare("INSERT INTO jobs(job_id,document_id,content_sha256,filename,title,author,language,page_count,size_bytes,received_pages,status,source_path,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,0,'receiving',?,?,?)")
      .run(jobId,sha,sha,filename,title,clean(meta?.author,300),clean(meta?.language,30),Math.max(0,Number(meta?.page_count||0)),Math.max(0,Number(meta?.size_bytes||0)),clean(meta?.source_path,1800),now,now);
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
    const duplicate=db.prepare("SELECT document_id,filename,title,page_count,chunk_count,block_count,status,source_path FROM documents WHERE content_sha256=?").get(job.content_sha256);
    if(duplicate){
      db.prepare("DELETE FROM jobs WHERE job_id=?").run(job.job_id);
      return {ok:true,duplicate:true,document:duplicate};
    }
    const pages=db.prepare("SELECT page,text FROM job_pages WHERE job_id=? ORDER BY page").all(job.job_id);
    if(!pages.length)throw Object.assign(new Error("Nenhuma página foi recebida para este PDF."),{status:400});

    const now=new Date().toISOString();
    const chunkRows=[],blockRows=[];
    let chunkIndex=0,blockIndex=0;
    for(const page of pages){
      for(const text of chunkPage(page.text)){
        const chunkId=job.document_id+":"+chunkIndex;
        chunkRows.push({
          id:chunkId,document_id:job.document_id,filename:job.filename,title:job.title,
          author:job.author,language:job.language,page:Number(page.page||0)||null,
          pdf_page:Number(page.page||0)||null,page_basis:"pdf",
          chunk_index:chunkIndex++,text,source:"incremental-local"
        });
        const blocks=paragraphBlocks(text);
        for(const block of blocks){
          if(!String(block||"").trim())continue;
          blockRows.push({
            id:job.document_id+":b:"+blockIndex,
            document_id:job.document_id,chunk_id:chunkId,page:Number(page.page||0)||null,
            block_index:blockIndex++,title:job.title,author:job.author,language:job.language,
            text:String(block).trim()
          });
        }
      }
    }
    if(!chunkRows.length||!blockRows.length)throw Object.assign(new Error("O PDF não produziu trechos pesquisáveis."),{status:400});

    db.exec("BEGIN IMMEDIATE;");
    try{
      db.prepare("INSERT INTO documents(document_id,content_sha256,filename,title,author,language,page_count,chunk_count,block_count,size_bytes,status,source_path,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,'ready',?,?,?)")
        .run(job.document_id,job.content_sha256,job.filename,job.title,job.author,job.language,Number(job.page_count||pages.length),chunkRows.length,blockRows.length,Number(job.size_bytes||0),job.source_path||"",now,now);
      const insChunk=db.prepare("INSERT INTO chunks(id,document_id,page,chunk_index,title,author,language,text,folded_text) VALUES(?,?,?,?,?,?,?,?,?)");
      const ftsChunk=db.prepare("INSERT INTO chunks_fts(id,document_id,text,title) VALUES(?,?,?,?)");
      for(const row of chunkRows){
        insChunk.run(row.id,row.document_id,row.page,row.chunk_index,row.title,row.author,row.language,row.text,fold(row.text));
        ftsChunk.run(row.id,row.document_id,row.text,row.title);
      }
      const insBlock=db.prepare("INSERT INTO blocks(id,document_id,chunk_id,page,block_index,title,author,language,text) VALUES(?,?,?,?,?,?,?,?,?)");
      const ftsBlock=db.prepare("INSERT INTO blocks_fts(id,document_id,text,title) VALUES(?,?,?,?)");
      for(const row of blockRows){
        insBlock.run(row.id,row.document_id,row.chunk_id,row.page,row.block_index,row.title,row.author,row.language,row.text);
        ftsBlock.run(row.id,row.document_id,row.text,row.title);
      }
      db.prepare("DELETE FROM jobs WHERE job_id=?").run(job.job_id);
      db.exec("COMMIT;");
    }catch(error){
      try{db.exec("ROLLBACK;");}catch{}
      throw error;
    }
    return {
      ok:true,duplicate:false,
      document:{document_id:job.document_id,filename:job.filename,title:job.title,author:job.author,language:job.language,page_count:Number(job.page_count||pages.length),chunk_count:chunkRows.length,block_count:blockRows.length,status:"ready",source_path:job.source_path||""}
    };
  };

  const listDocuments=({limit=200,offset=0}={})=>{
    const safeLimit=Math.max(1,Math.min(1000,Number(limit||200)));
    const safeOffset=Math.max(0,Number(offset||0));
    return db.prepare("SELECT document_id,filename,title,author,language,page_count,chunk_count,block_count,size_bytes,status,source_path,created_at,updated_at FROM documents ORDER BY created_at DESC LIMIT ? OFFSET ?").all(safeLimit,safeOffset);
  };
  const counts=()=>{
    const documents=Number(db.prepare("SELECT COUNT(*) AS n FROM documents").get()?.n||0);
    const chunks=Number(db.prepare("SELECT COUNT(*) AS n FROM chunks").get()?.n||0);
    const blocks=Number(db.prepare("SELECT COUNT(*) AS n FROM blocks").get()?.n||0);
    const jobs=Number(db.prepare("SELECT COUNT(*) AS n FROM jobs").get()?.n||0);
    const pages_pending=Number(db.prepare("SELECT COUNT(*) AS n FROM job_pages").get()?.n||0);
    const queue=db.prepare("SELECT status,COUNT(*) AS n FROM folder_queue GROUP BY status").all().reduce((a,x)=>(a[String(x.status)]=Number(x.n||0),a),{});
    return {version:VERSION,documents,chunks,blocks,jobs,pages_pending,folder_queue:queue,db_path:dbPath};
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

    let total=0,raw=[];
    try{
      total=Number(db.prepare("SELECT COUNT(*) AS n FROM blocks_fts WHERE blocks_fts MATCH ?").get(expr)?.n||0);
      raw=db.prepare("SELECT b.id,b.document_id,b.chunk_id,b.title,b.author,b.language,b.page,b.block_index,b.text FROM blocks_fts f JOIN blocks b ON b.id=f.id WHERE blocks_fts MATCH ? ORDER BY b.title,b.page,b.block_index LIMIT ? OFFSET ?")
        .all(expr,safeSize,(safePage-1)*safeSize);
    }catch{
      total=0;raw=[];
    }
    const matches=[];
    for(const row of raw){
      const audit=strictParagraphAudit(row.text,concepts);
      if(!audit.accepted)continue;
      const title=sanitizePublicTitle(row);
      matches.push({
        id:String(row.id),document_id:String(row.document_id||""),title,
        page:Number(row.page||0)||null,chunk_index:Number(row.block_index||0),
        text:String(row.text||""),
        reference:[title,Number(row.page||0)?("PDF p. "+Number(row.page)):""].filter(Boolean).join(" • "),
        aliases:audit.matched.map(x=>x.alias),concepts:audit.matched.map(x=>x.label),score:1
      });
    }
    return {
      query,concepts:concepts.map(x=>({label:x.label,aliases:x.aliases})),
      total,page:safePage,page_size:safeSize,pages:Math.ceil(total/safeSize),matches
    };
  };

  const searchV3=(query,aliases={},options={})=>{
    const limit=Math.max(1,Math.min(80,Number(options.limit||16)));
    const candidateLimit=Math.max(100,Math.min(1500,Number(options.candidate_limit||700)));
    const extra=Array.isArray(options.extraExpansions)?options.extraExpansions:[];
    const expr=flexibleFtsExpression(query,extra);
    if(!expr)return {query,expansions:extra,total:0,results:[]};
    let raw=[];
    try{
      raw=db.prepare("SELECT b.id,b.document_id,b.chunk_id,b.title,b.author,b.language,b.page,b.block_index,b.text,bm25(blocks_fts) AS fts_rank FROM blocks_fts f JOIN blocks b ON b.id=f.id WHERE blocks_fts MATCH ? ORDER BY bm25(blocks_fts) LIMIT ?")
        .all(expr,candidateLimit);
    }catch{return {query,expansions:extra,total:0,results:[]};}
    const units=raw.map(rowToUnit);
    const searched=searchV3Evidence({units},query,aliases,{...options,limit,extraExpansions:extra});
    return {...searched,total:Math.max(Number(searched.total||0),raw.length)};
  };

  const backfillLegacyBlocks=(maxDocuments=25)=>{
    const docs=db.prepare("SELECT document_id,title,author,language FROM documents WHERE block_count=0 AND chunk_count>0 ORDER BY created_at LIMIT ?")
      .all(Math.max(1,Math.min(200,Number(maxDocuments||25))));
    let migratedDocuments=0,migratedBlocks=0;
    for(const doc of docs){
      const chunks=db.prepare("SELECT id,document_id,page,chunk_index,title,author,language,text FROM chunks WHERE document_id=? ORDER BY chunk_index").all(doc.document_id);
      if(!chunks.length)continue;
      const blockRows=[];let blockIndex=0;
      for(const chunk of chunks){
        for(const block of paragraphBlocks(chunk.text||"")){
          if(!String(block||"").trim())continue;
          blockRows.push({
            id:String(doc.document_id)+":b:"+blockIndex,document_id:String(doc.document_id),
            chunk_id:String(chunk.id),page:Number(chunk.page||0)||null,block_index:blockIndex++,
            title:String(chunk.title||doc.title||"Livro"),author:String(chunk.author||doc.author||""),
            language:String(chunk.language||doc.language||""),text:String(block).trim()
          });
        }
      }
      if(!blockRows.length)continue;
      db.exec("BEGIN IMMEDIATE;");
      try{
        const ins=db.prepare("INSERT OR IGNORE INTO blocks(id,document_id,chunk_id,page,block_index,title,author,language,text) VALUES(?,?,?,?,?,?,?,?,?)");
        const fts=db.prepare("INSERT INTO blocks_fts(id,document_id,text,title) VALUES(?,?,?,?)");
        let inserted=0;
        for(const row of blockRows){
          const result=ins.run(row.id,row.document_id,row.chunk_id,row.page,row.block_index,row.title,row.author,row.language,row.text);
          if(Number(result?.changes||0)>0){fts.run(row.id,row.document_id,row.text,row.title);inserted++;}
        }
        db.prepare("UPDATE documents SET block_count=?,updated_at=? WHERE document_id=?").run(inserted,new Date().toISOString(),doc.document_id);
        db.exec("COMMIT;");
        migratedDocuments++;migratedBlocks+=inserted;
      }catch(error){
        try{db.exec("ROLLBACK;");}catch{}
        throw error;
      }
    }
    return {migrated_documents:migratedDocuments,migrated_blocks:migratedBlocks,remaining:Number(db.prepare("SELECT COUNT(*) AS n FROM documents WHERE block_count=0 AND chunk_count>0").get()?.n||0)};
  };

  const enqueueFolderFile=(sourcePath,sizeBytes,mtimeMs)=>{
    const p=String(sourcePath||"").trim();
    if(!p)return false;
    const now=new Date().toISOString();
    const existing=db.prepare("SELECT source_path,size_bytes,mtime_ms,status FROM folder_queue WHERE source_path=?").get(p);
    if(existing && Number(existing.size_bytes)===Number(sizeBytes||0) && Number(existing.mtime_ms)===Number(mtimeMs||0) && ["queued","processing","done","duplicate","failed","needs_ocr"].includes(String(existing.status)))return false;
    db.prepare("INSERT INTO folder_queue(source_path,size_bytes,mtime_ms,status,attempts,last_error,discovered_at,updated_at) VALUES(?,?,?,'queued',0,'',?,?) ON CONFLICT(source_path) DO UPDATE SET size_bytes=excluded.size_bytes,mtime_ms=excluded.mtime_ms,status='queued',last_error='',updated_at=excluded.updated_at")
      .run(p,Math.max(0,Number(sizeBytes||0)),Math.max(0,Number(mtimeMs||0)),now,now);
    return true;
  };
  const requeueInterrupted=()=>{
    db.prepare("UPDATE folder_queue SET status='queued',updated_at=? WHERE status='processing'").run(new Date().toISOString());
  };
  const nextFolderFile=()=>{
    const row=db.prepare("SELECT * FROM folder_queue WHERE status='queued' ORDER BY discovered_at,source_path LIMIT 1").get();
    if(!row)return null;
    db.prepare("UPDATE folder_queue SET status='processing',attempts=attempts+1,updated_at=? WHERE source_path=?").run(new Date().toISOString(),row.source_path);
    return {...row,status:"processing",attempts:Number(row.attempts||0)+1};
  };
  const finishFolderFile=(sourcePath,{status="done",sha256="",documentId="",error=""}={})=>{
    db.prepare("UPDATE folder_queue SET status=?,content_sha256=?,document_id=?,last_error=?,updated_at=? WHERE source_path=?")
      .run(String(status),String(sha256||""),String(documentId||""),String(error||"").slice(0,2000),new Date().toISOString(),String(sourcePath||""));
  };
  const checkpoint=()=>{try{db.exec("PRAGMA wal_checkpoint(PASSIVE);");}catch{}};

  return {
    version:VERSION,db_path:dbPath,start,append,commit,listDocuments,counts,getChunk,getPage,
    rowsForDocument,allReadyDocumentIds,searchDictionary,searchV3,backfillLegacyBlocks,
    enqueueFolderFile,requeueInterrupted,nextFolderFile,finishFolderFile,checkpoint
  };
}
