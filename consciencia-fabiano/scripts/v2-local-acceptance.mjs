import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {
  V2_VERSION,splitConcepts,exactAndMatches,formatExactAnswer,formatGroundedAnswer,buildPrompt,chooseInstalledModel,
  focusEvidence,answerStaysOnFocus,citationIntegrity,extractVerifiedPageReference,hasSubstantiveFocus,focusedEvidenceWindow,
  dictionaryPublicReference
} from "./v2-local-core.mjs";
import {
  buildV3EvidenceIndex,searchV3Evidence,formatV3EvidenceAnswer,expandV3Query,parseScriptureFooter
} from "./v3-evidence-core.mjs";

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
const dictionaryScriptureMarker=exactAndMatches([
  {id:"sw",document_id:"sw1",filename:"standard-works-83806-por.pdf",title:"standard works 83806 por",page:55,chunk_index:1,text:"A vida pré-mortal é ensinada nesta página."}
],"vida pré-mortal",{aliases,page:1,pageSize:50});
assert.equal(dictionaryScriptureMarker.matches.length,1);
assert.equal(dictionaryScriptureMarker.matches[0].standard_works,true,"Dicionário deve preservar internamente o marcador de Obras Padrão sem depender do título público");
const focusRows=[
  {id:"focus-ok",document_id:"f1",title:"Fonte Focada",page:3,chunk_index:1,text:"Na vida pré-mortal, os filhos de Deus viviam antes do nascimento mortal."},
  {id:"focus-bad",document_id:"f2",title:"Fonte Fora",page:9,chunk_index:2,text:"O Espírito da Verdade é mencionado neste texto, sem tratar da existência pré-mortal."}
];
const focused=focusEvidence(focusRows,"Explique somente a vida pré-mortal",aliases,10);
assert.equal(focused.length,1,"Focus Lock deve excluir evidência fora do assunto explícito");
assert.equal(focused[0].id,"focus-ok");
const longIrrelevant={
  text:"Irmãos, quero dizer-vos que vou chamar Doze Apóstolos. Reunimo-nos em conselho e tratamos de muitos assuntos. Esta parte não responde à pergunta. A vida pré-mortal é ensinada aqui como a existência dos filhos de Deus antes do nascimento mortal. Esse ensino pertence diretamente ao assunto pedido.",
  focus_aliases:["vida pre-mortal"]
};
const focusedWindow=focusedEvidenceWindow(longIrrelevant,760);
assert.equal(focusedWindow.accepted,true,"janela focada deve aceitar o bloco que contém o conceito");
assert.ok(focusedWindow.text.toLowerCase().includes("vida pré-mortal"),"trecho final precisa conter o assunto solicitado");
assert.ok(!focusedWindow.text.startsWith("Irmãos, quero dizer-vos"),"trecho exibido não pode começar por contexto irrelevante distante do conceito");
const missingWindow=focusedEvidenceWindow({text:"Chamamos Doze Apóstolos e encerramos a reunião.",focus_aliases:["vida pre-mortal"]},760);
assert.equal(missingWindow.accepted,false,"bloco sem o conceito no trecho final deve ser rejeitado");

assert.equal(answerStaysOnFocus("A vida pré-mortal antecede o nascimento mortal.","vida pré-mortal",aliases),true);
assert.equal(answerStaysOnFocus("O Espírito da Verdade aparece em Hebreus.","vida pré-mortal",aliases),false);
const grounded=formatGroundedAnswer(focused.map(row=>({
  ...row,
  focus_verified:true,
  citation_verified:true,
  citation_reference:"Fonte Focada • página 3"
})),"explain");
assert.ok(grounded.includes("Resposta documental exata"),"Grounded Exact deve identificar resposta documental");
assert.ok(grounded.includes("vida pré-mortal"),"Grounded Exact deve preservar texto focado da biblioteca");
assert.ok(grounded.includes("✓ Fonte verificada:"),"Grounded Exact deve citar somente fonte verificada em cada ponto");
assert.ok(!grounded.includes("Espírito da Verdade"),"Grounded Exact não pode incluir evidência fora do foco");
const scripturePage="24 E disse: És tu meu filho Esaú mesmo? Ele disse: Eu sou. 27 a Heb. 11:20. GEE Bênçãos Patriarcais. 29 a GEE Amaldiçoar. 47 GÊNESIS 27:23–38";
assert.equal(extractVerifiedPageReference(scripturePage),"GÊNESIS 27:23–38","rodapé canônico deve vencer referências cruzadas");
assert.equal(
  dictionaryPublicReference({filename:"standard-works-83806-por.pdf",page:55,text:"27 a Heb. 11:20. GEE Bênçãos Patriarcais."},scripturePage),
  "GÊNESIS 27:23–38",
  "Dicionário deve substituir standard-works pela referência canônica verificada"
);
assert.equal(
  dictionaryPublicReference({filename:"standard-works-83806-por.pdf",page:999,text:"Trecho sem rodapé canônico."},"Trecho sem rodapé canônico."),
  "Obras Padrão",
  "Dicionário deve usar fallback neutro sem vazar standard-works"
);
const scriptureCitation=citationIntegrity({
  filename:"standard-works-83806-por.pdf",title:"",page:55,text:"27 a Heb. 11:20. GEE Bênçãos Patriarcais."
},scripturePage);
assert.equal(scriptureCitation.verified,true);
assert.equal(scriptureCitation.reference,"GÊNESIS 27:23–38");
assert.notEqual(scriptureCitation.reference,"Hebreus 11:20");
const apparatusOnly={
  filename:"standard-works-83806-por.pdf",
  text:"5 a GEE Vida Pré-mortal. b GEE Criação, Criar.",
  focus_aliases:["vida pré-mortal"]
};
assert.equal(hasSubstantiveFocus(apparatusOnly),false,"GEE isolado não pode virar evidência substantiva");
const bookCitation=citationIntegrity({title:"Discursos de Brigham Young",page:97,text:"Trecho real do livro."},"");
assert.equal(bookCitation.verified,true);
assert.equal(bookCitation.reference,"Discursos de Brigham Young • página 97");
const unsafeScripture=citationIntegrity({filename:"standard-works-83806-por.pdf",page:500,text:"Jó 26:10 é apenas uma referência cruzada."},"Jó 26:10 é apenas uma referência cruzada.");
assert.equal(unsafeScripture.verified,false,"referência solta no texto não pode ser tratada como origem");

