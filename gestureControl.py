"""
═══════════════════════════════════════════════════════════════════════════════
USAGE
───────────────────────────────────────────────────────────────────────────────
  Rule-based (no model needed):
      python gestureControl.py

  ML model (auto-fallback to rules if file missing):
      python gestureControl.py --model
      python gestureControl.py --model --model-path models/gestureModel.task

  Switch control hand for left-handed players:
      python gestureControl.py --left-hand

Train a model first with:
      python gestureModelTrainer.py
═══════════════════════════════════════════════════════════════════════════════
"""

import cv2
import mediapipe as mp
import websocket
import json
import threading
import time
import math
import argparse
import os
import sys
import certifi
from collections import deque, Counter

# ── CLI arguments ──────────────────────────────────────────────────────────
parser = argparse.ArgumentParser(description="ZENITH DRIVEN Gesture Control")
parser.add_argument('--model', action='store_true',
                    help='Use trained ML model instead of rule-based classifier')
parser.add_argument('--model-path', default='models/gestureModel.task',
                    help='Path to .task model file (default: models/gestureModel.task)')
parser.add_argument('--camera', type=int, default=0,
                    help='Webcam device index (default: 0)')
parser.add_argument('--left-hand', action='store_true',
                    help='Control with LEFT hand instead of RIGHT hand')
parser.add_argument('--ml-threshold', type=float, default=0.50,
                    help='Minimum ML confidence to accept a prediction (default: 0.50)')
parser.add_argument('--server', default=None,
                    help='WebSocket server URL '
                         '(e.g. wss://zenith-driven-racing-game.onrender.com/gesture). '
                         'Defaults to ws://localhost:3000/gesture for local development.')
args = parser.parse_args()

USE_ML_MODEL  = args.model
MODEL_PATH    = args.model_path
CAMERA_INDEX  = args.camera
CONTROL_HAND  = "Left" if args.left_hand else "Right"
ML_THRESHOLD  = args.ml_threshold

# ── Config ─────────────────────────────────────────────────────────────────
# Default to local for development; production users override via --server
DEFAULT_WS_URL = "wss://zenith-driven-racing-game.onrender.com/gesture"
WS_URL = args.server if args.server else DEFAULT_WS_URL
if args.server:                          # ← ADD THIS
    WS_URL = args.server                 # ← AND THIS
SMOOTH_FRAMES      = 9        # majority-vote history window
CONFIDENCE_GATE    = 0.60     # gesture must win ≥ 60 % of votes
DEBOUNCE_SEC       = 0.14     # minimum seconds between gesture changes
SEND_INTERVAL      = 0.05     # WebSocket send throttle (20 fps)
BALANCE_THRESH     = 0.012    # wrist spread threshold for BALANCE state
BALANCE_WINDOW     = 8        # frames for BALANCE detection
ACCURACY_INTERVAL  = 3.0      # seconds between accuracy reports to game
STABLE_THRESHOLD   = 5        # frames a gesture must hold to count as "correct"
FPS_WINDOW         = 30       # rolling frames for FPS calc

# ── MediaPipe ──────────────────────────────────────────────────────────────
mp_hands = mp.solutions.hands


# ═══════════════════════════════════════════════════════════════════════════
#  ACCURACY TRACKER  (unchanged)
# ═══════════════════════════════════════════════════════════════════════════
class AccuracyTracker:
    def __init__(self):
        self.reset()

    def reset(self):
        self.total_attempts   = 0
        self.stable_holds     = 0
        self.current_gesture  = "NONE"
        self.current_duration = 0
        self.gesture_counts   = {}
        self.frame_count      = 0
        self.detected_frames  = 0

    def update(self, voted_gesture: str):
        self.frame_count += 1
        if voted_gesture != "NONE":
            self.detected_frames += 1
            self.gesture_counts[voted_gesture] = \
                self.gesture_counts.get(voted_gesture, 0) + 1

        if voted_gesture != self.current_gesture:
            if self.current_gesture != "NONE":
                self.total_attempts += 1
                if self.current_duration >= STABLE_THRESHOLD:
                    self.stable_holds += 1
            self.current_gesture  = voted_gesture
            self.current_duration = 0
        else:
            self.current_duration += 1

    def accuracy(self) -> float:
        if self.total_attempts == 0:
            return 100.0
        return round(self.stable_holds / self.total_attempts * 100, 1)

    def report(self) -> dict:
        return {
            "total_gestures":       self.total_attempts,
            "correct_detections":   self.stable_holds,
            "incorrect_detections": max(0, self.total_attempts - self.stable_holds),
            "accuracy":             self.accuracy(),
            "gesture_distribution": dict(self.gesture_counts),
            "total_frames":         self.frame_count,
            "detected_frames":      self.detected_frames,
        }


