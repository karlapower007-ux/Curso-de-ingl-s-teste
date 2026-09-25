#!/usr/bin/env python3
from pathlib import Path
import argparse, hashlib, json, shutil, struct, zipfile

VERSION="2.1.0"
FIXED_TIME=(2026,9,25,12,0,0)

def sha(b): return hashlib.sha256(b).hexdigest()

def extract_embedded(setup:Path,work:Path):
    raw=setup.read_bytes()
    e=raw.rfind(b"PK\x05\x06")
    if e<0: raise SystemExit("embedded ZIP not found")
    _,_,_,_,entries,cd_size,cd_off,comment_len=struct.unpack_from("<4s4H2LH",raw,e)
    start=e-cd_size-cd_off; end=e+22+comment_len
    zpath=work/"base-payload.zip"; zpath.write_bytes(raw[start:end])
    root=work/"payload"; root.mkdir()
    with zipfile.ZipFile(zpath) as z:z.extractall(root)
    return raw,start,end,entries,root

def replace_class(dst:str,src:str,class_name:str,next_class:str):
    a=dst.index(f"  class {class_name}")
    b=dst.index(f"  class {next_class}",a)
    sa=src.index(f"  class {class_name}")
    sb=src.index(f"  class {next_class}",sa)
    return dst[:a]+src[sa:sb]+dst[b:]

