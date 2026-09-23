import http from "node:http";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {readFile,readdir,stat,mkdir,appendFile,opendir,statfs,open,rename,unlink} from "node:fs/promises";
import {spawn} from "node:child_process";
import {watch as fsWatch,createReadStream} from "node:fs";
import {createHash} from "node:crypto";
import {
  V2_VERSION, DEFAULT_EMBED_MODEL, RESPONSE_MODES,
  exactAndMatches, lexicalCandidates, chooseInstalledModel,
  formatExactAnswer, formatGroundedAnswer, buildPrompt, cosine, publicReference, extractTimelineYear,
  focusEvidence, answerStaysOnFocus, citationIntegrity, hasSubstantiveFocus, focusedEvidenceWindow,
  sanitizePublicTitle, dictionaryPublicReference, isStandardWorksRow
} from "./v2-local-core.mjs";
import {
  buildV3EvidenceIndex,searchV3Evidence,formatV3EvidenceAnswer,v3DisplayReference
} from "./v3-evidence-core.mjs";
import {
  ensurePersistentV3,searchPersistentV3,persistentV3Health,
  appendPersistentV3,persistentV3HasDocument
} from "./v3-persistent-index.mjs";
import {createIncrementalLibrary} from "./v3-incremental-library.mjs";
import {mergeFederatedSearch} from "./v3-federated-core.mjs";
import {
  V4_VERSION,buildLesson,lessonToPlainText,lessonSpeechText,createLessonProfileStore,
  judgeLessonDraft,lessonKnowledgeQuery
} from "./v4-lesson-core.mjs";
import {piperStatus,synthesizePiper} from "./v4-piper-tts.mjs";

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const ROOT=path.resolve(__dirname,"..");
const PUBLIC=path.join(ROOT,"public");
const HOST=String(process.env.FNS_HOST||"127.0.0.1");
const PORT=Math.max(1,Number(process.env.PORT||8788));
const OLLAMA=String(process.env.OLLAMA_HOST||"http://127.0.0.1:11434").replace(/\/$/,"");
const EMBED_MODEL=String(process.env.FNS_EMBED_MODEL||DEFAULT_EMBED_MODEL);
const DATA_DIR=path.join(ROOT,".fns-local");
const MASS_IMPORT_DIR=path.join(ROOT,"ImportarPDFs");
const PDF_VAULT_DIR=path.join(DATA_DIR,"pdf-vault");
const MAX_ORIGINAL_PDF_BYTES=Math.max(64*1024*1024,Number(process.env.FNS_MAX_ORIGINAL_PDF_BYTES||2*1024*1024*1024));
const PDF_INGEST_WORKER=path.join(ROOT,"scripts","v3-pdf-ingest-worker.mjs");
const MASS_SCAN_MS=Math.max(60000,Number(process.env.FNS_MASS_SCAN_MS||600000));
const MASS_MIN_FREE_GB=Math.max(1,Number(process.env.FNS_MIN_FREE_GB||5));
const VECTOR_LOG=path.join(DATA_DIR,"qwen-v2-vector-cache.jsonl");
const LOCAL_RUNTIME_BUILD="2026-09-23-v4-entailment-r2-sourcelink";
const MAX_BODY=4*1024*1024;
const EXTERNAL_WRITER_ENABLED=String(process.env.FNS_EXTERNAL_WRITER_ENABLED||"0")==="1";
const EXTERNAL_WRITER_URL=String(process.env.FNS_EXTERNAL_WRITER_URL||"").trim();
const EXTERNAL_WRITER_TOKEN=String(process.env.FNS_EXTERNAL_WRITER_TOKEN||"").trim();
const LOCAL_BRIDGE_ORIGINS=new Set([
  "https://consciencia-fabiano.focoeepoder2.workers.dev",
  "http://127.0.0.1:8788",
  "http://localhost:8788",
  ...String(process.env.FNS_ALLOWED_ORIGINS||"").split(",").map(x=>x.trim()).filter(Boolean)
]);
const rows=[];
const authoritativeRows=new Map();
const authoritativePages=new Map();
let libraryPromise=null;
let aliasesPromise=null;
let v3IndexPromise=null;
let incrementalPromise=null;
let baseCatalogCache=null;
let v4ProfilePromise=null;
let generatorQueue=Promise.resolve();
let generatorBusy=0;
let massScanRunning=false;
let massPumpRunning=false;
let activePdfChild=null;
let massFolderWatcher=null;
let massWatchTimer=null;
const massImportState={
  started:false,last_scan:null,last_file:null,last_result:null,discovered_last_scan:0,
  import_dir:MASS_IMPORT_DIR,paused_reason:"",free_gb:null
};
const embedCache=new Map();

const MIME={
  ".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".mjs":"text/javascript; charset=utf-8",
  ".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8",".png":"image/png",
  ".jpg":"image/jpeg",".jpeg":"image/jpeg",".svg":"image/svg+xml",".webmanifest":"application/manifest+json; charset=utf-8",
  ".wasm":"application/wasm",".gz":"application/gzip",".txt":"text/plain; charset=utf-8",".md":"text/markdown; charset=utf-8"
};

function authoritativeIdentity(row={}){
  return String(row.id||row.key||"").trim() ||
    [String(row.document_id||row.doc_key||""),String(row.chunk_index??"")].join(":");
}
function authoritativePageKey(row={}){
  const doc=String(row.document_id||row.doc_key||"").trim();
  const page=Number(row.page||0)||0;
  return doc&&page?doc+"|"+page:"";
}
function indexAuthoritativeRow(row={}){
  const id=authoritativeIdentity(row);
  if(id)authoritativeRows.set(id,row);
  const pageKey=authoritativePageKey(row);
  if(pageKey){
    const list=authoritativePages.get(pageKey)||[];
    list.push(row);
    authoritativePages.set(pageKey,list);
  }
}
function enrichFromAuthority(row={}){
  const exact=authoritativeRows.get(authoritativeIdentity(row));
  return exact?{...exact,...row}:row;
}
function authoritativePageText(row={}){
  const key=authoritativePageKey(row);
  if(!key)return String(row.text||"");
  const pageRows=authoritativePages.get(key)||[];
  return pageRows.length?pageRows.sort((a,b)=>Number(a.chunk_index||0)-Number(b.chunk_index||0)).map(x=>String(x.text||"")).join(" "):String(row.text||"");
}
function applyCitationIntegrity(evidence=[]){
  const out=[];
  for(const candidate of evidence||[]){
    const row=enrichFromAuthority(candidate);
    if(!hasSubstantiveFocus(row))continue;
    const check=citationIntegrity(row,authoritativePageText(row));
    if(!check.verified)continue;
    out.push({
      ...row,
      reference:check.reference,
      citation_reference:check.reference,
      citation_verified:true,
      citation_kind:check.kind,
      citation_reason:check.reason
    });
  }
  return out;
}

function normalizeAuthorityText(value=""){
  return String(value||"").replace(/[“”„‟«»]/g,'"').replace(/[‘’]/g,"'").replace(/\s+/g," ").trim();
}
function cleanAuthorityTitle(row={},fallback=""){
  const raw=String(row.title||row.source_title||fallback||"").replace(/\.pdf$/i,"");
  const clean=raw.replace(/[_-]+/g," ").replace(/\s+/g," ").trim();
  if(!clean||/standard[-_ ]?works|obras\s+padr[aã]o/i.test(clean))return "";
  return clean;
}
function explicitPrintedPage(row={}){
  for(const key of ["printed_page","page_printed","printedPage","physical_page","physicalPage"]){
    const value=String(row?.[key]??"").trim();
    if(value)return value.slice(0,40);
  }
  return null;
}
async function candidateAuthorityRow(candidate={}){
  const sourceId=String(candidate.source_chunk_id||"").trim();
  if(sourceId&&authoritativeRows.has(sourceId))return authoritativeRows.get(sourceId);
  if(sourceId){
    try{
      const inc=await ensureIncrementalLibrary();
      const row=inc.getChunk(sourceId);
      if(row)return row;
    }catch{}
  }
  const pageRows=authoritativePages.get(authoritativePageKey(candidate))||[];
  const needle=normalizeAuthorityText(candidate.text);
  const base=pageRows.find(row=>normalizeAuthorityText(row.text).includes(needle));
  if(base)return base;
  try{
    const inc=await ensureIncrementalLibrary();
    const extra=inc.getPage(candidate.document_id,candidate.page);
    return extra.find(row=>normalizeAuthorityText(row.text).includes(needle))||null;
  }catch{return null;}
}
async function authoritativePageTextAsync(row={}){
  const base=authoritativePageText(row);
  if(base&&base!==String(row.text||""))return base;
  try{
    const inc=await ensureIncrementalLibrary();
    const pageRows=inc.getPage(row.document_id,row.page);
    if(pageRows.length)return pageRows.map(x=>String(x.text||"")).join(" ");
  }catch{}
  return String(row.text||"");
}

