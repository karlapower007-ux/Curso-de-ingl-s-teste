import path from "node:path";
import {mkdir,readFile,readdir,stat,rm} from "node:fs/promises";
import {createHash} from "node:crypto";
import {expandV3Query,searchV3Evidence,v3Fold} from "./v3-evidence-core.mjs";

const DB_VERSION="v3-sqlite-fts5-1";

async function filesForHash(root,publicDir){
  const files=[];
  const backup=path.join(publicDir,"biblioteca_backup");
  for(const name of (await readdir(backup).catch(()=>[])).filter(x=>/^part-\d+\.json$/i.test(x)).sort()){
    files.push(path.join(backup,name));
  }
  const raw=path.join(root,"raw-vault","generated");
  for(const name of (await readdir(raw).catch(()=>[])).filter(x=>/\.(txt|md)$/i.test(x)).sort()){
    files.push(path.join(raw,name));
  }
  return files;
}

export async function computeV3LibraryHash(root,publicDir){
  const hash=createHash("sha256");
  const files=await filesForHash(root,publicDir);
  for(const file of files){
    const s=await stat(file).catch(()=>null);
    if(!s)continue;
    hash.update(path.basename(file));
    hash.update(String(s.size));
    hash.update(await readFile(file));
  }
  return {hash:hash.digest("hex"),files:files.length};
}

async function sqliteApi(){
  try{return await import("node:sqlite");}
  catch{return null;}
}

function openDb(DatabaseSync,dbPath){
  const db=new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec("PRAGMA synchronous=NORMAL;");
  db.exec("CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);");
  db.exec("CREATE TABLE IF NOT EXISTS units(id TEXT PRIMARY KEY,kind TEXT NOT NULL,document_id TEXT,source_chunk_id TEXT,title TEXT,author TEXT,language TEXT,page INTEGER,reference TEXT NOT NULL,text TEXT NOT NULL,verified INTEGER NOT NULL DEFAULT 1);");
  db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS units_fts USING fts5(id UNINDEXED,text,title,reference,tokenize='unicode61 remove_diacritics 2');");
  return db;
}

