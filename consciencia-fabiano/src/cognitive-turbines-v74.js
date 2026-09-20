// Consciência Fabiano v7.4 — Cognitive 1000 Micro-Turbines Engine
// Additive layer over v7.3. No micro-turbine may call an LLM.

export const COGNITIVE_V74_VERSION = "7.4.0";
export const CATALOG_EXPECTED_SIZE = 1000;

export const PERFORMANCE_GUARD = Object.freeze({
  registeredTurbines: 1000,
  defaultActiveLimit: 24,
  deepResearchActiveLimit: 64,
  absoluteActiveLimit: 96,
  workerConcurrency: 8,
  groqCallsMax: 1,
  allowTurbineToCallGroq: false,
  activateByTrigger: true,
  activateByIntent: true,
  activateByObject: true,
  activateByOutputContract: true,
  executeAll1000: false,
  rejectDuplicateWork: true,
  cacheDeterministicResults: true,
  cancelIrrelevantBranches: true,
  timeoutPerTurbineMs: 2500,
  failOpenForNonCriticalTurbines: true,
  failClosedForEvidenceValidation: true
});

const PROFILES = Object.freeze([
  {key:"exact",priority:100,depth:"exact",output:"REFERENCE_OR_EVIDENCE",semantic_role:"perform the capability with exact/literal constraints"},
  {key:"contextual",priority:94,depth:"contextual",output:"CONTEXTUAL",semantic_role:"perform the capability with bounded surrounding context"},
  {key:"cross_source",priority:88,depth:"cross_source",output:"CROSS_SOURCE",semantic_role:"perform the capability across independent sources while preserving provenance"},
  {key:"conflict_aware",priority:82,depth:"conflict_aware",output:"CONFLICT_AWARE",semantic_role:"perform the capability while detecting conflicting evidence"},
  {key:"validation",priority:76,depth:"validation",output:"VALIDATED",semantic_role:"validate the capability result against evidence and output constraints"}
]);

const family = (id,name,triggers,intents,objects,capabilities) =>
  Object.freeze({id,name,triggers,intents,objects,capabilities});

