extends Node2D

const MODES := ["idle", "listening", "thinking", "speaking"]
const EMOTIONS := [
    "neutral","happy","amused","encouraging","excited","curious","thinking","confused",
    "surprised","annoyed","frustrated","sarcastic","disappointed","sad","serious","proud"
]
const VISEMES := ["REST","A","E","I","O","U","MBP","FV","L","TH","SZ","SHCH"]
const VIEW_CENTER := Vector2(384.0, 480.0)

var teacher_id := "lily"
var mode := "idle"
var emotion := "neutral"
var emotion_strength := 0.35
var viseme := "REST"
var viseme_strength := 0.0
var eye_target := Vector2.ZERO
var head_target := Vector2.ZERO

var _time := 0.0
var _blink_clock := 2.4
var _blink_lock := false
var _talk_phase := 0.0
var _current_frame := "main"
var _meta: Dictionary = {}
var _frame_map: Dictionary = {}
var _energy := 0.55
var _head_gain := 0.6
var _last_command := "ready"
var _js_callback = null

var _rig: Node2D
var _portrait_a: Sprite2D
var _portrait_b: Sprite2D
var _portrait_current: Sprite2D
var _blink_overlay: Sprite2D
var _mouth: Sprite2D

func _ready() -> void:
    _build_scene()
    set_teacher(teacher_id)
    if OS.has_feature("web"):
        _install_web_bridge()
    set_process(true)

func _build_scene() -> void:
    _rig = Node2D.new()
    _rig.name = "Rig"
    _rig.position = VIEW_CENTER
    add_child(_rig)

    _portrait_a = Sprite2D.new()
    _portrait_a.centered = true
    _portrait_a.position = Vector2.ZERO
    _rig.add_child(_portrait_a)

    _portrait_b = Sprite2D.new()
    _portrait_b.centered = true
    _portrait_b.position = Vector2.ZERO
    _portrait_b.modulate = Color(1,1,1,0)
    _rig.add_child(_portrait_b)
    _portrait_current = _portrait_a

    _blink_overlay = Sprite2D.new()
    _blink_overlay.centered = true
    _blink_overlay.position = Vector2.ZERO
    _blink_overlay.modulate = Color(1,1,1,0)
    _rig.add_child(_blink_overlay)

    _mouth = Sprite2D.new()
    _mouth.centered = true
    _mouth.position = Vector2.ZERO
    _rig.add_child(_mouth)

func _install_web_bridge() -> void:
    _js_callback = JavaScriptBridge.create_callback(_on_js_command)
    var window = JavaScriptBridge.get_interface("window")
    if window:
        window._professoresGodotCommand = _js_callback
        JavaScriptBridge.eval("""
            window.ProfessoresGodot = window.ProfessoresGodot || {};
            window.ProfessoresGodot.ready = true;
            window.ProfessoresGodot.engine = 'godot-free-v2.2.0';
            window.parent && window.parent.postMessage({type:'professores-godot-ready'}, '*');
        """)

func _on_js_command(args: Array) -> void:
    if args.is_empty():
        return
    var parsed = JSON.parse_string(str(args[0]))
    if typeof(parsed) == TYPE_DICTIONARY:
        apply_command(parsed)

func apply_command(command: Dictionary) -> void:
    var kind := str(command.get("type", ""))
    match kind:
        "set_teacher": set_teacher(str(command.get("teacher", teacher_id)))
        "set_mode": set_mode(str(command.get("mode", mode)))
        "set_emotion": set_emotion(str(command.get("emotion", emotion)), float(command.get("strength", emotion_strength)))
        "set_viseme": set_viseme(str(command.get("viseme", viseme)), float(command.get("strength", 1.0)))
        "set_gaze": set_gaze(float(command.get("x", 0.0)), float(command.get("y", 0.0)))
        "set_head": set_head(float(command.get("x", 0.0)), float(command.get("y", 0.0)))
        "blink": blink()
        "snapshot": _emit_snapshot()
        _: return
    _last_command = kind

