import http from "node:http";

const PORT=11434;
function json(res,data,status=200){
  res.statusCode=status;
  res.setHeader("Content-Type","application/json");
  res.end(JSON.stringify(data));
}
function vector(text){
  const s=String(text||"");
  const out=new Array(16).fill(0);
  for(let i=0;i<s.length;i++)out[i%16]+=((s.charCodeAt(i)%97)+1)/100;
  const norm=Math.sqrt(out.reduce((a,b)=>a+b*b,0))||1;
  return out.map(x=>x/norm);
}
async function body(req){
  const parts=[];for await(const p of req)parts.push(p);
  try{return JSON.parse(Buffer.concat(parts).toString("utf8")||"{}");}catch{return {};}
}
http.createServer(async(req,res)=>{
  if(req.method==="GET"&&req.url==="/api/tags"){
    json(res,{models:[
      {name:"qwen3:0.6b",model:"qwen3:0.6b"},
      {name:"qwen3-embedding:0.6b",model:"qwen3-embedding:0.6b"}
    ]});return;
  }
  if(req.method==="POST"&&req.url==="/api/embed"){
    const b=await body(req),input=Array.isArray(b.input)?b.input:[b.input];
    json(res,{model:String(b.model||"qwen3-embedding:0.6b"),embeddings:input.map(vector)});return;
  }
  if(req.method==="POST"&&req.url==="/api/chat"){
    const b=await body(req);
    json(res,{model:String(b.model||"qwen3:0.6b"),message:{role:"assistant",content:"MOCK_QWEN_LOCAL_OK — O Plano de Salvação inclui a Vida Pré-Mortal, conforme a evidência recebida."},done:true});return;
  }
  json(res,{error:"not found"},404);
}).listen(PORT,"127.0.0.1",()=>console.log("MOCK_OLLAMA=http://127.0.0.1:"+PORT));
