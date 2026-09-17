import v6Core from './strict-output-v6.js';
import AVATAR_REGISTRY from './avatar-config.json';

// FNS V11 MULTI-CORE ROUTER
// Default route -> existing Emma app untouched.
// ?avatar=<id> -> isolated avatar.html + generic avatar-core.js.
// app.js and src/index.js remain untouched.

const OLIVIA_V7_GUARD='FNS-OLIVIA-V7-TURBINES-A-O';
const MULTICORE_GUARD='FNS-AVATAR-MULTICORE-V11';
const AURA_MODEL='@cf/deepgram/aura-2-es';

const TURBINES=Object.freeze({
  A:{speaker:'nestor',locale:'es-ES',region:'España',gender:'masculina',tier:'regional',encoding:'mp3'},
  B:{speaker:'carina',locale:'es-ES',region:'España',gender:'femenina',tier:'regional',encoding:'mp3'},
  C:{speaker:'sirio',locale:'es-MX',region:'México',gender:'masculina',tier:'regional',encoding:'mp3'},
  D:{speaker:'estrella',locale:'es-MX',region:'México',gender:'femenina',tier:'regional',encoding:'mp3'},
  E:{speaker:'javier',locale:'es-MX',region:'México',gender:'masculina',tier:'regional',encoding:'mp3'},
  F:{speaker:'celeste',locale:'es-CO',region:'Colombia',gender:'femenina',tier:'regional',encoding:'mp3'},
  G:{speaker:'aquila',locale:'es-419',region:'Latinoamérica',gender:'masculina',tier:'regional',encoding:'mp3'},
  H:{speaker:'selena',locale:'es-419',region:'Latinoamérica',gender:'femenina',tier:'regional',encoding:'mp3'},
  I:{speaker:'alvaro',locale:'es-ES',region:'España',gender:'masculina',tier:'regional',encoding:'mp3'},
  J:{speaker:'diana',locale:'es-ES',region:'España',gender:'femenina',tier:'regional',encoding:'mp3'},
  K:{speaker:'celeste',locale:'es-CO',region:'Colombia',gender:'femenina',tier:'hifi',encoding:'linear16',container:'wav'},
  L:{speaker:'estrella',locale:'es-MX',region:'México',gender:'femenina',tier:'hifi',encoding:'linear16',container:'wav'},
  M:{speaker:'nestor',locale:'es-ES',region:'España',gender:'masculina',tier:'hifi',encoding:'linear16',container:'wav'},
  N:{speaker:'diana',locale:'es-ES',region:'España',gender:'femenina',tier:'hifi',encoding:'linear16',container:'wav'},
  O:{speaker:'selena',locale:'es-419',region:'Latinoamérica',gender:'femenina',tier:'hifi',encoding:'linear16',container:'wav'}
});