async function decorateDictionaryReference(hit={}){
  const authority=await candidateAuthorityRow(hit);
  const scriptureSource=Boolean(hit?.standard_works)||isStandardWorksRow(authority||hit);
  if(!scriptureSource)return hit;
  const source={
    ...(authority||{}),
    ...hit,
    standard_works:true,
    filename:authority?.filename,
    title:authority?.title||hit?.title||"",
    source_title:authority?.source_title,
    document_title:authority?.document_title,
    canonical_reference:authority?.canonical_reference||hit?.canonical_reference||""
  };
  const pageText=await authoritativePageTextAsync(source);
  const reference=dictionaryPublicReference(source,pageText);
  const verified=reference!=="Obras Padrão";
  return {
    ...hit,
    title:"",
    reference,
    canonical_reference:verified?reference:"",
    dictionary_scripture_source:true,
    dictionary_scripture_reference:verified
  };
}
async function decorateDictionaryMatches(matches=[]){
  const out=[];
  for(const hit of matches||[])out.push(await decorateDictionaryReference(hit));
  return decorateSourceLinkRows(out);
}
async function v4EvidenceFromAuthority(candidates=[]){
  const out=[];
  for(const candidate of candidates||[]){
    if(String(candidate?.kind||"")==="scripture-page-window")continue;
    const text=normalizeAuthorityText(candidate?.text||"");
    if(!text)continue;

    if(String(candidate?.kind||"")==="scripture-verse"){
      const pageText=normalizeAuthorityText(await authoritativePageTextAsync(candidate));
      const ref=String(candidate.reference||"").replace(/\s+/g," ").trim();
      if(!pageText.includes(text))continue;
      if(!/\b\d{1,4}:\d{1,4}\b/.test(ref))continue;
      out.push({
        ...candidate,
        reference:ref,
        citation_reference:ref,
        citation_verified:true,
        verified:true,
        title:String(candidate.title||"").trim(),
        pdf_page:Number(candidate.page||0)||null,
        printed_page:null,
        page_basis:"canonical-scripture",
        source_verified:true,
        source_verification:"canonical-reference+authoritative-page-substring"
      });
      continue;
    }

    const authority=await candidateAuthorityRow(candidate);
    if(!authority)continue;
    const authorityText=normalizeAuthorityText(authority.text);
    if(!authorityText.includes(text))continue;

    const title=cleanAuthorityTitle(authority,candidate.title);
    if(!title)continue;
    const pdfPage=Number(authority.pdf_page??authority.page??candidate.page??0)||null;
    const printedPage=explicitPrintedPage(authority);
    const reference=printedPage
      ?title+" • página impressa "+printedPage+(pdfPage?" • PDF p. "+pdfPage:"")
      :(pdfPage?title+" • PDF p. "+pdfPage:title);

    out.push({
      ...candidate,
      title,
      language:String(authority.language||candidate.language||""),
      reference,
      citation_reference:reference,
      citation_verified:true,
      verified:true,
      pdf_page:pdfPage,
      printed_page:printedPage,
      page_basis:printedPage?"printed+pdf":(pdfPage?"pdf":"title-only"),
      source_verified:true,
      source_verification:"authoritative-record+exact-substring"
    });
  }
  return out;
}

async function v4DictionaryFallbackEvidence(question,aliases,limit=10){
  await loadLibrary();
  const safeLimit=Math.max(2,Math.min(20,Number(limit||10)));
  const pageSize=Math.max(20,safeLimit*4);
  const inc=await ensureIncrementalLibrary();
  const normalizedQuery=lessonKnowledgeQuery(question);
  const queries=[normalizedQuery,String(question||"").trim()].filter((x,i,a)=>x&&a.indexOf(x)===i);
  const combined=[];
  for(const query of queries){
    const base=exactAndMatches(rows,query,{aliases,page:1,pageSize});
    const added=inc.searchDictionary(query,{aliases,page:1,pageSize});
    combined.push(...(base.matches||[]),...(added.matches||[]));
    if(combined.length>=safeLimit*2)break;
  }
  const out=[],seen=new Set();

  for(const hit of combined){
    if(out.length>=safeLimit)break;
    const authority=await candidateAuthorityRow(hit);
    if(!authority)continue;
    const needle=normalizeAuthorityText(hit?.text||"");
    if(!needle||!normalizeAuthorityText(authority?.text||"").includes(needle))continue;

    const scripture=Boolean(hit?.standard_works)||isStandardWorksRow(authority||hit);
    if(scripture){
      const decorated=await decorateDictionaryReference(hit);
      const reference=String(decorated?.reference||"").replace(/\s+/g," ").trim();
      if(!reference||reference==="Obras Padrão")continue;
      const item={
        ...hit,
        kind:"dictionary-exact-proof",
        reference,
        citation_reference:reference,
        citation_verified:true,
        verified:true,
        title:"",
        pdf_page:Number(hit?.page||0)||null,
        printed_page:null,
        page_basis:"canonical-scripture",
        source_verified:true,
        source_verification:"dictionary-strict-and+authoritative-page-substring"
      };
      const key=String(item.document_id||"")+"|"+String(item.page||"")+"|"+needle.slice(0,260);
      if(seen.has(key))continue;
      seen.add(key);out.push(item);continue;
    }

    const verified=(await v4EvidenceFromAuthority([hit]))[0];
    if(!verified)continue;
    const key=String(verified.document_id||"")+"|"+String(verified.page||"")+"|"+normalizeAuthorityText(verified.text).slice(0,260);
    if(seen.has(key))continue;
    seen.add(key);out.push(verified);
  }
  return out;
}

function json(res,data,status=200,extra={}){
  res.statusCode=status;
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.setHeader("Cache-Control","no-store");
  res.setHeader("X-Content-Type-Options","nosniff");
  for(const [k,v] of Object.entries(extra))res.setHeader(k,v);
  res.end(JSON.stringify(data));
}
function localHeaders(req,res){
  const origin=String(req.headers.origin||"");
  const bridgeAllowed=LOCAL_BRIDGE_ORIGINS.has(origin);
  if(bridgeAllowed){
    res.setHeader("Access-Control-Allow-Origin",origin);
    res.setHeader("Access-Control-Allow-Methods","GET,HEAD,POST,PUT,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers","Content-Type,Range");
    res.setHeader("Access-Control-Expose-Headers","Accept-Ranges,Content-Length,Content-Range");
    res.setHeader("Access-Control-Allow-Private-Network","true");
    res.setHeader("Access-Control-Max-Age","600");
    res.setHeader("Vary","Origin");
    res.setHeader("Cross-Origin-Resource-Policy","cross-origin");
  }else{
    res.setHeader("Cross-Origin-Resource-Policy","same-origin");
  }
  res.setHeader("Referrer-Policy","no-referrer");
  res.setHeader("X-Frame-Options","SAMEORIGIN");
}
async function readJsonBody(req){
  const parts=[];let size=0;
  for await(const part of req){
    size+=part.length;
    if(size>MAX_BODY)throw Object.assign(new Error("Payload excede o limite local."),{status:413});
    parts.push(part);
  }
  try{return JSON.parse(Buffer.concat(parts).toString("utf8")||"{}");}
  catch{throw Object.assign(new Error("JSON inválido."),{status:400});}
}
async function loadAliases(){
  if(aliasesPromise)return aliasesPromise;
  aliasesPromise=readFile(path.join(PUBLIC,"v2-aliases.json"),"utf8")
    .then(x=>JSON.parse(x)).catch(()=>({}));
  return aliasesPromise;
}

async function ensureIncrementalLibrary(){
  if(!incrementalPromise)incrementalPromise=createIncrementalLibrary(ROOT);
  return incrementalPromise;
}
function safeSourceDocumentId(value=""){
  const id=String(value||"").trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(id)?id:"";
}
function pathInside(root,candidate){
  const rel=path.relative(path.resolve(root),path.resolve(candidate));
  return rel!=="" && rel!==".." && !rel.startsWith(".."+path.sep) && !path.isAbsolute(rel);
}
function allowedPdfSourcePath(candidate=""){
  const value=String(candidate||"").trim();
  if(!value || path.extname(value).toLowerCase()!==".pdf")return "";
  const resolved=path.resolve(value);
  if(pathInside(PDF_VAULT_DIR,resolved)||pathInside(MASS_IMPORT_DIR,resolved))return resolved;
  return "";
}
function sourceVaultPath(documentId){
  const id=safeSourceDocumentId(documentId);
  return id?path.join(PDF_VAULT_DIR,id+".pdf"):"";
}
async function sourcePdfRecord(documentId){
  const id=safeSourceDocumentId(documentId);
  if(!id)return null;
  const inc=await ensureIncrementalLibrary();
  const doc=inc.getDocument(id);
  const sourcePath=allowedPdfSourcePath(doc?.source_path||"");
  if(!sourcePath)return null;
  const info=await stat(sourcePath).catch(()=>null);
  if(!info?.isFile())return null;
  return {document_id:id,path:sourcePath,size:Number(info.size||0),filename:String(doc?.filename||doc?.title||"documento.pdf")};
}
async function sourceLinkFields(row={}){
  const documentId=safeSourceDocumentId(row?.document_id||"");
  if(!documentId)return {source_pdf_available:false,source_pdf_url:"",source_pdf_page:null};
  const source=await sourcePdfRecord(documentId).catch(()=>null);
  const page=Number(row?.source_pdf_page??row?.pagina_pdf??row?.pdf_page??row?.page??0)||null;
  return {
    source_pdf_available:Boolean(source),
    source_pdf_url:source?("/api/v3/source/pdf?document_id="+encodeURIComponent(documentId)):"",
    source_pdf_page:source?page:null
  };
}
async function decorateSourceLinkRows(rows=[]){
  const out=[];
  const cache=new Map();
  for(const row of rows||[]){
    const documentId=safeSourceDocumentId(row?.document_id||"");
    let fields={source_pdf_available:false,source_pdf_url:"",source_pdf_page:null};
    if(documentId){
      if(!cache.has(documentId))cache.set(documentId,sourcePdfRecord(documentId).catch(()=>null));
      const source=await cache.get(documentId);
      const page=Number(row?.source_pdf_page??row?.pagina_pdf??row?.pdf_page??row?.page??0)||null;
      fields={
        source_pdf_available:Boolean(source),
        source_pdf_url:source?("/api/v3/source/pdf?document_id="+encodeURIComponent(documentId)):"",
        source_pdf_page:source?page:null
      };
    }
    out.push({...row,...fields});
  }
  return out;
}