function getMeta(db,key){
  return db.prepare("SELECT value FROM meta WHERE key=?").get(key)?.value||"";
}
function setMeta(db,key,value){
  db.prepare("INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key,String(value));
}

function normalizeFtsTerms(query,aliases,extra=[]){
  const expansions=expandV3Query(query,aliases,extra);
  const raw=[query,...expansions].map(v3Fold).join(" ");
  return [...new Set(raw.split(/\s+/).filter(x=>x.length>=3&&!/^\d+$/.test(x)))].slice(0,24);
}
function ftsExpr(terms){
  return terms.map(t=>'"'+t.replace(/"/g,'""')+'"').join(" OR ");
}

export async function ensurePersistentV3({root,publicDir,buildIndex,loadRows}){
  const api=await sqliteApi();
  const hashInfo=await computeV3LibraryHash(root,publicDir);

  if(!api?.DatabaseSync){
    const rows=await loadRows();
    const index=buildIndex(rows);
    return {ok:true,persistent:false,fts5:false,reason:"node:sqlite indisponível",library_hash:hashInfo.hash,index,db:null,reused:false};
  }

  const dataDir=path.join(root,".fns-local");
  await mkdir(dataDir,{recursive:true});
  const dbPath=path.join(dataDir,"v3-evidence.sqlite");
  let db;
  try{db=openDb(api.DatabaseSync,dbPath);}
  catch{
    await rm(dbPath,{force:true}).catch(()=>{});
    db=openDb(api.DatabaseSync,dbPath);
  }

  const same=getMeta(db,"library_hash")===hashInfo.hash && getMeta(db,"db_version")===DB_VERSION;
  const count=Number(db.prepare("SELECT COUNT(*) AS n FROM units").get()?.n||0);
  if(same&&count>0){
    return {
      ok:true,persistent:true,fts5:true,reused:true,db,db_path:dbPath,
      library_hash:hashInfo.hash,source_rows:Number(getMeta(db,"source_rows")||0),
      evidence_units:count,counts:JSON.parse(getMeta(db,"counts")||"{}"),
      version:getMeta(db,"index_version")||"3.0.x"
    };
  }

  const rows=await loadRows();
  const index=buildIndex(rows);
  db.exec("BEGIN IMMEDIATE;");
  db.exec("DELETE FROM units;");
  db.exec("DELETE FROM units_fts;");
  try{
    const ins=db.prepare("INSERT INTO units(id,kind,document_id,source_chunk_id,title,author,language,page,reference,text,verified) VALUES(?,?,?,?,?,?,?,?,?,?,?)");
    const fts=db.prepare("INSERT INTO units_fts(id,text,title,reference) VALUES(?,?,?,?)");
    for(const u of index.units){
      ins.run(
        String(u.id||""),String(u.kind||""),String(u.document_id||""),String(u.source_chunk_id||""),
        String(u.title||""),String(u.author||""),String(u.language||""),
        Number(u.page||0)||null,String(u.reference||""),String(u.text||""),u.verified===false?0:1
      );
      fts.run(String(u.id||""),String(u.text||""),String(u.title||""),String(u.reference||""));
    }
    setMeta(db,"library_hash",hashInfo.hash);
    setMeta(db,"db_version",DB_VERSION);
    setMeta(db,"source_rows",index.source_rows);
    setMeta(db,"counts",JSON.stringify(index.counts||{}));
    setMeta(db,"index_version",index.version||"3.0.x");
    setMeta(db,"built_at",new Date().toISOString());
    db.exec("COMMIT;");
  }catch(error){
    try{db.exec("ROLLBACK;");}catch{}
    throw error;
  }

  return {
    ok:true,persistent:true,fts5:true,reused:false,db,db_path:dbPath,
    library_hash:hashInfo.hash,source_rows:index.source_rows,evidence_units:index.units.length,
    counts:index.counts,version:index.version
  };
}

export function searchPersistentV3(state,query,aliases={},options={}){
  if(!state?.persistent||!state?.db){
    return searchV3Evidence(state?.index||{units:[]},query,aliases,options);
  }

  const terms=normalizeFtsTerms(query,aliases,options.extraExpansions||[]);
  if(!terms.length)return {query,expansions:[],total:0,results:[]};
  const expr=ftsExpr(terms);
  const cap=Math.max(100,Math.min(1200,Number(options.candidate_limit||500)));
  let rows=[];
  try{
    rows=state.db.prepare("SELECT u.id,u.kind,u.document_id,u.source_chunk_id,u.title,u.author,u.language,u.page,u.reference,u.text,u.verified FROM units_fts f JOIN units u ON u.id=f.id WHERE units_fts MATCH ? ORDER BY bm25(units_fts) LIMIT ?").all(expr,cap);
  }catch{
    rows=state.db.prepare("SELECT id,kind,document_id,source_chunk_id,title,author,language,page,reference,text,verified FROM units LIMIT ?").all(cap);
  }
  const units=rows.map(r=>({...r,verified:Number(r.verified)!==0}));
  return searchV3Evidence({units},query,aliases,options);
}

export function persistentV3Health(state){
  return {
    persistent:Boolean(state?.persistent),
    fts5:Boolean(state?.fts5),
    reused:Boolean(state?.reused),
    library_hash:String(state?.library_hash||""),
    db_path:state?.persistent?String(state?.db_path||""):"",
    source_rows:Number(state?.source_rows||state?.index?.source_rows||0),
    evidence_units:Number(state?.evidence_units||state?.index?.units?.length||0),
    counts:state?.counts||state?.index?.counts||{},
    version:String(state?.version||state?.index?.version||"")
  };
}
