#!/usr/bin/env python3
from pathlib import Path
import argparse, hashlib, json, shutil, struct, zipfile, re

VERSION="2.2.0"
FIXED_TIME=(2026,9,25,15,0,0)

def sha(b):
    return hashlib.sha256(b).hexdigest()

def extract_embedded(setup:Path,work:Path):
    raw=setup.read_bytes()
    e=raw.rfind(b"PK\x05\x06")
    if e<0:
        raise SystemExit("embedded ZIP not found")
    _,_,_,_,entries,cd_size,cd_off,comment_len=struct.unpack_from("<4s4H2LH",raw,e)
    start=e-cd_size-cd_off
    end=e+22+comment_len
    zpath=work/"base-payload.zip"
    zpath.write_bytes(raw[start:end])
    root=work/"payload"
    root.mkdir()
    with zipfile.ZipFile(zpath) as z:
        bad=z.testzip()
        if bad:
            raise SystemExit("corrupt base payload member "+bad)
        z.extractall(root)
    return raw,start,end,entries,root

def patch_payload(root:Path,repo:Path,godot_web:Path):
    static=root/"static"
    target=static/"godot"
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(godot_web,target)
    required=["index.html","index.js","index.pck","index.wasm"]
    for name in required:
        if not (target/name).exists():
            raise SystemExit("missing Godot web file: "+name)

    shutil.copy2(repo/"godot/godot-avatar-bridge.js",static/"godot-avatar-bridge.js")

    app=static/"app.js"
    a=app.read_text(encoding="utf-8")
    old='''            <img id="avatarViseme" class="viseme-layer" src="/static/avatars/visemes/${t.slug}/REST.webp" alt="" aria-hidden="true">
          </div>
          <div class="breath-pulse" aria-hidden="true"></div>'''
    new='''            <img id="avatarViseme" class="viseme-layer" src="/static/avatars/visemes/${t.slug}/REST.webp" alt="" aria-hidden="true">
          </div>
          <iframe id="godotAvatarFrame" class="godot-avatar-frame" src="/static/godot/index.html?v=2.2.0" title="Avatar animado de ${esc(t.name)}" loading="eager" tabindex="-1" aria-hidden="true" hidden></iframe>
          <div class="breath-pulse" aria-hidden="true"></div>'''
    if old not in a:
        raise SystemExit("avatar iframe insertion point not found")
    a=a.replace(old,new,1)

    sig='''        <div class="motor-signature">Performance Engine v1.7 de <b>${esc(t.name)}</b> · rig contínuo, coarticulação, olhar, piscadas, respiração, microexpressões e personalidade corporal em paralelo</div>'''
    newsig='''        <div class="motor-signature" id="motorSignature">Godot Free Avatar v2.2 de <b>${esc(t.name)}</b> · rosto inteiro animado, sem boca-tampão, emoção, piscadas e fala <span class="build-tag">build 2.2.0</span></div>'''
    if sig in a:
        a=a.replace(sig,newsig,1)

    mount='''    avatarController = new Avatar.AvatarController({
      teacherId: state.teacher,
      rig: $('#avatarRig'), img: $('#avatarPortrait'), visemeImg: $('#avatarViseme'), label: $('#emotionLabel'), status: $('#avatarState'),
      storage: window.localStorage
    }).mount();
'''
    attach=mount+'''    {
      const controllerAtMount=avatarController;
      const rig=$('#avatarRig'), frame=$('#godotAvatarFrame'), signature=$('#motorSignature');
      Promise.resolve(window.ProfessoresGodotBridge?.attach?.({
        controller:controllerAtMount, teacherId:state.teacher, rig, frame,
        label:$('#emotionLabel'), status:$('#avatarState')
      })).then(result=>{
        if(controllerAtMount!==avatarController)return;
        if(result?.ok){
          if(signature) signature.innerHTML='Godot Free Avatar v2.2 de <b>'+esc(t.name)+'</b> · expressões de rosto inteiro, sem boca sobreposta, emoção e lip-sync por estados <span class="build-tag">build 2.2.0</span>';
        }else{
          if(signature) signature.innerHTML='Performance Engine de <b>'+esc(t.name)+'</b> · fallback visual ativo <span class="build-tag">Godot indisponível</span>';
        }
      }).catch(()=>{});
    }
'''
    if mount not in a:
        raise SystemExit("controller mount point not found")
    a=a.replace(mount,attach,1)
    app.write_text(a,encoding="utf-8")

    idx=static/"index.html"
    h=idx.read_text(encoding="utf-8")
    old='''  <script src="/static/performance-engine.js" defer></script>
  <script src="/static/avatar-engine.js" defer></script>
  <script src="/static/app.js" defer></script>'''
    new='''  <script src="/static/performance-engine.js?v=2.2.0" defer></script>
  <script src="/static/avatar-engine.js?v=2.2.0" defer></script>
  <script src="/static/godot-avatar-bridge.js?v=2.2.0" defer></script>
  <script src="/static/app.js?v=2.2.0" defer></script>'''
    if old not in h:
        raise SystemExit("index script block not found")
    idx.write_text(h.replace(old,new,1),encoding="utf-8")

    css=static/"styles.css"
    c=css.read_text(encoding="utf-8")
    c+='''

/* v2.2 — Godot real-art renderer. The accepted raster stack remains fallback-only. */
.godot-avatar-frame{position:absolute;inset:0;width:100%;height:100%;border:0;z-index:8;background:#eee9ff;display:block;pointer-events:none}
.avatar-rig.godot-native-active .performance-stack{visibility:hidden!important;pointer-events:none!important}
.avatar-rig.godot-native-active .breath-pulse{display:none!important}
.avatar-rig.godot-native-active .godot-avatar-frame{visibility:visible!important}
.avatar-rig[data-renderer="godot"]{background:#eee9ff}
'''
    css.write_text(c,encoding="utf-8")

    sw=static/"sw.js"
    s=sw.read_text(encoding="utf-8")
    s=re.sub(r"const CACHE='[^']+';", "const CACHE='professores-ia-v2.2.0';", s, count=1)
    extra=[
      "/static/godot-avatar-bridge.js",
      "/static/godot/index.html",
      "/static/godot/index.js",
      "/static/godot/index.pck",
      "/static/godot/index.wasm"
    ]
    if "];\nself.addEventListener('install'" in s:
        left,right=s.split("];\nself.addEventListener('install'",1)
        for path in extra:
            q=json.dumps(path)
            if q not in left:
                left += ","+q
        s=left+"];\nself.addEventListener('install'"+right
    sw.write_text(s,encoding="utf-8")

    selftest=static/"godot-selftest.html"
    selftest.write_text('''<!doctype html><meta charset="utf-8"><title>WAIT</title>
<iframe id="g" src="/static/godot/index.html" style="width:512px;height:640px;border:0"></iframe>
<pre id="out">WAIT</pre>
<script>
const out=document.getElementById('out'), f=document.getElementById('g');
let n=0;
const t=setInterval(()=>{
  n++;
  try{
    const fn=f.contentWindow._professoresGodotCommand;
    if(typeof fn==='function'){
      fn(JSON.stringify({type:'set_teacher',teacher:'lily'}));
      fn(JSON.stringify({type:'set_mode',mode:'speaking'}));
      fn(JSON.stringify({type:'set_emotion',emotion:'happy',strength:.8}));
      fn(JSON.stringify({type:'set_viseme',viseme:'A',strength:.9}));
      out.textContent='PASS GODOT READY COMMANDS';
      document.title='PASS';
      clearInterval(t);
    }
  }catch(e){out.textContent='ERR '+e.message}
  if(n>120){out.textContent='FAIL TIMEOUT';document.title='FAIL';clearInterval(t)}
},100);
</script>''',encoding="utf-8")

    (root/"VERSION.txt").write_text(VERSION+"\n",encoding="utf-8")
    readme=root/"LEIA_PRIMEIRO.txt"
    r=readme.read_text(encoding="utf-8")
    r += """\n\nNOVIDADES 2.2.0:\n- renderer Godot 4.7 gratuito e local para os quatro professores;\n- expressões por quadros de rosto inteiro, eliminando a boca retangular/tampão;\n- estados idle/listening/thinking/speaking e 12 visemas recebidos do motor existente;\n- piscadas, emoção, micro-movimento de cabeça e respiração;\n- fallback raster preservado se o WebAssembly do Godot não iniciar.\n"""
    readme.write_text(r,encoding="utf-8")

    manifest=root/"manifest.sha256.json"
    m=json.loads(manifest.read_text(encoding="utf-8"))
    for p in sorted(root.rglob("*")):
        if not p.is_file():
            continue
        rel=p.relative_to(root).as_posix()
        if rel=="manifest.sha256.json":
            continue
        b=p.read_bytes()
        m["files"][rel]={"sha256":sha(b),"size":len(b)}
    manifest.write_text(json.dumps(m,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")

def make_zip(root:Path,out:Path):
    with zipfile.ZipFile(out,"w",compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
        for p in sorted(root.rglob("*")):
            if not p.is_file():
                continue
            rel=p.relative_to(root).as_posix()
            info=zipfile.ZipInfo(rel,FIXED_TIME)
            info.compress_type=zipfile.ZIP_DEFLATED
            info.create_system=3
            info.external_attr=(0o644&0xFFFF)<<16
            z.writestr(info,p.read_bytes(),compress_type=zipfile.ZIP_DEFLATED,compresslevel=9)

def verify_manifest(root:Path):
    m=json.loads((root/"manifest.sha256.json").read_text(encoding="utf-8"))
    failures=[]
    for rel,meta in m["files"].items():
        p=root/rel
        if not p.exists():
            failures.append((rel,"missing"))
            continue
        b=p.read_bytes()
        if sha(b)!=meta["sha256"] or len(b)!=meta["size"]:
            failures.append((rel,"mismatch"))
    if failures:
        raise SystemExit("manifest failures: "+repr(failures[:10]))

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--base-setup",required=True)
    ap.add_argument("--repo",required=True)
    ap.add_argument("--godot-web",required=True)
    ap.add_argument("--out",required=True)
    ap.add_argument("--work",default=".v220-work")
    args=ap.parse_args()
    setup=Path(args.base_setup)
    repo=Path(args.repo)
    godot=Path(args.godot_web)
    out=Path(args.out)
    work=Path(args.work)
    shutil.rmtree(work,ignore_errors=True)
    work.mkdir(parents=True)
    raw,start,end,old_entries,root=extract_embedded(setup,work)
    patch_payload(root,repo,godot)
    verify_manifest(root)
    zpath=work/"payload-v220.zip"
    make_zip(root,zpath)
    with zipfile.ZipFile(zpath) as z:
        bad=z.testzip()
        if bad:
            raise SystemExit("corrupt payload member "+bad)
    new_payload=zpath.read_bytes()
    new_setup=raw[:start]+new_payload
    out.parent.mkdir(parents=True,exist_ok=True)
    out.write_bytes(new_setup)
    result={
      "version":VERSION,
      "base_setup_sha256":sha(setup.read_bytes()),
      "setup_sha256":sha(new_setup),
      "payload_sha256":sha(new_payload),
      "setup_size":len(new_setup),
      "payload_size":len(new_payload),
      "old_entries":old_entries,
      "new_entries":len(zipfile.ZipFile(zpath).infolist()),
      "godot_files":{p.name:{"sha256":sha(p.read_bytes()),"size":p.stat().st_size} for p in sorted(godot.glob("index.*")) if p.is_file()},
      "renderer":"godot-real-art",
      "mouth_patch":False
    }
    (out.parent/"V220_BUILD.json").write_text(json.dumps(result,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(result,indent=2))

if __name__=="__main__":
    main()
