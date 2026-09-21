#!/usr/bin/env python3
import hashlib
import json
import os
import sqlite3
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

BASE=os.environ.get("FNS_BASE","https://consciencia-fabiano.focoeepoder2.workers.dev").rstrip("/")
AUTOMATION_SECRET=os.environ["AUTOMATION_SECRET"]
SECONDARY_URL=os.environ.get("FNS_SECONDARY_URL","https://bfctgmtidroczuwzhqkg.supabase.co/functions/v1/fns-resilience-secondary")
OWNER_TOKEN=os.environ["FNS_OWNER_TOKEN"]
EXPECTED_BASELINE=int(os.environ.get("FNS_EXPECTED_BASELINE","25199"))
PROTECTED_FLOOR=int(os.environ.get("FNS_PROTECTED_FLOOR","14666"))
REPORT_PATH=Path(os.environ.get("FNS_RECOVERY_REPORT",".ci-results/v80-library-recovery.json"))
DB_PATH=Path(os.environ.get("FNS_RECOVERY_DB","/tmp/v80-library-recovery.sqlite"))
APPLY=os.environ.get("FNS_RECOVERY_APPLY","true").lower() in ("1","true","yes")
HTTP_RETRIES=max(1,int(os.environ.get("FNS_HTTP_RETRIES","4")))

REPORT={
  "ok":False,
  "apply":APPLY,
  "policy":"baseline-plus-current-only-by-filename-page-text-sha256",
  "destructive":False,
  "reindex":False,
  "started_at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),
  "stages":[]
}

def save_report():
    REPORT_PATH.parent.mkdir(parents=True,exist_ok=True)
    REPORT["updated_at"]=time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime())
    REPORT_PATH.write_text(json.dumps(REPORT,ensure_ascii=False,indent=2),encoding="utf-8")

def log(stage,**data):
    event={"stage":stage,**data}
    REPORT["stages"].append(event)
    print("RECOVERY_"+stage.upper()+"="+json.dumps(data,ensure_ascii=False,separators=(",",":")))
    save_report()

def request_json(method,url,headers=None,payload=None,timeout=45,retries=HTTP_RETRIES,accepted=(200,)):
    headers=dict(headers or {})
    body=None
    if payload is not None:
        body=json.dumps(payload,ensure_ascii=False,separators=(",",":")).encode("utf-8")
        headers.setdefault("Content-Type","application/json")
    last=None
    for attempt in range(retries):
        req=urllib.request.Request(url,data=body,headers=headers,method=method)
        try:
            with urllib.request.urlopen(req,timeout=timeout) as res:
                raw=res.read()
                status=res.status
            if status not in accepted:
                raise RuntimeError(f"HTTP {status} for {url}")
            return status,json.loads(raw.decode("utf-8") or "{}")
        except urllib.error.HTTPError as exc:
            raw=exc.read().decode("utf-8","replace")
            last=RuntimeError(f"HTTP {exc.code} for {url}: {raw[:500]}")
            if exc.code not in (429,500,502,503,504) or attempt+1>=retries:
                raise last
        except Exception as exc:
            last=exc
            if attempt+1>=retries:
                raise
        time.sleep(min(8,2**attempt))
    raise last or RuntimeError("request failed")

HTTP_USER_AGENT="curl/8.5.0"

def admin_headers():
    return {
        "X-FNS-Automation":AUTOMATION_SECRET,
        "Accept":"application/json",
        "User-Agent":HTTP_USER_AGENT
    }

def owner_headers():
    return {
        "X-FNS-Owner-Token":OWNER_TOKEN,
        "Accept":"application/json",
        "User-Agent":HTTP_USER_AGENT
    }

def secondary(action,payload):
    url=SECONDARY_URL+"?action="+urllib.parse.quote(action)
    return request_json("POST",url,owner_headers(),payload,timeout=60)[1]

def admin_get(path):
    return request_json("GET",BASE+path,admin_headers(),None,timeout=60)[1]

def admin_post(path,payload):
    return request_json("POST",BASE+path,admin_headers(),payload,timeout=90)[1]

def text_sha(text):
    return hashlib.sha256(str(text or "").encode("utf-8")).hexdigest()

