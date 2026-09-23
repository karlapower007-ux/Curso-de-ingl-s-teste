const V2_KEY_MODEL="fns_v2_local_model";
const V2_KEY_RESPONSE="fns_v2_response_mode";
const V2_KEY_SPEAK="fns_v2_speak_answers_v1";
const V4_KEY_EXPERIENCE="fns_v4_experience_v1";
let v2SpeechSerial=0;
let v4PiperAudio=null;
let v4PiperObjectUrl="";
let localReady=false;
let browserOnly=false;
let health=null;
let apiBase="";
let dictionaryState={query:"",page:1,pageSize:50,total:0,pages:0};

const $=id=>document.getElementById(id);

function v2SpeakEnabled(){
  const box=$("v2SpeakAnswers");
  if(box)return Boolean(box.checked);
  return localStorage.getItem(V2_KEY_SPEAK)!=="0";
}
function cleanV2Speech(text){
  return String(text||"")
    .replace(/https?:\/\/\S+/gi," ")
    .replace(/\[[0-9]+\]/g," ")
    .replace(/[*_#>~|]/g," ")
    .replace(/\s*\n+\s*/g,". ")
    .replace(/\s{2,}/g," ")
    .trim();
}
function splitV2Speech(text,max=280){
  const sentences=cleanV2Speech(text).split(/(?<=[.!?;:])\s+/u).filter(Boolean);
  const chunks=[];let current="";
  for(const sentence of sentences){
    if((current+" "+sentence).trim().length<=max){current=(current+" "+sentence).trim();continue;}
    if(current)chunks.push(current);
    if(sentence.length<=max){current=sentence;continue;}
    for(let at=0;at<sentence.length;at+=max)chunks.push(sentence.slice(at,at+max));
    current="";
  }
  if(current)chunks.push(current);
  return chunks;
}
async function waitV2Voices(){
  if(!("speechSynthesis" in window))return [];
  let voices=speechSynthesis.getVoices();
  if(voices.length)return voices;
  await Promise.race([
    new Promise(resolve=>speechSynthesis.addEventListener("voiceschanged",resolve,{once:true})),
    new Promise(resolve=>setTimeout(resolve,900))
  ]).catch(()=>{});
  return speechSynthesis.getVoices();
}
function stopV2Speech(){
  v2SpeechSerial++;
  try{window.speechSynthesis?.cancel();}catch{}
  try{v4PiperAudio?.pause();}catch{}
  v4PiperAudio=null;
  if(v4PiperObjectUrl){try{URL.revokeObjectURL(v4PiperObjectUrl);}catch{}v4PiperObjectUrl="";}
  const stop=$("stopAudioBtn");if(stop)stop.disabled=true;
  const state=$("avatarState");if(state&&/Falando/i.test(state.textContent||""))state.textContent="Pronto";
}
async function speakV2Answer(text){
  if(!v2SpeakEnabled()||!("speechSynthesis" in window))return;
  const clean=cleanV2Speech(text);if(!clean)return;
  const serial=++v2SpeechSerial;
  try{speechSynthesis.cancel();speechSynthesis.resume();}catch{}
  const voices=await waitV2Voices();
  const voice=voices.find(v=>/^pt-BR$/i.test(v.lang))||voices.find(v=>/^pt/i.test(v.lang))||null;
  const stop=$("stopAudioBtn");if(stop)stop.disabled=false;
  const state=$("avatarState");if(state)state.textContent="Falando";
  for(const chunk of splitV2Speech(clean,280)){
    if(serial!==v2SpeechSerial)break;
    await new Promise(resolve=>{
      let settled=false;
      let timer=0;
      const done=()=>{if(settled)return;settled=true;clearTimeout(timer);resolve();};
      const utterance=new SpeechSynthesisUtterance(chunk);
      utterance.lang="pt-BR";utterance.rate=0.96;utterance.pitch=1;
      if(voice)utterance.voice=voice;
      utterance.onend=done;utterance.onerror=done;
      timer=setTimeout(done,30000);
      try{speechSynthesis.speak(utterance);}catch{done();}
    });
  }
  if(serial===v2SpeechSerial){
    if(stop)stop.disabled=true;
    if(state)state.textContent="Pronto";
  }
}
async function speakV4Lesson(lesson={}){
  if(!v2SpeakEnabled())return;
  if(apiBase){
    try{
      stopV2Speech();
      const target=apiBase+"/api/v4/tts";
      const res=await fetch(target,{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          ideia:String(lesson?.ideia||""),
          explicacao:Array.isArray(lesson?.explicacao)?lesson.explicacao:[]
        }),
        mode:"cors"
      });
      if(res.ok && /audio\/wav/i.test(String(res.headers.get("Content-Type")||""))){
        const blob=await res.blob();
        v4PiperObjectUrl=URL.createObjectURL(blob);
        v4PiperAudio=new Audio(v4PiperObjectUrl);
        const stop=$("stopAudioBtn");if(stop)stop.disabled=false;
        const state=$("avatarState");if(state)state.textContent="Falando";
        await new Promise((resolve,reject)=>{
          v4PiperAudio.onended=resolve;
          v4PiperAudio.onerror=reject;
          v4PiperAudio.play().catch(reject);
        });
        if(v4PiperObjectUrl){try{URL.revokeObjectURL(v4PiperObjectUrl);}catch{}v4PiperObjectUrl="";}
        v4PiperAudio=null;
        if(stop)stop.disabled=true;
        if(state)state.textContent="Pronto";
        return;
      }
    }catch{}
  }
  return speakV2Answer(lesson?.speech_text||[lesson?.ideia,...(lesson?.explicacao||[])].filter(Boolean).join(". "));
}