# ═══════════════════════════════════════════════════════════════════════════
#  RULE-BASED CLASSIFIER  (fallback)
# ═══════════════════════════════════════════════════════════════════════════
def _is_finger_extended(tip, pip, mcp):
    return tip.y < pip.y - 0.02

def _finger_states(lm, physical_hand: str):
    if physical_hand == "Right":
        thumb = lm[4].x > lm[3].x
    else:
        thumb = lm[4].x < lm[3].x
    index  = _is_finger_extended(lm[8],  lm[6],  lm[5])
    middle = _is_finger_extended(lm[12], lm[10], lm[9])
    ring   = _is_finger_extended(lm[16], lm[14], lm[13])
    pinky  = _is_finger_extended(lm[20], lm[18], lm[17])
    return thumb, index, middle, ring, pinky

def _palm_facing_camera(lm):  return lm[0].z > lm[5].z
def _palm_facing_down(lm):
    avg_tip_z = sum(lm[i].z for i in [8, 12, 16, 20]) / 4
    return lm[0].z < avg_tip_z - 0.03

def _all_fingers_open(lm):
    _, idx, mid, rng, pnk = _finger_states(lm, "Right")
    return idx and mid and rng and pnk

def _fingers_pointing_left_raw(lm):
    tips = [lm[8], lm[12], lm[16], lm[20]]
    mcps = [lm[5], lm[9],  lm[13], lm[17]]
    return sum(1 for t, m in zip(tips, mcps) if t.x < m.x - 0.02) >= 3

def _fingers_pointing_right_raw(lm):
    tips = [lm[8], lm[12], lm[16], lm[20]]
    mcps = [lm[5], lm[9],  lm[13], lm[17]]
    return sum(1 for t, m in zip(tips, mcps) if t.x > m.x + 0.02) >= 3

def _is_strict_fist(lm):
    tips_curled = all(lm[tip].y > lm[mcp].y
                      for tip, mcp in [(8,5),(12,9),(16,13),(20,17)])
    _, idx, mid, rng, pnk = _finger_states(lm, "Right")
    return (not idx) and (not mid) and (not rng) and (not pnk) and tips_curled

def _is_index_only(lm):
    _, idx, mid, rng, pnk = _finger_states(lm, "Right")
    return idx and (not mid) and (not rng) and (not pnk)

def _index_tip_toward_camera(lm):
    return lm[8].z < lm[6].z - 0.01

def classify_gesture_rules(lm, physical_hand: str) -> str:
    try:
        fully_open = _all_fingers_open(lm)
        if _is_index_only(lm) and _index_tip_toward_camera(lm):
            return "START"
        if (fully_open and _palm_facing_camera(lm)
                and not _fingers_pointing_left_raw(lm)
                and not _fingers_pointing_right_raw(lm)):
            return "BRAKE"
        if _is_strict_fist(lm):
            return "REVERSE"
        if fully_open and _fingers_pointing_left_raw(lm) and not _palm_facing_camera(lm):
            return "LEFT"
        if fully_open and _fingers_pointing_right_raw(lm) and _palm_facing_camera(lm):
            return "RIGHT"
        if fully_open and _palm_facing_down(lm):
            return "FORWARD"
        return "NONE"
    except Exception:
        return "NONE"


