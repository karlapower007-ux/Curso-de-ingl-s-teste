// Rollback deployment marker: restored stable English baseline on 2026-09-16.
// Stable English redeploy marker after rejecting external-key Dual-TTS.
function cors(origin="*") {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}


function sanitizeTextForTTS(input) {
  let text = String(input || "");
  text = text.replace(/```[\s\S]*?```/g, " ");
  text = text.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1");
  text = text.replace(/\/(?:[^\/\n]|\\.){1,160}\//g, " ");
  text = text.replace(/[*_~^#>|`]/g, " ");
  text = text.replace(/[\[\]{}()<>]/g, " ");
  text = text.replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F]/gu, " ");
  text = text.replace(/[^\p{L}\p{M}\p{N}\s.,!?;:\'"\-—–]/gu, " ");
  return text
    .replace(/\s+([.,!?;:])/g, "$1")
    .replace(/([.,!?;:])(?=[\p{L}\p{N}])/gu, "$1 ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function detectLanguage(text) {
  const sample = String(text || "").toLowerCase();
  let pt = 0, es = 0, en = 0;

  if (/[ãõçáâêô]/u.test(sample)) pt += 4;
  if (/[ñ¿¡]/u.test(sample)) es += 4;

  const words = sample.match(/\p{L}+/gu) || [];
  const ptWords = new Set(["não","nao","você","voce","português","portugues","obrigado","obrigada","também","tambem","quero","gostaria","estou","como","porque","para","com","uma","meu","minha","hoje","agora","explique","diferença","diferenca"]);
  const esWords = new Set(["no","usted","tú","tu","español","espanol","gracias","también","tambien","quiero","gustaría","gustaria","estoy","cómo","como","porque","para","con","una","hoy","ahora","hablar","contigo"]);
  const enWords = new Set(["the","you","your","english","thanks","thank","want","would","like","am","are","is","how","what","why","today","now","with","continue","correct"]);

  for (const word of words) {
    if (ptWords.has(word)) pt++;
    if (esWords.has(word)) es++;
    if (enWords.has(word)) en++;
  }

  if (pt > es && pt >= en && pt >= 2) return "pt-BR";
  if (es > pt && es >= en && es >= 2) return "es";
  return "en";
}

function corsAudioHeaders(origin, extra={}) {
  return {
    ...cors(origin),
    "Cache-Control": "no-store",
    ...extra
  };
}

async function auraEmergencyEnglish(env, origin) {
  const emergencyText = "Sorry, my Portuguese voice server is currently busy. Let's practice in English for now.";
  const raw = await env.AI.run(
    "@cf/deepgram/aura-1",
    { text: emergencyText, speaker: "asteria", encoding: "mp3" },
    { returnRawResponse: true }
  );

  if (!(raw instanceof Response) || !raw.ok) {
    const detail = raw instanceof Response ? await raw.text().catch(()=>"") : "";
    return Response.json(
      { ok:false, error:"Emergency Aura fallback failed"+(detail?": "+detail.slice(0,180):"") },
      { status:502, headers:cors(origin) }
    );
  }

  const headers = new Headers(raw.headers);
  for (const [k,v] of Object.entries(corsAudioHeaders(origin, {
    "Content-Type":"audio/mpeg",
    "X-FNS-Voice-Engine":"aura-1-emergency",
    "X-FNS-Voice-Language":"en"
  }))) headers.set(k,v);

  return new Response(raw.body,{status:200,headers});
}

function parseSseData(text) {
  const lines = String(text || "").split(/\r?\n/);
  let last = null;
  for (const line of lines) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload) continue;
    try { last = JSON.parse(payload); } catch {}
  }
  return last;
}

async function gradioAudioFromSpace(opts) {
  const {base, endpointCandidates, dataVariants, engine, spaceName, origin, timeoutMs=7000} = opts;
  const controller = new AbortController();
  const timeout = setTimeout(()=>controller.abort("tts-timeout"), timeoutMs);
  try {
    let chosen = null;
    let eventId = "";
    for (const endpoint of endpointCandidates) {
      for (const data of dataVariants) {
        try {
          const submit = await fetch(base + "/gradio_api/call/" + encodeURIComponent(endpoint), {
            method:"POST",
            headers:{"Content-Type":"application/json"},
            body:JSON.stringify({data}),
            signal:controller.signal
          });
          if (!submit.ok) continue;
          const json = await submit.json().catch(()=>null);
          if (json?.event_id) { chosen = endpoint; eventId = json.event_id; break; }
        } catch (error) { if (controller.signal.aborted) throw error; }
      }
      if (chosen) break;
    }
    if (!chosen || !eventId) throw new Error(spaceName + " did not accept API candidates.");
    const ev = await fetch(base + "/gradio_api/call/" + encodeURIComponent(chosen) + "/" + encodeURIComponent(eventId), {signal:controller.signal});
    if (!ev.ok) throw new Error(spaceName + " event failed: HTTP " + ev.status);
    const payload = parseSseData(await ev.text());
    if (!payload) throw new Error(spaceName + " returned no payload.");
    const list = Array.isArray(payload) ? payload : [payload];
    let ref = null;
    for (const out of list) {
      if (typeof out === "string" && /audio|wav|mp3|flac|ogg|file=/i.test(out)) { ref = out; break; }
      if (out && typeof out === "object") {
        if (typeof out.url === "string") { ref = out.url; break; }
        if (typeof out.path === "string") { ref = out.path; break; }
      }
    }
    if (!ref) throw new Error(spaceName + " returned no audio reference.");
    let audioUrl = ref;
    if (audioUrl.startsWith("/")) audioUrl = base + audioUrl;
    else if (!/^https?:\/\//i.test(audioUrl)) audioUrl = base + "/gradio_api/file=" + encodeURIComponent(audioUrl);
    const audio = await fetch(audioUrl,{signal:controller.signal});
    if (!audio.ok) throw new Error(spaceName + " audio download failed: HTTP " + audio.status);
    const ct = audio.headers.get("content-type") || "";
    if (!ct.startsWith("audio/") && !/octet-stream/i.test(ct)) throw new Error(spaceName + " returned non-audio content: " + ct);
    const headers = new Headers(audio.headers);
    for (const [k,v] of Object.entries(corsAudioHeaders(origin,{
      "X-FNS-Voice-Engine":engine,
      "X-FNS-Voice-Language":"pt-BR",
      "X-FNS-HF-Space":spaceName
    }))) headers.set(k,v);
    return new Response(audio.body,{status:200,headers});
  } finally { clearTimeout(timeout); }
}

function splitTtsChunks(text,maxLen=180) {
  const words=String(text||"").split(/\s+/).filter(Boolean);
  const chunks=[]; let current="";
  for (const word of words) {
    const next=current?current+" "+word:word;
    if (next.length>maxLen && current) { chunks.push(current); current=word; } else current=next;
  }
  if (current) chunks.push(current);
  return chunks;
}

async function googleTranslateTtsPortuguese(text,origin) {
  const buffers=[];
  for (const chunk of splitTtsChunks(text,180)) {
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort("google-tts-timeout"),4500);
    try {
      const url="https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=pt-BR&q="+encodeURIComponent(chunk);
      const r=await fetch(url,{headers:{"User-Agent":"Mozilla/5.0","Accept":"audio/mpeg,*/*"},signal:controller.signal});
      if (!r.ok) throw new Error("Google TTS HTTP "+r.status);
      const ct=r.headers.get("content-type")||"";
      if (!ct.includes("audio") && !ct.includes("mpeg")) throw new Error("Google TTS non-audio response: "+ct);
      buffers.push(new Uint8Array(await r.arrayBuffer()));
    } finally { clearTimeout(timeout); }
  }
  const size=buffers.reduce((n,b)=>n+b.byteLength,0);
  if (!size) throw new Error("Google TTS returned empty audio.");
  const merged=new Uint8Array(size); let offset=0;
  for (const b of buffers) { merged.set(b,offset); offset+=b.byteLength; }
  return new Response(merged,{status:200,headers:corsAudioHeaders(origin,{
    "Content-Type":"audio/mpeg",
    "X-FNS-Voice-Engine":"google-translate-tts-ptbr",
    "X-FNS-Voice-Language":"pt-BR"
  })});
}

async function hfKokoroPortuguese(env, text, origin) {
  const base = "https://wmr-tts-ptbr.hf.space";
  const candidates = ["KOKORO_TTS_API","kokoro_tts_api","predict"];
  const controller = new AbortController();
  const timeout = setTimeout(()=>controller.abort("hf-timeout"),8000);

  try {
    let submit = null;
    let endpoint = null;

    const data = [
      text,
      "Brazilian Portuguese",
      "pf_dora",
      1,
      false,
      false,
      false,
      1.0,
      "Natural (Padrão)",
      true
    ];

    for (const name of candidates) {
      try {
        const r = await fetch(base + "/gradio_api/call/" + encodeURIComponent(name), {
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({data}),
          signal:controller.signal
        });
        if (!r.ok) continue;
        const j = await r.json().catch(()=>null);
        if (j?.event_id) {
          submit = j;
          endpoint = name;
          break;
        }
      } catch (e) {
        if (controller.signal.aborted) throw e;
      }
    }

    if (!submit?.event_id || !endpoint) throw new Error("Hugging Face Kokoro endpoint unavailable.");

    const eventResponse = await fetch(
      base + "/gradio_api/call/" + encodeURIComponent(endpoint) + "/" + encodeURIComponent(submit.event_id),
      { signal:controller.signal }
    );
    if (!eventResponse.ok) throw new Error("Hugging Face event fetch failed: HTTP " + eventResponse.status);

    const sse = await eventResponse.text();
    const payload = parseSseData(sse);
    if (!payload) throw new Error("Hugging Face returned no audio payload.");

    const outputs = Array.isArray(payload) ? payload : [payload];
    let audioRef = null;

    for (const out of outputs) {
      if (typeof out === "string" && /audio|wav|mp3|flac|ogg/i.test(out)) {
        audioRef = out;
        break;
      }
      if (out && typeof out === "object") {
        if (typeof out.url === "string") { audioRef = out.url; break; }
        if (typeof out.path === "string") { audioRef = out.path; break; }
      }
    }

    if (!audioRef) throw new Error("Hugging Face response contained no downloadable audio.");

    let audioUrl = audioRef;
    if (audioUrl.startsWith("/")) audioUrl = base + audioUrl;
    else if (!/^https?:\/\//i.test(audioUrl)) {
      audioUrl = base + "/gradio_api/file=" + encodeURIComponent(audioUrl);
    }

    const audio = await fetch(audioUrl,{signal:controller.signal});
    if (!audio.ok) throw new Error("Hugging Face audio download failed: HTTP " + audio.status);

    const ct = audio.headers.get("content-type") || "";
    if (!ct.startsWith("audio/") && !/octet-stream/i.test(ct)) {
      throw new Error("Hugging Face returned non-audio content: " + ct);
    }

    const headers = new Headers(audio.headers);
    for (const [k,v] of Object.entries(corsAudioHeaders(origin, {
      "X-FNS-Voice-Engine":"hf-kokoro-ptbr",
      "X-FNS-Voice-Language":"pt-BR",
      "X-FNS-HF-Space":"wmr/tts_PTBR"
    }))) headers.set(k,v);

    return new Response(audio.body,{status:200,headers});
  } finally {
    clearTimeout(timeout);
  }
}


async function portugueseWaterfall(env,text,origin) {
  const engines = [
    async()=>hfKokoroPortuguese(env,text,origin),
    async()=>gradioAudioFromSpace({
      base:"https://leomartinsjf-voz-clara-parler-ptbr.hf.space",
      endpointCandidates:["predict","generate","generate_speech","tts"],
      dataVariants:[[text,"Feminina · natural",17],[text,"Feminina · natural"],[text]],
      engine:"hf-parler-ptbr",
      spaceName:"leomartinsjf/voz-clara-parler-ptbr",
      origin,timeoutMs:6500
    }),
    async()=>googleTranslateTtsPortuguese(text,origin),
    async()=>gradioAudioFromSpace({
      base:"https://elielsilva-tts-ptbr.hf.space",
      endpointCandidates:["KOKORO_TTS_API","kokoro_tts_api","predict","generate"],
      dataVariants:[
        [text,"Brazilian Portuguese","pf_dora",1,false,false],
        [text,"Brazilian Portuguese","pf_dora",1,false,false,false,1.0,"Natural (Padrão)",true],
        [text]
      ],
      engine:"hf-kokoro-ptbr-backup",
      spaceName:"elielsilva/tts_PTBR",
      origin,timeoutMs:6500
    })
  ];
  const failures=[];
  for (let i=0;i<engines.length;i++) {
    try {
      const response=await engines[i]();
      if (response instanceof Response && response.ok) return response;
      failures.push("plan-"+(i+1)+": non-ok response");
    } catch(error) { failures.push("plan-"+(i+1)+": "+String(error?.message||error)); }
  }
  const emergency=await auraEmergencyEnglish(env,origin);
  const headers=new Headers(emergency.headers);
  headers.set("X-FNS-PT-Fallbacks-Failed",String(failures.length));
  return new Response(emergency.body,{status:emergency.status,headers});
}

function extractText(result) {
  if (!result) return "";
  if (typeof result === "string") return result.trim();
  if (typeof result.response === "string") return result.response.trim();
  if (typeof result.output_text === "string") return result.output_text.trim();
  if (result.choices?.[0]?.message?.content) {
    const c = result.choices[0].message.content;
    return typeof c === "string" ? c.trim() : "";
  }
  if (Array.isArray(result.output)) {
    const parts = [];
    for (const item of result.output) {
      if (typeof item?.content === "string") parts.push(item.content);
      if (Array.isArray(item?.content)) {
        for (const c of item.content) {
          if (typeof c?.text === "string") parts.push(c.text);
          else if (typeof c === "string") parts.push(c);
        }
      }
    }
    if (parts.length) return parts.join("\n").trim();
  }
  return "";
}

function systemPrompt({ teacher="Emma", level="A1", accent="American" } = {}) {
  return `Você é Emma, uma professora e amiga brilhante. Você é fluente em Inglês, Português e Espanhol. Adapte-se instantaneamente ao idioma que o usuário falar. Mantenha conversas profundas sobre qualquer assunto. Quando solicitado, atue como professora e corrija os erros gramaticais ou de pronúncia do usuário com didática e clareza.

Regras:
- Responda no idioma predominante do usuário, salvo se ele pedir outro idioma.
- Em prática de inglês, permaneça em inglês e explique em português somente quando solicitado.
- Seja natural, clara, inteligente, didática e concisa o suficiente para conversa por voz.
- Adapte vocabulário e complexidade ao nível CEFR do aluno.
- Não invente fatos quando não tiver certeza.
- Evite Markdown pesado em respostas faladas.
- Nome: ${teacher}. Perfil de sotaque inglês: ${accent}. Nível CEFR: ${level}.`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "*";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(origin) });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json(
        {
          ok: true,
          service: "FNS Voice Gateway",
          version: "2026-09-16.6-sanitized-waterfall",
          stt: "@cf/openai/whisper-large-v3-turbo",
          tts: "Aura-1 EN + Aura-2-es ES + PT-BR waterfall: HF Kokoro > HF Parler > Google TTS > HF backup > Aura emergency",
          chat: "@cf/openai/gpt-oss-120b"
        },
        { headers: { ...cors(origin), "Cache-Control": "no-store" } }
      );
    }

    if (url.pathname === "/stt" && request.method === "POST") {
      try {
        const buffer = await request.arrayBuffer();
        if (!buffer.byteLength) {
          return Response.json(
            { ok: false, error: "Áudio vazio." },
            { status: 400, headers: cors(origin) }
          );
        }

        const result = await env.AI.run("@cf/openai/whisper-large-v3-turbo", {
          audio: toBase64(buffer),
          task: "transcribe",
          vad_filter: true,
          condition_on_previous_text: false
        });

        const text = String(result?.text || result?.transcription_info?.text || "").trim();

        return Response.json(
          { ok: true, text },
          { headers: { ...cors(origin), "Cache-Control": "no-store" } }
        );
      } catch (error) {
        return Response.json(
          { ok: false, error: String(error?.message || error) },
          { status: 500, headers: cors(origin) }
        );
      }
    }

    if (url.pathname === "/tts" && request.method === "POST") {
      try {
        const body = await request.json().catch(() => ({}));
        const sourceText = String(body?.text || body?.prompt || "");
        const text = sanitizeTextForTTS(sourceText);
        const teacher = String(body?.teacher || "Emma");

        if (!text) {
          return Response.json({ ok:false, error:"Texto vazio." }, { status:400, headers:cors(origin) });
        }
        if (text.length > 1200) {
          return Response.json({ ok:false, error:"Texto muito grande para uma fala." }, { status:413, headers:cors(origin) });
        }

        const language = detectLanguage(text);

        if (language === "pt-BR") {
          try {
            return await portugueseWaterfall(env,text,origin);
          } catch (error) {
            return await auraEmergencyEnglish(env,origin);
          }
        }

        if (language === "es") {
          const raw = await env.AI.run(
            "@cf/deepgram/aura-2-es",
            { text, speaker:"celeste", encoding:"mp3" },
            { returnRawResponse:true }
          );

          if (!(raw instanceof Response) || !raw.ok) {
            const detail = raw instanceof Response ? await raw.text().catch(()=>"") : "";
            return Response.json(
              { ok:false, error:"Aura Spanish TTS falhou"+(detail?": "+detail.slice(0,180):"") },
              { status:502, headers:cors(origin) }
            );
          }

          const headers = new Headers(raw.headers);
          for (const [k,v] of Object.entries(corsAudioHeaders(origin,{
            "Content-Type":"audio/mpeg",
            "X-FNS-Voice-Engine":"aura-2-es",
            "X-FNS-Voice-Language":"es"
          }))) headers.set(k,v);

          return new Response(raw.body,{status:200,headers});
        }

        const speakerByTeacher = {
          Emma:"asteria", Olivia:"luna", Sophia:"athena", Charlotte:"hera",
          James:"orion", Daniel:"perseus", William:"helios", Ethan:"arcas", Noah:"zeus"
        };
        const speaker = speakerByTeacher[teacher] || "asteria";

        const raw = await env.AI.run(
          "@cf/deepgram/aura-1",
          { text, speaker, encoding:"mp3" },
          { returnRawResponse:true }
        );

        if (!(raw instanceof Response) || !raw.ok) {
          const detail = raw instanceof Response ? await raw.text().catch(()=>"") : "";
          return Response.json(
            { ok:false, error:"Aura TTS falhou"+(detail?": "+detail.slice(0,180):"") },
            { status:502, headers:cors(origin) }
          );
        }

        const headers = new Headers(raw.headers);
        for (const [k,v] of Object.entries(corsAudioHeaders(origin,{
          "Content-Type":"audio/mpeg",
          "X-FNS-Voice-Engine":"aura-1",
          "X-FNS-Voice-Speaker":speaker,
          "X-FNS-Voice-Language":"en"
        }))) headers.set(k,v);

        return new Response(raw.body,{status:200,headers});
      } catch (error) {
        return Response.json(
          { ok:false, error:String(error?.message || error) },
          { status:500, headers:cors(origin) }
        );
      }
    }

    if (url.pathname === "/chat" && request.method === "POST") {
      try {
        const body = await request.json().catch(() => ({}));
        const message = String(body?.message || "").trim();
        const teacher = String(body?.teacher || "Emma");
        const level = String(body?.level || "A1");
        const accent = String(body?.accent || "American");
        const history = Array.isArray(body?.history) ? body.history.slice(-8) : [];

        if (!message) {
          return Response.json(
            { ok: false, error: "Mensagem vazia." },
            { status: 400, headers: cors(origin) }
          );
        }

        const messages = [
          { role: "system", content: systemPrompt({ teacher, level, accent }) },
          ...history
            .filter(x => x && ["user","assistant"].includes(x.role) && typeof x.content === "string")
            .map(x => ({ role: x.role, content: x.content.slice(0, 2000) })),
          { role: "user", content: message }
        ];

        const result = await env.AI.run("@cf/openai/gpt-oss-120b", {
          messages,
          max_tokens: 220,
          temperature: 0.55
        });

        const reply = extractText(result) || "Could you say that again?";

        return Response.json(
          {
            ok: true,
            teacher,
            model: "@cf/openai/gpt-oss-120b",
            reply
          },
          { headers: { ...cors(origin), "Cache-Control": "no-store" } }
        );
      } catch (error) {
        return Response.json(
          { ok: false, error: String(error?.message || error) },
          { status: 500, headers: cors(origin) }
        );
      }
    }

    return Response.json(
      { error: "Use GET /health, POST /stt, POST /tts ou POST /chat." },
      { status: 404, headers: cors(origin) }
    );
  }
};
