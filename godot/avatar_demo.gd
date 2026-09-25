extends Node2D
## Professores IA — motor de avatar 100% gratuito em Godot 4.x.
## O objetivo deste POC é provar o comportamento: estados, microanimações,
## emoção, visemas, piscadas, respiração, olhar e integração JS por comando.
## O desenho procedural é proposital: o rig final pode receber a arte em camadas
## sem trocar a API nem a máquina de estados.

const MODES := ["idle", "listening", "thinking", "speaking"]
const EMOTIONS := [
	"neutral", "happy", "amused", "encouraging", "excited", "curious",
	"thinking", "confused", "surprised", "annoyed", "frustrated",
	"sarcastic", "disappointed", "sad", "serious", "proud"
]
const VISEMES := ["REST","A","E","I","O","U","MBP","FV","L","TH","SZ","SHCH"]

const TEACHERS := {
	"lily": {
		"name":"Lily", "skin":Color("#f0c2a6"), "hair":Color("#e8c66f"),
		"shirt":Color("#6545a8"), "warmth":0.35, "energy":0.45,
		"expressiveness":0.55, "default_emotion":"neutral"
	},
	"oliver": {
		"name":"Oliver", "skin":Color("#e3b18f"), "hair":Color("#6a4b35"),
		"shirt":Color("#315d78"), "warmth":0.75, "energy":0.50,
		"expressiveness":0.50, "default_emotion":"neutral"
	},
	"sara": {
		"name":"Sara", "skin":Color("#c98e6a"), "hair":Color("#442f2d"),
		"shirt":Color("#c04770"), "warmth":0.95, "energy":0.80,
		"expressiveness":0.85, "default_emotion":"happy"
	},
	"sofia": {
		"name":"Sofía", "skin":Color("#d79b78"), "hair":Color("#2d2423"),
		"shirt":Color("#bf5d3b"), "warmth":0.90, "energy":0.88,
		"expressiveness":0.95, "default_emotion":"happy"
	}
}

var teacher_id := "lily"
var mode := "idle"
var emotion := "neutral"
var emotion_strength := 0.35
var viseme := "REST"
var viseme_strength := 0.0
var talk_intensity := 0.0
var eye_target := Vector2.ZERO
var head_target := Vector2.ZERO

var _time := 0.0
var _breath := 0.0
var _blink := 0.0
var _blink_phase := 0.0
var _next_blink := 2.2
var _head_angle := 0.0
var _head_y := 0.0
var _talk_phase := 0.0
var _js_callback = null
var _last_command := "ready"

func _ready() -> void:
	set_process(true)
	if OS.has_feature("web"):
		_install_web_bridge()
	queue_redraw()

func _install_web_bridge() -> void:
	_js_callback = JavaScriptBridge.create_callback(_on_js_command)
	var window = JavaScriptBridge.get_interface("window")
	if window:
		window._professoresGodotCommand = _js_callback
		JavaScriptBridge.eval("""
			window.ProfessoresGodot = window.ProfessoresGodot || {};
			window.ProfessoresGodot.ready = true;
			window.ProfessoresGodot.engine = 'godot-free-v2.2.0';
		""")

func _on_js_command(args: Array) -> void:
	if args.is_empty():
		return
	var raw := str(args[0])
	var parsed = JSON.parse_string(raw)
	if typeof(parsed) == TYPE_DICTIONARY:
		apply_command(parsed)

func apply_command(command: Dictionary) -> void:
	var kind := str(command.get("type", ""))
	match kind:
		"set_teacher":
			set_teacher(str(command.get("teacher", teacher_id)))
		"set_mode":
			set_mode(str(command.get("mode", mode)))
		"set_emotion":
			set_emotion(
				str(command.get("emotion", emotion)),
				float(command.get("strength", emotion_strength))
			)
		"set_viseme":
			set_viseme(
				str(command.get("viseme", viseme)),
				float(command.get("strength", 1.0))
			)
		"set_gaze":
			set_gaze(
				float(command.get("x", 0.0)),
				float(command.get("y", 0.0))
			)
		"set_head":
			set_head(
				float(command.get("x", 0.0)),
				float(command.get("y", 0.0))
			)
		"snapshot":
			_emit_snapshot()
		_:
			return
	_last_command = kind

