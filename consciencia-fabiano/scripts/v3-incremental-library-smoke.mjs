import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import {mkdtemp,mkdir,writeFile,readFile,rm} from "node:fs/promises";
import {createHash} from "node:crypto";
import {createIncrementalLibrary} from "./v3-incremental-library.mjs";
import {buildV3EvidenceIndex} from "./v3-evidence-core.mjs";
import {
  ensurePersistentV3,appendPersistentV3,persistentV3HasDocument,
  persistentV3Health,searchPersistentV3
} from "./v3-persistent-index.mjs";

const tmp=await mkdtemp(path.join(os.tmpdir(),"fns-inc-"));
try{
  const publicDir=path.join(tmp,"public");
  const backup=path.join(publicDir,"biblioteca_backup");
  await mkdir(backup,{recursive:true});
  await mkdir(path.join(tmp,"raw-vault","generated"),{recursive:true});

  const baseRows=[
    {id:"base-1",document_id:"base-doc",title:"Biblioteca Base",page:1,chunk_index:0,text:"Conteúdo antigo preservado no baú base.",language:"pt"}
  ];
  const baseFile=path.join(backup,"part-0000.json");
  await writeFile(baseFile,JSON.stringify({chunks:baseRows}),"utf8");
  const baseHashBefore=createHash("sha256").update(await readFile(baseFile)).digest("hex");

  const inc=await createIncrementalLibrary(tmp);
  const TOTAL=1005;
  for(let i=0;i<TOTAL;i++){
    const sha=i.toString(16).padStart(64,"0");
    const started=inc.start({
      filename:"Livro "+i+".pdf",title:"Livro Incremental "+i,
      content_sha256:sha,page_count:1,size_bytes:1000+i
    });
    assert.equal(started.duplicate,false);
    inc.append(started.job_id,[{page:1,text:"Documento incremental escala mil. Marcador único livro "+i+"."}]);
    const committed=inc.commit(started.job_id);
    assert.equal(committed.duplicate,false);
    assert.ok(committed.rows.length>=1);
  }

  const counts=inc.counts();
  assert.equal(counts.documents,TOTAL,"deve suportar catálogo acima de mil PDFs");
  assert.equal(counts.jobs,0,"jobs concluídos não podem ficar pendentes");
  assert.ok(counts.chunks>=TOTAL);

  const exact=inc.searchDictionary("escala mil",{aliases:{},page:1,pageSize:50});
  assert.equal(exact.total,TOTAL,"Dicionário incremental deve pesquisar todos os 1005 PDFs sem teto lógico");
  assert.equal(exact.matches.length,50);
  assert.equal(exact.pages,Math.ceil(TOTAL/50));

  const duplicate=inc.start({
    filename:"Cópia.pdf",title:"Cópia",
    content_sha256:(0).toString(16).padStart(64,"0"),page_count:1,size_bytes:999
  });
  assert.equal(duplicate.duplicate,true,"SHA-256 repetido deve ser deduplicado");

  let loadCalls=0;
  const state=await ensurePersistentV3({
    root:tmp,publicDir,
    buildIndex:buildV3EvidenceIndex,
    loadRows:async()=>{loadCalls++;return baseRows;}
  });
  assert.equal(loadCalls,1);
  const before=persistentV3Health(state);
  assert.equal(before.source_rows,1);

  const oneId=(1004).toString(16).padStart(64,"0");
  const newRows=inc.rowsForDocument(oneId);
  const appended=appendPersistentV3(state,newRows,buildV3EvidenceIndex);
  assert.ok(appended.added_units>=1);
  assert.equal(persistentV3HasDocument(state,oneId),true);

  const found=searchPersistentV3(state,"escala mil",{}, {limit:10,strict:false});
  assert.ok(found.results.some(x=>String(x.document_id)===oneId),"PDF novo deve entrar na V3 imediatamente");

  let forbiddenReloads=0;
  const reused=await ensurePersistentV3({
    root:tmp,publicDir,
    buildIndex:buildV3EvidenceIndex,
    loadRows:async()=>{forbiddenReloads++;throw new Error("não pode reconstruir a base após append incremental");}
  });
  assert.equal(forbiddenReloads,0,"append incremental não pode disparar reindexação da biblioteca-base");
  assert.equal(reused.reused,true);
  assert.equal(persistentV3HasDocument(reused,oneId),true);

  const baseHashAfter=createHash("sha256").update(await readFile(baseFile)).digest("hex");
  assert.equal(baseHashAfter,baseHashBefore,"baú base deve permanecer byte-for-byte intacto");

  console.log(JSON.stringify({
    ok:true,
    simulated_pdfs:TOTAL,
    incremental_documents:counts.documents,
    incremental_chunks:counts.chunks,
    dictionary_total:exact.total,
    duplicate_sha_blocked:true,
    v3_append_without_base_rebuild:true,
    base_vault_unchanged:true,
    persistent_after_restart:true
  },null,2));
}finally{
  await rm(tmp,{recursive:true,force:true});
}