export const FAMILY_DEFINITIONS = Object.freeze([
  family("F01","Escopo e intenção",["somente","apenas","only","pedido","request"],["reference_only","factual","summary","comparison","analysis","reflection","hypothesis","quotation","fichamento","definition"],["query","turn"],[
    "scope_detection","language_detection","current_turn_priority","memory_reference_resolution","constraint_detection","negation_detection","requested_depth_detection","requested_format_detection","forbidden_expansion_detection","ambiguity_detection"
  ]),
  family("F02","Recuperação exata",["exato","literal","exact","frase","termo","página","page"],["reference_only","factual","quotation","source_request"],["document","term","phrase","person","date","page"],[
    "exact_term_locator","exact_phrase_locator","name_locator","date_locator","page_locator","chunk_locator","title_locator","author_locator","entity_locator","exact_metadata_match"
  ]),
  family("F03","Escrituras e estrutura",["escritura","scripture","livro","book","capítulo","chapter","versículo","verse","seção","section"],["reference_only","factual","quotation","chapter_request","verse_request","paragraph_request","full_text_request"],["scripture","book","chapter","verse","section","paragraph"],[
    "scripture_detector","book_detector","chapter_locator","verse_locator","section_locator","paragraph_locator","canon_reference_parser","verse_range_parser","chapter_boundary_detector","scripture_reference_formatter"
  ]),
  family("F04","Bibliografia e fontes",["autor","author","obra","work","edição","edition","fonte","source"],["reference_only","factual","source_request","quotation"],["author","document","source","edition"],[
    "author_detector","work_detector","edition_detector","source_type_classifier","primary_secondary_classifier","metadata_verifier","publication_locator","title_normalizer","source_identity_resolver","bibliographic_formatter"
  ]),
  family("F05","Citação e extração",["cite","citação","quote","trecho","excerpt","literal"],["quotation","reference_only","factual"],["quotation","paragraph","document","page"],[
    "literal_quote_locator","quote_boundary_detector","context_before","context_after","excerpt_selector","quote_exactness_validator","page_citation_builder","provenance_anchor","quotation_length_guard","paraphrase_warning"
  ]),
  family("F06","Resumo e síntese",["resuma","resumo","summary","sintetize","síntese","abstract"],["summary","fichamento","analysis"],["chapter","document","topic","source"],[
    "short_summary","long_summary","executive_summary","chapter_summary","thesis_summary","source_summary","multi_source_summary","key_points_summary","abstract_builder","compression_controller"
  ]),
  family("F07","Análise e argumento",["analise","análise","argumento","argument","tese","premissa","conclusão","evidência"],["analysis","argumentation","counterargument","factual"],["argument","claim","document","topic"],[
    "thesis_extractor","premise_extractor","conclusion_extractor","evidence_mapper","argument_strength","assumption_detection","inference_detector","logical_structure","support_gap_detector","argument_summary"
  ]),
  family("F08","Comparação e contraste",["compare","comparar","diferença","difference","semelhança","similarity","versus","vs"],["comparison","analysis"],["multi_document","author","concept","source"],[
    "comparison_target_detector","similarity_detector","difference_detector","convergence_detector","divergence_detector","agreement_detector","disagreement_detector","matrix_builder","criteria_detector","balanced_comparison"
  ]),
  family("F09","Reflexão e interpretação",["reflita","reflexão","reflection","interprete","interpret","o que você pensa"],["reflection","analysis"],["topic","claim","document","concept"],[
    "reflection_controller","textual_basis_guard","interpretation_separator","theme_reflection","implication_reflection","question_reflection","ethical_reflection","interpretive_limit","source_vs_interpretation","reflection_formatter"
  ]),
  family("F10","Hipótese e contrafactual",["hipótese","hypothesis","e se","what if","suponha","suppose","contrafactual"],["hypothesis","what_if","analysis"],["scenario","claim","event","concept"],[
    "hypothesis_controller","what_if_router","counterfactual_builder","assumption_registry","consequence_mapper","possibility_ranker","scenario_boundary","speculative_labeler","alternative_scenario","hypothesis_formatter"
  ]),
  family("F11","Perguntas e dúvidas",["dúvida","duvida","question","pergunta","questão","questao","socrática","socratic"],["questioning","analysis","fichamento"],["argument","concept","document","topic"],[
    "question_generator","doubt_generator","lacuna_detector","socratic_question","verification_question","comprehension_question","research_question","counterquestion","ambiguity_question","evidence_question"
  ]),
  family("F12","Causa, consequência e cronologia",["causa","cause","efeito","effect","cronologia","timeline","antes","depois","before","after"],["chronology","analysis","factual"],["event","date","sequence","claim"],[
    "timeline_builder","sequence_detector","date_orderer","cause_detector","effect_detector","dependency_mapper","before_after","event_chain","chronology_conflict","causal_caution"
  ]),
  family("F13","Conceitos e definições",["defina","definição","definition","conceito","concept","significa","means"],["definition","factual","analysis"],["concept","term","category"],[
    "definition_locator","concept_decomposer","category_classifier","concept_relation","example_extractor","term_disambiguator","synonym_mapper","hierarchy_builder","concept_boundary","glossary_formatter"
  ]),
  family("F14","Validação epistemológica",["evidência","evidence","certeza","confidence","fonte","source"],["factual","analysis","reflection","hypothesis","quotation","comparison"],["claim","evidence","source"],[
    "evidence_sufficiency","confidence_calibrator","abstain_controller","factual_claim_checker","unsupported_claim_detector","uncertainty_detector","source_relevance","citation_coverage","inference_labeler","epistemic_separation"
  ]),
  family("F15","Contradição e consistência",["contradição","contradiction","conflito","conflict","inconsistência","inconsistency","ambíguo","ambiguous"],["analysis","comparison","factual"],["claim","source","version","document"],[
    "contradiction_detector","inconsistency_detector","ambiguity_detector","source_conflict","version_conflict","duplicate_claim","tension_mapper","reconciliation_guard","unresolved_conflict","consistency_report"
  ]),
  family("F16","Contexto e conversa",["isso","isto","esse","essa","continue","anterior","this","that","continue","previous"],["conversation","factual","analysis","reflection","hypothesis"],["turn","memory","reference"],[
    "pronoun_resolution","this_that_resolution","continue_resolution","previous_reference","topic_boundary","scope_hijack_guard","memory_relevance","turn_linker","context_expiry","context_minimizer"
  ]),
  family("F17","Formatação e entrega",["tabela","table","fichamento","timeline","curto","short","profundo","deep","lista","list"],["reference_only","summary","comparison","analysis","reflection","hypothesis","fichamento","source_request"],["output","format"],[
    "reference_only_formatter","one_sentence","short_answer","deep_answer","encyclopedic_entry","fichamento","table","timeline","quotation_block","source_list"
  ]),
  family("F18","Adaptação ao leitor",["criança","child","leigo","lay","acadêmico","academic","técnico","technical","português","english","inglês"],["factual","summary","analysis","reflection","hypothesis"],["reader","language","style"],[
    "child_level","lay_level","academic_level","technical_level","guided_study","vocabulary_level","portuguese_style","english_style","concise_style","detailed_style"
  ]),
  family("F19","Orquestração RAG",["buscar","search","encontre","find","fonte","source","documento","document"],["reference_only","factual","summary","comparison","analysis","reflection","hypothesis","quotation"],["retrieval","document","source"],[
    "search_strategy","top_k","exact_first","bm25_weight","semantic_weight","dedupe","rerank","source_diversity","context_reducer","retrieval_stop"
  ]),
  family("F20","QA e pós-validação",["verifique","validate","check","confirme","confirm","exato","exact"],["reference_only","factual","summary","comparison","analysis","reflection","hypothesis","quotation"],["answer","claim","format"],[
    "coverage_check","scope_check","citation_check","hallucination_check","coherence_check","format_check","label_check","language_check","redundancy_check","final_contract"
  ])
]);

