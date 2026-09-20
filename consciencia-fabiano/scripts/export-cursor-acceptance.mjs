import fs from "node:fs";

const source=fs.readFileSync(new URL("../src/index.js",import.meta.url),"utf8");
function assert(condition,message){
  if(!condition) throw new Error(message);
}

const start=source.indexOf('if (url.pathname === "/export-page" && request.method === "GET")');
const end=source.indexOf('if (url.pathname === "/memory/list"',start);
assert(start>=0 && end>start,"export-page block not found");
const block=source.slice(start,end);

assert(block.includes('mode==="cursor"'),"cursor mode missing");
assert(block.includes("limit+1"),"LIMIT+1 continuation guard missing");
assert(block.includes("SUM(chunk_count)"),"lightweight document-count total missing");
assert(!block.includes('SELECT COUNT(*) AS n FROM chunks'),"full chunk COUNT(*) still present in export path");
assert(block.includes("WHERE c.id > ?"),"primary-key cursor predicate missing");
assert(block.includes("ORDER BY c.id LIMIT ?"),"primary-key cursor ordering missing");
assert(!source.includes("idx_chunks_created_id"),"cursor hotfix must not build a new chunks index");
assert(block.includes("next_cursor"),"next_cursor missing");
assert(block.includes("has_more:hasMore"),"has_more contract missing");

console.log("EXPORT_CURSOR_ACCEPTANCE=success");
