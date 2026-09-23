import assert from "node:assert/strict";
import {readFile,readdir} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {buildV3EvidenceIndex,searchV3Evidence,formatV3EvidenceAnswer} from "./v3-evidence-core.mjs";
import {exactAndMatches} from "./v2-local-core.mjs";
import {buildLesson,lessonToPlainText,lessonSpeechText,sanitizeLessonEvidence,lessonKnowledgeQuery} from "./v4-lesson-core.mjs";

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(__dirname,"..");
const backupDir=path.join(root,"public","biblioteca_backup");
const names=(await readdir(backupDir)).filter(x=>/^part-\d+\.json$/i.test(x)).sort();
const rows=[];
for(const name of names){
  const parsed=JSON.parse(await readFile(path.join(backupDir,name),"utf8"));
  const chunks=Array.isArray(parsed)?parsed:(Array.isArray(parsed?.chunks)?parsed.chunks:[]);
  for(const row of chunks)if(String(row?.text||"").trim())rows.push(row);
}

const normalize=v=>String(v||"").replace(/\s+/g," ").trim();
const rowId=row=>String(row?.id||row?.key||"").trim();
const byId=new Map(rows.map(row=>[rowId(row),row]).filter(([id])=>id));

function explicitPrintedPage(row={}){
  for(const key of ["printed_page","page_printed","printedPage","physical_page","physicalPage"]){
    const v=String(row?.[key]??"").trim();
    if(v)return v;
  }
  return null;
}
function publicTitle(row={},fallback=""){
  const raw=String(row.title||row.source_title||fallback||"").replace(/\.pdf$/i,"");
  return raw.replace(/[_-]+/g," ").replace(/\s+/g," ").trim();
}
function verifiedBookCandidate(candidate){
  const source=byId.get(String(candidate.source_chunk_id||"").trim());
  if(!source)return null;
  if(!normalize(source.text).includes(normalize(candidate.text)))return null;
  const title=publicTitle(source,candidate.title);
  const pdfPage=Number(source.pdf_page??source.page??candidate.page??0)||null;
  const printedPage=explicitPrintedPage(source);
  const reference=printedPage
    ?title+" • página impressa "+printedPage+(pdfPage?" • PDF p. "+pdfPage:"")
    :(pdfPage?title+" • PDF p. "+pdfPage:title);
  return {
    ...candidate,
    title,
    reference,
    verified:true,
    citation_verified:true,
    pdf_page:pdfPage,
    printed_page:printedPage,
    page_basis:printedPage?"printed+pdf":(pdfPage?"pdf":"title-only"),
    authority:source
  };
}

const aliases=JSON.parse(await readFile(path.join(root,"public","v2-aliases.json"),"utf8"));
const index=buildV3EvidenceIndex(rows);
const search=searchV3Evidence(index,"O que é o mundo espiritual?",aliases,{limit:20,strict:false});
const verified=search.results.map(verifiedBookCandidate).filter(Boolean);
assert.ok(verified.length>=2,"V4 precisa de pelo menos duas evidências reais que possam voltar ao registro autoritativo");

const chosen=verified.slice(0,3);
for(const item of chosen){
  assert.ok(item.title,"título público precisa existir no registro");
  assert.ok(normalize(item.authority.text).includes(normalize(item.text)),"trecho V3 precisa existir literalmente no registro");
  if(item.printed_page){
    assert.ok(item.reference.includes("página impressa "+item.printed_page));
    if(item.pdf_page)assert.ok(item.reference.includes("PDF p. "+item.pdf_page));
  }else if(item.pdf_page){
    assert.ok(item.reference.includes("PDF p. "+item.pdf_page),"sem metadado impresso explícito, página deve ser rotulada como PDF");
  }
}

const safe=sanitizeLessonEvidence(chosen);
assert.ok(safe.length>=2);
const q1=safe[0].trecho_original;
const q2=safe[1].trecho_original;

const lesson=await buildLesson({
  question:"O que é o mundo espiritual?",
  age:12,
  mode:"aula",
  evidence:chosen,
  profile:{theme:"",last_check:"",last_proof_id:""},
  generate:async()=>({
    model:"qwen3:0.6b",
    content:JSON.stringify({explicacao:[
      {
        text:"O mundo dos espíritos é apresentado pela fonte como um estado após a morte.",
        evidence_id:safe[1].id,
        support_quote:q2
      },
      {
        text:"Nesse estado, a fonte afirma que o evangelho é declarado às pessoas ali mencionadas.",
        evidence_id:safe[0].id,
        support_quote:q1
      }
    ]})
  }),
  verify:async()=>({
    model:"qwen3:0.6b",
    content:JSON.stringify({verdicts:[
      {claim_id:"C1",supported:true},
      {claim_id:"C2",supported:true}
    ]})
  })
});

assert.equal(lesson.nao_sei,false);
assert.equal(lesson.provas.length,2);
assert.ok(lesson.provas.every(p=>p.verified===true));
assert.ok(lesson.provas.every(p=>!/(?:GEE|TJS)/i.test(p.trecho_original)));
assert.ok(lesson.provas.every(p=>!/\.pdf|standard-works/i.test(p.ref)));
assert.ok(lesson.provas.every(p=>p.traducao_pt===null),"trecho original não pode ser disfarçado de tradução");
assert.ok(!/^\d/.test(lesson.ideia));
assert.ok(/[áàâãéêíóôõúç]|\b(o|a|de|do|da|é|como|uma|um|após|estado)\b/i.test(lesson.ideia),"ideia deve estar em português");
assert.equal(lesson.explicacao.length,1);
assert.ok(!JSON.stringify(lesson).includes("standard-works"));

