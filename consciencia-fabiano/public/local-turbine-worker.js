// V3.1 OFFLINE TURBINES — worker de extração sem IA remota.
const BM25_K1=1.35;
const BM25_B=0.75;

function fold(text){
  return String(text||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase()
    .replace(/[^\p{L}\p{N}\s:]/gu," ").replace(/\s+/g," ").trim();
}
function tokenize(text){
  return fold(text).split(" ").filter(t=>t.length>=2);
}
function queryTerms(question){
  const stop=new Set(["a","o","as","os","de","da","do","das","dos","e","em","no","na","nos","nas","um","uma","que","sobre","para","por","com","como","quero","saber","saiba","mostre","mostrar","qual","quais","quem","onde","quando","porque","porquê","ser","estar","foi","era"]);
  return [...new Set(tokenize(question).filter(t=>t.length>=3&&!stop.has(t)))].slice(0,24);
}
function paragraphs(text){
  const raw=String(text||"").replace(/\r/g,"\n").replace(/\n{3,}/g,"\n\n").trim();
  if(!raw)return[];
  let parts=raw.split(/\n\s*\n+/).map(x=>x.trim()).filter(x=>x.length>=24);
  if(parts.length<=1 && raw.length>900){
    parts=raw.split(/(?<=[.!?;:])\s+(?=[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ0-9])/u).map(x=>x.trim()).filter(x=>x.length>=24);
  }
  const merged=[];
  for(const p of parts){
    if(p.length<=1200){merged.push(p);continue;}
    for(let i=0;i<p.length;i+=900) merged.push(p.slice(i,i+1050).trim());
  }
  return merged.filter(Boolean);
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
  const exactPhrase=fold(text).includes(fold(question)) && fold(question).length>=8;
  if(exactPhrase)score+=5;
  score+=coverage*4+Math.min(2,hits*.16)+proximityBonus(tokens,terms);
  if(coverage<.22 && !exactPhrase)score*=.45;
  if(dl<6)score*=.4;
  return {score,coverage,hits,exact:exactPhrase};
}
function paragraphIdf(ps,question){
  const terms=queryTerms(question);
  const folded=ps.map(fold);
  const N=Math.max(1,folded.length);
  const idf={};
  for(const term of terms){
    let df=0;
    for(const text of folded)if(text.includes(term))df++;
    idf[term]=Math.log(1+((N-df+.5)/(df+.5)));
  }
  return idf;
}
function extract(task){
  const ps=paragraphs(task.text);
  const idf=paragraphIdf(ps,task.question);
  const ranked=ps.map((text,index)=>({text,index,...scoreParagraph(text,task.question,idf)}))
    .filter(x=>x.score>0)
    .sort((a,b)=>b.score-a.score);
  const best=ranked[0]||null;
  if(!best)return {id:task.id,ok:false,score:0};
  const second=ranked.find(x=>x.index!==best.index && x.score>=best.score*.72);
  const selected=second ? [best,second].sort((a,b)=>a.index-b.index) : [best];
  return {
    id:task.id,
    ok:true,
    score:Number(best.score.toFixed(5)),
    coverage:Number(best.coverage.toFixed(4)),
    text:selected.map(x=>x.text).join("\n\n"),
    paragraph_count:selected.length,
    source:task.source||{},
    logical_node:task.logical_node
  };
}

self.onmessage=event=>{
  const data=event.data||{};
  if(data.type!=="extract")return;
  try{
    self.postMessage({type:"result",request_id:data.request_id,result:extract(data.task||{})});
  }catch(error){
    self.postMessage({type:"result",request_id:data.request_id,result:{id:data?.task?.id,ok:false,error:String(error?.message||error),logical_node:data?.task?.logical_node}});
  }
};
