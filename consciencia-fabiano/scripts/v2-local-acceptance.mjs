import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {
  V2_VERSION,splitConcepts,exactAndMatches,formatExactAnswer,buildPrompt,chooseInstalledModel
} from "./v2-local-core.mjs";

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(__dirname,"..");

const aliases={
  "plano de salvação":["plan of salvation","plano de redenção"],
  "vida pré-mortal":["premortal life","preexistência"]
};
const rows=[
  {id:"a",document_id:"d1",title:"Livro A",page:10,chunk_index:1,text:"O Plano de Salvação inclui ensinamentos sobre a Vida Pré-Mortal e a mortalidade."},
  {id:"b",document_id:"d1",title:"Livro A",page:11,chunk_index:2,text:"O Plano de Salvação é apresentado aqui.\n\nOutro parágrafo separado menciona a Vida Pré-Mortal."},
  {id:"c",document_id:"d2",title:"Livro B",page:7,chunk_index:3,text:"The plan of salvation discusses premortal life in the same paragraph."}
];

assert.equal(V2_VERSION,"2.0.0-local-first");
const concepts=splitConcepts("Plano de Salvação e Vida Pré-Mortal",aliases);
assert.equal(concepts.length,2);
const exact=exactAndMatches(rows,"Plano de Salvação e Vida Pré-Mortal",{aliases,page:1,pageSize:50});
assert.equal(exact.total,2,"strict AND deve aceitar somente blocos com ambos os conceitos");
assert.ok(exact.matches.every(x=>x.text.toLowerCase().includes("plano")||x.text.toLowerCase().includes("plan")));
assert.ok(!exact.matches.some(x=>x.id==="b"),"conceitos em parágrafos separados não podem ser combinados");
const literal=formatExactAnswer(exact.matches);
assert.ok(literal.includes("Plano de Salvação"));
assert.ok(literal.includes("página 10"));
const prompt=buildPrompt({question:"Explique",mode:"explain",evidence:exact.matches});
assert.ok(prompt.includes("não use conhecimento externo"));
assert.ok(prompt.includes("EVIDÊNCIA 1"));
assert.equal(chooseInstalledModel(["qwen3:4b","qwen3:1.7b"],"qwen3:4b"),"qwen3:4b");

const [server,ui,index,css,sw,pkg]=await Promise.all([
  readFile(path.join(root,"scripts","v2-local-server.mjs"),"utf8"),
  readFile(path.join(root,"public","v2-local-ui.js"),"utf8"),
  readFile(path.join(root,"public","index.html"),"utf8"),
  readFile(path.join(root,"public","style.css"),"utf8"),
  readFile(path.join(root,"public","sw-v3.js"),"utf8"),
  readFile(path.join(root,"package.json"),"utf8")
]);

for(const forbidden of ["api.groq.com","api.x.ai","generativelanguage.googleapis.com"]){
  assert.ok(!server.includes(forbidden),"v2 local não pode chamar provedor pago: "+forbidden);
}
assert.ok(server.includes('if(mode==="exact")'),"servidor precisa de bypass exato");
const chatStart=server.indexOf("async function handleChat");
const chatEnd=server.indexOf("async function serveStatic",chatStart);
const chatHandler=server.slice(chatStart,chatEnd);
assert.ok(chatStart>=0&&chatEnd>chatStart,"handleChat não localizado");
assert.ok(chatHandler.indexOf('if(mode==="exact")')>=0,"bypass exact ausente no handleChat");
assert.ok(chatHandler.indexOf('if(mode==="exact")')<chatHandler.indexOf("const models=await installedModels()"),"exact retrieval deve ocorrer antes da seleção/chamada de LLM");
assert.ok(server.includes('"/api/embed"'),"embeddings devem usar Ollama local");
assert.ok(server.includes("qwen3-embedding:0.6b")||server.includes("DEFAULT_EMBED_MODEL"));
assert.ok(ui.includes('["exact","Citação exata • zero LLM"]'));
assert.ok(ui.includes('["timeline","Linha do tempo"]'));
assert.ok(ui.includes('["compare","Comparar fontes"]'));
assert.ok(index.includes("/v2-local-ui.js"));
assert.ok(css.includes("@media(max-width:360px)"));
assert.ok(css.includes("@media(max-width:390px)"));
assert.ok(css.includes("@media(max-width:412px)"));
assert.ok(sw.includes('url.pathname.startsWith("/api/v2/")'));
assert.ok(sw.includes('"/v2-local-engine.js"'));
const parsed=JSON.parse(pkg);
assert.equal(parsed.scripts.start,"node scripts/v2-local-server.mjs");

console.log(JSON.stringify({
  ok:true,
  version:V2_VERSION,
  strict_and_same_block:true,
  exact_zero_llm:true,
  qwen_embeddings:true,
  modes:["short","explain","compare","timeline","exact"],
  responsive:[360,390,412,1366]
},null,2));
