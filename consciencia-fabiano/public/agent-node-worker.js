// V7.0 TWENTY AGENT MESH — 20 logical specialists, one bounded worker runtime.
import {strictParagraphMatch,deriveStrictPhrase,paragraphBlocks,extractSemanticReference,normalizeStrictText} from "/strict-match-core.js?v=7.0.0";

const CONTEXT_BEFORE=2;
const CONTEXT_AFTER=4;

function fold(text){
  return String(text||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase()
    .replace(/[^\p{L}\p{N}\s:–—-]/gu," ").replace(/\s+/g," ").trim();
}
function queryTerms(question){
  const stop=new Set(["a","o","as","os","de","da","do","das","dos","e","em","no","na","nos","nas","um","uma","que","sobre","para","por","com","como","quero","saber","saiba","mostre","mostrar","qual","quais","quem","onde","quando","porque","porquê","ser","estar","foi","era","the","and","of","to","in","on"]);
  return [...new Set(fold(question).split(" ").filter(t=>t.length>=3&&!stop.has(t)))].slice(0,28);
}
function coverage(text,question){
  const terms=queryTerms(question); if(!terms.length)return 0;
  const f=fold(text); let hit=0;
  for(const t of terms)if(f.includes(t))hit++;
  return hit/terms.length;
}
function docHash(row){
  const s=String(row?.document_id||row?.filename||row?.title||"");
  let h=2166136261;
  for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}
  return Math.abs(h>>>0);
}
function expandWindow(text,question,strictIndex=null){
  const blocks=paragraphBlocks(text);
  if(!blocks.length)return {text:"",start:0,end:0,target:0};
  let target=Number.isFinite(Number(strictIndex))&&Number(strictIndex)>=0?Number(strictIndex):-1;
  if(target<0){
    let best=-1,bestScore=-1;
    for(let i=0;i<blocks.length;i++){
      const c=coverage(blocks[i],question);
      if(c>bestScore){bestScore=c;best=i;}
    }
    target=Math.max(0,best);
  }
  if(blocks.length<=1)return {text:String(text||""),start:0,end:0,target,full_chunk:true};
  const start=Math.max(0,target-CONTEXT_BEFORE);
  const end=Math.min(blocks.length-1,target+CONTEXT_AFTER);
  return {text:blocks.slice(start,end+1).join("\n\n"),start,end,target,full_chunk:false};
}
function sameReference(question,text){
  const qRef=extractSemanticReference(question);
  if(!qRef)return {ok:true,query_reference:"",text_reference:extractSemanticReference(text)||""};
  const tRef=extractSemanticReference(text);
  return {
    ok:Boolean(tRef)&&normalizeStrictText(tRef)===normalizeStrictText(qRef),
    query_reference:qRef,
    text_reference:tRef||""
  };
}
function dedupe(rows){
  const seen=new Set(),out=[];
  for(const row of rows||[]){
    const key=String(row?.id||row?.key||"")||[row?.document_id||"",row?.chunk_index||0,fold(row?.text||"").slice(0,260)].join("|");
    if(seen.has(key))continue;seen.add(key);out.push(row);
  }
  return out;
}
function literalAgent(payload){
  const out=[];
  for(const row of payload.literal||payload.candidates||[]){
    const m=strictParagraphMatch(row?.text||"",payload.question||"");
    if(!m.matched)continue;
    out.push({...row,agent_literal:true,strict_phrase:m.target,strict_paragraph_index:m.paragraph_index,agent_votes:["literal"]});
  }
  return {rows:dedupe(out),meta:{agent:1,name:"The Literal",mode:"strict-phrase"}};
}
function semanticAgent(payload){
  const rows=(payload.semantic||[]).filter(r=>Number(r?.score||0)>=0.62).map(r=>({
    ...r,agent_semantic:true,semantic_score:Number(r?.score||0),agent_votes:["semantic"]
  }));
  return {rows:dedupe(rows),meta:{agent:2,name:"The Semantic",mode:"transformers-minilm-candidate"}};
}
function contextualizer(payload){
  const rows=(payload.candidates||[]).map(row=>{
    const w=expandWindow(row?.text||"",payload.question||"",row?.strict_paragraph_index);
    return {...row,text:w.text,context_window_start:w.start,context_window_end:w.end,target_paragraph_index:w.target,full_chunk_fallback:Boolean(w.full_chunk),agent_votes:[...(row.agent_votes||[]),"context"]};
  }).filter(r=>String(r.text||"").trim());
  return {rows:dedupe(rows),meta:{agent:3,name:"The Contextualizer",mode:"window-2-plus-4"}};
}
function referenceJudge(payload){
  const rows=[];
  for(const row of payload.candidates||[]){
    const judge=sameReference(payload.question||"",row?.text||"");
    if(!judge.ok)continue;
    rows.push({...row,canonical_reference:judge.text_reference||extractSemanticReference(row.text)||"",query_reference:judge.query_reference,agent_votes:[...(row.agent_votes||[]),"reference"]});
  }
  return {rows:dedupe(rows),meta:{agent:4,name:"The Reference Judge",mode:"canonical-reference-gate"}};
}
function sweeper(payload,role){
  const bucket=role-5;
  const rows=(payload.candidates||[]).filter(row=>(docHash(row)%5)===bucket).map(row=>({
    ...row,sweeper_id:role,agent_votes:[...(row.agent_votes||[]),"sweeper-"+role]
  }));
  return {rows:dedupe(rows),meta:{agent:role,name:"The Sweeper "+role,mode:"document-partition-"+bucket}};
}
function bouncer(payload){
  const literalExists=Boolean(payload.literal_exists);
  const qRef=extractSemanticReference(payload.question||"");
  const rows=[];
  for(const row of payload.candidates||[]){
    const literal=row.agent_literal===true || strictParagraphMatch(row?.text||"",payload.question||"").matched;
    const sem=Number(row?.semantic_score||row?.score||0);
    const cov=coverage(row?.text||"",payload.question||"");
    const ref=sameReference(payload.question||"",row?.text||"");
    let accepted=false,reason="";
    if(literal){accepted=true;reason="literal-exact";}
    else if(!literalExists && !qRef && row.agent_semantic===true && sem>=0.72 && cov>=0.50){
      accepted=true;reason="semantic-consensus";
    }
    if(!ref.ok){accepted=false;reason="reference-mismatch";}
    if(!accepted)continue;
    const canonical=extractSemanticReference(row?.text||"")||"";
    rows.push({
      ...row,
      score:literal?100:Math.min(99,Math.round(sem*10000)/100),
      coverage:literal?1:cov,
      exact_match:literal,
      semantic_fallback:!literal,
      bouncer_reason:reason,
      canonical_reference:canonical,
      semantic_title:canonical||String(row?.title||row?.filename||"Documento"),
      agent_votes:[...(row.agent_votes||[]),"bouncer"]
    });
  }
  rows.sort((a,b)=>Number(b.exact_match)-Number(a.exact_match)||Number(b.score||0)-Number(a.score||0));
  return {rows:dedupe(rows),meta:{agent:10,name:"The Bouncer",mode:"final-evidence-gate",literal_exists:literalExists}};
}

