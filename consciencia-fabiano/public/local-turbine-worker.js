import {strictParagraphMatch,paragraphBlocks,deriveStrictPhrase,extractSemanticReference} from "/strict-match-core.js?v=4.0.0";

// V4.0 OMNI-LIBRARY SYMMETRY — somente frase exata no mesmo parágrafo.
const CONTEXT_BEFORE=2;
const CONTEXT_AFTER=4;

function sourceLabel(source){
  return String(source?.title||source?.filename||"Documento").replace(/\.pdf$/i,"").trim()||"Documento";
}
function contextWindow(raw,targetIndex){
  const blocks=paragraphBlocks(raw);
  if(!blocks.length)return {text:"",start:0,end:0,full_chunk:true};
  if(blocks.length===1)return {text:String(raw||"").trim(),start:0,end:0,full_chunk:true};
  const start=Math.max(0,targetIndex-CONTEXT_BEFORE);
  const end=Math.min(blocks.length-1,targetIndex+CONTEXT_AFTER);
  return {text:blocks.slice(start,end+1).join("\n\n"),start,end,full_chunk:false};
}
function extract(task){
  const raw=String(task?.text||"");
  const match=strictParagraphMatch(raw,task?.question||"");
  if(!match.matched){
    return {
      id:task?.id,ok:false,score:0,coverage:0,
      reject_reason:"STRICT_PHRASE_MISS",
      strict_mode:"same-paragraph-phrase",
      strict_phrase:deriveStrictPhrase(task?.question||"")
    };
  }
  const window=contextWindow(raw,match.paragraph_index);
  const reference=extractSemanticReference(window.text);
  const source=task?.source||{};
  const sourceName=sourceLabel(source);
  return {
    id:task?.id,ok:true,score:100,coverage:1,exact_match:true,
    strict_mode:"same-paragraph-phrase",
    strict_phrase:match.target,
    text:window.text,
    target_paragraph_index:match.paragraph_index,
    context_window_start:window.start,
    context_window_end:window.end,
    context_before:CONTEXT_BEFORE,
    context_after:CONTEXT_AFTER,
    full_chunk_fallback:window.full_chunk,
    paragraph_count:Math.max(1,window.end-window.start+1),
    canonical_reference:reference,
    semantic_title:reference||sourceName,
    source,
    logical_node:task?.logical_node
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