function baseLibraryCatalog(){
  if(baseCatalogCache)return baseCatalogCache;
  const map=new Map();
  for(const row of rows){
    if(String(row?.source||"")==="incremental-local")continue;
    const documentId=String(row?.document_id||row?.doc_key||"").trim()||"base:"+String(row?.title||row?.filename||"livro");
    let item=map.get(documentId);
    if(!item){
      const title=sanitizePublicTitle(row)||(/standard[-_ ]?works|obras\s+padr[aã]o/i.test(String(row?.title||row?.filename||""))?"Escrituras":"Livro");
      item={
        document_id:documentId,arquivo:title,titulo:title,autor:String(row?.author||""),
        paginas:0,chunks:0,idioma:String(row?.language||""),status:"base-congelada",
        source:"v3-base-frozen",immutable:true
      };
      map.set(documentId,item);
    }
    item.chunks++;
    item.paginas=Math.max(item.paginas,Number(row?.page||0)||0);
  }
  baseCatalogCache=[...map.values()].sort((a,b)=>String(a.titulo).localeCompare(String(b.titulo),"pt-BR"));
  return baseCatalogCache;
}

async function allRowsForV3Rebuild(){
  await loadLibrary();
  const inc=await ensureIncrementalLibrary();
  const all=[...rows];
  for(const documentId of inc.allReadyDocumentIds()){
    all.push(...inc.rowsForDocument(documentId));
  }
  return all;
}

async function reconcileIncrementalV3(state){
  const inc=await ensureIncrementalLibrary();
  let addedDocuments=0,addedUnits=0;
  for(const documentId of inc.allReadyDocumentIds()){
    if(persistentV3HasDocument(state,documentId))continue;
    const docRows=inc.rowsForDocument(documentId);
    const result=appendPersistentV3(state,docRows,buildV3EvidenceIndex);
    if(Number(result.added_units||0)>0){addedDocuments++;addedUnits+=Number(result.added_units||0);}
  }
  return {added_documents:addedDocuments,added_units:addedUnits};
}

async function* walkPdfFiles(dir){
  let handle;
  try{handle=await opendir(dir);}catch{return;}
  for await(const entry of handle){
    const full=path.join(dir,entry.name);
    if(entry.isDirectory()){
      if(entry.name.startsWith("."))continue;
      yield* walkPdfFiles(full);
    }else if(entry.isFile()&&/\.pdf$/i.test(entry.name)){
      yield full;
    }
  }
}

async function scanMassImportFolder(){
  if(massScanRunning)return {ok:true,skipped:true};
  massScanRunning=true;
  let discovered=0,seen=0;
  try{
    await mkdir(MASS_IMPORT_DIR,{recursive:true});
    const inc=await ensureIncrementalLibrary();
    let batch=[];
    const flush=()=>{
      if(!batch.length)return;
      const result=inc.enqueueFolderBatch(batch);
      discovered+=Number(result.added||0);
      batch=[];
    };
    for await(const file of walkPdfFiles(MASS_IMPORT_DIR)){
      seen++;
      try{
        const info=await stat(file);
        batch.push({source_path:file,size_bytes:info.size,mtime_ms:Math.floor(info.mtimeMs)});
        if(batch.length>=500)flush();
      }catch{}
      if(seen%500===0)await new Promise(resolve=>setTimeout(resolve,0));
    }
    flush();
    massImportState.last_scan=new Date().toISOString();
    massImportState.discovered_last_scan=discovered;
    return {ok:true,seen,discovered};
  }finally{massScanRunning=false;}
}

function runPdfIngestWorker(sourcePath){
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[PDF_INGEST_WORKER,sourcePath],{
      cwd:ROOT,windowsHide:true,stdio:["ignore","pipe","pipe"],
      env:{...process.env,FNS_MAX_PDF_MB:String(process.env.FNS_MAX_PDF_MB||512)}
    });
    activePdfChild=child;
    let stdout="",stderr="";
    const cap=(value,chunk)=>(value+String(chunk||"")).slice(-65536);
    child.stdout.on("data",chunk=>stdout=cap(stdout,chunk));
    child.stderr.on("data",chunk=>stderr=cap(stderr,chunk));
    child.on("error",error=>{if(activePdfChild===child)activePdfChild=null;reject(error);});
    child.on("close",code=>{
      if(activePdfChild===child)activePdfChild=null;
      const lines=stdout.trim().split(/\r?\n/).filter(Boolean);
      let payload=null;
      for(let i=lines.length-1;i>=0;i--){
        try{payload=JSON.parse(lines[i]);break;}catch{}
      }
      if(payload)resolve({...payload,exit_code:Number(code||0),stderr:stderr.slice(-2000)});
      else resolve({ok:false,code:"WORKER_NO_RESULT",error:stderr||("worker exit "+code),exit_code:Number(code||0)});
    });
  });
}

async function pumpMassImportQueue(){
  if(massPumpRunning)return;
  massPumpRunning=true;
  try{
    const inc=await ensureIncrementalLibrary();
    while(true){
      let freeBytes=Number.POSITIVE_INFINITY;
      try{
        const fsInfo=await statfs(ROOT);
        freeBytes=Number(fsInfo.bavail||fsInfo.bfree||0)*Number(fsInfo.bsize||fsInfo.frsize||4096);
        massImportState.free_gb=Math.round((freeBytes/1024/1024/1024)*10)/10;
      }catch{}
      if(freeBytes<MASS_MIN_FREE_GB*1024*1024*1024){
        massImportState.paused_reason="Pouco espaço em disco: mínimo livre "+MASS_MIN_FREE_GB+" GB.";
        break;
      }
      if(generatorBusy>0||os.freemem()<600*1024*1024){
        massImportState.paused_reason=generatorBusy>0?"Qwen em uso":"Memória RAM livre abaixo do limite seguro";
        await new Promise(resolve=>setTimeout(resolve,3000));
        continue;
      }
      massImportState.paused_reason="";
      const item=inc.nextFolderFile();
      if(!item)break;
      massImportState.last_file=item.source_path;
      let result;
      try{result=await runPdfIngestWorker(item.source_path);}
      catch(error){result={ok:false,code:"WORKER_ERROR",error:String(error?.message||error)};}
      massImportState.last_result=result;
      if(result?.ok){
        inc.finishFolderFile(item.source_path,{
          status:result.duplicate?"duplicate":"done",
          sha256:result.sha256||"",
          documentId:result?.document?.document_id||""
        });
      }else{
        const code=String(result?.code||"");
        inc.finishFolderFile(item.source_path,{
          status:code==="NEEDS_OCR"?"needs_ocr":"failed",
          error:String(result?.error||code||"Falha de ingestão")
        });
      }
      inc.checkpoint();
      await new Promise(resolve=>setTimeout(resolve,250));
    }
  }finally{massPumpRunning=false;}
}

