#!/usr/bin/env python3
from pathlib import Path
import argparse, json, math
import cv2
import numpy as np
from PIL import Image, ImageDraw

VISEMES=["REST","A","E","I","O","U","MBP","FV","L","TH","SZ","SHCH"]

CFG={
 "lily":{
   "mouth_center":(385,510),"mouth_size":(104,78),"inpaint":(62,28),
   "eyes":[(316,385),(447,385)],"eye_size":(56,30),
   "frames":{
     "main":"lily-main.jpg","neutral":"lily-neutral.jpg","happy":"lily-smile.jpg",
     "amused":"lily-smirk.jpg","encouraging":"lily-smile.jpg","excited":"lily-surprise.jpg",
     "curious":"lily-smirk.jpg","thinking":"lily-serious.jpg","confused":"lily-smirk.jpg",
     "surprised":"lily-surprise.jpg","annoyed":"lily-stern.jpg","frustrated":"lily-stern.jpg",
     "sarcastic":"lily-smirk.jpg","disappointed":"lily-sigh.jpg","sad":"lily-sigh.jpg",
     "serious":"lily-serious.jpg","proud":"lily-smile.jpg","listening":"lily-neutral.jpg",
     "speaking":"lily-speaking.jpg"
   },
   "energy":0.43,"head":0.52
 },
 "oliver":{
   "mouth_center":(420,620),"mouth_size":(132,84),"inpaint":(82,34),
   "eyes":[(335,468),(477,458)],"eye_size":(60,34),
   "frames":{
     "main":"oliver-main.jpg","neutral":"oliver-neutral.jpg","happy":"oliver-smile.jpg",
     "amused":"oliver-laugh.jpg","encouraging":"oliver-agree.jpg","excited":"oliver-laugh.jpg",
     "curious":"oliver-thinking.jpg","thinking":"oliver-thinking.jpg","confused":"oliver-thinking.jpg",
     "surprised":"oliver-surprise.jpg","annoyed":"oliver-neutral.jpg","frustrated":"oliver-sigh.jpg",
     "sarcastic":"oliver-neutral.jpg","disappointed":"oliver-sigh.jpg","sad":"oliver-sigh.jpg",
     "serious":"oliver-neutral.jpg","proud":"oliver-agree.jpg","listening":"oliver-agree.jpg",
     "speaking":"oliver-speaking.jpg"
   },
   "energy":0.50,"head":0.62
 },
 "sara":{
   "mouth_center":(385,635),"mouth_size":(148,92),"inpaint":(94,39),
   "eyes":[(319,490),(456,493)],"eye_size":(59,34),
   "frames":{
     "main":"sara-main.jpg","neutral":"sara-neutral.jpg","happy":"sara-smile.jpg",
     "amused":"sara-laugh.jpg","encouraging":"sara-smile.jpg","excited":"sara-laugh.jpg",
     "curious":"sara-animated.jpg","thinking":"sara-neutral.jpg","confused":"sara-neutral.jpg",
     "surprised":"sara-surprise.jpg","annoyed":"sara-neutral.jpg","frustrated":"sara-sigh.jpg",
     "sarcastic":"sara-neutral.jpg","disappointed":"sara-sigh.jpg","sad":"sara-sigh.jpg",
     "serious":"sara-neutral.jpg","proud":"sara-smile.jpg","listening":"sara-animated.jpg",
     "speaking":"sara-speaking.jpg"
   },
   "energy":0.80,"head":0.72
 },
 "sofia":{
   "mouth_center":(390,625),"mouth_size":(142,88),"inpaint":(92,37),
   "eyes":[(319,488),(456,490)],"eye_size":(59,34),
   "frames":{
     "main":"sofia-main.jpg","neutral":"sofia-neutral.jpg","happy":"sofia-smile.jpg",
     "amused":"sofia-laugh.jpg","encouraging":"sofia-smile.jpg","excited":"sofia-laugh.jpg",
     "curious":"sofia-thinking.jpg","thinking":"sofia-thinking.jpg","confused":"sofia-thinking.jpg",
     "surprised":"sofia-surprise.jpg","annoyed":"sofia-neutral.jpg","frustrated":"sofia-neutral.jpg",
     "sarcastic":"sofia-neutral.jpg","disappointed":"sofia-neutral.jpg","sad":"sofia-neutral.jpg",
     "serious":"sofia-neutral.jpg","proud":"sofia-smile.jpg","listening":"sofia-animated.jpg",
     "speaking":"sofia-speaking.jpg"
   },
   "energy":0.90,"head":0.84
 }
}

def resize_frame(src:Path)->Image.Image:
    im=Image.open(src).convert("RGB")
    if im.size!=(768,960):
        im=im.resize((768,960),Image.Resampling.LANCZOS)
    return im

def feather_rgba(im:Image.Image)->Image.Image:
    a=np.array(im.convert("RGBA"))
    h,w=a.shape[:2]
    yy,xx=np.mgrid[0:h,0:w]
    cx,cy=w/2,h*.53
    rx,ry=w*.50,h*.49
    d=((xx-cx)/rx)**2+((yy-cy)/ry)**2
    alpha=np.clip((1.10-d)/.24,0,1)
    a[:,:,3]=(a[:,:,3].astype(float)*alpha).astype(np.uint8)
    return Image.fromarray(a)

def mouth_crop(im:Image.Image,center,size):
    cx,cy=center; w,h=size
    x0=int(cx-w/2); y0=int(cy-h/2)
    return feather_rgba(im.crop((x0,y0,x0+w,y0+h)).convert("RGBA"))

