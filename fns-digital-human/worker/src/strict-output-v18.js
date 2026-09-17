import v17Core, {
  collectConversation,
  systemPrompt,
  looksNonSpanish,
  extractText
} from './strict-output-v17.js';

// FNS OLIVIA V18 — surgical end-to-end chat recovery.
// V16 visual/HTML/CSS/assets/avatar-core are FROZEN and untouched.
// V18 changes ONLY Olivia's /chat backend behavior:
// 1) keep V17 full-turn contextual chat;
// 2) when Workers AI is unavailable/quota-exhausted, fail over to existing public-brain style providers;
// 3) always return the same {ok:true, reply} contract so the frozen V16 frontend can
//    append Olivia's bubble and immediately call its existing speak()/lip-sync pipeline.

const V18_GUARD='FNS-OLIVIA-V18-END-TO-END';
const CF_MODEL='@cf/openai/gpt-oss-120b';
const STATIC_CANNED='Claro. Sigamos en español. Cuéntame un poco más sobre eso.';

function cors(origin='*'){
  return {
    'Access-Control-Allow-Origin':origin||'*',
    'Access-Control-Allow-Methods':'POST, OPTIONS, GET',
    'Access-Control-Allow-Headers':'Content-Type, X-FNS-STT-Language, X-FNS-QA-Mock, X-FNS-QA-Force-Public',
    'Access-Control-Max-Age':'86400',
    'Cache-Control':'no-store'
  };
}

function isOlivia(body){
  return String(body?.teacher||'').trim().toLowerCase()==='olivia';
}

function isQuotaError(value){
  const text=String(value?.message||value||'');
  return /\b4006\b|daily free allocation|10\s*,?\s*000\s+neurons|used up.*neurons|workers ai.*(quota|allocation)|quota exhausted/i.test(text);
}

function validReply(text){
  const reply=String(text||'').trim();
  return !!reply && reply!==STATIC_CANNED && !looksNonSpanish(reply);
}

function withTimeout(promise,ms,label='timeout'){
  let timer;
  const timeout=new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(new Error(label)),ms);
  });
  return Promise.race([promise,timeout]).finally(()=>clearTimeout(timer));
}

function buildConversation(body,message){
  const conversation=collectConversation(body);
  const last=conversation[conversation.length-1];
  if(!(last&&last.role==='user'&&last.content===message)){
    conversation.push({role:'user',content:message});
  }
  return conversation.slice(-30);
}

function buildMessages(body,message){
  const level=String(body?.level||'A1').trim().slice(0,12)||'A1';
  const conversation=buildConversation(body,message);
  return {
    level,
    conversation,
    messages:[
      {role:'system',content:systemPrompt(level)},
      ...conversation
    ]
  };
}

async function cloudflareReply(env,messages){
  if(!env?.AI?.run)throw new Error('Workers AI binding unavailable');
  const result=await withTimeout(
    env.AI.run(CF_MODEL,{
      messages,
      max_tokens:220,
      temperature:0.62,
      top_p:0.90
    }),
    8000,
    'Workers AI chat timeout'
  );
  return extractText(result);
}

async function pollinationsOpenAIReply(messages){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort('pollinations-openai-timeout'),9000);
  try{
    const response=await fetch('https://text.pollinations.ai/openai',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        model:'openai-fast',
        messages,
        stream:false,
        temperature:0.62,
        top_p:0.90,
        max_tokens:220,
        private:true
      }),
      signal:controller.signal
    });
    if(!response.ok){
      const detail=await response.text().catch(()=>'');
      throw new Error(`Pollinations OpenAI HTTP ${response.status}${detail?': '+detail.slice(0,160):''}`);
    }
    const data=await response.json().catch(()=>null);
    const reply=String(
      data?.choices?.[0]?.message?.content ||
      data?.choices?.[0]?.text ||
      data?.response ||
      ''
    ).trim();
    if(!reply)throw new Error('Pollinations OpenAI returned empty reply');
    return reply;
  }finally{
    clearTimeout(timer);
  }
}

function flattenPrompt(messages){
  return messages
    .slice(-10)
    .map(item=>`${item.role==='assistant'?'Olivia':item.role==='system'?'Sistema':'Usuario'}: ${String(item.content||'').slice(0,1200)}`)
    .join('\n')
    .slice(-7000) + '\nOlivia:';
}