function normalize(text){
  return String(text || "").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
}

function unique(items){
  return [...new Set((items || []).filter(Boolean).map(String))];
}

function capabilityTokens(name){
  return unique(String(name || "").split(/[_\-]+/).filter(x=>x.length>=3));
}

function familyRequiresEvidence(id){
  return !["F01","F09","F10","F11","F16","F17","F18"].includes(id);
}

function familyHandler(id){
  return ({
    F01:"scopeHandler",F02:"exactRetrievalHandler",F03:"scriptureHandler",F04:"bibliographyHandler",
    F05:"citationHandler",F06:"summaryHandler",F07:"argumentHandler",F08:"comparisonHandler",
    F09:"reflectionHandler",F10:"hypothesisHandler",F11:"questionHandler",F12:"chronologyHandler",
    F13:"conceptHandler",F14:"epistemicHandler",F15:"consistencyHandler",F16:"contextHandler",
    F17:"formatHandler",F18:"readerAdaptationHandler",F19:"ragPlanningHandler",F20:"postValidationHandler"
  })[id] || "genericHandler";
}

export const TURBINES = new Map();

export function registerTurbine(t){
  if(!t?.id) throw new Error("Turbine id required");
  if(TURBINES.has(t.id)) throw new Error("Duplicate turbine: "+t.id);
  const required=["family","name","triggers","intents","objects","handler","rules","output_contract"];
  for(const key of required){
    if(t[key] == null) throw new Error("Invalid turbine "+t.id+": missing "+key);
  }
  if(t.requires_llm !== false) throw new Error("Micro-turbine may not call LLM: "+t.id);
  TURBINES.set(t.id,Object.freeze({...t}));
}

for(const fam of FAMILY_DEFINITIONS){
  fam.capabilities.forEach((capability,capIndex)=>{
    PROFILES.forEach((profile,profileIndex)=>{
      const n=capIndex*PROFILES.length+profileIndex+1;
      const operation=capability+"_"+profile.key;
      const id=fam.id+"."+operation+"."+String(n).padStart(3,"0");
      registerTurbine({
        id,
        family:fam.id,
        family_name:fam.name,
        name:operation,
        version:1,
        enabled:true,
        priority:profile.priority,
        profile:profile.key,
        depth:profile.depth,
        triggers:unique([...fam.triggers,...capabilityTokens(capability),...capabilityTokens(profile.key)]),
        intents:[...fam.intents],
        objects:[...fam.objects],
        requires_evidence:familyRequiresEvidence(fam.id),
        requires_llm:false,
        allowed_memory:fam.id==="F16" || fam.id==="F01" ? "REFERENCE_RESOLUTION_ONLY" : "NONE",
        may_invent_facts:false,
        output_contract:profile.output,
        operation,
        base_capability:capability,
        behavior_contract:capability+" | "+profile.semantic_role,
        handler:familyHandler(fam.id)+"."+operation,
        rules:Object.freeze({
          current_question_is_sovereign:true,
          may_invent_facts:false,
          preserve_provenance:["F02","F03","F04","F05","F14","F19","F20"].includes(fam.id),
          epistemic_label:fam.id==="F09"?"REFLECTION":fam.id==="F10"?"HYPOTHESIS":null,
          specialization:profile.key,
          semantic_role:profile.semantic_role,
          semantic_parameter:operation
        })
      });
    });
  });
}