func _read_json(path: String) -> Dictionary:
    if not FileAccess.file_exists(path):
        return {}
    var parsed = JSON.parse_string(FileAccess.get_file_as_string(path))
    return parsed if typeof(parsed) == TYPE_DICTIONARY else {}

func _tex(path: String) -> Texture2D:
    var r = load(path)
    return r as Texture2D

func set_teacher(value: String) -> void:
    var key := value.to_lower()
    if not key in ["lily","oliver","sara","sofia"]:
        return
    teacher_id = key
    _meta = _read_json("res://godot/art/%s/meta.json" % teacher_id)
    _frame_map = _meta.get("frames", {})
    _energy = float(_meta.get("energy", 0.55))
    _head_gain = float(_meta.get("head", 0.60))
    var mc = _meta.get("mouth_center", [384,560])
    _mouth.position = Vector2(float(mc[0]), float(mc[1])) - VIEW_CENTER
    emotion = "neutral"
    mode = "idle"
    viseme = "REST"
    _set_frame_immediate(_resolve_frame())
    _set_rest_mouth()
    var blink_frame = str(_meta.get("blink_frame","main"))
    _blink_overlay.texture = _tex("res://godot/art/%s/frames/%s.png" % [teacher_id, blink_frame])
    _blink_overlay.modulate = Color(1,1,1,0)

func set_mode(value: String) -> void:
    var key := value.to_lower()
    if key in MODES:
        mode = key
        if mode != "speaking":
            viseme = "REST"
            viseme_strength = 0.0
        _transition_frame(_resolve_frame())
        if mode != "speaking":
            _set_rest_mouth()

func set_emotion(value: String, strength: float = 0.5) -> void:
    var key := value.to_lower()
    if key in EMOTIONS:
        emotion = key
        emotion_strength = clamp(strength, 0.0, 1.0)
        _transition_frame(_resolve_frame())
        if mode != "speaking" or viseme == "REST":
            _set_rest_mouth()

func set_viseme(value: String, strength: float = 1.0) -> void:
    var key := value.to_upper()
    if not key in VISEMES:
        return
    viseme = key
    viseme_strength = clamp(strength, 0.0, 1.0)
    if key != "REST":
        mode = "speaking"
        _mouth.texture = _tex("res://godot/art/%s/mouth/%s.png" % [teacher_id, key])
        _mouth.modulate = Color(1,1,1, max(0.55, viseme_strength))
    else:
        _set_rest_mouth()

func set_gaze(x: float, y: float) -> void:
    eye_target = Vector2(clamp(x, -1.0, 1.0), clamp(y, -1.0, 1.0))

func set_head(x: float, y: float) -> void:
    head_target = Vector2(clamp(x, -1.0, 1.0), clamp(y, -1.0, 1.0))

func blink() -> void:
    if _blink_lock:
        return
    _blink_lock = true
    _blink_overlay.modulate = Color(1,1,1,0)
    var t = create_tween()
    t.tween_property(_blink_overlay, "modulate", Color(1,1,1,1), 0.045)
    t.tween_interval(0.055)
    t.tween_property(_blink_overlay, "modulate", Color(1,1,1,0), 0.070)
    t.tween_callback(func(): _blink_lock = false)

func snapshot() -> Dictionary:
    return {
        "engine":"godot-free-v2.2.0", "teacher":teacher_id, "mode":mode,
        "emotion":emotion, "emotion_strength":emotion_strength,
        "viseme":viseme, "viseme_strength":viseme_strength,
        "frame":_current_frame, "gaze":{"x":eye_target.x,"y":eye_target.y},
        "head":{"x":head_target.x,"y":head_target.y}, "last_command":_last_command
    }

func _emit_snapshot() -> void:
    if OS.has_feature("web"):
        var payload := JSON.stringify(snapshot())
        JavaScriptBridge.eval("window.parent && window.parent.postMessage({type:'professores-godot-snapshot',payload:%s}, '*');" % JSON.stringify(payload))