# ═══════════════════════════════════════════════════════════════════════════
#  ML MODEL CLASSIFIER  (loaded when --model is passed and file exists)
# ═══════════════════════════════════════════════════════════════════════════
class MLGestureClassifier:
    def __init__(self, model_path: str, threshold: float = 0.50):
        if not os.path.exists(model_path):
            raise FileNotFoundError(
                f"Model file not found: {model_path}\n"
                f"Train one first with:  python gestureModelTrainer.py"
            )

        try:
            from mediapipe.tasks import python as mp_python
            from mediapipe.tasks.python import vision as mp_vision
            BaseOptions              = mp_python.BaseOptions
            GestureRecognizer        = mp_vision.GestureRecognizer
            GestureRecognizerOptions = mp_vision.GestureRecognizerOptions

            options = GestureRecognizerOptions(
                base_options    = BaseOptions(model_asset_path=model_path),
                num_hands       = 1,
                min_hand_detection_confidence = 0.7,
                min_hand_presence_confidence  = 0.6,
                min_tracking_confidence       = 0.6,
            )
            self._recognizer = GestureRecognizer.create_from_options(options)
            self._mp         = mp
            self._threshold  = threshold
            self.model_name  = os.path.basename(model_path)
            print(f"[ML] Model loaded: {model_path} (threshold {threshold:.0%})")

        except ImportError:
            raise ImportError(
                "mediapipe.tasks not available. Install mediapipe >= 0.10.0:\n"
                "  pip install mediapipe>=0.10.0"
            )

    def predict(self, rgb_frame) -> tuple[str, float]:
        try:
            mp_image = self._mp.Image(
                image_format=self._mp.ImageFormat.SRGB,
                data=rgb_frame
            )
            result = self._recognizer.recognize(mp_image)
            if result.gestures and result.gestures[0]:
                top = result.gestures[0][0]
                conf = round(top.score, 3)
                # Confidence gate: low-confidence predictions become NONE
                if conf < self._threshold:
                    return "NONE", conf
                return top.category_name, conf
        except Exception as e:
            print(f"[ML] Inference error: {e}")
        return "NONE", 0.0


# ═══════════════════════════════════════════════════════════════════════════
#  WEBSOCKET CLIENT
# ═══════════════════════════════════════════════════════════════════════════
class GestureSocket:
    def __init__(self, url: str, on_incoming=None):
        self.url          = url
        self.ws           = None
        self.connected    = False
        self._last_sent   = 0.0
        self._on_incoming = on_incoming
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def _run(self):
        while True:
            try:
                self.ws = websocket.WebSocketApp(
                    self.url,
                    on_open    = self._on_open,
                    on_message = self._on_message,
                    on_error   = self._on_error,
                    on_close   = self._on_close,
                )
                self.ws.run_forever(
                    ping_interval=20,
    sslopt={"ca_certs": certifi.where()})
            except Exception as e:
                print(f"[WS] Connection error: {e}")
            print("[WS] Reconnecting in 2 s…")
            time.sleep(2)

    def _on_open(self, ws):
        self.connected = True
        print("[WS] ✓ Connected to relay server.")

    def _on_message(self, ws, message):
        try:
            data = json.loads(message)
            if self._on_incoming:
                self._on_incoming(data)
        except Exception:
            pass

    def _on_error(self, ws, err):
        self.connected = False
        print(f"[WS] Error: {err}")

    def _on_close(self, ws, code, msg):
        self.connected = False
        print("[WS] Disconnected.")

    def send(self, payload: dict):
        now = time.time()
        if now - self._last_sent < SEND_INTERVAL:
            return
        self._do_send(payload)
        self._last_sent = now

    def send_now(self, payload: dict):
        self._do_send(payload)

    def _do_send(self, payload: dict):
        if self.ws and self.connected:
            try:
                self.ws.send(json.dumps(payload))
            except Exception:
                self.connected = False


# ═══════════════════════════════════════════════════════════════════════════
#  OVERLAY DRAWING  (clean, modern HUD on mirrored preview)
# ═══════════════════════════════════════════════════════════════════════════
ACCENT      = (0, 255, 232)    # cyan-yellow brand
ACCENT_DIM  = (60, 180, 170)
INK         = (240, 240, 245)
INK_DIM     = (140, 140, 155)
SURFACE     = (18, 18, 26)
SURFACE_2   = (28, 28, 40)
GREEN       = (60, 230, 100)
GREY_OUT    = (90, 90, 105)
RED         = (60, 60, 240)
AMBER       = (60, 180, 240)


def _rounded_rect(img, p1, p2, color, thickness=-1, r=8):
    """Cheap rounded-rect via filled main + 4 corner ellipses."""
    x1, y1 = p1; x2, y2 = p2
    cv2.rectangle(img, (x1 + r, y1), (x2 - r, y2), color, thickness)
    cv2.rectangle(img, (x1, y1 + r), (x2, y2 - r), color, thickness)
    for cx, cy in [(x1 + r, y1 + r), (x2 - r, y1 + r),
                   (x1 + r, y2 - r), (x2 - r, y2 - r)]:
        cv2.ellipse(img, (cx, cy), (r, r), 0, 0, 360, color, thickness)