def filename_norm(value):
    return unicodedata.normalize("NFC",str(value or "")).strip().casefold()

def row_fingerprint(row):
    return hashlib.sha256((
      filename_norm(row.get("filename") or row.get("title"))+"\n"+
      str(int(row.get("page") or 0))+"\n"+
      text_sha(row.get("text") or "")
    ).encode("utf-8")).hexdigest()

def vector_present(row):
    raw=row.get("embedding",row.get("vector"))
    if isinstance(raw,list):
        return len(raw)>=64
    if isinstance(raw,str):
        s=raw.strip()
        return s.startswith("[") and s.endswith("]") and s.count(",")>=63
    return False

def normalized_upload_row(row):
    out=dict(row)
    meta=out.get("metadata") if isinstance(out.get("metadata"),dict) else {}
    if not out.get("original_r2_key") and meta.get("original_r2_key"):
        out["original_r2_key"]=meta.get("original_r2_key")
    if not out.get("embedding_model") and meta.get("embedding_model"):
        out["embedding_model"]=meta.get("embedding_model")
    if vector_present(out) and not out.get("embedding_dimensions"):
        out["embedding_dimensions"]=384
    return out

if DB_PATH.exists():
    DB_PATH.unlink()
conn=sqlite3.connect(DB_PATH)
conn.execute("pragma journal_mode=WAL")
conn.execute("pragma synchronous=NORMAL")
schema="""
create table baseline(
  seq integer primary key autoincrement,
  id text not null, document_id text not null, filename text not null,
  filename_norm text not null, page integer not null, chunk_index integer not null,
  fingerprint text not null, has_vector integer not null, raw_json text not null
);
create table current_rows(
  seq integer primary key autoincrement,
  id text not null, document_id text not null, filename text not null,
  filename_norm text not null, page integer not null, chunk_index integer not null,
  fingerprint text not null, has_vector integer not null, raw_json text not null
);
"""
conn.executescript(schema)

promoted_generation=""

