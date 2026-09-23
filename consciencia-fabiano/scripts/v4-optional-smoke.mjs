import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(__dirname,"..");

const read=rel=>readFile(path.join(root,rel),"utf8");
const [server,ui,piper,gateway,whisper,worker,enableMobile,disableMobile,disableExternal,updater]=await Promise.all([
  read("scripts/v2-local-server.mjs"),
  read("public/v2-local-ui.js"),
  read("scripts/v4-piper-tts.mjs"),
  read("scripts/v4-mobile-gateway.mjs"),
  read("public/whisper-local.js"),
  read("public/whisper-worker.js"),
  read("windows/HABILITAR_CELULAR_TAILSCALE.ps1"),
  read("windows/DESABILITAR_CELULAR_TAILSCALE.ps1"),
  read("windows/DESLIGAR_REDATOR_EXTERNO.ps1"),
  read("scripts/reiniciar-cerebro-v2.ps1")
]);

assert.ok(server.includes('process.env.FNS_EXTERNAL_WRITER_ENABLED||"0"'),"redator externo deve nascer desligado");
assert.ok(server.includes('EXTERNAL_WRITER_ENABLED=String('),"flag externa deve ser explícita");
assert.ok(server.includes('proofs:(proofs||[]).slice(0,3).map(p=>({id:p.id,trecho:p.trecho}))'),"externo deve receber só id+trecho das provas");
const extStart=server.indexOf("async function generateLessonWithExternal");
const extEnd=server.indexOf("async function generateLessonText",extStart);
const extBlock=server.slice(extStart,extEnd);
assert.ok(extStart>=0&&extEnd>extStart);
assert.ok(!extBlock.includes("p.ref"),"redator externo não pode receber referência");
assert.ok(!extBlock.includes("biblioteca_backup"),"redator externo não pode receber backup");
assert.ok(!extBlock.includes("document_id"),"redator externo não pode receber índice/document_id");
assert.ok(server.includes('url.pathname==="/api/v4/tts"'),"Piper deve ter endpoint local V4");
assert.ok(server.includes("synthesizePiper(ROOT,text)"),"TTS deve sintetizar apenas texto montado localmente");
assert.ok(server.includes('url.pathname==="/api/v2/dictionary"'),"Dicionário V2 deve continuar congelado");
assert.ok(!server.includes("/api/v4/dictionary"),"V4 não pode criar Dicionário");

assert.ok(piper.includes("piper-local"));
assert.ok(piper.includes("pt_BR"));
assert.ok(!piper.includes("http://")&&!piper.includes("https://"),"Piper deve ser puramente local");
assert.ok(ui.includes("async function speakV4Lesson"),"UI deve tentar voz V4");
assert.ok(ui.includes('/api/v4/tts'),"UI deve tentar Piper local");
assert.ok(ui.includes("return speakV2Answer"),"Piper deve ter fallback de voz do navegador");

assert.ok(gateway.includes('const HOST="127.0.0.1"'),"gateway móvel deve permanecer loopback");
assert.ok(gateway.includes('const PORT=Math.max(1,Number(process.env.FNS_MOBILE_PORT||8790))'));
assert.ok(gateway.includes('const TARGET="http://127.0.0.1:8788"'),"gateway deve encaminhar para 8788 sem expô-la");
assert.ok(gateway.includes("FNS_MOBILE_TOKEN"),"gateway precisa exigir token");
assert.ok(gateway.includes("HttpOnly; SameSite=Strict"),"token móvel deve virar cookie protegido");
assert.ok(!gateway.includes('0.0.0.0'),"gateway móvel não pode bindar publicamente");

assert.ok(enableMobile.includes("tailscale serve --bg http://127.0.0.1:8790"),"Tailscale deve servir só o gateway autenticado");
assert.ok(!enableMobile.includes("8788"),"habilitador móvel não pode publicar a porta 8788");
assert.ok(disableMobile.includes("tailscale serve reset"),"desabilitar celular deve remover o Tailscale Serve");
assert.ok(disableExternal.includes('"FNS_EXTERNAL_WRITER_ENABLED","0","User"'),"deve existir desligamento explícito do redator externo");

assert.ok(worker.includes('"Xenova/whisper-tiny"'),"STT local deve usar Whisper tiny");
assert.ok(whisper.includes('mode="lazy"'),"Whisper tiny deve ser lazy");
assert.ok(whisper.includes("será carregado somente quando você usar o microfone"),"Whisper não deve carregar antes do microfone");

assert.ok(updater.includes('"scripts/v4-piper-tts.mjs"'));
assert.ok(updater.includes('"scripts/v4-mobile-gateway.mjs"'));

console.log(JSON.stringify({
  ok:true,
  external_writer_default:"off",
  external_payload:"question+proof_text_only",
  piper:"local_optional",
  mobile:"tailscale-token-gateway-8790",
  port_8788:"loopback-only",
  whisper:"tiny-lazy",
  dictionary:"v2-frozen"
},null,2));
