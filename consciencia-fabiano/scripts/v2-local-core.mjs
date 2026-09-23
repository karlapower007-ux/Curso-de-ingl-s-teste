import { deriveStrictPhrase, normalizeStrictText, extractSemanticReference } from "../public/strict-match-core.js";

export const V2_VERSION = "2.0.0-local-first";
export const DEFAULT_EMBED_MODEL = "qwen3-embedding:0.6b";
export const DEFAULT_MODEL_ORDER = [
  "qwen3.8:27b",
  "qwen3:8b",
  "qwen3:4b",
  "qwen3:1.7b",
  "qwen3:0.6b"
];
export const RESPONSE_MODES = new Set(["short","explain","compare","timeline","exact"]);

export function fold(text){
  return String(text||"")
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase()
    .replace(/[“”„‟«»"'’]/g,"")
    .replace(/[^\p{L}\p{N}\s:+-]/gu," ")
    .replace(/\s+/g," ")
    .trim();
}

export function sanitizePublicTitle(row={}){
  const raw=String(row.title||row.filename||row.source_title||"").replace(/\.pdf$/i,"");
  const cleaned=raw.replace(/[_-]+/g," ").replace(/\s+/g," ").trim();
  if(/^(standard works|obras padrao|documento|fonte)$/i.test(fold(cleaned))) return "";
  if(/standard\s*works|obras[-_ ]?padrao/i.test(raw)) return "";
  return cleaned || "Livro";
}

export function isStandardWorksRow(row={}){
  const raw=[row.filename,row.title,row.source_title,row.document_title].map(x=>String(x||"")).join(" ");
  return /standard[-_ ]?works|obras[-_ ]?padrao|obras\s+padr[aã]o/i.test(fold(raw));
}

export function extractVerifiedPageReference(pageText=""){
  const raw=String(pageText||"").replace(/\s+/g," ").trim();
  if(!raw)return "";
  const tail=raw.slice(-1400);
  const re=/\b\d{1,4}\s+((?:(?:[1-4]\s+)?[A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-ZÁÉÍÓÚÂÊÔÃÕÇ.&—-]*(?:\s+(?:E|DE|DO|DA|DOS|DAS|[A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-ZÁÉÍÓÚÂÊÔÃÕÇ.&—-]*)){0,5})\s+\d{1,4}:\d{1,4}(?:\s*[–-]\s*\d{1,4})?)\b/gu;
  let match,last="";
  while((match=re.exec(tail)))last=String(match[1]||"").replace(/\s+/g," ").replace(/\s*([:–-])\s*/g,"$1").trim();
  return last;
}

export function citationIntegrity(row={},pageText=""){
  const canonical=String(row.canonical_reference||"").trim();
  if(canonical){
    return {verified:true,reference:canonical,kind:"canonical-metadata",reason:"canonical_reference"};
  }

  if(isStandardWorksRow(row)){
    const footer=extractVerifiedPageReference(pageText||row.text||"");
    if(footer)return {verified:true,reference:footer,kind:"scripture-page-footer",reason:"verified-page-footer"};
    return {verified:false,reference:"",kind:"scripture-unverified",reason:"canonical-footer-not-found"};
  }

  const title=String(row.title||row.source_title||"").replace(/\.pdf$/i,"").replace(/[_-]+/g," ").replace(/\s+/g," ").trim();
  const page=Number(row.page||0)||null;
  if(title&&page)return {verified:true,reference:title+" • página "+page,kind:"book-page",reason:"title-page-metadata"};
  if(title)return {verified:true,reference:title,kind:"book-title",reason:"title-metadata"};
  return {verified:false,reference:"",kind:"unverified",reason:"missing-authoritative-metadata"};
}

export function hasSubstantiveFocus(row={}){
  if(!isStandardWorksRow(row))return true;
  const text=fold(row.text||"");
  const aliases=(Array.isArray(row.focus_aliases)?row.focus_aliases:[]).map(fold).filter(Boolean);
  if(!aliases.length)return true;
  for(const alias of aliases){
    let at=0;
    while((at=text.indexOf(alias,at))>=0){
      const prefix=text.slice(Math.max(0,at-36),at);
      const apparatus=/\bgee\s*$|guia para estudo das escrituras\s*$|\bver\s*$|\bsee\s*$/i.test(prefix);
      if(!apparatus)return true;
      at+=Math.max(1,alias.length);
    }
  }
  return false;
}

export function publicReference(row={}){
  const canonical=String(row.canonical_reference||"").trim();
  if(canonical)return canonical;
  const title=sanitizePublicTitle(row);
  const page=Number(row.page||0);
  return [title,page?("página "+page):""].filter(Boolean).join(" • ");
}

export function dictionaryPublicReference(row={},pageText=""){
  if(isStandardWorksRow(row)){
    const canonical=String(row.canonical_reference||"").trim();
    if(canonical)return canonical;
    const verified=extractVerifiedPageReference(pageText||row.text||"");
    return verified||"Obras Padrão";
  }
  return publicReference(row);
}

export function paragraphBlocks(text){
  const raw=String(text||"").replace(/\r\n?/g,"\n").replace(/\n{3,}/g,"\n\n").trim();
  if(!raw)return [];
  const explicit=raw.split(/\n\s*\n+/).map(x=>x.trim()).filter(Boolean);
  if(explicit.length>1)return explicit;
  // PDF extraction often removes blank lines. Keep logical blocks bounded without
  // manufacturing text: groups of existing sentences only.
  const sentences=raw.split(/(?<=[.!?;:])\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ0-9])/u).map(x=>x.trim()).filter(Boolean);
  if(sentences.length<=4)return [raw];
  const blocks=[];
  for(let i=0;i<sentences.length;i+=4)blocks.push(sentences.slice(i,i+4).join(" "));
  return blocks;
}

