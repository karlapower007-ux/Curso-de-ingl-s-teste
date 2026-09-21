export const ADAPTIVE_V80_VERSION = "8.0.0-adaptive-20x20x20";

const MODES = Object.freeze({
  FAST: Object.freeze({
    memory_limit: 5,
    query_limit: 4,
    search_limit: 4,
    cognitive_active_limit: 12,
    context_limit: 40,
    evidence_limit: 20,
    soft_deadline_ms: 1200,
    hard_deadline_ms: 4500
  }),
  NORMAL: Object.freeze({
    memory_limit: 10,
    query_limit: 8,
    search_limit: 8,
    cognitive_active_limit: 24,
    context_limit: 80,
    evidence_limit: 40,
    soft_deadline_ms: 1500,
    hard_deadline_ms: 5500
  }),
  DEEP: Object.freeze({
    memory_limit: 20,
    query_limit: 20,
    search_limit: 20,
    cognitive_active_limit: 64,
    context_limit: 120,
    evidence_limit: 60,
    soft_deadline_ms: 2000,
    hard_deadline_ms: 8000
  })
});

const MEMORY_PERSPECTIVES = Object.freeze([
  ["M01","current-turn"],["M02","current-topic"],["M03","entities"],["M04","chronology"],
  ["M05","concepts"],["M06","authors"],["M07","works-sources"],["M08","prior-claims"],
  ["M09","prior-conclusions"],["M10","open-questions"],["M11","hypotheses"],["M12","citations"],
  ["M13","counterpoints"],["M14","definitions"],["M15","historical-context"],["M16","conversation-style"],
  ["M17","concept-relations"],["M18","recurring-topics"],["M19","session-state"],["M20","longitudinal-memory"]
].map(([id,name])=>Object.freeze({id,name})));

const SEARCH_PERSPECTIVES = Object.freeze([
  "literal","lexical","semantic","entity","chronology","definition","causal","comparison","counterpoint","quotation",
  "author","work","source","technical-term","cross-document","provenance","conflict","exact-anchor","topic","diversity"
]);

function clean(value,max=6000){
  return String(value||"").replace(/\s+/g," ").trim().slice(0,max);
}

function normalize(value){
  return clean(value,12000)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .toLowerCase();
}

function tokens(value){
  const stop=new Set(["que","para","com","uma","uns","umas","por","dos","das","de","do","da","e","em","no","na","nos","nas","o","a","os","as","the","and","for","with","from","this","that"]);
  return normalize(value)
    .split(/[^a-z0-9à-ÿ_-]+/i)
    .map(x=>x.trim())
    .filter(x=>x.length>=3 && !stop.has(x))
    .slice(0,80);
}

function uniq(list){
  return [...new Set(Array.from(list||[]).filter(Boolean))];
}

function deepSignal(q){
  const n=normalize(q);
  let score=0;
  if(q.length>260) score+=2;
  if(q.length>700) score+=2;
  if(/\b(profundo|aprofund|pesquisa|compare|compar|analise|análise|contexto historico|contexto histórico|cronologia|contraponto|todas as fontes|multiplas fontes|múltiplas fontes|exaustiv|deep research|comprehensive)\b/i.test(q)) score+=3;
  if((q.match(/[?;]/g)||[]).length>=2) score+=1;
  if(/\b(versus|vs\.?|diferen[cç]a|rela[cç][aã]o entre|causa|consequ[eê]ncia)\b/i.test(n)) score+=1;
  return score;
}

function simpleSignal(q){
  const n=normalize(q);
  return q.length<=120 &&
    !/\b(compare|compar|analise|análise|cronologia|contexto|por que|porque|causa|consequencia|consequência|fontes|cita[cç][aã]o|aprofund|rela[cç][aã]o|diferen[cç]a|contraponto)\b/i.test(n);
}

function downgradeMode(mode,loadLevel){
  const load=String(loadLevel||"normal").toLowerCase();
  if(load==="critical") return "FAST";
  if(load==="high" && mode==="DEEP") return "NORMAL";
  return mode;
}