def patch_payload(root:Path,repo:Path,runtime:Path,rivdir:Path):
    static=root/"static"

    # Preserve accepted v2.0.3.1 behaviour and replace only the Rive adapter block.
    accepted_engine=(static/"avatar-engine.js").read_text(encoding="utf-8")
    source_engine=(repo/"reverse/v202-ui/static/avatar-engine.js").read_text(encoding="utf-8")
    accepted_engine=replace_class(accepted_engine,source_engine,"RiveAvatarAdapter","AvatarController")
    if "upgradeAdapter(adapter)" not in accepted_engine:
        needle="    snapshot(){return {emotion:this.engine.snapshot(),performance:this.performance.snapshot()};}\n"
        method="""    upgradeAdapter(adapter){
      if(!adapter) return this;
      const previous=this.adapter;
      this.adapter=adapter;
      this.performance.adapter=adapter;
      try{previous?.destroy?.();}catch(_){}
      this._apply();
      return this;
    }
"""
        if needle not in accepted_engine: raise SystemExit("AvatarController snapshot insertion point missing")
        accepted_engine=accepted_engine.replace(needle,needle+method,1)
    (static/"avatar-engine.js").write_text(accepted_engine,encoding="utf-8")

    # Add the local Rive runtime bridge. No CDN/runtime network dependency.
    shutil.copy2(repo/"reverse/v202-ui/static/rive-avatar-bridge.js",static/"rive-avatar-bridge.js")
    shutil.copy2(repo/"reverse/v202-ui/static/avatars/rive-rig-contract.json",static/"avatars/rive-rig-contract.json")
    vendor=static/"vendor"; vendor.mkdir(exist_ok=True)
    shutil.copy2(runtime,vendor/"rive.min.js")
    rr=static/"avatars/rive"; rr.mkdir(parents=True,exist_ok=True)
    mapping={"lily":"lily.riv","oliver":"oliver.riv","sara":"sara.riv","sofia":"sofia.riv"}
    for slug,name in mapping.items():
        src=rivdir/f"{slug}.riv"
        if not src.exists(): raise SystemExit(f"missing compiled rig {src}")
        shutil.copy2(src,rr/name)

    app=static/"app.js"
    a=app.read_text(encoding="utf-8")
    a=a.replace("const BUILD_ID = '2.0.3.1';",f"const BUILD_ID = '{VERSION}';",1)
    a=a.replace("navigator.serviceWorker.register('/static/sw.js?v=2.0.3.1')",f"navigator.serviceWorker.register('/static/sw.js?v={VERSION}')",1)
    old='''            <img id="avatarViseme" class="viseme-layer" src="/static/avatars/visemes/${t.slug}/REST.webp" alt="" aria-hidden="true">
          </div>
          <div class="breath-pulse" aria-hidden="true"></div>'''
    new='''            <img id="avatarViseme" class="viseme-layer" src="/static/avatars/visemes/${t.slug}/REST.webp" alt="" aria-hidden="true">
          </div>
          <canvas id="riveAvatarCanvas" class="rive-avatar-canvas" aria-label="Avatar Rive animado de ${esc(t.name)}" hidden></canvas>
          <div class="breath-pulse" aria-hidden="true"></div>'''
    if old not in a: raise SystemExit("accepted avatar stack insertion point missing")
    a=a.replace(old,new,1)
    sig='''        <div class="motor-signature">Performance Engine v1.8 de <b>${esc(t.name)}</b> · visemas reais, olhar, piscadas e voz <span class="build-tag">build ${BUILD_ID}</span></div>'''
    newsig='''        <div class="motor-signature" id="motorSignature">Rive + Performance Engine v2.1 de <b>${esc(t.name)}</b> · rig interativo, emoção e lip-sync <span class="build-tag">build ${BUILD_ID}</span></div>'''
    if sig not in a: raise SystemExit("accepted motor signature missing")
    a=a.replace(sig,newsig,1)
    mount='''    avatarController = new Avatar.AvatarController({
      teacherId: state.teacher,
      rig: $('#avatarRig'), img: $('#avatarPortrait'), visemeImg: $('#avatarViseme'), label: $('#emotionLabel'), status: $('#avatarState'),
      storage: window.localStorage
    }).mount();
'''
    attach=mount+'''    {
      const controllerAtMount=avatarController;
      const rig=$('#avatarRig'), canvas=$('#riveAvatarCanvas'), signature=$('#motorSignature');
      Promise.resolve(window.ProfessoresRive?.attach?.({
        controller:controllerAtMount, teacherId:state.teacher, rig, canvas,
        label:$('#emotionLabel'), status:$('#avatarState')
      })).then(result=>{
        if(controllerAtMount!==avatarController)return;
        if(result?.ok){
          if(signature) signature.innerHTML=`Rive nativo + Performance Engine v2.1 de <b>${esc(t.name)}</b> · respiração, estados e boca integrados ao personagem <span class="build-tag">build ${BUILD_ID}</span>`;
        }else{
          if(signature) signature.innerHTML=`Performance Engine v2.1 de <b>${esc(t.name)}</b> · fallback visual ativo <span class="build-tag">build ${BUILD_ID}</span>`;
        }
      }).catch(()=>{});
    }
'''
    if mount not in a: raise SystemExit("accepted controller mount missing")
    a=a.replace(mount,attach,1)
    app.write_text(a,encoding="utf-8")

    idx=static/"index.html"; h=idx.read_text(encoding="utf-8")
    old='''  <script src="/static/performance-engine.js?v=2.0.3" defer></script>
  <script src="/static/avatar-engine.js?v=2.0.3" defer></script>
  <script src="/static/app.js?v=2.0.3" defer></script>'''
    new=f'''  <script src="/static/performance-engine.js?v={VERSION}" defer></script>
  <script src="/static/avatar-engine.js?v={VERSION}" defer></script>
  <script src="/static/rive-avatar-bridge.js?v={VERSION}" defer></script>
  <script src="/static/app.js?v={VERSION}" defer></script>'''
    if old not in h: raise SystemExit("accepted index scripts missing")
    idx.write_text(h.replace(old,new,1),encoding="utf-8")

    css=static/"styles.css"; c=css.read_text(encoding="utf-8")
    c+='''

/* v2.1 native Rive renderer. Accepted raster engine remains the fallback. */
.rive-avatar-canvas{position:absolute;inset:0;width:100%;height:100%;z-index:4;display:block}
.avatar-rig.rive-native-active .performance-stack{visibility:hidden;pointer-events:none}
.avatar-rig.rive-native-active .breath-pulse{display:none}
.avatar-rig.rive-native-active .rive-avatar-canvas{visibility:visible}
.avatar-rig[data-renderer="rive"]{background:transparent}
'''
    css.write_text(c,encoding="utf-8")

    sw=static/"sw.js"
    s=sw.read_text(encoding="utf-8").replace("const CACHE='professores-ia-v2.0.3.1';",f"const CACHE='professores-ia-v{VERSION}';",1)
    sw.write_text(s,encoding="utf-8")
    (root/"VERSION.txt").write_text(VERSION+"\n",encoding="utf-8")

    readme=root/"LEIA_PRIMEIRO.txt"
    r=readme.read_text(encoding="utf-8")
    r += f"""\n\nNOVIDADES {VERSION}:\n- avatares Rive locais para os quatro professores;\n- estados idle/listening/thinking/speaking;\n- 12 visemas dentro do rig, sem camada de nariz;\n- runtime Rive empacotado localmente, sem CDN;\n- renderer 2.0.3.1 preservado como fallback automático.\n"""
    readme.write_text(r,encoding="utf-8")

    manifest=root/"manifest.sha256.json"
    m=json.loads(manifest.read_text(encoding="utf-8"))
    if m.get("version")!="2.0.2":
        raise SystemExit("bootstrap manifest compatibility version changed")
    # Keep existing entries and add all new runtime assets; manifest itself is intentionally self-excluded.
    for p in sorted(root.rglob("*")):
        if not p.is_file(): continue
        rel=p.relative_to(root).as_posix()
        if rel=="manifest.sha256.json": continue
        b=p.read_bytes()
        m["files"][rel]={"sha256":sha(b),"size":len(b)}
    manifest.write_text(json.dumps(m,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")

def make_zip(root:Path,out:Path):
    with zipfile.ZipFile(out,"w",compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
        for p in sorted(root.rglob("*")):
            if not p.is_file(): continue
            rel=p.relative_to(root).as_posix()
            info=zipfile.ZipInfo(rel,FIXED_TIME)
            info.compress_type=zipfile.ZIP_DEFLATED
            info.create_system=3
            info.external_attr=(0o644&0xFFFF)<<16
            z.writestr(info,p.read_bytes(),compress_type=zipfile.ZIP_DEFLATED,compresslevel=9)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--base-setup",required=True)
    ap.add_argument("--repo",required=True)
    ap.add_argument("--runtime",required=True)
    ap.add_argument("--rivdir",required=True)
    ap.add_argument("--out",required=True)
    ap.add_argument("--work",default=".v210-work")
    args=ap.parse_args()
    setup=Path(args.base_setup); repo=Path(args.repo); runtime=Path(args.runtime); rivdir=Path(args.rivdir)
    out=Path(args.out); work=Path(args.work)
    shutil.rmtree(work,ignore_errors=True); work.mkdir(parents=True)
    raw,start,end,old_entries,root=extract_embedded(setup,work)
    patch_payload(root,repo,runtime,rivdir)
    zpath=work/"payload-v210.zip"; make_zip(root,zpath)
    with zipfile.ZipFile(zpath) as z:
        bad=z.testzip()
        if bad: raise SystemExit("corrupt payload member "+bad)
    new_payload=zpath.read_bytes()
    new_setup=raw[:start]+new_payload
    out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(new_setup)
    result={
      "version":VERSION,
      "base_setup_sha256":sha(setup.read_bytes()),
      "setup_sha256":sha(new_setup),
      "payload_sha256":sha(new_payload),
      "setup_size":len(new_setup),
      "payload_size":len(new_payload),
      "old_payload_size":end-start,
      "old_entries":old_entries,
      "new_entries":len(zipfile.ZipFile(zpath).infolist()),
      "rive_runtime_sha256":sha(runtime.read_bytes()),
      "rigs":{p.stem:sha(p.read_bytes()) for p in sorted(rivdir.glob("*.riv"))},
    }
    (out.parent/"V210_BUILD.json").write_text(json.dumps(result,indent=2)+"\n")
    print(json.dumps(result,indent=2))

if __name__=="__main__":main()
