#!/usr/bin/env python3
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
contract=json.loads((ROOT/"godot/avatar_contract.json").read_text(encoding="utf-8"))
src=(ROOT/"godot/avatar_demo.gd").read_text(encoding="utf-8")
project=(ROOT/"project.godot").read_text(encoding="utf-8")

required_teachers={"lily","oliver","sara","sofia"}
required_modes={"idle","listening","thinking","speaking"}
required_visemes={"REST","A","E","I","O","U","MBP","FV","L","TH","SZ","SHCH"}
required_emotions={"neutral","happy","encouraging","surprised","serious","sarcastic","sad"}

assert set(contract["teachers"]) == required_teachers
assert set(contract["modes"]) == required_modes
assert set(contract["visemes"]) == required_visemes
assert required_emotions.issubset(set(contract["emotions"]))
assert 'run/main_scene="res://godot/main.tscn"' in project

for token in [
    "func set_teacher", "func set_mode", "func set_emotion", "func set_viseme",
    "func set_gaze", "func set_head", "func snapshot", "JavaScriptBridge",
    "_blink_phase", "_breath", "_draw_mouth"
]:
    assert token in src, token

for v in required_visemes:
    assert f'"{v}"' in src, v

print("PASS godot avatar contract")
print("teachers:", len(contract["teachers"]))
print("modes:", len(contract["modes"]))
print("emotions:", len(contract["emotions"]))
print("visemes:", len(contract["visemes"]))
