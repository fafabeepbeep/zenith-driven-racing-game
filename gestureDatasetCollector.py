"""
gestureDatasetCollector.py — ZENITH DRIVEN  Dataset Image Collector
═══════════════════════════════════════════════════════════════════════════════
Renamed from collect_dataset.py for consistency with gestureModelTrainer.py
and gestureControl.py.

PURPOSE
───────
Captures webcam images for each gesture class to build a training dataset
for gestureModelTrainer.py.

CRITICAL — RAW FRAMES (no mirror)
─────────────────────────────────
Images are captured from the RAW (unflipped) frame. DO NOT change this.
The training data MUST match the inference pipeline in gestureControl.py
which also uses raw (unflipped) frames for detection.

USAGE
─────
    python gestureDatasetCollector.py

CONTROLS — Hold a key to capture for that gesture:
    S → START      F → FORWARD     B → BRAKE      L → LEFT
    R → RIGHT      E → REVERSE     A → BALANCE    N → NONE
    Q → Quit
    DEL/Backspace → delete last 5 captured images for the active class

CAPTURE GUIDELINES
──────────────────
  • 80–300 images per class (80 is minimum, 300 is excellent)
  • Vary distance, angle, lighting, hand rotation
  • For NONE: include random hand positions, partial hands, no hand
  • For each gesture class: include variations of the SAME pose
    (don't include random images that don't match the gesture)

FOLDER OUTPUT
─────────────
    dataset/
    ├── START/      (S key)
    ├── FORWARD/    (F key)
    ├── BRAKE/      (B key)
    ├── LEFT/       (L key)
    ├── RIGHT/      (R key)
    ├── REVERSE/    (E key)
    ├── BALANCE/    (A key)
    └── NONE/       (N key)
═══════════════════════════════════════════════════════════════════════════════
"""

import cv2
import os
import time

# ── Config ──────────────────────────────────────────────────────────────────
DATASET_DIR  = "dataset"
TARGET_COUNT = 80            # default target per class
CAMERA_INDEX = 0
CAPTURE_FPS  = 8
MIN_INTERVAL = 1.0 / CAPTURE_FPS

# Minimum file size (bytes) to consider a saved image valid
MIN_IMAGE_BYTES = 4_000

KEY_TO_CLASS = {
    ord('s'): "START",
    ord('f'): "FORWARD",
    ord('b'): "BRAKE",
    ord('l'): "LEFT",
    ord('r'): "RIGHT",
    ord('e'): "REVERSE",
    ord('a'): "BALANCE",
    ord('n'): "NONE",
}
HELP_LINES = [
    ("S", "START   — index finger → camera"),
    ("F", "FORWARD — palm face-down"),
    ("B", "BRAKE   — stop sign palm"),
    ("L", "LEFT    — fingers point left"),
    ("R", "RIGHT   — fingers point right"),
    ("E", "REVERSE — closed fist"),
    ("A", "BALANCE — still open palm"),
    ("N", "NONE    — random / rest pose"),
]
CLASS_COLORS = {
    "START":   (0, 230, 80),
    "FORWARD": (0, 200, 240),
    "BRAKE":   (60, 60, 240),
    "LEFT":    (240, 200, 0),
    "RIGHT":   (0, 160, 240),
    "REVERSE": (240, 60, 60),
    "BALANCE": (180, 0, 240),
    "NONE":    (160, 160, 160),
}


def ensure_dirs():
    os.makedirs(DATASET_DIR, exist_ok=True)
    for cls in KEY_TO_CLASS.values():
        os.makedirs(os.path.join(DATASET_DIR, cls), exist_ok=True)


def is_valid_image_file(path: str) -> bool:
    """Check that the file exists, has reasonable size, and decodes."""
    try:
        if not os.path.isfile(path):
            return False
        if os.path.getsize(path) < MIN_IMAGE_BYTES:
            return False
        img = cv2.imread(path)
        return img is not None and img.size > 0
    except Exception:
        return False


def count_existing():
    """Count VALID images per class (skipping corrupted/tiny files)."""
    counts = {}
    for cls in KEY_TO_CLASS.values():
        d = os.path.join(DATASET_DIR, cls)
        if not os.path.isdir(d):
            counts[cls] = 0
            continue
        n = 0
        for f in os.listdir(d):
            if f.lower().endswith(('.jpg', '.jpeg', '.png')):
                # Quick check: file size only (full decode on startup would
                # be slow for huge datasets). Trainer does full decode.
                fp = os.path.join(d, f)
                try:
                    if os.path.getsize(fp) >= MIN_IMAGE_BYTES:
                        n += 1
                except OSError:
                    pass
        counts[cls] = n
    return counts


