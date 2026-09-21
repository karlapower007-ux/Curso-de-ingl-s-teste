import assert from "node:assert/strict";
import {
  secondarySupabaseConfigured,
  retrieveSecondaryHybridContext
} from "../src/stateful-rag-v75.js";

assert.equal(secondarySupabaseConfigured({}),false);
assert.equal(secondarySupabaseConfigured({
  SUPABASE_URL:"https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY:"secret"
}),true);
assert.equal(secondarySupabaseConfigured({
  FNS_SECONDARY_URL:"https://example.supabase.co/functions/v1/fns-resilience-secondary",
  FNS_OWNER_TOKEN:"owner-secret"
}),true);

const originalFetch=globalThis.fetch;
const calls=[];
globalThis.fetch=async (url,options={})=>{
  calls.push({url:String(url),headers:options.headers||{},body:String(options.body||"")});
  if(String(url).includes("action=manifest")){
    return new Response(JSON.stringify({
      ok:true,
      generation:"v75-static-eeadaf861443",
      total_books:4,
      total_chunks:25199,
      vector_count:25199,
      source_signature:"x".repeat(64)
    }),{status:200,headers:{"content-type":"application/json"}});
  }
  if(String(url).includes("action=search")){
    return new Response(JSON.stringify({
      ok:true,
      matches:[{
        id:"chunk-1",
        document_id:"doc-1",
        filename:"Livro.pdf",
        text:"Jesus Cristo e convênios",
        score:0.91,
        lexical_score:0.88,
        semantic_score:0.94
      }]
    }),{status:200,headers:{"content-type":"application/json"}});
  }
  return new Response(JSON.stringify({ok:false}),{status:404});
};

try{
  const env={
    FNS_SECONDARY_URL:"https://example.supabase.co/functions/v1/fns-resilience-secondary",
    FNS_OWNER_TOKEN:"owner-secret"
  };
  const result=await retrieveSecondaryHybridContext(env,"Jesus Cristo convênio",null,{
    perDocumentK:20,
    globalLimit:40
  });
  assert.equal(result.readable,true);
  assert.equal(result.mirrored,true);
  assert.equal(result.manifest.total_chunks,25199);
  assert.equal(result.manifest.vector_count,25199);
  assert.equal(result.matches.length,1);
  assert.equal(result.matches[0].document_id,"doc-1");
  assert.equal(calls.length,2);
  assert.ok(calls[0].url.includes("action=manifest"));
  assert.ok(calls[1].url.includes("action=search"));
  assert.equal(calls[0].headers["X-FNS-Owner-Token"],"owner-secret");
  assert.equal(calls[1].headers["X-FNS-Owner-Token"],"owner-secret");
  assert.ok(!("Authorization" in calls[0].headers));
  console.log(JSON.stringify({
    ok:true,
    transport:"edge-owner-token",
    service_role_exposed:false,
    manifest_chunks:result.manifest.total_chunks,
    manifest_vectors:result.manifest.vector_count,
    search_matches:result.matches.length
  },null,2));
}finally{
  globalThis.fetch=originalFetch;
}