const v3Aliases={
  "mundo dos espíritos":["spirit world","world of spirits","mundo espiritual"],
  "vida pré-mortal":["premortal life","preexistência"]
};
const v3Rows=[
  {
    id:"v3-book-1",document_id:"book1",filename:"Livro_Teste.pdf",title:"Livro Teste",author:"Autor",
    language:"pt",page:42,chunk_index:42000,
    text:"Depois da morte, os espíritos entram no mundo dos espíritos, onde aguardam a ressurreição."
  },
  {
    id:"v3-book-2",document_id:"book2",filename:"Premortal.pdf",title:"Doutrina Teste",author:"Autor",
    language:"en",page:10,chunk_index:10000,
    text:"The premortal life preceded mortal birth and formed part of God's plan for His children."
  }
];
const v3Index=buildV3EvidenceIndex(v3Rows);
assert.equal(v3Index.source_rows,2,"V3 deve construir índice paralelo sem depender do Dicionário");
assert.ok(v3Index.units.length>=2,"V3 deve produzir unidades documentais próprias");
const expandedWorld=expandV3Query("Explica sobre o mundo espiritual",v3Aliases);
assert.ok(expandedWorld.some(x=>x.includes("mundo dos espiritos")),"V3 deve expandir mundo espiritual para mundo dos espíritos");
const worldSearch=searchV3Evidence(v3Index,"Explica sobre o mundo espiritual",v3Aliases,{limit:10});
assert.ok(worldSearch.results.length>=1,"V3 deve encontrar mundo dos espíritos mesmo com formulação diferente");
assert.ok(worldSearch.results[0].reference.includes("Livro Teste"),"V3 deve preservar título e página reais do livro");
const v3Answer=formatV3EvidenceAnswer(worldSearch,"explain");
assert.ok(v3Answer.includes("✓ Fonte verificada:"),"V3 deve responder apenas com evidência marcada como verificada");
assert.ok(v3Answer.includes("mundo dos espíritos"),"V3 deve manter o texto documental encontrado");
assert.ok(!v3Answer.includes("Jó 26:10"),"V3 não pode inventar referência que não pertença à evidência");
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

const [server,ui,engine,opfs,index,css,sw,pkg,whisper,v3core,restart,incremental]=await Promise.all([
  readFile(path.join(root,"scripts","v2-local-server.mjs"),"utf8"),
  readFile(path.join(root,"public","v2-local-ui.js"),"utf8"),
  readFile(path.join(root,"public","v2-local-engine.js"),"utf8"),
  readFile(path.join(root,"public","opfs-sqlite-worker.js"),"utf8"),
  readFile(path.join(root,"public","index.html"),"utf8"),
  readFile(path.join(root,"public","style.css"),"utf8"),
  readFile(path.join(root,"public","sw-v3.js"),"utf8"),
  readFile(path.join(root,"package.json"),"utf8"),
  readFile(path.join(root,"public","whisper-local.js"),"utf8"),
  readFile(path.join(root,"scripts","v3-evidence-core.mjs"),"utf8"),
  readFile(path.join(root,"scripts","reiniciar-cerebro-v2.ps1"),"utf8"),
  readFile(path.join(root,"scripts","v3-incremental-library.mjs"),"utf8")
]);

for(const forbidden of ["api.groq.com","api.x.ai","generativelanguage.googleapis.com"]){
  assert.ok(!server.includes(forbidden),"v2 local não pode chamar provedor pago: "+forbidden);
}