async function pollinationsTextReply(messages){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort('pollinations-text-timeout'),8500);
  try{
    const prompt=flattenPrompt(messages);
    const url='https://text.pollinations.ai/'+encodeURIComponent(prompt)+'?model=openai-fast&temperature=0.62&private=true';
    const response=await fetch(url,{method:'GET',signal:controller.signal,headers:{'Accept':'text/plain'}});
    if(!response.ok){
      const detail=await response.text().catch(()=>'');
      throw new Error(`Pollinations text HTTP ${response.status}${detail?': '+detail.slice(0,160):''}`);
    }
    const reply=(await response.text()).trim();
    if(!reply)throw new Error('Pollinations text returned empty reply');
    return reply;
  }finally{
    clearTimeout(timer);
  }
}

function parseSseData(text){
  const lines=String(text||'').split(/\r?\n/);
  let last=null;
  for(const line of lines){
    if(!line.startsWith('data:'))continue;
    const payload=line.slice(5).trim();
    if(!payload)continue;
    try{last=JSON.parse(payload);}catch{}
  }
  return last;
}

function extractUnknown(value){
  if(typeof value==='string')return value.trim();
  if(Array.isArray(value)){
    for(let i=value.length-1;i>=0;i--){
      const text=extractUnknown(value[i]);
      if(text)return text;
    }
  }
  if(value&&typeof value==='object'){
    for(const key of ['content','text','response','answer','message','value']){
      const text=extractUnknown(value[key]);
      if(text)return text;
    }
  }
  return '';
}

async function huggingFaceChatReply(messages){
  const base='https://zacheus10-free-ai-chat.hf.space';
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort('hf-chat-timeout'),10000);
  try{
    const userMessage=String([...messages].reverse().find(x=>x.role==='user')?.content||'');
    const systemMessage=String(messages.find(x=>x.role==='system')?.content||'');
    const historyMessages=messages
      .filter(x=>x&&['user','assistant'].includes(x.role))
      .slice(0,-1)
      .map(x=>({role:x.role,content:String(x.content||'')}));
    const historyPairs=[];
    for(let i=0;i<historyMessages.length;i+=2){
      historyPairs.push([historyMessages[i]?.content||'',historyMessages[i+1]?.content||'']);
    }

    let discovered=[];
    try{
      const info=await fetch(base+'/gradio_api/openapi.json',{signal:controller.signal});
      if(info.ok){
        const spec=await info.json();
        discovered=Object.keys(spec?.paths||{})
          .map(path=>path.match(/\/call\/([^/{]+)/)?.[1]||'')
          .filter(Boolean);
      }
    }catch{}

    const names=[...new Set([...discovered,'chat','predict','generate','generate_response','chatbot','_chat_fn','submit'])];
    const variants=[
      [userMessage,historyMessages,320,0.65],
      [userMessage,historyMessages,192,0.55],
      [userMessage,historyMessages,systemMessage,256,0.6,0.9,50,1.1],
      [userMessage,historyPairs,systemMessage,256,0.6,0.9,50,1.1],
      [userMessage,historyMessages,systemMessage],
      [userMessage,historyPairs,systemMessage],
      [userMessage,historyMessages],
      [userMessage,historyPairs],
      [userMessage]
    ];

    for(const name of names){
      for(const data of variants){
        try{
          const submit=await fetch(base+'/gradio_api/call/'+encodeURIComponent(name),{
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({data}),
            signal:controller.signal
          });
          if(!submit.ok)continue;
          const accepted=await submit.json().catch(()=>null);
          if(!accepted?.event_id)continue;
          const resultResponse=await fetch(
            base+'/gradio_api/call/'+encodeURIComponent(name)+'/'+encodeURIComponent(accepted.event_id),
            {signal:controller.signal}
          );
          if(!resultResponse.ok)continue;
          const payload=parseSseData(await resultResponse.text());
          const reply=extractUnknown(payload);
          if(reply)return reply;
        }catch(error){
          if(controller.signal.aborted)throw error;
        }
      }
    }
    throw new Error('No compatible public Hugging Face chat endpoint responded');
  }finally{
    clearTimeout(timer);
  }
}

