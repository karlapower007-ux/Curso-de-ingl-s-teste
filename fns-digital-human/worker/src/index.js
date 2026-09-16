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


function sanitizeForSpeech(input) {
  let text = String(input || "");

  // Preserve the visible label of Markdown links, drop the URL.
  text = text.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1");

  // Remove fenced and inline-code markers while preserving human-readable words.
  text = text.replace(/```[\s\S]*?```/g, " ");
  text = text.replace(/`([^\`]*)`/g, "$1");

  // Remove common Markdown / formatting characters.
  text = text.replace(/[*_~^#>|]/g, " ");

  // Remove bracket/brace delimiters but keep any natural words inside.
  text = text.replace(/[\[\]{}<>]/g, " ");

  // Remove emoji / pictographic symbols, flags, dingbats and variation selectors.
  text = text.replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F]/gu, " ");

  // Keep letters/numbers from any language, whitespace, apostrophes and normal speech punctuation.
  text = text.replace(/[^\p{L}\p{M}\p{N}\s.,!?;:'"()\-—–]/gu, " ");

  // Normalize punctuation/spacing so Aura receives clean natural language.
  text = text
    .replace(/\s+([.,!?;:])/g, "$1")
    .replace(/([.,!?;:])(?=[\p{L}\p{N}])/gu, "$1 ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();

  return text;
}


function detectSpeechLanguage(text, requested="") {
  const explicit = String(requested || "").toLowerCase();
  if (explicit.startsWith("pt")) return "pt-BR";
  if (explicit.startsWith("es")) return "es-ES";
  if (explicit.startsWith("en")) return "en";

  const sample = String(text || "").toLowerCase();

  let pt = 0;
  let es = 0;
  let en = 0;

  if (/[ãõçáâêô]/u.test(sample)) pt += 3;
  if (/[ñ¿¡]/u.test(sample)) es += 3;

  const ptWords = ["olá","ola","você","voce","não","nao","estou","quero","obrigado","obrigada","português","portugues","também","tambem","agora","hoje","tudo","bem","meu","minha","seu","sua","preciso","gostaria","falar","fala","qual","porque","como"];
  const esWords = ["hola","usted","tú","tu","no","estoy","quiero","gracias","español","espanol","también","tambien","ahora","hoy","todo","bien","mi","mío","mio","necesito","gustaría","gustaria","hablar","habla","qué","que","cómo","como"];
  const enWords = ["hello","hi","you","your","the","is","are","am","i","my","want","need","today","now","thanks","thank","how","what","why","english"];

  const words = sample.match(/\p{L}+/gu) || [];
  for (const w of words) {
    if (ptWords.includes(w)) pt += 1;
    if (esWords.includes(w)) es += 1;
    if (enWords.includes(w)) en += 1;
  }

  if (pt > es && pt >= en && pt >= 2) return "pt-BR";
  if (es > pt && es >= en && es >= 2) return "es-ES";
  return "en";
}

function latencyHeaders(startedAt) {
  return { "X-FNS-Latency-Ms": String(Math.max(0, Math.round(performance.now() - startedAt))) };
}

function systemPrompt({ teacher="Emma", level="A1", accent="American" } = {}) {
  return `You are Emma, a brilliant, hyper-realistic private tutor for Estudos Profundos FNS Idiomas.
You are fluent in English, Brazilian Portuguese, and Spanish.
Your vocabulary can be broad, academic, and precise, but you always explain ideas clearly and adapt to the student's level.
You have broad general knowledge across humanities, philosophy, history, literature, science, technology, religion, esoteric traditions, culture, and everyday conversation.
When you are uncertain, say so instead of inventing facts.

Teaching behavior:
- Match the user's language unless they explicitly ask you to use another language.
- If the user asks for English immersion, stay in English.
- If the user asks for Portuguese, answer naturally in Brazilian Portuguese.
- If the user asks for Spanish, answer naturally in Spanish.
- When the user requests strict teaching, immediately correct grammar mistakes, propose stronger vocabulary, and explain the correction clearly.
- For language practice, first respond to meaning, then correct errors when useful.
- Be natural, conversational, warm, intelligent, and concise enough for spoken dialogue.
- Usually answer in 1-4 sentences unless the user requests a detailed explanation.
- Ask at most one main follow-up question at a time.
- Avoid markdown-heavy formatting in spoken answers.
- Do not read formatting symbols aloud.
- Do not claim certainty when evidence is unclear.

Teacher profile:
- Name: ${teacher}
- Accent preference for English: ${accent}
- Student CEFR level: ${level}`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "*";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(origin) });
    }

    if (request.method === "GET" && url.pathname === "/health" && !url.searchParams.get("qa")) {
      return Response.json(
        {
          ok: true,
          service: "FNS Voice Gateway",
          version: "2026-09-16.1-native-language-routing",
          stt: "@cf/openai/whisper-large-v3-turbo",
          tts: "English Aura-1 + Spanish Aura-2-es + Portuguese xAI Grok TTS pt-BR",
          chat: "@cf/openai/gpt-oss-120b"
        },
        { headers: { ...cors(origin), "Cache-Control": "no-store" } }
      );
    }

    if (request.method === "GET" && url.pathname === "/health" && url.searchParams.get("qa") === "language") {
      try {
        const phrase = "Olá, eu gostaria de praticar português com você hoje.";

        const generated = await env.AI.run("xai/grok-tts", {
          text: phrase,
          voice_id: "ara",
          language: "pt-BR",
          text_normalization: true,
          output_format: { codec: "mp3", sample_rate: 24000, bit_rate: 128000 }
        });

        const audioUrl = generated?.result?.audio || generated?.audio || "";
        if (!audioUrl) throw new Error("PT-BR TTS returned no audio URL.");

        const audioResponse = await fetch(audioUrl);
        if (!audioResponse.ok) throw new Error("PT-BR audio fetch failed: HTTP " + audioResponse.status);
        const audioBuffer = await audioResponse.arrayBuffer();

        const stt = await env.AI.run("@cf/openai/whisper-large-v3-turbo", {
          audio: toBase64(audioBuffer),
          task: "transcribe",
          vad_filter: true,
          condition_on_previous_text: false,
          initial_prompt: "The speaker may use English, Brazilian Portuguese, Spanish, or switch between them. Transcribe the spoken language faithfully; do not translate."
        });

        const transcript = String(stt?.text || stt?.transcription_info?.text || "").trim();
        const detected = String(stt?.language || stt?.transcription_info?.language || detectSpeechLanguage(transcript));

        return Response.json({
          ok: true,
          test: "pt-BR roundtrip",
          tts_model: "xai/grok-tts",
          tts_language: "pt-BR",
          source: phrase,
          transcript,
          detected_language: detected,
          transcript_has_portuguese: detectSpeechLanguage(transcript) === "pt-BR",
          audio_bytes: audioBuffer.byteLength
        }, { headers: { ...cors(origin), "Cache-Control": "no-store" } });
      } catch (error) {
        return Response.json(
          { ok: false, test: "pt-BR roundtrip", error: String(error?.message || error) },
          { status: 500, headers: { ...cors(origin), "Cache-Control": "no-store" } }
        );
      }
    }

    if (url.pathname === "/stt" && request.method === "POST") {
      const startedAt = performance.now();
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
          condition_on_previous_text: false,
          initial_prompt: "The speaker may use English, Brazilian Portuguese, Spanish, or switch between them. Transcribe the spoken language faithfully; do not translate."
        });

        const text = String(result?.text || result?.transcription_info?.text || "").trim();
        const detectedLanguage = String(result?.language || result?.transcription_info?.language || detectSpeechLanguage(text));

        return Response.json(
          { ok: true, text, language: detectedLanguage },
          { headers: { ...cors(origin), "Cache-Control": "no-store", ...latencyHeaders(startedAt) } }
        );
      } catch (error) {
        return Response.json(
          { ok: false, error: String(error?.message || error) },
          { status: 500, headers: cors(origin) }
        );
      }
    }

    if (url.pathname === "/tts" && request.method === "POST") {
      const startedAt = performance.now();
      try {
        const body = await request.json().catch(() => ({}));
        const sourceText = String(body?.text || body?.prompt || "");
        const text = sanitizeForSpeech(sourceText);
        const teacher = String(body?.teacher || "Emma");
        const language = detectSpeechLanguage(text, body?.language || body?.lang || "");

        if (!text) {
          return Response.json(
            { ok: false, error: "Texto vazio." },
            { status: 400, headers: cors(origin) }
          );
        }

        if (text.length > 1200) {
          return Response.json(
            { ok: false, error: "Texto muito grande para uma fala." },
            { status: 413, headers: cors(origin) }
          );
        }

        const speakerByTeacher = {
          Emma: "asteria",
          Olivia: "luna",
          Sophia: "athena",
          Charlotte: "hera",
          James: "orion",
          Daniel: "perseus",
          William: "helios",
          Ethan: "arcas",
          Noah: "zeus"
        };

        let speaker = speakerByTeacher[teacher] || "asteria";
        let voiceModel = "@cf/deepgram/aura-1";
        let raw;

        if (language === "es-ES") {
          // Native Spanish route.
          voiceModel = "@cf/deepgram/aura-2-es";
          speaker = "celeste";
          raw = await env.AI.run(
            voiceModel,
            { text, speaker, encoding: "mp3" },
            { returnRawResponse: true }
          );
        } else if (language === "pt-BR") {
          // Native Brazilian Portuguese route through Cloudflare's unified AI binding.
          // Grok TTS explicitly supports pt-BR and avoids English phonetics.
          voiceModel = "xai/grok-tts";
          speaker = "ara";

          const generated = await env.AI.run(voiceModel, {
            text,
            voice_id: speaker,
            language: "pt-BR",
            text_normalization: true,
            output_format: { codec: "mp3", sample_rate: 24000, bit_rate: 128000 }
          });

          const audioUrl = generated?.result?.audio || generated?.audio || "";
          if (!audioUrl) {
            throw new Error("Portuguese TTS did not return an audio URL.");
          }

          raw = await fetch(audioUrl);
        } else {
          raw = await env.AI.run(
            voiceModel,
            { text, speaker, encoding: "mp3" },
            { returnRawResponse: true }
          );
        }
        if (!(raw instanceof Response)) {
          return Response.json(
            { ok: false, error: "O mecanismo de voz não retornou uma resposta de áudio." },
            { status: 502, headers: cors(origin) }
          );
        }

        if (!raw.ok) {
          const detail = await raw.text().catch(() => "");
          return Response.json(
            { ok: false, error: "TTS falhou: HTTP " + raw.status + (detail ? " - " + detail.slice(0, 220) : "") },
            { status: 502, headers: cors(origin) }
          );
        }

        const headers = new Headers(raw.headers);
        for (const [k, v] of Object.entries(cors(origin))) headers.set(k, v);
        headers.set("Content-Type", "audio/mpeg");
        headers.set("Cache-Control", "no-store");
        headers.set("X-FNS-Voice-Engine", voiceModel);
        headers.set("X-FNS-Voice-Speaker", speaker);
        headers.set("X-FNS-Voice-Language", language);
        headers.set("X-FNS-Text-Sanitized", sourceText === text ? "0" : "1");
        headers.set("X-FNS-Latency-Ms", String(Math.max(0, Math.round(performance.now() - startedAt))));

        return new Response(raw.body, {
          status: 200,
          headers
        });
      } catch (error) {
        return Response.json(
          { ok: false, error: String(error?.message || error) },
          { status: 500, headers: cors(origin) }
        );
      }
    }

    if (url.pathname === "/chat" && request.method === "POST") {
      const startedAt = performance.now();
      try {
        const body = await request.json().catch(() => ({}));
        const message = String(body?.message || "").trim();
        const teacher = String(body?.teacher || "Emma");
        const level = String(body?.level || "A1");
        const accent = String(body?.accent || "American");
        const history = Array.isArray(body?.history) ? body.history.slice(-6) : [];

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
          max_tokens: 180,
          temperature: 0.5
        });

        const reply = extractText(result) || "Could you say that again?";
        const speech = sanitizeForSpeech(reply) || "Could you say that again?";
        const responseLanguage = detectSpeechLanguage(speech, body?.language || "");

        return Response.json(
          {
            ok: true,
            teacher,
            model: "@cf/openai/gpt-oss-120b",
            reply,
            speech,
            language: responseLanguage
          },
          { headers: { ...cors(origin), "Cache-Control": "no-store", ...latencyHeaders(startedAt) } }
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