assert.ok(server.includes('url.pathname==="/api/v3/health"'),"servidor deve expor health separado da V3");
assert.ok(server.includes('url.pathname==="/api/v3/chat"'),"servidor deve expor Chat V3 separado");
assert.ok(server.includes('url.pathname==="/api/v2/dictionary"'),"Dicionário aprovado deve permanecer na rota V2");
assert.ok(server.includes("decorateDictionaryReference"),"Dicionário deve aplicar somente a camada de referência pública das Escrituras");
assert.ok(server.includes("dictionaryPublicReference"),"Dicionário deve reutilizar o parser canônico sem pacote externo");
assert.ok(server.includes("dictionary_scripture_source:true"),"Dicionário deve marcar resultados das Escrituras para apresentação segura");
assert.ok(ui.includes('hit.dictionary_scripture_source?"PDF p. "'),"UI do Dicionário deve mostrar a página técnica apenas como PDF p. X nas Escrituras");
assert.ok(incremental.includes("standard_works:isStandardWorksRow(row)"),"Índice incremental 50K deve preservar o marcador de Obras Padrão");
assert.ok(server.includes("dictionary_frozen:true"),"V3 deve declarar o Dicionário congelado");
assert.ok(ui.includes('call("/api/v3/chat"'),"Chat oficial deve usar o Evidence Engine V3");
assert.ok(ui.includes('call("/api/v2/dictionary"'),"Dicionário oficial deve continuar usando exatamente a rota V2");
assert.ok(!ui.includes('call("/api/v3/dictionary"'),"V3 não pode substituir ou reindexar o Dicionário");
assert.ok(v3core.includes("buildV3EvidenceIndex"),"núcleo V3 deve existir separado do núcleo V2");
assert.ok(v3core.includes("searchV3Evidence"),"V3 deve possuir mecanismo próprio de busca");
assert.ok(/version:"3\.0\.\d+-evidence-engine-[^"]+"/.test(v3core),"V3 deve declarar versão 3.0.x do Evidence Engine");
assert.ok(v3core.includes("noteAt"),"V3 deve remover aparato editorial/rodapés antes da indexação de Escrituras");
assert.ok(v3core.includes("minCore"),"V3 deve exigir cobertura do conceito completo quando não houver alias literal");
assert.ok(v3core.includes('unit.kind==="scripture-page-window"'),"V3 deve reconhecer faixas bíblicas amplas");
assert.ok(v3core.includes("allowBroadScripture"),"faixas bíblicas amplas só podem entrar mediante permissão explícita");
assert.ok(v3core.includes("focusedV3Excerpt"),"V3 deve exibir janela documental centrada no conceito");
assert.ok(v3core.includes("sentences.slice(i,Math.min(sentences.length,i+2))"),"V3 deve iniciar o excerto na frase do conceito encontrado");
assert.ok(v3core.includes('replace(/-/g,"")'),"V3 deve normalizar OCR com hífen em conceitos como pre-existence");
assert.ok(!v3core.includes("api/chat"),"núcleo documental V3 não pode depender de geração LLM para validar fontes");
assert.ok(restart.includes('"scripts/v3-evidence-core.mjs"'),"reiniciador deve baixar o núcleo V3 para o PC");
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
assert.ok(server.includes('if(body.grounded===true)'),"servidor deve ter caminho Grounded Exact explícito");
assert.ok(server.includes('provider:"grounded-exact-no-llm"'),"Grounded Exact deve bypassar o LLM na resposta");
assert.ok(server.includes("applyCitationIntegrity"),"chat deve validar proveniência antes de exibir fonte");
assert.ok(server.includes("focusedEvidenceWindow"),"chat deve recortar o trecho em torno do conceito realmente encontrado");
assert.ok(server.includes("focus_verified:true"),"evidência exibida deve carregar selo interno de foco");
assert.ok(server.includes("citation_verified:true"),"evidências aceitas devem carregar selo interno de verificação");
assert.ok(server.includes("citation_integrity:true"),"Citação exata também deve passar pelo Citation Integrity Lock");
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
assert.ok(ui.includes('["explain","Explicação exata"]'),"modo Explicação deve indicar fidelidade documental");
assert.ok(ui.includes('grounded:mode!=="exact"'),"chat padrão deve pedir Grounded Exact ao servidor");
assert.ok(ui.includes('browserOnly&&!apiBase'),"queda do Ollama não pode forçar fallback frouxo quando o servidor local está disponível");
assert.ok(ui.includes("Grounded Exact • somente evidências da biblioteca • zero invenções"),"status deve deixar claro o caminho exato");
assert.ok(ui.includes("✓ Fonte verificada — "),"UI deve identificar visualmente fontes validadas");
assert.ok(ui.includes('mode==="exact"&&engine&&Number(localState?.chunks||0)>0&&!apiBase'),"Citação exata só pode bypassar o servidor quando a ponte local não existir");
assert.ok(ui.includes("canonical_reference:r.canonical_reference"),"UI deve preservar metadado canônico ao enviar evidências");
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
  grounded_exact_chat:true,
  citation_integrity_lock:true,
  evidence_engine_v3:true,
  dictionary_frozen_v2:true,
  browser_tts:true,
  modes:["short","explain","compare","timeline","exact"],
  responsive:[360,390,412,1366]
},null,2));
