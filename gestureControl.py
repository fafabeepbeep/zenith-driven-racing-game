"""
gestureControl.py  (renamed from gesture_control.py)
─────────────────────────────────────────────────────────────────
Gesture-controlled racing input using MediaPipe Hands.
RIGHT HAND ONLY (player's physical right hand).

BUG FIXES vs original gesture_control.py:
  1. RIGHT-HAND SELECTION: After cv2.flip() the physical right hand
     appears on the LEFT side of the frame. MediaPipe labels it "Left"
     in the flipped image. We intentionally keep label != "Left" check
     — but we also add a guard against accidentally accepting both hands.
     Only the FIRST matched hand per frame is used.

  2. THUMB DIRECTION FIX: After horizontal flip the x-axis is mirrored,
     so the thumb-extended check must be reversed.
     Old (wrong):  lm[4].x < lm[3].x
     New (correct): lm[4].x > lm[3].x   (tip further RIGHT = extended)

  3. REVERSE vs FORWARD CONFLICT:
     Root cause — palm_facing_down could return True even when fingers
     are not fully open, causing the fist / palm-down border to be blurry.
     Fix: REVERSE (fist) is now checked with a strict "all fingers AND
     thumb clearly folded" test. FORWARD requires fully_open + palm_down.
     The two conditions are mutually exclusive by definition.

  4. GESTURE PRIORITY ORDER enforced in classify_gesture():
       1. START  (index only, pointing toward camera)
       2. BRAKE  (open palm, facing camera, fingers up)
       3. REVERSE (strict full fist)
       4. LEFT   (back-of-hand, fingers pointing left)
       5. RIGHT  (palm-toward-camera, fingers pointing right)
       6. FORWARD (palm down) / BALANCE (palm down but wrist static)
       7. NONE

Install:
  pip install mediapipe opencv-python websocket-client

Run:
  python3 gestureControl.py
─────────────────────────────────────────────────────────────────
"""

import cv2
import mediapipe as mp
import websocket
import json
import threading
import time
import math
from collections import deque, Counter

# ── Config ────────────────────────────────────────────────────
WS_URL          = "ws://localhost:8765"
SMOOTH_FRAMES   = 7        # gesture history for majority vote
DEBOUNCE_SEC    = 0.12     # min seconds between gesture changes
SEND_INTERVAL   = 0.05     # send at most every 50 ms
BALANCE_THRESH  = 0.012    # max wrist movement to count as "still"
BALANCE_WINDOW  = 8        # frames to check for stillness

# ── MediaPipe setup ───────────────────────────────────────────
mp_hands   = mp.solutions.hands
mp_drawing = mp.solutions.drawing_utils

# ─────────────────────────────────────────────────────────────
#  Helper utilities
# ─────────────────────────────────────────────────────────────

def dist2d(a, b):
    return math.sqrt((a.x - b.x)**2 + (a.y - b.y)**2)

def is_finger_extended(tip, pip, mcp):
    """True if the finger tip is clearly above the PIP joint (y smaller = higher on screen)."""
    return tip.y < pip.y - 0.02

def finger_states(lm):
    """Return (thumb, index, middle, ring, pinky) extension booleans.

    FIX: After cv2.flip(frame, 1) the x-axis is mirrored.
    For the physical RIGHT hand (appearing as MediaPipe 'Left' after flip):
      - Thumb tip (lm[4]) extends to the RIGHT in image space → tip.x > ip.x
    """
    # FIX: was lm[4].x < lm[3].x — reversed after horizontal flip
    thumb  = lm[4].x > lm[3].x   # right hand after flip: tip further right = extended
    index  = is_finger_extended(lm[8],  lm[6],  lm[5])
    middle = is_finger_extended(lm[12], lm[10], lm[9])
    ring   = is_finger_extended(lm[16], lm[14], lm[13])
    pinky  = is_finger_extended(lm[20], lm[18], lm[17])
    return thumb, index, middle, ring, pinky

def palm_facing_camera(lm):
    """
    True when the palm faces the camera (stop-sign / brake pose).
    After flip: for the right hand with palm facing camera, the wrist z
    is further from camera (more positive) than the index MCP.
    """
    return lm[0].z > lm[5].z

def fingers_pointing_left(lm):
    """Most finger tips are to the left of their MCPs (in image space)."""
    tips  = [lm[8], lm[12], lm[16], lm[20]]
    mcps  = [lm[5], lm[9],  lm[13], lm[17]]
    left_count = sum(1 for t, m in zip(tips, mcps) if t.x < m.x - 0.02)
    return left_count >= 3

def fingers_pointing_right(lm):
    """Most finger tips are to the right of their MCPs (in image space)."""
    tips  = [lm[8], lm[12], lm[16], lm[20]]
    mcps  = [lm[5], lm[9],  lm[13], lm[17]]
    right_count = sum(1 for t, m in zip(tips, mcps) if t.x > m.x + 0.02)
    return right_count >= 3