try:
    manifest=secondary("manifest",{})
    baseline_generation=str(manifest.get("generation") or "")
    baseline_signature=str(manifest.get("source_signature") or "")
    baseline_total=int(manifest.get("total_chunks") or 0)
    baseline_vectors=int(manifest.get("vector_count") or 0)
    if baseline_total!=EXPECTED_BASELINE or baseline_vectors!=EXPECTED_BASELINE:
        raise RuntimeError(f"baseline manifest not complete: {baseline_total}/{baseline_vectors}")
    if not baseline_generation or len(baseline_signature)!=64:
        raise RuntimeError("baseline manifest generation/signature invalid")
    log("baseline_manifest",generation=baseline_generation,total=baseline_total,vectors=baseline_vectors,
        books=int(manifest.get("total_books") or 0),signature=baseline_signature)

    r2=admin_get("/api/admin/omni-sync-state")
    current_generation=str(r2.get("generation") or "")
    current_total=int(r2.get("total") or 0)
    current_documents=int(r2.get("documents") or 0)
    current_shards=int(r2.get("shards") or 0)
    current_vectors=int(r2.get("vectors") or 0)
    current_signature=str(r2.get("signature") or "")
    if not current_generation or current_total<PROTECTED_FLOOR:
        raise RuntimeError(f"protected R2 snapshot below floor: {current_total} < {PROTECTED_FLOOR}")
    log("protected_snapshot",generation=current_generation,total=current_total,documents=current_documents,
        shards=current_shards,vectors=current_vectors,signature=current_signature,source=str(r2.get("source") or ""))

    after=""
    baseline_seen=0
    baseline_vector_seen=0
    while baseline_seen<baseline_total:
        page=secondary("export_generation",{
          "generation":baseline_generation,"after_id":after,"limit":100
        })
        if str(page.get("generation") or "")!=baseline_generation:
            raise RuntimeError("baseline generation changed during export")
        records=page.get("records") if isinstance(page.get("records"),list) else []
        if not records and not page.get("done"):
            raise RuntimeError("baseline export stopped without done")
        for row in records:
            text=str(row.get("text") or "")
            doc=str(row.get("document_id") or "")
            rid=str(row.get("id") or "")
            if not text or not doc or not rid:
                raise RuntimeError("invalid baseline row")
            hv=1 if vector_present(row) else 0
            baseline_vector_seen+=hv
            conn.execute(
              "insert into baseline(id,document_id,filename,filename_norm,page,chunk_index,fingerprint,has_vector,raw_json) values(?,?,?,?,?,?,?,?,?)",
              (rid,doc,str(row.get("filename") or row.get("title") or "Documento"),
               filename_norm(row.get("filename") or row.get("title")),
               int(row.get("page") or 0),int(row.get("chunk_index") or 0),row_fingerprint(row),hv,
               json.dumps(row,ensure_ascii=False,separators=(",",":")))
            )
        conn.commit()
        baseline_seen+=len(records)
        next_id=str(page.get("next_id") or "")
        if records and (not next_id or next_id==after):
            raise RuntimeError("baseline cursor did not advance")
        after=next_id
        if page.get("done") is True:
            break
        if baseline_seen%2000<100:
            log("baseline_export_progress",rows=baseline_seen,total=baseline_total)

    base_stats=conn.execute("select count(*),count(distinct id),sum(has_vector) from baseline").fetchone()
    if tuple(base_stats)!=(EXPECTED_BASELINE,EXPECTED_BASELINE,EXPECTED_BASELINE):
        raise RuntimeError(f"baseline audit failed: {base_stats}")
    conn.execute("create index baseline_fp_idx on baseline(filename_norm,page,fingerprint)")
    conn.execute("create index baseline_id_idx on baseline(id)")
    conn.commit()
    log("baseline_audit",rows=base_stats[0],unique_ids=base_stats[1],vectors=base_stats[2])

    offset=0
    while offset<current_total:
        page=admin_get(f"/api/admin/omni-sync-page?offset={offset}&limit=200")
        if str(page.get("generation") or "")!=current_generation or int(page.get("total") or 0)!=current_total:
            raise RuntimeError("R2 protected snapshot changed during export")
        rows=page.get("rows") if isinstance(page.get("rows"),list) else []
        for row in rows:
            text=str(row.get("text") or "")
            doc=str(row.get("document_id") or "")
            rid=str(row.get("id") or "")
            if not text or not doc or not rid:
                raise RuntimeError("invalid current R2 row")
            conn.execute(
              "insert into current_rows(id,document_id,filename,filename_norm,page,chunk_index,fingerprint,has_vector,raw_json) values(?,?,?,?,?,?,?,?,?)",
              (rid,doc,str(row.get("filename") or row.get("title") or "Documento"),
               filename_norm(row.get("filename") or row.get("title")),
               int(row.get("page") or 0),int(row.get("chunk_index") or 0),row_fingerprint(row),
               1 if vector_present(row) else 0,json.dumps(row,ensure_ascii=False,separators=(",",":")))
            )
        conn.commit()
        next_offset=int(page.get("next_offset") or (offset+len(rows)))
        if next_offset<=offset and offset<current_total:
            raise RuntimeError("R2 protected cursor did not advance")
        offset=next_offset
        if offset%2000<200 or offset>=current_total:
            log("protected_export_progress",rows=min(offset,current_total),total=current_total)
        if page.get("done") is True:
            break

    cur_stats=conn.execute("select count(*),count(distinct id),sum(has_vector) from current_rows").fetchone()
    if int(cur_stats[0])!=current_total or int(cur_stats[1])!=current_total:
        raise RuntimeError(f"protected R2 audit failed: {cur_stats} expected {current_total}")
    conn.execute("create index current_fp_idx on current_rows(filename_norm,page,fingerprint)")
    conn.execute("create index current_id_idx on current_rows(id)")
    conn.commit()

    overlap=int(conn.execute("""
      select count(*) from current_rows c where exists(
        select 1 from baseline b
        where b.filename_norm=c.filename_norm and b.page=c.page and b.fingerprint=c.fingerprint
      )
    """).fetchone()[0])
    current_only=current_total-overlap

    conn.executescript("""
      create table candidate as
        select seq as source_seq,'baseline' as origin,id,document_id,filename,filename_norm,page,chunk_index,fingerprint,has_vector,raw_json
        from baseline;
      insert into candidate
        select c.seq,'current',c.id,c.document_id,c.filename,c.filename_norm,c.page,c.chunk_index,c.fingerprint,c.has_vector,c.raw_json
        from current_rows c
        where not exists(
          select 1 from baseline b
          where b.filename_norm=c.filename_norm and b.page=c.page and b.fingerprint=c.fingerprint
        );
      create index candidate_doc_idx on candidate(document_id,page,chunk_index,id);
      create index candidate_id_idx on candidate(id);
    """)
    conn.commit()

    candidate_total=int(conn.execute("select count(*) from candidate").fetchone()[0])
    candidate_vectors=int(conn.execute("select coalesce(sum(has_vector),0) from candidate").fetchone()[0])
    candidate_documents=int(conn.execute("select count(distinct document_id) from candidate").fetchone()[0])
    id_conflicts=conn.execute("select id,count(*) n from candidate group by id having n>1 limit 25").fetchall()
    if id_conflicts:
        REPORT["id_conflicts"]=id_conflicts
        raise RuntimeError("candidate has conflicting duplicate IDs")
    if candidate_total!=EXPECTED_BASELINE+current_only or candidate_total<EXPECTED_BASELINE or candidate_total<current_total:
        raise RuntimeError("candidate count invariant failed")

    docs=[]
    for row in conn.execute("""
      select document_id,min(filename),count(*),sum(has_vector),min(page),max(page)
      from candidate group by document_id order by min(filename),document_id
    """):
        docs.append({
          "document_id":row[0],"filename":row[1],"chunks":int(row[2]),
          "vectors":int(row[3] or 0),"min_page":int(row[4] or 0),"max_page":int(row[5] or 0)
        })

    sig=hashlib.sha256()
    for row in conn.execute("""
      select id,document_id,filename_norm,page,chunk_index,fingerprint
      from candidate order by filename_norm,page,chunk_index,id,origin,source_seq
    """):
        sig.update(("\t".join(map(str,row))+"\n").encode("utf-8"))
    candidate_signature=sig.hexdigest()
    candidate_generation="v80-recovery-"+hashlib.sha256(
      (baseline_signature+"|"+current_generation+"|"+current_signature+"|"+candidate_signature).encode("utf-8")
    ).hexdigest()[:20]

    REPORT["audit"]={
      "baseline":{"generation":baseline_generation,"chunks":baseline_total,"vectors":baseline_vector_seen},
      "protected_current":{"generation":current_generation,"chunks":current_total,"documents":current_documents,"vectors":current_vectors},
      "overlap":overlap,"current_only":current_only,
      "candidate":{"generation":candidate_generation,"chunks":candidate_total,"documents":candidate_documents,
                   "vectors":candidate_vectors,"signature":candidate_signature},
      "documents":docs
    }
    log("merge_audit",overlap=overlap,current_only=current_only,candidate_chunks=candidate_total,
        candidate_documents=candidate_documents,candidate_vectors=candidate_vectors,
        candidate_generation=candidate_generation)

    if not APPLY:
        REPORT["ok"]=True
        REPORT["result"]="audit-only"
        save_report()
        sys.exit(0)

    shards=0
    uploaded=0
    for doc in docs:
        docid=doc["document_id"]
        doc_offset=0
        while True:
            rows=conn.execute("""
              select raw_json from candidate
              where document_id=?
              order by page,chunk_index,id,origin,source_seq
              limit 200 offset ?
            """,(docid,doc_offset)).fetchall()
            if not rows:
                break
            records=[normalized_upload_row(json.loads(x[0])) for x in rows]
            response=admin_post("/api/admin/r2-library-shard",{
              "generation":candidate_generation,
              "document_id":docid,
              "offset":doc_offset,
              "records":records
            })
            if not response.get("ok") or int(response.get("records") or 0)!=len(records):
                raise RuntimeError("R2 candidate shard write mismatch")
            uploaded+=len(records)
            shards+=1
            doc_offset+=len(records)
            if shards%10==0:
                log("candidate_upload_progress",records=uploaded,shards=shards,total=candidate_total)
            time.sleep(0.12)

    if uploaded!=candidate_total:
        raise RuntimeError(f"candidate upload incomplete {uploaded}/{candidate_total}")

    candidate_state=admin_get("/api/admin/r2-recovery-candidate-state?generation="+urllib.parse.quote(candidate_generation))
    if not candidate_state.get("ok") or int(candidate_state.get("chunks") or 0)!=candidate_total or int(candidate_state.get("documents") or 0)!=candidate_documents or int(candidate_state.get("invalid_shards") or 0)!=0:
        raise RuntimeError("candidate R2 validation failed: "+json.dumps(candidate_state,ensure_ascii=False))
    log("candidate_verified",chunks=candidate_total,documents=candidate_documents,shards=int(candidate_state.get("shards") or 0))

    finalize=admin_post("/api/admin/r2-recovery-finalize",{
      "generation":candidate_generation,
      "expected_current_generation":current_generation,
      "expected_current_chunks":current_total,
      "protected_floor":PROTECTED_FLOOR,
      "expected_candidate_chunks":candidate_total,
      "expected_candidate_documents":candidate_documents,
      "vectors":candidate_vectors,
      "source_signature":candidate_signature,
      "baseline_generation":baseline_generation,
      "baseline_chunks":baseline_total,
      "metadata":docs
    })
    if not finalize.get("ok") or not finalize.get("promoted"):
        raise RuntimeError("R2 recovery finalize rejected: "+json.dumps(finalize,ensure_ascii=False))
    promoted_generation=candidate_generation
    log("pointer_promoted",generation=candidate_generation,chunks=candidate_total,checkpoint=str(finalize.get("checkpoint_key") or ""))

    verify_state=admin_get("/api/admin/omni-sync-state")
    verify_manifest=admin_get("/api/v1/r2/library-manifest")
    first=admin_get("/api/admin/omni-sync-page?offset=0&limit=1")
    last=admin_get(f"/api/admin/omni-sync-page?offset={candidate_total-1}&limit=1")
    if (str(verify_state.get("generation") or "")!=candidate_generation or
        int(verify_state.get("total") or 0)!=candidate_total or
        int(verify_state.get("documents") or 0)!=candidate_documents or
        str(verify_state.get("source") or "")!="recovery-merge-v8" or
        verify_state.get("authoritative") is not True or
        str(verify_manifest.get("generation") or "")!=candidate_generation or
        int(verify_manifest.get("total_chunks") or 0)!=candidate_total or
        len(first.get("rows") or [])!=1 or len(last.get("rows") or [])!=1):
        raise RuntimeError("post-promotion R2 verification failed")

    sample_text=str(json.loads(conn.execute("select raw_json from baseline order by seq limit 1").fetchone()[0]).get("text") or "")
    query=" ".join(sample_text.split()[4:12]) or "Jesus Cristo"
    _,rag=request_json("POST",BASE+"/api/rag/search",{"Content-Type":"application/json","User-Agent":HTTP_USER_AGENT},{"question":query},timeout=45,accepted=(200,))
    if not rag.get("ok") or not isinstance(rag.get("matches"),list) or len(rag.get("matches"))<1:
        raise RuntimeError("server RAG did not recover through validated fallback")

    REPORT["post_validation"]={
      "r2_state":{k:verify_state.get(k) for k in ("generation","total","documents","shards","vectors","source","authoritative")},
      "manifest":{k:verify_manifest.get(k) for k in ("generation","total_chunks","total_books","vector_count","source","authoritative")},
      "rag_matches":len(rag.get("matches") or []),
      "rag_query":query
    }
    REPORT["ok"]=True
    REPORT["result"]="recovered-and-promoted"
    log("complete",generation=candidate_generation,chunks=candidate_total,documents=candidate_documents,
        vectors=candidate_vectors,rag_matches=len(rag.get("matches") or []))
except Exception as exc:
    REPORT["error"]=str(exc)
    if promoted_generation:
        try:
            rolled=admin_post("/api/admin/r2-recovery-rollback",{"generation":promoted_generation})
            REPORT["rollback"]=rolled
            print("RECOVERY_ROLLBACK="+json.dumps(rolled,ensure_ascii=False,separators=(",",":")))
        except Exception as rollback_exc:
            REPORT["rollback_error"]=str(rollback_exc)
    save_report()
    print("RECOVERY_FAILED="+str(exc),file=sys.stderr)
    sys.exit(1)
finally:
    try: conn.close()
    except Exception: pass
    save_report()
