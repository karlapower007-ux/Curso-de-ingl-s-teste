import path from "node:path";
import {access,mkdir,readFile,rm} from "node:fs/promises";
import {spawn} from "node:child_process";
import {randomUUID} from "node:crypto";

async function exists(file){
  try{await access(file);return true;}catch{return false;}
}

async function resolvePiper(root){
  const binCandidates=[
    process.env.FNS_PIPER_BIN,
    path.join(root,"tools","piper","piper.exe"),
    path.join(root,"tools","piper","piper")
  ].filter(Boolean);
  const modelCandidates=[
    process.env.FNS_PIPER_MODEL,
    path.join(root,"tools","piper","pt_BR-faber-medium.onnx"),
    path.join(root,"tools","piper","pt_BR-edresson-low.onnx"),
    path.join(root,"tools","piper","pt_BR.onnx")
  ].filter(Boolean);

  let bin="",model="";
  for(const p of binCandidates){if(await exists(p)){bin=p;break;}}
  for(const p of modelCandidates){if(await exists(p)){model=p;break;}}
  return {bin,model,ready:Boolean(bin&&model)};
}

export async function piperStatus(root){
  const r=await resolvePiper(root);
  return {
    ready:r.ready,
    engine:"piper-local",
    language:"pt-BR",
    binary:r.ready?path.basename(r.bin):null,
    model:r.ready?path.basename(r.model):null
  };
}

export async function synthesizePiper(root,text){
  const clean=String(text||"").replace(/\s+/g," ").trim().slice(0,1800);
  if(!clean)throw Object.assign(new Error("Texto vazio para TTS."),{status:400});
  const r=await resolvePiper(root);
  if(!r.ready)throw Object.assign(new Error("Piper pt-BR não está instalado localmente."),{status:503,code:"PIPER_NOT_READY"});

  const dir=path.join(root,".fns-local","tts");
  await mkdir(dir,{recursive:true});
  const out=path.join(dir,"v4-"+randomUUID()+".wav");

  await new Promise((resolve,reject)=>{
    const child=spawn(r.bin,["--model",r.model,"--output_file",out],{
      windowsHide:true,stdio:["pipe","ignore","pipe"]
    });
    let err="";
    child.stderr.on("data",d=>{err+=String(d||"").slice(0,3000);});
    child.on("error",reject);
    child.on("close",code=>code===0?resolve():reject(new Error(err||("Piper saiu com código "+code))));
    child.stdin.end(clean+"\n");
  });

  try{return await readFile(out);}
  finally{await rm(out,{force:true}).catch(()=>{});}
}
