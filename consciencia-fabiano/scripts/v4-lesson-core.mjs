import path from "node:path";
import {mkdir} from "node:fs/promises";

export const V4_VERSION="4.1.0-lesson-entailment-locked";

const PRIVATE_PATTERNS=[
  /\b(endere[cç]o|rua|avenida|cep|onde moro|minha casa)\b/i,
  /\b(minha fam[ií]lia|minha m[aã]e|meu pai|meus pais|meu irm[aã]o|minha irm[aã])\b/i,
  /\b(meu medo|tenho medo|estou com medo|meu pecado|meus pecados|confiss[aã]o)\b/i,
  /\b(senha|cpf|rg|telefone|celular|escola onde estudo)\b/i
];

const SOURCE_LIKE=[
  /\.pdf\b/i,
  /\bstandard[-_ ]?works\b/i,
  /\bp[aá]gina\s+\d+\b/i,
  /\bPDF\s*p\.?\s*\d+\b/i,
  /\b(?:[1-4]\s+)?[A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-Za-zÀ-ÿ.-]{1,30}\s+\d{1,4}:\d{1,4}\b/u
];

function cleanText(value,max=500){
  return String(value||"").replace(/\s+/g," ").trim().slice(0,max);
}
function fold(value=""){
  return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
}
function normalizeQuote(value=""){
  return String(value||"").replace(/[“”„‟«»]/g,'"').replace(/[‘’]/g,"'").replace(/\s+/g," ").trim();
}
function tokenSet(value=""){
  return new Set(fold(value).split(/\s+/).filter(x=>x.length>=3));
}
function jaccard(a,b){
  const A=tokenSet(a),B=tokenSet(b);
  if(!A.size||!B.size)return 0;
  let hit=0;for(const x of A)if(B.has(x))hit++;
  return hit/(A.size+B.size-hit);
}
function nearDuplicate(a,b){
  const A=normalizeQuote(a),B=normalizeQuote(b);
  if(!A||!B)return false;
  if(A===B)return true;
  const short=A.length<B.length?A:B,long=A.length<B.length?B:A;
  if(short.length>=90 && long.includes(short))return true;
  return jaccard(A,B)>=0.82;
}
function publicProofRef(row={}){
  return cleanText(row.reference||row.ref||"",220);
}
function proofId(row,index){
  const raw=String(row.id||row.source_chunk_id||row.reference||("E"+(index+1)));
  return "E"+(index+1)+"-"+raw.replace(/[^A-Za-z0-9_-]/g,"").slice(0,24);
}
function languageOf(row={},text=""){
  const raw=String(row.language||row.lang||"").trim().toLowerCase();
  if(raw.startsWith("pt"))return "pt";
  if(raw.startsWith("en"))return "en";
  if(raw.startsWith("es"))return "es";
  const f=" "+fold(text)+" ";
  const pt=(f.match(/\b(o|a|os|as|de|do|da|dos|das|que|uma|um|para|com|não|nao|espírito|espirito|ressurreição|ressurreicao)\b/g)||[]).length;
  const en=(f.match(/\b(the|of|and|to|in|is|are|that|with|spirit|world|resurrection|after|before)\b/g)||[]).length;
  return en>pt?"en":pt>0?"pt":"indefinido";
}
function looksPortuguese(text=""){
  const f=" "+fold(text)+" ";
  const pt=(f.match(/\b(o|a|os|as|de|do|da|dos|das|e|é|eh|sao|uma|um|que|para|com|sem|apos|antes|onde|quando|porque|pode|podem|espiritos|ressurreicao)\b/g)||[]).length;
  const en=(f.match(/\b(the|of|and|to|in|is|are|was|were|that|this|with|after|before|spirit|world|resurrection)\b/g)||[]).length;
  return pt>=1 && en<=pt;
}
function quoteBelongsToProof(quote,proof){
  const q=normalizeQuote(quote);
  const source=normalizeQuote(proof?.trecho_original||proof?.trecho||"");
  if(q.length<20||q.split(/\s+/).length<4)return false;
  return source.includes(q);
}
function publicProof(proof={}){
  return {
    id:proof.id,
    ref:proof.ref,
    trecho:proof.trecho_original,
    trecho_original:proof.trecho_original,
    idioma_original:proof.idioma_original,
    traducao_pt:null,
    verified:true,
    titulo:proof.titulo||"",
    document_id:String(proof.document_id||""),
    pagina_pdf:proof.pagina_pdf??null,
    pagina_impressa:proof.pagina_impressa??null,
    pagina_tipo:proof.pagina_tipo||null
  };
}
function noEvidence(mode="aula"){
  return {
    ideia:"Não achei na biblioteca.",
    explicacao:[],
    provas:[],
    analogia:null,
    pergunta:"Quer tentar a pergunta com outras palavras?",
    proximo:null,
    nao_sei:true,
    modelo:"nenhum",
    modo:mode
  };
}
function buildCheckQuestion(idea=""){
  const clean=cleanText(idea,190).replace(/[.!?]+$/,"").trim();
  return clean?"Certo ou errado: "+clean+"?":"Entendeu a ideia principal?";
}

