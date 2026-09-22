import fs from "node:fs";
import { chromium } from "playwright-core";

const base=process.env.FNS_V2_BASE||"http://127.0.0.1:8788";
const candidates=[
  process.env.CHROME_PATH,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser"
].filter(Boolean);
const executablePath=candidates.find(p=>fs.existsSync(p));
if(!executablePath)throw new Error("Chrome/Chromium não encontrado.");

async function seedLegacy(page){
  return page.evaluate(async()=>{
    const name="fns_rag_resilience_v1";
    const db=await new Promise((resolve,reject)=>{
      const req=indexedDB.open(name,1);
      req.onupgradeneeded=()=>{
        const db=req.result;
        if(!db.objectStoreNames.contains("chunks")){
          const s=db.createObjectStore("chunks",{keyPath:"key"});
          s.createIndex("document_id","document_id",{unique:false});
        }
        if(!db.objectStoreNames.contains("vectors")){
          const s=db.createObjectStore("vectors",{keyPath:"key"});
          s.createIndex("document_id","document_id",{unique:false});
        }
      };
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error);
    });
    const rows=[
      {key:"qa:1",id:"qa:1",document_id:"qa",title:"Livro QA",page:10,chunk_index:1,text:"O Plano de Salvação inclui ensinamentos sobre a Vida Pré-Mortal e a mortalidade."},
      {key:"qa:2",id:"qa:2",document_id:"qa",title:"Livro QA",page:11,chunk_index:2,text:"O Plano de Salvação aparece neste parágrafo.\n\nA Vida Pré-Mortal aparece apenas em outro parágrafo."},
      {key:"qa:3",id:"qa:3",document_id:"qa2",title:"Livro QA Inglês",page:7,chunk_index:3,text:"The plan of salvation discusses premortal life in the same paragraph."},
      {key:"qa:4",id:"qa:4",document_id:"qa3",title:"Livro QA Histórico",page:20,chunk_index:4,text:"Em 1830 Joseph Smith registrou esta experiência. Em 1844 ocorreu outro evento relacionado."}
    ];
    await new Promise((resolve,reject)=>{
      const tx=db.transaction("chunks","readwrite"),store=tx.objectStore("chunks");
      for(const row of rows)store.put(row);
      tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
    });
    db.close();
    return rows.length;
  });
}