if(TURBINES.size!==CATALOG_EXPECTED_SIZE){
  throw new Error("V7.4 catalog invariant failed: expected 1000, got "+TURBINES.size);
}

const FAMILY_INTENT_MAP=Object.freeze({
  reference_only:["F01","F02","F03","F04","F05","F14","F17","F19","F20"],
  factual:["F01","F02","F03","F04","F05","F13","F14","F19","F20"],
  summary:["F01","F06","F14","F17","F18","F19","F20"],
  comparison:["F01","F04","F07","F08","F14","F15","F17","F19","F20"],
  analysis:["F01","F07","F12","F13","F14","F15","F17","F19","F20"],
  reflection:["F01","F09","F14","F16","F17","F18","F19","F20"],
  hypothesis:["F01","F10","F12","F14","F16","F17","F19","F20"],
  quotation:["F01","F02","F04","F05","F14","F17","F19","F20"],
  fichamento:["F01","F03","F04","F05","F06","F07","F11","F14","F17","F19","F20"],
  chronology:["F01","F02","F12","F14","F17","F19","F20"],
  definition:["F01","F02","F13","F14","F17","F19","F20"],
  what_if:["F01","F10","F12","F14","F17","F19","F20"],
  questioning:["F01","F07","F11","F14","F17","F19","F20"]
});

function inferSupplementalIntents(query,baseMode){
  const q=normalize(query);
  const intents=[String(baseMode || "factual")];
  const tests=[
    ["reference_only",/\b(somente|apenas|so)\s+(a\s+)?(referencia|fonte)|\b(reference|source)\s+only\b/],
    ["quotation",/\b(cite|citacao|citar|quote|literal|verbatim|trecho exato)\b/],
    ["fichamento",/\b(fichamento|reading notes|study notes)\b/],
    ["chronology",/\b(cronologia|timeline|linha do tempo|sequencia temporal)\b/],
    ["definition",/\b(defina|definicao|definition|o que significa|what does .* mean)\b/],
    ["what_if",/\b(e se|e se n|what if|suponha|suppose|contrafactual)\b/],
    ["comparison",/\b(compare|comparar|comparacao|diferencas|semelhancas|versus|\bvs\b)\b/],
    ["reflection",/\b(reflexao|reflita|o que voce pensa|o q vc acha|what do you think|reflect)\b/],
    ["summary",/\b(resuma|resumo|summarize|summary)\b/],
    ["questioning",/\b(duvida|duvidas|questao|questoes|pergunta critica|question|questions|doubts)\b/]
  ];
  for(const [intent,re] of tests) if(re.test(q)) intents.push(intent);
  return unique(intents);
}

function inferObjects(query){
  const q=normalize(query);
  const out=[];
  const tests=[
    ["scripture",/\b(escritura|scripture|biblia|bible|versiculo|verse)\b/],
    ["chapter",/\b(capitulo|chapter)\b/],
    ["verse",/\b(versiculo|verse|\d+\s*:\s*\d+)\b/],
    ["author",/\b(autor|author)\b/],
    ["date",/\b(data|date|ano|year|quando|when)\b/],
    ["quotation",/\b(citacao|quote|literal|verbatim)\b/],
    ["concept",/\b(conceito|concept|defina|definition)\b/],
    ["source",/\b(fonte|source|referencia|reference)\b/],
    ["document",/\b(documento|document|pdf|livro|book)\b/]
  ];
  for(const [obj,re] of tests) if(re.test(q)) out.push(obj);
  return out.length?out:["topic"];
}