def draw_overlay(
    preview_frame,
    voted_gesture: str,
    raw_gesture: str,
    confidence: float,
    detected_hands: dict,         # {"Right": True/False, "Left": True/False}
    ws_connected: bool,
    accuracy_report: dict,
    mode_label: str,              # "ML CLASSIFIER" or "BASIC DETECTION"
    model_name: str,              # filename or "rule-based"
    control_hand: str,            # "Right" or "Left"
    fps: float,
):
    h, w = preview_frame.shape[:2]

    # ── 1. TOP STRIP (mode + FPS + WS) ───────────────────────────────
    _rounded_rect(preview_frame, (0, 0), (w, 56), SURFACE, -1, r=0)
    cv2.line(preview_frame, (0, 56), (w, 56), SURFACE_2, 1)

    # Mode badge
    is_ml    = "ML" in mode_label
    mode_col = GREEN if is_ml else AMBER
    _rounded_rect(preview_frame, (16, 12), (180, 44), mode_col, -1, r=6)
    cv2.putText(preview_frame, mode_label, (28, 33),
                cv2.FONT_HERSHEY_SIMPLEX, 0.58, (0, 0, 0), 2)

    # Model filename
    cv2.putText(preview_frame, f"MODEL: {model_name}", (196, 33),
                cv2.FONT_HERSHEY_SIMPLEX, 0.55, INK_DIM, 1)

    # FPS (right side)
    fps_str = f"FPS: {fps:5.1f}"
    cv2.putText(preview_frame, fps_str, (w - 220, 33),
                cv2.FONT_HERSHEY_SIMPLEX, 0.60, INK, 2)

    # WS dot
    ws_col = GREEN if ws_connected else RED
    cv2.circle(preview_frame, (w - 28, 26), 7, ws_col, -1)
    cv2.putText(preview_frame, "WS", (w - 100, 33),
                cv2.FONT_HERSHEY_SIMPLEX, 0.55, INK_DIM, 1)

    # ── 2. HAND-STATUS ROW (always shown) ───────────────────────────
    _rounded_rect(preview_frame, (0, 56), (w, 110), SURFACE, -1, r=0)
    cv2.line(preview_frame, (0, 110), (w, 110), SURFACE_2, 1)

    # Right hand indicator
    right_active   = detected_hands.get("Right", False)
    right_is_ctrl  = (control_hand == "Right")
    if right_active and right_is_ctrl:
        right_col, right_text, right_dot = GREEN,    "RIGHT HAND DETECTED",  "● CONTROL"
    elif right_active and not right_is_ctrl:
        right_col, right_text, right_dot = GREY_OUT, "RIGHT HAND DETECTED",  "○ ignored"
    elif not right_active and right_is_ctrl:
        right_col, right_text, right_dot = INK_DIM,  "no right hand",        "waiting…"
    else:
        right_col, right_text, right_dot = INK_DIM,  "no right hand",        ""

    cv2.circle(preview_frame, (28, 86), 9, right_col, -1)
    cv2.putText(preview_frame, right_text, (50, 92),
                cv2.FONT_HERSHEY_SIMPLEX, 0.62, right_col, 2)
    if right_dot:
        cv2.putText(preview_frame, right_dot, (350, 92),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.56, right_col, 1)

    # Left hand indicator
    left_active  = detected_hands.get("Left", False)
    left_is_ctrl = (control_hand == "Left")
    if left_active and left_is_ctrl:
        left_col, left_text, left_dot = GREEN,    "LEFT HAND DETECTED",   "● CONTROL"
    elif left_active and not left_is_ctrl:
        left_col, left_text, left_dot = GREY_OUT, "LEFT HAND DETECTED",   "○ ignored"
    elif not left_active and left_is_ctrl:
        left_col, left_text, left_dot = INK_DIM,  "no left hand",         "waiting…"
    else:
        left_col, left_text, left_dot = INK_DIM,  "no left hand",         ""

    half = w // 2
    cv2.circle(preview_frame, (half + 28, 86), 9, left_col, -1)
    cv2.putText(preview_frame, left_text, (half + 50, 92),
                cv2.FONT_HERSHEY_SIMPLEX, 0.62, left_col, 2)
    if left_dot:
        cv2.putText(preview_frame, left_dot, (half + 350, 92),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.56, left_col, 1)

    # ── 3. GESTURE PANEL (left, under top strip) ────────────────────
    _rounded_rect(preview_frame, (12, 124), (480, 244), SURFACE, -1, r=10)

    # Voted gesture
    g_col = ACCENT if voted_gesture not in ("NONE", "") else INK_DIM
    cv2.putText(preview_frame, "GESTURE", (28, 148),
                cv2.FONT_HERSHEY_SIMPLEX, 0.48, INK_DIM, 1)
    cv2.putText(preview_frame, voted_gesture, (28, 198),
                cv2.FONT_HERSHEY_SIMPLEX, 1.6, g_col, 3)

    # Raw + confidence
    cv2.putText(preview_frame, f"raw: {raw_gesture}", (28, 222),
                cv2.FONT_HERSHEY_SIMPLEX, 0.52, INK_DIM, 1)
    conf_pct = int(confidence * 100)
    cv2.putText(preview_frame, f"conf {conf_pct:>3d}%", (28, 240),
                cv2.FONT_HERSHEY_SIMPLEX, 0.52, INK_DIM, 1)

    # Confidence bar
    bx, by = 180, 230; bw, bh = 280, 10
    cv2.rectangle(preview_frame, (bx, by), (bx + bw, by + bh), SURFACE_2, -1)
    fill = int(bw * confidence)
    if fill > 0:
        c = GREEN if confidence >= 0.7 else AMBER if confidence >= 0.5 else RED
        cv2.rectangle(preview_frame, (bx, by), (bx + fill, by + bh), c, -1)
    cv2.rectangle(preview_frame, (bx, by), (bx + bw, by + bh), SURFACE_2, 1)

    # ── 4. ACCURACY PANEL (right) ───────────────────────────────────
    acc = accuracy_report.get("accuracy", 100.0)
    px1, py1 = w - 320, 124
    px2, py2 = w - 12,  244
    _rounded_rect(preview_frame, (px1, py1), (px2, py2), SURFACE, -1, r=10)

    cv2.putText(preview_frame, "ACCURACY", (px1 + 16, py1 + 24),
                cv2.FONT_HERSHEY_SIMPLEX, 0.48, INK_DIM, 1)
    acc_col = GREEN if acc >= 80 else AMBER if acc >= 60 else RED
    cv2.putText(preview_frame, f"{acc:.1f}%", (px1 + 16, py1 + 70),
                cv2.FONT_HERSHEY_SIMPLEX, 1.4, acc_col, 3)

    # Accuracy bar
    abx, aby = px1 + 16, py1 + 86
    abw, abh = px2 - px1 - 32, 10
    cv2.rectangle(preview_frame, (abx, aby), (abx + abw, aby + abh), SURFACE_2, -1)
    afill = int(abw * acc / 100)
    if afill > 0:
        cv2.rectangle(preview_frame, (abx, aby), (abx + afill, aby + abh), acc_col, -1)

    cv2.putText(preview_frame,
                f"Attempts {accuracy_report.get('total_gestures', 0)}   "
                f"OK {accuracy_report.get('correct_detections', 0)}",
                (px1 + 16, py1 + 116), cv2.FONT_HERSHEY_SIMPLEX, 0.50, INK_DIM, 1)

    # ── 5. BOTTOM HINT ──────────────────────────────────────────────
    cv2.putText(preview_frame, "[ Q ] Quit   [ R ] Reset accuracy", (16, h - 16),
                cv2.FONT_HERSHEY_SIMPLEX, 0.56, INK_DIM, 1)

    return preview_frame