const browser=await chromium.launch({headless:true,executablePath,args:["--no-sandbox"]});
const report=[];
try{
  for(const width of [360,390,412,1366]){
    const context=await browser.newContext({viewport:{width,height:width<600?800:900}});
    const page=await context.newPage();
    const pageErrors=[];
    page.on("pageerror",e=>pageErrors.push(String(e)));

    await page.goto(base+"/?v2_browser_smoke="+width+"-"+Date.now(),{waitUntil:"domcontentloaded",timeout:45000});
    await page.locator("#questionInput").waitFor({state:"visible",timeout:10000});
    await page.locator("#v2Model").waitFor({state:"visible",timeout:10000});
    await page.locator("#v2ResponseMode").waitFor({state:"visible",timeout:10000});
    await page.waitForFunction(()=>document.querySelector("#v2LocalStatus")?.textContent?.includes("Local grátis"),null,{timeout:15000});

    const seeded=await seedLegacy(page);
    if(seeded!==4)throw new Error("Falha ao semear biblioteca local.");

    const layout=await page.evaluate(()=>({
      innerWidth:window.innerWidth,
      scrollWidth:document.documentElement.scrollWidth,
      model:document.querySelector("#v2Model")?.value,
      response:document.querySelector("#v2ResponseMode")?.value,
      status:document.querySelector("#v2LocalStatus")?.textContent||""
    }));
    if(layout.scrollWidth>layout.innerWidth+2)throw new Error("Overflow horizontal em "+width+": "+JSON.stringify(layout));

    await page.locator("#dictionaryTab").click();
    await page.locator("#dictionaryInput").fill("Plano de Salvação e Vida Pré-Mortal");
    await page.locator("#dictionarySearchBtn").click();
    await page.waitForFunction(()=>/ocorrência\(s\)/i.test(document.querySelector("#dictionaryStatus")?.textContent||""),null,{timeout:15000});
    const dictionary=await page.evaluate(()=>({
      status:document.querySelector("#dictionaryStatus")?.textContent||"",
      info:document.querySelector("#dictionaryPageInfo")?.textContent||"",
      rows:[...document.querySelectorAll(".v2-dictionary-result .dictionary-result-text")].map(x=>x.textContent||"")
    }));
    if(dictionary.rows.length!==2)throw new Error("Strict AND deveria retornar exatamente dois blocos em "+width+": "+JSON.stringify(dictionary));
    if(dictionary.rows.some(x=>x.includes("apenas em outro parágrafo")))throw new Error("Strict AND combinou parágrafos separados em "+width);

    await page.locator("#chatTab").click();
    await page.locator("#v2ResponseMode").selectOption("exact");
    const apiCalls=[];
    const onRequest=req=>{try{const u=new URL(req.url());if(u.pathname==="/api/v2/chat")apiCalls.push(req.url());}catch{}};
    page.on("request",onRequest);
    await page.locator("#questionInput").fill("Plano de Salvação e Vida Pré-Mortal");
    await page.locator("#sendBtn").click();
    await page.waitForFunction(()=>document.querySelectorAll(".msg.assistant.v2-msg").length>0,null,{timeout:15000});
    page.off("request",onRequest);
    if(apiCalls.length)throw new Error("Citação exata chamou /api/v2/chat em "+width+": "+JSON.stringify(apiCalls));
    const exactText=await page.locator(".msg.assistant.v2-msg").last().innerText();
    if(!exactText.includes("Plano de Salvação")&&!exactText.includes("plan of salvation"))throw new Error("Resposta exata não trouxe texto literal em "+width);

    await page.locator("#v2ResponseMode").selectOption("explain");
    await page.locator("#questionInput").fill("Explique o Plano de Salvação");
    await page.locator("#sendBtn").click();
    await page.waitForFunction(()=>document.querySelectorAll(".msg.assistant.v2-msg").length>=2,null,{timeout:20000});
    const explainText=await page.locator(".msg.assistant.v2-msg").last().innerText();
    if(!/MOCK_QWEN_LOCAL_OK/.test(explainText))throw new Error("Modo explicação não passou pelo Ollama local mock em "+width+": "+explainText);

    if(pageErrors.length)throw new Error("Erros de página em "+width+": "+pageErrors.join(" | "));
    report.push({width,layout,dictionary_rows:dictionary.rows.length,exact_zero_llm:true,explain_local_llm:true});
    await context.close();
  }

  const standaloneContext=await browser.newContext({viewport:{width:390,height:800},serviceWorkers:"block"});
  await standaloneContext.route("**/api/v2/health",route=>route.abort());
  const standalone=await standaloneContext.newPage();
  await standalone.goto(base+"/?v2_standalone="+Date.now(),{waitUntil:"domcontentloaded",timeout:45000});
  await standalone.locator("#questionInput").waitFor({state:"visible",timeout:10000});
  await seedLegacy(standalone);
  await standalone.reload({waitUntil:"domcontentloaded",timeout:30000});
  await standalone.locator("#v2LocalStatus").waitFor({state:"visible",timeout:10000});
  await standalone.waitForFunction(()=>document.querySelector("#v2LocalStatus")?.textContent?.includes("Local no navegador"),null,{timeout:15000});
  await standaloneContext.setOffline(true);

  await standalone.locator("#v2ResponseMode").selectOption("exact");
  await standalone.locator("#questionInput").fill("Plano de Salvação e Vida Pré-Mortal");
  await standalone.locator("#sendBtn").click();
  await standalone.waitForFunction(()=>document.querySelectorAll(".msg.assistant.v2-msg").length>=1,null,{timeout:15000});
  const standaloneExact=await standalone.locator(".msg.assistant.v2-msg").last().innerText();
  if(!/Plano de Salvação|plan of salvation/i.test(standaloneExact))throw new Error("Standalone mobile exact falhou.");

  await standalone.locator("#v2ResponseMode").selectOption("explain");
  await standalone.locator("#questionInput").fill("Explique o Plano de Salvação");
  await standalone.locator("#sendBtn").click();
  await standalone.waitForFunction(()=>document.querySelectorAll(".msg.assistant.v2-msg").length>=2,null,{timeout:15000});
  const standaloneExplain=await standalone.locator(".msg.assistant.v2-msg").last().innerText();
  if(!standaloneExplain.includes("Resposta determinística local"))throw new Error("Standalone mobile deterministic fallback falhou: "+standaloneExplain);
  report.push({width:390,standalone_browser_offline:true,exact_zero_llm:true,deterministic_without_ollama:true});
  await standaloneContext.close();

  console.log("V2_LOCAL_BROWSER_SMOKE=pass");
  console.log(JSON.stringify(report,null,2));
}finally{
  await browser.close();
}