async function startMassImporter(){
  if(massImportState.started)return;
  massImportState.started=true;
  await mkdir(MASS_IMPORT_DIR,{recursive:true});
  const inc=await ensureIncrementalLibrary();
  inc.requeueInterrupted();
  // Migra somente o índice incremental experimental antigo, em lotes pequenos.
  // O baú/base congelado nunca participa desta migração.
  for(let i=0;i<20;i++){
    const migrated=inc.backfillLegacyBlocks(25);
    if(!migrated.remaining)break;
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  await scanMassImportFolder();
  pumpMassImportQueue().catch(()=>{});

  // No Windows, fs.watch recursivo dispara um único rescan debounced mesmo durante lotes enormes.
  try{
    massFolderWatcher=fsWatch(MASS_IMPORT_DIR,{recursive:process.platform==="win32"},()=>{
      if(massWatchTimer)clearTimeout(massWatchTimer);
      massWatchTimer=setTimeout(()=>{
        scanMassImportFolder().then(()=>pumpMassImportQueue()).catch(()=>{});
      },5000);
    });
    massFolderWatcher.unref?.();
  }catch{}

  setInterval(()=>{
    scanMassImportFolder().then(()=>pumpMassImportQueue()).catch(()=>{});
  },MASS_SCAN_MS).unref?.();
  setInterval(()=>pumpMassImportQueue().catch(()=>{}),15000).unref?.();
}

async function loadLibrary(){
  if(libraryPromise)return libraryPromise;
  libraryPromise=(async()=>{
    const started=Date.now();
    const seen=new Set();
    const backupDir=path.join(PUBLIC,"biblioteca_backup");
    const names=(await readdir(backupDir).catch(()=>[])).filter(x=>/^part-\d+\.json$/i.test(x)).sort();
    for(const name of names){
      let parsed={};
      try{parsed=JSON.parse(await readFile(path.join(backupDir,name),"utf8"));}catch{continue;}
      const chunks=Array.isArray(parsed)?parsed:(Array.isArray(parsed?.chunks)?parsed.chunks:[]);
      for(const row of chunks){
        const text=String(row?.text||"").trim();
        if(!text)continue;
        const key=String(row?.id||row?.key||row?.document_id+":"+String(row?.chunk_index||0));
        if(seen.has(key))continue;
        seen.add(key);
        const stored={...row,key};
        rows.push(stored);
        indexAuthoritativeRow(stored);
      }
    }
    const rawDir=path.join(ROOT,"raw-vault","generated");
    for(const name of (await readdir(rawDir).catch(()=>[])).filter(x=>/\.(txt|md)$/i.test(x)).sort()){
      const text=await readFile(path.join(rawDir,name),"utf8").catch(()=>"");
      if(!text)continue;
      const doc="raw:"+name;
      let index=0;
      for(let at=0;at<text.length;at+=1200){
        const slice=text.slice(at,at+1500).trim();
        if(!slice)continue;
        rows.push({key:doc+":"+index,document_id:doc,title:name.replace(/\.(txt|md)$/i,""),page:null,chunk_index:index++,text:slice,source:"raw-vault"});
      }
    }
    return {chunks:rows.length,files:names.length,ms:Date.now()-started};
  })();
  return libraryPromise;
}

async function ensureV3Index(){
  if(v3IndexPromise)return v3IndexPromise;
  v3IndexPromise=(async()=>{
    const started=Date.now();
    const state=await ensurePersistentV3({
      root:ROOT,
      publicDir:PUBLIC,
      buildIndex:buildV3EvidenceIndex,
      loadRows:async()=>{await loadLibrary();return rows;}
    });
    return {...state,build_ms:Date.now()-started};
  })();
  return v3IndexPromise;
}

async function searchFederatedV3(question,aliases,options={}){
  const [base,inc]=await Promise.all([ensureV3Index(),ensureIncrementalLibrary()]);
  const limit=Math.max(1,Math.min(80,Number(options.limit||40)));
  const baseResult=searchPersistentV3(base,question,aliases,{...options,limit});
  const incResult=inc.searchV3(question,aliases,{...options,limit});
  return mergeFederatedSearch(baseResult,incResult,limit);
}
async function expandV3WithQwen(question){
  const models=await installedModels();
  const model=autoModel(models);
  if(!model)return [];
  const prompt=[
    "Você é somente um expansor de consulta para pesquisa em biblioteca.",
    "Não responda à pergunta.",
    "Retorne no máximo 8 expressões equivalentes ou estreitamente relacionadas, em português e inglês.",
    "Separe as expressões apenas com o caractere |.",
    "Não invente citações, fontes, pessoas ou fatos.",
    "Consulta:",String(question||"").trim()
  ].join("\n");
  try{
    const data=await fetchOllama("/api/chat",{
      method:"POST",
      body:JSON.stringify({
        model,stream:false,think:false,
        messages:[{role:"user",content:prompt}],
        options:{temperature:0,num_ctx:768,num_predict:80}
      })
    },45000);
    return String(data?.message?.content||"")
      .split("|").map(x=>x.replace(/[\n\r"']/g," ").replace(/^[-*\d.\s]+/,"").trim())
      .filter(x=>x.length>=3&&x.length<=100)
      .slice(0,8);
  }catch{return [];}
}
async function handleV3Health(req,res){
  const [state,inc]=await Promise.all([ensureV3Index(),ensureIncrementalLibrary()]);
  const persistent=persistentV3Health(state);
  const incremental=inc.counts();
  json(res,{
    ok:true,
    version:persistent.version,
    engine:"Evidence Engine V3 Federado",
    dictionary_frozen:true,
    architecture:"base-frozen + incremental-50k",
    source_rows:persistent.source_rows,
    evidence_units:Number(persistent.evidence_units||0)+Number(incremental.blocks||0),
    counts:persistent.counts,
    build_ms:state.build_ms,
    persistent_index:persistent,
    incremental_index:incremental
  });
}
async function handleV3Chat(req,res){
  const body=await readJsonBody(req);
  const question=String(body.question||"").trim();
  const mode=RESPONSE_MODES.has(String(body.mode||""))?String(body.mode):"explain";
  if(!question){json(res,{ok:false,error:"Pergunta vazia."},400);return;}
  const aliases=await loadAliases();
  const strict=mode==="exact" && body.strict_phrase===true;
  let result=await searchFederatedV3(question,aliases,{limit:mode==="exact"?25:40,strict,candidate_limit:700});
  let query_expansions=[];
  if(mode!=="exact" && !strict && result.results.length<8 && body.allow_query_expansion!==false){
    query_expansions=await expandV3WithQwen(question);
    if(query_expansions.length){
      result=await searchFederatedV3(question,aliases,{
        limit:40,strict:false,candidate_limit:900,extraExpansions:query_expansions
      });
    }
  }
  const answer=formatV3EvidenceAnswer(result,mode);
  const chatMatches=await decorateSourceLinkRows(result.results.slice(0,mode==="short"?4:14).map(row=>({
    document_id:String(row.document_id||""),
    reference:v3DisplayReference(row),
    citation_verified:true,
    kind:row.kind,
    title:row.title||"",
    page:row.page||null,
    score:Number(row.score||0),
    text:row.text
  })));
  json(res,{
    ok:true,
    answer,
    speech_text:answer,
    provider:"v3-evidence-engine",
    dictionary_frozen:true,
    qwen_role:query_expansions.length?"query-expansion-only":"not-used-for-answer",
    query_expansions,
    total_candidates:result.total,
    evidence_count:result.results.length,
    index_version:(await ensureV3Index()).version||persistentV3Health(await ensureV3Index()).version,
    search_sources:result.sources,
    matches:chatMatches
  });
}

async function ensureV4Profile(){
  if(!v4ProfilePromise)v4ProfilePromise=createLessonProfileStore(ROOT);
  return v4ProfilePromise;
}
function withGeneratorQueue(task){
  const wrapped=async()=>{
    generatorBusy++;
    try{return await task();}
    finally{generatorBusy=Math.max(0,generatorBusy-1);}
  };
  const run=generatorQueue.then(wrapped,wrapped);
  generatorQueue=run.catch(()=>{});
  return run;
}
async function generateLessonWithQwen(prompt){
  return withGeneratorQueue(async()=>{
    const models=await installedModels();
    if(!models.includes("qwen3:0.6b"))return null;
    const data=await fetchOllama("/api/chat",{
      method:"POST",
      body:JSON.stringify({
        model:"qwen3:0.6b",stream:false,think:false,
        messages:[{role:"user",content:String(prompt||"")}],
        options:{temperature:0,num_ctx:1536,num_predict:220}
      })
    },180000);
    return {content:String(data?.message?.content||""),model:"qwen3:0.6b"};
  });
}
async function verifyLessonWithQwen(prompt){
  return withGeneratorQueue(async()=>{
    const models=await installedModels();
    if(!models.includes("qwen3:0.6b"))return null;
    const data=await fetchOllama("/api/chat",{
      method:"POST",
      body:JSON.stringify({
        model:"qwen3:0.6b",stream:false,think:false,
        messages:[{role:"user",content:String(prompt||"")}],
        options:{temperature:0,num_ctx:1024,num_predict:100}
      })
    },180000);
    return {content:String(data?.message?.content||""),model:"qwen3:0.6b"};
  });
}
async function generateLessonWithExternal(question,proofs){
  if(!EXTERNAL_WRITER_ENABLED||!EXTERNAL_WRITER_URL)return null;
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),45000);
  try{
    const headers={"Content-Type":"application/json"};
    if(EXTERNAL_WRITER_TOKEN)headers.Authorization="Bearer "+EXTERNAL_WRITER_TOKEN;
    const res=await fetch(EXTERNAL_WRITER_URL,{
      method:"POST",headers,signal:controller.signal,
      body:JSON.stringify({
        question:String(question||"").slice(0,600),
        proofs:(proofs||[]).slice(0,3).map(p=>({id:p.id,trecho:p.trecho}))
      })
    });
    if(!res.ok)throw new Error("External writer HTTP "+res.status);
    const data=await res.json().catch(()=>null);
    const content=data?.content??data?.text??data?.answer??data;
    const judged=judgeLessonDraft(content,proofs||[]);
    if(judged.source_rejected.length||!judged.accepted.length)return null;
    return {content,model:"external-writer"};
  }finally{clearTimeout(timer);}
}
async function generateLessonText(prompt,context={}){
  if(EXTERNAL_WRITER_ENABLED){
    try{
      const external=await generateLessonWithExternal(context.question,context.proofs);
      if(external)return external;
    }catch{}
  }
  return generateLessonWithQwen(prompt);
}
async function handleV4Health(req,res){
  const [v3,profile,models,piper]=await Promise.all([ensureV3Index(),ensureV4Profile(),installedModels(),piperStatus(ROOT)]);
  const p=persistentV3Health(v3);
  json(res,{
    ok:true,
    version:V4_VERSION,
    service:"Consciência Fabiano V4 Aula",
    local_only:true,
    dictionary_frozen:true,
    dictionary_endpoint:"/api/v2/dictionary",
    v3_endpoint:"/api/v3/chat",
    lesson_endpoint:"/api/v4/lesson",
    external_writer_enabled:EXTERNAL_WRITER_ENABLED,
    external_writer_configured:Boolean(EXTERNAL_WRITER_URL),
    generator_queue:"single",
    claim_grounding:"literal-support-quote",
    semantic_verifier:"qwen3:0.6b-local",
    reference_verification:"authoritative-record+exact-substring",
    tts:piper,
    model:models.includes("qwen3:0.6b")?"qwen3:0.6b":null,
    profile_persistent:Boolean(profile?.persistent),
    library_hash:p.library_hash,
    v3_persistent:p.persistent,
    v3_fts5:p.fts5,
    evidence_units:p.evidence_units,
    incremental_50k:(await ensureIncrementalLibrary()).counts()
  });
}
async function handleV4Lesson(req,res){
  const body=await readJsonBody(req);
  const question=String(body.question||"").trim();
  const mode=["aula","livro","revisao"].includes(String(body.mode))?String(body.mode):"aula";
  if(!question){json(res,{ok:false,error:"Pergunta vazia."},400);return;}

  const [aliases,profileStore]=await Promise.all([loadAliases(),ensureV4Profile()]);
  let search=await searchFederatedV3(question,aliases,{limit:16,strict:false,candidate_limit:700});
  let verifiedEvidence=await v4EvidenceFromAuthority(search.results);

  // If the Evidence Engine cannot form two verified lesson proofs, reuse the
  // already-proven Dicionário V2 strict-AND retrieval before giving up. This
  // is especially important for core doctrinal terms present in Standard Works,
  // where a page may be searchable even when verse segmentation is imperfect.
  if(verifiedEvidence.length<2){
    const dictionaryEvidence=await v4DictionaryFallbackEvidence(question,aliases,10);
    if(dictionaryEvidence.length){
      const merged=[...verifiedEvidence,...dictionaryEvidence];
      const seen=new Set();
      verifiedEvidence=merged.filter(item=>{
        const key=String(item?.document_id||"")+"|"+String(item?.page||"")+"|"+
          normalizeAuthorityText(item?.text||"").slice(0,260);
        if(seen.has(key))return false;
        seen.add(key);return true;
      }).slice(0,10);
    }
  }

  if(verifiedEvidence.length<2){
    const expanded=await withGeneratorQueue(()=>expandV3WithQwen(question));
    if(expanded.length){
      search=await searchFederatedV3(question,aliases,{
        limit:16,strict:false,candidate_limit:1000,extraExpansions:expanded
      });
      const expandedEvidence=await v4EvidenceFromAuthority(search.results);
      const merged=[...verifiedEvidence,...expandedEvidence];
      const seen=new Set();
      verifiedEvidence=merged.filter(item=>{
        const key=String(item?.document_id||"")+"|"+String(item?.page||"")+"|"+
          normalizeAuthorityText(item?.text||"").slice(0,260);
        if(seen.has(key))return false;
        seen.add(key);return true;
      }).slice(0,10);
    }
  }

  const profile=profileStore.read();
  const lesson=await buildLesson({
    question,
    age:Number(body.age||0)||null,
    mode,
    evidence:verifiedEvidence.slice(0,8),
    profile,
    generate:generateLessonText,
    verify:verifyLessonWithQwen
  });

  if(!lesson.nao_sei){
    profileStore.write({
      theme:question,
      last_check:lesson.pergunta,
      last_proof_id:lesson.provas?.[0]?.id||""
    });
  }

  const lessonProofs=[];
  for(const proof of (lesson.provas||[])){
    lessonProofs.push({...proof,...await sourceLinkFields(proof)});
  }
  json(res,{
    ...lesson,
    provas:lessonProofs,
    ok:true,
    speech_text:lessonSpeechText({...lesson,provas:lessonProofs}),
    provider:"v4-lesson-local",
    dictionary_frozen:true,
    dictionary_fallback_enabled:true,
    external_writer_enabled:EXTERNAL_WRITER_ENABLED
  });
}
async function handleV4Tts(req,res){
  const body=await readJsonBody(req);
  const text=[
    String(body.ideia||"").trim(),
    ...(Array.isArray(body.explicacao)?body.explicacao:[]).map(x=>String(x||"").trim())
  ].filter(Boolean).join(" ");
  const wav=await synthesizePiper(ROOT,text);
  res.statusCode=200;
  res.setHeader("Content-Type","audio/wav");
  res.setHeader("Content-Length",String(wav.length));
  res.setHeader("Cache-Control","no-store");
  res.end(wav);
}
function panelHtml(){
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Painel local • Consciência Fabiano</title>
  <style>body{font:15px system-ui;background:#0b1220;color:#e8eef8;margin:0;padding:24px}main{max-width:900px;margin:auto}h1{margin-top:0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px}.card{background:#142036;border:1px solid #29415f;border-radius:12px;padding:16px}.ok{color:#69e6a6}.bad{color:#ff8f8f}code{word-break:break-all}</style>
  <main><h1>Consciência Fabiano • Painel local</h1><p>Somente saúde local. Nenhum conteúdo da biblioteca é exibido aqui.</p><div id="grid" class="grid"></div></main>
  <script>
  const endpoints=[["V2","/api/v2/health"],["V3","/api/v3/health"],["V4","/api/v4/health"]];
  Promise.all(endpoints.map(async ([name,url])=>{try{const r=await fetch(url);return [name,await r.json()]}catch(e){return [name,{ok:false,error:String(e)}]}})).then(rows=>{
    document.getElementById("grid").innerHTML=rows.map(([name,d])=>'<div class="card"><h2>'+name+'</h2><p class="'+(d.ok?'ok':'bad')+'">'+(d.ok?'OK':'ERRO')+'</p><pre>'+escapeHtml(JSON.stringify(d,null,2))+'</pre></div>').join('');
  });
  function escapeHtml(s){return s.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}
  </script></html>`;
}
async function fetchOllama(endpoint,options={},timeoutMs=120000){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const res=await fetch(OLLAMA+endpoint,{...options,signal:controller.signal,headers:{"Content-Type":"application/json",...(options.headers||{})}});
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw Object.assign(new Error(data?.error||("Ollama HTTP "+res.status)),{status:res.status});
    return data;
  }finally{clearTimeout(timer);}
}
async function installedModels(){
  try{
    const data=await fetchOllama("/api/tags",{method:"GET"},3500);
    return (Array.isArray(data?.models)?data.models:[]).map(x=>String(x?.name||x?.model||"")).filter(Boolean);
  }catch{return [];}
}
function ramGb(){
  const override=Number(process.env.FNS_RAM_GB||0);
  if(Number.isFinite(override)&&override>0)return Math.max(1,Math.round(override));
  return Math.max(1,Math.round(os.totalmem()/1024/1024/1024));
}
function recommendedByHardware(){
  const gb=ramGb();
  if(gb>=32)return "qwen3.8:27b";
  if(gb>=16)return "qwen3:8b";
  if(gb>=10)return "qwen3:4b";
  if(gb>=6)return "qwen3:1.7b";
  return "qwen3:0.6b";
}
function contextTokensByHardware(){
  const gb=ramGb();
  if(gb>=32)return 32768;
  if(gb>=16)return 16384;
  if(gb>=10)return 8192;
  if(gb>=6)return 4096;
  return 2048;
}
function evidenceBudgetForContext(numCtx){
  const ctx=Math.max(1024,Number(numCtx)||2048);
  if(ctx<=1536)return {max_rows:8,max_chars:4200};
  return {
    max_rows:ctx<=2048?8:ctx<=4096?10:ctx<=8192?12:14,
    max_chars:ctx<=2048?6200:ctx<=4096?12000:ctx<=8192?24000:48000
  };
}
function fitEvidenceToContext(evidence,numCtx){
  const budget=evidenceBudgetForContext(numCtx);
  const out=[];
  let used=0;
  for(const row of evidence||[]){
    if(out.length>=budget.max_rows)break;
    const remaining=budget.max_chars-used;
    if(remaining<240)break;
    const text=String(row?.text||"").trim();
    if(!text)continue;
    const clipped=text.slice(0,Math.min(text.length,remaining));
    out.push({...row,text:clipped});
    used+=clipped.length;
  }
  return out;
}
function compactLowRamEvidence(evidence,maxRows=10){
  return (evidence||[]).slice(0,maxRows).map(row=>{
    const raw=String(row?.text||"").replace(/\s+/g," ").trim();
    const aliases=Array.isArray(row?.focus_aliases)?row.focus_aliases.filter(Boolean):[];
    const sentences=raw.split(/(?<=[.!?;:])\s+/u).map(x=>x.trim()).filter(Boolean);
    let picked=raw;
    if(sentences.length>1 && aliases.length){
      const norm=value=>String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
      const index=sentences.findIndex(sentence=>{
        const folded=norm(sentence);
        return aliases.some(alias=>folded.includes(norm(alias)));
      });
      if(index>=0)picked=sentences.slice(Math.max(0,index-1),Math.min(sentences.length,index+2)).join(" ");
    }
    if(picked.length>560)picked=picked.slice(0,557).replace(/\s+\S*$/,"")+"…";
    return {...row,text:picked};
  });
}
function evidenceDigest(evidence,maxRows=8){
  return (evidence||[]).slice(0,maxRows).map(row=>({
    reference:String(row?.reference||publicReference(row)||"Fonte"),
    text:String(row?.text||"").replace(/\s+/g," ").trim().slice(0,420)
  })).filter(row=>row.text);
}

function isMemoryAllocationError(error){
  const msg=String(error?.message||error||"").toLowerCase();
  return msg.includes("failed to allocate") ||
    msg.includes("kv cache") ||
    msg.includes("llama_init_from_model") ||
    msg.includes("alloc_tensor_range") ||
    msg.includes("llama-server process has terminated");
}
function autoModel(installed){
  const rec=recommendedByHardware();
  const safeOrder=rec==="qwen3.8:27b"
    ? ["qwen3.8:27b","qwen3:8b","qwen3:4b","qwen3:1.7b","qwen3:0.6b"]
    : rec==="qwen3:8b"
      ? ["qwen3:8b","qwen3:4b","qwen3:1.7b","qwen3:0.6b"]
      : rec==="qwen3:4b"
        ? ["qwen3:4b","qwen3:1.7b","qwen3:0.6b"]
        : rec==="qwen3:1.7b"
          ? ["qwen3:1.7b","qwen3:0.6b"]
          : ["qwen3:0.6b"];
  const set=new Set(installed);
  return safeOrder.find(x=>set.has(x))||null;
}
async function resolveResponseModel(installed,requested){
  const clean=[...new Set((installed||[]).map(x=>String(x||"").trim()).filter(Boolean))];
  const allowed=["qwen3:0.6b","qwen3:1.7b","qwen3:4b","qwen3:8b","qwen3.8:27b"];
  if(requested&&requested!=="auto"){
    const exact=clean.find(x=>x===requested);
    if(exact)return exact;
    const sameBase=clean.find(x=>allowed.includes(x)&&x.split(":")[0]===String(requested).split(":")[0]);
    if(sameBase)return sameBase;
    try{
      await fetchOllama("/api/show",{method:"POST",body:JSON.stringify({model:requested})},5000);
      return requested;
    }catch{return null;}
  }
  const auto=autoModel(clean);
  if(auto)return auto;
  for(const candidate of allowed){
    try{
      await fetchOllama("/api/show",{method:"POST",body:JSON.stringify({model:candidate})},5000);
      return candidate;
    }catch{}
  }
  return null;
}
function hashText(text){return createHash("sha256").update(String(text||"")).digest("hex");}
async function embedTexts(texts,{persist=false}={}){
  const input=(Array.isArray(texts)?texts:[texts]).map(x=>String(x||"")).filter(Boolean);
  if(!input.length)return [];
  const out=new Array(input.length);
  const missing=[],positions=[];
  for(let i=0;i<input.length;i++){
    const key=hashText(input[i]);
    if(embedCache.has(key))out[i]=embedCache.get(key);
    else{missing.push(input[i]);positions.push(i);}
  }
  if(missing.length){
    const data=await fetchOllama("/api/embed",{
      method:"POST",
      body:JSON.stringify({model:EMBED_MODEL,input:missing,truncate:true})
    },180000);
    const vectors=Array.isArray(data?.embeddings)?data.embeddings:[];
    for(let j=0;j<positions.length;j++){
      const vector=Array.isArray(vectors[j])?vectors[j].map(Number):[];
      out[positions[j]]=vector;
      if(vector.length){
        const key=hashText(input[positions[j]]);
        embedCache.set(key,vector);
        if(persist){
          await mkdir(DATA_DIR,{recursive:true});
          await appendFile(VECTOR_LOG,JSON.stringify({key,model:EMBED_MODEL,dimensions:vector.length,vector})+"\n","utf8").catch(()=>{});
        }
      }
    }
  }
  return out.map(x=>Array.isArray(x)?x:[]);
}
async function semanticRerank(question,candidates,topK=14){
  if(!candidates.length)return [];
  try{
    const [qv]=await embedTexts([question]);
    if(!qv?.length)return candidates.slice(0,topK);
    const enriched=[];
    const batch=6;
    for(let at=0;at<candidates.length;at+=batch){
      const group=candidates.slice(at,at+batch);
      const vecs=await embedTexts(group.map(x=>x.text||""),{persist:false});
      for(let i=0;i<group.length;i++){
        const semantic=vecs[i]?.length?cosine(qv,vecs[i]):0;
        enriched.push({...group[i],semantic_score:semantic,hybrid_score:Number(group[i].lexical_score||0)+semantic*5});
      }
    }
    return enriched.sort((a,b)=>b.hybrid_score-a.hybrid_score).slice(0,topK);
  }catch{
    return candidates.slice(0,topK);
  }
}
function exactPayload(result){
  return {
    ok:result.total>0,
    bypass_llm:true,
    exact_retrieval:true,
    total:result.total,page:result.page,page_size:result.page_size,pages:result.pages,
    concepts:result.concepts,matches:result.matches,
    answer:formatExactAnswer(result.matches),
    provider:"local-exact-no-llm"
  };
}
async function handleHealth(req,res){
  const models=await installedModels();
  const lib=await loadLibrary();
  const inc=await ensureIncrementalLibrary();
  const incCounts=inc.counts();
  json(res,{
    ok:true,version:V2_VERSION,local_runtime_build:LOCAL_RUNTIME_BUILD,service:"Consciência Fabiano v2 Local",
    local_only:true,external_paid_providers:false,
    ollama:{url:"localhost:11434",reachable:models.length>0,installed:models},
    hardware:{ram_gb:ramGb(),recommended:recommendedByHardware(),selected:autoModel(models),context_tokens:contextTokensByHardware()},
    embeddings:{model:EMBED_MODEL,installed:models.includes(EMBED_MODEL)},
    source_link:{
      enabled:true,
      name:"Fonte Viva",
      dictionary:true,
      chat:true,
      lesson:true,
      original_upload_endpoint:"/api/v3/source/original",
      pdf_view_endpoint:"/api/v3/source/pdf",
      exact_pdf_page_fragment:true,
      range_requests:true
    },
    library:{
      ...lib,
      base_chunks:lib.chunks,
      incremental_chunks:incCounts.chunks,
      incremental_documents:incCounts.documents,
      pending_jobs:incCounts.jobs,
      chunks:Number(lib.chunks||0)+Number(incCounts.chunks||0)
    }
  });
}
async function handleDictionary(req,res){
  const body=await readJsonBody(req);
  await loadLibrary();
  const aliases=await loadAliases();
  const query=String(body.query||body.question||"");
  const page=Math.max(1,Number(body.page||1));
  const pageSize=Math.min(100,Math.max(1,Number(body.page_size||50)));

  const baseProbe=exactAndMatches(rows,query,{aliases,page:1,pageSize:1});
  const inc=await ensureIncrementalLibrary();
  const incProbe=inc.searchDictionary(query,{aliases,page:1,pageSize:1});
  const baseTotal=Number(baseProbe.total||0),incTotal=Number(incProbe.total||0);
  const total=baseTotal+incTotal;
  const start=(page-1)*pageSize;
  const end=Math.min(total,start+pageSize);
  const matches=[];

  if(start<baseTotal && end>0){
    const firstBasePage=Math.floor(start/pageSize)+1;
    const first=exactAndMatches(rows,query,{aliases,page:firstBasePage,pageSize});
    const offsetInFirst=start-(firstBasePage-1)*pageSize;
    matches.push(...first.matches.slice(offsetInFirst,offsetInFirst+(end-start)));
  }

  if(matches.length<end-start && end>baseTotal){
    const incOffset=Math.max(0,start-baseTotal);
    const needed=(end-start)-matches.length;
    const incPage=Math.floor(incOffset/pageSize)+1;
    const first=inc.searchDictionary(query,{aliases,page:incPage,pageSize});
    const offset=incOffset-(incPage-1)*pageSize;
    matches.push(...first.matches.slice(offset,offset+needed));
    if(matches.length<end-start && incPage<first.pages){
      const second=inc.searchDictionary(query,{aliases,page:incPage+1,pageSize});
      matches.push(...second.matches.slice(0,(end-start)-matches.length));
    }
  }

  const displayMatches=await decorateDictionaryMatches(matches);
  json(res,{
    ok:true,local_only:true,unlimited_logical_results:true,
    query,
    concepts:baseProbe.concepts?.length?baseProbe.concepts:incProbe.concepts,
    total,page,page_size:pageSize,pages:Math.ceil(total/pageSize),
    matches:displayMatches,
    sources:{base_frozen:baseTotal,incremental:incTotal}
  });
}
async function handleEmbed(req,res){
  const body=await readJsonBody(req);
  const texts=Array.isArray(body.texts)?body.texts.slice(0,16):[String(body.text||"")];
  const vectors=await embedTexts(texts,{persist:Boolean(body.persist)});
  json(res,{ok:true,model:EMBED_MODEL,dimensions:vectors[0]?.length||0,vectors});
}
async function handleChat(req,res){
  const body=await readJsonBody(req);
  const question=String(body.question||"").trim();
  const mode=RESPONSE_MODES.has(String(body.mode||""))?String(body.mode):"explain";
  if(!question){json(res,{ok:false,error:"Pergunta vazia."},400);return;}
  await loadLibrary();
  const aliases=await loadAliases();
  const suppliedEvidence=Array.isArray(body.evidence)
    ? body.evidence.slice(0,100).map((row,index)=>({
        id:String(row?.id||("browser:"+index)),
        document_id:String(row?.document_id||"browser-local"),
        title:String(row?.title||row?.public_title||""),
        source_title:String(row?.source_title||""),
        filename:String(row?.filename||""),
        canonical_reference:String(row?.canonical_reference||""),
        page:Number(row?.page||0)||null,
        chunk_index:Number(row?.chunk_index||index),
        text:String(row?.text||"").slice(0,16000),
        reference:String(row?.reference||"")
      })).filter(row=>row.text.trim())
    : [];
  const searchRows=suppliedEvidence.length?suppliedEvidence:rows;

  if(mode==="exact"){
    const result=exactAndMatches(searchRows,question,{aliases,page:1,pageSize:Math.min(100,Number(body.page_size||25))});
    const verifiedMatches=applyCitationIntegrity(result.matches);
    const verified={
      ...result,
      total:verifiedMatches.length,
      pages:verifiedMatches.length?1:0,
      page:1,
      matches:verifiedMatches
    };
    const payload=exactPayload(verified);
    payload.matches=await decorateSourceLinkRows((payload.matches||[]).map(r=>({...r,document_id:String(r.document_id||"")})));
    json(res,{
      ...payload,
      citation_integrity:true,
      evidence_origin:suppliedEvidence.length?"browser-local":"static-local-vault"
    });return;
  }

  const lowRam=ramGb()<=5;
  const candidateLimit=lowRam?60:Math.min(100,Math.max(20,Number(body.candidate_limit||70)));
  const maxEvidence=lowRam?10:14;
  const lexical=lexicalCandidates(searchRows,question,candidateLimit);
  let evidence=focusEvidence(lexical,question,aliases,maxEvidence);
  if(!evidence.length){
    evidence=focusEvidence(searchRows,question,aliases,maxEvidence);
  }
  if(!lowRam && body.semantic!==false && evidence.length){
    evidence=await semanticRerank(question,evidence,maxEvidence);
    evidence=focusEvidence(evidence,question,aliases,maxEvidence);
  }
  evidence=evidence.map(row=>{
    const focused=focusedEvidenceWindow(row,900);
    return focused.accepted?{...row,text:focused.text,focus_verified:true,focus_matched_alias:focused.matched_alias}:null;
  }).filter(Boolean);
  evidence=applyCitationIntegrity(evidence);
  if(mode==="timeline"){
    evidence=[...evidence].sort((a,b)=>{
      const ay=extractTimelineYear(a.text),by=extractTimelineYear(b.text);
      if(ay==null&&by==null)return 0;if(ay==null)return 1;if(by==null)return -1;return ay-by;
    });
  }
  if(lowRam)evidence=compactLowRamEvidence(evidence,10);
  if(!evidence.length){
    json(res,{ok:true,answer:"A biblioteca local não encontrou evidência suficiente para responder a essa pergunta.",matches:[],mode,provider:"local-strict-empty",model:null});
    return;
  }

  if(body.grounded===true){
    const answer=formatGroundedAnswer(evidence,mode);
    json(res,{
      ok:true,
      answer,
      speech_text:answer,
      evidence_digest:evidenceDigest(evidence,lowRam?10:8),
      mode,
      model:null,
      provider:"grounded-exact-no-llm",
      embedding_model:EMBED_MODEL,
      evidence_count:evidence.length,
      evidence_origin:suppliedEvidence.length?"browser-local":"static-local-vault",
      matches:await decorateSourceLinkRows(evidence.map(r=>({
        document_id:String(r.document_id||""),
        reference:r.citation_reference||r.reference||"",
        citation_verified:r.citation_verified===true,
        citation_kind:r.citation_kind||"",
        title:r.public_title||"",
        page:r.page||null,
        text:r.text||""
      })))
    });
    return;
  }

  const models=await installedModels();
  const requested=String(body.model||"auto").trim();
  const allowed=["qwen3:0.6b","qwen3:1.7b","qwen3:4b","qwen3:8b","qwen3.8:27b"];
  const candidates=[];
  const addCandidate=name=>{
    const clean=String(name||"").trim();
    if(clean && !candidates.includes(clean))candidates.push(clean);
  };

  if(requested && requested!=="auto")addCandidate(requested);
  else addCandidate(autoModel(models));
  addCandidate(recommendedByHardware());
  for(const name of models){
    if(allowed.includes(name))addCandidate(name);
  }
  addCandidate("qwen3:0.6b");

  const preferredContext=lowRam?1536:contextTokensByHardware();
  const contexts=lowRam?[1536,1024]:preferredContext<=2048?[preferredContext,1024]:[preferredContext,Math.max(2048,Math.floor(preferredContext/2))];
  let data=null;
  let model=null;
  let usedContext=preferredContext;
  let promptEvidence=fitEvidenceToContext(evidence,preferredContext);
  let lastError=null;
  let sawMemoryError=false;

  modelLoop:
  for(const candidate of candidates){
    for(const ctx of [...new Set(contexts)]){
      usedContext=ctx;
      promptEvidence=fitEvidenceToContext(evidence,ctx);
      const prompt=buildPrompt({question,mode,evidence:promptEvidence});
      try{
        data=await fetchOllama("/api/chat",{
          method:"POST",
          body:JSON.stringify({
            model:candidate,stream:false,think:false,
            messages:[{role:"user",content:prompt}],
            options:{temperature:0.05,num_ctx:ctx,num_predict:lowRam?(ctx<=1024?180:260):(ctx<=2048?384:768)}
          })
        },lowRam?240000:300000);
        model=candidate;
        lastError=null;
        break modelLoop;
      }catch(error){
        lastError=error;
        const message=String(error?.message||error||"").toLowerCase();
        if(isMemoryAllocationError(error)){
          sawMemoryError=true;
          continue;
        }
        if(error?.name==="AbortError" || message.includes("aborted") || message.includes("abort")){
          lastError=error;
          break modelLoop;
        }
        if(message.includes("model") && (message.includes("not found") || message.includes("does not exist") || Number(error?.status)===404)){
          break;
        }
        throw error;
      }
    }
  }

  if(!data && lastError && (lastError?.name==="AbortError" || String(lastError?.message||"").toLowerCase().includes("abort"))){
    const fallback=promptEvidence.slice(0,4).map((r,i)=>
      "["+(i+1)+"] "+String(r.reference||publicReference(r))+"\n"+String(r.text||"").trim()
    ).join("\n\n");
    json(res,{
      ok:true,
      answer:"O Qwen local excedeu o tempo seguro neste computador. Abaixo está a resposta de contingência baseada diretamente nas evidências recuperadas:\n\n"+fallback,
      mode,model:null,provider:"local-deterministic-timeout",embedding_model:EMBED_MODEL,
      context_tokens:usedContext,evidence_count:promptEvidence.length,
      evidence_origin:suppliedEvidence.length?"browser-local":"static-local-vault",
      matches:await decorateSourceLinkRows(promptEvidence.map(r=>({document_id:String(r.document_id||""),reference:r.reference||publicReference(r),title:r.public_title||"",page:r.page||null,text:r.text||""})))
    });
    return;
  }

  if(!data){
    if(sawMemoryError){
      throw Object.assign(new Error(
        "O Qwen local ficou sem memória mesmo no modo econômico. Feche outros programas e tente novamente."
      ),{status:503,code:"LOCAL_MEMORY_EXHAUSTED",cause:lastError});
    }
    json(res,{
      ok:false,code:"LOCAL_MODEL_NOT_INSTALLED",
      error:"O Ollama está conectado, mas nenhum modelo Qwen de resposta respondeu à chamada direta.",
      installed:models,attempted:candidates,recommended:recommendedByHardware(),
      install:["ollama pull qwen3:0.6b"]
    },503);return;
  }

  const answer=String(data?.message?.content||"").trim();
  if(answer && !answerStaysOnFocus(answer,question,aliases)){
    const fallback=promptEvidence.slice(0,4).map((r,i)=>
      "["+(i+1)+"] "+String(r.reference||publicReference(r))+"\n"+String(r.text||"").trim()
    ).join("\n\n");
    json(res,{
      ok:true,
      answer:"O Qwen desviou do assunto solicitado, então a resposta foi bloqueada pelo Focus Lock. Evidências diretamente relacionadas à pergunta:\n\n"+fallback,
      mode,model:null,provider:"focus-lock-deterministic",embedding_model:EMBED_MODEL,
      context_tokens:usedContext,evidence_count:promptEvidence.length,
      evidence_origin:suppliedEvidence.length?"browser-local":"static-local-vault",
      matches:await decorateSourceLinkRows(promptEvidence.map(r=>({document_id:String(r.document_id||""),reference:r.reference||publicReference(r),title:r.public_title||"",page:r.page||null,text:r.text||""})))
    });
    return;
  }
  json(res,{
    ok:true,answer:answer||"A biblioteca recuperada não foi suficiente para produzir uma resposta.",
    speech_text:answer||"",
    evidence_digest:evidenceDigest(evidence,lowRam?8:6),
    mode,model,provider:"ollama-local-direct",embedding_model:EMBED_MODEL,
    context_tokens:usedContext,evidence_count:promptEvidence.length,
    evidence_origin:suppliedEvidence.length?"browser-local":"static-local-vault",
    matches:await decorateSourceLinkRows(promptEvidence.map(r=>({document_id:String(r.document_id||""),reference:r.reference||publicReference(r),title:r.public_title||"",page:r.page||null,text:r.text||""})))
  });
}

async function handleV3LibraryStatus(req,res){
  await loadLibrary();
  const [state,inc]=await Promise.all([ensureV3Index(),ensureIncrementalLibrary()]);
  json(res,{
    ok:true,
    base:{...persistentV3Health(state),documents:baseLibraryCatalog().length},
    incremental:inc.counts(),
    recent_incremental:inc.listDocuments({limit:5,offset:0}).map(x=>({
      document_id:x.document_id,title:x.title||x.filename,status:x.status,
      page_count:Number(x.page_count||0),chunk_count:Number(x.chunk_count||0),
      created_at:x.created_at
    })),
    total_documents:baseLibraryCatalog().length+Number(inc.counts().documents||0),
    append_only:true,base_frozen:true,federated_search:true,
    mass_import:{...massImportState,scanner_running:massScanRunning,worker_running:massPumpRunning}
  });
}
async function handleV3LibraryScan(req,res){
  const scan=await scanMassImportFolder();
  pumpMassImportQueue().catch(()=>{});
  const inc=await ensureIncrementalLibrary();
  json(res,{ok:true,scan,incremental:inc.counts(),mass_import:massImportState});
}
async function handleV3LibraryOpenFolder(req,res){
  await mkdir(MASS_IMPORT_DIR,{recursive:true});
  if(process.platform!=="win32"){
    json(res,{ok:false,error:"Abrir pasta automaticamente só está disponível no Windows.",path:MASS_IMPORT_DIR},400);
    return;
  }
  const child=spawn("explorer.exe",[MASS_IMPORT_DIR],{
    cwd:ROOT,windowsHide:false,detached:true,stdio:"ignore"
  });
  child.unref();
  json(res,{ok:true,opened:true,path:MASS_IMPORT_DIR});
}
async function handleV3LibraryCatalog(req,res){
  await loadLibrary();
  const url=new URL(req.url,"http://localhost");
  const limit=Math.max(10,Math.min(500,Number(url.searchParams.get("limit")||200)));
  const offset=Math.max(0,Number(url.searchParams.get("offset")||0));
  const inc=await ensureIncrementalLibrary();
  const base=baseLibraryCatalog();
  const incCounts=inc.counts();
  const added=inc.listDocuments({limit,offset}).map(x=>({
    document_id:x.document_id,arquivo:x.title||x.filename,titulo:x.title||x.filename,autor:x.author||"",
    paginas:Number(x.page_count||0),chunks:Number(x.chunk_count||0),blocos:Number(x.block_count||0),idioma:x.language||"",
    status:"incremental-pronto",source:"v3-incremental",immutable:false,created_at:x.created_at
  }));
  json(res,{
    ok:true,base_frozen:true,
    total_documents:base.length+Number(incCounts.documents||0),
    base_documents:base.length,
    incremental_documents:Number(incCounts.documents||0),
    incremental_offset:offset,incremental_limit:limit,
    more_incremental:offset+added.length<Number(incCounts.documents||0),
    books:[...base,...added]
  });
}
async function handleV3SourceOriginal(req,res){
  const url=new URL(req.url,"http://localhost");
  const documentId=safeSourceDocumentId(url.searchParams.get("document_id"));
  if(!documentId){json(res,{ok:false,error:"document_id SHA-256 inválido."},400);return;}
  const declaredLength=Math.max(0,Number(req.headers["content-length"]||0));
  if(declaredLength>MAX_ORIGINAL_PDF_BYTES){json(res,{ok:false,error:"PDF original excede o limite local configurado."},413);return;}

  await mkdir(PDF_VAULT_DIR,{recursive:true});
  const destination=sourceVaultPath(documentId);
  const temp=destination+".part";
  const handle=await open(temp,"w");
  const hash=createHash("sha256");
  let total=0;
  let magic=Buffer.alloc(0);
  try{
    for await(const raw of req){
      const chunk=Buffer.isBuffer(raw)?raw:Buffer.from(raw);
      total+=chunk.length;
      if(total>MAX_ORIGINAL_PDF_BYTES)throw Object.assign(new Error("PDF original excede o limite local configurado."),{status:413});
      if(magic.length<8)magic=Buffer.concat([magic,chunk.subarray(0,8-magic.length)]);
      hash.update(chunk);
      await handle.write(chunk);
    }
    await handle.sync();
  }catch(error){
    await handle.close().catch(()=>{});
    await unlink(temp).catch(()=>{});
    throw error;
  }
  await handle.close();
  if(!magic.toString("ascii").startsWith("%PDF-")){
    await unlink(temp).catch(()=>{});
    json(res,{ok:false,error:"O arquivo recebido não é um PDF válido."},400);return;
  }
  const digest=hash.digest("hex");
  if(digest!==documentId){
    await unlink(temp).catch(()=>{});
    json(res,{ok:false,error:"SHA-256 do PDF não confere com o documento extraído."},409);return;
  }
  const existing=await stat(destination).catch(()=>null);
  if(existing?.isFile())await unlink(temp).catch(()=>{});
  else await rename(temp,destination);

  const inc=await ensureIncrementalLibrary();
  inc.attachSourcePath(documentId,destination);
  json(res,{ok:true,stored:true,source_token:documentId,size_bytes:total});
}
async function handleV3SourcePdf(req,res){
  const url=new URL(req.url,"http://localhost");
  const source=await sourcePdfRecord(url.searchParams.get("document_id"));
  if(!source){json(res,{ok:false,error:"PDF original não está disponível localmente para esta fonte.",code:"SOURCE_PDF_UNAVAILABLE"},404);return;}
  const total=Math.max(0,Number(source.size||0));
  const safeName=String(source.filename||"documento.pdf").replace(/[\r\n"]/g,"_").slice(0,180);
  res.setHeader("Content-Type","application/pdf");
  res.setHeader("Content-Disposition",'inline; filename="'+safeName+'"');
  res.setHeader("Accept-Ranges","bytes");
  res.setHeader("Cache-Control","private, no-store");
  res.setHeader("X-Content-Type-Options","nosniff");

  let start=0,end=Math.max(0,total-1),partial=false;
  const range=String(req.headers.range||"").trim();
  if(range){
    const match=/^bytes=(\d*)-(\d*)$/i.exec(range);
    if(!match){res.statusCode=416;res.setHeader("Content-Range","bytes */"+total);res.end();return;}
    if(match[1]){
      start=Number(match[1]);
      end=match[2]?Math.min(Number(match[2]),total-1):total-1;
    }else if(match[2]){
      const suffix=Math.max(0,Number(match[2]));
      start=Math.max(0,total-suffix);
      end=total-1;
    }
    if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<start||start>=total){
      res.statusCode=416;res.setHeader("Content-Range","bytes */"+total);res.end();return;
    }
    partial=true;
  }
  const length=total?end-start+1:0;
  res.statusCode=partial?206:200;
  res.setHeader("Content-Length",String(length));
  if(partial)res.setHeader("Content-Range","bytes "+start+"-"+end+"/"+total);
  if(req.method==="HEAD"||total===0){res.end();return;}
  const stream=createReadStream(source.path,{start,end});
  stream.on("error",()=>{try{res.destroy();}catch{}});
  stream.pipe(res);
}
async function handleV3LibraryStart(req,res){
  const body=await readJsonBody(req);
  const token=safeSourceDocumentId(body?.source_token||"");
  const sha=safeSourceDocumentId(body?.content_sha256||"");
  delete body.source_path;
  delete body.source_token;
  if(token && sha && token===sha){
    const candidate=sourceVaultPath(token);
    const info=await stat(candidate).catch(()=>null);
    if(info?.isFile())body.source_path=candidate;
  }
  const inc=await ensureIncrementalLibrary();
  json(res,inc.start(body));
}
async function handleV3LibraryAppend(req,res){
  const body=await readJsonBody(req);
  const inc=await ensureIncrementalLibrary();
  json(res,inc.append(body.job_id,body.pages));
}
async function handleV3LibraryCommit(req,res){
  const body=await readJsonBody(req);
  const inc=await ensureIncrementalLibrary();
  const committed=inc.commit(body.job_id);
  json(res,{
    ok:true,duplicate:Boolean(committed.duplicate),document:committed.document,
    index:{engine:"incremental-50k",separate_from_base:true},
    searchable_immediately:true,
    dictionary_included:true,
    v3_included:true,
    v4_included:true
  });
}

async function serveStatic(req,res){
  const url=new URL(req.url,"http://localhost");
  let pathname=decodeURIComponent(url.pathname);
  if(pathname==="/")pathname="/index.html";
  const resolved=path.resolve(PUBLIC,"."+pathname);
  if(!resolved.startsWith(PUBLIC+path.sep) && resolved!==path.join(PUBLIC,"index.html")){
    json(res,{ok:false,error:"Caminho inválido."},403);return;
  }
  let info;
  try{info=await stat(resolved);}catch{info=null;}
  if(!info?.isFile()){
    const fallback=path.join(PUBLIC,"index.html");
    try{
      const data=await readFile(fallback);
      res.statusCode=200;res.setHeader("Content-Type",MIME[".html"]);res.end(data);return;
    }catch{json(res,{ok:false,code:"NOT_FOUND"},404);return;}
  }
  const data=await readFile(resolved);
  const ext=path.extname(resolved).toLowerCase();
  res.statusCode=200;
  res.setHeader("Content-Type",MIME[ext]||"application/octet-stream");
  if(/\.(html|js|css|json|webmanifest)$/i.test(ext))res.setHeader("Cache-Control","no-cache");
  else res.setHeader("Cache-Control","public, max-age=86400");
  res.end(data);
}

await mkdir(DATA_DIR,{recursive:true}).catch(()=>{});
await mkdir(PDF_VAULT_DIR,{recursive:true}).catch(()=>{});

http.createServer(async(req,res)=>{
  localHeaders(req,res);
  try{
    const url=new URL(req.url,"http://localhost");
    if(req.method==="GET" && url.pathname==="/api/v4/health"){await handleV4Health(req,res);return;}
    if(req.method==="POST" && url.pathname==="/api/v4/lesson"){await handleV4Lesson(req,res);return;}
    if(req.method==="POST" && url.pathname==="/api/v4/tts"){await handleV4Tts(req,res);return;}
    if(req.method==="GET" && url.pathname==="/painel"){res.statusCode=200;res.setHeader("Content-Type","text/html; charset=utf-8");res.end(panelHtml());return;}
    if(req.method==="GET" && url.pathname==="/api/v3/health"){await handleV3Health(req,res);return;}
    if(req.method==="POST" && url.pathname==="/api/v3/chat"){await handleV3Chat(req,res);return;}
    if(req.method==="GET" && url.pathname==="/api/v3/library/status"){await handleV3LibraryStatus(req,res);return;}
    if(req.method==="POST" && url.pathname==="/api/v3/library/scan"){await handleV3LibraryScan(req,res);return;}
    if(req.method==="POST" && url.pathname==="/api/v3/library/open-folder"){await handleV3LibraryOpenFolder(req,res);return;}
    if(req.method==="GET" && url.pathname==="/api/v3/library/catalog"){await handleV3LibraryCatalog(req,res);return;}
    if(req.method==="PUT" && url.pathname==="/api/v3/source/original"){await handleV3SourceOriginal(req,res);return;}
    if((req.method==="GET"||req.method==="HEAD") && url.pathname==="/api/v3/source/pdf"){await handleV3SourcePdf(req,res);return;}
    if(req.method==="POST" && url.pathname==="/api/v3/library/start"){await handleV3LibraryStart(req,res);return;}
    if(req.method==="POST" && url.pathname==="/api/v3/library/append"){await handleV3LibraryAppend(req,res);return;}
    if(req.method==="POST" && url.pathname==="/api/v3/library/commit"){await handleV3LibraryCommit(req,res);return;}
    if(req.method==="GET" && url.pathname==="/api/v2/health"){await handleHealth(req,res);return;}
    if(req.method==="GET" && url.pathname==="/api/v2/models"){
      const installed=await installedModels();
      json(res,{ok:true,installed,recommended:recommendedByHardware(),selected:autoModel(installed),embedding_model:EMBED_MODEL});
      return;
    }
    if(req.method==="POST" && url.pathname==="/api/v2/dictionary"){await handleDictionary(req,res);return;}
    if(req.method==="POST" && url.pathname==="/api/v2/embed"){await handleEmbed(req,res);return;}
    if(req.method==="POST" && url.pathname==="/api/v2/chat"){await handleChat(req,res);return;}
    if(req.method==="OPTIONS"){res.statusCode=204;res.end();return;}
    if(req.method==="GET"||req.method==="HEAD"){await serveStatic(req,res);return;}
    json(res,{ok:false,code:"NOT_FOUND"},404);
  }catch(error){
    json(res,{ok:false,error:String(error?.message||error),code:error?.code||"LOCAL_V2_ERROR"},Number(error?.status||500));
  }
}).listen(PORT,HOST,async()=>{
  const models=await installedModels();
  console.log("CONSCIENCIA_FABIANO_V2="+V2_VERSION);
  console.log("LOCAL_RUNTIME_BUILD="+LOCAL_RUNTIME_BUILD);
  console.log("LOCAL_URL=http://"+(HOST==="0.0.0.0"?"127.0.0.1":HOST)+":"+PORT);
  console.log("OLLAMA="+OLLAMA);
  console.log("EMBED_MODEL="+EMBED_MODEL);
  console.log("RECOMMENDED_MODEL="+recommendedByHardware());
  console.log("SELECTED_MODEL="+(autoModel(models)||"nenhum instalado"));
  loadLibrary().then(info=>{
    console.log("LOCAL_LIBRARY_CHUNKS="+info.chunks);
    ensureV3Index().then(state=>console.log("V3_EVIDENCE_UNITS="+persistentV3Health(state).evidence_units)).catch(()=>{});
  }).catch(()=>{});
  startMassImporter().then(()=>console.log("MASS_IMPORT_DIR="+MASS_IMPORT_DIR)).catch(error=>console.error("MASS_IMPORT_ERROR",String(error?.message||error)));
});
