const STOP=new Set([
  "a","o","as","os","um","uma","uns","umas","de","da","do","das","dos","e","em","no","na","nos","nas",
  "por","para","com","sem","sobre","que","qual","quais","como","quando","onde","porque","pois","ser","estar",
  "foi","eram","me","diga","explique","explica","detalhe","detalhadamente","mostre","mostrar","busque","buscar",
  "encontre","encontrar","aconteceu","acontece","ocorreu","ocorre","ensina","ensinam","fala","falam","diz","dizem",
  "existe","existem","existia","significa","quero","saber","conte","descreva","descrever",
  "biblioteca","minha","segundo","somente","apenas","the","a","an","of","to","in","on",
  "for","with","about","what","which","how","when","where","why","tell","explain","show","find","search"
]);

export function v3Fold(text){
  return String(text||"")
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase()
    .replace(/[“”„‟«»"'’]/g,"")
    .replace(/[^\p{L}\p{N}\s:+-]/gu," ")
    .replace(/\s+/g," ")
    .trim();
}

function stemToken(token){
  let t=v3Fold(token);
  if(!t)return "";
  if(t.startsWith("espirit")||t.startsWith("spirit"))return "espirit";
  if(t==="world"||t.startsWith("world"))return "mundo";
  if(t==="life"||t.startsWith("life"))return "vida";
  if(t.startsWith("death"))return "mort";
  if(t.startsWith("premort"))return "premort";
  if(t.startsWith("preexist"))return "preexist";
  if(t.startsWith("mort"))return "mort";
  if(t.startsWith("salva")||t.startsWith("salvation"))return "salv";
  if(t.startsWith("redenc")||t.startsWith("redemption"))return "redenc";
  if(t.startsWith("ressur")||t.startsWith("resurrection"))return "ressur";
  if(t.startsWith("satan"))return "satan";
  if(t.startsWith("lucif"))return "lucif";
  if(t.startsWith("demon"))return "demon";
  if(t.startsWith("diab")||t.startsWith("devil"))return "diab";
  if(t.startsWith("sacerd"))return "sacerd";
  if(t.startsWith("exalt"))return "exalt";
  if(t.length>6)t=t.replace(/(?:mente|ções|coes|ção|cao|ais|al|ico|ica|icos|icas|osos|osas|oso|osa)$/u,"");
  if(t.length>5)t=t.replace(/(?:es|s)$/u,"");
  return t;
}

function tokenStems(text){
  return [...new Set(v3Fold(text).split(/\s+/).map(stemToken).filter(x=>x.length>=3&&!STOP.has(x)))];
}

function overlapRatio(a,b){
  if(!a.length||!b.length)return 0;
  const set=new Set(b);
  let hit=0;
  for(const x of a)if(set.has(x))hit++;
  return hit/Math.max(1,a.length);
}
function compactStemText(text){
  return " "+tokenStems(text).join(" ")+" ";
}
function stemCoverage(queryStems,stemText){
  if(!queryStems.length||!stemText)return 0;
  let hit=0;
  for(const stem of queryStems)if(stemText.includes(" "+stem+" "))hit++;
  return hit/Math.max(1,queryStems.length);
}

function aliasFamilies(aliasObject={}){
  return Object.entries(aliasObject||{}).map(([key,value])=>{
    const phrases=[key,...(Array.isArray(value)?value:[])].map(v3Fold).filter(Boolean);
    return {key:v3Fold(key),phrases:[...new Set(phrases)],stems:tokenStems(key)};
  });
}

export function expandV3Query(query,aliasObject={},extra=[]){
  const q=v3Fold(query);
  const qStems=tokenStems(q);
  const phrases=[q,...(extra||[]).map(v3Fold).filter(Boolean)];
  for(const family of aliasFamilies(aliasObject)){
    let matched=family.phrases.some(p=>p && (q.includes(p)||p.includes(q)));
    if(!matched){
      const ratio=overlapRatio(family.stems,qStems);
      matched=ratio>=0.66 && Math.min(family.stems.length,qStems.length)>=1;
    }
    if(matched)phrases.push(...family.phrases);
  }
  return [...new Set(phrases.filter(x=>x.length>=3))].slice(0,40);
}

function isStandardWorks(row={}){
  const raw=[row.filename,row.title,row.source_title,row.document_title].map(x=>String(x||"")).join(" ");
  return /standard[-_ ]?works|obras[-_ ]?padrao|obras\s+padr[aã]o/i.test(v3Fold(raw));
}

function cleanTitle(row={}){
  const raw=String(row.title||row.source_title||row.filename||"").replace(/\.pdf$/i,"");
  const clean=raw.replace(/[_-]+/g," ").replace(/\s+/g," ").trim();
  if(isStandardWorks(row))return "";
  return clean||"Livro";
}

export function parseScriptureFooter(pageText=""){
  const raw=String(pageText||"").replace(/\s+/g," ").trim();
  if(!raw)return null;
  const tail=raw.slice(-1800);
  const re=/\b\d{1,4}\s+((?:(?:[1-4]\s+)?[A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-ZÁÉÍÓÚÂÊÔÃÕÇ.&—-]*(?:\s+(?:E|DE|DO|DA|DOS|DAS|[A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-ZÁÉÍÓÚÂÊÔÃÕÇ.&—-]*)){0,5}))\s+(\d{1,4}):(\d{1,4})(?:\s*[–-]\s*(?:(\d{1,4}):)?(\d{1,4}))?\b/gu;
  let m,last=null;
  while((m=re.exec(tail))){
    const chapter=Number(m[2]||0);
    const start=Number(m[3]||0);
    const endChapter=Number(m[4]||chapter);
    const end=Number(m[5]||start);
    last={
      book:String(m[1]||"").replace(/\s+/g," ").trim(),
      chapter,start,endChapter,end,
      crossChapter:endChapter!==chapter
    };
  }
  if(!last?.book||!last.chapter||!last.start)return null;
  last.reference=last.book+" "+last.chapter+":"+last.start+
    (last.crossChapter?"–"+last.endChapter+":"+last.end:(last.end!==last.start?"–"+last.end:""));
  return last;
}

function verseStarts(text,footer){
  const raw=String(text||"");
  const out=[];
  if(footer?.crossChapter)return out;
  const re=/(^|[.!?;:]\s+|\n|\s)(\d{1,3})\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ“"(\[])/gu;
  let m;
  while((m=re.exec(raw))){
    const verse=Number(m[2]);
    if(verse<footer.start||verse>footer.end)continue;
    const local=m[0].lastIndexOf(m[2]);
    const index=m.index+(local>=0?local:0);
    if(out.some(x=>x.verse===verse))continue;
    out.push({verse,index});
  }
  return out.sort((a,b)=>a.index-b.index);
}

function cleanScriptureSegment(text,footer){
  let raw=String(text||"").replace(/\s+/g," ").trim();
  const escapedBook=footer.book.replace(/[.*+?^$()|[\]\\]/g,"\\$&");
  const footerStart=new RegExp("\\b\\d{1,4}\\s+"+escapedBook+"\\s+"+footer.chapter+":"+footer.start+"\\b","iu");
  const footerAt=raw.search(footerStart);
  if(footerAt>20)raw=raw.slice(0,footerAt).trim();

  const noteAt=raw.search(/\s+\d{1,3}\s+[a-z]\s+(?=(?:GEE\b|TJS\b|JS—|(?:[1-4]\s+)?[A-ZÁÉÍÓÚÂÊÔÃÕÇ]))/u);
  if(noteAt>20)raw=raw.slice(0,noteAt).trim();

  raw=raw.replace(/\s+[a-z]\s+GEE\b[^.;]{0,220}/giu," ");
  raw=raw.replace(/\s+\d{1,3}\s+[a-z]\s+GEE\b[^.;]{0,220}/giu," ");
  return raw.replace(/\s+/g," ").trim();
}

function splitBookText(text,maxChars=900){
  const raw=String(text||"").replace(/\r\n?/g,"\n").trim();
  if(!raw)return [];
  const paragraphs=raw.split(/\n\s*\n+/).map(x=>x.replace(/\s+/g," ").trim()).filter(Boolean);
  const source=paragraphs.length>1?paragraphs:[raw.replace(/\s+/g," ").trim()];
  const out=[];
  for(const para of source){
    if(para.length<=maxChars){out.push(para);continue;}
    const sentences=para.split(/(?<=[.!?;:])\s+/u).filter(Boolean);
    let current="";
    for(const sentence of sentences){
      if((current+" "+sentence).trim().length<=maxChars){current=(current+" "+sentence).trim();continue;}
      if(current)out.push(current);
      current=sentence;
    }
    if(current)out.push(current);
  }
  return out.filter(x=>x.length>=35);
}

export function buildV3EvidenceIndex(rows=[]){
  const units=[];
  const pages=new Map();
  for(const row of rows||[]){
    if(isStandardWorks(row)){
      const key=String(row.document_id||row.doc_key||"")+"|"+String(Number(row.page||0)||0);
      if(!pages.has(key))pages.set(key,[]);
      pages.get(key).push(row);
      continue;
    }
    const title=cleanTitle(row);
    const page=Number(row.page||0)||null;
    const segments=splitBookText(row.text,900);
    segments.forEach((text,index)=>{
      units.push({
        id:"v3-book:"+String(row.id||row.key||row.document_id+":"+row.chunk_index)+":"+index,
        kind:"book-paragraph",
        document_id:String(row.document_id||row.doc_key||""),
        source_chunk_id:String(row.id||row.key||""),
        title,author:String(row.author||""),language:String(row.language||""),
        page,reference:[title,page?"página "+page:""].filter(Boolean).join(" • "),
        text,stem_text:compactStemText(text),verified:true
      });
    });
  }

  for(const group of pages.values()){
    group.sort((a,b)=>Number(a.chunk_index||0)-Number(b.chunk_index||0));
    const pageText=group.map(x=>String(x.text||"")).join(" ");
    const footer=parseScriptureFooter(pageText);
    if(!footer)continue;
    const starts=verseStarts(pageText,footer);
    if(starts.length){
      for(let i=0;i<starts.length;i++){
        const current=starts[i],next=starts[i+1];
        let body=pageText.slice(current.index,next?next.index:pageText.length);
        body=body.replace(new RegExp("^\\s*"+current.verse+"\\s+"),"");
        body=cleanScriptureSegment(body,footer);
        if(body.length<20)continue;
        units.push({
          id:"v3-scripture:"+String(group[0].document_id||"")+":"+String(group[0].page||0)+":"+current.verse,
          kind:"scripture-verse",
          document_id:String(group[0].document_id||""),
          source_chunk_id:String(group[0].id||""),
          title:footer.book,author:"",language:String(group[0].language||"pt"),
          page:Number(group[0].page||0)||null,
          reference:footer.book+" "+footer.chapter+":"+current.verse,
          text:body,stem_text:compactStemText(body),verified:true
        });
      }
    }else{
      const cleaned=cleanScriptureSegment(pageText,footer);
      for(const [index,text] of splitBookText(cleaned,900).entries()){
        units.push({
          id:"v3-scripture-page:"+String(group[0].document_id||"")+":"+String(group[0].page||0)+":"+index,
          kind:"scripture-page-window",
          document_id:String(group[0].document_id||""),
          source_chunk_id:String(group[0].id||""),
          title:footer.book,author:"",language:String(group[0].language||"pt"),
          page:Number(group[0].page||0)||null,
          reference:footer.reference,
          text,stem_text:compactStemText(text),verified:true
        });
      }
    }
  }

  return {
    version:"3.0.2-evidence-engine-focus",
    generated_at:new Date().toISOString(),
    source_rows:Number(rows?.length||0),
    units,
    counts:units.reduce((acc,u)=>{acc[u.kind]=(acc[u.kind]||0)+1;return acc;},{})
  };
}

function phraseScore(normalized,phrases){
  let score=0,hits=0;
  for(const phrase of phrases){
    if(!phrase||phrase.length<3)continue;
    if(normalized.includes(phrase)){hits++;score+=phrase.includes(" ")?6:2;}
  }
  return {score,hits};
}

export function searchV3Evidence(index,query,aliasObject={},options={}){
  const limit=Math.max(1,Math.min(80,Number(options.limit||16)));
  const strict=Boolean(options.strict);
  const expansions=expandV3Query(query,aliasObject,options.extraExpansions||[]);
  const original=v3Fold(query);
  const qStems=tokenStems(query);
  const expansionStems=tokenStems(expansions.join(" "));
  const out=[];

  for(const unit of index?.units||[]){
    const stemText=unit.stem_text||compactStemText(unit.text);
    const coreCoverage=stemCoverage(qStems,stemText);
    const broadCoverage=stemCoverage(expansionStems,stemText);
    if(!strict && coreCoverage<0.5 && broadCoverage<0.20)continue;
    const normalized=v3Fold(unit.text);
    const direct=phraseScore(normalized,expansions);
    const exactOriginal=original.length>=4&&normalized.includes(original);
    const minCore=qStems.length<=1?1:(qStems.length===2?1:0.67);
    if(strict && !exactOriginal)continue;
    if(!strict && direct.hits===0 && coreCoverage<minCore)continue;
    let freq=0;
    for(const stem of qStems)if(stemText.includes(" "+stem+" "))freq++;
    const score=(exactOriginal?14:0)+direct.score+coreCoverage*10+broadCoverage*5+Math.min(3,freq*0.7);
    if(score<3.2)continue;
    out.push({...unit,score,query_core_coverage:coreCoverage,query_broad_coverage:broadCoverage});
  }

  out.sort((a,b)=>b.score-a.score||String(a.reference).localeCompare(String(b.reference)));
  const seen=new Set(),final=[];
  for(const row of out){
    const key=row.reference+"|"+v3Fold(row.text).slice(0,220);
    if(seen.has(key))continue;
    seen.add(key);final.push(row);
    if(final.length>=limit)break;
  }
  return {query,expansions,total:out.length,results:final};
}

export function formatV3EvidenceAnswer(searchResult,mode="explain"){
  const results=searchResult?.results||[];
  if(!results.length)return "A V3 não encontrou evidências documentais verificadas suficientes para responder a essa pergunta.";
  const max=mode==="short"?4:mode==="compare"?14:mode==="timeline"?14:12;
  const picked=results.slice(0,max);
  const header=mode==="exact"
    ?"Citações documentais verificadas:"
    :"Resposta documental V3 — somente evidências verificadas da biblioteca:";
  return header+"\n\n"+picked.map((row,i)=>
    "["+(i+1)+"] "+String(row.text||"").trim()+"\n✓ Fonte verificada: "+row.reference
  ).join("\n\n");
}