function cors(origin='*'){
  return {
    'Access-Control-Allow-Origin':origin||'*',
    'Access-Control-Allow-Methods':'POST, OPTIONS, GET',
    'Access-Control-Allow-Headers':'Content-Type, X-FNS-STT-Language',
    'Access-Control-Max-Age':'86400',
    'Cache-Control':'no-store'
  };
}
function normalizeAvatarId(value){return String(value||'').trim().toLowerCase().replace(/[^a-z0-9_-]/g,'').slice(0,48);}
function avatarConfig(id){const key=normalizeAvatarId(id);return AVATAR_REGISTRY?.avatars?.[key]||null;}
function runtimeConfig(cfg){
  if(!cfg)return null;
  return {
    id:cfg.id,displayName:cfg.displayName,targetLanguage:cfg.targetLanguage,inputLanguages:cfg.inputLanguages||[],title:cfg.title,subtitle:cfg.subtitle,intro:cfg.intro,images:cfg.images,voice:cfg.voice,theme:cfg.theme||{},registryVersion:AVATAR_REGISTRY.version,guard:MULTICORE_GUARD
  };
}
function selectedAvatarFromUrl(url){
  const explicit=normalizeAvatarId(url.searchParams.get('avatar'));
  if(explicit)return explicit;
  if(url.searchParams.has('olivia'))return'olivia';
  return'';
}
function assetRequest(request,path,preserveSearch=false){
  const url=new URL(request.url);url.pathname=path;if(!preserveSearch)url.search='';
  return new Request(url.toString(),{method:'GET',headers:request.headers});
}
function extractText(result){
  if(typeof result==='string')return result.trim();
  const values=[result?.response,result?.result?.response,result?.result?.text,result?.text,result?.output_text,result?.choices?.[0]?.message?.content,result?.choices?.[0]?.text];
  for(const value of values)if(typeof value==='string'&&value.trim())return value.trim();
  return'';
}
function cleanHistory(history){
  if(!Array.isArray(history))return[];
  return history.filter(x=>x&&['user','assistant'].includes(x.role)&&typeof x.content==='string').map(x=>({role:x.role,content:String(x.content).trim().slice(0,1600)})).filter(x=>x.content).slice(-24);
}
function isOlivia(body){return String(body?.teacher||'').trim().toLowerCase()==='olivia';}
function normalizeTurbine(value){const key=String(value||'K').trim().toUpperCase();return TURBINES[key]?key:'K';}
function sanitizeText(input){return String(input||'').replace(/```[\s\S]*?```/g,' ').replace(/[*_~^#>|`]/g,' ').replace(/[\[\]{}<>]/g,' ').replace(/\s+/g,' ').trim().slice(0,2200);}
function looksPortuguese(text){
  const s=String(text||'').toLowerCase();let pt=0,es=0;if(/[ãõçáâêô]/u.test(s))pt+=4;if(/[ñ¿¡]/u.test(s))es+=4;
  for(const w of s.match(/\p{L}+/gu)||[]){if(['você','voce','não','nao','português','portugues','obrigado','obrigada','também','tambem','estou','quero','preciso','explique','diferença','diferenca','minha','meu'].includes(w))pt++;if(['usted','tú','tu','español','espanol','gracias','también','tambien','estoy','quiero','necesito','hoy','ahora'].includes(w))es++;}
  return pt>es&&pt>=2;
}

async function runAuraTurbine(env,text,origin,key){
  const cfg=TURBINES[key],input={text,speaker:cfg.speaker,encoding:cfg.encoding};if(cfg.container)input.container=cfg.container;
  let raw;try{raw=await env.AI.run(AURA_MODEL,input,{returnRawResponse:true});}catch(error){throw new Error('OLIVIA_V7_AURA_RUN_FAILED '+String(error?.message||error));}
  if(!(raw instanceof Response)||!raw.ok){const detail=raw instanceof Response?await raw.text().catch(()=>''):'';throw new Error('OLIVIA_V7_AURA_HTTP_'+(raw instanceof Response?raw.status:502)+' '+detail.slice(0,220));}
  const headers=new Headers(raw.headers);headers.set('Access-Control-Allow-Origin',origin||'*');headers.set('Access-Control-Allow-Methods','POST, OPTIONS, GET');headers.set('Access-Control-Allow-Headers','Content-Type, X-FNS-STT-Language');headers.set('Cache-Control','no-store');if(!headers.get('Content-Type'))headers.set('Content-Type',cfg.tier==='hifi'?'audio/wav':'audio/mpeg');headers.set('X-FNS-Voice-Engine','aura-2-es-v7-'+cfg.speaker+(cfg.tier==='hifi'?'-hifi':''));headers.set('X-FNS-Voice-Language',cfg.locale);headers.set('X-FNS-Voice-Turbine',key);headers.set('X-FNS-Voice-Speaker',cfg.speaker);headers.set('X-FNS-Voice-Region',cfg.region);headers.set('X-FNS-Voice-Gender',cfg.gender);headers.set('X-FNS-Turbine-Tier',cfg.tier);headers.set('X-FNS-Voice-Guard',OLIVIA_V7_GUARD);headers.set('X-FNS-Fallback-Eligible','speechSynthesis');return new Response(raw.body,{status:200,headers});
}

async function oliviaV7Tts(request,env,ctx){
  const origin=request.headers.get('Origin')||'*',clone=request.clone(),body=await clone.json().catch(()=>({}));
  if(!isOlivia(body))return v6Core.fetch(request,env,ctx);
  const text=sanitizeText(body?.text);if(!text)return Response.json({ok:false,error:'Texto vacío.'},{status:400,headers:cors(origin)});
  if(looksPortuguese(text))return v6Core.fetch(request,env,ctx);
  const turbine=normalizeTurbine(body?.voice_turbine);
  try{return await runAuraTurbine(env,text,origin,turbine);}catch(error){
    const fallbackRequest=new Request(request.url,{method:'POST',headers:request.headers,body:JSON.stringify({...body,text,teacher:'Olivia'})});const response=await v6Core.fetch(fallbackRequest,env,ctx);
    if(response instanceof Response){const headers=new Headers(response.headers);headers.set('X-FNS-Voice-Turbine',turbine);headers.set('X-FNS-V7-Remote-Fallback','v6-cascade');headers.set('X-FNS-Voice-Guard',OLIVIA_V7_GUARD);return new Response(response.body,{status:response.status,headers});}throw error;
  }
}

async function avatarChat(request,env){
  const origin=request.headers.get('Origin')||'*',body=await request.json().catch(()=>({})),cfg=avatarConfig(body?.avatar);
  if(!cfg)return Response.json({ok:false,error:'Avatar desconhecido.'},{status:404,headers:cors(origin)});
  const message=String(body?.message||'').trim().slice(0,1400);if(!message)return Response.json({ok:false,error:'Mensagem vazia.'},{status:400,headers:cors(origin)});
  const level=String(body?.level||'A1').slice(0,12),history=cleanHistory(body?.history),messages=[{role:'system',content:String(cfg.systemPrompt||'')+' Nível CEFR atual: '+level+'.'},...history,{role:'user',content:message}];
  try{
    const result=await env.AI.run('@cf/openai/gpt-oss-120b',{messages,max_tokens:300,temperature:.35,top_p:.85});
    const reply=extractText(result);if(!reply)throw new Error('Resposta vazia.');
    return Response.json({ok:true,avatar:cfg.id,teacher:cfg.displayName,reply,registry_version:AVATAR_REGISTRY.version,guard:MULTICORE_GUARD},{headers:{...cors(origin),'X-FNS-Avatar-Core':MULTICORE_GUARD,'X-FNS-Avatar-Id':cfg.id}});
  }catch(error){return Response.json({ok:false,error:String(error?.message||error),avatar:cfg.id},{status:503,headers:cors(origin)});}
}

async function avatarTts(request,env,ctx){
  const origin=request.headers.get('Origin')||'*',body=await request.json().catch(()=>({})),cfg=avatarConfig(body?.avatar);
  if(!cfg)return Response.json({ok:false,error:'Avatar desconhecido.'},{status:404,headers:cors(origin)});
  const forwardedBody={...body,teacher:cfg.backendTeacher||cfg.displayName,voice_turbine:body?.voice_turbine||cfg.voice?.defaultTurbine};delete forwardedBody.avatar;
  const url=new URL(request.url);url.pathname='/tts';const forwarded=new Request(url.toString(),{method:'POST',headers:{...Object.fromEntries(request.headers),'Content-Type':'application/json'},body:JSON.stringify(forwardedBody)});
  const response=await oliviaV7Tts(forwarded,env,ctx);const headers=new Headers(response.headers);headers.set('X-FNS-Avatar-Core',MULTICORE_GUARD);headers.set('X-FNS-Avatar-Id',cfg.id);return new Response(response.body,{status:response.status,headers});
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url),path=url.pathname;

    if(request.method==='GET'&&path==='/avatar/runtime-config'){
      const cfg=avatarConfig(url.searchParams.get('avatar'));if(!cfg)return Response.json({ok:false,error:'Avatar desconhecido.'},{status:404,headers:{'Cache-Control':'no-store'}});
      return Response.json({ok:true,avatar:runtimeConfig(cfg)},{headers:{'Cache-Control':'no-store','X-FNS-Avatar-Core':MULTICORE_GUARD}});
    }
    if(request.method==='POST'&&path==='/avatar/chat')return avatarChat(request,env);
    if(request.method==='POST'&&path==='/avatar/tts')return avatarTts(request,env,ctx);
    if(path==='/tts'&&request.method==='POST')return oliviaV7Tts(request,env,ctx);

    if((request.method==='GET'||request.method==='HEAD')&&path==='/'){
      const avatarId=selectedAvatarFromUrl(url);
      if(avatarId){
        if(!avatarConfig(avatarId))return new Response('Avatar não encontrado.',{status:404,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
        const response=await env.ASSETS.fetch(assetRequest(request,'/avatar.html',true));const headers=new Headers(response.headers);headers.set('Cache-Control','no-store');headers.set('X-FNS-Entry-Point','avatar:'+avatarId);headers.set('X-FNS-Avatar-Core',MULTICORE_GUARD);return new Response(response.body,{status:response.status,headers});
      }
      return env.ASSETS.fetch(request);
    }

    if((request.method==='GET'||request.method==='HEAD')&&!['/health'].includes(path))return env.ASSETS.fetch(request);
    return v6Core.fetch(request,env,ctx);
  }
};

export {TURBINES,OLIVIA_V7_GUARD,MULTICORE_GUARD,normalizeTurbine};