console.log("V4_REAL_AUTHORITY_PROOF="+JSON.stringify(chosen.slice(0,2).map(x=>({
  title:x.title,
  reference:x.reference,
  pdf_page:x.pdf_page,
  printed_page:x.printed_page,
  source_chunk_id:x.source_chunk_id,
  excerpt_verified:normalize(x.authority.text).includes(normalize(x.text))
})),null,2));

console.log("V4_REAL_EXAMPLE="+JSON.stringify({
  question:"O que é o mundo espiritual?",
  lesson
},null,2));

console.log("V4_VISIBLE_EXAMPLE=\n"+lessonToPlainText(lesson));

const bookVisible=formatV3EvidenceAnswer(search,"explain");
assert.ok(bookVisible.length>80,"modo Livro deve continuar exibindo evidência V3 real");
console.log("V3_BOOK_VISIBLE=\n"+bookVisible.slice(0,1800));

const review=await buildLesson({
  question:"Revise comigo: o que é o mundo espiritual?",
  age:12,
  mode:"revisao",
  evidence:chosen,
  profile:{theme:"mundo espiritual",last_check:lesson.pergunta,last_proof_id:lesson.provas[0].id},
  generate:async()=>({
    model:"qwen3:0.6b",
    content:JSON.stringify({explicacao:[
      {text:"A fonte situa o mundo dos espíritos após a morte.",evidence_id:safe[1].id,support_quote:q2},
      {text:"A outra fonte diz que o evangelho é declarado no mundo dos espíritos.",evidence_id:safe[0].id,support_quote:q1}
    ]})
  }),
  verify:async()=>({content:JSON.stringify({verdicts:[
    {claim_id:"C1",supported:true},{claim_id:"C2",supported:true}
  ]})})
});
assert.equal(review.nao_sei,false);
assert.equal(review.modo,"revisao");
console.log("V4_REVIEW_VISIBLE=\n"+lessonToPlainText(review));

const atonementQuestion="O que é a expiação?";
const atonementQuery=lessonKnowledgeQuery(atonementQuestion);
assert.equal(atonementQuery,"expiação","Aula deve reduzir pergunta natural ao conceito pesquisável sem alterar o Dicionário V2");
const atonementDictionary=exactAndMatches(rows,atonementQuery,{aliases,page:1,pageSize:12});
assert.ok(atonementDictionary.total>=2,"A biblioteca real deve conter pelo menos duas ocorrências verificáveis de expiação para fallback da Aula");
assert.ok(atonementDictionary.matches.length>=2,"Fallback doutrinário precisa de duas provas estritas para expiação");
const atonementAll=[];
for(let page=1;page<=Math.min(8,atonementDictionary.pages);page++){
  const batch=exactAndMatches(rows,atonementQuery,{aliases,page,pageSize:100});
  atonementAll.push(...batch.matches);
}
const atonementUsable=atonementAll.filter(x=>{
  const text=String(x?.text||"").replace(/\s+/g," ").trim();
  return text.length>=100 && text.split(/\s+/).length>=18 && !/\b(?:GEE|TJS)\b/i.test(text);
});
assert.ok(atonementUsable.length>=2,"Expiação deve ter pelo menos duas provas substantivas, não apenas remissões GEE/TJS");
assert.ok(atonementUsable.some(x=>Number(x.page||0)>=180&&Number(x.page||0)<=220),"A prova substantiva de expiação deve alcançar o bloco bíblico de Levítico disponível no acervo");
const atonementFallbackLesson=await buildLesson({
  question:atonementQuestion,
  age:12,
  mode:"aula",
  evidence:atonementUsable.slice(0,6).map((x,i)=>({
    ...x,
    id:"at-real-"+i,
    source_chunk_id:String(x.id||x.key||("at-real-"+i)),
    kind:"book-paragraph",
    reference:"Fonte verificada • PDF p. "+String(x.page||""),
    pdf_page:Number(x.page||0)||null,
    verified:true,
    citation_verified:true
  })),
  generate:async()=>({model:"qwen3:0.6b",content:"not-json"}),
  verify:async()=>({model:"qwen3:0.6b",content:"{}"})
});
assert.equal(atonementFallbackLesson.nao_sei,false,"Expiação tem provas reais suficientes; falha do redator local não pode produzir 'Não achei na biblioteca'");
assert.equal(atonementFallbackLesson.fallback_literal,true);
assert.equal(atonementFallbackLesson.provas.length,2);

console.log("V4_ATONEMENT_DICTIONARY_FALLBACK="+JSON.stringify({
  question:atonementQuestion,
  query:atonementQuery,
  total:atonementDictionary.total,
  strict_total:atonementDictionary.total,
  usable_total:atonementUsable.length,
  proofs:atonementUsable.slice(0,3).map(x=>({document_id:x.document_id,page:x.page,reference:x.reference,text:String(x.text||"").slice(0,260)}))
},null,2));

const dictionary=exactAndMatches(rows,"Adão",{aliases,page:1,pageSize:3});
assert.ok(dictionary.total>0,"Dicionário V2 real deve continuar encontrando Adão");
assert.ok(dictionary.matches.length>0);
console.log("V2_DICTIONARY_VISIBLE="+JSON.stringify({
  query:"Adão",total:dictionary.total,page:dictionary.page,page_size:dictionary.page_size,
  first:dictionary.matches.slice(0,3).map(x=>({reference:x.reference,text:String(x.text||"").slice(0,220)}))
},null,2));

const speech=lessonSpeechText(lesson);
assert.ok(speech.includes(lesson.ideia));
assert.ok(!speech.includes("PDF p."),"voz V4 deve ler só ideia e explicação, não referências");
assert.ok(!speech.includes("Prova 1"),"voz V4 não deve ler os blocos de prova");
console.log("V4_VOICE_VISIBLE="+speech);
