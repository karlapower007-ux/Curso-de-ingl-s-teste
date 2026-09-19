import http from "node:http";
import {readdir,readFile} from "node:fs/promises";
import path from "node:path";
import {gunzipSync} from "node:zlib";

const PORT=Number(process.env.PORT||8788);
const ROOT=process.cwd();
const docs=[];
const chunks=[];

function fold(text){return String(text||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^\p{L}\p{N}\s:]/gu," ").replace(/\s+/g," ").trim();}
function terms(q){return [...new Set(fold(q).split(" ").filter(x=>x.length>=3))].slice(0,18);}
function cors(res){res.setHeader("Access-Control-Allow-Origin","*");res.setHeader("Access-Control-Allow-Headers","Content-Type");}
function json(res,data,status=200){cors(res);res.statusCode=status;res.setHeader("Content-Type","application/json; charset=utf-8");res.end(JSON.stringify(data));}
async function loadRawVault(){
  const dir=path.join(ROOT,"raw-vault","generated");
  for(const name of await readdir(dir).catch(()=>[])){
    if(!/\.(txt|md)$/i.test(name))continue;
    const text=await readFile(path.join(dir,name),"utf8").catch(()=>"");
    if(!text)continue;
    const id="raw-"+docs.length;
    docs.push({id,title:name,text});
    let index=0;
    for(let at=0;at<text.length;at+=780){
      chunks.push({document_id:id,title:name,filename:name,chunk_index:index++,page:null,text:text.slice(at,at+900)});
    }
  }
}
async function loadSteel(){
  if(chunks.length)return;
  const dir=path.join(ROOT,"public","steel");
  const idx=JSON.parse(await readFile(path.join(dir,"index.json"),"utf8").catch(()=>"{\"shards\":[]}"));
  for(const shard of (Array.isArray(idx.shards)?idx.shards:[])){
    const file=path.join(ROOT,"public",String(shard.path||"").replace(/^\//,""));
    let rows=[];
    try{rows=JSON.parse(gunzipSync(await readFile(file)).toString("utf8"));}catch{continue;}
    chunks.push(...rows);
  }
}
function search(q,limit=20){
  const qs=terms(q),out=[];
  for(const row of chunks){
    const f=fold(row.text);let hit=0,freq=0;
    for(const t of qs){if(!f.includes(t))continue;hit++;freq+=(f.split(t).length-1);}
    if(hit)out.push({...row,score:(hit/Math.max(1,qs.length))*5+Math.min(3,freq*.2)});
  }
  return out.sort((a,b)=>b.score-a.score).slice(0,limit);
}
function stitch(rows){
  let out="";
  for(const r of [...rows].sort((a,b)=>Number(a.chunk_index||0)-Number(b.chunk_index||0))){
    const t=String(r.text||"");if(!t)continue;
    if(!out){out=t;continue;}
    let overlap=0,max=Math.min(360,out.length,t.length);
    for(let n=max;n>=12;n--){if(out.slice(-n)===t.slice(0,n)){overlap=n;break;}}
    out+=overlap?t.slice(overlap):"\n"+t;
  }
  return out;
}
function direct(q){
  const anchor=search(q,1)[0];if(!anchor)return null;
  const rows=chunks.filter(r=>String(r.document_id||"")===String(anchor.document_id||"")).slice(0,1000);
  return {...anchor,text:stitch(rows),chunks_reassembled:rows.length};
}
async function readBody(req){
  const parts=[];for await(const part of req)parts.push(part);
  try{return JSON.parse(Buffer.concat(parts).toString("utf8")||"{}");}catch{return {};}
}

await loadRawVault();
await loadSteel();

http.createServer(async(req,res)=>{
  if(req.method==="OPTIONS"){cors(res);res.statusCode=204;res.end();return;}
  if(req.url==="/health"){json(res,{ok:true,service:"FNS Desktop Fallback",version:"3.1.0",chunks:chunks.length});return;}
  if(req.method==="POST"&&req.url==="/search"){
    const body=await readBody(req);const matches=search(body.question||"",20);
    const answer=matches.map((r,i)=>"[F"+(i+1)+"] "+String(r.title||r.filename||"Documento")+"\n"+String(r.text||"")).join("\n\n");
    json(res,{ok:Boolean(matches.length),answer,text:answer,matches,provider:"desktop-node"});return;
  }
  if(req.method==="POST"&&req.url==="/direct"){
    const body=await readBody(req);const row=direct(body.question||"");
    json(res,row?{ok:true,...row,answer:row.text,provider:"desktop-node"}:{ok:false,code:"NOT_FOUND"},row?200:404);return;
  }
  json(res,{ok:false,code:"NOT_FOUND"},404);
}).listen(PORT,"127.0.0.1",()=>{
  console.log("FNS_DESKTOP_FALLBACK=http://127.0.0.1:"+PORT);
  console.log("FNS_DESKTOP_CHUNKS="+chunks.length);
});