func set_teacher(value: String) -> void:
	var key := value.to_lower()
	if TEACHERS.has(key):
		teacher_id = key
		emotion = str(TEACHERS[key]["default_emotion"])
		queue_redraw()

func set_mode(value: String) -> void:
	var key := value.to_lower()
	if key in MODES:
		mode = key
		if mode != "speaking":
			talk_intensity = 0.0
			viseme = "REST"
			viseme_strength = 0.0

func set_emotion(value: String, strength: float = 0.5) -> void:
	var key := value.to_lower()
	if key in EMOTIONS:
		emotion = key
		emotion_strength = clamp(strength, 0.0, 1.0)

func set_viseme(value: String, strength: float = 1.0) -> void:
	var key := value.to_upper()
	if key in VISEMES:
		viseme = key
		viseme_strength = clamp(strength, 0.0, 1.0)
		talk_intensity = max(talk_intensity, viseme_strength)
		if key != "REST":
			mode = "speaking"

func set_gaze(x: float, y: float) -> void:
	eye_target = Vector2(clamp(x, -1.0, 1.0), clamp(y, -1.0, 1.0))

func set_head(x: float, y: float) -> void:
	head_target = Vector2(clamp(x, -1.0, 1.0), clamp(y, -1.0, 1.0))

func snapshot() -> Dictionary:
	return {
		"engine":"godot-free-v2.2.0",
		"teacher":teacher_id,
		"mode":mode,
		"emotion":emotion,
		"emotion_strength":emotion_strength,
		"viseme":viseme,
		"viseme_strength":viseme_strength,
		"gaze":{"x":eye_target.x,"y":eye_target.y},
		"head":{"x":head_target.x,"y":head_target.y},
		"last_command":_last_command
	}

func _emit_snapshot() -> void:
	if OS.has_feature("web"):
		var payload := JSON.stringify(snapshot())
		JavaScriptBridge.eval(
			"window.parent && window.parent.postMessage({type:'professores-godot-snapshot',payload:%s}, '*');"
			% JSON.stringify(payload)
		)

func _process(delta: float) -> void:
	_time += delta
	_breath = sin(_time * 1.7) * 0.5 + 0.5
	_talk_phase += delta * 13.0

	_next_blink -= delta
	if _next_blink <= 0.0 and _blink_phase <= 0.0:
		_blink_phase = 0.001
		var base := 2.2
		if emotion in ["surprised","excited"]:
			base = 1.7
		elif emotion in ["thinking","serious","sarcastic"]:
			base = 2.8
		_next_blink = base + fmod(_time * 0.731, 1.9)

	if _blink_phase > 0.0:
		_blink_phase += delta * 8.5
		_blink = sin(min(_blink_phase, PI))
		if _blink_phase >= PI:
			_blink_phase = 0.0
			_blink = 0.0

	var mode_head := 0.0
	var mode_y := 0.0
	if mode == "listening":
		mode_head = -0.025
		mode_y = -3.0
	elif mode == "thinking":
		mode_head = 0.035 + sin(_time * 0.8) * 0.012
		mode_y = -1.0
	elif mode == "speaking":
		mode_head = sin(_talk_phase * 0.45) * 0.012
		mode_y = sin(_talk_phase * 0.75) * 1.8

	var target_angle := mode_head + head_target.x * 0.055
	var target_y := mode_y + head_target.y * 7.0
	_head_angle = lerp(_head_angle, target_angle, 1.0 - exp(-delta * 6.0))
	_head_y = lerp(_head_y, target_y, 1.0 - exp(-delta * 6.0))

	if mode == "speaking":
		talk_intensity = lerp(talk_intensity, max(0.35, viseme_strength), 1.0 - exp(-delta * 7.0))
	else:
		talk_intensity = lerp(talk_intensity, 0.0, 1.0 - exp(-delta * 7.0))

	queue_redraw()

