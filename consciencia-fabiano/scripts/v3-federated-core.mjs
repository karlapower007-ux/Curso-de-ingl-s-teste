export function mergeFederatedSearch(baseResult,incrementalResult,limit=40){
  const safeLimit=Math.max(1,Math.min(80,Number(limit||40)));
  const all=[...(baseResult?.results||[]),...(incrementalResult?.results||[])];
  all.sort((a,b)=>Number(b?.score||0)-Number(a?.score||0)||
    String(a?.reference||"").localeCompare(String(b?.reference||""),"pt-BR"));
  const seen=new Set(),results=[];
  for(const row of all){
    const key=String(row?.document_id||"")+"|"+String(row?.page||"")+"|"+
      String(row?.text||"").replace(/\s+/g," ").trim().slice(0,240);
    if(seen.has(key))continue;
    seen.add(key);
    results.push(row);
    if(results.length>=safeLimit)break;
  }
  return {
    query:String(baseResult?.query||incrementalResult?.query||""),
    expansions:[...new Set([...(baseResult?.expansions||[]),...(incrementalResult?.expansions||[])])],
    total:Number(baseResult?.total||0)+Number(incrementalResult?.total||0),
    results,
    sources:{
      base_frozen:Number(baseResult?.total||0),
      incremental_50k:Number(incrementalResult?.total||0)
    }
  };
}
