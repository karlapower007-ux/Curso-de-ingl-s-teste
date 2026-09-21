import assert from "node:assert/strict";
import {assertCompleteLibrary,hybridRank,validateRecoveredSources,buildMapReducePlan,sourceContract,buildCitationCatalog,buildEncyclopedicContract,validateCitationCatalog,runFailoverChain,CircuitBreaker,promotionGate} from "../core/golden-rag.mjs";

assert.throws(()=>assertCompleteLibrary({documents:1,chunks:10,embeddings:0}),/EMPTY_EMBEDDINGS/);
assert.throws(()=>assertCompleteLibrary({documents:1,chunks:10,embeddings:9}),/PARTIAL_EMBEDDINGS/);
assert.equal(assertCompleteLibrary({documents:2,chunks:10,embeddings:10}).valid,true);

const records=[
 {id:"a",document_id:"d1",title:"Restauração",text:"Joseph Smith e a Restauração do evangelho",vector:[1,0]},
 {id:"b",document_id:"d2",title:"Convênios",text:"Convênios e ordenanças",vector:[0,1]}
];
const ranked=hybridRank({query:"Joseph Smith Restauração",queryVector:[1,0],records,limit:10});
assert.equal(ranked[0].id,"a");
const sources=validateRecoveredSources(ranked);
assert.equal(sources[0].document_id,"d1");
assert.equal(sourceContract([]).answerAllowed,false);
assert.equal(sourceContract(ranked).answerAllowed,true);

const many=Array.from({length:60},(_,i)=>({id:String(i),document_id:"d"+i,text:"x"}));
assert.equal(buildMapReducePlan(many,{batchSize:10,threshold:20}).mode,"map-reduce");
assert.equal(buildMapReducePlan(many,{batchSize:10,threshold:20}).batches.length,6);

const catalog=buildCitationCatalog(ranked);
assert.equal(catalog[0].ref,"F1");
assert.equal(validateCitationCatalog(catalog).valid,true);
assert.equal(buildEncyclopedicContract([]).answerAllowed,false);
assert.equal(buildEncyclopedicContract(many,{batchSize:10,threshold:20}).mode,"map-reduce");

const primaryCircuit=new CircuitBreaker({threshold:1,pauseMs:1000});
const failover=await runFailoverChain({
  query:"Restauração",
  providers:[
    {name:"primary",circuit:primaryCircuit,run:async()=>{throw new Error("quota")}},
    {name:"secondary",run:async()=>({sources:[{id:"a"}]})}
  ],
  accept:value=>Array.isArray(value?.sources)&&value.sources.length>0
});
assert.equal(failover.provider,"secondary");
assert.equal(primaryCircuit.canTry(),false);

const cb=new CircuitBreaker({threshold:2,pauseMs:1000,maxPauseMs:4000});
cb.failure(100); assert.equal(cb.canTry(100),true);
cb.failure(100); assert.equal(cb.canTry(100),false);
cb.success(); assert.equal(cb.canTry(100),true);

const qa=Object.fromEntries(["site","layout","navigation","fale","lexical","vector","multiSource","encyclopedic","citations","audio","avatar","mobile","desktop","persistence","fallback","rollback"].map(k=>[k,true]));
assert.equal(promotionGate({
  library:{documents:2,chunks:10,embeddings:10},
  snapshot:{authoritative:true,partial:false,chunks:10,embeddings:10},
  qa
}).promotable,true);
assert.throws(()=>promotionGate({
  library:{documents:2,chunks:10,embeddings:10},
  snapshot:{authoritative:false,partial:false,chunks:10,embeddings:10},
  qa
}),/NOT_AUTHORITATIVE/);

console.log("FNS_V33_GOLDEN_RAG_TESTS=success");