function inferOutput(query,contract){
  const q=normalize(query);
  if(contract?.mode==="reference_only") return "reference_only";
  if(/\b(uma frase|one sentence)\b/.test(q)) return "one_sentence";
  if(/\b(cinco linhas|5 linhas|five lines|curto|short answer)\b/.test(q)) return "short_answer";
  if(/\b(fichamento|study notes|reading notes)\b/.test(q)) return "fichamento";
  if(/\b(tabela|table|matriz|matrix)\b/.test(q)) return "table";
  if(/\b(cronologia|timeline|linha do tempo)\b/.test(q)) return "timeline";
  if(/\b(citacao literal|quotation block|quote block)\b/.test(q)) return "quotation_block";
  if(/\b(lista de fontes|source list|fontes somente)\b/.test(q)) return "source_list";
  if(/profund|\bdeep\b|encicloped|encyclopedic/.test(q)) return "deep_answer";
  return contract?.mode==="summary"?"short_answer":"balanced_answer";
}

function inferDeepResearch(query){
  return /\b(deep research|pesquisa profunda|exaustiv|comprehensive|multiplas fontes|multiple sources)\b/.test(normalize(query));
}

function triggerScore(t,qNorm){
  let score=0;
  for(const trig of t.triggers){
    const n=normalize(trig);
    if(n && qNorm.includes(n)) score+=8;
  }
  return Math.min(score,32);
}

function scoreTurbine(t,ctx){
  let score=0;
  const qNorm=ctx.qNorm;
  if(ctx.preferredFamilies.has(t.family)) score+=40;
  if(t.intents.some(i=>ctx.intents.includes(i))) score+=24;
  if(t.objects.some(o=>ctx.objects.includes(o))) score+=14;
  if(String(t.operation||"")===String(ctx.output||"")) score+=12;
  if(t.family==="F01" || t.family==="F14" || t.family==="F20") score+=18;
  if(t.family==="F17") score+=8;
  if(t.family==="F19") score+=8;
  score+=triggerScore(t,qNorm);
  score+=Number(t.priority||0)/20;
  if(t.profile==="strict" && ctx.contract?.mode==="reference_only") score+=8;
  if(t.profile==="deep" && ctx.deepResearch) score+=8;
  if(t.profile==="compact" && ctx.output==="short_answer") score+=7;
  return score;
}

export function buildExecutionPlan(query,contract={},options={}){
  const qNorm=normalize(query);
  const intents=inferSupplementalIntents(query,contract?.mode || "factual");
  const objects=inferObjects(query);
  const output=inferOutput(query,contract);
  const deepResearch=options.deepResearch ?? inferDeepResearch(query);
  const preferredFamilies=new Set(["F01","F14","F20"]);
  for(const intent of intents){
    for(const fam of FAMILY_INTENT_MAP[intent] || []) preferredFamilies.add(fam);
  }
  if(/\b(isso|isto|esse|essa|anterior|continue|this|that|previous)\b/.test(qNorm)) preferredFamilies.add("F16");
  if(/\b(crianca|child|leigo|lay|academico|academic|tecnico|technical|ingles|english|portugues)\b/.test(qNorm)) preferredFamilies.add("F18");

  const baseLimit=deepResearch?PERFORMANCE_GUARD.deepResearchActiveLimit:PERFORMANCE_GUARD.defaultActiveLimit;
  const requested=Math.max(1,Number(options.activeLimit||baseLimit));
  const maxActive=Math.min(PERFORMANCE_GUARD.absoluteActiveLimit,requested);

  const scored=[...TURBINES.values()]
    .filter(t=>t.enabled)
    .map(t=>({t,score:scoreTurbine(t,{qNorm,intents,objects,output,preferredFamilies,contract,deepResearch})}))
    .filter(x=>x.score>20)
    .sort((a,b)=>b.score-a.score || b.t.priority-a.t.priority || a.t.id.localeCompare(b.t.id));

  // Minimal sufficient routing: first cover each required family with its best
  // semantically relevant operation; only then add a few trigger-matched specialists.
  const selected=[];
  const selectedIds=new Set();
  const preferredOrdered=[...preferredFamilies];
  for(const familyId of preferredOrdered){
    const best=scored.find(row=>row.t.family===familyId && !selectedIds.has(row.t.id));
    if(!best) continue;
    selected.push(best.t);
    selectedIds.add(best.t.id);
    if(selected.length>=maxActive) break;
  }

  const compound=intents.length>1;
  const triggerExtras=deepResearch?16:compound?8:3;
  const target=Math.min(maxActive,selected.length+triggerExtras);
  for(const row of scored){
    if(selectedIds.has(row.t.id)) continue;
    if(triggerScore(row.t,qNorm)<=0 && !deepResearch) continue;
    selected.push(row.t);
    selectedIds.add(row.t.id);
    if(selected.length>=target) break;
  }

  if(selected.length>=CATALOG_EXPECTED_SIZE) throw new Error("V7.4 invariant: never execute all 1000");

  return Object.freeze({
    version:COGNITIVE_V74_VERSION,
    query:String(query||""),
    intents,
    objects,
    output,
    epistemicMode:String(contract?.mode || "factual"),
    deepResearch,
    activeLimit:maxActive,
    concurrency:PERFORMANCE_GUARD.workerConcurrency,
    selected:Object.freeze(selected),
    selected_ids:Object.freeze(selected.map(t=>t.id)),
    selected_count:selected.length,
    preferred_families:Object.freeze([...preferredFamilies]),
    constraints:Object.freeze({
      current_question_is_sovereign:true,
      memory_reference_resolution_only:true,
      groq_calls_max:1,
      turbine_groq_calls:0,
      unsupported_fact_policy:"ABSTAIN",
      never_execute_1000:true
    })
  });
}