def list_recent_files(cls: str, k: int = 5):
    """Return the k most-recent image filenames for a class, newest first."""
    d = os.path.join(DATASET_DIR, cls)
    if not os.path.isdir(d):
        return []
    files = [(f, os.path.getmtime(os.path.join(d, f)))
             for f in os.listdir(d)
             if f.lower().endswith(('.jpg', '.jpeg', '.png'))]
    files.sort(key=lambda x: x[1], reverse=True)
    return [f for f, _ in files[:k]]


def draw_ui(frame, active_class, counts, last_saved, total_saved_session):
    h, w = frame.shape[:2]
    panel_w = 310
    cv2.rectangle(frame, (w - panel_w, 0), (w, h), (12, 12, 18), -1)
    cv2.line(frame, (w - panel_w, 0), (w - panel_w, h), (40, 40, 55), 2)

    cv2.putText(frame, "DATASET COLLECTOR", (w - panel_w + 10, 30),
                cv2.FONT_HERSHEY_SIMPLEX, 0.65, (232, 255, 0), 2)
    cv2.putText(frame, f"Target: {TARGET_COUNT} per class",
                (w - panel_w + 10, 55), cv2.FONT_HERSHEY_SIMPLEX, 0.52, (120, 120, 140), 1)
    cv2.line(frame, (w - panel_w + 10, 65), (w - 10, 65), (40, 40, 55), 1)

    for i, (key_char, desc) in enumerate(HELP_LINES):
        cls       = list(KEY_TO_CLASS.values())[i]
        cnt       = counts.get(cls, 0)
        is_active = (cls == active_class)
        gy = 82 + i * 52

        if is_active:
            cv2.rectangle(frame, (w - panel_w + 4, gy - 4),
                          (w - 4, gy + 44), (30, 40, 20), -1)

        badge_col = CLASS_COLORS.get(cls, (150, 150, 150))
        cv2.rectangle(frame, (w - panel_w + 8, gy), (w - panel_w + 30, gy + 22),
                      badge_col, -1)
        cv2.putText(frame, key_char, (w - panel_w + 13, gy + 17),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 0, 0), 2)

        name_col = (232, 255, 0) if is_active else (200, 200, 210)
        cv2.putText(frame, f"{cls}", (w - panel_w + 36, gy + 16),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.60, name_col, 1)
        cv2.putText(frame, f"{cnt}/{TARGET_COUNT}", (w - 80, gy + 16),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55,
                    (0, 220, 80) if cnt >= TARGET_COUNT else (180, 180, 190), 1)

        bx, by2, bw2, bh2 = w - panel_w + 8, gy + 26, panel_w - 20, 8
        cv2.rectangle(frame, (bx, by2), (bx + bw2, by2 + bh2), (35, 35, 50), -1)
        fill = int(bw2 * min(cnt, TARGET_COUNT) / TARGET_COUNT)
        if fill > 0:
            cv2.rectangle(frame, (bx, by2), (bx + fill, by2 + bh2), badge_col, -1)
        cv2.rectangle(frame, (bx, by2), (bx + bw2, by2 + bh2), (65, 65, 80), 1)

    cv2.line(frame, (w - panel_w, h - 70), (w, h - 70), (40, 40, 55), 1)
    session_col = (0, 210, 80) if total_saved_session > 0 else (100, 100, 120)
    cv2.putText(frame, f"Session: +{total_saved_session} saved",
                (w - panel_w + 10, h - 45), cv2.FONT_HERSHEY_SIMPLEX, 0.60, session_col, 1)
    cv2.putText(frame, "Q quit · DEL undo 5",
                (w - panel_w + 10, h - 18), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (80, 80, 100), 1)

    if active_class:
        rec_col = CLASS_COLORS.get(active_class, (255, 255, 255))
        cv2.rectangle(frame, (0, 0), (w - panel_w - 2, 60), (10, 10, 14), -1)
        cv2.putText(frame, f"● REC  {active_class}", (14, 42),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.3, rec_col, 3)
        if last_saved:
            cv2.putText(frame, f"Saved: {last_saved}", (14, h - 18),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 200, 60), 2)
    else:
        cv2.rectangle(frame, (0, 0), (w - panel_w - 2, 60), (10, 10, 14), -1)
        cv2.putText(frame, "Hold a key to record", (14, 42),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.0, (100, 100, 120), 2)

    cv2.putText(frame, "RAW FRAME (no mirror) — correct for training",
                (14, h - 18), cv2.FONT_HERSHEY_SIMPLEX, 0.52, (80, 80, 60), 1)

    return frame


