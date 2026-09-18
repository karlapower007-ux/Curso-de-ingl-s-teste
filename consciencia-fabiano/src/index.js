const OWNER_TOKEN_HASH = "4df264da389c491ea6b9a57f10715108246440ae738f9378b65a64a4c4ce4fc0";
const RENDER_BASE = "https://avatar-fabiano-api.onrender.com";
const VERSION = "2026-09-18.1";

const enc = new TextEncoder();

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extra,
    },
  });
}

function securityHeaders(headers = new Headers()) {
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Permissions-Policy", "camera=(), geolocation=()");
  headers.set("Cache-Control", "no-store");
  return headers;
}

function hex(bytes) {
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function sha256(text) {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}

function rawToken(request) {
  const auth = request.headers.get("Authorization") || "";
  if (/^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, "").trim();
  return (request.headers.get("X-FNS-Owner-Token") || "").trim();
}

async function authorized(request) {
  const token = rawToken(request);
  if (!token || token.length < 30) return false;
  return (await sha256(token)) === OWNER_TOKEN_HASH;
}

function requireAuthResponse() {
  return json({ ok: false, code: "AUTH_REQUIRED", message: "Acesso privado." }, 401);
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

async function renderFetch(path, init = {}, timeoutMs = 70000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
  try {
    return await fetch(RENDER_BASE + path, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fallbackBrain(env, body) {
  const history = Array.isArray(body?.historico) ? body.historico.slice(-20) : [];
  const messages = [
    {
      role: "system",
      content:
        "Você é a Consciência do Fabiano, um interlocutor enciclopédico, analítico e respeitoso. " +
        "Responda SEMPRE em português brasileiro, mesmo quando a fonte ou pergunta mencionar inglês. " +
        "Quando a biblioteca RAG estiver indisponível, diga claramente que a resposta foi produzida sem consulta aos PDFs. " +
        "Não invente páginas, citações, autores ou referências. Diferencie fato, interpretação e hipótese. " +
        "Seja útil para religião, filosofia, história, arte, maçonaria, ciência, literatura e assuntos gerais."
    },
    ...history.map(x => ({
      role: x.role === "assistant" ? "assistant" : "user",
      content: String(x.content || "").slice(0, 1800)
    })),
    { role: "user", content: String(body?.pergunta || "").slice(0, 8000) }
  ];
  const result = await env.AI.run("@cf/openai/gpt-oss-120b", {
    messages,
    temperature: 0.35,
    max_tokens: 900
  });
  const reply =
    result?.response ||
    result?.result?.response ||
    result?.choices?.[0]?.message?.content ||
    "A biblioteca está temporariamente indisponível.";
  return {
    resposta:
      String(reply).trim() +
      "\n\n[Resposta de contingência: a biblioteca de PDFs não foi consultada nesta resposta.]",
    audio_url: null,
    fontes: [],
    fallback: true,
    provider: "cloudflare-workers-ai"
  };
}

async function handleApi(request, env, url) {
  if (url.pathname === "/api/login" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const candidate = String(body?.token || "");
    const ok = candidate.length >= 30 && (await sha256(candidate)) === OWNER_TOKEN_HASH;
    return json({ ok }, ok ? 200 : 401);
  }

  if (!(await authorized(request))) return requireAuthResponse();

  if (url.pathname === "/api/status" && request.method === "GET") {
    let backend = null;
    try {
      const r = await renderFetch("/health", {}, 20000);
      backend = r.ok ? await r.json() : { ok: false, status: r.status };
    } catch (error) {
      backend = { ok: false, sleeping_or_unreachable: true, error: String(error?.message || error) };
    }
    return json({ ok: true, service: "Consciência do Fabiano", version: VERSION, backend });
  }

  if (url.pathname === "/api/chat" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const pergunta = String(body?.pergunta || "").trim();
    if (pergunta.length < 2) return json({ ok: false, message: "Pergunta vazia." }, 400);

    try {
      const r = await renderFetch("/perguntar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pergunta,
          historico: Array.isArray(body?.historico) ? body.historico.slice(-20) : []
        })
      });
      if (!r.ok) {
        const detail = await r.text().catch(() => "");
        throw new Error("Render " + r.status + " " + detail.slice(0, 300));
      }
      const data = await r.json();
      if (data?.audio_url && /^\/audio\//.test(data.audio_url)) {
        data.audio_url = "/api" + data.audio_url;
      }
      data.fallback = false;
      data.provider = "render-rag";
      return json(data);
    } catch (error) {
      try {
        return json(await fallbackBrain(env, body));
      } catch (fallbackError) {
        return json({
          ok: false,
          message: "O cérebro está temporariamente indisponível.",
          render_error: String(error?.message || error),
          fallback_error: String(fallbackError?.message || fallbackError)
        }, 503);
      }
    }
  }

  if (url.pathname.startsWith("/api/audio/") && request.method === "GET") {
    const file = url.pathname.split("/").pop();
    if (!/^[a-f0-9]{32}\.mp3$/i.test(file || "")) return json({ ok: false }, 400);
    try {
      const r = await renderFetch("/audio/" + file, {}, 45000);
      if (!r.ok) return json({ ok: false, message: "Áudio indisponível." }, r.status);
      return new Response(r.body, {
        status: 200,
        headers: {
          "Content-Type": r.headers.get("Content-Type") || "audio/mpeg",
          "Cache-Control": "private, max-age=300"
        }
      });
    } catch (error) {
      return json({ ok: false, message: String(error?.message || error) }, 502);
    }
  }

  if (url.pathname === "/api/stt" && request.method === "POST") {
    try {
      const buffer = await request.arrayBuffer();
      if (!buffer.byteLength) return json({ ok: false, message: "Áudio vazio." }, 400);
      const result = await env.AI.run("@cf/openai/whisper-large-v3-turbo", {
        audio: toBase64(buffer),
        task: "transcribe",
        language: "pt",
        vad_filter: true,
        condition_on_previous_text: false
      });
      const text = String(result?.text || result?.transcription_info?.text || "").trim();
      return json({ ok: true, text, language: "pt-BR" });
    } catch (error) {
      return json({ ok: false, message: String(error?.message || error) }, 503);
    }
  }

  if (url.pathname === "/api/admin/upload-pdf" && request.method === "POST") {
    try {
      const headers = new Headers();
      const ct = request.headers.get("Content-Type");
      if (ct) headers.set("Content-Type", ct);
      headers.set("X-FNS-Owner-Token", rawToken(request));
      const r = await renderFetch("/admin/upload-pdf", {
        method: "POST",
        headers,
        body: request.body
      }, 120000);
      const text = await r.text();
      return new Response(text, {
        status: r.status,
        headers: { "Content-Type": r.headers.get("Content-Type") || "application/json", "Cache-Control": "no-store" }
      });
    } catch (error) {
      return json({ ok: false, message: "Falha ao enviar PDF: " + String(error?.message || error) }, 502);
    }
  }

  if (url.pathname === "/api/admin/livros" && request.method === "GET") {
    try {
      const r = await renderFetch("/admin/livros", {
        headers: { "X-FNS-Owner-Token": rawToken(request) }
      }, 60000);
      return new Response(await r.text(), {
        status: r.status,
        headers: { "Content-Type": r.headers.get("Content-Type") || "application/json", "Cache-Control": "no-store" }
      });
    } catch (error) {
      return json({ ok: false, message: String(error?.message || error) }, 502);
    }
  }

  if (url.pathname === "/api/admin/reindex" && request.method === "POST") {
    try {
      const r = await renderFetch("/admin/reindex", {
        method: "POST",
        headers: { "X-FNS-Owner-Token": rawToken(request), "Content-Type": "application/json" },
        body: "{}"
      }, 180000);
      return new Response(await r.text(), {
        status: r.status,
        headers: { "Content-Type": r.headers.get("Content-Type") || "application/json", "Cache-Control": "no-store" }
      });
    } catch (error) {
      return json({ ok: false, message: String(error?.message || error) }, 502);
    }
  }

  if (url.pathname === "/api/admin/delete-pdf" && request.method === "POST") {
    try {
      const body = await request.text();
      const r = await renderFetch("/admin/delete-pdf", {
        method: "POST",
        headers: { "X-FNS-Owner-Token": rawToken(request), "Content-Type": "application/json" },
        body
      }, 60000);
      return new Response(await r.text(), {
        status: r.status,
        headers: { "Content-Type": r.headers.get("Content-Type") || "application/json", "Cache-Control": "no-store" }
      });
    } catch (error) {
      return json({ ok: false, message: String(error?.message || error) }, 502);
    }
  }

  return json({ ok: false, message: "Rota não encontrada." }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({ ok: true, service: "Consciência do Fabiano", version: VERSION });
    }

    if (url.pathname.startsWith("/api/")) return handleApi(request, env, url);

    if (url.pathname === "/" || url.pathname === "/admin") {
      const assetUrl = new URL("/index.html", request.url);
      const response = await env.ASSETS.fetch(new Request(assetUrl.toString(), { method: "GET" }));
      const headers = securityHeaders(new Headers(response.headers));
      return new Response(response.body, { status: response.status, headers });
    }

    return env.ASSETS.fetch(request);
  }
};