async function publicBrain(messages){
  const failures=[];
  const providers=[
    ['pollinations-openai',()=>pollinationsOpenAIReply(messages)],
    ['pollinations-text',()=>pollinationsTextReply(messages)],
    ['hf-free-ai-chat',()=>huggingFaceChatReply(messages)]
  ];
  for(const [name,run] of providers){
    try{
      const reply=await run();
      if(validReply(reply))return {reply,provider:name,failures};
      failures.push(name+': invalid/non-Spanish reply');
    }catch(error){
      failures.push(name+': '+String(error?.message||error).slice(0,180));
    }
  }
  return {reply:'',provider:'',failures};
}

async function oliviaV18Chat(request,env){
  const origin=request.headers.get('Origin')||'*';
  const body=await request.json().catch(()=>({}));
  if(!isOlivia(body))return null;

  const message=String(body?.message||'').trim().slice(0,1800);
  if(!message){
    return Response.json({ok:false,error:'Mensaje vacío.'},{status:400,headers:cors(origin)});
  }

  const {level,conversation,messages}=buildMessages(body,message);
  const forcePublic=request.headers.get('X-FNS-QA-Force-Public')==='1'||body?.force_public===true;
  let reply='';
  let provider='cloudflare-gpt-oss';
  let cloudError=null;
  let failures=[];

  if(!forcePublic){
    try{
      reply=await cloudflareReply(env,messages);
      if(!validReply(reply))throw new Error('Workers AI returned invalid/non-Spanish reply');
    }catch(error){
      cloudError=error;
      reply='';
    }
  }else{
    cloudError=new Error('Public failover forced for QA');
  }

  if(!reply){
    const publicResult=await publicBrain(messages);
    reply=publicResult.reply;
    provider=publicResult.provider||'none';
    failures=publicResult.failures;
  }

  if(!validReply(reply)){
    return Response.json({
      ok:false,
      code:'FNS_OLIVIA_V18_ALL_BRAINS_UNAVAILABLE',
      error:'No hay un motor de conversación disponible en este momento. No se sustituyó la respuesta por una frase fija.',
      teacher:'Olivia',
      dynamic_chat:true,
      static_fallback:false,
      cloudflare_quota:isQuotaError(cloudError),
      provider_failures:failures,
      context_messages:conversation.length
    },{
      status:503,
      headers:{
        ...cors(origin),
        'X-FNS-Chat-Engine':'olivia-v18-unavailable',
        'X-FNS-V18-Guard':V18_GUARD
      }
    });
  }

  return Response.json({
    ok:true,
    reply,
    teacher:'Olivia',
    model:provider==='cloudflare-gpt-oss'?CF_MODEL:provider,
    provider,
    fallback:provider!=='cloudflare-gpt-oss',
    cloudflare_quota:isQuotaError(cloudError),
    strict_language:'es-ES',
    level,
    dynamic_chat:true,
    static_fallback:false,
    context_messages:conversation.length,
    memory:{plan:'client-full-turn-context',messages:conversation.length}
  },{
    headers:{
      ...cors(origin),
      'X-FNS-Chat-Engine':'olivia-v18-'+provider,
      'X-FNS-Strict-Language':'es-ES',
      'X-FNS-V18-Guard':V18_GUARD,
      'X-FNS-V18-Provider':provider
    }
  });
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);

    // Preserve V16/V17 CI mock contract; it never consumes Workers AI or public providers.
    if(request.headers.get('X-FNS-QA-Mock')==='1'){
      return v17Core.fetch(request,env,ctx);
    }

    if(url.pathname==='/chat'&&request.method==='POST'){
      const clone=request.clone();
      const body=await clone.json().catch(()=>({}));
      if(isOlivia(body)){
        const response=await oliviaV18Chat(request,env);
        if(response)return response;
      }
    }

    // EVERYTHING ELSE remains the already-approved V16/V17 chain:
    // HTML, CSS, avatar images, avatar-core.js, STT, TTS, lip-sync, Emma and other routes.
    return v17Core.fetch(request,env,ctx);
  }
};

export {
  V18_GUARD,
  buildMessages,
  validReply,
  isQuotaError,
  publicBrain,
  pollinationsOpenAIReply,
  pollinationsTextReply,
  huggingFaceChatReply
};