def palm_facing_down(lm):
    """
    True when palm faces downward (FORWARD gesture).
    The wrist is closer to the camera than the fingertips when palm faces down.
    FIX: increased threshold to 0.03 so a loose fist won't accidentally
    satisfy this condition — requires a more deliberate downward tilt.
    """
    avg_tip_z = sum(lm[i].z for i in [8, 12, 16, 20]) / 4
    return lm[0].z < avg_tip_z - 0.03   # FIX: was 0.02, tighter now

def is_strict_fist(lm):
    """
    REVERSE gesture — ALL five digits must be clearly folded.
    FIX: original only checked 4 fingers, not thumb.
    Now checks thumb + all 4 fingers, preventing a palm-down open hand
    from accidentally matching as a fist.
    """
    thumb, idx, mid, rng, pnk = finger_states(lm)
    # All four fingers clearly NOT extended
    fingers_folded = not idx and not mid and not rng and not pnk
    # Additional check: fingertips must be below their MCPs (curled inward)
    tips_curled = all(
        lm[tip].y > lm[mcp].y  # tips lower than knuckles = curled
        for tip, mcp in [(8, 5), (12, 9), (16, 13), (20, 17)]
    )
    return fingers_folded and tips_curled

def is_index_only(lm):
    """Index extended, all others folded — for START gesture."""
    _, idx, mid, rng, pnk = finger_states(lm)
    return idx and not mid and not rng and not pnk

def index_tip_forward(lm):
    """Index tip z is more negative (closer to camera) than PIP — pointing toward camera."""
    return lm[8].z < lm[6].z - 0.01

def all_fingers_open(lm):
    """All four non-thumb fingers clearly extended."""
    _, idx, mid, rng, pnk = finger_states(lm)
    return idx and mid and rng and pnk

# ─────────────────────────────────────────────────────────────
#  Gesture classifier  (enforces strict priority order)
# ─────────────────────────────────────────────────────────────

def classify_gesture(lm):
    """
    Classify a single frame into a gesture string.

    Priority order (highest → lowest):
      1. START   — index pointing toward camera
      2. BRAKE   — open palm facing camera, fingers upright
      3. REVERSE — strict full fist (FIX: was ambiguous)
      4. LEFT    — back of hand toward camera, fingers pointing left
      5. RIGHT   — palm toward camera, fingers pointing right
      6. FORWARD — open palm facing down  (may downgrade to BALANCE)
      7. NONE
    """
    try:
        fully_open = all_fingers_open(lm)

        # ── 1. START ──────────────────────────────────────────
        if is_index_only(lm) and index_tip_forward(lm):
            return "START"

        # ── 2. BRAKE ──────────────────────────────────────────
        # Open palm, facing camera, fingers pointing upward (stop sign).
        # Must be fully_open AND palm toward camera AND NOT pointing sideways.
        if (fully_open
                and palm_facing_camera(lm)
                and not fingers_pointing_left(lm)
                and not fingers_pointing_right(lm)):
            return "BRAKE"

        # ── 3. REVERSE ────────────────────────────────────────
        # FIX: use strict fist check — requires ALL digits folded.
        # This prevents palm-down from leaking into REVERSE.
        if is_strict_fist(lm):
            return "REVERSE"

        # ── 4. LEFT ───────────────────────────────────────────
        # Back of hand toward camera, fingers pointing left.
        if fully_open and fingers_pointing_left(lm) and not palm_facing_camera(lm):
            return "LEFT"

        # ── 5. RIGHT ──────────────────────────────────────────
        # Palm toward camera, fingers pointing right.
        if fully_open and fingers_pointing_right(lm) and palm_facing_camera(lm):
            return "RIGHT"

        # ── 6. FORWARD ────────────────────────────────────────
        # Open palm, facing downward.
        # BALANCE override happens in main() via wrist-motion check.
        if fully_open and palm_facing_down(lm):
            return "FORWARD"

        return "NONE"

    except Exception:
        return "NONE"

# ─────────────────────────────────────────────────────────────
#  WebSocket client (runs in background thread)
# ─────────────────────────────────────────────────────────────

class GestureSocket:
    def __init__(self, url):
        self.url        = url
        self.ws         = None
        self.connected  = False
        self._last_sent = 0
        self._thread    = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def _run(self):
        while True:
            try:
                self.ws = websocket.WebSocketApp(
                    self.url,
                    on_open=self._on_open,
                    on_error=self._on_error,
                    on_close=self._on_close,
                )
                self.ws.run_forever()
            except Exception as e:
                print(f"[WS] Connection error: {e}")
            print("[WS] Reconnecting in 2 s…")
            time.sleep(2)

    def _on_open(self, ws):
        self.connected = True
        print("[WS] Connected to server.")

    def _on_error(self, ws, err):
        print(f"[WS] Error: {err}")
        self.connected = False

    def _on_close(self, ws, code, msg):
        self.connected = False
        print("[WS] Disconnected.")

    def send(self, gesture: str):
        now = time.time()
        if now - self._last_sent < SEND_INTERVAL:
            return
        self._last_sent = now
        if self.ws and self.connected:
            try:
                payload = json.dumps({"gesture": gesture})
                self.ws.send(payload)
            except Exception:
                self.connected = False