export function lessonKnowledgeQuery(question=""){
  const original=cleanText(question,600).replace(/[?!.,;:]+$/g,"").trim();
  let q=original;
  const prefixes=[
    /^(?:por\s+favor\s+)?(?:me\s+)?(?:explique|explica|explicar|defina|definir|descreva|diga|conte)\s+/iu,
    /^(?:o\s+que\s+(?:é|eh|são|sao|significa)|quem\s+(?:é|eh|foi)|qual\s+(?:é|eh)|quais\s+(?:são|sao))\s+/iu,
    /^(?:quero\s+saber\s+)(?:sobre|a\s+respeito\s+de)\s+/iu,
    /^(?:fale|falar|me\s+fale)\s+(?:sobre|a\s+respeito\s+de)\s+/iu,
    /^(?:o\s+que\s+(?:diz|fala)\s+(?:sobre|a\s+respeito\s+de))\s+/iu
  ];
  for(let pass=0;pass<3;pass++){
    const before=q;
    for(const re of prefixes)q=q.replace(re,"").trim();
    q=q.replace(/^(?:o|a|os|as|um|uma)\s+/iu,"").trim();
    if(q===before)break;
  }
  return q||original;
}

export function isSensitivePersonalQuestion(question=""){
  return PRIVATE_PATTERNS.some(re=>re.test(String(question||"")));
}

export function sanitizeLessonEvidence(rows=[]){
  const out=[];
  for(const [index,row] of (rows||[]).entries()){
    if(out.length>=3)break;
    if(row?.verified!==true && row?.citation_verified!==true)continue;
    if(String(row?.kind||"")==="scripture-page-window")continue;

    const trecho=cleanText(row?.text||row?.trecho_original||row?.trecho||"",1100);
    const ref=publicProofRef(row);
    if(!trecho||!ref)continue;
    if(/\b(?:GEE|TJS)\b/i.test(trecho))continue;
    if(/\.pdf\b|standard[-_ ]?works/i.test(ref))continue;

    const duplicate=out.some(existing=>
      nearDuplicate(existing.trecho_original,trecho) ||
      (row?.source_chunk_id && existing._source_key===String(row.source_chunk_id))
    );
    if(duplicate)continue;

    const paginaPdf=Number(row?.pdf_page??row?.pagina_pdf??row?.page??0)||null;
    const paginaImpressa=cleanText(row?.printed_page??row?.pagina_impressa??"",40)||null;
    out.push({
      id:proofId(row,index),
      ref,
      trecho,
      trecho_original:trecho,
      idioma_original:languageOf(row,trecho),
      traducao_pt:null,
      verified:true,
      titulo:cleanText(row?.title||row?.titulo||"",180),
      document_id:String(row?.document_id||""),
      pagina_pdf:paginaPdf,
      pagina_impressa:paginaImpressa,
      pagina_tipo:String(row?.page_basis||row?.pagina_tipo||(paginaImpressa?"impressa+pdf":(paginaPdf?"pdf":"")))||null,
      _source_key:String(row?.source_chunk_id||row?.id||"")
    });
  }
  return out;
}

export function buildLessonGeneratorPrompt({question,age,proofs,profile={}}){
  const ageText=Number.isFinite(Number(age))&&Number(age)>0?String(Math.max(6,Math.min(120,Number(age)))):"não informada";
  const memory=[
    profile?.theme?("tema_anterior="+cleanText(profile.theme,80)):"",
    profile?.last_check?("ultima_checagem="+cleanText(profile.last_check,80)):"",
    profile?.last_proof_id?("ultima_prova="+cleanText(profile.last_proof_id,40)):""
  ].filter(Boolean).join(" | ");

  return [
    "Você é somente o redator pedagógico local da Consciência Fabiano V4.",
    "Escreva em português do Brasil, de forma curta, clara e direta.",
    "NÃO cite fonte, livro, página, versículo, arquivo ou referência.",
    "NÃO use conhecimento externo. Use somente as PROVAS abaixo.",
    "Produza exatamente 2 afirmações se houver apoio suficiente.",
    "As 2 afirmações devem usar evidence_id DIFERENTES.",
    "A primeira afirmação deve responder diretamente à pergunta do aluno.",
    "Para cada afirmação, copie em support_quote uma passagem LITERAL da prova correspondente que sustente a afirmação.",
    "support_quote deve ser copiado exatamente; não traduza nem parafraseie o support_quote.",
    "Se uma prova não sustentar uma afirmação útil, não a use.",
    "Retorne JSON puro e nada mais.",
    '{"explicacao":[{"text":"afirmação em português","evidence_id":"ID","support_quote":"trecho literal da prova"}]}',
    "Idade do aluno: "+ageText,
    memory?("Memória mínima: "+memory):"Memória mínima: vazia",
    "Pergunta do aluno: "+cleanText(question,500),
    "PROVAS:",
    ...proofs.map(p=>p.id+" | "+p.trecho_original)
  ].join("\n");
}

