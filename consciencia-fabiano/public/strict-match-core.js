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

const CANONICAL_REFERENCE_RE=/\b(?:(?:[1-4]\s*)?(?:N[eé]fi|Nephi|Alma|M[oó]rmon|Mormon|Mor[oô]ni|Moroni|Mosias|Mosiah|Jac[oó]|Jacob|Enos|Jarom|Omni)|Palavras\s+de\s+M[oó]rmon|Words\s+of\s+Mormon|[EÉ]ter|Ether|G[eê]nesis|Genesis|[EÊ]xodo|Exodus|Lev[ií]tico|Leviticus|N[uú]meros|Numbers|Deuteron[oô]mio|Deuteronomy|Josu[eé]|Joshua|Ju[ií]zes|Judges|Rute|Ruth|Samuel|Reis|Kings|Cr[oô]nicas|Chronicles|Esdras|Ezra|Neemias|Nehemiah|Ester|Esther|J[oó]|Job|Salmos?|Psalms?|Prov[eé]rbios|Proverbs|Eclesiastes|Ecclesiastes|Cantares|Isa[ií]as|Isaiah|Jeremias|Jeremiah|Lamenta[cç][oõ]es|Ezequiel|Ezekiel|Daniel|Oseias|Hosea|Joel|Am[oó]s|Amos|Obadias|Obadiah|Jonas|Jonah|Miqueias|Micah|Naum|Nahum|Habacuque|Habakkuk|Sofonias|Zephaniah|Ageu|Haggai|Zacarias|Zechariah|Malaquias|Malachi|Mateus|Matthew|Marcos|Mark|Lucas|Luke|Jo[aã]o|John|Atos|Acts|Romanos|Romans|Cor[ií]ntios|Corinthians|G[aá]latas|Galatians|Ef[eé]sios|Ephesians|Filipenses|Philippians|Colossenses|Colossians|Tessalonicenses|Thessalonians|Tim[oó]teo|Timothy|Tito|Titus|Filemom|Philemon|Hebreus|Hebrews|Tiago|James|Pedro|Peter|Judas|Jude|Apocalipse|Revelation|Doutrina\s+e\s+Conv[eê]nios|Doctrine\s+and\s+Covenants|D\s*&\s*C|Mois[eé]s|Moses|Abra[aã]o|Abraham|Joseph\s+Smith(?:—|-|\s)+Hist[oó]ria|Joseph\s+Smith(?:—|-|\s)+History|Regras\s+de\s+F[eé]|Articles\s+of\s+Faith)\s+\d{1,4}(?::\d{1,4}(?:\s*[-–]\s*\d{1,4})?)?/iu;
const GENERIC_BOOK_REFERENCE_RE=/\b([\p{L}][\p{L}\p{M}.'’ -]{1,48})\s+(Livro|Book)\s+([IVXLCDM]+|\d{1,3})\b/iu;

export function extractSemanticReference(text){
  const raw=String(text||"");
  const scripture=raw.match(CANONICAL_REFERENCE_RE);
  if(scripture)return scripture[0].replace(/\s+/g," ").replace(/\s*([:–-])\s*/g,"$1").trim();
  const book=raw.match(GENERIC_BOOK_REFERENCE_RE);
  if(book)return book[0].replace(/\s+/g," ").trim();
  return "";
}


const STRICT_STOPWORDS=new Set("a o as os um uma uns umas de da do das dos e em no na nos nas por para com sem sobre que qual quais como quando onde porque pois ser estar foi eram is the a an of to in on for with about what which how when where why".split(/\s+/));
export function buildStrictIntent(question){
  const phrase=deriveStrictPhrase(question);
  const anchors=[...new Set(phrase.split(/[^\p{L}\p{N}]+/u).filter(t=>t.length>=3&&!STRICT_STOPWORDS.has(t)))];
  return {phrase,anchors,required_anchors:anchors.slice(0,8),allow_relaxation:false};
}
export function strictIntentAudit(text,intentOrQuestion){
  const intent=typeof intentOrQuestion==="string"?buildStrictIntent(intentOrQuestion):(intentOrQuestion||{phrase:"",required_anchors:[]});
  const normalized=normalizeStrictText(text);
  const required=Array.isArray(intent.required_anchors)?intent.required_anchors:[];
  const matched=required.filter(a=>normalized.includes(normalizeStrictText(a)));
  return {accepted:required.length===0?!!normalized:matched.length===required.length,matched,required,coverage:required.length?matched.length/required.length:0};
}

export function strictParagraphMatch(text,question){
  const target=deriveStrictPhrase(question);
  if(!target)return {matched:false,target:"",paragraph:"",paragraph_index:-1};
  const blocks=paragraphBlocks(text);
  for(let i=0;i<blocks.length;i++){
    const normalized=normalizeStrictText(blocks[i]);
    if(normalized.includes(target)){
      const audit=strictIntentAudit(blocks[i],question);
      return {matched:true,target,paragraph:blocks[i],paragraph_index:i,intent_audit:audit};
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
