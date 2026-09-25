#!/usr/bin/env python3
from pathlib import Path
import argparse, hashlib, io, json, shutil, struct, zipfile
import build_v220_godot as v220

def sha(b): return hashlib.sha256(b).hexdigest()

def extract(setup:Path, dest:Path):
    raw=setup.read_bytes()
    e=raw.rfind(b"PK\x05\x06")
    if e<0: raise SystemExit("embedded ZIP not found")
    _,_,_,_,_,cd_size,cd_off,comment_len=struct.unpack_from("<4s4H2LH",raw,e)
    start=e-cd_size-cd_off; end=e+22+comment_len
    with zipfile.ZipFile(io.BytesIO(raw[start:end])) as z:
        if z.testzip(): raise SystemExit("corrupt base payload")
        z.extractall(dest)

def filemap(root):
    out={}
    for p in root.rglob("*"):
        if p.is_file():
            rel=p.relative_to(root).as_posix()
            out[rel]=(sha(p.read_bytes()),p.stat().st_size)
    return out

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--base-setup",required=True)
    ap.add_argument("--repo",required=True)
    ap.add_argument("--godot-web",required=True)
    ap.add_argument("--out",required=True)
    ap.add_argument("--work",default=".v220-patch-work")
    args=ap.parse_args()
    setup=Path(args.base_setup); repo=Path(args.repo); godot=Path(args.godot_web)
    out=Path(args.out); work=Path(args.work)
    shutil.rmtree(work,ignore_errors=True); work.mkdir(parents=True)
    base=work/"base"; patched=work/"patched"; base.mkdir(); patched.mkdir()
    extract(setup,base)
    shutil.copytree(base,patched,dirs_exist_ok=True)
    v220.patch_payload(patched,repo,godot)
    v220.verify_manifest(patched)

    before=filemap(base); after=filemap(patched)
    changed=[rel for rel,meta in after.items() if before.get(rel)!=meta]
    removed=[rel for rel in before if rel not in after]
    if removed: raise SystemExit("patch unexpectedly removes files: "+repr(removed))
    required=["static/app.js","static/index.html","static/styles.css","static/sw.js",
              "static/godot-avatar-bridge.js","static/godot/index.html","static/godot/index.js",
              "static/godot/index.pck","static/godot/index.wasm","manifest.sha256.json","VERSION.txt"]
    for rel in required:
        if rel not in changed: raise SystemExit("required patched file not changed: "+rel)

    out.parent.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(out,"w",zipfile.ZIP_DEFLATED,compresslevel=9) as z:
        for rel in sorted(changed):
            z.write(patched/rel,rel)
    with zipfile.ZipFile(out) as z:
        if z.testzip(): raise SystemExit("corrupt patch zip")

    manifest={
      "schema":1,"version":"2.2.0","base_setup_sha256":sha(setup.read_bytes()),
      "patch_sha256":sha(out.read_bytes()),"patch_size":out.stat().st_size,
      "changed_files":len(changed),"files":{}
    }
    for rel in changed:
        b=(patched/rel).read_bytes()
        manifest["files"][rel]={"sha256":sha(b),"size":len(b)}
    (out.parent/"V220_PATCH_MANIFEST.json").write_text(json.dumps(manifest,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
    print(json.dumps({k:v for k,v in manifest.items() if k!="files"},indent=2))

if __name__=="__main__": main()
