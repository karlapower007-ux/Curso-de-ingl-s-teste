import http from "node:http";

const HOST="127.0.0.1";
const PORT=Math.max(1,Number(process.env.FNS_MOBILE_PORT||8790));
const TARGET="http://127.0.0.1:8788";
const TOKEN=String(process.env.FNS_MOBILE_TOKEN||"").trim();
const MAX_BODY=12*1024*1024;

function cookies(raw=""){
  const out={};
  for(const part of String(raw).split(";")){
    const at=part.indexOf("=");
    if(at<0)continue;
    out[part.slice(0,at).trim()]=decodeURIComponent(part.slice(at+1).trim());
  }
  return out;
}
function cleanRedirect(url){
  const copy=new URL(url.toString());
  copy.searchParams.delete("token");
  return copy.pathname+(copy.search||"");
}
async function bodyBuffer(req){
  if(req.method==="GET"||req.method==="HEAD")return undefined;
  const parts=[];let size=0;
  for await(const part of req){
    size+=part.length;
    if(size>MAX_BODY)throw Object.assign(new Error("Payload excede o limite móvel."),{status:413});
    parts.push(part);
  }
  return Buffer.concat(parts);
}
function unauthorized(res){
  res.statusCode=401;
  res.setHeader("Content-Type","text/html; charset=utf-8");
  res.setHeader("Cache-Control","no-store");
  res.end("<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>Consciência Fabiano</title><body style='font:16px system-ui;background:#0b1220;color:#eef;padding:28px'><h1>Acesso móvel protegido</h1><p>Abra o link completo fornecido pelo PC para autorizar este celular.</p></body>");
}
if(!TOKEN){
  console.error("FNS_MOBILE_TOKEN ausente.");
  process.exit(2);
}

http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,"http://mobile.local");
    const queryToken=String(url.searchParams.get("token")||"");
    const headerToken=String(req.headers["x-fns-token"]||"");
    const cookieToken=String(cookies(req.headers.cookie).fns_mobile||"");
    const supplied=queryToken||headerToken||cookieToken;

    if(supplied!==TOKEN){unauthorized(res);return;}

    if(queryToken===TOKEN){
      res.statusCode=302;
      res.setHeader("Set-Cookie","fns_mobile="+encodeURIComponent(TOKEN)+"; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000");
      res.setHeader("Location",cleanRedirect(url));
      res.setHeader("Cache-Control","no-store");
      res.end();
      return;
    }

    const body=await bodyBuffer(req);
    const headers={...req.headers};
    delete headers.host;
    delete headers.cookie;
    delete headers["x-fns-token"];
    delete headers["content-length"];

    const upstream=await fetch(TARGET+url.pathname+url.search,{
      method:req.method,
      headers,
      body,
      redirect:"manual"
    });
    res.statusCode=upstream.status;
    for(const [key,value] of upstream.headers){
      if(["connection","transfer-encoding","content-encoding"].includes(key.toLowerCase()))continue;
      res.setHeader(key,value);
    }
    res.setHeader("Cache-Control",upstream.headers.get("cache-control")||"no-store");
    if(req.method==="HEAD"){res.end();return;}
    const payload=Buffer.from(await upstream.arrayBuffer());
    res.end(payload);
  }catch(error){
    res.statusCode=Number(error?.status||502);
    res.setHeader("Content-Type","application/json; charset=utf-8");
    res.end(JSON.stringify({ok:false,error:String(error?.message||error)}));
  }
}).listen(PORT,HOST,()=>{
  console.log("FNS_MOBILE_GATEWAY=http://127.0.0.1:"+PORT);
  console.log("TARGET_LOCAL_ONLY="+TARGET);
});
