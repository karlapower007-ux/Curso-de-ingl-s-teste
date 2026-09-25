extends Node2D
## Professores IA — real-art Godot avatar renderer.
## Full-frame expression morphing deliberately replaces the old "mouth patch"
## approach: no rectangular skin/mouth overlay is drawn on top of the face.
## The existing Emotion/Performance Engine drives this renderer through the
## JavaScript bridge when exported for Web.

const MODES = ["idle", "listening", "thinking", "speaking"]
const EMOTIONS = [
	"neutral", "happy", "amused", "encouraging", "excited", "curious",
	"thinking", "confused", "surprised", "annoyed", "frustrated",
	"sarcastic", "disappointed", "sad", "serious", "proud"
]
const VISEMES = ["REST","A","E","I","O","U","MBP","FV","L","TH","SZ","SHCH"]

const TEACHER_ALIASES = {
	"original":"lily", "lily":"lily",
	"british":"oliver", "oliver":"oliver",
	"american":"sara", "sara":"sara",
	"latina":"sofia", "sofia":"sofia", "sofía":"sofia"
}

const FRAMES = {
	"lily": {
		"neutral":"lily-neutral.jpg", "speaking":"lily-speaking.jpg",
		"blink":"lily-sigh.jpg", "happy":"lily-smile.jpg",
		"amused":"lily-smirk.jpg", "encouraging":"lily-smile.jpg",
		"excited":"lily-surprise.jpg", "curious":"lily-smirk.jpg",
		"thinking":"lily-serious.jpg", "confused":"lily-surprise.jpg",
		"surprised":"lily-surprise.jpg", "annoyed":"lily-stern.jpg",
		"frustrated":"lily-stern.jpg", "sarcastic":"lily-smirk.jpg",
		"disappointed":"lily-sigh.jpg", "sad":"lily-sigh.jpg",
		"serious":"lily-serious.jpg", "proud":"lily-smile.jpg"
	},
	"oliver": {
		"neutral":"oliver-neutral.jpg", "speaking":"oliver-speaking.jpg",
		"blink":"oliver-agree.jpg", "happy":"oliver-smile.jpg",
		"amused":"oliver-laugh.jpg", "encouraging":"oliver-agree.jpg",
		"excited":"oliver-surprise.jpg", "curious":"oliver-thinking.jpg",
		"thinking":"oliver-thinking.jpg", "confused":"oliver-surprise.jpg",
		"surprised":"oliver-surprise.jpg", "annoyed":"oliver-thinking.jpg",
		"frustrated":"oliver-sigh.jpg", "sarcastic":"oliver-sigh.jpg",
		"disappointed":"oliver-sigh.jpg", "sad":"oliver-sigh.jpg",
		"serious":"oliver-thinking.jpg", "proud":"oliver-smile.jpg"
	},
	"sara": {
		"neutral":"sara-neutral.jpg", "speaking":"sara-speaking.jpg",
		"blink":"sara-blink.jpg", "happy":"sara-smile.jpg",
		"amused":"sara-laugh.jpg", "encouraging":"sara-smile.jpg",
		"excited":"sara-animated.jpg", "curious":"sara-animated.jpg",
		"thinking":"sara-sigh.jpg", "confused":"sara-surprise.jpg",
		"surprised":"sara-surprise.jpg", "annoyed":"sara-sigh.jpg",
		"frustrated":"sara-sigh.jpg", "sarcastic":"sara-animated.jpg",
		"disappointed":"sara-sigh.jpg", "sad":"sara-sigh.jpg",
		"serious":"sara-neutral.jpg", "proud":"sara-smile.jpg"
	},
	"sofia": {
		"neutral":"sofia-neutral.jpg", "speaking":"sofia-speaking.jpg",
		"blink":"sofia-blink.jpg", "happy":"sofia-smile.jpg",
		"amused":"sofia-laugh.jpg", "encouraging":"sofia-smile.jpg",
		"excited":"sofia-animated.jpg", "curious":"sofia-thinking.jpg",
		"thinking":"sofia-thinking.jpg", "confused":"sofia-surprise.jpg",
		"surprised":"sofia-surprise.jpg", "annoyed":"sofia-thinking.jpg",
		"frustrated":"sofia-thinking.jpg", "sarcastic":"sofia-smile.jpg",
		"disappointed":"sofia-thinking.jpg", "sad":"sofia-thinking.jpg",
		"serious":"sofia-neutral.jpg", "proud":"sofia-smile.jpg"
	}
}

var teacher_id = "lily"
var mode = "idle"
var emotion = "neutral"
var emotion_strength = 0.35
var viseme = "REST"
var viseme_strength = 0.0
var eye_target = Vector2.ZERO
var head_target = Vector2.ZERO

