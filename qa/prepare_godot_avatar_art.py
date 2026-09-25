#!/usr/bin/env python3
from __future__ import annotations
from pathlib import Path
import argparse, json, shutil
import cv2
import numpy as np
from PIL import Image

VISEMES=["REST","A","E","I","O","U","MBP","FV","L","TH","SZ","SHCH"]
CONFIG={
    "lily": {
        "center":(385,510),"size":(86,67),"inpaint":(58,25),"blink":"sigh",
        "frames": {"neutral":"neutral","happy":"smile","amused":"smirk","encouraging":"smile","excited":"smile","curious":"serious","thinking":"serious","confused":"stern","surprised":"surprise","annoyed":"stern","frustrated":"stern","sarcastic":"smirk","disappointed":"sigh","sad":"sigh","serious":"main","proud":"smile","speaking":"speaking","listening":"neutral"},
        "energy":0.48,"head":0.55,"name":"Lily"
    },
    "oliver": {
        "center":(420,620),"size":(122,78),"inpaint":(78,32),"blink":"sigh",
        "frames": {"neutral":"main","happy":"smile","amused":"laugh","encouraging":"agree","excited":"laugh","curious":"thinking","thinking":"thinking","confused":"thinking","surprised":"surprise","annoyed":"thinking","frustrated":"sigh","sarcastic":"smile","disappointed":"sigh","sad":"sigh","serious":"neutral","proud":"agree","speaking":"speaking","listening":"neutral"},
        "energy":0.55,"head":0.62,"name":"Oliver"
    },
    "sara": {
        "center":(385,635),"size":(152,88),"inpaint":(96,38),"blink":"blink",
        "frames": {"neutral":"main","happy":"smile","amused":"laugh","encouraging":"animated","excited":"animated","curious":"neutral","thinking":"neutral","confused":"neutral","surprised":"surprise","annoyed":"neutral","frustrated":"sigh","sarcastic":"smile","disappointed":"sigh","sad":"sigh","serious":"neutral","proud":"smile","speaking":"speaking","listening":"neutral"},
        "energy":0.88,"head":0.82,"name":"Sara"
    },
    "sofia": {
        "center":(390,625),"size":(142,84),"inpaint":(92,36),"blink":"blink",
        "frames": {"neutral":"main","happy":"smile","amused":"laugh","encouraging":"animated","excited":"animated","curious":"thinking","thinking":"thinking","confused":"thinking","surprised":"surprise","annoyed":"thinking","frustrated":"thinking","sarcastic":"smile","disappointed":"thinking","sad":"thinking","serious":"neutral","proud":"smile","speaking":"speaking","listening":"neutral"},
        "energy":0.95,"head":0.94,"name":"Sofía"
    }
}

def feather_rgba(im:Image.Image, center_y=.58)->Image.Image:
    a=np.array(im.convert("RGBA"))
    h,w=a.shape[:2]
    yy,xx=np.mgrid[0:h,0:w]
    cx,cy=w/2,h*center_y
    rx,ry=w*.50,h*.48
    d=((xx-cx)/rx)**2+((yy-cy)/ry)**2
    alpha=np.clip((1.12-d)/0.30,0,1)
    a[:,:,3]=(a[:,:,3].astype(float)*alpha).astype(np.uint8)
    return Image.fromarray(a)

def inpaint_frame(src:Path,dst:Path,center,size):
    rgb=np.array(Image.open(src).convert("RGB"))
    bgr=cv2.cvtColor(rgb,cv2.COLOR_RGB2BGR)
    mask=np.zeros(rgb.shape[:2],np.uint8)
    cv2.ellipse(mask,center,size,0,0,360,255,-1)
    clean=cv2.inpaint(bgr,mask,7,cv2.INPAINT_TELEA)
    Image.fromarray(cv2.cvtColor(clean,cv2.COLOR_BGR2RGB)).save(dst,optimize=True)

def prepare_teacher(payload:Path,out:Path,teacher:str):
    cfg=CONFIG[teacher]
    out.mkdir(parents=True,exist_ok=True)
    frames_out=out/"frames"; mouth_out=out/"mouth"; rest_out=out/"rest"
    frames_out.mkdir(exist_ok=True); mouth_out.mkdir(exist_ok=True); rest_out.mkdir(exist_ok=True)
    source_dir=payload/"static"/"avatars"
    available={}
    for src in sorted(source_dir.glob(f"{teacher}-*.jpg")):
        name=src.stem[len(teacher)+1:]
        rgb=np.array(Image.open(src).convert("RGB"))
        tw,th=cfg["size"]; cx,cy=cfg["center"]
        x0=max(0,int(cx-tw/2)); y0=max(0,int(cy-th/2))
        rest=Image.fromarray(rgb).crop((x0,y0,x0+tw,y0+th)).convert("RGBA")
        feather_rgba(rest,.52).save(rest_out/f"{name}.png",optimize=True)
        dst=frames_out/f"{name}.png"
        inpaint_frame(src,dst,cfg["center"],cfg["inpaint"])
        available[name]=dst.name
    if "main" not in available:
        raise SystemExit(f"missing main frame for {teacher}")

    vdir=source_dir/"visemes"/teacher
    tw,th=cfg["size"]; cx,cy=cfg["center"]
    main=np.array(Image.open(source_dir/f"{teacher}-main.jpg").convert("RGB"))
    x0=max(0,int(cx-tw/2)); y0=max(0,int(cy-th/2))
    rest=Image.fromarray(main).crop((x0,y0,x0+tw,y0+th)).convert("RGBA")
    feather_rgba(rest,.50).save(mouth_out/"REST.png",optimize=True)
    for v in VISEMES[1:]:
        srcv=Image.open(vdir/f"{v}.webp").convert("RGBA")
        w,h=srcv.size
        crop=srcv.crop((max(0,int(.07*w)),int(.30*h),min(w,int(.93*w)),h))
        crop=crop.resize((tw,th),Image.Resampling.LANCZOS)
        feather_rgba(crop,.62).save(mouth_out/f"{v}.png",optimize=True)

    meta={
        "teacher":teacher,"name":cfg["name"],"canvas":[768,960],
        "mouth_center":list(cfg["center"]),"mouth_size":list(cfg["size"]),
        "blink_frame":cfg["blink"] if cfg["blink"] in available else "main",
        "frames":cfg["frames"],"available_frames":sorted(available),
        "energy":cfg["energy"],"head":cfg["head"],"visemes":VISEMES
    }
    (out/"meta.json").write_text(json.dumps(meta,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    return meta

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--payload",required=True)
    ap.add_argument("--out",default="godot/art")
    args=ap.parse_args()
    payload=Path(args.payload); root=Path(args.out)
    if root.exists(): shutil.rmtree(root)
    root.mkdir(parents=True)
    summary={}
    for teacher in CONFIG:
        summary[teacher]=prepare_teacher(payload,root/teacher,teacher)
        print("GODOT_ART=PASS",teacher,len(summary[teacher]["available_frames"]),"frames")
    (root/"index.json").write_text(json.dumps(summary,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")

if __name__=="__main__":
    main()
