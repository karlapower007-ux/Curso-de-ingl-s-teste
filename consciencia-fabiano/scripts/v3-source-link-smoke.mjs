import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {mkdtemp,mkdir,writeFile,readFile,rm} from "node:fs/promises";
import {createIncrementalLibrary} from "./v3-incremental-library.mjs";

const root=await mkdtemp(path.join(os.tmpdir(),"fns-source-link-"));
try{
  const importDir=path.join(root,"ImportarPDFs");
  await mkdir(importDir,{recursive:true});
  const pdfBytes=Buffer.from("%PDF-1.4\n% Fonte Viva QA\n1 0 obj\n<<>>\nendobj\n%%EOF\n","utf8");
  const sha=createHash("sha256").update(pdfBytes).digest("hex");
  const firstPath=path.join(importDir,"fonte-viva.pdf");
  await writeFile(firstPath,pdfBytes);

  const lib=await createIncrementalLibrary(root);
  const started=lib.start({
    content_sha256:sha,filename:"Fonte Viva.pdf",title:"Fonte Viva",
    page_count:1,size_bytes:pdfBytes.length,source_path:firstPath
  });
  assert.equal(started.duplicate,false);
  lib.append(started.job_id,[{page:1,text:"O mundo espiritual é uma fonte documental verificável para este teste."}]);
  const committed=lib.commit(started.job_id);
  assert.equal(committed.document.source_path,firstPath);
  assert.equal(lib.getDocument(sha).source_path,firstPath);

  const search=lib.searchDictionary("mundo espiritual",{aliases:{},page:1,pageSize:10});
  assert.ok(search.matches.length>=1);
  assert.equal(search.matches[0].document_id,sha);
  assert.equal(search.matches[0].page,1);
  assert.equal(search.matches[0].source,"incremental-local");
  assert.equal(search.matches[0].pdf_page_verified,true);

  const vaultDir=path.join(root,".fns-local","pdf-vault");
  await mkdir(vaultDir,{recursive:true});
  const vaultPath=path.join(vaultDir,sha+".pdf");
  await writeFile(vaultPath,pdfBytes);
  const duplicate=lib.start({
    content_sha256:sha,filename:"Fonte Viva.pdf",title:"Fonte Viva",
    page_count:1,size_bytes:pdfBytes.length,source_path:vaultPath
  });
  assert.equal(duplicate.duplicate,true);
  assert.equal(lib.getDocument(sha).source_path,vaultPath);

  const server=await readFile(new URL("./v2-local-server.mjs",import.meta.url),"utf8");
  const ui=await readFile(new URL("../public/v2-local-ui.js",import.meta.url),"utf8");
  const app=await readFile(new URL("../public/app.js",import.meta.url),"utf8");
  const lesson=await readFile(new URL("./v4-lesson-core.mjs",import.meta.url),"utf8");
  assert.ok(server.includes("/api/v3/source/original"));
  assert.ok(server.includes("/api/v3/source/pdf"));
  assert.ok(server.includes('res.setHeader("Accept-Ranges","bytes")'));
  assert.ok(server.includes("decorateSourceLinkRows"));
  assert.ok(ui.includes("sourcePdfHref"));
  assert.ok(ui.includes("Abrir PDF"));
  assert.ok(app.includes("storeOriginalPdfForSourceLink"));
  assert.ok(app.includes("source_token"));
  assert.ok(lesson.includes("document_id:String(row?.document_id||\"\")"));

  console.log("V3_SOURCE_LINK_SMOKE=pass");
}finally{
  await rm(root,{recursive:true,force:true}).catch(()=>{});
}
