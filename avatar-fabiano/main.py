import os
import re
import uuid
import hashlib
import hmac
from contextlib import asynccontextmanager
from pathlib import Path
from typing import List, Optional

import chromadb
import edge_tts
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, UploadFile, File, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from pypdf import PdfReader
from google import genai
from google.genai import types

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
LIVROS_DIR = BASE_DIR / "livros"
DATA_ROOT = Path(os.getenv("DATA_ROOT", str(BASE_DIR / "data")))
CHROMA_DIR = DATA_ROOT / "chroma"
AUDIOS_DIR = DATA_ROOT / "audios"

for pasta in (STATIC_DIR, LIVROS_DIR, CHROMA_DIR, AUDIOS_DIR):
    pasta.mkdir(parents=True, exist_ok=True)

GOOGLE_API_KEY = (os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY") or "").strip()
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.8-flash").strip()
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "gemini-embedding-2").strip()
EMBEDDING_DIM = int(os.getenv("EMBEDDING_DIM", "768"))
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "").strip()
OWNER_TOKEN_HASH = os.getenv(
    "OWNER_TOKEN_HASH",
    "37ae863d0508e0d693e26f73ae5db81e0c60747d3870c0f8c4498513ebd0c8cb",
).strip().lower()
TTS_VOICE = os.getenv("TTS_VOICE", "pt-BR-AntonioNeural").strip()
TOP_K = int(os.getenv("RAG_TOP_K", "5"))
MAX_CONTEXT_CHARS = int(os.getenv("MAX_CONTEXT_CHARS", "18000"))
AUTO_INDEX_ON_STARTUP = os.getenv("AUTO_INDEX_ON_STARTUP", "1").lower() in {"1", "true", "yes", "on"}
DEFAULT_MAIN_SITE = "https://estudos-profundos-fns.karlapower007.chatgpt.site"
CONSCIENCIA_SITE = "https://consciencia-fabiano.karlapower007.workers.dev"
DEFAULT_CORS = f"{DEFAULT_MAIN_SITE},{CONSCIENCIA_SITE}"
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", DEFAULT_CORS).split(",")
    if origin.strip()
]

genai_client = genai.Client(api_key=GOOGLE_API_KEY) if GOOGLE_API_KEY else None

chroma = chromadb.PersistentClient(path=str(CHROMA_DIR))
collection = chroma.get_or_create_collection(
    name="memoria_avatar_fabiano",
    metadata={"hnsw:space": "cosine"},
)

SYSTEM_PROMPT = """
Você é a Consciência do Fabiano: uma biblioteca viva, interlocutor enciclopédico e parceiro de reflexão pessoal.

IDENTIDADE:
- Converse SEMPRE em português brasileiro.
- Você pode consultar PDFs em português, inglês ou outros idiomas.
- Quando a fonte estiver em outro idioma, compreenda o original internamente e explique em português.
- Atue com amplitude temática: religião, filosofia, história, maçonaria, arte, literatura, ciência e assuntos gerais.

REGRAS:
1. Baseie a análise primariamente nos trechos recuperados da biblioteca.
2. Preserve e informe arquivo/livro e página quando esses dados estiverem disponíveis.
3. Não invente citações, páginas, capítulos, datas, autores ou referências.
4. Diferencie fato documental, interpretação, hipótese e ausência de evidência.
5. Se a biblioteca não contiver material suficiente, diga isso claramente.
6. Ao traduzir uma ideia de fonte estrangeira, deixe claro que se trata de tradução ou paráfrase em português.
7. Use o histórico recente para manter continuidade sem repetir apresentações.
8. Seja analítico, claro, respeitoso, curioso e intelectualmente rigoroso.
9. Termine, quando útil, com uma síntese curta.
""".strip()


class PerguntaRequest(BaseModel):
    pergunta: str = Field(min_length=2, max_length=8000)
    historico: List[dict] = Field(default_factory=list)


class Fonte(BaseModel):
    arquivo: str
    pagina: Optional[int] = None
    trecho: str


class PerguntaResponse(BaseModel):
    resposta: str
    audio_url: Optional[str] = None
    fontes: List[Fonte]


