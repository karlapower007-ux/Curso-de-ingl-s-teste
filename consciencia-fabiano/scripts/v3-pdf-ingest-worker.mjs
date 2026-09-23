import path from "node:path";
import {fileURLToPath} from "node:url";
import {readFile,stat} from "node:fs/promises";
import {createHash} from "node:crypto";
import {createIncrementalLibrary} from "./v3-incremental-library.mjs";

const sourcePath=path.resolve(String(process.argv[2]||""));
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const maxMb=Math.max(16,Number(process.env.FNS_MAX_PDF_MB||512));

function emit(data){process.stdout.write(JSON.stringify(data)+"\n");}
function cleanPageText(items){
  let out="";
  for(const item of items||[]){
    const value=String(item?.str||"");
    if(!value)continue;
    out+=value;
    out+=item?.hasEOL?"\n":" ";
  }
  return out.replace(/[ \t]+\n/g,"\n").replace(/[ \t]{2,}/g," ").replace(/\n{3,}/g,"\n\n").trim();
}
async function main(){
  if(!sourcePath||!/\.pdf$/i.test(sourcePath))throw Object.assign(new Error("Caminho de PDF inválido."),{code:"INVALID_PDF"});
  const info=await stat(sourcePath);
  if(!info.isFile())throw Object.assign(new Error("PDF não encontrado."),{code:"NOT_FILE"});
  if(info.size>maxMb*1024*1024)throw Object.assign(new Error("PDF acima do limite seguro de "+maxMb+" MB para este PC."),{code:"PDF_TOO_LARGE"});

  const bytes=await readFile(sourcePath);
  const sha=createHash("sha256").update(bytes).digest("hex");
  const pdfjs=await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf=await pdfjs.getDocument({
    data:new Uint8Array(bytes),isEvalSupported:false,useWorkerFetch:false,disableFontFace:true
  }).promise;

  let title=path.basename(sourcePath).replace(/\.pdf$/i,""),author="";
  try{
    const metadata=await pdf.getMetadata();
    title=String(metadata?.info?.Title||title).trim()||title;
    author=String(metadata?.info?.Author||"").trim();
  }catch{}

  const inc=await createIncrementalLibrary(root);
  const started=inc.start({
    filename:path.basename(sourcePath),title,author,language:"",
    content_sha256:sha,page_count:pdf.numPages,size_bytes:info.size,source_path:sourcePath
  });
  if(started.duplicate){
    await pdf.destroy();
    emit({ok:true,duplicate:true,sha256:sha,document:started.document});
    return;
  }

  let batch=[],batchChars=0,totalChars=0,pagesWithText=0;
  const flush=()=>{
    if(!batch.length)return;
    inc.append(started.job_id,batch);
    batch=[];batchChars=0;
  };

  for(let pageNumber=1;pageNumber<=pdf.numPages;pageNumber++){
    const page=await pdf.getPage(pageNumber);
    const content=await page.getTextContent({normalizeWhitespace:true});
    const text=cleanPageText(content.items);
    page.cleanup();
    if(text){
      batch.push({page:pageNumber,text});
      batchChars+=text.length;totalChars+=text.length;pagesWithText++;
    }
    if(batch.length>=12||batchChars>=220000)flush();
  }
  flush();
  await pdf.destroy();

  if(!pagesWithText||totalChars<20){
    throw Object.assign(new Error("PDF sem texto selecionável; requer OCR antes de entrar na busca."),{code:"NEEDS_OCR"});
  }
  const committed=inc.commit(started.job_id);
  inc.checkpoint();
  emit({
    ok:true,duplicate:Boolean(committed.duplicate),sha256:sha,
    pages:pdf.numPages,pages_with_text:pagesWithText,total_chars:totalChars,
    document:committed.document
  });
}
main().catch(error=>{
  emit({ok:false,code:String(error?.code||"INGEST_ERROR"),error:String(error?.message||error)});
  process.exitCode=1;
});
