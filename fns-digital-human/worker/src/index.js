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

function systemPrompt({ teacher="Emma", level="A1", accent="British" } = {}) {
  return `You are ${teacher}, a warm, natural English teacher for Estudos Profundos FNS Idiomas.
Accent/profile: ${accent} English.
Student CEFR level: ${level}.

Rules:
- Speak mainly in English.
- Adapt vocabulary and sentence length to the CEFR level.
- Be conversational, not robotic.
- Usually respond in 1-4 sentences.
- Ask at most one main follow-up question at a time.
- Correct only useful mistakes, briefly and gently.
- First respond to meaning, then correct if needed.
- Keep the conversation moving naturally.
- Do not mention being an AI unless directly asked.
- Avoid markdown-heavy formatting in spoken replies.
- If the user asks for Portuguese explanation, you may briefly explain in Brazilian Portuguese.`;
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
          version: "2026-09-15.2",
          stt: "@cf/openai/whisper-large-v3-turbo",
          tts: "@cf/deepgram/aura-1",
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
          language: "en",
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
        const text = String(body?.text || body?.prompt || "").trim();
        const teacher = String(body?.teacher || "Emma");

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

        const speaker = speakerByTeacher[teacher] || "asteria";

        const raw = await env.AI.run(
          "@cf/deepgram/aura-1",
          {
            text,
            speaker,
            encoding: "mp3"
          },
          {
            returnRawResponse: true
          }
        );

        if (!(raw instanceof Response)) {
          return Response.json(
            { ok: false, error: "O mecanismo de voz não retornou uma resposta de áudio." },
            { status: 502, headers: cors(origin) }
          );
        }

        if (!raw.ok) {
          const detail = await raw.text().catch(() => "");
          return Response.json(
            { ok: false, error: "Aura TTS falhou: HTTP " + raw.status + (detail ? " - " + detail.slice(0, 220) : "") },
            { status: 502, headers: cors(origin) }
          );
        }

        const headers = new Headers(raw.headers);
        for (const [k, v] of Object.entries(cors(origin))) headers.set(k, v);
        headers.set("Content-Type", "audio/mpeg");
        headers.set("Cache-Control", "no-store");
        headers.set("X-FNS-Voice-Engine", "aura-1");
        headers.set("X-FNS-Voice-Speaker", speaker);

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
      try {
        const body = await request.json().catch(() => ({}));
        const message = String(body?.message || "").trim();
        const teacher = String(body?.teacher || "Emma");
        const level = String(body?.level || "A1");
        const accent = String(body?.accent || "British");
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
