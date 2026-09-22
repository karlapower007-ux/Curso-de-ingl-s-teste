import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {
  V2_VERSION,splitConcepts,exactAndMatches,formatExactAnswer,buildPrompt,chooseInstalledModel,
  focusEvidence,answerStaysOnFocus
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
const focusRows=[
  {id:"focus-ok",document_id:"f1",title:"Fonte Focada",page:3,chunk_index:1,text:"Na vida pré-mortal, os filhos de Deus viviam antes do nascimento mortal."},
  {id:"focus-bad",document_id:"f2",title:"Fonte Fora",page:9,chunk_index:2,text:"O Espírito da Verdade é mencionado neste texto, sem tratar da existência pré-mortal."}
];
const focused=focusEvidence(focusRows,"Explique somente a vida pré-mortal",aliases,10);
assert.equal(focused.length,1,"Focus Lock deve excluir evidência fora do assunto explícito");
assert.equal(focused[0].id,"focus-ok");
assert.equal(answerStaysOnFocus("A vida pré-mortal antecede o nascimento mortal.","vida pré-mortal",aliases),true);
assert.equal(answerStaysOnFocus("O Espírito da Verdade aparece em Hebreus.","vida pré-mortal",aliases),false);
const literal=formatExactAnswer(exact.matches);
assert.ok(literal.includes("Plano de Salvação"));
assert.ok(literal.includes("página 10"));
const prompt=buildPrompt({question:"Explique",mode:"explain",evidence:exact.matches});
assert.ok(prompt.includes("não use conhecimento externo"));
assert.ok(prompt.includes("FOCUS LOCK ABSOLUTO"));
assert.ok(prompt.includes("Não traduza o texto"));
assert.ok(prompt.includes("EVIDÊNCIA 1"));
assert.ok(prompt.includes("4 a 8 pontos substantivos"),"modo Explicação deve pedir resposta mais rica sem sair do foco");
assert.equal(chooseInstalledModel(["qwen3:4b","qwen3:1.7b"],"qwen3:4b"),"qwen3:4b");

const [server,ui,engine,opfs,index,css,sw,pkg,whisper]=await Promise.all([
  readFile(path.join(root,"scripts","v2-local-server.mjs"),"utf8"),
  readFile(path.join(root,"public","v2-local-ui.js"),"utf8"),
  readFile(path.join(root,"public","v2-local-engine.js"),"utf8"),
  readFile(path.join(root,"public","opfs-sqlite-worker.js"),"utf8"),
  readFile(path.join(root,"public","index.html"),"utf8"),
  readFile(path.join(root,"public","style.css"),"utf8"),
  readFile(path.join(root,"public","sw-v3.js"),"utf8"),
  readFile(path.join(root,"package.json"),"utf8"),
  readFile(path.join(root,"public","whisper-local.js"),"utf8")
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
assert.ok(server.includes("function contextTokensByHardware"),"contexto do Qwen deve ser adaptativo por RAM");
assert.ok(server.includes("return 2048"),"PCs de baixa memória devem usar contexto de 2048 tokens");
assert.ok(server.includes("isMemoryAllocationError"),"servidor deve detectar falha de alocação/KV cache");
assert.ok(server.includes("focusEvidence"),"servidor deve filtrar evidências pelo assunto explícito");
assert.ok(server.includes("answerStaysOnFocus"),"servidor deve bloquear resposta gerada que saia do foco");
assert.ok(server.includes('provider:"focus-lock-deterministic"'),"servidor deve ter fallback determinístico quando o Qwen desviar do tema");
assert.ok(server.includes("candidateLimit=lowRam?60"),"perfil 4 GB deve ampliar candidatos lexicais sem embeddings pesados");
assert.ok(server.includes("maxEvidence=lowRam?10"),"perfil 4 GB deve usar mais evidências focadas");
assert.ok(server.includes("preferredContext=lowRam?1536"),"perfil 4 GB deve usar contexto compacto de 1536");
assert.ok(server.includes("compactLowRamEvidence"),"evidências devem ser compactadas antes do Qwen em pouca RAM");
assert.ok(server.includes("evidence_digest"),"chat deve devolver evidências adicionais sem exigir mais memória do Qwen");
assert.ok(server.includes("[preferredContext,1024]"),"PC de baixa memória deve ter retry em 1024 tokens");
assert.ok(!server.includes("options:{temperature:0.05,num_ctx:32768}"),"contexto fixo de 32768 não pode voltar");
assert.ok(server.includes("qwen3-embedding:0.6b")||server.includes("DEFAULT_EMBED_MODEL"));
assert.ok(ui.includes('["exact","Citação exata • zero LLM"]'));
assert.ok(ui.includes('["timeline","Linha do tempo"]'));
assert.ok(ui.includes('["compare","Comparar fontes"]'));
assert.ok(ui.includes("http://127.0.0.1:8788/api/v2/health"),"UI oficial deve detectar a ponte Ollama local");
assert.ok(ui.includes("window.__FNS_V2_API_BASE"),"UI deve compartilhar a base local com o motor de embeddings");
assert.ok(ui.includes('const lowRam=Number(health?.hardware?.ram_gb||navigator.deviceMemory||4)<=5;'),"sendLocal deve inicializar lowRam antes de usar o perfil de pouca memória");
const sendLocalStart=ui.indexOf("async function sendLocal");
const lowRamDef=ui.indexOf("const lowRam=",sendLocalStart);
const lowRamUse=ui.indexOf("lowRam?90:70",sendLocalStart);
assert.ok(sendLocalStart>=0&&lowRamDef>sendLocalStart&&lowRamUse>lowRamDef,"lowRam precisa ser definido antes da primeira utilização no chat v2");
assert.ok(ui.includes("function speakV2Answer"),"v2 deve falar respostas diretamente pelo navegador");
assert.ok(ui.includes("speechSynthesis"),"v2 deve ter fallback TTS nativo sem API externa");
assert.ok(ui.includes("appendEvidenceDigest"),"chat deve mostrar evidências adicionais da biblioteca");
assert.ok(ui.includes("data.evidence_digest"),"UI deve renderizar o complemento rico devolvido pelo servidor");
assert.ok(ui.includes('id==="stopAudioBtn"'),"botão Parar áudio deve interromper a fala v2");
assert.ok(server.includes("LOCAL_BRIDGE_ORIGINS"),"servidor local precisa de allowlist de origem");
assert.ok(server.includes("https://consciencia-fabiano.focoeepoder2.workers.dev"),"origem oficial deve estar explicitamente autorizada");
assert.ok(server.includes("Access-Control-Allow-Private-Network"),"ponte local precisa responder ao preflight de rede privada");
assert.ok(server.includes('res.setHeader("Access-Control-Allow-Origin",origin)'),"CORS deve refletir somente origem previamente autorizada");
assert.ok(engine.includes('type:"search-fts"'),"v2 deve consultar o índice OPFS FTS5");
assert.ok(engine.includes('search_backend:"opfs-sqlite-fts5"'),"resultado FTS5 deve ser identificável internamente");
assert.ok(opfs.includes("CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5"),"OPFS deve manter índice SQLite FTS5");
assert.ok(opfs.includes('d.type==="search-fts"'),"worker OPFS deve expor busca FTS5 local");
assert.ok(index.includes("/v2-local-ui.js"));
assert.ok(index.includes('id="v2SpeakAnswers"'),"interface deve oferecer leitura automática das respostas");
assert.ok(index.includes('id="micBtn" class="whisper-btn" type="button">🎤 Segure para Falar</button>'),"microfone não pode nascer travado em Carregando IA de Voz");
assert.ok(whisper.includes("lowMemory"),"entrada de voz deve usar modo leve em aparelhos de 4 GB");
assert.ok(whisper.includes('mode="webspeech"'),"modo leve deve ativar reconhecimento de voz do navegador quando permitido");
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
  richer_low_ram_chat:true,
  browser_tts:true,
  modes:["short","explain","compare","timeline","exact"],
  responsive:[360,390,412,1366]
},null,2));