function initV2Voice(){
  const box=$("v2SpeakAnswers");
  if(box){
    box.checked=localStorage.getItem(V2_KEY_SPEAK)!=="0";
    box.addEventListener("change",()=>{
      localStorage.setItem(V2_KEY_SPEAK,box.checked?"1":"0");
      if(!box.checked)stopV2Speech();
    });
  }
  try{window.speechSynthesis?.getVoices();}catch{}
}
function selectedModel(){return String(localStorage.getItem(V2_KEY_MODEL)||"auto");}
function selectedResponse(){const v=String(localStorage.getItem(V2_KEY_RESPONSE)||"explain");return ["short","explain","compare","timeline","exact"].includes(v)?v:"explain";}
function selectedExperience(){const v=String(localStorage.getItem(V4_KEY_EXPERIENCE)||"livro");return ["livro","aula","revisao"].includes(v)?v:"livro";}
function resolvedModelForRequest(){
  const chosen=selectedModel();
  if(chosen!=="auto")return chosen;
  const selected=String(health?.hardware?.selected||"").trim();
  if(selected)return selected;
  const installed=Array.isArray(health?.ollama?.installed)?health.ollama.installed.map(String):[];
  for(const candidate of ["qwen3:0.6b","qwen3:1.7b","qwen3:4b","qwen3:8b","qwen3.8:27b"]){
    if(installed.includes(candidate))return candidate;
  }
  return "auto";
}

