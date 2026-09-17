import os
import re
import uuid
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
TTS_VOICE = os.getenv("TTS_VOICE", "pt-BR-AntonioNeural").strip()
TOP_K = int(os.getenv("RAG_TOP_K", "5"))
MAX_CONTEXT_CHARS = int(os.getenv("MAX_CONTEXT_CHARS", "18000"))
AUTO_INDEX_ON_STARTUP = os.getenv("AUTO_INDEX_ON_STARTUP", "1").lower() in {"1", "true", "yes", "on"}
DEFAULT_MAIN_SITE = "https://estudos-profundos-fns.karlapower007.chatgpt.site"
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", DEFAULT_MAIN_SITE).split(",")
    if origin.strip()
]

genai_client = genai.Client(api_key=GOOGLE_API_KEY) if GOOGLE_API_KEY else None

chroma = chromadb.PersistentClient(path=str(CHROMA_DIR))
collection = chroma.get_or_create_collection(
    name="memoria_avatar_fabiano",
    metadata={"hnsw:space": "cosine"},
)

SYSTEM_PROMPT = """
Você é o Avatar Fabiano, o Livre Pensador do projeto Estudos Profundos FNS.

IDENTIDADE:
- Pesquisador independente e debatedor crítico.
- Especializado em doutrinas, escrituras, história religiosa, teologia,
  mormonismo, hermetismo e comparações gnósticas.
- Você NÃO fala como porta-voz de igreja, denominação ou instituição.

REGRAS:
1. Baseie a análise primariamente nos trechos recuperados da biblioteca.
2. Diferencie fato documental, interpretação, hipótese e ausência de evidência.
3. Aponte falácias, tensões, paradoxos e contradições somente quando as fontes sustentarem isso.
4. Não invente citações, datas, páginas, autores nem fatos.
5. Se o contexto não for suficiente, diga isso explicitamente.
6. Seja analítico, direto, respeitoso e intelectualmente provocador.
7. Termine com uma seção curta chamada "Síntese".
""".strip()


class PerguntaRequest(BaseModel):
    pergunta: str = Field(min_length=2, max_length=8000)


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


def require_admin(x_admin_token: Optional[str]):
    if not ADMIN_TOKEN:
        raise HTTPException(status_code=503, detail="ADMIN_TOKEN não configurado.")
    if x_admin_token != ADMIN_TOKEN:
        raise HTTPException(status_code=401, detail="Token administrativo inválido.")


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
    title="Estudos Profundos FNS — Avatar Fabiano",
    version="3.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-Admin-Token"],
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
        "projeto": "Estudos Profundos FNS — Avatar Fabiano",
        "versao": "3.1.0",
        "modelo": GEMINI_MODEL,
        "embedding_model": EMBEDDING_MODEL,
        "documentos_indexados": collection.count(),
        "gemini_configurado": bool(GOOGLE_API_KEY),
        "admin_configurado": bool(ADMIN_TOKEN),
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
):
    require_admin(x_admin_token)
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


@app.post("/perguntar", response_model=PerguntaResponse)
async def perguntar(req: PerguntaRequest):
    require_api()
    contexto, fontes = await recuperar_contexto(req.pergunta)

    prompt = f"""
CONTEXTO RECUPERADO:
{contexto}

PERGUNTA / TESE:
{req.pergunta}

Responda em português brasileiro e identifique arquivo/página quando disponíveis.
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