function handlerResult(t,ctx){
  const sources=Array.isArray(ctx?.sources)?ctx.sources:[];
  const evidenceCount=sources.length;
  const profileContract=({
    exact:{scope:"exact",context_window:"none",cross_source:false,conflict_scan:false,validate_result:false},
    contextual:{scope:"contextual",context_window:"bounded",cross_source:false,conflict_scan:false,validate_result:false},
    cross_source:{scope:"cross_source",context_window:"bounded",cross_source:true,conflict_scan:false,validate_result:false},
    conflict_aware:{scope:"conflict_aware",context_window:"bounded",cross_source:true,conflict_scan:true,validate_result:false},
    validation:{scope:"validation",context_window:"bounded",cross_source:true,conflict_scan:true,validate_result:true}
  })[t.profile] || {scope:"generic",context_window:"bounded",cross_source:false,conflict_scan:false,validate_result:false};
  const base={
    turbine_id:t.id,
    family:t.family,
    operation:t.operation,
    base_capability:t.base_capability,
    profile:t.profile,
    behavior_contract:t.behavior_contract,
    semantic_role:String(t.rules?.semantic_role || ""),
    semantic_parameter:String(t.rules?.semantic_parameter || t.base_capability || t.operation || ""),
    output_contract:t.output_contract,
    execution_contract:Object.freeze({
      ...profileContract,
      capability:String(t.base_capability || t.operation || ""),
      requires_evidence:Boolean(t.requires_evidence),
      preserve_provenance:Boolean(t.rules?.preserve_provenance)
    }),
    handler:t.handler,
    requires_evidence:t.requires_evidence,
    llm_calls:0,
    evidence_count:evidenceCount,
    ok:true
  };
  switch(t.family){
    case "F01": return {...base,scope:"current-turn",memory_policy:t.allowed_memory};
    case "F02": return {...base,exact_candidate_count:evidenceCount};
    case "F03": return {...base,structural_candidates:evidenceCount};
    case "F04": return {...base,source_candidates:evidenceCount};
    case "F05": return {...base,provenance_required:true};
    case "F06": return {...base,reduction_mode:"deterministic-before-final"};
    case "F07": return {...base,inference_must_be_labeled:true};
    case "F08": return {...base,multi_source_required:evidenceCount>1};
    case "F09": return {...base,epistemic_label:"REFLECTION",may_create_facts:false};
    case "F10": return {...base,epistemic_label:"HYPOTHESIS",may_present_as_fact:false};
    case "F11": return {...base,questions_grounded_in_sources:true};
    case "F12": return {...base,causal_claims_require_evidence:true};
    case "F13": return {...base,definition_grounded:true};
    case "F14": return {...base,can_answer:!t.requires_evidence || evidenceCount>0,abstain:evidenceCount===0};
    case "F15": return {...base,conflict_check:true};
    case "F16": return {...base,scope_hijack_guard:true};
    case "F17": return {...base,output_contract:ctx?.plan?.output || t.output_contract};
    case "F18": return {...base,language:String(ctx?.contract?.language || "pt")};
    case "F19": return {...base,rag_before_llm:true,top_k_hint:ctx?.plan?.deepResearch?500:120};
    case "F20": return {...base,post_validate:true,scope_check:true,citation_check:true};
    default: return base;
  }
}