function selectMemoryPerspectives(question,limit){
  const q=normalize(question);
  const priority=["M01","M02","M07","M05","M03"];
  if(/\b(quando|ano|data|antes|depois|cronolog)\b/.test(q)) priority.push("M04");
  if(/\b(autor|quem escreveu|obra|livro|fonte)\b/.test(q)) priority.push("M06","M07");
  if(/\b(citacao|citação|versiculo|versículo|trecho|pagina|página)\b/.test(q)) priority.push("M12");
  if(/\b(defina|definicao|definição|o que e|o que é)\b/.test(q)) priority.push("M14");
  if(/\b(contraponto|contra|diverge|discorda|obje[cç][aã]o)\b/.test(q)) priority.push("M13");
  if(/\b(continue|continua|anterior|isso|isto|esse|essa|ele|ela)\b/.test(q)) priority.push("M08","M09","M19","M20");
  if(/\b(historia|história|historico|histórico)\b/.test(q)) priority.push("M15");
  if(/\b(rela[cç][aã]o|conecta|correla)\b/.test(q)) priority.push("M17");
  const ordered=uniq(priority.concat(MEMORY_PERSPECTIVES.map(x=>x.id))).slice(0,Math.max(1,limit));
  return ordered.map(id=>MEMORY_PERSPECTIVES.find(x=>x.id===id)).filter(Boolean);
}

export function buildAdaptiveV80Plan(question,contract={},runtime={}){
  const q=clean(question,8000);
  let mode=simpleSignal(q) ? "FAST" : (deepSignal(q)>=3 ? "DEEP" : "NORMAL");
  if(runtime?.deepResearch===true) mode="DEEP";
  mode=downgradeMode(mode,runtime?.loadLevel);
  const cfg=MODES[mode];
  const memory=selectMemoryPerspectives(q,cfg.memory_limit);
  return Object.freeze({
    version:ADAPTIVE_V80_VERSION,
    mode,
    memory_perspectives:Object.freeze(memory),
    query_limit:cfg.query_limit,
    search_limit:cfg.search_limit,
    cognitive_active_limit:cfg.cognitive_active_limit,
    context_limit:cfg.context_limit,
    evidence_limit:cfg.evidence_limit,
    soft_deadline_ms:cfg.soft_deadline_ms,
    hard_deadline_ms:cfg.hard_deadline_ms,
    search_perspectives:Object.freeze(SEARCH_PERSPECTIVES.slice(0,cfg.search_limit)),
    early_exit:true,
    load_level:String(runtime?.loadLevel||"normal"),
    constraints:Object.freeze({
      preserve_legacy_pipeline:true,
      preserve_ui:true,
      preserve_library:true,
      llm_calls_before_final:0,
      max_logical_perspectives:20,
      no_paid_dependency:true,
      no_destructive_migration:true,
      current_question_sovereign:true
    }),
    contract_mode:String(contract?.mode||"factual")
  });
}