# ═══════════════════════════════════════════════════════════════════════════
#  LANDMARK DRAWING ON MIRRORED PREVIEW
# ═══════════════════════════════════════════════════════════════════════════
def _draw_landmarks_on_preview(preview_frame, hand_landmarks, is_control: bool):
    h, w = preview_frame.shape[:2]

    conn_col = GREEN if is_control else GREY_OUT
    for conn in mp_hands.HAND_CONNECTIONS:
        a_idx, b_idx = conn
        ax = int((1.0 - hand_landmarks.landmark[a_idx].x) * w)
        ay = int(hand_landmarks.landmark[a_idx].y * h)
        bx = int((1.0 - hand_landmarks.landmark[b_idx].x) * w)
        by = int(hand_landmarks.landmark[b_idx].y * h)
        cv2.line(preview_frame, (ax, ay), (bx, by), conn_col, 2)

    dot_col = (0, 255, 120) if is_control else (170, 170, 180)
    for lm in hand_landmarks.landmark:
        px = int((1.0 - lm.x) * w)
        py = int(lm.y * h)
        cv2.circle(preview_frame, (px, py), 5, dot_col, -1)


# ═══════════════════════════════════════════════════════════════════════════
#  MAIN
# ═══════════════════════════════════════════════════════════════════════════
def main():
    # ── Header ────────────────────────────────────────────────────────
    print("=" * 72)
    print("  ZENITH DRIVEN — Gesture Control")
    print(f"  Control hand : {CONTROL_HAND}")
    print(f"  Camera index : {CAMERA_INDEX}")
    print("=" * 72)

    # ── Load ML model if requested (with graceful fallback) ──────────
    ml_classifier = None
    if USE_ML_MODEL:
        try:
            ml_classifier = MLGestureClassifier(MODEL_PATH, ML_THRESHOLD)
            mode_label = "ML CLASSIFIER"
            model_name = ml_classifier.model_name
            print(f"[MODE] ML CLASSIFIER using {model_name}")
        except (FileNotFoundError, ImportError) as e:
            print(f"\n[WARN] {e}")
            print("[WARN] Falling back to BASIC DETECTION (rule-based).\n")
            mode_label = "BASIC DETECTION"
            model_name = "rule-based"
    else:
        mode_label = "BASIC DETECTION"
        model_name = "rule-based"
        print("[MODE] BASIC DETECTION (rule-based). Pass --model to use ML.")

    # ── State ────────────────────────────────────────────────────────
    accuracy_tracker   = AccuracyTracker()
    last_accuracy_send = 0.0
    history         = deque(maxlen=SMOOTH_FRAMES)
    last_gesture    = "NONE"
    last_change_t   = 0.0
    wrist_positions = deque(maxlen=BALANCE_WINDOW)
    frame_times     = deque(maxlen=FPS_WINDOW)

    def handle_incoming(data: dict):
        msg_type = data.get("type", "")
        if msg_type == "game_reset":
            accuracy_tracker.reset()
            print("\n[ACCURACY] Tracker reset — new game session.")
        elif msg_type == "request_accuracy":
            sock.send_now({"type": "accuracy_report", "data": accuracy_tracker.report()})
            print("\n[ACCURACY] Sent on-demand report.")

    sock = GestureSocket(WS_URL, on_incoming=handle_incoming)

    # ── Camera ───────────────────────────────────────────────────────
    cap = cv2.VideoCapture(CAMERA_INDEX)
    if not cap.isOpened():
        print(f"[ERR] Cannot open camera index {CAMERA_INDEX}.")
        sys.exit(1)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH,  1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
    cap.set(cv2.CAP_PROP_FPS, 30)
    actual_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    actual_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    print(f"[CAM] Resolution: {actual_w}×{actual_h}")

    with mp_hands.Hands(
        static_image_mode            = False,
        max_num_hands                = 2,
        model_complexity             = 1,
        min_detection_confidence     = 0.72,
        min_tracking_confidence      = 0.62,
    ) as hands:

        while True:
            t_frame_start = time.time()

            ret, raw_frame = cap.read()
            if not ret:
                print("[ERR] Failed to read frame — check camera connection.")
                break

            # ─────────────────────────────────────────────────────────
            #  Detection on RAW · preview is FLIPPED
            # ─────────────────────────────────────────────────────────
            detection_rgb = cv2.cvtColor(raw_frame, cv2.COLOR_BGR2RGB)
            preview_frame = cv2.flip(raw_frame, 1)
            detection_rgb.flags.writeable = False
            results = hands.process(detection_rgb)
            detection_rgb.flags.writeable = True

            # ── Per-frame state ───────────────────────────────────────
            raw_gesture    = "NONE"
            ml_confidence  = 0.0
            detected_hands = {"Right": False, "Left": False}

            if results.multi_hand_landmarks and results.multi_handedness:
                for hand_lm, hand_info in zip(
                    results.multi_hand_landmarks,
                    results.multi_handedness
                ):
                    mp_label = hand_info.classification[0].label
                    # Invert MediaPipe label → physical hand
                    physical_hand = "Right" if mp_label == "Left" else "Left"
                    detected_hands[physical_hand] = True

                    is_control = (physical_hand == CONTROL_HAND)

                    # Draw skeleton — green for control, grey for other
                    _draw_landmarks_on_preview(preview_frame, hand_lm, is_control)

                    if not is_control:
                        continue   # other hand visible but ignored

                    # ── Classify on the control hand ───────────────────
                    lm = hand_lm.landmark
                    wrist_positions.append((lm[0].x, lm[0].y))

                    if ml_classifier is not None:
                        raw_gesture, ml_confidence = ml_classifier.predict(detection_rgb)
                    else:
                        raw_gesture = classify_gesture_rules(lm, physical_hand)
                        ml_confidence = 1.0 if raw_gesture != "NONE" else 0.0

                    # BALANCE override
                    if raw_gesture == "FORWARD" and len(wrist_positions) == BALANCE_WINDOW:
                        xs = [p[0] for p in wrist_positions]
                        ys = [p[1] for p in wrist_positions]
                        spread = math.sqrt((max(xs)-min(xs))**2 + (max(ys)-min(ys))**2)
                        if spread < BALANCE_THRESH:
                            raw_gesture = "BALANCE"

            if not detected_hands[CONTROL_HAND]:
                wrist_positions.clear()

            # ── Temporal smoothing ────────────────────────────────────
            history.append(raw_gesture)
            counts     = Counter(history)
            top_label, top_count = counts.most_common(1)[0]
            vote_conf  = top_count / len(history)
            voted      = top_label if vote_conf >= CONFIDENCE_GATE else last_gesture

            # ── Debounce ──────────────────────────────────────────────
            now = time.time()
            if voted != last_gesture and (now - last_change_t) >= DEBOUNCE_SEC:
                last_gesture  = voted
                last_change_t = now

            # ── Accuracy + send ───────────────────────────────────────
            accuracy_tracker.update(last_gesture)
            sock.send({"gesture": last_gesture})

            if now - last_accuracy_send >= ACCURACY_INTERVAL:
                last_accuracy_send = now
                sock.send_now({"type": "accuracy_update",
                               "data": accuracy_tracker.report()})

            # ── FPS calculation ───────────────────────────────────────
            frame_times.append(time.time() - t_frame_start)
            avg_dt = sum(frame_times) / len(frame_times) if frame_times else 1.0
            fps    = 1.0 / avg_dt if avg_dt > 0 else 0.0

            # ── Draw HUD ──────────────────────────────────────────────
            display_conf = ml_confidence if ml_classifier else vote_conf
            draw_overlay(
                preview_frame    = preview_frame,
                voted_gesture    = last_gesture,
                raw_gesture      = raw_gesture,
                confidence       = display_conf,
                detected_hands   = detected_hands,
                ws_connected     = sock.connected,
                accuracy_report  = accuracy_tracker.report(),
                mode_label       = mode_label,
                model_name       = model_name,
                control_hand     = CONTROL_HAND,
                fps              = fps,
            )

            cv2.imshow("ZENITH DRIVEN — Gesture Control", preview_frame)

            key = cv2.waitKey(1) & 0xFF
            if key == ord('q'):
                break
            if key == ord('r'):
                accuracy_tracker.reset()
                print("\n[ACCURACY] Manually reset.")

    cap.release()
    cv2.destroyAllWindows()

    # ── Final report ──────────────────────────────────────────────────
    final = accuracy_tracker.report()
    sock.send_now({"type": "accuracy_report", "data": final})
    print("\n" + "=" * 50)
    print("  FINAL ACCURACY REPORT")
    print("=" * 50)
    print(f"  Mode                  : {mode_label}  ({model_name})")
    print(f"  Total gesture attempts: {final['total_gestures']}")
    print(f"  Stable (correct) holds: {final['correct_detections']}")
    print(f"  Flickering (incorrect): {final['incorrect_detections']}")
    print(f"  Accuracy              : {final['accuracy']:.1f} %")
    print(f"  Detected frames       : {final['detected_frames']} / {final['total_frames']}")
    dist = final.get('gesture_distribution', {})
    if dist:
        print("\n  Gesture breakdown:")
        for g, cnt in sorted(dist.items(), key=lambda x: -x[1]):
            print(f"    {g:<12} {cnt} frames")
    print("=" * 50)


if __name__ == "__main__":
    main()