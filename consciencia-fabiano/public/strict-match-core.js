// V4.0 OMNI-LIBRARY SYMMETRY — único núcleo matemático para Cloudflare e navegador.
export const STRICT_MATCH_VERSION="4.0.0";
export const STRICT_LOGICAL_TASK_CAP=1000;
export const STRICT_PER_DOCUMENT_HIT_CAP=8;

const REQUEST_PREFIX_RE=/^(?:(?:por\s+favor|please)\s+)?(?:(?:me|para\s+mim)\s+)?(?:mostre|mostrar|busque|buscar|procure|procurar|encontre|encontrar|leia|ler|cite|citar|pesquise|pesquisar|ache|achar|find|show|search(?:\s+for)?|read|quote)\s+/iu;
const ABOUT_PREFIX_RE=/^(?:o\s+que\s+(?:diz|fala)\s+(?:sobre|a\s+respeito\s+de)|quero\s+saber\s+(?:sobre|a\s+respeito\s+de)|fale\s+(?:sobre|a\s+respeito\s+de)|informacoes?\s+(?:sobre|de)|informa[cç][oõ]es?\s+(?:sobre|de)|what\s+(?:does|is)\s+.*?\s+about)\s+/iu;

export function normalizeStrictText(text){
  return String(text||"")
    .normalize("NFC")
    .toLocaleLowerCase()
    .replace(/[“”„‟«»"']/g,"")
    .replace(/[–—]/g,"-")
    .replace(/\s*:\s*/g,":")
    .replace(/\s*-\s*/g,"-")
    .replace(/[\t\f\v]+/g," ")
    .replace(/\s+/g," ")
    .trim();
}

export function deriveStrictPhrase(question){
  let raw=String(question||"").normalize("NFC").trim();
  raw=raw.replace(/[?!.,;]+$/g,"").trim();
  for(let i=0;i<2;i++){
    const next=raw.replace(REQUEST_PREFIX_RE,"").replace(ABOUT_PREFIX_RE,"").trim();
    if(next===raw)break;
    raw=next;
  }
  return normalizeStrictText(raw);
}

export function paragraphBlocks(text){
  const raw=String(text||"").replace(/\r\n?/g,"\n").replace(/\n{3,}/g,"\n\n").trim();
  if(!raw)return [];
  const explicit=raw.split(/\n\s*\n+/).map(x=>x.trim()).filter(Boolean);
  return explicit.length ? explicit : [raw];
}

export function strictParagraphMatch(text,question){
  const target=deriveStrictPhrase(question);
  if(!target)return {matched:false,target:"",paragraph:"",paragraph_index:-1};
  const blocks=paragraphBlocks(text);
  for(let i=0;i<blocks.length;i++){
    const normalized=normalizeStrictText(blocks[i]);
    if(normalized.includes(target)){
      return {matched:true,target,paragraph:blocks[i],paragraph_index:i};
    }
  }
  return {matched:false,target,paragraph:"",paragraph_index:-1};
}

export function firstStrictAnchor(question){
  const target=deriveStrictPhrase(question);
  if(!target)return "";
  return target.split(/\s+/).find(token=>token.length>=2)||target;
}

export function roundRobinStrictHits(perDocument,limit=STRICT_LOGICAL_TASK_CAP){
  const entries=[...perDocument.entries()].sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
  const out=[];
  let round=0,progress=true;
  while(out.length<limit&&progress){
    progress=false;
    for(const [,rows] of entries){
      if(round<rows.length){
        out.push(rows[round]);
        progress=true;
        if(out.length>=limit)break;
      }
    }
    round++;
  }
  return out;
}

export function pushStrictHit(perDocument,row,cap=STRICT_PER_DOCUMENT_HIT_CAP){
  const documentId=String(row?.document_id||row?.doc_key||row?.filename||row?.title||"unknown");
  const list=perDocument.get(documentId)||[];
  if(list.length<cap)list.push(row);
  perDocument.set(documentId,list);
}

export function strictFilterRows(rows,question,limit=STRICT_LOGICAL_TASK_CAP){
  const perDocument=new Map();
  let scanned=0,exactHits=0;
  for(const row of (Array.isArray(rows)?rows:[])){
    scanned++;
    const match=strictParagraphMatch(row?.text||row?.trecho||"",question);
    if(!match.matched)continue;
    exactHits++;
    pushStrictHit(perDocument,{...row,score:100,coverage:1,strict_phrase:match.target,strict_paragraph_index:match.paragraph_index,retrieval_mode:"strict-phrase-v4"});
  }
  return {matches:roundRobinStrictHits(perDocument,limit),scanned,exact_hits:exactHits,documents_hit:perDocument.size,target:deriveStrictPhrase(question)};
}