def main():
    print("=" * 60)
    print("  ZENITH DRIVEN — Dataset Collector")
    print(f"  Target: {TARGET_COUNT} images per class")
    print(f"  Output: {DATASET_DIR}/")
    print("  Hold a key to capture. Q to quit. DEL/Backspace to undo 5.")
    print("=" * 60)

    ensure_dirs()
    counts = count_existing()

    print("\nExisting images:")
    for cls, n in counts.items():
        status = "✓" if n >= TARGET_COUNT else f"{n}/{TARGET_COUNT}"
        print(f"  {cls:<12} {status}")

    cap = cv2.VideoCapture(CAMERA_INDEX)
    if not cap.isOpened():
        print(f"\n✗ Cannot open camera {CAMERA_INDEX}")
        return

    cap.set(cv2.CAP_PROP_FRAME_WIDTH,  1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
    cap.set(cv2.CAP_PROP_FPS, 30)

    active_class        = None
    last_capture_time   = 0.0
    last_saved_filename = ""
    total_saved_session = 0

    DEL_KEYS = (8, 127, ord('x'))   # Backspace, DEL, fallback 'x'

    while True:
        ret, raw_frame = cap.read()
        if not ret:
            break

        display_frame = raw_frame.copy()

        key = cv2.waitKey(1) & 0xFF
        if key == ord('q'):
            break

        # ── Undo last 5 captures for active class ─────────────────
        if key in DEL_KEYS and active_class:
            recent = list_recent_files(active_class, 5)
            removed = 0
            for f in recent:
                try:
                    os.remove(os.path.join(DATASET_DIR, active_class, f))
                    removed += 1
                except OSError:
                    pass
            counts[active_class] = max(0, counts[active_class] - removed)
            print(f"[UNDO] Removed {removed} recent {active_class} images.")

        active_class = KEY_TO_CLASS.get(key, active_class if key == 255 else None)
        now = time.time()

        if active_class and (now - last_capture_time) >= MIN_INTERVAL:
            cls_dir = os.path.join(DATASET_DIR, active_class)
            n       = counts.get(active_class, 0)

            if n < TARGET_COUNT:
                ts       = int(now * 1000)
                filename = f"{active_class}_{ts:013d}.jpg"
                filepath = os.path.join(cls_dir, filename)

                # Save with quality 95
                ok = cv2.imwrite(filepath, raw_frame, [cv2.IMWRITE_JPEG_QUALITY, 95])

                # Validate write — handles full-disk and odd FS bugs
                if ok and is_valid_image_file(filepath):
                    counts[active_class] = n + 1
                    total_saved_session += 1
                    last_capture_time    = now
                    last_saved_filename  = filename
                else:
                    print(f"[WARN] Failed/corrupt write skipped: {filename}")
                    try:
                        if os.path.exists(filepath):
                            os.remove(filepath)
                    except OSError:
                        pass
            else:
                active_class = None

        display_frame = draw_ui(
            display_frame, active_class, counts,
            last_saved_filename, total_saved_session
        )
        cv2.imshow("Dataset Collector — RAW frame (no mirror)", display_frame)

    cap.release()
    cv2.destroyAllWindows()

    print("\n" + "=" * 50)
    print("  Collection complete!")
    print("=" * 50)
    total = 0
    all_ready = True
    for cls, n in counts.items():
        status = "✓ READY" if n >= TARGET_COUNT else f"⚠  {n}/{TARGET_COUNT}"
        print(f"  {cls:<12}  {n:>4} images   {status}")
        total += n
        if n < TARGET_COUNT:
            all_ready = False

    print(f"\n  Total images : {total}")
    print(f"  Session added: +{total_saved_session}")

    if all_ready:
        print("\n✓ All classes ready! Run:")
        print("  python gestureModelTrainer.py")
    else:
        print("\n⚠  Some classes need more images.")
        print("   Run gestureDatasetCollector.py again to fill them in.")


if __name__ == "__main__":
    main()