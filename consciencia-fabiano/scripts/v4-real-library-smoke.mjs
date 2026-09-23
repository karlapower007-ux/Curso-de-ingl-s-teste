import assert from "node:assert/strict";
import {readFile,readdir} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {buildV3EvidenceIndex,searchV3Evidence} from "./v3-evidence-core.mjs";
import {buildLesson} from "./v4-lesson-core.mjs";

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
const aliases=JSON.parse(await readFile(path.join(root,"public","v2-aliases.json"),"utf8"));
const index=buildV3EvidenceIndex(rows);
const search=searchV3Evidence(index,"O que é o mundo espiritual?",aliases,{limit:12,strict:false});
assert.ok(search.results.length>=3,"V4 precisa de pelo menos três evidências candidatas reais");

const lesson=await buildLesson({
  question:"O que é o mundo espiritual?",
  age:12,
  mode:"aula",
  evidence:search.results.slice(0,6).map(x=>({...x,citation_verified:x.verified===true})),
  profile:{theme:"",last_check:"",last_proof_id:""},
  generate:async prompt=>{
    const ids=[...String(prompt).matchAll(/^(E\d+-[^ |]+)\s*\|/gm)].map(m=>m[1]);
    return {
      model:"qwen3:0.6b",
      content:JSON.stringify({
        explicacao:[
          {text:"É um estado relacionado à condição dos espíritos após a morte.",evidence_id:ids[0]},
          {text:"As provas recuperadas mostram que esse estado antecede a ressurreição.",evidence_id:ids[1]||ids[0]}
        ],
        pergunta:"Certo ou errado: o mundo dos espíritos é apresentado como um estado temporário?"
      })
    };
  }
});

assert.equal(lesson.nao_sei,false);
assert.ok(lesson.provas.length>=2&&lesson.provas.length<=3);
assert.ok(lesson.provas.every(p=>p.verified===true));
assert.ok(lesson.provas.every(p=>!/(?:GEE|TJS)/i.test(p.trecho)));
assert.ok(lesson.provas.every(p=>!/\.pdf|standard-works/i.test(p.ref)));
assert.ok(lesson.explicacao.length>=1&&lesson.explicacao.length<=3);
assert.ok(!JSON.stringify(lesson).includes("standard-works"));

console.log("V4_REAL_EXAMPLE="+JSON.stringify({
  question:"O que é o mundo espiritual?",
  lesson
},null,2));
