import fs from "node:fs";

const must=(cond,message)=>{if(!cond) throw new Error(message);};
const read=path=>fs.readFileSync(new URL("../"+path,import.meta.url),"utf8");

const worker=read("src/index.js");
const app=read("public/app.js");
const css=read("public/style.css");
const manifest=JSON.parse(read("v8-citation-ui-authorized.json"));

must(worker.includes('8.0.0-adaptive-20x20x20'),"version marker missing");
must(worker.includes('url.pathname === "/api/citations"'),"public citation endpoint missing");
must(worker.includes('url.pathname === "/citation-search"'),"internal citation search missing");
must(worker.includes('const CITATION_PAGE_SIZE = 50;'),"citation page size must be 50");
must(worker.includes('const CITATION_SCAN_LIMIT = 50000;'),"citation scan limit must preserve current full library capacity");
must(worker.includes('llm_independent:true'),"citation contract must be independent of LLM output");
must(worker.includes('extractChapterHeading'),"book chapter resolver missing");
must(worker.includes('extractScriptureReferences'),"scripture reference resolver missing");
must(worker.includes('chapter_display'),"chapter must be exposed in citation response");
must(worker.includes('page_display'),"page must be exposed in citation response");
must(worker.includes("async function citationSearchR2Batch"),"batched authoritative R2 citation search missing");
must(worker.includes("listR2CitationShards"),"R2 shard scanner missing");
must(worker.includes('backend:"r2-authoritative"'),"citation backend must identify authoritative R2");
must(worker.includes("authoritative_r2_preferred:true"),"public citation contract must prefer authoritative R2");
must(worker.includes("exhaustive_scan_requires_cursor:true"),"citation contract must expose cursor scan semantics");
must(worker.includes("CITATION_R2_BATCH_SHARDS = 4"),"citation R2 scan must be CPU-bounded by shard batch");

const citationBlock=worker.slice(
  worker.indexOf('if (url.pathname === "/citation-search"'),
  worker.indexOf('if (url.pathname === "/search-lexical"')
);
must(citationBlock.includes("SELECT c.id,c.document_id,c.page,c.chunk_index,c.text"),"citation route must read canonical chunks");
must(!/\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|CREATE)\b/i.test(citationBlock),"citation route must remain read-only");
const r2CitationBlock=worker.slice(
  worker.indexOf("async function citationSearchR2Batch"),
  worker.indexOf("async function citationDictionaryResponse")
);
must(worker.includes("async function listR2CitationShards") && worker.includes("env.PDFS.list({prefix,limit:1000"),"R2 citation path must scan authoritative shards");
must(r2CitationBlock.includes("r2JsonGet(env.PDFS"),"R2 citation path must read shard payloads");
must(r2CitationBlock.includes("selected=objects.slice(cursor,cursor+CITATION_R2_BATCH_SHARDS)"),"R2 citation scan must never scan the whole library in one request");
must(!/env\.PDFS\.(?:put|delete)\s*\(/i.test(r2CitationBlock),"R2 citation path must remain read-only");

must(app.includes("attachCitationDictionary"),"desktop/mobile citation component missing");
must(app.includes("Dicionário de Citações"),"citation dictionary label missing");
must(app.includes("Capítulo: não localizado no texto extraído"),"chapter field must never silently disappear");
must(app.includes("Página: não localizada"),"page field must never silently disappear");
must(app.includes("CITATION_UI_PAGE_SIZE=50"),"browser pagination must be 50");
must(app.includes("while(!state.scanDone"),"browser must continue batched scan until the library cursor is exhausted");
must(app.includes("state.results.slice(state.offset,state.offset+CITATION_UI_PAGE_SIZE)"),"browser must render only 50 citation cards at once");
must(app.includes("desktop e no celular"),"desktop/mobile citation parity copy missing");
must(app.includes('citation_query:q'),"citation query must be preserved with chat history");
must(app.includes("500 nós lógicos"),"500-node label must not masquerade as 500 retrieved citations");

must(css.includes(".citation-dictionary"),"citation dictionary styles missing");
must(css.includes("@media(max-width:560px)"),"mobile responsive rules missing");
must(css.includes(".citation-dictionary-nav"),"pagination navigation styles missing");

must(manifest?.library?.mutate_existing_chunks===false,"existing chunks must stay frozen");
must(manifest?.library?.mutate_existing_vectors===false,"existing vectors must stay frozen");
must(manifest?.citation_dictionary?.desktop_mobile_parity===true,"desktop/mobile parity required");

console.log(JSON.stringify({
  ok:true,
  feature:manifest.feature,
  page_size:manifest.citation_dictionary.page_size,
  scan_limit:manifest.citation_dictionary.scan_limit,
  library_mutation:false,
  desktop_mobile_parity:true
},null,2));