var _textures = {}
var _frame_key = ""
var _from_texture = null
var _to_texture = null
var _blend = 1.0
var _time = 0.0
var _blink_left = 2.3
var _blink_active = false
var _blink_elapsed = 0.0
var _head_angle = 0.0
var _head_offset = Vector2.ZERO
var _js_callback = null
var _last_command = "ready"

func _ready():
	_load_teacher_textures()
	_request_frame(_desired_frame(), true)
	set_process(true)
	if OS.has_feature("web"):
		_install_web_bridge()
	queue_redraw()

func _load_teacher_textures():
	_textures.clear()
	for key in FRAMES[teacher_id].keys():
		var filename = FRAMES[teacher_id][key]
		var path = "res://godot/assets/" + filename
		if ResourceLoader.exists(path):
			_textures[key] = load(path)

func _install_web_bridge():
	_js_callback = JavaScriptBridge.create_callback(_on_js_command)
	var window = JavaScriptBridge.get_interface("window")
	if window:
		window._professoresGodotCommand = _js_callback
		JavaScriptBridge.eval("""
			window.ProfessoresGodot = window.ProfessoresGodot || {};
			window.ProfessoresGodot.ready = true;
			window.ProfessoresGodot.engine = 'godot-real-art-v2.2.0';
		""")

func _on_js_command(args):
	if args.is_empty():
		return
	var parsed = JSON.parse_string(str(args[0]))
	if typeof(parsed) == TYPE_DICTIONARY:
		apply_command(parsed)

func apply_command(command):
	var kind = str(command.get("type", ""))
	match kind:
		"set_teacher":
			set_teacher(str(command.get("teacher", teacher_id)))
		"set_mode":
			set_mode(str(command.get("mode", mode)))
		"set_emotion":
			set_emotion(str(command.get("emotion", emotion)), float(command.get("strength", emotion_strength)))
		"set_viseme":
			set_viseme(str(command.get("viseme", viseme)), float(command.get("strength", 1.0)))
		"set_gaze":
			set_gaze(float(command.get("x", 0.0)), float(command.get("y", 0.0)))
		"set_head":
			set_head(float(command.get("x", 0.0)), float(command.get("y", 0.0)))
		"event":
			trigger_event(str(command.get("event", "")), float(command.get("strength", 0.5)))
		"snapshot":
			_emit_snapshot()
		_:
			return
	_last_command = kind

func set_teacher(value):
	var key = str(value).to_lower()
	key = TEACHER_ALIASES.get(key, teacher_id)
	if key == teacher_id:
		return
	teacher_id = key
	_textures.clear()
	_load_teacher_textures()
	_frame_key = ""
	_request_frame(_desired_frame(), true)

func set_mode(value):
	var key = str(value).to_lower()
	if key in MODES:
		mode = key
		if mode != "speaking":
			viseme = "REST"
			viseme_strength = 0.0
		_request_frame(_desired_frame())

func set_emotion(value, strength = 0.5):
	var key = str(value).to_lower()
	if key in EMOTIONS:
		emotion = key
		emotion_strength = clamp(float(strength), 0.0, 1.0)
		_request_frame(_desired_frame())

func set_viseme(value, strength = 1.0):
	var key = str(value).to_upper()
	if key in VISEMES:
		viseme = key
		viseme_strength = clamp(float(strength), 0.0, 1.0)
		if key != "REST":
			mode = "speaking"
		_request_frame(_desired_frame())

func set_gaze(x, y):
	eye_target = Vector2(clamp(float(x), -1.0, 1.0), clamp(float(y), -1.0, 1.0))

func set_head(x, y):
	head_target = Vector2(clamp(float(x), -1.0, 1.0), clamp(float(y), -1.0, 1.0))

func trigger_event(event_name, _strength = 0.5):
	match event_name:
		"blink", "blink_left", "blink_right":
			_start_blink()
		"laugh":
			set_emotion("amused", 0.75)
		"sigh":
			set_emotion("disappointed", 0.62)
		"head_nod":
			head_target.y = 0.55
		"look_side":
			head_target.x = 0.55
		"look_up":
			head_target.y = -0.45

func snapshot():
	return {
		"engine":"godot-real-art-v2.2.0",
		"teacher":teacher_id, "mode":mode, "emotion":emotion,
		"emotion_strength":emotion_strength, "viseme":viseme,
		"viseme_strength":viseme_strength,
		"frame":_frame_key,
		"assets_loaded":_textures.size(),
		"gaze":{"x":eye_target.x,"y":eye_target.y},
		"head":{"x":head_target.x,"y":head_target.y},
		"last_command":_last_command
	}

