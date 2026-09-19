import { pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";
const MODEL = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
let extractor=null,loading=null;
const highQueue=[],normalQueue=[];
let pumping=false;
function status(stage,message,extra={}){self.postMessage({type:"status",stage,message,...extra});}
async function loadModel(preferWebGPU=false){
  if(extractor)return extractor;
  if(loading)return loading;
  loading=(async()=>{
    const progress_callback=p=>{const pct=Number(p?.progress||0);if(Number.isFinite(pct)&&pct>0)status("loading","Carregando modelo local de embeddings… "+Math.round(pct)+"%");};
    if(preferWebGPU && self.navigator?.gpu){
      try{
        status("loading","Inicializando embeddings locais com WebGPU…");
        extractor=await pipeline("feature-extraction",MODEL,{device:"webgpu",dtype:"fp16",progress_callback});
        status("ready","Motor local pronto (WebGPU).",{device:"webgpu",model:MODEL});return extractor;
      }catch{}
    }
    status("loading","Inicializando embeddings locais em WebAssembly q8…");
    extractor=await pipeline("feature-extraction",MODEL,{dtype:"q8",progress_callback});
    status("ready","Motor local pronto (WebAssembly q8).",{device:"wasm",model:MODEL});return extractor;
  })().catch(error=>{status("error","Falha ao carregar o modelo local: "+String(error?.message||error));loading=null;throw error;});
  return loading;
}
async function embedTexts(texts){const pipe=await loadModel(false);const output=await pipe(texts,{pooling:"mean",normalize:true});return output.tolist();}
async function runTask(task){
  if(task.type==="init"){await loadModel(Boolean(task.preferWebGPU));return {ok:true};}
  if(task.type==="embed-query"){const rows=await embedTexts([String(task.text||"")]);return {ok:true,vector:rows[0]||[]};}
  if(task.type==="embed-batch"){const texts=Array.isArray(task.texts)?task.texts.map(x=>String(x||"")):[];return {ok:true,vectors:await embedTexts(texts)};}
  throw new Error("Tarefa de embedding desconhecida.");
}
async function pump(){
  if(pumping)return;pumping=true;
  try{while(highQueue.length||normalQueue.length){const task=highQueue.shift()||normalQueue.shift();try{const result=await runTask(task);if(task.id)self.postMessage({id:task.id,...result});}catch(error){if(task.id)self.postMessage({id:task.id,ok:false,error:String(error?.message||error)});}await new Promise(resolve=>setTimeout(resolve,0));}}
  finally{pumping=false;}
}
self.onmessage=e=>{const task=e.data||{};(task.priority==="high"?highQueue:normalQueue).push(task);pump();};
