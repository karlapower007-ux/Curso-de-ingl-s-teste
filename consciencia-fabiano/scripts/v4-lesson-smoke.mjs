import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import {mkdtemp,mkdir,writeFile,rm,readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {
  buildLesson,sanitizeLessonEvidence,judgeLessonDraft,lessonToPlainText,createLessonProfileStore
} from "./v4-lesson-core.mjs";
import {buildV3EvidenceIndex} from "./v3-evidence-core.mjs";
import {ensurePersistentV3,searchPersistentV3,persistentV3Health} from "./v3-persistent-index.mjs";

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(__dirname,"..");

const evidence=[
  {id:"a",kind:"book-paragraph",reference:"Livro Teste • página 10",text:"O mundo dos espíritos é um estado onde os espíritos aguardam a ressurreição.",verified:true},
  {id:"b",kind:"book-paragraph",reference:"Livro Teste • página 11",text:"No mundo dos espíritos, o evangelho pode ser ensinado àqueles que não o receberam em mortalidade.",verified:true},
  {id:"c",kind:"book-paragraph",reference:"Livro Teste • página 12",text:"A ressurreição põe fim ao estado temporário do mundo dos espíritos.",verified:true},
  {id:"bad1",kind:"scripture-page-window",reference:"standard-works.pdf",text:"GEE Mundo dos Espíritos",verified:true},
  {id:"bad2",kind:"book-paragraph",reference:"Livro Ruim • página 1",text:"Texto sem selo.",verified:false}
];

const safe=sanitizeLessonEvidence(evidence);
assert.equal(safe.length,3,"V4 deve usar no máximo três provas verificadas");
assert.ok(safe.every(x=>x.verified===true));
assert.ok(safe.every(x=>!x.ref.includes(".pdf")));
assert.ok(safe.every(x=>!x.trecho.includes("GEE")));

const lesson=await buildLesson({
  question:"O que é o mundo espiritual?",
  age:12,
  evidence,
  profile:{theme:"vida pré-mortal",last_check:"certo",last_proof_id:"E1"},
  generate:async prompt=>({
    model:"qwen3:0.6b",
    content:JSON.stringify({
      explicacao:[
        {text:"É um estado temporário após a morte.",evidence_id:safe[0].id},
        {text:"Segundo Alma 40:11, isso é assim.",evidence_id:safe[0].id},
        {text:"Ali os espíritos aguardam a ressurreição.",evidence_id:safe[2].id},
        {text:"Frase com id inventado.",evidence_id:"E999"}
      ],
      pergunta:"Certo ou errado: o mundo dos espíritos é temporário?"
    })
  })
});
assert.equal(lesson.nao_sei,false);
assert.ok(lesson.provas.length<=3);
assert.equal(lesson.modelo,"qwen3:0.6b");
assert.equal(lesson.explicacao.length,2,"juiz deve apagar frase com referência nova e id inválido");
assert.ok(lesson.explicacao.every(x=>!x.includes("Alma 40:11")));
assert.ok(lessonToPlainText(lesson).includes("Entendeu?"));

const oneProof=await buildLesson({
  question:"Tema com evidência insuficiente",
  evidence:[evidence[0]]
});
assert.equal(oneProof.nao_sei,true,"Aula V4 exige no mínimo duas provas verificadas");
assert.equal(oneProof.ideia,"Não achei na biblioteca.");
assert.equal(oneProof.provas.length,0);

const noEvidence=await buildLesson({question:"Tema inexistente",evidence:[]});
assert.equal(noEvidence.nao_sei,true);
assert.equal(noEvidence.ideia,"Não achei na biblioteca.");
assert.equal(noEvidence.provas.length,0);

const privateQuestion=await buildLesson({question:"Qual é o meu endereço e o medo da minha família?",evidence});
assert.equal(privateQuestion.nao_sei,true);
assert.equal(privateQuestion.guard,"adulto");
assert.equal(privateQuestion.provas.length,0);

const judged=judgeLessonDraft({
  explicacao:[{text:"Nova fonte página 999",evidence_id:safe[0].id}],
  pergunta:"Veja Livro 1:2"
},safe);
assert.equal(judged.accepted.length,0,"LLM não pode introduzir referência visível");

const tmp=await mkdtemp(path.join(os.tmpdir(),"fns-v4-"));
try{
  const publicDir=path.join(tmp,"public");
  const backupDir=path.join(publicDir,"biblioteca_backup");
  await mkdir(backupDir,{recursive:true});
  const rows=[
    {id:"r1",document_id:"d1",title:"Livro Teste",page:10,chunk_index:1,text:"O mundo dos espíritos é um estado temporário após a morte."},
    {id:"r2",document_id:"d1",title:"Livro Teste",page:11,chunk_index:2,text:"No mundo dos espíritos os espíritos aguardam a ressurreição."}
  ];
  await writeFile(path.join(backupDir,"part-0000.json"),JSON.stringify({chunks:rows}),"utf8");

  const state1=await ensurePersistentV3({
    root:tmp,publicDir,
    buildIndex:buildV3EvidenceIndex,
    loadRows:async()=>rows
  });
  const health1=persistentV3Health(state1);
  assert.ok(health1.library_hash.length>=32,"V3 persistente deve ter hash da biblioteca");

  const found=searchPersistentV3(state1,"mundo espiritual",{"mundo dos espíritos":["mundo espiritual","spirit world"]},{limit:5});
  assert.ok(found.results.length>=1,"V3 persistente deve pesquisar evidência");

  const state2=await ensurePersistentV3({
    root:tmp,publicDir,
    buildIndex:buildV3EvidenceIndex,
    loadRows:async()=>{throw new Error("não deveria reconstruir se hash não mudou");}
  });
  if(state2.persistent)assert.equal(state2.reused,true,"SQLite deve ser reutilizado quando hash não muda");

  const store=await createLessonProfileStore(tmp);
  store.write({theme:"mundo espiritual",last_check:"certo",last_proof_id:"E1"});
  const profile=store.read();
  assert.equal(profile.theme,"mundo espiritual");
  assert.ok(!("age" in profile),"perfil persistente não deve guardar idade");
}finally{
  await rm(tmp,{recursive:true,force:true});
}

const [server,ui,engine]=await Promise.all([
  readFile(path.join(root,"scripts","v2-local-server.mjs"),"utf8"),
  readFile(path.join(root,"public","v2-local-ui.js"),"utf8"),
  readFile(path.join(root,"public","v2-local-engine.js"),"utf8")
]);
assert.ok(server.includes('url.pathname==="/api/v4/lesson"'));
assert.ok(server.includes('url.pathname==="/api/v4/health"'));
assert.ok(!server.includes('/api/v4/dictionary'),"V4 não pode criar Dicionário próprio");
assert.ok(server.includes('url.pathname==="/api/v2/dictionary"'),"Dicionário V2 deve permanecer");
assert.ok(server.includes("generatorQueue=Promise.resolve()"),"gerador deve operar em fila única");
assert.ok(ui.includes('call("/api/v4/lesson"'),"UI Aula deve chamar V4");
assert.ok(ui.includes('call("/api/v3/chat"'),"modo Livro deve preservar V3");
assert.ok(ui.includes('call("/api/v2/dictionary"'),"Dicionário deve continuar na V2");
assert.ok(engine.includes("exactSearch"),"motor do Dicionário permanece presente e não foi substituído");

console.log(JSON.stringify({
  ok:true,
  v4:"lesson-grounded",
  proofs_max:3,
  dictionary_frozen:true,
  v3_persistence_tested:true,
  personal_guard:true,
  llm_reference_judge:true
},null,2));