def chunk_text(texto: str, chunk_size: int = 1200, overlap: int = 180) -> List[str]:
    texto = re.sub(r"\s+", " ", texto or "").strip()
    if not texto:
        return []
    chunks = []
    inicio = 0
    n = len(texto)
    while inicio < n:
        fim = min(inicio + chunk_size, n)
        chunks.append(texto[inicio:fim].strip())
        if fim >= n:
            break
        inicio = max(0, fim - overlap)
    return [c for c in chunks if c]


def require_api():
    if not genai_client:
        raise HTTPException(
            status_code=503,
            detail="GEMINI_API_KEY/GOOGLE_API_KEY não configurada no servidor.",
        )


def require_admin(
    x_admin_token: Optional[str] = None,
    x_fns_owner_token: Optional[str] = None,
):
    if ADMIN_TOKEN and x_admin_token and hmac.compare_digest(x_admin_token, ADMIN_TOKEN):
        return

    if OWNER_TOKEN_HASH and x_fns_owner_token:
        digest = hashlib.sha256(x_fns_owner_token.encode("utf-8")).hexdigest()
        if hmac.compare_digest(digest, OWNER_TOKEN_HASH):
            return

    if not ADMIN_TOKEN and not OWNER_TOKEN_HASH:
        raise HTTPException(status_code=503, detail="Nenhum mecanismo administrativo configurado.")

    raise HTTPException(status_code=401, detail="Acesso administrativo inválido.")


async def embed_texts(texts: List[str]) -> List[List[float]]:
    require_api()
    vectors = []
    batch_size = 40
    for i in range(0, len(texts), batch_size):
        batch = texts[i:i + batch_size]
        result = await genai_client.aio.models.embed_content(
            model=EMBEDDING_MODEL,
            contents=batch,
            config=types.EmbedContentConfig(output_dimensionality=EMBEDDING_DIM),
        )
        vectors.extend([list(e.values) for e in result.embeddings])
    return vectors


async def indexar_pdf(caminho_pdf: Path) -> int:
    reader = PdfReader(str(caminho_pdf))
    textos, metadados, ids = [], [], []

    for pagina_idx, page in enumerate(reader.pages, start=1):
        texto = page.extract_text() or ""
        for chunk_idx, chunk in enumerate(chunk_text(texto)):
            ids.append(f"{caminho_pdf.name}:{pagina_idx}:{chunk_idx}")
            textos.append(chunk)
            metadados.append({
                "arquivo": caminho_pdf.name,
                "pagina": pagina_idx,
                "chunk": chunk_idx,
            })

    if not textos:
        raise ValueError("O PDF não possui texto extraível.")

    embeddings = await embed_texts(textos)
    collection.upsert(
        ids=ids,
        documents=textos,
        metadatas=metadados,
        embeddings=embeddings,
    )
    return len(textos)


async def auto_indexar():
    if not AUTO_INDEX_ON_STARTUP or collection.count() > 0 or not genai_client:
        return
    for pdf in sorted(LIVROS_DIR.glob("*.pdf")):
        try:
            await indexar_pdf(pdf)
            print(f"[AUTO-INDEX] {pdf.name} indexado.")
        except Exception as exc:
            print(f"[AUTO-INDEX] Falha em {pdf.name}: {exc}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await auto_indexar()
    yield
    if genai_client:
        await genai_client.aio.aclose()


app = FastAPI(
    title="Consciência do Fabiano — RAG",
    version="3.2.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-Admin-Token", "X-FNS-Owner-Token"],
)

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