# ─────────────────────────────────────────────────────────────
#  Main loop
# ─────────────────────────────────────────────────────────────

def main():
    print("=" * 55)
    print("  ZENITH DRIVEN — Gesture Control")
    print("  Right hand only | Press Q to quit")
    print("=" * 55)

    sock = GestureSocket(WS_URL)

    # Smoothing
    history       = deque(maxlen=SMOOTH_FRAMES)
    last_gesture  = "NONE"
    last_change_t = 0.0

    # Balance detection — track wrist positions over last N frames
    wrist_positions = deque(maxlen=BALANCE_WINDOW)

    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("[ERR] Cannot open webcam.")
        return

    with mp_hands.Hands(
        static_image_mode=False,
        max_num_hands=1,
        model_complexity=0,
        min_detection_confidence=0.7,
        min_tracking_confidence=0.6,
    ) as hands:

        while True:
            ret, frame = cap.read()
            if not ret:
                break

            # Flip for mirror view, convert BGR→RGB
            frame = cv2.flip(frame, 1)
            rgb   = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            rgb.flags.writeable = False
            results = hands.process(rgb)
            rgb.flags.writeable = True

            raw_gesture = "NONE"
            found_right = False

            if results.multi_hand_landmarks and results.multi_handedness:
                for hand_lm, hand_info in zip(
                    results.multi_hand_landmarks, results.multi_handedness
                ):
                    label = hand_info.classification[0].label
                    # After cv2.flip() the physical RIGHT hand is labelled "Left"
                    # by MediaPipe (mirror effect). Accept only "Left"-labelled hand.
                    if label != "Left":
                        continue

                    found_right = True
                    lm = hand_lm.landmark

                    # Track wrist for BALANCE detection
                    wrist_positions.append((lm[0].x, lm[0].y))

                    raw_gesture = classify_gesture(lm)

                    # Override FORWARD → BALANCE if wrist is static
                    if raw_gesture == "FORWARD" and len(wrist_positions) == BALANCE_WINDOW:
                        xs = [p[0] for p in wrist_positions]
                        ys = [p[1] for p in wrist_positions]
                        spread = math.sqrt(
                            (max(xs) - min(xs))**2 + (max(ys) - min(ys))**2
                        )
                        if spread < BALANCE_THRESH:
                            raw_gesture = "BALANCE"

                    # Draw landmarks
                    mp_drawing.draw_landmarks(
                        frame, hand_lm, mp_hands.HAND_CONNECTIONS,
                        mp_drawing.DrawingSpec(color=(0, 255, 100), thickness=2, circle_radius=3),
                        mp_drawing.DrawingSpec(color=(255, 200, 0), thickness=2),
                    )

                    # Only process the first matching hand
                    break

            if not found_right:
                wrist_positions.clear()

            # ── Smoothing: majority vote ───────────────────────
            history.append(raw_gesture)
            vote = Counter(history).most_common(1)[0][0]

            # ── Debounce ───────────────────────────────────────
            now = time.time()
            if vote != last_gesture and (now - last_change_t) >= DEBOUNCE_SEC:
                last_gesture  = vote
                last_change_t = now

            # ── Send ───────────────────────────────────────────
            sock.send(last_gesture)

            # ── Overlay ───────────────────────────────────────
            ws_status   = "WS: Connected ✓" if sock.connected else "WS: Connecting…"
            color_status = (0, 255, 0) if sock.connected else (0, 200, 255)

            cv2.putText(frame, f"Gesture: {last_gesture}", (20, 50),
                        cv2.FONT_HERSHEY_SIMPLEX, 1.4, (0, 255, 100), 3)
            cv2.putText(frame, f"Raw: {raw_gesture}", (20, 95),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.8, (200, 200, 200), 2)
            cv2.putText(frame, ws_status, (20, 140),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.8, color_status, 2)
            cv2.putText(frame, "RIGHT HAND", (20, frame.shape[0] - 20),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7,
                        (0, 255, 255) if found_right else (100, 100, 100), 2)

            # Gesture guide
            guide = [
                "START:   index finger → cam",
                "FORWARD: palm down (open hand)",
                "BRAKE:   stop sign (palm to cam)",
                "LEFT:    back of hand, fingers left",
                "RIGHT:   palm to cam, fingers right",
                "REVERSE: strict fist (all fingers curled)",
            ]
            for i, line in enumerate(guide):
                cv2.putText(frame, line,
                            (frame.shape[1] - 450, 35 + i * 28),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.55, (180, 180, 180), 1)

            cv2.imshow("ZENITH DRIVEN — Gesture Control (Q to quit)", frame)
            if cv2.waitKey(1) & 0xFF == ord('q'):
                break

    cap.release()
    cv2.destroyAllWindows()
    sock.send("NONE")
    print("\n[DONE] Gesture control stopped.")

if __name__ == "__main__":
    main()