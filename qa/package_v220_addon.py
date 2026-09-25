#!/usr/bin/env python3
from pathlib import Path
import argparse, hashlib, json, zipfile

VERSION="2.2.0"
FIXED_TIME=(2026,9,25,15,30,0)

def sha(b:bytes)->str:
    return hashlib.sha256(b).hexdigest()

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--patched-root",required=True)
    ap.add_argument("--out",required=True)
    args=ap.parse_args()
    root=Path(args.patched_root)
    out=Path(args.out)
    fixed=[
        "static/app.js",
        "static/index.html",
        "static/styles.css",
        "static/sw.js",
        "static/godot-avatar-bridge.js",
        "static/godot-selftest.html",
        "VERSION.txt",
        "LEIA_PRIMEIRO.txt",
        "manifest.sha256.json",
    ]
    rels=list(fixed)
    godot=root/"static/godot"
    if not godot.exists():
        raise SystemExit("missing patched Godot export")
    rels.extend(p.relative_to(root).as_posix() for p in sorted(godot.rglob("*")) if p.is_file())
    rels=sorted(dict.fromkeys(rels))
    files={}
    for rel in rels:
        p=root/rel
        if not p.exists() or not p.is_file():
            raise SystemExit("missing addon target "+rel)
        b=p.read_bytes()
        files[rel]={"sha256":sha(b),"size":len(b)}
    manifest={
        "schema":1,
        "version":VERSION,
        "renderer":"godot-real-art",
        "engine":"Godot 4.7.2",
        "license_cost":"zero",
        "files":files,
    }
    out.parent.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(out,"w",compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
        mi=zipfile.ZipInfo("addon-manifest.json",FIXED_TIME)
        mi.compress_type=zipfile.ZIP_DEFLATED
        mi.create_system=3
        mi.external_attr=(0o644&0xFFFF)<<16
        z.writestr(mi,json.dumps(manifest,indent=2,ensure_ascii=False).encode("utf-8")+b"\n",
                   compress_type=zipfile.ZIP_DEFLATED,compresslevel=9)
        for rel in rels:
            info=zipfile.ZipInfo(rel,FIXED_TIME)
            info.compress_type=zipfile.ZIP_DEFLATED
            info.create_system=3
            info.external_attr=(0o644&0xFFFF)<<16
            z.writestr(info,(root/rel).read_bytes(),compress_type=zipfile.ZIP_DEFLATED,compresslevel=9)
    with zipfile.ZipFile(out) as z:
        bad=z.testzip()
        if bad: raise SystemExit("corrupt addon member "+bad)
    result={
        "version":VERSION,
        "addon_sha256":sha(out.read_bytes()),
        "addon_size":out.stat().st_size,
        "files":len(files),
    }
    print(json.dumps(result,indent=2))

if __name__=="__main__":
    main()
