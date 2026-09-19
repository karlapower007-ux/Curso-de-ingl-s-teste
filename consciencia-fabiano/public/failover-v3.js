// Consciência do Fabiano V3.0 — lazy-loaded contingency umbrella (Plans B-F)
const PLAN_TIMEOUT_MS=5000;
const STATIC_TOP_K=24;
const STATIC_DIRECT_MAX=1000;
let manifestPromise=null;
let localEnginePromise=null;
let steelIndexPromise=null;

function fold(text){
  return String(text||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase()
    .replace(/[^\p{L}\p{N}\s:]/gu," ").replace(/\s+/g," ").trim();
}
function terms(question){
  const stop=new Set(["a","o","as","os","de","da","do","das","dos","e","em","no","na","nos","nas","um","uma","que","sobre","para","por","com","como","quero","saber","saiba","mostre","mostrar","capitulo","capítulo","completo","inteiro","integral","texto","exato","literal","versiculo","versículo","raw","text","full","chapter","verse"]);
  return [...new Set(fold(question).split(" ").filter(x=>x.length>=3&&!stop.has(x)))].slice(0,18);
}
function withTimeout(promise,ms=PLAN_TIMEOUT_MS){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),ms);
  return {
    signal:controller.signal,
    done:promise(controller.signal).finally(()=>clearTimeout(timer))
  };
}
async function loadManifest(){
  if(!manifestPromise){
    manifestPromise=fetch("/failover-manifest.json",{cache:"no-store"})
      .then(r=>r.ok?r.json():({mirrors:[]})).catch(()=>({mirrors:[]}));
  }
  return manifestPromise;
}
async function loadLocalEngine(){
  if(window.FNSRagCascade) return window.FNSRagCascade;
  if(!localEnginePromise){
    localEnginePromise=import("/rag-cascade.js?v=3.0.0").then(()=>window.FNSRagCascade);
  }
  return localEnginePromise;
}
async function callJson(url,body,timeout=PLAN_TIMEOUT_MS){
  const task=withTimeout(signal=>fetch(url,{
    method:"POST",
    headers:{"Content-Type":"application/json","Accept":"application/json"},
    body:JSON.stringify(body||{}),
    signal
  }),timeout);
  const res=await task.done;
  const data=await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data?.message||data?.error||("HTTP "+res.status));
  return data;
}
async function planB(kind,payload){
  const manifest=await loadManifest();
  const mirrors=Array.isArray(manifest?.mirrors)?manifest.mirrors.filter(x=>x?.enabled!==false&&x?.base_url):[];
  for(const mirror of mirrors){
    const base=String(mirror.base_url||"").replace(/\/$/,"");
    try{
      const path=kind==="direct"?"/api/rag/direct":"/api/chat";
      const data=await callJson(base+path,kind==="direct"?{
        question:payload.question,
        query_embedding:payload.query_embedding||[]
      }:{
        pergunta:payload.question,
        historico:Array.isArray(payload.history)?payload.history.slice(-12):[],
        stream:false
      },Math.max(2500,Number(mirror.timeout_ms||PLAN_TIMEOUT_MS)));
      const text=String(data?.text||data?.resposta||"");
      if((data?.ok!==false)&&text){
        return {
          ok:true,plan:"B",provider:String(mirror.name||"multi-cloud-mirror"),
          answer:text,text,
          sources:Array.isArray(data?.fontes)?data.fontes:[],
          raw:data
        };
      }
    }catch{}
  }
  return {ok:false,plan:"B",code:"NO_ACTIVE_MIRROR"};
}
function deterministicEvidenceAnswer(matches,planLabel){
  const rows=Array.from(matches||[]).slice(0,12);
  if(!rows.length) return "";
  const blocks=rows.map((r,i)=>{
    const name=String(r.title||r.filename||r.arquivo||"Documento");
    const page=Number(r.page||r.pagina||0);
    const text=String(r.text||r.trecho||"").trim().replace(/\s+/g," ").slice(0,1100);
    return "[F"+(i+1)+"] "+name+(page?" — página "+page:"")+"\n"+text;
  });
  return "Modo de contingência documental "+planLabel+" (sem reescrita por IA).\n\n"+blocks.join("\n\n");
}
async function planCLocalAnalytic(payload){
  try{
    const engine=await loadLocalEngine();
    const result=await engine?.search?.(payload.question,null);
    const matches=Array.isArray(result?.matches)?result.matches:[];
    if(!matches.length) return {ok:false,plan:"C",code:"LOCAL_INDEX_EMPTY"};

    const turbines=await import("/local-turbine-pool.js?v=3.1.0");
    const extraction=await turbines.runLocalTurbines({
      question:String(payload.question||""),
      matches,
      onProgress:payload?.on_local_progress
    });
    const cards=Array.isArray(extraction?.cards)?extraction.cards:[];
    if(cards.length){
      return {
        ok:true,
        plan:"C",
        provider:"indexeddb-local-worker-swarm",
        answer:"Modo Offline V3.1: "+cards.length+" trechos relevantes foram extraídos localmente sem IA remota.",
        sources:cards.slice(0,24).map(card=>({
          arquivo:card.filename || card.title,
          titulo:card.title,
          autor:card.author,
          pagina:card.page,
          chunk_index:card.chunk_index,
          document_id:card.document_id,
          score:card.score
        })),
        matches,
        cards,
        virtualized:true,
        offline_intelligence:"bm25+idf+coverage+phrase+proximity",
        logical_capacity:Number(extraction.logical_capacity||1000),
        logical_tasks:Number(extraction.logical_tasks||0),
        physical_workers:Number(extraction.physical_workers||0),
        hardware_concurrency:extraction.hardware_concurrency ?? null,
        main_thread_extraction:false
      };
    }
  }catch(error){
    return {ok:false,plan:"C",code:"LOCAL_TURBINE_POOL_FAILED",message:String(error?.message||error)};
  }
  return {ok:false,plan:"C",code:"LOCAL_INDEX_UNAVAILABLE"};
}
async function planCLocalDirect(payload){
  try{
    const engine=await loadLocalEngine();
    const data=await engine?.directRetrieve?.(payload.question);
    if(data?.ok&&String(data?.text||"")){
      return {...data,ok:true,plan:"C",provider:"indexeddb-local",answer:String(data.text)};
    }
  }catch{}
  return {ok:false,plan:"C",code:"LOCAL_DIRECT_UNAVAILABLE"};
}
async function loadSteelIndex(){
  if(!steelIndexPromise){
    steelIndexPromise=fetch("/steel/index.json",{cache:"no-store"})
      .then(r=>r.ok?r.json():({shards:[]})).catch(()=>({shards:[]}));
  }
  return steelIndexPromise;
}
async function gunzipJson(url){
  const res=await fetch(url,{cache:"force-cache"});
  if(!res.ok) throw new Error("steel "+res.status);
  if(typeof DecompressionStream!=="function") throw new Error("gzip unsupported");
  const stream=res.body.pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(stream).text());
}
async function scanSteel(question){
  const index=await loadSteelIndex();
  const shards=Array.isArray(index?.shards)?index.shards:[];
  const qs=terms(question);
  const best=[];
  for(const shard of shards){
    let rows=[];
    try{rows=await gunzipJson(String(shard.path||""));}catch{continue;}
    for(const row of (Array.isArray(rows)?rows:[])){
      const f=fold(row?.text||"");
      let hit=0,freq=0;
      for(const t of qs){
        if(!f.includes(t))continue;
        hit++;
        let at=0,count=0;
        while((at=f.indexOf(t,at))>=0&&count<10){count++;at+=t.length;}
        freq+=count;
      }
      if(!hit)continue;
      best.push({...row,score:(hit/Math.max(1,qs.length))*5+Math.min(3,freq*.2)});
    }
    best.sort((a,b)=>Number(b.score||0)-Number(a.score||0));
    if(best.length>STATIC_TOP_K*4) best.length=STATIC_TOP_K*2;
  }
  return best.sort((a,b)=>Number(b.score||0)-Number(a.score||0)).slice(0,STATIC_TOP_K);
}
function directIntent(question){
  const raw=String(question||"");
  const q=fold(raw);
  const chapter=q.match(/\b(?:capitulo|chapter)\s+(\d{1,4})\b/);
  const verse=raw.match(/\b(\d{1,4})\s*:\s*(\d{1,4})\b/);
  return {chapter:chapter?Number(chapter[1]):(verse?Number(verse[1]):null),verse:verse?Number(verse[2]):null};
}
function stitch(rows){
  const ordered=Array.from(rows||[]).sort((a,b)=>Number(a.chunk_index||0)-Number(b.chunk_index||0));
  let out="";
  for(const r of ordered){
    const t=String(r.text||"");
    if(!t)continue;
    if(!out){out=t;continue;}
    let overlap=0,max=Math.min(360,out.length,t.length);
    for(let n=max;n>=12;n--){if(out.slice(-n)===t.slice(0,n)){overlap=n;break;}}
    out+=overlap?t.slice(overlap):"\n"+t;
  }
  return out;
}
function chapterSlice(text,n,allowOpenEnd=false){
  if(!n)return null;
  const re=new RegExp("(?:^|\\n)\\s*(?:CAP[ÍI]TULO|CAPITULO|CHAPTER)\\s+"+n+"\\b","im");
  const m=re.exec(text);if(!m)return null;
  let start=m.index;if(text[start]==="\n")start++;
  const tail=m.index+m[0].length;
  const next=new RegExp("(?:^|\\n)\\s*(?:CAP[ÍI]TULO|CAPITULO|CHAPTER)\\s+"+(n+1)+"\\b","im").exec(text.slice(tail));
  if(!next&&!allowOpenEnd)return null;
  return text.slice(start,next?tail+next.index:text.length).replace(/\s+$/,"");
}
function verseSlice(text,v){
  if(!v)return null;
  const re=new RegExp("(^|[\\n\\r]|\\s)"+v+"\\s+(?=[A-ZÁÀÂÃÉÊÍÓÔÕÚÇa-záàâãéêíóôõúç])","mu");
  const m=re.exec(text);if(!m)return null;
  const start=m.index+(m[1]?.length||0);
  const tail=text.slice(start+String(v).length);
  const next=new RegExp("(^|[\\n\\r]|\\s)"+(v+1)+"\\s+(?=[A-ZÁÀÂÃÉÊÍÓÔÕÚÇa-záàâãéêíóôõúç])","mu").exec(tail);
  return text.slice(start,next?start+String(v).length+next.index+(next[1]?.length||0):text.length).replace(/\s+$/,"");
}
async function collectSteelDocument(documentId){
  const index=await loadSteelIndex();
  const shards=Array.isArray(index?.shards)?index.shards:[];
  const rows=[];
  for(const shard of shards){
    let part=[];
    try{part=await gunzipJson(String(shard.path||""));}catch{continue;}
    for(const row of (Array.isArray(part)?part:[])){
      if(String(row?.document_id||"")===String(documentId||"")) rows.push(row);
      if(rows.length>=STATIC_DIRECT_MAX)break;
    }
    if(rows.length>=STATIC_DIRECT_MAX)break;
  }
  return rows.sort((a,b)=>Number(a.chunk_index||0)-Number(b.chunk_index||0));
}
async function planDAnalytic(payload){
  const matches=await scanSteel(payload.question).catch(()=>[]);
  if(!matches.length)return {ok:false,plan:"D",code:"STATIC_DUMP_EMPTY"};
  return {ok:true,plan:"D",provider:"service-worker-static-vault",answer:deterministicEvidenceAnswer(matches,"Plano D"),sources:matches,matches};
}
async function planDDirect(payload){
  const anchors=await scanSteel(payload.question).catch(()=>[]);
  const anchor=anchors[0];
  if(!anchor)return {ok:false,plan:"D",code:"STATIC_DIRECT_ANCHOR_EMPTY"};
  const rows=await collectSteelDocument(anchor.document_id);
  const raw=stitch(rows);
  const intent=directIntent(payload.question);
  let text=raw,scope="raw-document";
  if(intent.chapter){
    text=chapterSlice(raw,intent.chapter,true)||"";
    scope="full-chapter";
  }
  if(text&&intent.verse){
    text=verseSlice(text,intent.verse)||"";
    scope="exact-verse";
  }
  if(!text)return {ok:false,plan:"D",code:"STATIC_BOUNDARY_NOT_FOUND"};
  return {
    ok:true,plan:"D",provider:"service-worker-static-vault",answer:text,text,scope,
    document_id:anchor.document_id,filename:anchor.filename,title:anchor.title,author:anchor.author,page:anchor.page,
    chunks_reassembled:rows.length,bypass_llm:true
  };
}
async function planE(kind,payload){
  const base="http://127.0.0.1:8788";
  try{
    const data=await callJson(base+(kind==="direct"?"/direct":"/search"),{question:payload.question},1400);
    const text=String(data?.text||data?.answer||"");
    if(data?.ok&&text)return {...data,ok:true,plan:"E",provider:"desktop-node",answer:text,text};
  }catch{}
  return {ok:false,plan:"E",code:"DESKTOP_NODE_UNAVAILABLE"};
}
function planF(kind){
  return {
    ok:false,plan:"F",provider:"raw-vault",
    code:"RAW_VAULT_HUMAN_ACCESS",
    answer:"Plano F disponível apenas por acesso humano direto à pasta raw-vault do sistema operativo. Navegadores não podem abrir pastas locais silenciosamente por regras de segurança.",
    kind
  };
}

export async function recoverAnalytic(payload){
  const b=await planB("analytic",payload);if(b.ok)return b;
  const c=await planCLocalAnalytic(payload);if(c.ok)return c;
  const d=await planDAnalytic(payload);if(d.ok)return d;
  const e=await planE("analytic",payload);if(e.ok)return e;
  return planF("analytic");
}
export async function recoverDirect(payload){
  const b=await planB("direct",payload);if(b.ok)return b;
  const c=await planCLocalDirect(payload);if(c.ok)return c;
  const d=await planDDirect(payload);if(d.ok)return d;
  const e=await planE("direct",payload);if(e.ok)return e;
  return planF("direct");
}
export async function warmServiceWorker(){
  if(!("serviceWorker" in navigator))return false;
  try{
    await navigator.serviceWorker.register("/sw-v3.js",{scope:"/"});
    return true;
  }catch{return false;}
}
