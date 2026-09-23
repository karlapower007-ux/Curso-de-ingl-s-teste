import path from "node:path";
import {mkdir} from "node:fs/promises";

export const V4_VERSION="4.0.0-lesson-grounded";

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
  /\b(?:[1-4]\s+)?[A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-Za-zÀ-ÿ.-]{1,30}\s+\d{1,4}:\d{1,4}\b/u
];

function cleanText(value,max=500){
  return String(value||"").replace(/\s+/g," ").trim().slice(0,max);
}
function firstSentence(value,max=220){
  const text=cleanText(value,1200);
  if(!text)return "";
  const m=text.match(/^.*?[.!?](?:\s|$)/u);
  return cleanText(m?m[0]:text,max);
}
function publicProofRef(row={}){
  return cleanText(row.reference||row.ref||"",180);
}
function proofId(row,index){
  const raw=String(row.id||row.source_chunk_id||row.reference||("E"+(index+1)));
  return "E"+(index+1)+"-"+raw.replace(/[^A-Za-z0-9_-]/g,"").slice(0,24);
}

export function isSensitivePersonalQuestion(question=""){
  const q=String(question||"");
  return PRIVATE_PATTERNS.some(re=>re.test(q));
}

export function sanitizeLessonEvidence(rows=[]){
  const out=[];
  const seen=new Set();
  for(const [index,row] of (rows||[]).entries()){
    if(out.length>=3)break;
    if(row?.verified!==true && row?.citation_verified!==true)continue;
    if(String(row?.kind||"")==="scripture-page-window")continue;
    const trecho=cleanText(row?.text||row?.trecho||"",900);
    const ref=publicProofRef(row);
    if(!trecho||!ref)continue;
    if(/\b(?:GEE|TJS)\b/i.test(trecho))continue;
    if(/\.pdf\b|standard[-_ ]?works/i.test(ref))continue;
    const key=ref+"|"+trecho.slice(0,180);
    if(seen.has(key))continue;
    seen.add(key);
    out.push({
      id:proofId(row,index),
      ref,
      trecho,
      verified:true
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
    "Você é o redator pedagógico local da Consciência Fabiano V4.",
    "NÃO cite fonte, livro, página, versículo, arquivo ou referência.",
    "NÃO use conhecimento externo. Use somente as PROVAS abaixo.",
    "Retorne JSON puro e nada mais.",
    '{"explicacao":[{"text":"frase curta","evidence_id":"ID"}],"pergunta":"checagem curta"}',
    "Cada frase precisa de um evidence_id existente.",
    "No máximo 3 frases curtas de explicação, total de aproximadamente 6 linhas.",
    "A pergunta deve checar uma única ideia, de preferência certo/errado ou escolha simples.",
    "Idade do aluno: "+ageText,
    memory?("Memória mínima: "+memory):"Memória mínima: vazia",
    "Pergunta do aluno: "+cleanText(question,500),
    "PROVAS:",
    ...proofs.map(p=>p.id+" | "+p.trecho)
  ].join("\n");
}

function parseDraft(raw){
  if(raw&&typeof raw==="object")return raw;
  const text=String(raw||"").trim().replace(/^```(?:json)?/i,"").replace(/```$/,"").trim();
  try{return JSON.parse(text);}catch{return {};}
}

export function judgeLessonDraft(raw,proofs=[]){
  const draft=parseDraft(raw);
  const validIds=new Set(proofs.map(p=>p.id));
  const accepted=[];
  const sourceRejected=[];

  for(const item of Array.isArray(draft?.explicacao)?draft.explicacao:[]){
    const text=cleanText(item?.text||item?.frase||"",260);
    const evidenceId=String(item?.evidence_id||"").trim();
    if(!text||!validIds.has(evidenceId))continue;
    if(SOURCE_LIKE.some(re=>re.test(text))){
      sourceRejected.push(text);
      continue;
    }
    accepted.push({text,evidence_id:evidenceId});
    if(accepted.length>=3)break;
  }

  let pergunta=cleanText(draft?.pergunta||"",180);
  if(SOURCE_LIKE.some(re=>re.test(pergunta)))pergunta="";
  if(!pergunta)pergunta="Certo ou errado: essa ideia está apoiada pelas provas mostradas?";

  return {accepted,pergunta,source_rejected:sourceRejected};
}

function deterministicIdea(proofs){
  const idea=firstSentence(proofs[0]?.trecho||"",190);
  return idea||"A biblioteca trouxe evidências verificadas sobre este tema.";
}

function rawEvidenceFallback(proofs){
  return proofs.slice(0,2).map(p=>firstSentence(p.trecho,220)).filter(Boolean);
}

export async function buildLesson({
  question,age,mode="aula",evidence=[],profile={},generate=null
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
  if(!proofs.length){
    return {
      ideia:"Não achei na biblioteca.",
      explicacao:[],
      provas:[],
      analogia:null,
      pergunta:"Quer tentar a pergunta com outras palavras?",
      proximo:null,
      nao_sei:true,
      modelo:"nenhum",
      modo:safeMode
    };
  }

  let judged={accepted:[],pergunta:""};
  let model="v3-cru";
  if(typeof generate==="function"){
    try{
      const prompt=buildLessonGeneratorPrompt({question:q,age,proofs,profile});
      const generated=await generate(prompt,{question:q,proofs,mode:safeMode});
      judged=judgeLessonDraft(generated?.content ?? generated,proofs);
      if(judged.accepted.length)model=String(generated?.model||"qwen3:0.6b");
    }catch{}
  }

  let explanation=judged.accepted.map(x=>x.text);
  if(!explanation.length){
    explanation=rawEvidenceFallback(proofs);
    model="v3-cru";
  }

  if(!explanation.length){
    return {
      ideia:"Não achei na biblioteca.",
      explicacao:[],
      provas:[],
      analogia:null,
      pergunta:"Quer tentar a pergunta com outras palavras?",
      proximo:null,
      nao_sei:true,
      modelo:"nenhum",
      modo:safeMode
    };
  }

  return {
    ideia:deterministicIdea(proofs),
    explicacao:explanation.slice(0,3),
    provas:proofs,
    analogia:null,
    pergunta:judged.pergunta||"Certo ou errado: essa ideia está apoiada pelas provas mostradas?",
    proximo:null,
    nao_sei:false,
    modelo:model,
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
  if(lesson?.nao_sei&&lesson?.guard==="adulto"){
    return lesson.ideia+"\n\n"+lesson.pergunta;
  }
  if(lesson?.nao_sei)return "Não achei na biblioteca.";
  const proofText=(lesson.provas||[]).map((p,i)=>"Prova "+(i+1)+": "+p.ref+"\n"+p.trecho).join("\n\n");
  return [
    lesson.ideia,
    ...(lesson.explicacao||[]),
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
