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

export function publicReference(row={}){
  const canonical=String(row.reference||row.canonical_reference||extractSemanticReference(row.text||"")||"").trim();
  if(canonical) return canonical;
  const title=sanitizePublicTitle(row);
  const page=Number(row.page||0);
  return [title,page?("página "+page):""].filter(Boolean).join(" • ");
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

export function buildPrompt({question,mode,evidence=[]}){
  const safeMode=RESPONSE_MODES.has(mode)?mode:"explain";
  const evidenceText=(evidence||[]).map((r,i)=>{
    return "EVIDÊNCIA "+(i+1)+"\nREFERÊNCIA: "+String(r.reference||publicReference(r)||"Fonte")+"\nTEXTO LITERAL:\n"+String(r.text||"").trim();
  }).join("\n\n---\n\n");
  const modeInstruction={
    short:"Responda em português brasileiro de forma curta e direta, usando somente as evidências.",
    explain:"Explique em português brasileiro com profundidade, mas use somente afirmações sustentadas pelas evidências.",
    compare:"Compare as fontes recuperadas. Mostre convergências e diferenças somente quando elas estiverem presentes nas evidências.",
    timeline:"Organize as evidências cronologicamente. Use apenas datas explicitamente presentes nas evidências; itens sem data devem ficar em 'Data não identificada'.",
    exact:""
  }[safeMode];
  return [
    "Você é o cérebro local da Consciência Fabiano v2.",
    "REGRA ABSOLUTA: não use conhecimento externo para completar lacunas.",
    "REGRA ABSOLUTA: não invente fatos, páginas, títulos, citações ou datas.",
    "Se as evidências forem insuficientes, diga exatamente que a biblioteca recuperada não é suficiente.",
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