export function buildEntailmentPrompt({question,claims=[]}){
  return [
    "Você é um verificador semântico local. Não responda à pergunta do aluno e não acrescente fatos.",
    "Para cada item, decida se a AFIRMAÇÃO decorre diretamente do TRECHO LITERAL fornecido.",
    "Marque supported=true somente quando o trecho sustentar a afirmação sem conhecimento externo e sem inferência nova.",
    "Se houver exagero, generalização, contradição, tradução incorreta ou informação ausente, use supported=false.",
    "Retorne JSON puro e nada mais.",
    '{"verdicts":[{"claim_id":"C1","supported":true}]}',
    "Pergunta original: "+cleanText(question,500),
    "ITENS:",
    ...claims.map((c,i)=>"C"+(i+1)+" | AFIRMAÇÃO: "+c.text+" | TRECHO LITERAL: "+c.support_quote)
  ].join("\n");
}

function parseDraft(raw){
  if(raw&&typeof raw==="object")return raw;
  const text=String(raw||"").trim().replace(/^\`\`\`(?:json)?/i,"").replace(/\`\`\`$/,"").trim();
  try{return JSON.parse(text);}catch{return {};}
}

export function judgeLessonDraft(raw,proofs=[]){
  const draft=parseDraft(raw);
  const proofMap=new Map(proofs.map(p=>[p.id,p]));
  const accepted=[];
  const sourceRejected=[];
  const usedIds=new Set();

  for(const item of Array.isArray(draft?.explicacao)?draft.explicacao:[]){
    const text=cleanText(item?.text||item?.frase||"",190);
    const evidenceId=String(item?.evidence_id||"").trim();
    const supportQuote=cleanText(item?.support_quote||"",520);
    const proof=proofMap.get(evidenceId);
    if(!text||!proof||usedIds.has(evidenceId))continue;
    if(/^\d{1,5}\b/.test(text)||!looksPortuguese(text))continue;
    if(SOURCE_LIKE.some(re=>re.test(text))){
      sourceRejected.push(text);
      continue;
    }
    if(!quoteBelongsToProof(supportQuote,proof))continue;
    accepted.push({text,evidence_id:evidenceId,support_quote:supportQuote,claim_id:"C"+(accepted.length+1)});
    usedIds.add(evidenceId);
    if(accepted.length>=2)break;
  }
  return {accepted,source_rejected:sourceRejected};
}

export function applyEntailmentVerdicts(raw,claims=[]){
  const parsed=parseDraft(raw);
  const verdicts=new Map(
    (Array.isArray(parsed?.verdicts)?parsed.verdicts:[])
      .map(v=>[String(v?.claim_id||"").trim(),v?.supported===true])
  );
  return claims.filter(c=>verdicts.get(String(c.claim_id))===true);
}

export async function buildLesson({
  question,age,mode="aula",evidence=[],profile={},generate=null,verify=null
}){
  const q=cleanText(question,600);
  const safeMode=["aula","livro","revisao"].includes(String(mode))?String(mode):"aula";

  if(isSensitivePersonalQuestion(q)){
    return {
      ideia:"Essa pergunta envolve informações pessoais ou íntimas.",
      explicacao:[],
      provas:[],
      analogia:null,
      pergunta:"Converse com um adulto de confiança sobre isso.",
      proximo:null,
      nao_sei:true,
      modelo:"guard-local",
      modo:safeMode,
      guard:"adulto"
    };
  }

  const proofs=sanitizeLessonEvidence(evidence);
  if(proofs.length<2)return noEvidence(safeMode);
  if(typeof generate!=="function"||typeof verify!=="function")return noEvidence(safeMode);

  let generated=null,judged={accepted:[]};
  try{
    const prompt=buildLessonGeneratorPrompt({question:q,age,proofs,profile});
    generated=await generate(prompt,{question:q,proofs,mode:safeMode});
    judged=judgeLessonDraft(generated?.content ?? generated,proofs);
  }catch{
    return noEvidence(safeMode);
  }
  if(judged.accepted.length<2)return noEvidence(safeMode);

  let verifiedClaims=[];
  try{
    const verifierPrompt=buildEntailmentPrompt({question:q,claims:judged.accepted});
    const verdict=await verify(verifierPrompt,{question:q,claims:judged.accepted,proofs,mode:safeMode});
    verifiedClaims=applyEntailmentVerdicts(verdict?.content ?? verdict,judged.accepted);
  }catch{
    return noEvidence(safeMode);
  }

  const distinct=new Map();
  for(const claim of verifiedClaims){
    if(!distinct.has(claim.evidence_id))distinct.set(claim.evidence_id,claim);
  }
  const claims=[...distinct.values()].slice(0,2);
  if(claims.length<2)return noEvidence(safeMode);

  const proofMap=new Map(proofs.map(p=>[p.id,p]));
  const usedProofs=claims.map(c=>proofMap.get(c.evidence_id)).filter(Boolean);
  if(usedProofs.length<2||nearDuplicate(usedProofs[0].trecho_original,usedProofs[1].trecho_original))return noEvidence(safeMode);

  const idea=cleanText(claims[0].text,190);
  const explanation=claims.slice(1).map(x=>cleanText(x.text,190)).filter(Boolean);
  if(!idea||!explanation.length)return noEvidence(safeMode);

  return {
    ideia:idea,
    explicacao:explanation,
    provas:usedProofs.map(publicProof),
    analogia:null,
    pergunta:buildCheckQuestion(idea),
    proximo:null,
    nao_sei:false,
    modelo:String(generated?.model||"qwen3:0.6b"),
    verificador:String((verifiedClaims.length?"qwen3:0.6b":"nenhum")),
    verificacao:"support_quote_literal+entailment_local",
    modo:safeMode
  };
}

export function lessonSpeechText(lesson={}){
  if(lesson?.nao_sei)return lesson?.guard==="adulto"
    ?[lesson.ideia,lesson.pergunta].filter(Boolean).join("\n")
    :"Não achei na biblioteca.";
  return [lesson.ideia,...(lesson.explicacao||[])].filter(Boolean).join("\n");
}

export function lessonToPlainText(lesson={}){
  if(lesson?.nao_sei&&lesson?.guard==="adulto")return lesson.ideia+"\n\n"+lesson.pergunta;
  if(lesson?.nao_sei)return "Não achei na biblioteca.";
  const proofText=(lesson.provas||[]).map((p,i)=>{
    const label=p.idioma_original&&p.idioma_original!=="pt"?"Trecho original ("+p.idioma_original+")":"Trecho original";
    return "Prova "+(i+1)+": "+p.ref+"\n"+label+": "+p.trecho_original;
  }).join("\n\n");
  return [
    "Ideia: "+lesson.ideia,
    ...(lesson.explicacao||[]).map(x=>"Explicação: "+x),
    proofText,
    "Entendeu? "+String(lesson.pergunta||"")
  ].filter(Boolean).join("\n\n");
}

async function sqliteApi(){
  try{return await import("node:sqlite");}
  catch{return null;}
}

export async function createLessonProfileStore(root){
  const api=await sqliteApi();
  if(!api?.DatabaseSync){
    let memory={theme:"",last_check:"",last_proof_id:"",updated_at:""};
    return {
      persistent:false,
      read:()=>({...memory}),
      write:patch=>{memory={...memory,...patch,updated_at:new Date().toISOString()};return {...memory};}
    };
  }
  const dir=path.join(root,".fns-local");
  await mkdir(dir,{recursive:true});
  const db=new api.DatabaseSync(path.join(dir,"v4-profile.sqlite"));
  db.exec("CREATE TABLE IF NOT EXISTS lesson_profile(id INTEGER PRIMARY KEY CHECK(id=1),theme TEXT NOT NULL DEFAULT '',last_check TEXT NOT NULL DEFAULT '',last_proof_id TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL DEFAULT '');");
  db.prepare("INSERT OR IGNORE INTO lesson_profile(id) VALUES(1)").run();
  return {
    persistent:true,
    read:()=>db.prepare("SELECT theme,last_check,last_proof_id,updated_at FROM lesson_profile WHERE id=1").get()||{},
    write:patch=>{
      const current=db.prepare("SELECT theme,last_check,last_proof_id FROM lesson_profile WHERE id=1").get()||{};
      const next={
        theme:cleanText(patch?.theme ?? current.theme,100),
        last_check:cleanText(patch?.last_check ?? current.last_check,100),
        last_proof_id:cleanText(patch?.last_proof_id ?? current.last_proof_id,60),
        updated_at:new Date().toISOString()
      };
      db.prepare("UPDATE lesson_profile SET theme=?,last_check=?,last_proof_id=?,updated_at=? WHERE id=1")
        .run(next.theme,next.last_check,next.last_proof_id,next.updated_at);
      return next;
    }
  };
}
