#!/usr/bin/env python3
from pathlib import Path
import argparse, hashlib, json, shutil, struct, subprocess, zipfile

def sha(b): return hashlib.sha256(b).hexdigest()

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--setup',required=True)
    ap.add_argument('--patch',required=True)
    ap.add_argument('--out',required=True)
    ap.add_argument('--work',default='.v203-work')
    a=ap.parse_args()
    setup=Path(a.setup); patch=Path(a.patch); out=Path(a.out); work=Path(a.work)
    if work.exists(): shutil.rmtree(work)
    work.mkdir(parents=True)
    raw=bytearray(setup.read_bytes())
    e=bytes(raw).rfind(b'PK\x05\x06')
    if e<0: raise SystemExit('embedded zip EOCD not found')
    _,_,_,_,entries,cd_size,cd_off,comment_len=struct.unpack_from('<4s4H2LH',raw,e)
    start=e-cd_size-cd_off; end=e+22+comment_len
    old_payload=bytes(raw[start:end])
    oldzip=work/'old-payload.zip'; oldzip.write_bytes(old_payload)
    root=work/'payload'; root.mkdir()
    with zipfile.ZipFile(oldzip) as z: z.extractall(root)
    subprocess.run(['patch','-p1','-i',str(patch.resolve())],cwd=root,check=True)

    manifest=root/'manifest.sha256.json'
    m=json.loads(manifest.read_text(encoding='utf-8'))
    # Keep the legacy bootstrap manifest version 2.0.2 for binary compatibility.
    # The UI itself carries build 2.0.3-20260925 and the outer package is v2.0.3.
    for rel,meta in m['files'].items():
        data=(root/rel).read_bytes(); meta['sha256']=sha(data); meta['size']=len(data)
    manifest.write_text(json.dumps(m,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')

    newzip=work/'payload-v203.zip'
    with zipfile.ZipFile(oldzip,'r') as zin, zipfile.ZipFile(newzip,'w') as zout:
        for info in zin.infolist():
            zout.writestr(info,(root/info.filename).read_bytes(),compress_type=info.compress_type,compresslevel=9)
    target=len(old_payload)
    if newzip.stat().st_size>target:
        raise SystemExit(f'patched payload too large: {newzip.stat().st_size}>{target}')
    pad=target-newzip.stat().st_size
    if pad:
        if pad>65535: raise SystemExit(f'zip comment padding too large: {pad}')
        with zipfile.ZipFile(newzip,'a') as z: z.comment=(b'V203FIX'+b'_'*max(0,pad-7))[:pad]
    new_payload=newzip.read_bytes()
    if len(new_payload)!=target: raise SystemExit('payload length mismatch')
    with zipfile.ZipFile(newzip) as z:
        bad=z.testzip()
        if bad: raise SystemExit(f'corrupt payload entry: {bad}')

    raw[start:end]=new_payload
    out.parent.mkdir(parents=True,exist_ok=True); out.write_bytes(raw)
    result={
      'build':'2.0.3-20260925','old_setup_sha256':sha(setup.read_bytes()),
      'new_setup_sha256':sha(out.read_bytes()),'old_payload_sha256':sha(old_payload),
      'new_payload_sha256':sha(new_payload),'payload_offset':start,'payload_size':target,
      'entries':entries,'zip_padding':pad
    }
    (out.parent/'V203_BUILD.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(result,indent=2))
if __name__=='__main__': main()
