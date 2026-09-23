import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import {mkdtemp,mkdir,writeFile,readFile,rm} from "node:fs/promises";
import {createHash} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import {createIncrementalLibrary} from "./v3-incremental-library.mjs";
import {buildV3EvidenceIndex} from "./v3-evidence-core.mjs";
import {ensurePersistentV3,persistentV3Health,searchPersistentV3} from "./v3-persistent-index.mjs";
import {mergeFederatedSearch} from "./v3-federated-core.mjs";

const tmp=await mkdtemp(path.join(os.tmpdir(),"fns-50k-"));
try{
  const publicDir=path.join(tmp,"public");
  const backup=path.join(publicDir,"biblioteca_backup");
  await mkdir(backup,{recursive:true});
  await mkdir(path.join(tmp,"raw-vault","generated"),{recursive:true});

  const baseRows=[
    {id:"base-1",document_id:"base-doc",title:"Biblioteca Base",page:1,chunk_index:0,text:"Conteúdo antigo preservado no baú base. Integração federada comum entre acervo antigo e novo.",language:"pt"}
  ];
  const baseFile=path.join(backup,"part-0000.json");
  await writeFile(baseFile,JSON.stringify({chunks:baseRows}),"utf8");
  const baseHashBefore=createHash("sha256").update(await readFile(baseFile)).digest("hex");

  const baseState=await ensurePersistentV3({
    root:tmp,publicDir,buildIndex:buildV3EvidenceIndex,loadRows:async()=>baseRows
  });
  const baseBefore=persistentV3Health(baseState);
  assert.equal(baseBefore.source_rows,1);
  assert.equal(searchPersistentV3(baseState,"cinquenta mil",{}, {limit:10}).results.length,0);

  const inc=await createIncrementalLibrary(tmp);

  // Exercita o pipeline público completo e deduplicação.
  const shaReal="a".repeat(64);
  const started=inc.start({
    filename:"Real.pdf",title:"Livro Real",content_sha256:shaReal,page_count:2,size_bytes:2048,source_path:"C:\\ImportarPDFs\\Real.pdf"
  });
  inc.append(started.job_id,[
    {page:1,text:"Este livro real confirma a integração incremental permanente. Integração federada comum entre acervo antigo e novo."},
    {page:2,text:"O Dicionário, o Livro V3 e a Aula V4 compartilham este acervo novo."}
  ]);
  const committed=inc.commit(started.job_id);
  assert.equal(committed.duplicate,false);
  assert.ok(Number(committed.document.chunk_count)>=2);
  assert.ok(Number(committed.document.block_count)>=2);
  const duplicate=inc.start({
    filename:"Copia.pdf",title:"Cópia",content_sha256:shaReal,page_count:2,size_bytes:2048
  });
  assert.equal(duplicate.duplicate,true,"SHA-256 repetido deve ser deduplicado");

  // Prova executável da federação usada pelo servidor: mesma consulta, duas camadas.
  const federationQuery="integração federada comum";
  const oldHit=searchPersistentV3(baseState,federationQuery,{}, {limit:10,strict:false});
  const newHit=inc.searchV3(federationQuery,{}, {limit:10,candidate_limit:100});
  const federated=mergeFederatedSearch(oldHit,newHit,20);
  assert.ok(federated.results.some(x=>String(x.document_id)==="base-doc"),"busca federada deve manter resultado do acervo antigo");
  assert.ok(federated.results.some(x=>String(x.document_id)===shaReal),"busca federada deve incluir PDF novo");
  assert.ok(Number(federated.sources.base_frozen||0)>0);
  assert.ok(Number(federated.sources.incremental_50k||0)>0);

  // Carga sintética 50K em uma única transação: testa o formato físico e o FTS real.
  const db=new DatabaseSync(inc.db_path);
  db.exec("BEGIN IMMEDIATE;");
  try{
    const insDoc=db.prepare("INSERT INTO documents(document_id,content_sha256,filename,title,author,language,page_count,chunk_count,block_count,size_bytes,status,source_path,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,'ready','',?,?)");
    const insChunk=db.prepare("INSERT INTO chunks(id,document_id,page,chunk_index,title,author,language,text,folded_text) VALUES(?,?,?,?,?,'','pt',?,?)");
    const ftsChunk=db.prepare("INSERT INTO chunks_fts(id,document_id,text,title) VALUES(?,?,?,?)");
    const insBlock=db.prepare("INSERT INTO blocks(id,document_id,chunk_id,page,block_index,title,author,language,text) VALUES(?,?,?,?,?,?,'','pt',?)");
    const ftsBlock=db.prepare("INSERT INTO blocks_fts(id,document_id,text,title) VALUES(?,?,?,?)");
    const insQueue=db.prepare("INSERT INTO folder_queue(source_path,size_bytes,mtime_ms,status,attempts,last_error,discovered_at,updated_at) VALUES(?,?,?,'done',1,'',?,?)");
    const now=new Date().toISOString();
    const SCALE=50050;
    for(let i=0;i<SCALE;i++){
      const sha=(100000+i).toString(16).padStart(64,"0");
      const title="Livro Escala "+String(i).padStart(5,"0");
      const text="escala cinquenta mil documento "+i+" conteúdo pesquisável integrado";
      const chunkId=sha+":0",blockId=sha+":b:0";
      insDoc.run(sha,sha,title+".pdf",title,"","pt",1,1,1,1024,now,now);
      insChunk.run(chunkId,sha,1,0,title,text,text);
      ftsChunk.run(chunkId,sha,text,title);
      insBlock.run(blockId,sha,chunkId,1,0,title,text);
      ftsBlock.run(blockId,sha,text,title);
      insQueue.run("C:\\ConscienciaFabiano\\ImportarPDFs\\"+title+".pdf",1024,i,now,now);
    }
    db.exec("COMMIT;");
  }catch(error){
    try{db.exec("ROLLBACK;");}catch{}
    throw error;
  }
  db.close();

  const counts=inc.counts();
  assert.equal(counts.documents,50051,"50.050 sintéticos + 1 real devem coexistir");
  assert.ok(counts.blocks>=50052);
  assert.equal(Number(counts.folder_queue.done||0),50050,"fila persistente deve suportar mais de 50 mil entradas");

  const exact=inc.searchDictionary("escala cinquenta mil",{aliases:{},page:1002,pageSize:50});
  assert.equal(exact.total,50050,"Dicionário incremental deve contar todo o corpus 50K sem teto lógico");
  assert.equal(exact.pages,1001);
  // Página além do fim deve ser vazia, não explodir memória.
  assert.equal(exact.matches.length,0);
  const exactLast=inc.searchDictionary("escala cinquenta mil",{aliases:{},page:1001,pageSize:50});
  assert.equal(exactLast.matches.length,50);

  const v3=inc.searchV3("escala cinquenta mil",{}, {limit:16,candidate_limit:700});
  assert.ok(v3.results.length>0,"Livro/Aula devem encontrar evidência no índice 50K");
  assert.ok(v3.results.every(x=>String(x.document_id)!=="base-doc"));

  const listed=inc.listDocuments({limit:200,offset:0});
  assert.equal(listed.length,200,"catálogo não deve carregar 50 mil documentos na RAM/tela");

  const baseAfter=persistentV3Health(baseState);
  assert.equal(baseAfter.source_rows,baseBefore.source_rows,"índice-base não pode crescer ao adicionar PDFs novos");
  assert.equal(baseAfter.evidence_units,baseBefore.evidence_units,"unidades do índice-base devem permanecer congeladas");
  const baseHashAfter=createHash("sha256").update(await readFile(baseFile)).digest("hex");
  assert.equal(baseHashAfter,baseHashBefore,"baú antigo deve permanecer byte-for-byte intacto");

  console.log(JSON.stringify({
    ok:true,
    scale_documents:50050,
    total_incremental_documents:counts.documents,
    folder_queue_done:counts.folder_queue.done,
    dictionary_total:exact.total,
    dictionary_pages:exact.pages,
    v3_results:v3.results.length,
    catalog_page_size:listed.length,
    sha256_dedup:true,
    base_index_unchanged:true,
    base_vault_unchanged:true,
    federation_old_and_new_same_query:true,
    federation_sources:federated.sources,
    architecture:"base-frozen + incremental-50k federated"
  },null,2));
}finally{
  await rm(tmp,{recursive:true,force:true});
}