func _emit_snapshot():
	if OS.has_feature("web"):
		var payload = JSON.stringify(snapshot())
		JavaScriptBridge.eval(
			"window.parent && window.parent.postMessage({type:'professores-godot-snapshot',payload:%s}, '*');"
			% JSON.stringify(payload)
		)

func _start_blink():
	if _textures.has("blink"):
		_blink_active = true
		_blink_elapsed = 0.0
		_request_frame("blink")

func _desired_frame():
	if _blink_active and _textures.has("blink"):
		return "blink"
	if mode == "speaking":
		if viseme in ["REST", "MBP"]:
			return _emotion_frame()
		if viseme in ["E", "I", "FV", "SZ"] and _textures.has("happy"):
			return "happy"
		if viseme in ["O", "U"] and _textures.has("surprised"):
			return "surprised"
		return "speaking"
	return _emotion_frame()

func _emotion_frame():
	if _textures.has(emotion):
		return emotion
	return "neutral"

func _request_frame(key, immediate = false):
	if not _textures.has(key):
		key = "neutral"
	if not _textures.has(key):
		return
	if key == _frame_key and _to_texture != null:
		return
	var next_texture = _textures[key]
	if immediate or _to_texture == null:
		_from_texture = next_texture
		_to_texture = next_texture
		_blend = 1.0
	else:
		_from_texture = _to_texture
		_to_texture = next_texture
		_blend = 0.0
	_frame_key = key
	queue_redraw()

func _process(delta):
	_time += delta
	if _blend < 1.0:
		var transition_speed = 11.0 if mode == "speaking" else 7.5
		_blend = min(1.0, _blend + delta * transition_speed)

	_blink_left -= delta
	if _blink_left <= 0.0 and not _blink_active:
		_start_blink()
		_blink_left = 2.2 + fmod(_time * 0.791, 2.1)

	if _blink_active:
		_blink_elapsed += delta
		if _blink_elapsed >= 0.12:
			_blink_active = false
			_request_frame(_desired_frame())

	var target_angle = head_target.x * 0.042
	var target_y = head_target.y * 5.0
	var target_x = eye_target.x * 2.8
	if mode == "listening":
		target_angle -= 0.018
		target_y -= 2.0
	elif mode == "thinking":
		target_angle += 0.026 + sin(_time * 0.7) * 0.006
		target_y -= 1.0
	elif mode == "speaking":
		target_angle += sin(_time * 4.6) * 0.006 * max(0.3, viseme_strength)
		target_y += sin(_time * 6.0) * 1.1 * max(0.25, viseme_strength)

	_head_angle = lerp(_head_angle, target_angle, 1.0 - exp(-delta * 6.2))
	_head_offset.x = lerp(_head_offset.x, target_x, 1.0 - exp(-delta * 5.0))
	_head_offset.y = lerp(_head_offset.y, target_y, 1.0 - exp(-delta * 5.0))
	queue_redraw()

func _draw():
	draw_rect(Rect2(0, 0, 512, 640), Color("#eee9ff"))
	if _to_texture != null:
		var breath = sin(_time * 1.55) * 0.0035
		var speak_zoom = 0.0
		if mode == "speaking":
			speak_zoom = viseme_strength * 0.004
		var scale = Vector2(1.0 + breath + speak_zoom, 1.0 + breath + speak_zoom)
		var center = Vector2(256, 320) + _head_offset
		draw_set_transform(center, _head_angle, scale)
		var rect = Rect2(-256, -320, 512, 640)
		if _from_texture != null and _blend < 1.0:
			draw_texture_rect(_from_texture, rect, false, Color(1, 1, 1, 1.0 - _blend))
		draw_texture_rect(_to_texture, rect, false, Color(1, 1, 1, _blend))
		draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
	else:
		_draw_fallback()

func _draw_fallback():
	draw_circle(Vector2(256, 285), 145, Color("#e3a27f"))
	draw_circle(Vector2(205, 260), 14, Color("#263238"))
	draw_circle(Vector2(307, 260), 14, Color("#263238"))
	draw_arc(Vector2(256, 340), 52, 0.15, PI - 0.15, 24, Color("#713b43"), 6.0)

func _unhandled_key_input(event):
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
			var idx = (VISEMES.find(viseme) + 1) % VISEMES.size()
			set_viseme(VISEMES[idx], 0.9)
		KEY_TAB:
			var keys = ["lily","oliver","sara","sofia"]
			var idx = (keys.find(teacher_id) + 1) % keys.size()
			set_teacher(keys[idx])