func _unhandled_key_input(event: InputEvent) -> void:
	if not event.pressed:
		return
	match event.keycode:
		KEY_1: set_mode("idle")
		KEY_2: set_mode("listening")
		KEY_3: set_mode("thinking")
		KEY_4: set_mode("speaking")
		KEY_H: set_emotion("happy", 0.8)
		KEY_E: set_emotion("encouraging", 0.8)
		KEY_S: set_emotion("surprised", 0.8)
		KEY_R: set_emotion("serious", 0.8)
		KEY_SPACE:
			var idx := (VISEMES.find(viseme) + 1) % VISEMES.size()
			set_viseme(VISEMES[idx], 0.9)
		KEY_TAB:
			var keys := TEACHERS.keys()
			var idx := (keys.find(teacher_id) + 1) % keys.size()
			set_teacher(str(keys[idx]))

func _draw() -> void:
	var p: Dictionary = TEACHERS[teacher_id]
	var center := Vector2(450, 445 + _head_y)
	var breath_scale := 1.0 + (_breath - 0.5) * 0.012

	# Fundo e placa de status
	draw_rect(Rect2(0,0,900,900), Color("#f5f2ed"))
	draw_string(ThemeDB.fallback_font, Vector2(28,40),
		"%s · %s · %s · %s" % [p["name"], mode, emotion, viseme],
		HORIZONTAL_ALIGNMENT_LEFT, -1, 24, Color("#292929"))

	# Ombros / tronco com respiração discreta
	var shoulder_y := 675.0
	var shoulder_w := 255.0 * breath_scale
	var torso := PackedVector2Array([
		Vector2(center.x-shoulder_w, shoulder_y+165),
		Vector2(center.x-190, shoulder_y-20),
		Vector2(center.x-105, shoulder_y-75),
		Vector2(center.x+105, shoulder_y-75),
		Vector2(center.x+190, shoulder_y-20),
		Vector2(center.x+shoulder_w, shoulder_y+165)
	])
	draw_colored_polygon(torso, p["shirt"])

	draw_set_transform(center, _head_angle, Vector2.ONE)
	_draw_hair_back(p)
	_draw_neck(p)
	_draw_face(p)
	_draw_hair_front(p)
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)

func _draw_neck(p: Dictionary) -> void:
	draw_rect(Rect2(-58, 145, 116, 115), p["skin"])

func _draw_hair_back(p: Dictionary) -> void:
	draw_colored_polygon(_ellipse(Vector2(0,-15), Vector2(188,238), 52), p["hair"])

func _draw_face(p: Dictionary) -> void:
	var face_color: Color = p["skin"]
	draw_colored_polygon(_ellipse(Vector2(0,0), Vector2(158,205), 64), face_color)

	var eye_open := max(0.06, 1.0 - _blink)
	var gaze := eye_target * Vector2(8,5)
	var surprised := emotion == "surprised" or emotion == "excited"
	var annoyed := emotion in ["annoyed","frustrated","sarcastic","serious"]
	var happy := emotion in ["happy","amused","encouraging","excited","proud"]

	var eye_w := 41.0
	var eye_h := (25.0 if surprised else 20.0) * eye_open
	var ly := -38.0
	for sx in [-1.0, 1.0]:
		var ex := sx * 58.0
		draw_colored_polygon(_ellipse(Vector2(ex,ly), Vector2(eye_w, eye_h), 28), Color.WHITE)
		if eye_open > 0.2:
			draw_circle(Vector2(ex,ly)+gaze, 8.5, Color("#263238"))
			draw_circle(Vector2(ex,ly)+gaze+Vector2(-2,-2), 2.2, Color.WHITE)

	var brow_y := -75.0
	var brow_tilt := 0.0
	if happy: brow_tilt = -3.0
	if annoyed: brow_tilt = 8.0
	if surprised: brow_y -= 8.0
	draw_line(Vector2(-94,brow_y-brow_tilt), Vector2(-28,brow_y+brow_tilt), p["hair"], 8.0, true)
	draw_line(Vector2(28,brow_y+brow_tilt), Vector2(94,brow_y-brow_tilt), p["hair"], 8.0, true)

	# Nariz simples: nunca recebe camada de boca.
	draw_line(Vector2(0,-18), Vector2(-5,30), Color(face_color,0.35), 4.0, true)

	_draw_mouth(happy, annoyed, surprised)