async function boundedMap(items,limit,fn){
  const list=Array.from(items||[]);
  const results=new Array(list.length);
  let cursor=0;
  const workers=Array.from({length:Math.max(1,Math.min(Number(limit)||1,list.length||1))},async()=>{
    while(true){
      const i=cursor++;
      if(i>=list.length) return;
      results[i]=await fn(list[i],i);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function runCognitivePlan(plan,context={}){
  const started=Date.now();
  const outputs=await boundedMap(plan.selected,plan.concurrency,async t=>{
    const t0=Date.now();
    let result;
    try{
      result=handlerResult(t,{...context,plan});
    }catch(error){
      result={turbine_id:t.id,family:t.family,operation:t.operation,ok:false,llm_calls:0,error:String(error?.message||error)};
    }
    return {...result,duration_ms:Date.now()-t0};
  });
  return Object.freeze({
    ok:true,
    selected_count:plan.selected_count,
    executed_count:outputs.length,
    concurrency:plan.concurrency,
    duration_ms:Date.now()-started,
    llm_calls:0,
    outputs:Object.freeze(outputs)
  });
}

export function evidenceGateV74(plan,sources,execution){
  const rows=Array.isArray(sources)?sources:[];
  const factualModes=new Set(["reference_only","factual","summary","comparison","analysis","quotation","fichamento","chronology","definition"]);
  const needsEvidence=factualModes.has(String(plan?.epistemicMode||"")) ||
    (plan?.intents||[]).some(i=>["quotation","fichamento","chronology","definition"].includes(i));
  const evidenceCount=rows.length;
  if(needsEvidence && evidenceCount===0){
    return Object.freeze({canAnswer:false,reason:"documentary_evidence_not_found",evidenceCount,policy:"ABSTAIN"});
  }
  const failedCritical=Array.from(execution?.outputs||[]).some(x=>x?.family==="F14" && x?.ok===false);
  if(failedCritical){
    return Object.freeze({canAnswer:false,reason:"epistemic_validation_failed",evidenceCount,policy:"ABSTAIN"});
  }
  return Object.freeze({canAnswer:true,reason:"evidence_gate_pass",evidenceCount,policy:"GROUNDED"});
}

export function catalogAudit(){
  const ids=[...TURBINES.keys()];
  const families={};
  for(const t of TURBINES.values()) families[t.family]=(families[t.family]||0)+1;
  const uniqueIds=new Set(ids).size;
  const invalid=[...TURBINES.values()].filter(t=>
    !t.id || !t.family || !t.handler || !Array.isArray(t.triggers) || !Array.isArray(t.intents) ||
    !Array.isArray(t.objects) || t.requires_llm!==false || t.may_invent_facts!==false
  );
  return Object.freeze({
    version:COGNITIVE_V74_VERSION,
    total:TURBINES.size,
    unique_ids:uniqueIds,
    duplicate_ids:ids.length-uniqueIds,
    families,
    family_count:Object.keys(families).length,
    invalid_count:invalid.length,
    all_have_handlers:invalid.length===0,
    llm_enabled_turbines:0,
    expected:CATALOG_EXPECTED_SIZE,
    valid:TURBINES.size===CATALOG_EXPECTED_SIZE && uniqueIds===CATALOG_EXPECTED_SIZE &&
      Object.keys(families).length===20 && Object.values(families).every(n=>n===50) && invalid.length===0
  });
}

export function catalogManifest(){
  return [...TURBINES.values()].map(t=>({
    id:t.id,family:t.family,family_name:t.family_name,name:t.name,version:t.version,enabled:t.enabled,
    priority:t.priority,profile:t.profile,triggers:t.triggers,intents:t.intents,objects:t.objects,
    requires_evidence:t.requires_evidence,requires_llm:t.requires_llm,allowed_memory:t.allowed_memory,
    may_invent_facts:t.may_invent_facts,output_contract:t.output_contract,operation:t.operation,
    base_capability:t.base_capability,behavior_contract:t.behavior_contract,
    handler:t.handler,rules:t.rules
  }));
}
