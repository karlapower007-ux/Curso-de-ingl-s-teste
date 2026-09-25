#!/usr/bin/env python3
from pathlib import Path
import argparse, hashlib, json, shutil, struct, subprocess, zipfile, gzip

EXPECTED_OLD_SETUP="e88a737fd6f6a15490a00f6e7b8b7363d9427ad107b73114470d492b36f6408a"
EXPECTED_NEW_SETUP="fb47f8efe4f84d26656c8130dbf2873cf38e896fb51e95f042c9b562fc188d02"
EXPECTED_NEW_PAYLOAD="87e935ace456ec0eb26f755cfa3131f6e96482b78c258392ad9f289d7a883df9"

def sha(b): return hashlib.sha256(b).hexdigest()

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--setup", required=True)
    ap.add_argument("--patch-gz", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--work", default=".v2031-work")
    args=ap.parse_args()
    setup=Path(args.setup); patch_gz=Path(args.patch_gz); out=Path(args.out); work=Path(args.work)
    if sha(setup.read_bytes()) != EXPECTED_OLD_SETUP:
        raise SystemExit("unexpected base installer sha256")
    if work.exists(): shutil.rmtree(work)
    work.mkdir(parents=True)
    raw=bytearray(setup.read_bytes())
    e=bytes(raw).rfind(b"PK\x05\x06")
    if e < 0: raise SystemExit("embedded ZIP not found")
    _,_,_,_,entries,cd_size,cd_off,comment_len=struct.unpack_from("<4s4H2LH", raw, e)
    start=e-cd_size-cd_off; end=e+22+comment_len
    old_payload=bytes(raw[start:end])
    oldzip=work/"old.zip"; oldzip.write_bytes(old_payload)
    root=work/"payload"; root.mkdir()
    with zipfile.ZipFile(oldzip) as z: z.extractall(root)

    patch=work/"v203-ui.patch"
    patch.write_bytes(gzip.decompress(patch_gz.read_bytes()))
    subprocess.run(["patch","-p1","-i",str(patch.resolve())],cwd=root,check=True)

    av=root/"static/avatar-engine.js"
    s=av.read_text(encoding="utf-8")
    replacements=[
      ("visemeBox:{left:33.5,top:45.7,width:33.0,height:15.6}","visemeBox:{left:34.0,top:46.0,width:32.0,height:15.0}"),
      ("visemeBox:{left:33.0,top:48.5,width:34.0,height:15.2}","visemeBox:{left:34.5,top:51.0,width:31.0,height:14.5}"),
      ("visemeBox:{left:33.0,top:45.8,width:34.0,height:15.5}","visemeBox:{left:34.0,top:48.0,width:32.0,height:15.0}"),
      ("visemeBox:{left:33.0,top:45.6,width:34.0,height:15.5}","visemeBox:{left:34.0,top:47.5,width:32.0,height:15.0}")
    ]
    for a,b in replacements:
        if a not in s: raise SystemExit("missing avatar calibration source: "+a)
        s=s.replace(a,b,1)
    av.write_text(s,encoding="utf-8")

    css=root/"static/styles.css"
    c=css.read_text(encoding="utf-8")
    old1="-webkit-mask-image:radial-gradient(ellipse at center,#000 35%,rgba(0,0,0,.98) 56%,rgba(0,0,0,.72) 72%,rgba(0,0,0,.18) 88%,transparent 100%);"
    old2="mask-image:radial-gradient(ellipse at center,#000 35%,rgba(0,0,0,.98) 56%,rgba(0,0,0,.72) 72%,rgba(0,0,0,.18) 88%,transparent 100%);"
    new1="-webkit-mask-image:radial-gradient(ellipse 47% 25.5% at 50% 72%,#000 60%,rgba(0,0,0,.95) 70%,rgba(0,0,0,.55) 84%,transparent 100%);"
    new2="mask-image:radial-gradient(ellipse 47% 25.5% at 50% 72%,#000 60%,rgba(0,0,0,.95) 70%,rgba(0,0,0,.55) 84%,transparent 100%);"
    if old1 not in c or old2 not in c: raise SystemExit("old mouth mask not found")
    c=c.replace(old1,new1,1).replace(old2,new2,1)
    c=c.replace("@keyframes visemeBreath{to{transform:scale(calc(.99 + var(--viseme-strength,.6)*.018)) translateY(-.15px)}}",
                "@keyframes visemeBreath{to{transform:scale(calc(.99 + var(--viseme-strength,.6)*.012))}}")
    css.write_text(c,encoding="utf-8")

    app=root/"static/app.js"
    a=app.read_text(encoding="utf-8")
    a=a.replace("const BUILD_ID = '2.0.3-20260925';","const BUILD_ID = '2.0.3.1';")
    a=a.replace("navigator.serviceWorker.register('/static/sw.js?v=2.0.3')","navigator.serviceWorker.register('/static/sw.js?v=2.0.3.1')")
    app.write_text(a,encoding="utf-8")
    sw=root/"static/sw.js"
    sw.write_text(sw.read_text(encoding="utf-8").replace("const CACHE='professores-ia-v2.0.3';","const CACHE='professores-ia-v2.0.3.1';"),encoding="utf-8")
    (root/"VERSION.txt").write_text("2.0.3.1\n",encoding="utf-8")

    readme=root/"LEIA_PRIMEIRO.txt"
    r=readme.read_text(encoding="utf-8")
    r=r.replace("PROFESSORES IA 2.0.2 HOTFIX","PROFESSORES IA 2.0.3.1")
    r=r.replace("Execute Professores_IA_v2.0.2_FORBIDDEN_FIX_Setup.exe.","Execute o instalador v2.0.3.1 entregue.")
    r += "\n\nCORREÇÕES v2.0.3.1:\n- boca: visemas reais, máscara só na boca e posição recalibrada;\n- botão segure-para-falar (walkie-talkie);\n- fallback de voz do navegador quando o áudio remoto não chegar;\n- cache da interface renovado para impedir abertura da build antiga.\n"
    readme.write_text(r,encoding="utf-8")

    manifest=root/"manifest.sha256.json"
    m=json.loads(manifest.read_text(encoding="utf-8"))
    # Keep legacy bootstrap manifest version 2.0.2 for installer compatibility.
    if m.get("version") != "2.0.2":
        raise SystemExit("unexpected bootstrap manifest version")
    for rel,meta in m["files"].items():
        data=(root/rel).read_bytes()
        meta["sha256"]=sha(data); meta["size"]=len(data)
    manifest.write_text(json.dumps(m,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")

    newzip=work/"payload-v2031.zip"
    with zipfile.ZipFile(oldzip,"r") as zin, zipfile.ZipFile(newzip,"w") as zout:
        for info in zin.infolist():
            data=(root/info.filename).read_bytes()
            ni=zipfile.ZipInfo(info.filename,info.date_time)
            ni.compress_type=info.compress_type; ni.comment=info.comment; ni.extra=info.extra
            ni.internal_attr=info.internal_attr; ni.external_attr=info.external_attr; ni.create_system=info.create_system
            zout.writestr(ni,data,compress_type=info.compress_type,compresslevel=9)
    target=len(old_payload); pad=target-newzip.stat().st_size
    if not (0 <= pad <= 65535): raise SystemExit(f"invalid payload padding {pad}")
    if pad:
        with zipfile.ZipFile(newzip,"a") as z:
            z.comment=(b"V2031|"+b"_"*pad)[:pad]
    new_payload=newzip.read_bytes()
    if len(new_payload) != target: raise SystemExit("payload length mismatch")
    with zipfile.ZipFile(newzip) as z:
        bad=z.testzip()
        if bad: raise SystemExit("corrupt ZIP member: "+bad)
    if sha(new_payload) != EXPECTED_NEW_PAYLOAD:
        raise SystemExit("unexpected new payload sha256 "+sha(new_payload))
    raw[start:end]=new_payload
    out.parent.mkdir(parents=True,exist_ok=True); out.write_bytes(raw)
    if sha(out.read_bytes()) != EXPECTED_NEW_SETUP:
        raise SystemExit("unexpected final setup sha256 "+sha(out.read_bytes()))
    result={"version":"2.0.3.1","setup_sha256":sha(out.read_bytes()),"payload_sha256":sha(new_payload),
            "payload_size":len(new_payload),"entries":entries,"zip_padding":pad}
    (out.parent/"V2031_BUILD.json").write_text(json.dumps(result,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(result,indent=2))

if __name__=="__main__": main()
