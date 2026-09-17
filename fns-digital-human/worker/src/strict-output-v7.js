import v6Core from './strict-output-v6.js';
import strictCore from './strict-output.js';

// FNS OLIVIA V7 — 15 isolated TTS turbines A-O.
// Emma is delegated untouched through strict-output-v6 -> strict-output.
// Olivia V15 chat is routed directly through the strict Spanish guard so the
// legacy bilingual V6 path cannot leak Portuguese/English into this room.
// A-J: regional low-latency Aura-2 Spanish profiles.
// K-O: lossless/high-fidelity Aura-2 Spanish profiles (WAV/linear16).

const OLIVIA_V7_GUARD='FNS-OLIVIA-V7-TURBINES-A-O';
const AVATAR_FACTORY_GUARD='FNS-AVATAR-FACTORY-V15';
const AURA_MODEL='@cf/deepgram/aura-2-es';
const RAW_ASSET_BASE='https://raw.githubusercontent.com/karlapower007-ux/Curso-de-ingl-s-teste/fns-digital-human/fns-digital-human/worker/public/assets/';
const OLIVIA_V15_SYSTEM_PROMPT="CRITICAL RULE: You are Olivia, the Spanish teacher. Reply exclusively in Spanish (es-ES). Never inherit Emma's English profile. Do not mix Portuguese or English unless the user explicitly asks for a translation.";

