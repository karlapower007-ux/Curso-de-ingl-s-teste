#!/usr/bin/env python3
from pathlib import Path
import argparse, hashlib, json, struct, zipfile

EXPECTED_INPUT="18664123a67f76fccbd37b5b6b6d966bc01e6ce2d9bcda8ecbb6d060aa30da66"
EXPECTED_OUTPUT="d26cbabc46564bacef2d16ce595b5dd622b01c79ec2e96b0c57821a34fe765d0"
EXPECTED_PAYLOAD="9680ccc766f29d29f7bdd3fa97d4d3742a535fdf11c560654633d8ff90dda4e1"

def sha(b): return hashlib.sha256(b).hexdigest()

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--setup", required=True)
    ap.add_argument("--out", required=True)
    args=ap.parse_args()
    src=Path(args.setup); out=Path(args.out)
    raw=bytearray(src.read_bytes())
    if sha(raw)!=EXPECTED_INPUT:
        raise SystemExit("unexpected v2.0.3.1 input sha256")
    e=bytes(raw).rfind(b"PK\x05\x06")
    if e<0: raise SystemExit("embedded ZIP not found")
    _,_,_,_,entries,cd_size,cd_off,comment_len=struct.unpack_from("<4s4H2LH",raw,e)
    start=e-cd_size-cd_off; end=e+22+comment_len
    old=bytes(raw[start:end]); target=len(old)

    import tempfile, shutil
    td=Path(tempfile.mkdtemp(prefix="v2031compat-"))
    try:
        root=td/"root"; root.mkdir()
        oldzip=td/"old.zip"; oldzip.write_bytes(old)
        with zipfile.ZipFile(oldzip) as z: z.extractall(root)
        mp=root/"manifest.sha256.json"
        m=json.loads(mp.read_text(encoding="utf-8"))
        if m.get("version")!="2.0.3.1":
            raise SystemExit("unexpected patched manifest version")
        m["version"]="2.0.2"
        mp.write_text(json.dumps(m,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
        newzip=td/"new.zip"
        with zipfile.ZipFile(oldzip,"r") as zin, zipfile.ZipFile(newzip,"w") as zout:
            for info in zin.infolist():
                data=(root/info.filename).read_bytes()
                ni=zipfile.ZipInfo(info.filename,info.date_time)
                ni.compress_type=info.compress_type; ni.comment=info.comment; ni.extra=info.extra
                ni.internal_attr=info.internal_attr; ni.external_attr=info.external_attr; ni.create_system=info.create_system
                zout.writestr(ni,data,compress_type=info.compress_type,compresslevel=9)
        pad=target-newzip.stat().st_size
        if not (0<=pad<=65535): raise SystemExit(f"invalid payload padding {pad}")
        if pad:
            with zipfile.ZipFile(newzip,"a") as z:
                z.comment=(b"V2031COMPAT|"+b"_"*pad)[:pad]
        new=newzip.read_bytes()
        if len(new)!=target: raise SystemExit("payload length mismatch")
        with zipfile.ZipFile(newzip) as z:
            if z.testzip(): raise SystemExit("corrupt payload")
            mm=json.loads(z.read("manifest.sha256.json"))
            if mm.get("version")!="2.0.2": raise SystemExit("compat manifest not applied")
            app=z.read("static/app.js").decode("utf-8")
            if "const BUILD_ID = '2.0.3.1'" not in app: raise SystemExit("UI build id lost")
        if sha(new)!=EXPECTED_PAYLOAD:
            raise SystemExit("unexpected compat payload sha256 "+sha(new))
        raw[start:end]=new
        out.write_bytes(raw)
        if sha(out.read_bytes())!=EXPECTED_OUTPUT:
            raise SystemExit("unexpected compat setup sha256 "+sha(out.read_bytes()))
        print(json.dumps({"ui_version":"2.0.3.1","wrapper_manifest_version":"2.0.2","setup_sha256":EXPECTED_OUTPUT,"payload_sha256":EXPECTED_PAYLOAD,"entries":entries},indent=2))
    finally:
        shutil.rmtree(td,ignore_errors=True)

if __name__=="__main__": main()