def clean_mouth(im:Image.Image,center,axes):
    rgb=np.array(im.convert("RGB"))
    bgr=cv2.cvtColor(rgb,cv2.COLOR_RGB2BGR)
    mask=np.zeros(rgb.shape[:2],np.uint8)
    cv2.ellipse(mask,center,axes,0,0,360,255,-1)
    clean=cv2.inpaint(bgr,mask,7,cv2.INPAINT_TELEA)
    return Image.fromarray(cv2.cvtColor(clean,cv2.COLOR_BGR2RGB))

def skin_target(im:Image.Image,center,size):
    cx,cy=center; w,h=size
    x0=max(0,int(cx-w*.60)); x1=min(im.width,int(cx+w*.60))
    y0=max(0,int(cy-h*.72)); y1=min(im.height,int(cy+h*.72))
    arr=np.array(im.crop((x0,y0,x1,y1)).convert("RGB"))
    # Corners around the mouth are more likely to be skin than lips/teeth.
    hh,ww=arr.shape[:2]
    mask=np.zeros((hh,ww),bool)
    mask[:max(1,hh//4),:]=True; mask[-max(1,hh//5):,:]=True
    mask[:, :max(1,ww//5)]=True; mask[:, -max(1,ww//5):]=True
    px=arr[mask]
    return np.median(px,axis=0)

def color_match(patch:Image.Image,target_rgb):
    rgba=np.array(patch.convert("RGBA")).astype(np.float32)
    alpha=rgba[:,:,3]
    rgb=rgba[:,:,:3]
    h,w=alpha.shape
    yy,xx=np.mgrid[0:h,0:w]
    edge=((xx<w*.18)|(xx>w*.82)|(yy<h*.20)|(yy>h*.82)) & (alpha>20)
    if edge.any():
        src=np.median(rgb[edge],axis=0)
        delta=np.clip(np.asarray(target_rgb)-src,-28,28)
        rgb=np.clip(rgb+delta,0,255)
    rgba[:,:,:3]=rgb
    return Image.fromarray(rgba.astype(np.uint8))

def make_blink(clean:Image.Image, cfg):
    im=clean.copy()
    draw=ImageDraw.Draw(im)
    for (cx,cy) in cfg["eyes"]:
        ew,eh=cfg["eye_size"]
        # sample eyelid color just above eye
        sx0=max(0,int(cx-ew*.28)); sx1=min(im.width,int(cx+ew*.28))
        sy0=max(0,int(cy-eh*.95)); sy1=max(sy0+1,int(cy-eh*.45))
        sample=np.array(im.crop((sx0,sy0,sx1,sy1)).convert("RGB"))
        col=tuple(int(x) for x in np.median(sample.reshape(-1,3),axis=0))
        draw.ellipse((cx-ew/2,cy-eh/2,cx+ew/2,cy+eh/2),fill=col)
        line=tuple(max(0,int(v*.45)) for v in col)
        draw.arc((cx-ew*.45,cy-eh*.08,cx+ew*.45,cy+eh*.45),190,350,fill=line,width=4)
    return im

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--payload",required=True)
    ap.add_argument("--out",default="godot/art")
    args=ap.parse_args()
    payload=Path(args.payload); avatars=payload/"static/avatars"; out=Path(args.out)
    out.mkdir(parents=True,exist_ok=True)

    for teacher,cfg in CFG.items():
        root=out/teacher
        for sub in ("frames","rest","mouth"):
            (root/sub).mkdir(parents=True,exist_ok=True)

        made={}
        # Build cleaned, standardized expression frames.
        for semantic,filename in cfg["frames"].items():
            src=avatars/filename
            if not src.exists():
                src=avatars/f"{teacher}-main.jpg"
            original=resize_frame(src)
            frame_key=Path(filename).stem.replace(f"{teacher}-","")
            if frame_key not in made:
                rest=mouth_crop(original,cfg["mouth_center"],cfg["mouth_size"])
                clean=clean_mouth(original,cfg["mouth_center"],cfg["inpaint"])
                clean.save(root/"frames"/f"{frame_key}.png",optimize=True)
                rest.save(root/"rest"/f"{frame_key}.png",optimize=True)
                made[frame_key]=True

        main_clean=Image.open(root/"frames"/"main.png").convert("RGB")
        blink=make_blink(main_clean,cfg)
        blink.save(root/"frames"/"blink.png",optimize=True)
        # Blink overlay needs no mouth cutout mismatch: keep cleaned face and current mouth is a separate sprite.
        if not (root/"rest"/"blink.png").exists():
            Image.open(root/"rest"/"main.png").save(root/"rest"/"blink.png",optimize=True)

        base_original=resize_frame(avatars/f"{teacher}-main.jpg")
        target=skin_target(base_original,cfg["mouth_center"],cfg["mouth_size"])
        vdir=avatars/"visemes"/teacher
        for v in VISEMES:
            src=vdir/f"{v}.webp"
            if not src.exists():
                src=vdir/"REST.webp"
            patch=Image.open(src).convert("RGBA").resize(cfg["mouth_size"],Image.Resampling.LANCZOS)
            patch=color_match(patch,target)
            patch=feather_rgba(patch)
            patch.save(root/"mouth"/f"{v}.png",optimize=True)

        frame_map={}
        for semantic,filename in cfg["frames"].items():
            frame_map[semantic]=Path(filename).stem.replace(f"{teacher}-","")
        meta={
            "teacher":teacher,
            "mouth_center":list(cfg["mouth_center"]),
            "energy":cfg["energy"],
            "head":cfg["head"],
            "blink_frame":"blink",
            "frames":frame_map,
            "style":"original premium language-app character; lively 2.5D; no Duolingo assets"
        }
        (root/"meta.json").write_text(json.dumps(meta,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
        print("GODOT_ART=PASS",teacher,"frames",len(made),"mouths",len(VISEMES))

if __name__=="__main__":
    main()
