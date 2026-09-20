import fs from "node:fs";
import path from "node:path";
import {catalogAudit,catalogManifest} from "../src/cognitive-turbines-v74.js";

const audit=catalogAudit();
if(!audit.valid) throw new Error("Invalid v7.4 cognitive catalog: "+JSON.stringify(audit));
const payload={
  schema:"fns-cognitive-v74-manifest",
  version:audit.version,
  generated_at:new Date().toISOString(),
  audit,
  manifest:catalogManifest()
};
const out=path.resolve("public/cognitive-v74-manifest.json");
fs.writeFileSync(out,JSON.stringify(payload,null,2)+"\n","utf8");
console.log(JSON.stringify({ok:true,path:out,total:audit.total,families:audit.family_count,unique_ids:audit.unique_ids}));