export function buildQueryVariantsV80(question,retrievalQuestion,plan){
  const current=clean(question,4000);
  const retrieval=clean(retrievalQuestion||current,4800);
  const focus=uniq(tokens(retrieval)).slice(0,12);
  const focusText=focus.join(" ");
  const candidates=[
    {id:"Q01",kind:"literal",query:current,weight:1.00},
    {id:"Q02",kind:"stateful",query:retrieval,weight:0.98},
    {id:"Q03",kind:"keywords",query:focusText,weight:0.92},
    {id:"Q04",kind:"exact-focus",query:focus.slice(0,7).join(" "),weight:0.90},
    {id:"Q05",kind:"entities",query:focus.filter(x=>/^[a-zà-ÿ].*/i.test(x)).slice(0,9).join(" "),weight:0.88},
    {id:"Q06",kind:"chronology",query:focusText+" cronologia data contexto",weight:0.76},
    {id:"Q07",kind:"historical",query:focusText+" contexto historico",weight:0.76},
    {id:"Q08",kind:"definition",query:focusText+" definicao conceito",weight:0.74},
    {id:"Q09",kind:"cause",query:focusText+" causa consequencia",weight:0.72},
    {id:"Q10",kind:"comparison",query:focusText+" comparacao diferenca",weight:0.72},
    {id:"Q11",kind:"counterpoint",query:focusText+" contraponto divergencia",weight:0.70},
    {id:"Q12",kind:"quotation",query:focusText+" citacao trecho",weight:0.70},
    {id:"Q13",kind:"author",query:focusText+" autor",weight:0.68},
    {id:"Q14",kind:"work",query:focusText+" obra livro",weight:0.68},
    {id:"Q15",kind:"source",query:focusText+" fonte referencia",weight:0.68},
    {id:"Q16",kind:"technical",query:focus.filter(x=>x.length>=7).join(" "),weight:0.66},
    {id:"Q17",kind:"cross-source",query:focusText+" fontes relacionadas",weight:0.64},
    {id:"Q18",kind:"provenance",query:focusText+" origem documento",weight:0.62},
    {id:"Q19",kind:"conflict",query:focusText+" conflito evidencia",weight:0.62},
    {id:"Q20",kind:"semantic",query:focus.slice().reverse().join(" "),weight:0.60}
  ];
  const seen=new Set();
  const out=[];
  for(const item of candidates){
    const q=clean(item.query,4800);
    const key=normalize(q);
    if(!q || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(Object.freeze({...item,query:q}));
    if(out.length>=Math.max(1,Math.min(20,Number(plan?.query_limit||4)))) break;
  }
  return Object.freeze(out);
}

function rowText(row){
  return [
    row?.trecho,row?.text,row?.conteudo,row?.content,
    row?.titulo,row?.title,row?.arquivo,row?.filename,
    row?.autor,row?.author
  ].filter(Boolean).join(" ");
}

function rankMap(rows,selector){
  return new Map(
    rows.map((row,index)=>({row,index,value:Number(selector(row)||0)}))
      .sort((a,b)=>b.value-a.value || a.index-b.index)
      .map((entry,rank)=>[entry.index,rank+1])
  );
}

function overlapScore(text,queryTokens){
  const bag=new Set(tokens(text));
  if(!queryTokens.length) return 0;
  let hit=0;
  for(const token of queryTokens) if(bag.has(token)) hit++;
  return hit/queryTokens.length;
}

export function adaptiveFuseAndRerankV80(rows,question,variants,plan){
  const input=Array.isArray(rows)?rows:[];
  if(input.length<=1) return input.slice();
  const lexicalRanks=rankMap(input,row=>row?.lexical_score);
  const semanticRanks=rankMap(input,row=>row?.semantic_score ?? row?.score);
  const baseRanks=rankMap(input,row=>row?.score);
  const queryTokens=uniq(tokens(question));
  const variantTokens=Array.from(variants||[]).slice(0,Math.max(1,Number(plan?.search_limit||4))).map(v=>tokens(v.query));

  const scored=input.map((row,index)=>{
    const text=rowText(row);
    const lexical=lexicalRanks.get(index)||input.length;
    const semantic=semanticRanks.get(index)||input.length;
    const base=baseRanks.get(index)||input.length;
    const rrf=(1/(60+lexical))+(1/(60+semantic))+(1/(60+base));
    const directCoverage=overlapScore(text,queryTokens);
    let perspectiveCoverage=0;
    for(const vt of variantTokens) perspectiveCoverage=Math.max(perspectiveCoverage,overlapScore(text,vt));
    const provenance=Boolean(row?.document_id||row?.arquivo||row?.filename||row?.titulo||row?.title) ? 0.01 : 0;
    const finalScore=rrf+(directCoverage*0.08)+(perspectiveCoverage*0.05)+provenance;
    return {row,index,finalScore};
  }).sort((a,b)=>b.finalScore-a.finalScore || a.index-b.index);

  const max=Math.max(1,Math.min(input.length,Number(plan?.context_limit||80)));
  return scored.slice(0,max).map(({row})=>row);
}

export function adaptiveEvidenceGateV80(plan,sources,legacyGate){
  const rows=Array.isArray(sources)?sources:[];
  if(legacyGate?.canAnswer===false){
    return Object.freeze({
      canAnswer:false,
      reason:"legacy-evidence-gate-blocked",
      policy:"ABSTAIN",
      evidence_count:rows.length,
      legacy_reason:String(legacyGate?.reason||"")
    });
  }
  if(!rows.length){
    return Object.freeze({canAnswer:false,reason:"no-evidence",policy:"ABSTAIN",evidence_count:0});
  }
  const docs=new Set(rows.map(row=>String(row?.document_id||row?.arquivo||row?.filename||row?.titulo||row?.title||"")).filter(Boolean));
  return Object.freeze({
    canAnswer:true,
    reason:"adaptive-evidence-gate-pass",
    policy:"GROUNDED",
    evidence_count:rows.length,
    independent_documents:docs.size,
    mode:String(plan?.mode||"NORMAL"),
    low_diversity:docs.size<=1 && rows.length>3
  });
}

export function v80RuntimeSummary(plan,variants,rows){
  return Object.freeze({
    version:ADAPTIVE_V80_VERSION,
    enabled:true,
    mode:String(plan?.mode||"NORMAL"),
    memory_perspectives:Array.from(plan?.memory_perspectives||[]).map(x=>x.id),
    query_variants:Array.from(variants||[]).map(x=>x.id),
    search_perspectives:Array.from(plan?.search_perspectives||[]),
    context_rows:Number(Array.isArray(rows)?rows.length:0),
    cognitive_active_limit:Number(plan?.cognitive_active_limit||0),
    early_exit:Boolean(plan?.early_exit),
    llm_calls_before_final:0,
    preserve_legacy_pipeline:true
  });
}
