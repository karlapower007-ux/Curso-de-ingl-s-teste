import {writeFile} from "node:fs/promises";

function normalize(url){
  const value=String(url||"").trim().replace(/\/$/,"");
  return /^https:\/\//i.test(value)?value:"";
}
const candidates=[
  ["vercel-standby",process.env.VERCEL_STANDBY_URL],
  ["deno-standby",process.env.DENO_STANDBY_URL],
  ["secondary-edge",process.env.SECONDARY_STANDBY_URL]
];
for(const extra of String(process.env.EXTRA_STANDBY_URLS||"").split(",").map(x=>x.trim()).filter(Boolean)){
  candidates.push(["extra-standby",extra]);
}
const seen=new Set(),mirrors=[];
for(const [name,raw] of candidates){
  const base_url=normalize(raw);
  if(!base_url||seen.has(base_url))continue;
  seen.add(base_url);
  mirrors.push({name,base_url,enabled:true,timeout_ms:5000});
}
const manifest={
  version:"7.0.0",
  generated_at:new Date().toISOString(),
  strategy:"A->B->C->D->E->F",
  mirrors,
  plan_c:{
    engine:"twenty-agent-cross-device-v7",
    logical_task_capacity:1000,
    physical_worker_cap:16,
    scoring:"strict-same-paragraph-phrase-v4",
    virtualized_cards:true,
    card_gap_px:40,
    window_expansion:{before:2,after:4,full_chunk_fallback:true},
    sequential_chunk_merge:true,
    canonical_reference_elevation:true,
    strict_match_core:"strict-match-core-v4",
    same_paragraph_phrase_required:true,
    fuzzy_matching_disabled:true,
    or_matching_disabled:true,
    omni_sync_batch_size:200,
    omni_sync_memory_flush:true,
    omni_search_all_documents:true,
    zero_noise:true,
    elegant_silence:true,
    logical_agent_count:20,
    agent_physical_worker_cap:16,
    agent2_transformers_semantic:true,
    agent2_model:"Xenova/paraphrase-multilingual-MiniLM-L12-v2",
    agent10_bouncer:true,
    semantic_fallback_after_literal_miss:true,
    phantom_daemon:true,
    phantom_daemon_target_interval_ms:180000,
    periodic_background_sync_best_effort:true,
    omni_sync_cloud_fingerprint:true,
    omni_sync_generation_gc:true,
    manual_sync_button:false,
    zero_touch_after_authorization:true,
    agent11_short_entity_hunter:true,
    agent12_long_form_explainer:true,
    agent13_freshness_sentinel:true,
    agent14_ocr_rescue:true,
    agent15_definition_specialist:true,
    agent16_chronology_mapper:true,
    agent17_cross_library_balancer:true,
    agent18_citation_specialist:true,
    agent19_conflict_auditor:true,
    agent20_mission_master:true,
    cross_device_library_mirror:true,
    cross_device_library_table:"library_chunks",
    cross_device_plaintext_chunk_sync:true,
    cross_device_backfill_from_indexeddb:true,
    cross_device_mobile_hydration:true,
    cross_device_batch_size:200
  },
  plans:{
    A:"Cloudflare Edge + Groq + Supabase",
    B:"Multi-cloud standby endpoint list",
    C:"IndexedDB local lazy takeover",
    D:"Service Worker cached compressed static vault",
    E:"http://127.0.0.1:8788 standalone Node.js",
    F:"raw-vault OS folder"
  }
};

await writeFile("public/failover-manifest.json",JSON.stringify(manifest,null,2));
console.log("FAILOVER_MIRRORS="+mirrors.length);