function normalizeAliases(raw){
  const map=new Map();
  for(const [key,value] of Object.entries(raw||{})){
    const k=fold(key);
    if(!k)continue;
    const aliases=[key,...(Array.isArray(value)?value:[])].map(fold).filter(Boolean);
    map.set(k,[...new Set(aliases)]);
  }
  return map;
}

export function splitConcepts(query,aliasObject={}){
  const aliasMap=normalizeAliases(aliasObject);
  let phrase=deriveStrictPhrase(query)||String(query||"").trim();
  phrase=phrase.replace(/^["']|["']$/g,"").trim();
  let parts=phrase
    .split(/\s+(?:AND|E|Y)\s+|\s*\+\s*|\s*;\s*/iu)
    .map(x=>x.trim()).filter(Boolean);
  if(parts.length===1 && /\s+e\s+/iu.test(phrase)){
    const candidate=phrase.split(/\s+e\s+/iu).map(x=>x.trim()).filter(Boolean);
    if(candidate.length<=4)parts=candidate;
  }
  return parts.map(label=>{
    const key=fold(label);
    const aliases=aliasMap.get(key)||[key];
    return {label,key,aliases:[...new Set(aliases)]};
  }).filter(x=>x.key);
}

export function strictParagraphAudit(paragraph,concepts){
  const hay=fold(paragraph);
  const matched=[];
  const missing=[];
  for(const concept of concepts){
    const alias=concept.aliases.find(a=>a&&hay.includes(a));
    if(alias)matched.push({label:concept.label,alias});
    else missing.push(concept.label);
  }
  return {
    accepted:concepts.length>0 && missing.length===0,
    matched,
    missing,
    coverage:concepts.length?matched.length/concepts.length:0
  };
}

export function exactAndMatches(rows,query,{aliases={},page=1,pageSize=50}={}){
  const concepts=splitConcepts(query,aliases);
  if(!concepts.length)return {query,concepts:[],total:0,page:1,page_size:pageSize,pages:0,matches:[]};
  const hits=[];
  for(const row of rows||[]){
    const blocks=paragraphBlocks(row?.text||"");
    for(let index=0;index<blocks.length;index++){
      const audit=strictParagraphAudit(blocks[index],concepts);
      if(!audit.accepted)continue;
      hits.push({
        id:String(row.id||row.key||row.document_id+":"+String(row.chunk_index||0)+":"+index),
        document_id:String(row.document_id||row.doc_key||""),
        title:sanitizePublicTitle(row),
        page:Number(row.page||0)||null,
        chunk_index:Number(row.chunk_index||0),
        text:blocks[index],
        reference:publicReference({...row,text:blocks[index]}),
        aliases:audit.matched.map(x=>x.alias),
        concepts:audit.matched.map(x=>x.label),
        score:1
      });
    }
  }
  hits.sort((a,b)=>String(a.reference||"").localeCompare(String(b.reference||""))||a.chunk_index-b.chunk_index);
  const safePage=Math.max(1,Number(page)||1);
  const safeSize=Math.min(100,Math.max(1,Number(pageSize)||50));
  const start=(safePage-1)*safeSize;
  return {
    query,
    concepts:concepts.map(x=>({label:x.label,aliases:x.aliases})),
    total:hits.length,
    page:safePage,
    page_size:safeSize,
    pages:Math.ceil(hits.length/safeSize),
    matches:hits.slice(start,start+safeSize)
  };
}

const STOP=new Set("a o as os um uma uns umas de da do das dos e em no na nos nas por para com sem sobre que qual quais como quando onde porque pois ser estar foi eram is the an of to in on for with about what which how when where why me mostre mostrar busque buscar encontre encontrar diga explique".split(/\s+/));

export function queryTerms(query){
  return [...new Set(fold(deriveStrictPhrase(query)||query).split(/\s+/).filter(x=>x.length>=3&&!STOP.has(x)))].slice(0,24);
}

export function focusEvidence(rows,query,aliasObject={},limit=20){
  const aliasMap=normalizeAliases(aliasObject);
  const q=fold(query);
  const explicit=[];
  for(const [key,aliases] of aliasMap.entries()){
    if(aliases.some(a=>a&&q.includes(a)))explicit.push({label:key,key,aliases});
  }
  const concepts=explicit.length?explicit:splitConcepts(query,aliasObject).filter(c=>c.key.split(" ").length<=4);
  if(!concepts.length)return (rows||[]).slice(0,limit);

  const strict=[];
  const partial=[];
  for(const row of rows||[]){
    for(const block of paragraphBlocks(row?.text||"")){
      const audit=strictParagraphAudit(block,concepts);
      const item={...row,text:block,reference:publicReference({...row,text:block}),focus_coverage:audit.coverage,focus_aliases:audit.matched.map(x=>x.alias)};
      if(audit.accepted)strict.push(item);
      else if(audit.coverage>0)partial.push(item);
    }
  }
  const uniq=list=>{
    const seen=new Set(),out=[];
    for(const row of list){
      const key=String(row.reference||"")+"|"+fold(row.text||"").slice(0,160);
      if(seen.has(key))continue;seen.add(key);out.push(row);
      if(out.length>=limit)break;
    }
    return out;
  };
  if(strict.length)return uniq(strict);
  return uniq(partial.sort((a,b)=>Number(b.focus_coverage||0)-Number(a.focus_coverage||0)));
}

export function focusedEvidenceWindow(row={},maxChars=900){
  const raw=String(row?.text||"").replace(/\s+/g," ").trim();
  if(!raw)return {accepted:false,text:"",matched_alias:"",reason:"empty"};
  const aliases=[...new Set((Array.isArray(row?.focus_aliases)?row.focus_aliases:[]).map(fold).filter(Boolean))];
  if(!aliases.length)return {accepted:false,text:"",matched_alias:"",reason:"missing-focus-alias"};

  const sentences=raw.split(/(?<=[.!?;:])\s+/u).map(x=>x.trim()).filter(Boolean);
  if(!sentences.length)return {accepted:false,text:"",matched_alias:"",reason:"no-sentences"};

  let hit=-1,matched="";
  for(let i=0;i<sentences.length;i++){
    const hay=fold(sentences[i]);
    const alias=aliases.find(a=>a&&hay.includes(a));
    if(alias){hit=i;matched=alias;break;}
  }
  if(hit<0)return {accepted:false,text:"",matched_alias:"",reason:"alias-not-in-final-block"};

  let start=Math.max(0,hit-1),end=Math.min(sentences.length,hit+2);
  let picked=sentences.slice(start,end).join(" ").trim();
  if(!aliases.some(a=>fold(picked).includes(a))){
    picked=sentences[hit];
  }
  if(picked.length>maxChars){
    const hitSentence=sentences[hit];
    if(hitSentence.length<=maxChars)picked=hitSentence;
    else{
      const folded=fold(hitSentence);
      const pos=Math.max(0,folded.indexOf(matched));
      const ratio=folded.length?pos/folded.length:0;
      const rawPos=Math.floor(hitSentence.length*ratio);
      const left=Math.max(0,rawPos-Math.floor(maxChars*0.35));
      picked=hitSentence.slice(left,left+maxChars).trim();
    }
  }
  const accepted=aliases.some(a=>fold(picked).includes(a));
  return {accepted,text:accepted?picked:"",matched_alias:matched,reason:accepted?"focused-window":"alias-lost"};
}

export function answerStaysOnFocus(answer,query,aliasObject={}){
  const q=fold(query),a=fold(answer);
  const aliasMap=normalizeAliases(aliasObject);
  const explicit=[];
  for(const [key,aliases] of aliasMap.entries()){
    if(aliases.some(x=>x&&q.includes(x)))explicit.push(aliases);
  }
  if(!explicit.length)return true;
  return explicit.every(group=>group.some(x=>x&&a.includes(x)));
}

export function lexicalCandidates(rows,query,limit=80){
  const terms=queryTerms(query);
  if(!terms.length)return [];
  const out=[];
  for(const row of rows||[]){
    const hay=fold(row?.text||"");
    if(!hay)continue;
    let matched=0,freq=0;
    for(const t of terms){
      if(!hay.includes(t))continue;
      matched++;
      let at=0,count=0;
      while((at=hay.indexOf(t,at))>=0 && count<10){count++;at+=t.length;}
      freq+=count;
    }
    if(!matched)continue;
    const coverage=matched/terms.length;
    out.push({
      ...row,
      reference:publicReference(row),
      public_title:sanitizePublicTitle(row),
      lexical_score:coverage*8+Math.min(2,freq*0.12),
      coverage
    });
  }
  return out.sort((a,b)=>b.lexical_score-a.lexical_score||b.coverage-a.coverage).slice(0,Math.max(1,limit));
}

export function dot(a,b){
  const n=Math.min(a?.length||0,b?.length||0);let s=0;
  for(let i=0;i<n;i++)s+=Number(a[i]||0)*Number(b[i]||0);
  return s;
}
export function norm(a){let s=0;for(const x of a||[])s+=Number(x||0)*Number(x||0);return Math.sqrt(s)||1;}
export function cosine(a,b){return dot(a,b)/(norm(a)*norm(b));}

export function chooseInstalledModel(installed=[],requested="auto"){
  const names=new Set((installed||[]).map(x=>typeof x==="string"?x:String(x?.name||x?.model||"")).filter(Boolean));
  if(requested && requested!=="auto"){
    if(names.has(requested))return requested;
    const base=requested.split(":")[0];
    const close=[...names].find(n=>n===base||n.startsWith(base+":"));
    if(close)return close;
    return null;
  }
  for(const preferred of DEFAULT_MODEL_ORDER){
    if(names.has(preferred))return preferred;
  }
  return [...names].find(n=>/^qwen/i.test(n))||null;
}

export function formatExactAnswer(matches=[]){
  if(!matches.length)return "Nenhuma citação exata foi encontrada para todos os conceitos solicitados no mesmo bloco.";
  return matches.map((row,i)=>{
    const ref=String(row.reference||publicReference(row)||"Fonte");
    return "["+(i+1)+"] "+ref+"\n"+String(row.text||"").trim();
  }).join("\n\n");
}

export function formatGroundedAnswer(evidence=[],mode="explain"){
  const safeMode=RESPONSE_MODES.has(mode)?mode:"explain";
  const maxRows=safeMode==="short"?3:10;
  const rows=(evidence||[]).filter(row=>row?.citation_verified===true && row?.focus_verified===true && String(row?.text||"").trim()).slice(0,maxRows);
  if(!rows.length)return "A biblioteca local não encontrou evidência suficiente para responder a essa pergunta.";

  const clipExact=row=>{
    const raw=String(row?.text||"").replace(/\s+/g," ").trim();
    if(raw.length<=760)return raw;
    const focused=focusedEvidenceWindow(row,760);
    if(focused.accepted&&focused.text)return focused.text;
    return "";
  };
  const ref=row=>String(row?.citation_reference||row?.reference||publicReference(row)||"Fonte").trim()||"Fonte";
  const unique=[];
  const seen=new Set();
  for(const row of rows){
    const text=clipExact(row);
    const key=fold(ref(row)+"|"+text);
    if(!text||seen.has(key))continue;
    seen.add(key);
    unique.push({...row,_exact:text,_ref:ref(row)});
  }
  if(!unique.length)return "A biblioteca local não encontrou evidência suficiente para responder a essa pergunta.";

  if(safeMode==="compare"){
    return "Comparação documental — somente evidências da biblioteca:\n\n"+
      unique.map((row,i)=>"["+(i+1)+"] "+row._exact+"\n✓ Fonte verificada: "+row._ref).join("\n\n");
  }
  if(safeMode==="timeline"){
    return "Linha do tempo documental — somente evidências da biblioteca:\n\n"+
      unique.map((row,i)=>"["+(i+1)+"] "+row._exact+"\n✓ Fonte verificada: "+row._ref).join("\n\n");
  }
  if(safeMode==="short"){
    return unique.map((row,i)=>"["+(i+1)+"] "+row._exact+"\n✓ Fonte verificada: "+row._ref).join("\n\n");
  }
  return "Resposta documental exata — cada ponto abaixo vem diretamente da biblioteca:\n\n"+
    unique.map((row,i)=>"["+(i+1)+"] "+row._exact+"\n✓ Fonte verificada: "+row._ref).join("\n\n");
}

export function buildPrompt({question,mode,evidence=[]}){
  const safeMode=RESPONSE_MODES.has(mode)?mode:"explain";
  const evidenceText=(evidence||[]).map((r,i)=>{
    return "EVIDÊNCIA "+(i+1)+"\nREFERÊNCIA: "+String(r.reference||publicReference(r)||"Fonte")+"\nTEXTO LITERAL:\n"+String(r.text||"").trim();
  }).join("\n\n---\n\n");
  const modeInstruction={
    short:"Responda em português brasileiro de forma curta e direta, usando somente as evidências.",
    explain:"Explique em português brasileiro com profundidade e riqueza, em 4 a 8 pontos substantivos quando as evidências permitirem. Cada ponto deve responder diretamente à pergunta e permanecer sustentado pelas evidências recuperadas.",
    compare:"Compare as fontes recuperadas. Mostre convergências e diferenças somente quando elas estiverem presentes nas evidências.",
    timeline:"Organize as evidências cronologicamente. Use apenas datas explicitamente presentes nas evidências; itens sem data devem ficar em 'Data não identificada'.",
    exact:""
  }[safeMode];
  return [
    "Você é o cérebro local da Consciência Fabiano v2.",
    "FOCUS LOCK ABSOLUTO: responda exclusivamente ao assunto perguntado pelo usuário.",
    "Não traduza o texto, não faça sermão, não crie introdução genérica e não mude o tema.",
    "Não mencione outro assunto, pessoa, escritura ou doutrina a menos que isso apareça literalmente nas evidências e seja necessário para responder à pergunta.",
    "Comece diretamente pela resposta, sem dizer 'Claro', 'Aqui está', 'Vamos entender' ou frases semelhantes.",
    "REGRA ABSOLUTA: não use conhecimento externo para completar lacunas.",
    "REGRA ABSOLUTA: não invente fatos, páginas, títulos, citações ou datas.",
    "Se as evidências forem insuficientes ou não estiverem realmente focadas na pergunta, diga exatamente: A biblioteca recuperada não é suficiente para responder com foco.",
    "Nunca revele filename, chunk ID, caminho de arquivo, hash, nome técnico de banco ou detalhes internos.",
    modeInstruction,
    "",
    "PERGUNTA:",
    String(question||"").trim(),
    "",
    "EVIDÊNCIAS RECUPERADAS:",
    evidenceText||"(nenhuma evidência)"
  ].join("\n");
}

export function extractTimelineYear(text){
  const years=String(text||"").match(/\b(?:1[5-9]\d{2}|20\d{2}|21\d{2})\b/g);
  if(!years?.length)return null;
  return Math.min(...years.map(Number));
}
