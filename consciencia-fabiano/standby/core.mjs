const JSON_HEADERS={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","Access-Control-Allow-Origin":"*"};
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:JSON_HEADERS});}
function fold(text){return String(text||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^\p{L}\p{N}\s:]/gu," ").replace(/\s+/g," ").trim();}
function terms(q){const stop=new Set(["a","o","as","os","de","da","do","das","dos","e","em","no","na","nos","nas","um","uma","que","sobre","para","por","com","como","quero","saber","saiba","mostre","mostrar","capitulo","capítulo","completo","inteiro","integral","texto","exato","literal","versiculo","versículo"]);return [...new Set(fold(q).split(" ").filter(x=>x.length>=3&&!stop.has(x)))].slice(0,8);}
function envValue(env,name){return String(env?.[name]||"").trim();}
async function supabaseLexical(env,question,limit=120){
  const base=envValue(env,"SUPABASE_URL").replace(/\/$/,""),token=envValue(env,"SUPABASE_SERVICE_ROLE_KEY");
  const qs=terms(question);if(!base||!token||!qs.length)return [];
  const url=new URL(base+"/rest/v1/rag_embeddings");
  url.searchParams.set("select","id,document_id,filename,title,author,language,page,chunk_index,text");
  url.searchParams.set("or","("+qs.map(t=>"text.ilike.*"+String(t).replace(/[,*()]/g,"")+"*").join(",")+")");
  url.searchParams.set("limit",String(Math.max(1,Math.min(500,limit))));
  const res=await fetch(url,{headers:{"Authorization":"Bearer "+token,"apikey":token,"Accept":"application/json"}});
  if(!res.ok)throw new Error("Supabase "+res.status);
  const rows=await res.json().catch(()=>[]);
  return (Array.isArray(rows)?rows:[]).map(row=>{
    const f=fold(row.text),hit=qs.filter(t=>f.includes(t)).length;
    return {...row,score:hit/Math.max(1,qs.length)};
  }).sort((a,b)=>b.score-a.score);
}
async function supabaseDocument(env,documentId,limit=1000){
  const base=envValue(env,"SUPABASE_URL").replace(/\/$/,""),token=envValue(env,"SUPABASE_SERVICE_ROLE_KEY");
  if(!base||!token||!documentId)return [];
  const url=new URL(base+"/rest/v1/rag_embeddings");
  url.searchParams.set("select","id,document_id,filename,title,author,language,page,chunk_index,text");
  url.searchParams.set("document_id","eq."+documentId);
  url.searchParams.set("order","chunk_index.asc");
  url.searchParams.set("limit",String(Math.max(1,Math.min(1000,limit))));
  const res=await fetch(url,{headers:{"Authorization":"Bearer "+token,"apikey":token,"Accept":"application/json"}});
  if(!res.ok)throw new Error("Supabase "+res.status);
  return await res.json().catch(()=>[]);
}
function stitch(rows){
  let out="";
  for(const row of [...rows].sort((a,b)=>Number(a.chunk_index||0)-Number(b.chunk_index||0))){
    const t=String(row.text||"");if(!t)continue;if(!out){out=t;continue;}
    let overlap=0,max=Math.min(360,out.length,t.length);
    for(let n=max;n>=12;n--){if(out.slice(-n)===t.slice(0,n)){overlap=n;break;}}
    out+=overlap?t.slice(overlap):"\n"+t;
  }
  return out;
}
function directIntent(q){const raw=String(q||""),f=fold(raw),c=f.match(/\b(?:capitulo|chapter)\s+(\d{1,4})\b/),v=raw.match(/\b(\d{1,4})\s*:\s*(\d{1,4})\b/);return{chapter:c?Number(c[1]):(v?Number(v[1]):null),verse:v?Number(v[2]):null};}
function chapterSlice(text,n){if(!n)return text;const a=new RegExp("(?:^|\\n)\\s*(?:CAP[ÍI]TULO|CAPITULO|CHAPTER)\\s+"+n+"\\b","im").exec(text);if(!a)return"";let s=a.index;if(text[s]==="\n")s++;const tail=a.index+a[0].length;const b=new RegExp("(?:^|\\n)\\s*(?:CAP[ÍI]TULO|CAPITULO|CHAPTER)\\s+"+(n+1)+"\\b","im").exec(text.slice(tail));return text.slice(s,b?tail+b.index:text.length).replace(/\s+$/,"");}
function verseSlice(text,v){if(!v)return text;const a=new RegExp("(^|[\\n\\r]|\\s)"+v+"\\s+(?=[A-ZÁÀÂÃÉÊÍÓÔÕÚÇa-záàâãéêíóôõúç])","mu").exec(text);if(!a)return"";const s=a.index+(a[1]?.length||0),tail=text.slice(s+String(v).length);const b=new RegExp("(^|[\\n\\r]|\\s)"+(v+1)+"\\s+(?=[A-ZÁÀÂÃÉÊÍÓÔÕÚÇa-záàâãéêíóôõúç])","mu").exec(tail);return text.slice(s,b?s+String(v).length+b.index+(b[1]?.length||0):text.length).replace(/\s+$/,"");}
async function direct(env,question){
  const anchors=await supabaseLexical(env,question,50);const anchor=anchors[0];if(!anchor)return null;
  const rows=await supabaseDocument(env,anchor.document_id,1000);let text=stitch(rows);const intent=directIntent(question);
  if(intent.chapter)text=chapterSlice(text,intent.chapter);if(text&&intent.verse)text=verseSlice(text,intent.verse);
  if(!text)return null;
  return{ok:true,text,bypass_llm:true,provider:"multi-cloud-standby",document_id:anchor.document_id,filename:anchor.filename,title:anchor.title,author:anchor.author,page:anchor.page,chunks_reassembled:rows.length};
}
async function chat(env,question){
  const rows=await supabaseLexical(env,question,100);if(!rows.length)return{ok:true,resposta:"Não encontrei conteúdo documental no espelho de contingência.",fontes:[],fallback:true};
  const key=envValue(env,"GROQ_API_KEY");if(!key){
    const resposta=rows.slice(0,12).map((r,i)=>"[F"+(i+1)+"] "+String(r.title||r.filename||"Documento")+"\n"+String(r.text||"")).join("\n\n");
    return{ok:true,resposta,fontes:rows.slice(0,12),fallback:false,provider:"standby-deterministic"};
  }
  const evidence=rows.slice(0,60).map((r,i)=>"[F"+(i+1)+"] "+String(r.title||r.filename||"Documento")+" p."+String(r.page||"")+"\n"+String(r.text||"")).join("\n\n");
  const res=await fetch("https://api.groq.com/openai/v1/chat/completions",{method:"POST",headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify({model:"openai/gpt-oss-20b",temperature:0,max_completion_tokens:2200,messages:[{role:"system",content:"Use somente as evidências fornecidas. Responda em português, com síntese documental e preserve [F#]. Não invente fatos."},{role:"user",content:"PERGUNTA:\n"+question+"\n\nEVIDÊNCIAS:\n"+evidence}]})});
  if(!res.ok)throw new Error("Groq "+res.status);const data=await res.json();return{ok:true,resposta:String(data?.choices?.[0]?.message?.content||""),fontes:rows.slice(0,60),fallback:false,provider:"standby-groq"};
}
export async function handleRequest(request,env={}){
  const url=new URL(request.url);
  if(request.method==="OPTIONS")return new Response("",{status:204,headers:JSON_HEADERS});
  if(url.pathname==="/health")return json({ok:true,service:"FNS Multi-Cloud Standby",version:"4.0.0"});
  if(request.method==="POST"&&url.pathname==="/api/rag/direct"){const body=await request.json().catch(()=>({}));const d=await direct(env,body.question||body.pergunta||"").catch(()=>null);return d?json(d):json({ok:false,code:"DIRECT_NOT_FOUND"},404);}
  if(request.method==="POST"&&url.pathname==="/api/chat"){const body=await request.json().catch(()=>({}));try{return json(await chat(env,String(body.pergunta||body.question||"")));}catch(error){return json({ok:false,message:String(error?.message||error)},503);}}
  return json({ok:false,code:"NOT_FOUND"},404);
}
