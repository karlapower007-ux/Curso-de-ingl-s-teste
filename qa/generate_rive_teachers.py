#!/usr/bin/env python3
"""Generate Rive-native layered teachers from the accepted v2.0.3.1 artwork.

The base portrait is inpainted only where the original mouth lives.  Each viseme
becomes a small RGBA mouth-only asset with a feathered ellipse; no nose/upper
face is included.  Rive blends the 12 mouth poses on a dedicated state-machine
layer while the conversation mode layer animates the whole portrait.
"""
from __future__ import annotations
from pathlib import Path
import argparse, math, shutil
import cv2
import numpy as np
from PIL import Image

VISEMES=["REST","A","E","I","O","U","MBP","FV","L","TH","SZ","SHCH"]
CONFIG={
    "lily":   {"main":"lily-main.jpg",   "center":(385,510),"size":(86,67), "inpaint":(58,25)},
    "oliver": {"main":"oliver-main.jpg", "center":(420,620),"size":(122,78),"inpaint":(78,32)},
    "sara":   {"main":"sara-main.jpg",   "center":(385,635),"size":(152,88),"inpaint":(96,38)},
    "sofia":  {"main":"sofia-main.jpg",  "center":(390,625),"size":(142,84),"inpaint":(92,36)},
}
SCALE=500/768

def feather_rgba(im:Image.Image, center_y=.60)->Image.Image:
    a=np.array(im.convert("RGBA"))
    h,w=a.shape[:2]
    yy,xx=np.mgrid[0:h,0:w]
    cx,cy=w/2,h*center_y
    rx,ry=w*.50,h*.48
    d=((xx-cx)/rx)**2+((yy-cy)/ry)**2
    alpha=np.clip((1.12-d)/0.28,0,1)
    a[:,:,3]=(a[:,:,3].astype(float)*alpha).astype(np.uint8)
    return Image.fromarray(a)

def prepare_assets(payload:Path,out:Path,teacher:str):
    cfg=CONFIG[teacher]
    src=payload/"static"/"avatars"/cfg["main"]
    vdir=payload/"static"/"avatars"/"visemes"/teacher
    assert src.exists(),src
    assert vdir.exists(),vdir
    rgb=np.array(Image.open(src).convert("RGB"))
    bgr=cv2.cvtColor(rgb,cv2.COLOR_RGB2BGR)
    mask=np.zeros(rgb.shape[:2],np.uint8)
    cv2.ellipse(mask,cfg["center"],cfg["inpaint"],0,0,360,255,-1)
    clean=cv2.inpaint(bgr,mask,7,cv2.INPAINT_TELEA)
    Image.fromarray(cv2.cvtColor(clean,cv2.COLOR_BGR2RGB)).save(out/"base.png",optimize=True)

    tw,th=cfg["size"]; cx,cy=cfg["center"]
    # REST comes from the accepted main portrait, so idle reconstructs the original face.
    x0=max(0,int(cx-tw/2)); y0=max(0,int(cy-th/2))
    rest=Image.fromarray(rgb).crop((x0,y0,x0+tw,y0+th)).convert("RGBA")
    rest=feather_rgba(rest,.50)
    rest.save(out/"mouth_REST.png",optimize=True)

    for v in VISEMES[1:]:
        srcv=Image.open(vdir/f"{v}.webp").convert("RGBA")
        w,h=srcv.size
        crop=srcv.crop((max(0,int(.08*w)),int(.28*h),min(w,int(.92*w)),h))
        crop=crop.resize((tw,th),Image.Resampling.LANCZOS)
        crop=feather_rgba(crop,.60)
        crop.save(out/f"mouth_{v}.png",optimize=True)

def keyed(obj_id:str,prop:int,values):
    frames=[]
    for frame,value in values:
        frames.append(f'          <KeyFrameDouble value="{value}" interpolationType="cubic" frame="{frame}"/>')
    return f'''      <KeyedObject objectId="{obj_id}">
        <KeyedProperty propertyKey="{prop}">
{chr(10).join(frames)}
        </KeyedProperty>
      </KeyedObject>'''

