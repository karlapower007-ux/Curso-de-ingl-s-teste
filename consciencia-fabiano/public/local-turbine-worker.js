// V3.2 SEMANTIC EXPANSION — extração offline ampla, referência canônica e zero IA remota.
const BM25_K1=1.35;
const BM25_B=0.75;
const CONTEXT_BEFORE=2;
const CONTEXT_AFTER=4;

function fold(text){
  return String(text||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase()
    .replace(/[^\p{L}\p{N}\s:–—-]/gu," ").replace(/\s+/g," ").trim();
}
function tokenize(text){return fold(text).split(" ").filter(t=>t.length>=2);}
function queryTerms(question){
  const stop=new Set(["a","o","as","os","de","da","do","das","dos","e","em","no","na","nos","nas","um","uma","que","sobre","para","por","com","como","quero","saber","saiba","mostre","mostrar","qual","quais","quem","onde","quando","porque","porquê","ser","estar","foi","era"]);
  return [...new Set(tokenize(question).filter(t=>t.length>=3&&!stop.has(t)))].slice(0,24);
}
function paragraphStructure(text){
  const raw=String(text||"").replace(/\r\n?/g,"\n").replace(/\n{3,}/g,"\n\n").trim();
  if(!raw)return {raw:"",parts:[],indivisible:true};
  const explicit=raw.split(/\n\s*\n+/).map(x=>x.trim()).filter(x=>x.length>=24);
  const structurallyIndivisible=explicit.length<=1;
  let parts=explicit;
  if(structurallyIndivisible && raw.length>900){
    parts=raw.split(/(?<=[.!?;:])\s+(?=[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ0-9])/u).map(x=>x.trim()).filter(x=>x.length>=24);
  }
  if(!parts.length)parts=[raw];
  return {raw,parts,indivisible:structurallyIndivisible};
}
function termFrequency(tokens){
  const map=new Map();
  for(const t of tokens)map.set(t,(map.get(t)||0)+1);
  return map;
}
function proximityBonus(tokens,terms){
  const positions=new Map();
  for(const term of terms)positions.set(term,[]);
  for(let i=0;i<tokens.length;i++)if(positions.has(tokens[i]))positions.get(tokens[i]).push(i);
  const active=[...positions.values()].filter(a=>a.length);
  if(active.length<2)return 0;
  let min=Infinity,max=-Infinity;
  for(const a of active){min=Math.min(min,a[0]);max=Math.max(max,a[0]);}
  const span=Math.max(1,max-min+1);
  return Math.max(0,2.2-(span/Math.max(4,terms.length*5)));
}
function scoreParagraph(text,question,idf={}){
  const terms=queryTerms(question);
  if(!terms.length)return {score:0,coverage:0,hits:0,exact:false};
  const tokens=tokenize(text);
  const tf=termFrequency(tokens);
  const dl=Math.max(1,tokens.length);
  let score=0,hits=0,matched=0;
  for(const term of terms){
    const freq=tf.get(term)||0;
    if(!freq)continue;
    matched++;hits+=freq;
    const weight=Number(idf?.[term]||1);
    const denom=freq+BM25_K1*(1-BM25_B+BM25_B*(dl/85));
    score+=weight*((freq*(BM25_K1+1))/Math.max(.0001,denom));
  }
  const coverage=matched/terms.length;
  const exactPhrase=fold(text).includes(fold(question))&&fold(question).length>=8;
  if(exactPhrase)score+=5;
  score+=coverage*4+Math.min(2,hits*.16)+proximityBonus(tokens,terms);
  if(coverage<.22&&!exactPhrase)score*=.45;
  if(dl<6)score*=.4;
  return {score,coverage,hits,exact:exactPhrase};
}
function paragraphIdf(ps,question){
  const terms=queryTerms(question);
  const folded=ps.map(fold),N=Math.max(1,folded.length),idf={};
  for(const term of terms){
    let df=0;
    for(const text of folded)if(text.includes(term))df++;
    idf[term]=Math.log(1+((N-df+.5)/(df+.5)));
  }
  return idf;
}
function contextWindow(structure,targetIndex){
  if(structure.indivisible)return {
    text:structure.raw,
    start:0,end:Math.max(0,structure.parts.length-1),
    used_full_chunk:true
  };
  const start=Math.max(0,targetIndex-CONTEXT_BEFORE);
  const end=Math.min(structure.parts.length-1,targetIndex+CONTEXT_AFTER);
  return {
    text:structure.parts.slice(start,end+1).join("\n\n"),
    start,end,used_full_chunk:false
  };
}
const CANONICAL_REFERENCE_RE=/\b(?:(?:[1-4]\s*)?(?:N[eé]fi|Nephi|Alma|M[oó]rmon|Mormon|Mor[oô]ni|Moroni|Mosias|Mosiah|Jac[oó]|Jacob|Enos|Jarom|Omni)|Palavras\s+de\s+M[oó]rmon|Words\s+of\s+Mormon|[EÉ]ter|Ether|G[eê]nesis|Genesis|[EÊ]xodo|Exodus|Lev[ií]tico|Leviticus|N[uú]meros|Numbers|Deuteron[oô]mio|Deuteronomy|Josu[eé]|Joshua|Ju[ií]zes|Judges|Rute|Ruth|Samuel|Reis|Kings|Cr[oô]nicas|Chronicles|Esdras|Ezra|Neemias|Nehemiah|Ester|Esther|J[oó]|Job|Salmos?|Psalms?|Prov[eé]rbios|Proverbs|Eclesiastes|Ecclesiastes|Cantares|Isa[ií]as|Isaiah|Jeremias|Jeremiah|Lamenta[cç][oõ]es|Ezequiel|Ezekiel|Daniel|Oseias|Hosea|Joel|Am[oó]s|Amos|Obadias|Obadiah|Jonas|Jonah|Miqueias|Micah|Naum|Nahum|Habacuque|Habakkuk|Sofonias|Zephaniah|Ageu|Haggai|Zacarias|Zechariah|Malaquias|Malachi|Mateus|Matthew|Marcos|Mark|Lucas|Luke|Jo[aã]o|John|Atos|Acts|Romanos|Romans|Cor[ií]ntios|Corinthians|G[aá]latas|Galatians|Ef[eé]sios|Ephesians|Filipenses|Philippians|Colossenses|Colossians|Tessalonicenses|Thessalonians|Tim[oó]teo|Timothy|Tito|Titus|Filemom|Philemon|Hebreus|Hebrews|Tiago|James|Pedro|Peter|Judas|Jude|Apocalipse|Revelation|Doutrina\s+e\s+Conv[eê]nios|Doctrine\s+and\s+Covenants|D\s*&\s*C|Mois[eé]s|Moses|Abra[aã]o|Abraham|Joseph\s+Smith(?:—|-|\s)+Hist[oó]ria|Joseph\s+Smith(?:—|-|\s)+History|Regras\s+de\s+F[eé]|Articles\s+of\s+Faith|Cap[ií]tulo|Chapter)\s+\d{1,4}(?::\d{1,4}(?:\s*[-–]\s*\d{1,4})?)?/giu;
function canonicalReference(text){
  const raw=String(text||"");
  CANONICAL_REFERENCE_RE.lastIndex=0;
  const match=CANONICAL_REFERENCE_RE.exec(raw);
  if(!match)return "";
  return match[0].replace(/\s+/g," ").replace(/\s*([:–-])\s*/g,"$1").trim();
}
function sourceLabel(source){
  const raw=String(source?.title||source?.filename||"Documento").replace(/\.pdf$/i,"").trim();
  return raw||"Documento";
}
function semanticTitle(text,source){
  const ref=canonicalReference(text);
  const sourceName=sourceLabel(source);
  return ref ? ref+" ("+sourceName+")" : sourceName;
}
function extract(task){
  const structure=paragraphStructure(task.text);
  const ps=structure.parts;
  const idf=paragraphIdf(ps,task.question);
  const ranked=ps.map((text,index)=>({text,index,...scoreParagraph(text,task.question,idf)}))
    .filter(x=>x.score>0).sort((a,b)=>b.score-a.score);
  const best=ranked[0]||null;
  if(!best)return {id:task.id,ok:false,score:0};
  const window=contextWindow(structure,best.index);
  const reference=canonicalReference(window.text);
  return {
    id:task.id,ok:true,
    score:Number(best.score.toFixed(5)),
    coverage:Number(best.coverage.toFixed(4)),
    text:window.text,
    target_paragraph_index:best.index,
    context_window_start:window.start,
    context_window_end:window.end,
    context_before:CONTEXT_BEFORE,
    context_after:CONTEXT_AFTER,
    full_chunk_fallback:window.used_full_chunk,
    paragraph_count:Math.max(1,window.end-window.start+1),
    canonical_reference:reference,
    semantic_title:semanticTitle(window.text,task.source||{}),
    source:task.source||{},
    logical_node:task.logical_node
  };
}
self.onmessage=event=>{
  const data=event.data||{};
  if(data.type!=="extract")return;
  try{self.postMessage({type:"result",request_id:data.request_id,result:extract(data.task||{})});}
  catch(error){self.postMessage({type:"result",request_id:data.request_id,result:{id:data?.task?.id,ok:false,error:String(error?.message||error),logical_node:data?.task?.logical_node}});}
};