async def recuperar_contexto(pergunta: str):
    require_api()
    if collection.count() == 0:
        raise HTTPException(
            status_code=400,
            detail="A memória está vazia. Adicione PDFs à pasta livros e redeploy, ou use /admin.",
        )

    q = await embed_texts([pergunta])
    resultado = collection.query(
        query_embeddings=q,
        n_results=min(TOP_K, collection.count()),
        include=["documents", "metadatas", "distances"],
    )

    documentos = (resultado.get("documents") or [[]])[0]
    metadados = (resultado.get("metadatas") or [[]])[0]

    blocos, fontes, total = [], [], 0
    for doc, meta in zip(documentos, metadados):
        if not doc:
            continue
        arquivo = (meta or {}).get("arquivo", "fonte desconhecida")
        pagina = (meta or {}).get("pagina")
        rotulo = f"[Fonte: {arquivo}" + (f", página {pagina}" if pagina else "") + "]"
        bloco = f"{rotulo}\n{doc.strip()}"
        if total + len(bloco) > MAX_CONTEXT_CHARS:
            break
        blocos.append(bloco)
        total += len(bloco)
        fontes.append({
            "arquivo": arquivo,
            "pagina": pagina,
            "trecho": doc.strip()[:360],
        })
    return "\n\n".join(blocos), fontes


async def gerar_audio(texto: str, arquivo_saida: Path):
    comunicador = edge_tts.Communicate(texto, TTS_VOICE)
    await comunicador.save(str(arquivo_saida))


@app.get("/", response_class=HTMLResponse)
def home():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/admin", response_class=HTMLResponse)
def admin():
    return FileResponse(STATIC_DIR / "admin.html")


@app.get("/health")
def health():
    return {
        "ok": True,
        "projeto": "Consciência do Fabiano",
        "versao": "3.2.0",
        "modelo": GEMINI_MODEL,
        "embedding_model": EMBEDDING_MODEL,
        "documentos_indexados": collection.count(),
        "gemini_configurado": bool(GOOGLE_API_KEY),
        "admin_configurado": bool(ADMIN_TOKEN or OWNER_TOKEN_HASH),
        "voz": TTS_VOICE,
        "site_principal": DEFAULT_MAIN_SITE,
        "cors_origins": CORS_ORIGINS,
        "nota_persistencia": (
            "Em Render Free, uploads feitos durante a execução são temporários. "
            "PDFs colocados em /livros no repositório são reindexados automaticamente."
        ),
    }


@app.post("/admin/upload-pdf")
async def upload_pdf(
    arquivo: UploadFile = File(...),
    x_admin_token: Optional[str] = Header(default=None),
    x_fns_owner_token: Optional[str] = Header(default=None),
):
    require_admin(x_admin_token, x_fns_owner_token)
    require_api()

    if not arquivo.filename or not arquivo.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Envie um PDF.")

    nome = re.sub(r"[^a-zA-Z0-9._ -]+", "_", Path(arquivo.filename).name)
    destino = LIVROS_DIR / nome
    conteudo = await arquivo.read()
    if len(conteudo) > 50 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="PDF maior que 50 MB.")

    destino.write_bytes(conteudo)
    try:
        chunks = await indexar_pdf(destino)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Falha ao indexar: {exc}")

    return {
        "ok": True,
        "arquivo": nome,
        "chunks": chunks,
        "total_chunks": collection.count(),
        "aviso": (
            "Em Render Free este upload é temporário e pode desaparecer após sleep/restart. "
            "Para permanência gratuita, inclua o PDF na pasta /livros do repositório e redeploy."
        ),
    }


class DeletePdfRequest(BaseModel):
    arquivo: str = Field(min_length=1, max_length=260)


def _safe_pdf_name(nome: str) -> str:
    base = Path(nome).name
    if base != nome or not base.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Nome de PDF inválido.")
    return base


@app.get("/admin/livros")
def listar_livros(
    x_admin_token: Optional[str] = Header(default=None),
    x_fns_owner_token: Optional[str] = Header(default=None),
):
    require_admin(x_admin_token, x_fns_owner_token)
    counts = {}
    try:
        data = collection.get(include=["metadatas"])
        for meta in data.get("metadatas") or []:
            arquivo = (meta or {}).get("arquivo")
            if arquivo:
                counts[arquivo] = counts.get(arquivo, 0) + 1
    except Exception:
        pass

    nomes = {p.name for p in LIVROS_DIR.glob("*.pdf")}
    nomes.update(counts.keys())
    livros = [
        {
            "arquivo": nome,
            "chunks": counts.get(nome, 0),
            "armazenado_no_disco": (LIVROS_DIR / nome).exists(),
        }
        for nome in sorted(nomes, key=str.lower)
    ]
    return {"ok": True, "livros": livros, "total_chunks": collection.count()}


