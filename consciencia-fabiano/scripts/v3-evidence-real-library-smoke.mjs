import assert from "node:assert/strict";
import {readFile,readdir} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {buildV3EvidenceIndex,searchV3Evidence,v3Fold} from "./v3-evidence-core.mjs";

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(__dirname,"..");
const backupDir=path.join(root,"public","biblioteca_backup");
const names=(await readdir(backupDir)).filter(x=>/^part-\d+\.json$/i.test(x)).sort();

const rows=[];
for(const name of names){
  const parsed=JSON.parse(await readFile(path.join(backupDir,name),"utf8"));
  const chunks=Array.isArray(parsed)?parsed:(Array.isArray(parsed?.chunks)?parsed.chunks:[]);
  for(const row of chunks){
    if(String(row?.text||"").trim())rows.push(row);
  }
}

assert.ok(rows.length>=25000,"biblioteca real deve preservar pelo menos 25 mil registros");

const aliases=JSON.parse(await readFile(path.join(root,"public","v2-aliases.json"),"utf8"));
const started=Date.now();
const index=buildV3EvidenceIndex(rows);
const buildMs=Date.now()-started;
const heapMb=Math.round(process.memoryUsage().heapUsed/1024/1024);

assert.equal(index.source_rows,rows.length,"V3 deve derivar do backup real sem alterar o Dicionário");
assert.ok(index.units.length>=10000,"V3 deve produzir um índice documental substancial");

const queries=[
  "Explica sobre o mundo espiritual",
  "Explique detalhadamente o que aconteceu na vida pré-mortal"
];

function worldRelevant(text){
  const f=v3Fold(text);
  return f.includes("mundo dos espirit") ||
    f.includes("mundo de los espirit") ||
    f.includes("spirit world") ||
    f.includes("world of spirit") ||
    (f.includes("mundo")&&f.includes("espirit"));
}
function premortalRelevant(text){
  const f=v3Fold(text);
  return f.includes("vida pre-mortal") ||
    f.includes("premortal") ||
    f.includes("pre-mortal") ||
    f.includes("preexist") ||
    f.includes("pre-exist") ||
    f.includes("before we came") ||
    f.includes("before the world") ||
    f.includes("before mortal") ||
    f.includes("before birth");
}

const report=[];
for(const query of queries){
  const result=searchV3Evidence(index,query,aliases,{limit:20,strict:false});
  assert.ok(result.results.length>0,"V3 deve encontrar evidência real para: "+query);
  assert.ok(result.results.every(x=>x.verified===true),"toda evidência V3 precisa estar marcada como verificada");
  assert.ok(result.results.every(x=>!String(x.reference||"").toLowerCase().includes(".pdf")),"referência pública não pode vazar nome físico de PDF");
  assert.ok(result.results.every(x=>!String(x.reference||"").toLowerCase().includes("standard-works")),"Obras Padrão não podem vazar nome técnico do arquivo");
  assert.ok(result.results.every(x=>x.kind!=="scripture-page-window"),"Chat V3 não pode usar faixa bíblica ampla sem versículo preciso");
  assert.ok(result.results.every(x=>!v3Fold(x.text).includes("gee ")),"Chat V3 não pode exibir aparato GEE como evidência");
  assert.ok(result.results.every(x=>x.focus_verified===true),"todo resultado exibido precisa ter janela de foco validada");
  const top=result.results.slice(0,10);
  if(query.includes("mundo espiritual")){
    assert.ok(top.length>=5,"mundo espiritual deve ter fluxo documental suficiente");
    assert.ok(top.every(x=>worldRelevant(x.text)),"mundo espiritual não pode aceitar evidência com apenas a palavra espírito");
  }
  if(query.includes("vida pré-mortal")){
    console.error("V3_PREMORTAL_DIAGNOSTIC="+JSON.stringify(top.map(x=>({
      reference:x.reference,kind:x.kind,score:x.score,text:x.text
    }))));
    assert.ok(top.length>=5,"vida pré-mortal deve ter fluxo documental suficiente");
    assert.ok(top.every(x=>!v3Fold(x.text).includes("gee vida pre-mortal")),"nota GEE não pode ser evidência de vida pré-mortal");
    assert.ok(top.slice(0,5).every(x=>premortalRelevant(x.text)),"os cinco primeiros resultados de vida pré-mortal devem começar em conteúdo substantivo do tema");
  }
  report.push({
    query,
    total_candidates:result.total,
    returned:result.results.length,
    top:result.results.slice(0,5).map(x=>({reference:x.reference,kind:x.kind,score:Number(x.score||0).toFixed(2),text:String(x.text||"").slice(0,180)}))
  });
}

console.log(JSON.stringify({
  ok:true,
  source_rows:rows.length,
  evidence_units:index.units.length,
  counts:index.counts,
  build_ms:buildMs,
  heap_mb:heapMb,
  queries:report
},null,2));