func _resolve_frame() -> String:
    var key := emotion
    if mode == "thinking": key = "thinking"
    elif mode == "listening" and emotion in ["neutral","serious"]: key = "listening"
    elif mode == "speaking" and emotion in ["neutral","serious"]: key = "speaking"
    var frame := str(_frame_map.get(key, _frame_map.get("neutral", "main")))
    var path = "res://godot/art/%s/frames/%s.png" % [teacher_id, frame]
    if not ResourceLoader.exists(path):
        frame = "main"
    return frame

func _set_frame_immediate(frame: String) -> void:
    _current_frame = frame
    var texture = _tex("res://godot/art/%s/frames/%s.png" % [teacher_id, frame])
    _portrait_a.texture = texture
    _portrait_b.texture = texture
    _portrait_a.modulate = Color.WHITE
    _portrait_b.modulate = Color(1,1,1,0)
    _portrait_current = _portrait_a

func _transition_frame(frame: String) -> void:
    if frame == _current_frame:
        return
    var next := _portrait_b if _portrait_current == _portrait_a else _portrait_a
    next.texture = _tex("res://godot/art/%s/frames/%s.png" % [teacher_id, frame])
    next.modulate = Color(1,1,1,0)
    var old := _portrait_current
    var tw = create_tween().set_parallel(true)
    tw.tween_property(next, "modulate", Color.WHITE, 0.12)
    tw.tween_property(old, "modulate", Color(1,1,1,0), 0.12)
    _portrait_current = next
    _current_frame = frame

func _set_rest_mouth() -> void:
    var path = "res://godot/art/%s/rest/%s.png" % [teacher_id, _current_frame]
    if not ResourceLoader.exists(path):
        path = "res://godot/art/%s/mouth/REST.png" % teacher_id
    _mouth.texture = _tex(path)
    _mouth.modulate = Color.WHITE

func _process(delta: float) -> void:
    _time += delta
    _talk_phase += delta * 10.0
    _blink_clock -= delta
    if _blink_clock <= 0.0:
        blink()
        var interval := lerp(5.8, 2.8, _energy)
        if emotion in ["surprised","excited"]: interval *= 0.78
        if emotion in ["thinking","serious","sarcastic"]: interval *= 1.18
        _blink_clock = interval + fmod(_time * 0.73, 1.8)

    var breath := sin(_time * (1.25 + _energy * 0.45))
    var talk_bob := 0.0
    var talk_roll := 0.0
    if mode == "speaking":
        talk_bob = sin(_talk_phase * 0.72) * (0.8 + _energy * 1.3)
        talk_roll = sin(_talk_phase * 0.39) * 0.004 * _head_gain

    var listen_tilt := -0.010 * _head_gain if mode == "listening" else 0.0
    var think_tilt := 0.018 * _head_gain if mode == "thinking" else 0.0
    var target_rot := head_target.x * 0.045 * _head_gain + listen_tilt + think_tilt + talk_roll
    var target_pos := VIEW_CENTER + Vector2(
        eye_target.x * 1.8 * _head_gain,
        head_target.y * 4.0 + breath * (0.55 + _energy * 0.7) + talk_bob
    )
    _rig.rotation = lerp(_rig.rotation, target_rot, 1.0 - exp(-delta * 6.5))
    _rig.position = _rig.position.lerp(target_pos, 1.0 - exp(-delta * 5.8))
    var s := 1.0 + breath * 0.0018 * _energy
    _rig.scale = _rig.scale.lerp(Vector2(s,s), 1.0 - exp(-delta * 4.0))

    if mode == "speaking" and viseme != "REST":
        var pulse := 0.94 + abs(sin(_talk_phase)) * 0.06
        _mouth.scale = Vector2(1.0, pulse)
    else:
        _mouth.scale = _mouth.scale.lerp(Vector2.ONE, 1.0 - exp(-delta * 10.0))