@app.post("/admin/delete-pdf")
def deletar_pdf(
    req: DeletePdfRequest,
    x_admin_token: Optional[str] = Header(default=None),
    x_fns_owner_token: Optional[str] = Header(default=None),
):
    require_admin(x_admin_token, x_fns_owner_token)
    nome = _safe_pdf_name(req.arquivo)
    caminho = LIVROS_DIR / nome
    if caminho.exists():
        caminho.unlink()
    try:
        collection.delete(where={"arquivo": nome})
    except Exception:
        pass
    return {"ok": True, "arquivo": nome, "total_chunks": collection.count()}


@app.post("/admin/reindex")
async def reindexar_biblioteca(
    x_admin_token: Optional[str] = Header(default=None),
    x_fns_owner_token: Optional[str] = Header(default=None),
):
    require_admin(x_admin_token, x_fns_owner_token)
    require_api()

    try:
        ids = (collection.get() or {}).get("ids") or []
        if ids:
            collection.delete(ids=ids)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Falha ao limpar índice: {exc}")

    arquivos = []
    total_novo = 0
    for pdf in sorted(LIVROS_DIR.glob("*.pdf")):
        try:
            chunks = await indexar_pdf(pdf)
            total_novo += chunks
            arquivos.append({"arquivo": pdf.name, "chunks": chunks, "ok": True})
        except Exception as exc:
            arquivos.append({"arquivo": pdf.name, "ok": False, "erro": str(exc)})

    return {
        "ok": True,
        "arquivos": arquivos,
        "total_chunks": collection.count(),
        "chunks_reindexados": total_novo,
    }


@app.post("/perguntar", response_model=PerguntaResponse)
async def perguntar(req: PerguntaRequest):
    require_api()
    contexto, fontes = await recuperar_contexto(req.pergunta)

    historico_linhas = []
    for item in req.historico[-20:]:
        role = "ASSISTENTE" if str(item.get("role", "")).lower() == "assistant" else "USUÁRIO"
        content = str(item.get("content", "")).strip()[:1800]
        if content:
            historico_linhas.append(f"{role}: {content}")
    historico = "\n".join(historico_linhas)

    prompt = f"""
HISTÓRICO RECENTE:
{historico or "(sem histórico anterior)"}

CONTEXTO RECUPERADO DA BIBLIOTECA:
{contexto}

PERGUNTA:
{req.pergunta}

Responda somente em português brasileiro.
Se a fonte estiver em inglês ou outro idioma, explique/traduza em português sem perder o sentido.
Identifique arquivo/livro e página quando disponíveis e nunca invente uma referência ausente.
""".strip()

    try:
        resposta = await genai_client.aio.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT,
                temperature=0.35,
                max_output_tokens=2200,
            ),
        )
        texto = (resposta.text or "").strip()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Falha no Gemini: {exc}")

    if not texto:
        raise HTTPException(status_code=502, detail="Resposta vazia do Gemini.")

    audio_url = None
    audio_id = uuid.uuid4().hex
    caminho = AUDIOS_DIR / f"{audio_id}.mp3"
    try:
        await gerar_audio(texto, caminho)
        audio_url = f"/audio/{audio_id}.mp3"
    except Exception as exc:
        print(f"[TTS] Falha: {exc}")

    return {"resposta": texto, "audio_url": audio_url, "fontes": fontes}


@app.get("/audio/{arquivo}")
def audio(arquivo: str):
    if not re.fullmatch(r"[a-f0-9]{32}\.mp3", arquivo):
        raise HTTPException(status_code=400, detail="Nome inválido.")
    caminho = AUDIOS_DIR / arquivo
    if not caminho.exists():
        raise HTTPException(status_code=404, detail="Áudio não encontrado.")
    return FileResponse(caminho, media_type="audio/mpeg", filename=arquivo)
