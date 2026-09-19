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
  version:"3.0.0",
  generated_at:new Date().toISOString(),
  strategy:"A->B->C->D->E->F",
  mirrors,
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
