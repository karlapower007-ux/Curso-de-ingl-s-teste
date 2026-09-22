import http from "node:http";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {readFile,readdir,stat,mkdir,appendFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {
  V2_VERSION, DEFAULT_EMBED_MODEL, RESPONSE_MODES,
  exactAndMatches, lexicalCandidates, chooseInstalledModel,
  formatExactAnswer, buildPrompt, cosine, publicReference, extractTimelineYear
} from "./v2-local-core.mjs";

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const ROOT=path.resolve(__dirname,"..");
const PUBLIC=path.join(ROOT,"public");
const HOST=String(process.env.FNS_HOST||"127.0.0.1");
const PORT=Math.max(1,Number(process.env.PORT||8788));
const OLLAMA=String(process.env.OLLAMA_HOST||"http://127.0.0.1:11434").replace(/\/$/,"");
const EMBED_MODEL=String(process.env.FNS_EMBED_MODEL||DEFAULT_EMBED_MODEL);
const DATA_DIR=path.join(ROOT,".fns-local");
const VECTOR_LOG=path.join(DATA_DIR,"qwen-v2-vector-cache.jsonl");
const MAX_BODY=4*1024*1024;
const LOCAL_BRIDGE_ORIGINS=new Set([
  "https://consciencia-fabiano.focoeepoder2.workers.dev",
  "http://127.0.0.1:8788",
  "http://localhost:8788",
  ...String(process.env.FNS_ALLOWED_ORIGINS||"").split(",").map(x=>x.trim()).filter(Boolean)
]);
const rows=[];
let libraryPromise=null;
let aliasesPromise=null;
const embedCache=new Map();

const MIME={
  ".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".mjs":"text/javascript; charset=utf-8",
  ".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8",".png":"image/png",
  ".jpg":"image/jpeg",".jpeg":"image/jpeg",".svg":"image/svg+xml",".webmanifest":"application/manifest+json; charset=utf-8",
  ".wasm":"application/wasm",".gz":"application/gzip",".txt":"text/plain; charset=utf-8",".md":"text/markdown; charset=utf-8"
};

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
    res.setHeader("Access-Control-Allow-Methods","GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers","Content-Type");
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
        rows.push({...row,key});
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
function ramGb(){return Math.max(1,Math.round(os.totalmem()/1024/1024/1024));}
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
  return {
    max_rows:ctx<=2048?6:ctx<=4096?8:ctx<=8192?10:14,
    max_chars:ctx<=2048?5200:ctx<=4096?11000:ctx<=8192?22000:48000
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
  json(res,{
    ok:true,version:V2_VERSION,service:"Consciência Fabiano v2 Local",
    local_only:true,external_paid_providers:false,
    ollama:{url:"localhost:11434",reachable:models.length>0,installed:models},
    hardware:{ram_gb:ramGb(),recommended:recommendedByHardware(),selected:autoModel(models),context_tokens:contextTokensByHardware()},
    embeddings:{model:EMBED_MODEL,installed:models.includes(EMBED_MODEL)},
    library:lib
  });
}
async function handleDictionary(req,res){
  const body=await readJsonBody(req);
  await loadLibrary();
  const aliases=await loadAliases();
  const result=exactAndMatches(rows,String(body.query||body.question||""),{
    aliases,page:Number(body.page||1),pageSize:Number(body.page_size||50)
  });
  json(res,{ok:true,local_only:true,unlimited_logical_results:true,...result});
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
        page:Number(row?.page||0)||null,
        chunk_index:Number(row?.chunk_index||index),
        text:String(row?.text||"").slice(0,16000),
        reference:String(row?.reference||"")
      })).filter(row=>row.text.trim())
    : [];
  const searchRows=suppliedEvidence.length?suppliedEvidence:rows;

  if(mode==="exact"){
    const result=exactAndMatches(searchRows,question,{aliases,page:1,pageSize:Math.min(100,Number(body.page_size||25))});
    json(res,{...exactPayload(result),evidence_origin:suppliedEvidence.length?"browser-local":"static-local-vault"});return;
  }

  const lexical=lexicalCandidates(searchRows,question,Math.min(100,Math.max(20,Number(body.candidate_limit||70))));
  let evidence=lexical.slice(0,14);
  if(body.semantic!==false && lexical.length){
    evidence=await semanticRerank(question,lexical,14);
  }
  if(mode==="timeline"){
    evidence=[...evidence].sort((a,b)=>{
      const ay=extractTimelineYear(a.text),by=extractTimelineYear(b.text);
      if(ay==null&&by==null)return 0;if(ay==null)return 1;if(by==null)return -1;return ay-by;
    });
  }
  if(!evidence.length){
    json(res,{ok:true,answer:"A biblioteca local não encontrou evidência suficiente para responder a essa pergunta.",matches:[],mode,provider:"local-strict-empty",model:null});
    return;
  }

  const models=await installedModels();
  const requested=String(body.model||"auto");
  const model=requested==="auto"?autoModel(models):chooseInstalledModel(models,requested);
  if(!model){
    json(res,{
      ok:false,code:"LOCAL_MODEL_NOT_INSTALLED",
      error:"Nenhum modelo Qwen de resposta compatível está instalado no Ollama.",
      installed:models,recommended:recommendedByHardware(),
      install:["ollama pull qwen3:1.7b","ollama pull qwen3:4b","ollama pull qwen3:8b","ollama pull qwen3.8:27b"]
    },503);return;
  }

  const preferredContext=contextTokensByHardware();
  const contexts=preferredContext<=2048?[preferredContext,1024]:[preferredContext,Math.max(2048,Math.floor(preferredContext/2))];
  let data=null;
  let usedContext=preferredContext;
  let promptEvidence=fitEvidenceToContext(evidence,preferredContext);
  let lastError=null;

  for(const ctx of [...new Set(contexts)]){
    usedContext=ctx;
    promptEvidence=fitEvidenceToContext(evidence,ctx);
    const prompt=buildPrompt({question,mode,evidence:promptEvidence});
    try{
      data=await fetchOllama("/api/chat",{
        method:"POST",
        body:JSON.stringify({
          model,stream:false,think:false,
          messages:[{role:"user",content:prompt}],
          options:{temperature:0.05,num_ctx:ctx,num_predict:ctx<=2048?384:768}
        })
      },300000);
      lastError=null;
      break;
    }catch(error){
      lastError=error;
      if(!isMemoryAllocationError(error))throw error;
    }
  }

  if(!data && lastError){
    throw Object.assign(new Error(
      "O Qwen local ficou sem memória mesmo no modo econômico. Feche outros programas e tente novamente."
    ),{status:503,code:"LOCAL_MEMORY_EXHAUSTED",cause:lastError});
  }

  const answer=String(data?.message?.content||"").trim();
  json(res,{
    ok:true,answer:answer||"A biblioteca recuperada não foi suficiente para produzir uma resposta.",
    mode,model,provider:"ollama-local",embedding_model:EMBED_MODEL,
    context_tokens:usedContext,evidence_count:promptEvidence.length,
    evidence_origin:suppliedEvidence.length?"browser-local":"static-local-vault",
    matches:promptEvidence.map(r=>({reference:r.reference||publicReference(r),title:r.public_title||"",page:r.page||null,text:r.text||""}))
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

http.createServer(async(req,res)=>{
  localHeaders(req,res);
  try{
    const url=new URL(req.url,"http://localhost");
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
  console.log("LOCAL_URL=http://"+(HOST==="0.0.0.0"?"127.0.0.1":HOST)+":"+PORT);
  console.log("OLLAMA="+OLLAMA);
  console.log("EMBED_MODEL="+EMBED_MODEL);
  console.log("RECOMMENDED_MODEL="+recommendedByHardware());
  console.log("SELECTED_MODEL="+(autoModel(models)||"nenhum instalado"));
  loadLibrary().then(info=>console.log("LOCAL_LIBRARY_CHUNKS="+info.chunks)).catch(()=>{});
});