function createOption(value,label){const o=document.createElement("option");o.value=value;o.textContent=label;return o;}
function addControls(){
  const options=document.querySelector(".composer-options");
  if(!options||$("v2Model"))return;

  const modelLabel=document.createElement("label");
  modelLabel.className="mode-option v2-control";
  modelLabel.htmlFor="v2Model";
  const modelTitle=document.createElement("span");modelTitle.textContent="Cérebro";
  const model=document.createElement("select");model.id="v2Model";model.setAttribute("aria-label","Modelo local");
  [
    ["auto","Local (grátis) • automático"],
    ["qwen3.8:27b","Qwen 3.8 • 27B"],
    ["qwen3:8b","Qwen 3 • 8B"],
    ["qwen3:4b","Qwen 3 • 4B"],
    ["qwen3:1.7b","Qwen 3 • 1.7B"],
    ["qwen3:0.6b","Qwen 3 • 0.6B"]
  ].forEach(x=>model.appendChild(createOption(...x)));
  model.value=selectedModel();
  model.onchange=()=>{localStorage.setItem(V2_KEY_MODEL,model.value);updateV2Status();};
  modelLabel.append(modelTitle,model);

  const experienceLabel=document.createElement("label");
  experienceLabel.className="mode-option v2-control";
  experienceLabel.htmlFor="v4Experience";
  const experienceTitle=document.createElement("span");experienceTitle.textContent="Experiência";
  const experience=document.createElement("select");experience.id="v4Experience";experience.setAttribute("aria-label","Experiência de estudo");
  [
    ["livro","Livro"],
    ["aula","Aula"],
    ["revisao","Revisão"]
  ].forEach(x=>experience.appendChild(createOption(...x)));
  experience.value=selectedExperience();
  experience.onchange=()=>{localStorage.setItem(V4_KEY_EXPERIENCE,experience.value);updateV2Status();};
  experienceLabel.append(experienceTitle,experience);

  const responseLabel=document.createElement("label");
  responseLabel.className="mode-option v2-control";
  responseLabel.htmlFor="v2ResponseMode";
  const responseTitle=document.createElement("span");responseTitle.textContent="Resposta";
  const response=document.createElement("select");response.id="v2ResponseMode";response.setAttribute("aria-label","Modo de resposta");
  [
    ["short","Resposta curta"],
    ["explain","Explicação exata"],
    ["compare","Comparar fontes"],
    ["timeline","Linha do tempo"],
    ["exact","Citação exata • zero LLM"]
  ].forEach(x=>response.appendChild(createOption(...x)));
  response.value=selectedResponse();
  response.onchange=()=>{localStorage.setItem(V2_KEY_RESPONSE,response.value);updateV2Status();};
  responseLabel.append(responseTitle,response);

  const status=document.createElement("span");status.id="v2LocalStatus";status.className="mode-status v2-local-status";status.textContent="Detectando cérebro local…";
  const prepare=document.createElement("button");prepare.id="v2PrepareBrain";prepare.type="button";prepare.className="ghost small-btn";prepare.textContent="Preparar cérebro local";
  prepare.addEventListener("click",prepareBrain);

  options.prepend(status);
  options.prepend(responseLabel);
  options.prepend(experienceLabel);
  options.prepend(modelLabel);
  options.appendChild(prepare);

  const settings=document.querySelector(".settings-grid");
  if(settings){
    const info=document.createElement("div");info.className="v2-settings-card";
    info.innerHTML="<strong>Consciência Fabiano v2 • Local-first</strong><p id=\"v2SettingsInfo\">Ollama local + Qwen. A biblioteca v10.1 permanece preservada e os vetores Qwen são criados em paralelo.</p>";
    settings.appendChild(info);
  }
}
function browserDeterministicAnswer(mode,question,evidence=[]){
  const rows=(evidence||[]).filter(x=>String(x?.text||"").trim()).slice(0,mode==="short"?3:12);
  if(!rows.length)return "A biblioteca local não encontrou evidência suficiente para responder a essa pergunta.";
  const ref=row=>String(row?.reference||row?.title||"Fonte local").trim()||"Fonte local";
  if(mode==="short"){
    return rows.map((row,i)=>"["+(i+1)+"] "+String(row.text||"").trim()+"\n"+ref(row)).join("\n\n");
  }
  if(mode==="timeline"){
    const dated=[],undated=[];
    for(const row of rows){
      const years=String(row.text||"").match(/\b(?:1[5-9]\d{2}|20\d{2}|21\d{2})\b/g);
      if(years?.length)dated.push({year:Math.min(...years.map(Number)),row});else undated.push(row);
    }
    dated.sort((a,b)=>a.year-b.year);
    const parts=dated.map(({year,row})=>String(year)+" — "+String(row.text||"").trim()+"\n"+ref(row));
    if(undated.length)parts.push("Data não identificada\n"+undated.map(row=>String(row.text||"").trim()+"\n"+ref(row)).join("\n\n"));
    return parts.join("\n\n");
  }
  if(mode==="compare"){
    const groups=new Map();
    for(const row of rows){const key=ref(row);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
    return [...groups.entries()].map(([source,items])=>source+"\n"+items.slice(0,3).map(x=>"• "+String(x.text||"").trim()).join("\n")).join("\n\n");
  }
  return "Resposta determinística local — sem LLM\n\n"+rows.map((row,i)=>"["+(i+1)+"] "+String(row.text||"").trim()+"\n"+ref(row)).join("\n\n");
}
function lessonDisplayText(data={}){
  if(data?.nao_sei)return data?.guard==="adulto"
    ?String(data.ideia||"")+"\n\n"+String(data.pergunta||"")
    :"Não achei na biblioteca.";
  const proofs=(data.provas||[]).map((p,i)=>"Prova "+(i+1)+": "+String(p.ref||"")+"\n"+String(p.trecho||"")).join("\n\n");
  return [
    String(data.ideia||""),
    proofs,
    ...(data.explicacao||[]).map(String),
    "Entendeu? "+String(data.pergunta||"")
  ].filter(Boolean).join("\n\n");
}
function appendMessage(role,content,sources=[]){
  const host=$("messages");if(!host)return;
  const wrap=document.createElement("div");wrap.className="msg "+role+" v2-msg";
  const text=document.createElement("div");text.className="v2-answer-text";text.textContent=String(content||"");
  wrap.appendChild(text);
  if(role==="assistant"&&sources?.length){
    const src=document.createElement("div");src.className="sources";
    const seen=new Set();
    for(const item of sources){
      const ref=String(item?.reference||"").trim();if(!ref||seen.has(ref))continue;seen.add(ref);
      const row=document.createElement("div");row.className="source";row.textContent=ref;src.appendChild(row);
    }
    if(src.childElementCount)wrap.appendChild(src);
  }
  host.appendChild(wrap);host.scrollTop=host.scrollHeight;
}

function appendEvidenceDigest(rows=[]){
  const items=(rows||[]).filter(x=>String(x?.text||"").trim()).slice(0,8);
  if(!items.length)return;
  const host=$("messages");if(!host)return;
  const messages=host.querySelectorAll(".msg.assistant.v2-msg");
  const wrap=messages[messages.length-1];if(!wrap)return;
  const details=document.createElement("details");details.className="sources v2-evidence-digest";details.open=true;
  const summary=document.createElement("summary");summary.textContent="Evidências adicionais da biblioteca ("+items.length+")";
  details.appendChild(summary);
  const seen=new Set();
  for(const item of items){
    const ref=String(item?.reference||"Fonte").trim()||"Fonte";
    const text=String(item?.text||"").replace(/\s+/g," ").trim();
    const key=ref+"|"+text;if(seen.has(key))continue;seen.add(key);
    const row=document.createElement("div");row.className="source";
    const strong=document.createElement("strong");
    strong.textContent=(item?.citation_verified===true?"✓ Fonte verificada — ":"")+ref;
    const excerpt=document.createElement("div");excerpt.textContent=text;
    row.append(strong,excerpt);details.appendChild(row);
  }
  wrap.appendChild(details);host.scrollTop=host.scrollHeight;
}
function setBusy(on,label=""){
  const send=$("sendBtn");if(send)send.disabled=on;
  const state=$("avatarState");if(state&&label)state.textContent=label;
}
async function call(path,body,timeout=300000){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
  const target=(apiBase&&/^\/api\/v[234]\//.test(String(path)))?apiBase+path:path;
  try{
    const res=await fetch(target,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),signal:controller.signal,mode:"cors"});
    const data=await res.json().catch(()=>({}));
    if(!res.ok||data?.ok===false)throw Object.assign(new Error(data?.error||("HTTP "+res.status)),{data,status:res.status});
    return data;
  }finally{clearTimeout(timer);}
}
async function sendLocal(){
  const input=$("questionInput"),q=String(input?.value||"").trim();if(!q)return;
  const mode=selectedResponse(),model=resolvedModelForRequest(),experience=selectedExperience();
  const lowRam=Number(health?.hardware?.ram_gb||navigator.deviceMemory||4)<=5;
  try{window.speechSynthesis?.resume();window.speechSynthesis?.getVoices();}catch{}
  appendMessage("user",q);input.value="";setBusy(true,mode==="exact"?"Buscando citação literal…":"Consultando Evidence Engine V3…");
  try{
    if(apiBase){
      if(experience==="aula"||experience==="revisao"){
        const lesson=await call("/api/v4/lesson",{
          question:q,
          age:null,
          mode:experience
        },300000);
        const proofSources=(lesson.provas||[]).map(p=>({
          reference:p.ref,
          text:p.trecho,
          citation_verified:p.verified===true
        }));
        const rendered=lessonDisplayText(lesson);
        appendMessage("assistant",rendered,proofSources);
        speakV4Lesson(lesson).catch(()=>{});
        const backend=$("backendText");
        if(backend)backend.textContent="v4 Aula • 1 ideia • até 3 provas verificadas • Qwen sem autoridade de fonte";
        const dot=$("backendDot");if(dot)dot.className="dot ok";
        const state=$("avatarState");if(state)state.textContent="Pronto";
        return;
      }

      const data=await call("/api/v3/chat",{
        question:q,
        mode,
        model,
        allow_query_expansion:true
      },300000);
      appendMessage("assistant",data.answer||"",data.matches||[]);
      speakV2Answer(data.speech_text||data.answer||"").catch(()=>{});
      const backend=$("backendText");
      if(backend)backend.textContent="v3 Evidence Engine • índice paralelo • Dicionário V2 congelado • Qwen só amplia a busca";
      const dot=$("backendDot");if(dot)dot.className="dot ok";
      const state=$("avatarState");if(state)state.textContent="Pronto";
      return;
    }

    let engine=null,localState=null,evidence=[];
    try{
      const mod=await import("/v2-local-engine.js");
      engine=mod.FNSV2LocalEngine;
      localState=await engine.counts();
    }catch{}

    if(mode==="exact"&&engine&&Number(localState?.chunks||0)>0&&!apiBase){
      const exact=await engine.exactSearch(q,{page:1,pageSize:25});
      const answer=engine.formatExact(exact.matches||[]);
      appendMessage("assistant",answer,exact.matches||[]);
      speakV2Answer(answer).catch(()=>{});
      const backend=$("backendText");if(backend)backend.textContent="v2 local • Citação exata no acervo deste aparelho • zero LLM";
      const dot=$("backendDot");if(dot)dot.className="dot ok";
      const state=$("avatarState");if(state)state.textContent="Pronto";
      return;
    }


    if(engine&&Number(localState?.chunks||0)>0){
      try{
        const lexical=await engine.lexicalSearch(q,lowRam?90:70);
        let semantic=[];
        if(!lowRam&&Number(localState?.qwen_vectors||0)>0){
          try{semantic=await engine.semanticSearch(q,30);}catch{}
        }
        const merged=new Map();
        for(const row of [...semantic,...lexical]){
          const key=String(row?.key||row?.id||row?.document_id+":"+String(row?.chunk_index||0));
          if(key&&!merged.has(key))merged.set(key,row);
        }
        evidence=[...merged.values()].slice(0,90);
      }catch{}
    }
    if(browserOnly&&!apiBase){
      const answer=browserDeterministicAnswer(mode,q,evidence);
      appendMessage("assistant",answer,evidence);
      speakV2Answer(answer).catch(()=>{});
      const backend=$("backendText");if(backend)backend.textContent="v2 navegador • resposta determinística local • zero LLM";
      const dot=$("backendDot");if(dot)dot.className="dot ok";
      const state=$("avatarState");if(state)state.textContent="Pronto";
      return;
    }

    const outboundEvidence=evidence.slice(0,lowRam?24:90);
    const data=await call("/api/v2/chat",{
      question:q,mode,model,grounded:mode!=="exact",semantic:false,page_size:25,
      candidate_limit:lowRam?60:70,
      evidence:outboundEvidence.map(r=>({
        id:r.id||r.key,
        document_id:r.document_id||r.doc_key,
        title:r.title||"",
        source_title:r.source_title||"",
        filename:r.filename||"",
        canonical_reference:r.canonical_reference||"",
        page:r.page||null,
        chunk_index:r.chunk_index||0,
        text:r.text||"",
        reference:r.reference||""
      }))
    },lowRam?210000:300000);
    appendMessage("assistant",data.answer||"",data.matches||[]);
    appendEvidenceDigest(data.evidence_digest||[]);
    speakV2Answer(data.speech_text||data.answer||"").catch(()=>{});
    const backend=$("backendText");if(backend)backend.textContent=mode==="exact"
      ?"v2 local • Citação exata • zero LLM"
      :data.provider==="grounded-exact-no-llm"
        ?"v2 local • Grounded Exact • somente evidências da biblioteca • zero invenções"
        :"v2 local • "+String(data.model||"Qwen")+" • "+String(data.embedding_model||"busca lexical")+" • "+(evidence.length?"acervo deste aparelho":"cofre local");
    const dot=$("backendDot");if(dot)dot.className="dot ok";
    const state=$("avatarState");if(state)state.textContent="Pronto";
  }catch(error){
    const msg=String(error?.message||error);
    const timedOut=/abort|aborted|timeout|tempo/i.test(msg);
    if(timedOut && evidence.length){
      const answer=browserDeterministicAnswer(mode,q,evidence.slice(0,8));
      const fallbackText="O Qwen demorou além do limite neste computador. Usei a contingência local com as evidências recuperadas:\n\n"+answer;
      appendMessage("assistant",fallbackText,evidence.slice(0,8));
      speakV2Answer(fallbackText).catch(()=>{});
      const state=$("avatarState");if(state)state.textContent="Pronto • contingência local";
      const backend=$("backendText");if(backend)backend.textContent="v2 local • contingência determinística após timeout do Qwen";
    }else{
      const info=error?.data;
      const extra=Array.isArray(info?.install)&&info.install.length?"\n\nInstale um modelo local:\n"+info.install.join("\n"):"";
      appendMessage("assistant","Não foi possível usar o cérebro local: "+msg+extra,[]);
      const state=$("avatarState");if(state)state.textContent="Cérebro local indisponível";
    }
  }finally{setBusy(false);}
}
function renderDictionary(data){
  const host=$("dictionaryResults"),pager=$("dictionaryPager");if(!host||!pager)return;
  host.replaceChildren();
  const concepts=Array.isArray(data?.concepts)?data.concepts:[];
  for(const hit of (data?.matches||[])){
    const card=document.createElement("article");card.className="dictionary-result v2-dictionary-result";
    const head=document.createElement("div");head.className="dictionary-result-head";
    const ref=document.createElement("strong");ref.textContent=String(hit.reference||hit.title||"Fonte");
    const page=document.createElement("span");page.className="dictionary-result-ref";page.textContent=hit.page?"página "+hit.page:"";
    head.append(ref,page);
    const body=document.createElement("div");body.className="dictionary-result-text";body.textContent=String(hit.text||"");
    const alias=document.createElement("small");alias.className="dictionary-source";
    const aliases=Array.isArray(hit.aliases)?hit.aliases.filter(Boolean):[];
    alias.textContent=aliases.length?"Aliases confirmados no bloco: "+aliases.join(" • "):"Correspondência strict AND no mesmo bloco.";
    card.append(head,body,alias);host.appendChild(card);
  }
  dictionaryState.total=Number(data?.total||0);dictionaryState.pages=Number(data?.pages||0);
  const info=$("dictionaryPageInfo");if(info)info.textContent="Página "+dictionaryState.page+" de "+Math.max(1,dictionaryState.pages)+" • "+dictionaryState.total+" ocorrência(s) • sem teto lógico";
  const prev=$("dictionaryPrev"),next=$("dictionaryNext");
  if(prev)prev.disabled=dictionaryState.page<=1;if(next)next.disabled=dictionaryState.page>=dictionaryState.pages;
  pager.classList.toggle("hidden",dictionaryState.total===0);
  const conceptHost=$("dictionaryConcept");
  if(conceptHost){
    conceptHost.replaceChildren();
    if(concepts.length){
      const title=document.createElement("strong");title.textContent=concepts.map(x=>x.label).join(" + ");
      const p=document.createElement("p");p.textContent="Todos os conceitos são exigidos no mesmo bloco. Aliases: "+concepts.map(x=>(x.aliases||[]).join(" / ")).join(" • ");
      conceptHost.append(title,p);conceptHost.classList.remove("hidden");
    }else conceptHost.classList.add("hidden");
  }
}
async function searchDictionary(reset=true){
  const input=$("dictionaryInput"),q=String(input?.value||"").trim();if(!q)return;
  if(reset||dictionaryState.query!==q)dictionaryState.page=1;
  dictionaryState.query=q;
  const status=$("dictionaryStatus");if(status)status.textContent="Busca strict AND local em toda a biblioteca…";
  const btn=$("dictionarySearchBtn");if(btn)btn.disabled=true;
  try{
    let data=null;
    try{
      const mod=await import("/v2-local-engine.js");
      const state=await mod.FNSV2LocalEngine.counts();
      if(Number(state?.chunks||0)>0){
        data=await mod.FNSV2LocalEngine.exactSearch(q,{page:dictionaryState.page,pageSize:dictionaryState.pageSize});
      }
    }catch{}
    if(!data){
      data=await call("/api/v2/dictionary",{query:q,page:dictionaryState.page,page_size:dictionaryState.pageSize},120000);
    }
    renderDictionary(data);
    if(status)status.textContent=data.total
      ?"v2 local • "+data.total+" ocorrência(s) exata(s) no mesmo bloco • sem teto lógico."
      :"Nenhuma correspondência em que todos os conceitos estejam no mesmo bloco.";
  }catch(error){if(status)status.textContent="Busca local v2 indisponível: "+String(error?.message||error);}
  finally{if(btn)btn.disabled=false;}
}
async function probe(){
  browserOnly=false;
  apiBase="";
  health=null;
  const candidates=[
    {base:"",url:"/api/v2/health"},
    {base:"http://127.0.0.1:8788",url:"http://127.0.0.1:8788/api/v2/health"},
    {base:"http://localhost:8788",url:"http://localhost:8788/api/v2/health"}
  ];
  for(const candidate of candidates){
    try{
      const res=await fetch(candidate.url,{cache:"no-store",mode:"cors"});
      const data=await res.json().catch(()=>null);
      if(res.ok&&data?.ok&&data?.local_only){
        apiBase=candidate.base;
        window.__FNS_V2_API_BASE=apiBase;
        localReady=true;
        health=data;
        updateV2Status();
        return;
      }
    }catch{}
  }
  try{
    const mod=await import("/v2-local-engine.js");
    const state=await mod.FNSV2LocalEngine.counts();
    browserOnly=Number(state?.chunks||0)>0;
    localReady=browserOnly;
    window.__FNS_V2_API_BASE="";
    health=browserOnly?{ok:true,local_only:true,browser_only:true,ollama:{reachable:false},embeddings:{installed:Number(state?.qwen_vectors||0)>0},library:{chunks:state.chunks}}:null;
  }catch{localReady=false;health=null;}
  updateV2Status();
}
function updateV2Status(){
  const el=$("v2LocalStatus");if(!el)return;
  if(!localReady){el.textContent="v2 local não detectada • v10.1 continua disponível";el.classList.remove("ok");return;}
  const ollama=Boolean(health?.ollama?.reachable),embed=Boolean(health?.embeddings?.installed);
  const model=selectedModel()==="auto"?String(health?.hardware?.selected||health?.hardware?.recommended||"auto"):selectedModel();
  el.textContent=browserOnly
    ?"Local no navegador • biblioteca offline • respostas determinísticas sem LLM"
    :(apiBase?"Ollama local conectado • ":"Local grátis • ")+(ollama?model:"sem LLM • fallback determinístico")+" • embeddings "+(embed?"Qwen prontos":"Qwen pendentes");
  el.classList.toggle("ok",browserOnly||ollama);
  const settings=$("v2SettingsInfo");
  if(settings)settings.textContent="RAM detectada: "+String(health?.hardware?.ram_gb||"?")+" GB • recomendado: "+String(health?.hardware?.recommended||"?")+" • biblioteca local: "+String(health?.library?.chunks||0)+" chunks.";
}
async function prepareBrain(){
  if(!localReady){await probe();if(!localReady)return;}
  const btn=$("v2PrepareBrain");if(btn){btn.disabled=true;btn.textContent="Preparando…";}
  try{
    const mod=await import("/v2-local-engine.js");
    let state=await mod.FNSV2LocalEngine.counts();
    const status=$("v2LocalStatus");
    let previous=-1,stalls=0;
    while(state.pending>0){
      state=await mod.FNSV2LocalEngine.prepare({batches:1,batchSize:Number(navigator.deviceMemory||4)<=4?8:24,mirror:true});
      if(status)status.textContent="Embeddings Qwen v2: "+state.qwen_vectors+"/"+state.chunks+" • faltam "+state.pending;
      if(Number(state.qwen_vectors||0)===previous)stalls++;else stalls=0;
      previous=Number(state.qwen_vectors||0);
      if(stalls>=3)throw new Error("A preparação não avançou após três tentativas; verifique se qwen3-embedding:0.6b está instalado no Ollama.");
      await new Promise(r=>setTimeout(r,10));
    }
    if(status)status.textContent="Cérebro local preparado • "+state.qwen_vectors+" vetores Qwen v2";
  }catch(error){
    const status=$("v2LocalStatus");if(status)status.textContent="Preparação interrompida: "+String(error?.message||error);
  }finally{if(btn){btn.disabled=false;btn.textContent="Preparar cérebro local";}}
}
function installCapture(){
  document.addEventListener("click",event=>{
    const id=event.target?.id;
    if(id==="stopAudioBtn"){event.preventDefault();event.stopImmediatePropagation();stopV2Speech();return;}
    if(!localReady)return;
    if(id==="sendBtn"){event.preventDefault();event.stopImmediatePropagation();sendLocal();return;}
    if(id==="dictionarySearchBtn"){event.preventDefault();event.stopImmediatePropagation();searchDictionary(true);return;}
    if(id==="dictionaryPrev"&&dictionaryState.page>1){event.preventDefault();event.stopImmediatePropagation();dictionaryState.page--;searchDictionary(false);return;}
    if(id==="dictionaryNext"&&dictionaryState.page<dictionaryState.pages){event.preventDefault();event.stopImmediatePropagation();dictionaryState.page++;searchDictionary(false);return;}
  },true);
  document.addEventListener("keydown",event=>{
    if(!localReady||event.key!=="Enter"||event.shiftKey)return;
    if(event.target?.id==="questionInput"){event.preventDefault();event.stopImmediatePropagation();sendLocal();}
    if(event.target?.id==="dictionaryInput"){event.preventDefault();event.stopImmediatePropagation();searchDictionary(true);}
  },true);
}

addControls();
initV2Voice();
installCapture();
probe();
setInterval(probe,15000);