function significantTerms(question){
  return queryTerms(question).filter(Boolean);
}
function isShortEntityQuery(question){
  const terms=significantTerms(question);
  return terms.length>=1 && terms.length<=2 && String(question||"").trim().split(/\s+/).length<=4;
}
function isLongExplainQuery(question){
  const q=fold(question);
  const terms=significantTerms(question);
  return terms.length>=3 || /\b(?:explique|explica|me fale|fale mais|fale sobre|como funciona|o que significa|doutrina|conceito|explain|tell me about)\b/i.test(q);
}
function escapeRe(s){return String(s||"").replace(/[.*+?^$()|[\]\\]/g,"\\self.onmessage=event=>{");}
function tokenBoundaryIncludes(text,token){
  const f=fold(text),t=fold(token);
  if(!t)return false;
  return new RegExp("(^|\\s)"+escapeRe(t)+"(?=\\s|$)","u").test(f);
}
function shortEntityAgent(payload){
  const terms=significantTerms(payload.question||"");
  if(!isShortEntityQuery(payload.question||""))return {rows:[],meta:{agent:11,name:"Short Entity Hunter",active:false}};
  const rows=(payload.candidates||[]).filter(row=>terms.every(t=>tokenBoundaryIncludes(row?.text||"",t))).map(row=>({
    ...row,mission_short_entity:true,agent_votes:[...(row.agent_votes||[]),"short-entity"]
  }));
  return {rows:dedupe(rows),meta:{agent:11,name:"Short Entity Hunter",mode:"exact-short-entity",active:true}};
}
function longExplainAgent(payload){
  if(!isLongExplainQuery(payload.question||""))return {rows:[],meta:{agent:12,name:"Long Form Explainer",active:false}};
  const rows=(payload.candidates||[]).map(row=>{
    const w=expandWindow(row?.text||"",payload.question||"",row?.target_paragraph_index);
    return {...row,text:w.text,mission_long_explain:true,explanation_depth:Math.min(5,2+Math.round(coverage(w.text,payload.question)*3)),agent_votes:[...(row.agent_votes||[]),"long-explain"]};
  });
  return {rows:dedupe(rows),meta:{agent:12,name:"Long Form Explainer",mode:"deep-context",active:true}};
}
function freshnessAgent(payload){
  const rows=[...(payload.candidates||[])].sort((a,b)=>Number(Date.parse(b?.updated_at||0)||0)-Number(Date.parse(a?.updated_at||0)||0)).map(row=>({
    ...row,mission_freshness:true,agent_votes:[...(row.agent_votes||[]),"freshness"]
  }));
  return {rows:dedupe(rows),meta:{agent:13,name:"Freshness Sentinel",mode:"newest-indexed-first"}};
}
function ocrFold(text){
  return fold(String(text||"")
    .replace(/-\s*\n\s*/g,"")
    .replace(/[|]/g,"l")
    .replace(/[“”]/g,'"')
    .replace(/[ﬁ]/g,"fi")
    .replace(/[ﬂ]/g,"fl"));
}
function ocrRescueAgent(payload){
  const terms=significantTerms(payload.question||"");
  const rows=(payload.candidates||[]).filter(row=>{
    const f=ocrFold(row?.text||"");
    return terms.length && terms.every(t=>f.includes(fold(t)));
  }).map(row=>({...row,mission_ocr_rescue:true,agent_votes:[...(row.agent_votes||[]),"ocr-rescue"]}));
  return {rows:dedupe(rows),meta:{agent:14,name:"OCR Rescue",mode:"normalized-ocr-recovery"}};
}
function definitionAgent(payload){
  const q=fold(payload.question||"");
  const active=/\b(?:o que e|o que é|defina|definicao|definição|significa|conceito|doutrina|what is|define|meaning)\b/i.test(q);
  if(!active)return {rows:[],meta:{agent:15,name:"Definition Specialist",active:false}};
  const rows=(payload.candidates||[]).map(row=>{
    const blocks=paragraphBlocks(row?.text||"");
    const ranked=blocks.map(p=>({p,c:coverage(p,payload.question)})).sort((a,b)=>b.c-a.c);
    return {...row,text:(ranked[0]?.p||row.text),mission_definition:true,agent_votes:[...(row.agent_votes||[]),"definition"]};
  });
  return {rows:dedupe(rows),meta:{agent:15,name:"Definition Specialist",mode:"definition-paragraph",active:true}};
}
function chronologyAgent(payload){
  const q=fold(payload.question||"");
  const active=/\b(?:quando|cronologia|ordem|antes|depois|ano|data|historia|história|timeline|when|chronology)\b/i.test(q);
  if(!active)return {rows:[],meta:{agent:16,name:"Chronology Mapper",active:false}};
  const dateRe=/\b(?:\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}|\d{4}|\d{1,2}\s+de\s+[a-zçãéíóú]+\s+de\s+\d{4})\b/giu;
  const rows=(payload.candidates||[]).map(row=>({...row,chronology_markers:(String(row.text||"").match(dateRe)||[]).slice(0,12),mission_chronology:true,agent_votes:[...(row.agent_votes||[]),"chronology"]}))
    .sort((a,b)=>Number(Boolean(b.chronology_markers?.length))-Number(Boolean(a.chronology_markers?.length)));
  return {rows:dedupe(rows),meta:{agent:16,name:"Chronology Mapper",mode:"date-event-priority",active:true}};
}
function crossDocumentAgent(payload){
  const seen=new Set(),rows=[];
  for(const row of payload.candidates||[]){
    const d=String(row?.document_id||row?.filename||"");
    if(seen.has(d))continue;seen.add(d);
    rows.push({...row,mission_cross_document:true,agent_votes:[...(row.agent_votes||[]),"cross-document"]});
  }
  for(const row of payload.candidates||[]){
    if(rows.length>=Math.min(1000,(payload.candidates||[]).length))break;
    if(!rows.includes(row))rows.push(row);
  }
  return {rows:dedupe(rows),meta:{agent:17,name:"Cross Library Balancer",mode:"document-diversity"}};
}
function citationAgent(payload){
  const rows=(payload.candidates||[]).map(row=>{
    const ref=extractSemanticReference(row?.text||"")||row?.canonical_reference||"";
    return {...row,canonical_reference:ref,mission_citation:true,agent_votes:[...(row.agent_votes||[]),"citation"]};
  }).sort((a,b)=>Number(Boolean(b.canonical_reference))-Number(Boolean(a.canonical_reference)));
  return {rows:dedupe(rows),meta:{agent:18,name:"Citation Specialist",mode:"reference-elevation"}};
}
function conflictAuditAgent(payload){
  const groups=new Map();
  for(const row of payload.candidates||[]){
    const key=fold(String(row?.canonical_reference||""))||fold(String(row?.semantic_title||row?.title||"")).slice(0,120);
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(row);
  }
  const rows=[];
  for(const group of groups.values()){
    const texts=new Set();
    for(const row of group){
      const sig=fold(row?.text||"").slice(0,500);
      const duplicate=texts.has(sig);texts.add(sig);
      if(duplicate)continue;
      rows.push({...row,mission_conflict_audit:true,conflict_group_size:group.length,agent_votes:[...(row.agent_votes||[]),"conflict-audit"]});
    }
  }
  return {rows:dedupe(rows),meta:{agent:19,name:"Conflict and Duplicate Auditor",mode:"dedupe-and-variant-audit"}};
}
function missionMasterAgent(payload){
  const short=isShortEntityQuery(payload.question||"");
  const long=isLongExplainQuery(payload.question||"");
  const rows=[...(payload.candidates||[])].map(row=>({
    ...row,
    mission_route:short?"short-entity":long?"long-explanation":"balanced",
    agent_votes:[...(row.agent_votes||[]),"mission-master"]
  }));
  rows.sort((a,b)=>{
    const ar=short?Number(Boolean(a.mission_short_entity)):long?Number(Boolean(a.mission_long_explain)):0;
    const br=short?Number(Boolean(b.mission_short_entity)):long?Number(Boolean(b.mission_long_explain)):0;
    return br-ar || Number(b.exact_match)-Number(a.exact_match) || Number(b.score||0)-Number(a.score||0);
  });
  return {rows:dedupe(rows),meta:{agent:20,name:"Mission Master",mode:short?"short-entity":long?"long-explanation":"balanced"}};
}

self.onmessage=event=>{
  const data=event.data||{};
  if(data.type!=="run")return;
  const role=Math.max(1,Math.min(20,Number(data.role||0)));
  try{
    let result;
    if(role===1)result=literalAgent(data);
    else if(role===2)result=semanticAgent(data);
    else if(role===3)result=contextualizer(data);
    else if(role===4)result=referenceJudge(data);
    else if(role>=5&&role<=9)result=sweeper(data,role);
    else if(role===10)result=bouncer(data);
    else if(role===11)result=shortEntityAgent(data);
    else if(role===12)result=longExplainAgent(data);
    else if(role===13)result=freshnessAgent(data);
    else if(role===14)result=ocrRescueAgent(data);
    else if(role===15)result=definitionAgent(data);
    else if(role===16)result=chronologyAgent(data);
    else if(role===17)result=crossDocumentAgent(data);
    else if(role===18)result=citationAgent(data);
    else if(role===19)result=conflictAuditAgent(data);
    else result=missionMasterAgent(data);
    self.postMessage({type:"result",request_id:data.request_id,role,...result});
  }catch(error){
    self.postMessage({type:"result",request_id:data.request_id,role,rows:[],error:String(error?.message||error)});
  }
};