func _draw_mouth(happy: bool, annoyed: bool, surprised: bool) -> void:
	var y := 82.0
	var mouth_open := _viseme_open_amount()
	var width := _viseme_width_amount()
	if mode == "speaking":
		mouth_open *= 0.78 + abs(sin(_talk_phase)) * 0.22

	if emotion == "sad":
		draw_arc(Vector2(0,y+13), 43, PI*1.13, PI*1.87, 24, Color("#6d3030"), 5.0, true)
		return
	if emotion == "sarcastic":
		draw_arc(Vector2(8,y), 48, 0.18, 2.7, 24, Color("#6d3030"), 5.0, true)
		return
	if surprised and viseme == "REST":
		mouth_open = max(mouth_open, 0.42)
		width = 0.68

	if mouth_open <= 0.08:
		var curve_y := y + (-7.0 if happy else (5.0 if annoyed else 0.0))
		draw_arc(Vector2(0,curve_y), 45*width, 0.15, PI-0.15, 24, Color("#6d3030"), 5.0, true)
	else:
		var rx := 49.0 * width
		var ry := 11.0 + 40.0 * mouth_open
		draw_colored_polygon(_ellipse(Vector2(0,y), Vector2(rx,ry), 36), Color("#5c2429"))
		draw_colored_polygon(_ellipse(Vector2(0,y+ry*0.28), Vector2(rx*0.55,ry*0.28), 24), Color("#d47c86"))

func _draw_hair_front(p: Dictionary) -> void:
	var hair: Color = p["hair"]
	var fringe := PackedVector2Array([
		Vector2(-150,-118), Vector2(-112,-192), Vector2(-45,-216),
		Vector2(18,-206), Vector2(76,-218), Vector2(132,-168),
		Vector2(155,-108), Vector2(102,-130), Vector2(52,-112),
		Vector2(4,-142), Vector2(-42,-108), Vector2(-92,-132)
	])
	draw_colored_polygon(fringe, hair)

func _viseme_open_amount() -> float:
	var table := {
		"REST":0.0,"A":0.88,"E":0.42,"I":0.28,"O":0.82,"U":0.44,
		"MBP":0.04,"FV":0.16,"L":0.38,"TH":0.34,"SZ":0.18,"SHCH":0.30
	}
	return float(table.get(viseme,0.0)) * max(0.2, viseme_strength)

func _viseme_width_amount() -> float:
	var table := {
		"REST":1.0,"A":1.02,"E":1.18,"I":1.25,"O":0.72,"U":0.62,
		"MBP":1.0,"FV":1.06,"L":1.06,"TH":1.04,"SZ":1.12,"SHCH":0.94
	}
	return float(table.get(viseme,1.0))

func _ellipse(center: Vector2, radius: Vector2, segments: int = 32) -> PackedVector2Array:
	var pts := PackedVector2Array()
	for i in range(segments):
		var a := TAU * float(i) / float(segments)
		pts.append(center + Vector2(cos(a)*radius.x, sin(a)*radius.y))
	return pts
