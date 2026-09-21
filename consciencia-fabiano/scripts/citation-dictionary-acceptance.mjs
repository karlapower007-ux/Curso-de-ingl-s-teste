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
must(worker.includes("async function citationSearchR2Segment"),"segmented authoritative R2 citation search missing");
must(worker.includes("CITATION_R2_SHARDS_PER_REQUEST"),"bounded R2 shard segment missing");
must(worker.includes("const CITATION_R2_SHARDS_PER_REQUEST = 1;"),"citation segments must stay at one shard after repeated Cloudflare 1102");
must(worker.includes("function chapterWordToNumber"),"written chapter number resolver missing");
must(worker.includes("function extractNamedSectionHeading"),"named book section resolver missing");
must(worker.includes("function extractScriptureHeading"),"scripture heading resolver missing");
must(worker.includes("function extractScriptureVerseRange"),"scripture verse range resolver missing");
must(worker.includes("function syntheticScriptureReference"),"scripture canonical reference builder missing");
must(worker.includes("citation_dictionary_strict_scripture_source_classification: true"),"strict scripture source classification flag missing");
must(worker.includes("citation_dictionary_canonical_filename_suffixes: true"),"canonical scripture filename suffix flag missing");
must(worker.includes("citation_dictionary_scripture_direct_ref_gate: false"),"scripture cross-reference parser must stay disabled during exhaustive scan");
must(worker.includes("citation_dictionary_regex_precompiled: true"),"precompiled citation regex flag missing");
must(worker.includes("citation_dictionary_ultrasafe_one_shard: true"),"ultra-safe one-shard citation flag missing");
must(worker.includes("citation_dictionary_crossrefs_deferred: true"),"cross-reference parser must be deferred from exhaustive scan");
must(worker.includes("citation_dictionary_inline_chapter_headings: true"),"inline chapter heading resolver flag missing");
must(worker.includes("citation_dictionary_inline_verse_markers: true"),"inline verse marker resolver flag missing");
must(worker.includes("citation_dictionary_multi_chapter_chunk_locations: true"),"multi-chapter scripture chunk flag missing");
must(worker.includes("citation_dictionary_scripture_initial_chapter_seed: true"),"initial scripture chapter seed flag missing");
must(worker.includes("citation_dictionary_footnote_aware_verse_markers: true"),"footnote-aware verse marker flag missing");
must(worker.includes("function scriptureCollectionChapterSeed"),"scripture chapter seed resolver missing");
must(worker.includes("const SCRIPTURE_INLINE_VERSE_MARKER_RE="),"inline scripture verse regex missing");
must(worker.includes("function looksLikeStrongHeadingText"),"strong inline book heading guard missing");

must(worker.includes("headingProbe=rowText.slice(0,900)"),"citation heading parser must use bounded probe text");
must(worker.includes("function extractScriptureLocationReferences"),"multi-chapter scripture location resolver missing");
must(worker.includes("String(text || \"\").slice(0,2400)"),"scripture location resolver must remain bounded to 2400 chars");
must(worker.includes("cross_references:[]"),"exhaustive citation scan must not parse nonessential cross-references");

must(worker.includes("citation_dictionary_scripture_location_not_crossref: true"),"scripture location must be separated from cross-references");
must(worker.includes("const SCRIPTURE_REFERENCE_RE=new RegExp"),"precompiled scripture reference regex missing");
must(worker.includes("const SCRIPTURE_SOURCE_PATTERNS=["),"precompiled scripture source patterns missing");
must(worker.includes("const CHAPTER_HEADING_PATTERNS=["),"precompiled chapter heading patterns missing");
must(worker.includes("const SCRIPTURE_HEADING_LINE_RE=new RegExp"),"precompiled scripture heading regex missing");

must(worker.includes("scripture_references:scriptureLocationRefs"),"scripture primary location array missing");
must(worker.includes("const located=extractScriptureLocationReferences("),"scan must use location-first multi-chapter scripture resolver");
must(worker.includes("if(located.final_chapter) currentScriptureChapter=located.final_chapter;"),"scripture chapter carry must advance after inline chapter boundaries");

must(worker.includes('if(kind==="standard-works") return "Gênesis";'),"standard works location seed missing");

must(worker.includes("function extractScriptureHeading(text,currentBook=\"\")"),"scripture heading resolver must not use cross-references as location state");

must(worker.includes('.replace(/[-_]+/g," ")'),"scripture filename slug normalization missing");
must(worker.includes('portugues|portuguese|english|por|pt|eng|en|spa|es'),"canonical scripture language suffixes missing");

must(!worker.includes('if(/\\b(?:doutrina e convenios|doctrine and covenants)\\b/.test(value)) return "doctrine-and-covenants";'),"broad scripture filename classifier must not return");

must(worker.includes('backend:"r2-authoritative"'),"citation backend must identify authoritative R2");
must(worker.includes("authoritative_r2_preferred:true"),"public citation contract must prefer authoritative R2");
must(worker.includes("cpu_bounded_segment:true"),"CPU bounded citation contract missing");

const citationBlock=worker.slice(
  worker.indexOf('if (url.pathname === "/citation-search"'),
  worker.indexOf('if (url.pathname === "/search-lexical"')
);
must(citationBlock.includes("SELECT c.id,c.document_id,c.page,c.chunk_index,c.text"),"citation route must read canonical chunks");
must(!/\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|CREATE)\b/i.test(citationBlock),"citation route must remain read-only");
const r2CitationBlock=worker.slice(
  worker.indexOf("async function citationSearchR2Segment"),
  worker.indexOf("async function citationDictionaryResponse")
);
must(worker.includes("limit:CITATION_R2_SHARDS_PER_REQUEST"),"R2 citation path must scan bounded shard segments");
must(r2CitationBlock.includes("r2JsonGet(env.PDFS"),"R2 citation path must read shard payloads");
must(!/env\.PDFS\.(?:put|delete)\s*\(/i.test(r2CitationBlock),"R2 citation path must remain read-only");

must(app.includes("attachCitationDictionary"),"desktop/mobile citation component missing");
must(app.includes("Dicionário de Citações"),"citation dictionary label missing");
must(app.includes("Capítulo: localização bibliográfica pendente"),"chapter field must never silently disappear");
must(app.includes("Página: localização bibliográfica pendente"),"page field must never silently disappear");
must(app.includes("CITATION_UI_PAGE_SIZE=50"),"browser pagination must be 50");
must(app.includes("scan_cursor"),"browser must continue segmented citation scans");
must(app.includes("continueBackgroundScan"),"browser must continue citation scanning without blocking the first page");
must(app.includes("libraryTotal"),"browser must report scanned library progress");
must(app.includes("carry_scripture_book"),"desktop/mobile client must carry scripture book");
must(app.includes("carry_scripture_chapter"),"desktop/mobile client must carry scripture chapter");
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