def pose_animation(anim_id:int,name:str,active:int):
    blocks=[]
    for idx in range(len(VISEMES)):
        blocks.append(f'''      <KeyedObject objectId="0:{310+idx}">
        <KeyedProperty propertyKey="18"><KeyFrameDouble value="{1 if idx==active else 0}" interpolationType="linear"/></KeyedProperty>
      </KeyedObject>''')
    return f'''    <LinearAnimation fps="60" duration="1" name="Viseme {name}" id="0:{anim_id}">
{chr(10).join(blocks)}
    </LinearAnimation>'''

def mode_state(state_id,anim_id,others):
    transitions=[]
    input_ids={"idle":201,"listening":202,"thinking":203,"speaking":204}
    for mode,target in others:
        duration=120 if mode=="speaking" else 180
        transitions.append(f'          <StateTransition stateToId="0:{target}" duration="{duration}"><TransitionBoolCondition inputId="0:{input_ids[mode]}" opValue="equal"/></StateTransition>')
    return f'''        <AnimationState x="180" y="{(state_id-240)*100}" animationId="0:{anim_id}" id="0:{state_id}">
{chr(10).join(transitions)}
        </AnimationState>'''

def make_rml(teacher:str):
    cfg=CONFIG[teacher]
    cx,cy=cfg["center"]; tw,th=cfg["size"]
    mx=(cx-384)*SCALE; my=(cy-480)*SCALE
    base_image='''      <Image x="0" y="0" scaleX="0.651041667" scaleY="0.651041667" assetId="0:900" samplerFilter="bilinear" name="BasePortrait" id="0:20"/>'''
    mouths=[]
    for i,v in enumerate(VISEMES):
        mouths.append(f'      <Image x="{mx:.4f}" y="{my:.4f}" scaleX="{SCALE:.9f}" scaleY="{SCALE:.9f}" opacity="{1 if i==0 else 0}" assetId="0:{910+i}" samplerFilter="bilinear" name="Mouth_{v}" id="0:{310+i}"/>')

    mode_anims=f'''
    <LinearAnimation fps="60" duration="180" loopValue="loop" name="Idle" id="0:100">
{keyed("0:10",14,[(0,312.5),(90,310.5),(180,312.5)])}
{keyed("0:10",15,[(0,-.004),(90,.004),(180,-.004)])}
    </LinearAnimation>
    <LinearAnimation fps="60" duration="1" name="Listening" id="0:101">
{keyed("0:10",13,[(0,246)])}
{keyed("0:10",14,[(0,309)])}
{keyed("0:10",15,[(0,-.025)])}
    </LinearAnimation>
    <LinearAnimation fps="60" duration="120" loopValue="loop" name="Thinking" id="0:102">
{keyed("0:10",13,[(0,250),(60,254),(120,250)])}
{keyed("0:10",15,[(0,.018),(60,.035),(120,.018)])}
    </LinearAnimation>
    <LinearAnimation fps="60" duration="36" loopValue="loop" name="Speaking" id="0:103">
{keyed("0:10",14,[(0,312.5),(18,309.5),(36,312.5)])}
{keyed("0:10",17,[(0,1),(18,1.008),(36,1)])}
    </LinearAnimation>'''

    viseme_anims="\n".join(pose_animation(400+i,v,i) for i,v in enumerate(VISEMES))
    blends="\n".join(
        f'          <BlendAnimation1D animationId="0:{400+i}" value="{(i*100/(len(VISEMES)-1)):.6f}"/>'
        for i in range(len(VISEMES))
    )
    modes={
      240:("idle",100,[("listening",241),("thinking",242),("speaking",243)]),
      241:("listening",101,[("idle",240),("thinking",242),("speaking",243)]),
      242:("thinking",102,[("idle",240),("listening",241),("speaking",243)]),
      243:("speaking",103,[("idle",240),("listening",241),("thinking",242)]),
    }
    mode_states="\n".join(mode_state(s,a,o) for s,(_,a,o) in modes.items())
    asset_lines=['  <ImageAsset file="base.png" name="BasePortraitAsset" id="0:900"/>']
    for i,v in enumerate(VISEMES):
        asset_lines.append(f'  <ImageAsset file="mouth_{v}.png" name="MouthAsset_{v}" id="0:{910+i}"/>')

    return f'''<Rive version="1" kind="fragment">
  <Artboard defaultStateMachineId="0:200" styleId="0:5" width="500" height="625" name="Avatar" id="0:2">
    <LayoutComponentStyle name="Artboard Style" id="0:5"/>
    <Node x="250" y="312.5" name="PortraitRig" id="0:10">
{chr(10).join(mouths)}
{base_image}
    </Node>
    <Shape x="250" y="312.5" name="Backdrop" id="0:50">
      <Rectangle width="500" height="625" name="BackdropPath"/>
      <Fill name="Fill"><SolidColor colorValue="FFF0ECFF" name="Color"/></Fill>
    </Shape>
{mode_anims}
{viseme_anims}
    <StateMachine name="AvatarStateMachine" id="0:200">
      <StateMachineBool name="isIdle" value="true" id="0:201"/>
      <StateMachineBool name="isListening" value="false" id="0:202"/>
      <StateMachineBool name="isThinking" value="false" id="0:203"/>
      <StateMachineBool name="isSpeaking" value="false" id="0:204"/>
      <StateMachineBool name="isHappy" value="false" id="0:205"/>
      <StateMachineBool name="isEncouraging" value="false" id="0:206"/>
      <StateMachineBool name="isSurprised" value="false" id="0:207"/>
      <StateMachineBool name="isConfused" value="false" id="0:208"/>
      <StateMachineBool name="isSerious" value="false" id="0:209"/>
      <StateMachineBool name="isEmpathetic" value="false" id="0:210"/>
      <StateMachineNumber name="emotion" value="0" id="0:211"/>
      <StateMachineNumber name="emotionStrength" value="30" id="0:212"/>
      <StateMachineNumber name="talkIntensity" value="0" id="0:213"/>
      <StateMachineNumber name="energyLevel" value="35" id="0:214"/>
      <StateMachineNumber name="headTurnX" value="0" id="0:215"/>
      <StateMachineNumber name="headTurnY" value="0" id="0:216"/>
      <StateMachineNumber name="eyeTargetX" value="0" id="0:217"/>
      <StateMachineNumber name="eyeTargetY" value="0" id="0:218"/>
      <StateMachineNumber name="breathLevel" value="0" id="0:219"/>
      <StateMachineNumber name="visemeIndex" value="0" id="0:220"/>
      <StateMachineNumber name="visemeStrength" value="0" id="0:221"/>
      <StateMachineLayer name="Mode" id="0:230">
        <AnyState x="520" y="-120"/><ExitState x="720" y="-120"/>
        <EntryState x="0" y="0"><StateTransition stateToId="0:240"/></EntryState>
{mode_states}
      </StateMachineLayer>
      <StateMachineLayer name="Mouth" id="0:270">
        <AnyState x="520" y="420"/><ExitState x="720" y="420"/>
        <EntryState x="0" y="420"><StateTransition stateToId="0:271"/></EntryState>
        <BlendState1DInput inputId="0:220" x="180" y="420" id="0:271">
{blends}
        </BlendState1DInput>
      </StateMachineLayer>
    </StateMachine>
  </Artboard>
{chr(10).join(asset_lines)}
</Rive>
'''

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--payload",required=True)
    ap.add_argument("--out",required=True)
    ap.add_argument("--teachers",nargs="*",default=list(CONFIG))
    args=ap.parse_args()
    payload=Path(args.payload); root=Path(args.out)
    root.mkdir(parents=True,exist_ok=True)
    for teacher in args.teachers:
        if teacher not in CONFIG: raise SystemExit(f"unknown teacher {teacher}")
        out=root/teacher
        if out.exists(): shutil.rmtree(out)
        out.mkdir(parents=True)
        prepare_assets(payload,out,teacher)
        (out/"rive.yaml").write_text(f"name: {teacher}\nlogs:\n  file: build/rive.log\n  problems: build/problems.log\n")
        (out/"scene.rml").write_text(make_rml(teacher))
        print("GENERATED",teacher,out)

if __name__=="__main__":
    main()
