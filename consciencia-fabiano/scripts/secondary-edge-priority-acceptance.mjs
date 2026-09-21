import assert from "node:assert/strict";
import {retrieveSecondaryHybridContext,secondarySupabaseConfigured} from "../src/stateful-rag-v75.js";

const originalFetch=globalThis.fetch;
const calls=[];
globalThis.fetch=async (url,options={})=>{
  calls.push({url:String(url),headers:options.headers||{},body:String(options.body||"")});
  if(String(url).includes("action=manifest")){
    return new Response(JSON.stringify({
      ok:true,generation:"v75-static-eeadaf861443",
      total_books:4,total_chunks:25199,vector_count:25199,
      source_signature:"x".repeat(64)
    }),{status:200,headers:{"content-type":"application/json"}});
  }
  if(String(url).includes("action=search")){
    return new Response(JSON.stringify({
      ok:true,matches:[{
        id:"m1",document_id:"d1",filename:"standard-works-83806-por.pdf",
        text:"Jesus Cristo e convênio",score:0.2,lexical_score:0.05,
        semantic_score:0,retrieval_mode:"supabase-bm25"
      }]
    }),{status:200,headers:{"content-type":"application/json"}});
  }
  throw new Error("Direct REST must not be used when verified Edge transport exists: "+url);
};

try{
  const env={
    SUPABASE_URL:"https://stale-direct.example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY:"stale-direct-key",
    SUPABASE_SECONDARY_FUNCTION_URL:"https://verified.example.supabase.co/functions/v1/fns-resilience-secondary",
    FNS_OWNER_TOKEN:"owner-token"
  };
  assert.equal(secondarySupabaseConfigured(env),true);
  const result=await retrieveSecondaryHybridContext(env,"Jesus Cristo convênio",null,{
    perDocumentK:20,globalLimit:40
  });
  assert.equal(result.readable,true);
  assert.equal(result.mirrored,true);
  assert.equal(result.manifest.total_chunks,25199);
  assert.equal(result.matches.length,1);
  assert.equal(calls.length,2);
  assert.ok(calls.every(call=>call.url.startsWith("https://verified.example.supabase.co/functions/v1/fns-resilience-secondary")));
  assert.ok(calls[0].url.includes("action=manifest"));
  assert.ok(calls[1].url.includes("action=search"));
  assert.equal(calls[0].headers["X-FNS-Owner-Token"],"owner-token");
  assert.ok(!calls[0].url.includes("stale-direct"));
  console.log(JSON.stringify({
    ok:true,
    preferred_transport:"edge-owner-token",
    stale_direct_bypassed:true,
    manifest_chunks:result.manifest.total_chunks,
    matches:result.matches.length
  },null,2));
} finally {
  globalThis.fetch=originalFetch;
}