const TURBINES=Object.freeze({
  A:{speaker:'nestor',  locale:'es-ES',region:'España',        gender:'masculina',tier:'regional',encoding:'mp3'},
  B:{speaker:'carina',  locale:'es-ES',region:'España',        gender:'femenina', tier:'regional',encoding:'mp3'},
  C:{speaker:'sirio',   locale:'es-MX',region:'México',        gender:'masculina',tier:'regional',encoding:'mp3'},
  D:{speaker:'estrella',locale:'es-MX',region:'México',        gender:'femenina', tier:'regional',encoding:'mp3'},
  E:{speaker:'javier',  locale:'es-MX',region:'México',        gender:'masculina',tier:'regional',encoding:'mp3'},
  F:{speaker:'celeste', locale:'es-CO',region:'Colombia',      gender:'femenina', tier:'regional',encoding:'mp3'},
  G:{speaker:'aquila',  locale:'es-419',region:'Latinoamérica',gender:'masculina',tier:'regional',encoding:'mp3'},
  H:{speaker:'selena',  locale:'es-419',region:'Latinoamérica',gender:'femenina', tier:'regional',encoding:'mp3'},
  I:{speaker:'alvaro',  locale:'es-ES',region:'España',        gender:'masculina',tier:'regional',encoding:'mp3'},
  J:{speaker:'diana',   locale:'es-ES',region:'España',        gender:'femenina', tier:'regional',encoding:'mp3'},
  K:{speaker:'celeste', locale:'es-CO',region:'Colombia',      gender:'femenina', tier:'hifi',encoding:'linear16',container:'wav'},
  L:{speaker:'estrella',locale:'es-MX',region:'México',        gender:'femenina', tier:'hifi',encoding:'linear16',container:'wav'},
  M:{speaker:'nestor',  locale:'es-ES',region:'España',        gender:'masculina',tier:'hifi',encoding:'linear16',container:'wav'},
  N:{speaker:'diana',   locale:'es-ES',region:'España',        gender:'femenina', tier:'hifi',encoding:'linear16',container:'wav'},
  O:{speaker:'selena',  locale:'es-419',region:'Latinoamérica',gender:'femenina', tier:'hifi',encoding:'linear16',container:'wav'}
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

function isOlivia(body){
  return String(body?.teacher||'').trim().toLowerCase()==='olivia';
}

function normalizeTurbine(value){
  const key=String(value||'K').trim().toUpperCase();
  return TURBINES[key]?key:'K';
}

function normalizeAvatarSlug(value){
  return String(value||'').trim().toLowerCase().replace(/[^a-z0-9_-]/g,'').slice(0,48);
}

function sanitizeText(input){
  return String(input||'')
    .replace(/```[\s\S]*?```/g,' ')
    .replace(/[*_~^#>|`]/g,' ')
    .replace(/[\[\]{}<>]/g,' ')
    .replace(/\s+/g,' ')
    .trim()
    .slice(0,2200);
}

function looksPortuguese(text){
  const s=String(text||'').toLowerCase();
  let pt=0,es=0;
  if(/[ãõçáâêô]/u.test(s))pt+=4;
  if(/[ñ¿¡]/u.test(s))es+=4;
  for(const w of s.match(/\p{L}+/gu)||[]){
    if(['você','voce','não','nao','português','portugues','obrigado','obrigada','também','tambem','estou','quero','preciso','explique','diferença','diferenca','minha','meu'].includes(w))pt++;
    if(['usted','tú','tu','español','espanol','gracias','también','tambien','estoy','quiero','necesito','hoy','ahora'].includes(w))es++;
  }
  return pt>es&&pt>=2;
}

async function runAuraTurbine(env,text,origin,key){
  const cfg=TURBINES[key];
  const input={text,speaker:cfg.speaker,encoding:cfg.encoding};
  if(cfg.container)input.container=cfg.container;

  let raw;
  try{
    raw=await env.AI.run(AURA_MODEL,input,{returnRawResponse:true});
  }catch(error){
    throw new Error('OLIVIA_V7_AURA_RUN_FAILED '+String(error?.message||error));
  }

  if(!(raw instanceof Response)||!raw.ok){
    const detail=raw instanceof Response?await raw.text().catch(()=>''):'';
    throw new Error('OLIVIA_V7_AURA_HTTP_'+(raw instanceof Response?raw.status:502)+' '+detail.slice(0,220));
  }

  const headers=new Headers(raw.headers);
  headers.set('Access-Control-Allow-Origin',origin||'*');
  headers.set('Access-Control-Allow-Methods','POST, OPTIONS, GET');
  headers.set('Access-Control-Allow-Headers','Content-Type, X-FNS-STT-Language');
  headers.set('Cache-Control','no-store');
  if(!headers.get('Content-Type'))headers.set('Content-Type',cfg.tier==='hifi'?'audio/wav':'audio/mpeg');
  headers.set('X-FNS-Voice-Engine','aura-2-es-v7-'+cfg.speaker+(cfg.tier==='hifi'?'-hifi':''));
  headers.set('X-FNS-Voice-Language',cfg.locale);
  headers.set('X-FNS-Voice-Turbine',key);
  headers.set('X-FNS-Voice-Speaker',cfg.speaker);
  headers.set('X-FNS-Voice-Region',cfg.region);
  headers.set('X-FNS-Voice-Gender',cfg.gender);
  headers.set('X-FNS-Turbine-Tier',cfg.tier);
  headers.set('X-FNS-Voice-Guard',OLIVIA_V7_GUARD);
  headers.set('X-FNS-Fallback-Eligible','speechSynthesis');

  return new Response(raw.body,{status:200,headers});
}

async function oliviaV7Tts(request,env,ctx){
  const origin=request.headers.get('Origin')||'*';
  const clone=request.clone();
  const body=await clone.json().catch(()=>({}));

  if(!isOlivia(body))return v6Core.fetch(request,env,ctx);

  const text=sanitizeText(body?.text);
  if(!text){
    return Response.json({ok:false,error:'Texto vacío.'},{status:400,headers:cors(origin)});
  }

  // Portuguese pedagogical explanations keep the already-proven v6 PT voice path.
  // V15 chat itself is strict Spanish; this remains only as a compatibility fallback.
  if(looksPortuguese(text))return v6Core.fetch(request,env,ctx);

  const turbine=normalizeTurbine(body?.voice_turbine);
  try{
    return await runAuraTurbine(env,text,origin,turbine);
  }catch(error){
    const fallbackRequest=new Request(request.url,{
      method:'POST',
      headers:request.headers,
      body:JSON.stringify({...body,text,teacher:'Olivia'})
    });
    const response=await v6Core.fetch(fallbackRequest,env,ctx);
    if(response instanceof Response){
      const headers=new Headers(response.headers);
      headers.set('X-FNS-Voice-Turbine',turbine);
      headers.set('X-FNS-V7-Remote-Fallback','v6-cascade');
      headers.set('X-FNS-Voice-Guard',OLIVIA_V7_GUARD);
      return new Response(response.body,{status:response.status,headers});
    }
    throw error;
  }
}

async function oliviaV15Chat(request,env,ctx){
  const clone=request.clone();
  const body=await clone.json().catch(()=>({}));
  if(!isOlivia(body))return v6Core.fetch(request,env,ctx);

  const forcedBody={
    ...body,
    teacher:'Olivia',
    level:String(body?.level||'A1').slice(0,12),
    accent:'Español neutral',
    input_language:'es-ES',
    input_language_label:'Español',
    system_prompt:OLIVIA_V15_SYSTEM_PROMPT
  };
  const forwarded=new Request(request.url,{
    method:'POST',
    headers:request.headers,
    body:JSON.stringify(forcedBody)
  });
  const response=await strictCore.fetch(forwarded,env,ctx);
  if(!(response instanceof Response))return response;
  const headers=new Headers(response.headers);
  headers.set('X-FNS-V15-Route','olivia-strict-spanish');
  headers.set('X-FNS-Avatar-Language','es-ES');
  return new Response(response.body,{status:response.status,headers});
}

async function assetFetch(env,requestUrl,requestHeaders){
  if(!env?.ASSETS?.fetch)throw new Error('FNS_ASSETS_BINDING_UNAVAILABLE');
  return env.ASSETS.fetch(new Request(requestUrl,{method:'GET',headers:requestHeaders}));
}

function lockOliviaConfig(source={}){
  return {
    ...source,
    name:'Olivia',
    teacher:'Olivia',
    language:'es-ES',
    languageLabel:'Español',
    sttLanguage:'es-ES',
    level:'A1',
    accent:'Español neutral',
    images:{
      closed:RAW_ASSET_BASE+'olivia-fechada.png',
      talking:RAW_ASSET_BASE+'olivia-falando.png',
      open:RAW_ASSET_BASE+'olivia-aberta.png'
    },
    thresholds:{talking:0.15,open:0.60},
    systemPrompt:OLIVIA_V15_SYSTEM_PROMPT,
    ui:{
      ...(source?.ui||{}),
      title:'Olivia',
      subtitle:'Profesora de español',
      placeholder:'Escribe en español…',
      startListening:'Hablar',
      stopListening:'Detener'
    }
  };
}

async function serveAvatarFactory(request,env,slug){
  const originUrl=new URL(request.url);
  const configUrl=new URL('/avatar-config.json',originUrl.origin);
  const configResponse=await assetFetch(env,configUrl.toString(),request.headers);
  if(!configResponse.ok){
    return Response.json({ok:false,error:'Avatar config unavailable',guard:AVATAR_FACTORY_GUARD},{status:503,headers:{'Cache-Control':'no-store'}});
  }

  const catalog=await configResponse.json().catch(()=>null);
  const sourceConfig=catalog?.avatars?.[slug];
  if(!sourceConfig){
    return Response.json({ok:false,error:'Avatar not configured',avatar:slug,guard:AVATAR_FACTORY_GUARD},{status:404,headers:{'Cache-Control':'no-store'}});
  }
  const config=slug==='olivia'?lockOliviaConfig(sourceConfig):sourceConfig;

  const templateUrl=new URL('/avatar.html',originUrl.origin);
  const templateResponse=await assetFetch(env,templateUrl.toString(),request.headers);
  if(!templateResponse.ok){
    return Response.json({ok:false,error:'Avatar entry unavailable',guard:AVATAR_FACTORY_GUARD},{status:503,headers:{'Cache-Control':'no-store'}});
  }

  const bootstrap={
    guard:AVATAR_FACTORY_GUARD,
    schemaVersion:Number(catalog?.schemaVersion||1),
    slug,
    config
  };
  const bootstrapJson=JSON.stringify(bootstrap).replace(/</g,'\\u003c');
  const template=await templateResponse.text();
  const html=template.replace(
    'window.__FNS_AVATAR_BOOTSTRAP__ = null;',
    'window.__FNS_AVATAR_BOOTSTRAP__ = '+bootstrapJson+';'
  );

  const headers=new Headers(templateResponse.headers);
  headers.set('Content-Type','text/html; charset=UTF-8');
  headers.set('Content-Language','es-ES');
  headers.set('Cache-Control','no-store, no-cache, must-revalidate, max-age=0');
  headers.set('Pragma','no-cache');
  headers.set('Expires','0');
  headers.set('Surrogate-Control','no-store');
  headers.set('CDN-Cache-Control','no-store');
  headers.set('X-FNS-Avatar-Route','isolated-v15-spanish-avatar-fix');
  headers.set('X-FNS-Avatar',slug);
  headers.set('X-FNS-Avatar-Language',config.language||'');
  headers.set('X-FNS-Avatar-Guard',AVATAR_FACTORY_GUARD);
  return new Response(html,{status:200,headers});
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);

    if(request.method==='GET'&&url.pathname==='/'){
      const avatar=normalizeAvatarSlug(url.searchParams.get('avatar'));
      if(avatar)return serveAvatarFactory(request,env,avatar);
      if(env?.ASSETS?.fetch)return env.ASSETS.fetch(request);
    }

    if(url.pathname==='/chat'&&request.method==='POST')return oliviaV15Chat(request,env,ctx);
    if(url.pathname==='/tts'&&request.method==='POST')return oliviaV7Tts(request,env,ctx);
    return v6Core.fetch(request,env,ctx);
  }
};

export {TURBINES,OLIVIA_V7_GUARD,AVATAR_FACTORY_GUARD,normalizeTurbine,normalizeAvatarSlug};
