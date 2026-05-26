// src/browserGesture.js
// ═══════════════════════════════════════════════════════════════════════════
//  ZENITH DRIVEN — Browser Gesture Recognizer
//  ─────────────────────────────────────────────────────────────────────────
//  Loads the SAME .task file trained in Python/Colab using MediaPipe Tasks JS
//  (WebAssembly runtime). Runs entirely in the user's browser — no server,
//  no Python install, no downloads.
//
//  Mirrors gestureControl.py's behavior:
//    • 9-frame majority-vote smoothing
//    • Confidence gate (0.60)
//    • Debounce (140 ms)
//    • BALANCE detection from wrist-position stability
//    • Accuracy tracker (total attempts / stable holds / per-gesture counts)
//    • Right-hand only (matches Python default --left-hand is off)
//
//  Exposes globals consumed by main.js:
//    window.BrowserGesture.currentGesture     — voted/debounced gesture name
//    window.BrowserGesture.rawGesture         — raw frame-by-frame
//    window.BrowserGesture.confidence         — 0..1
//    window.BrowserGesture.isReady            — model + camera loaded
//    window.BrowserGesture.accuracy()         — full accuracy report
//    window.BrowserGesture.resetAccuracy()    — clear stats for new game
// ═══════════════════════════════════════════════════════════════════════════

(function () {
    'use strict';
  
    const MODEL_URL  = '${location.origin}/models/gestureModel.task';   // Served by Express from project root
    const WASM_BASE  = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
    const TASKS_URL  = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
  
    // ── Smoothing parameters — same as gestureControl.py ─────────
    const SMOOTH_FRAMES   = 9;
    const CONFIDENCE_GATE = 0.60;
    const DEBOUNCE_MS     = 140;
    const ML_THRESHOLD    = 0.50;
    const BALANCE_THRESH  = 0.012;
    const BALANCE_WINDOW  = 8;
    const STABLE_THRESHOLD = 5;          // frames a gesture must hold = "stable"
  
    const VALID_GESTURES = new Set([
      'FORWARD','BRAKE','LEFT','RIGHT','REVERSE','BALANCE','START','NONE'
    ]);
  
    // ───────────────────────────────────────────────────────────────
    //  ACCURACY TRACKER — mirrors AccuracyTracker class in Python
    // ───────────────────────────────────────────────────────────────
    class AccuracyTracker {
      constructor() { this.reset(); }
      reset() {
        this.totalAttempts   = 0;
        this.stableHolds     = 0;
        this.currentGesture  = 'NONE';
        this.currentDuration = 0;
        this.gestureCounts   = {};
        this.frameCount      = 0;
        this.detectedFrames  = 0;
      }
      update(voted) {
        this.frameCount++;
        if (voted !== 'NONE') {
          this.detectedFrames++;
          this.gestureCounts[voted] = (this.gestureCounts[voted] || 0) + 1;
        }
        if (voted !== this.currentGesture) {
          if (this.currentGesture !== 'NONE') {
            this.totalAttempts++;
            if (this.currentDuration >= STABLE_THRESHOLD) this.stableHolds++;
          }
          this.currentGesture  = voted;
          this.currentDuration = 0;
        } else {
          this.currentDuration++;
        }
      }
      accuracy() {
        if (this.totalAttempts === 0) return 100.0;
        return Math.round(this.stableHolds / this.totalAttempts * 1000) / 10;
      }
      report() {
        return {
          total_gestures:        this.totalAttempts,
          correct_detections:    this.stableHolds,
          incorrect_detections:  Math.max(0, this.totalAttempts - this.stableHolds),
          accuracy:              this.accuracy(),
          gesture_distribution:  { ...this.gestureCounts },
          total_frames:          this.frameCount,
          detected_frames:       this.detectedFrames,
        };
      }
    }
  
    // ───────────────────────────────────────────────────────────────
    //  MAIN — BrowserGesture singleton
    // ───────────────────────────────────────────────────────────────
    const BrowserGesture = {
      // Public state (main.js reads these)
      isReady:        false,
      isInitializing: false,
      initError:      null,
      currentGesture: 'NONE',
      rawGesture:     'NONE',
      confidence:     0,
      handsSeen:      { Right: false, Left: false },
  
      // Internal
      _recognizer:   null,
      _video:        null,
      _stream:       null,
      _running:      false,
      _history:      [],
      _lastChangeT:  0,
      _wristHistory: [],
      _tracker:      new AccuracyTracker(),
      _previewCanvas: null,
      _previewCtx:    null,
      _lastLandmarks: null,
  
      // ─────────────────────────────────────────────────────────
      //  PUBLIC API
      // ─────────────────────────────────────────────────────────
      async start(opts = {}) {
        if (this.isReady || this.isInitializing) return;
        this.isInitializing = true;
        this.initError = null;
  
        try {
          console.log('[BrowserGesture] Loading MediaPipe Tasks JS…');
          const { GestureRecognizer, FilesetResolver } = await import(
            /* webpackIgnore: true */
            `${TASKS_URL}/vision_bundle.mjs`
          );
  
          console.log('[BrowserGesture] Loading WASM…');
          const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
  
          console.log('[BrowserGesture] Loading model:', MODEL_URL);
          this._recognizer = await GestureRecognizer.createFromOptions(vision, {
            baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
            runningMode: 'VIDEO',
            numHands: 1,
            minHandDetectionConfidence: 0.7,
            minHandPresenceConfidence:  0.6,
            minTrackingConfidence:      0.6,
          });
  
          console.log('[BrowserGesture] Requesting camera…');
          this._stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 480, facingMode: 'user' },
            audio: false,
          });
  
          this._video = document.createElement('video');
          this._video.style.cssText = 'position:fixed;left:-9999px;top:0;';
          this._video.autoplay    = true;
          this._video.playsInline = true;
          this._video.muted       = true;
          this._video.srcObject   = this._stream;
          document.body.appendChild(this._video);
          await new Promise(r => { this._video.onloadedmetadata = r; });
          await this._video.play();
  
          this._createPreviewCanvas(opts.previewParent || document.body);
  
          this.isReady = true;
          this.isInitializing = false;
          this._running = true;
          this._loop();
          console.log('[BrowserGesture] ✓ Ready.');
        } catch (err) {
          this.isInitializing = false;
          this.initError = err.message || String(err);
          console.error('[BrowserGesture] Init failed:', err);
          throw err;
        }
      },
  
      stop() {
        this._running = false;
        this.isReady = false;
        if (this._stream) {
          this._stream.getTracks().forEach(t => t.stop());
          this._stream = null;
        }
        if (this._video) {
          this._video.remove();
          this._video = null;
        }
        if (this._previewCanvas) {
          this._previewCanvas.remove();
          this._previewCanvas = null;
        }
        if (this._recognizer) {
          try { this._recognizer.close(); } catch {}
          this._recognizer = null;
        }
        console.log('[BrowserGesture] Stopped.');
      },
  
      accuracy() { return this._tracker.report(); },
      resetAccuracy() { this._tracker.reset(); },
      hidePreview() {
        if (this._previewCanvas) this._previewCanvas.style.display = 'none';
      },
      showPreview() {
        if (this._previewCanvas) this._previewCanvas.style.display = 'block';
      },
  
      // ─────────────────────────────────────────────────────────
      //  INTERNAL
      // ─────────────────────────────────────────────────────────
      _createPreviewCanvas(parent) {
        // Small floating webcam preview (Option B — 200x150, no gesture text)
        // Placed below the existing in-game "Gesture: XXX" indicator.
        const c = document.createElement('canvas');
        c.id = 'browser-gesture-preview';
        c.width  = 240;
        c.height = 180;
        c.style.cssText = `
          position: fixed;
          left: 20px;
          top: 130px;                      /* below 'Gesture: XXX' HUD */
          z-index: 60;
          border: 2px solid #d4642a;
          border-radius: 6px;
          box-shadow: 0 2px 8px rgba(40,50,60,0.3);
          background: #000;
          pointer-events: none;
        `;
        parent.appendChild(c);
        this._previewCanvas = c;
        this._previewCtx = c.getContext('2d');
      },
  
      _loop() {
        if (!this._running) return;
        try {
          if (this._video && this._video.readyState >= 2) {
            const result = this._recognizer.recognizeForVideo(
              this._video, performance.now()
            );
            this._processResult(result);
          }
        } catch (e) {
          console.warn('[BrowserGesture] Frame error:', e);
        }
        requestAnimationFrame(() => this._loop());
      },
  
      _processResult(result) {
        this.handsSeen = { Right: false, Left: false };
        let rawGesture = 'NONE';
        let conf = 0;
        let landmarks = null;
  
        if (result.gestures && result.gestures.length > 0 && result.handednesses) {
          // Get top gesture from first hand
          const topGesture = result.gestures[0][0];
          const handedness = result.handednesses[0][0];
          // MediaPipe returns mirrored handedness in mirror-view setups.
          // The video is mirrored for display, so the label maps directly
          // to the user's physical hand.
          const physical = handedness.categoryName === 'Right' ? 'Left' : 'Right';
          this.handsSeen[physical] = true;
          landmarks = result.landmarks[0];
  
          if (physical === 'Right' && topGesture.score >= ML_THRESHOLD) {
            const name = topGesture.categoryName.toUpperCase();
            if (VALID_GESTURES.has(name)) {
              rawGesture = name;
              conf = topGesture.score;
            }
          }
  
          // ── BALANCE detection (wrist stability) ────────────
          if (landmarks && physical === 'Right') {
            this._wristHistory.push({ x: landmarks[0].x, y: landmarks[0].y });
            if (this._wristHistory.length > BALANCE_WINDOW) this._wristHistory.shift();
            if (rawGesture === 'FORWARD' && this._wristHistory.length === BALANCE_WINDOW) {
              const xs = this._wristHistory.map(p => p.x);
              const ys = this._wristHistory.map(p => p.y);
              const dx = Math.max(...xs) - Math.min(...xs);
              const dy = Math.max(...ys) - Math.min(...ys);
              const spread = Math.sqrt(dx*dx + dy*dy);
              if (spread < BALANCE_THRESH) rawGesture = 'BALANCE';
            }
          }
        } else {
          this._wristHistory = [];
        }
  
        this._lastLandmarks = landmarks;
        this.rawGesture = rawGesture;
        this.confidence = conf;
  
        // ── Majority-vote smoothing ─────────────────────────
        this._history.push(rawGesture);
        if (this._history.length > SMOOTH_FRAMES) this._history.shift();
  
        const counts = {};
        for (const g of this._history) counts[g] = (counts[g] || 0) + 1;
        let topName = 'NONE', topCount = 0;
        for (const g in counts) {
          if (counts[g] > topCount) { topName = g; topCount = counts[g]; }
        }
        const voteConf = topCount / this._history.length;
        let voted = voteConf >= CONFIDENCE_GATE ? topName : this.currentGesture;
  
        // ── Debounce ────────────────────────────────────────
        const now = performance.now();
        if (voted !== this.currentGesture && (now - this._lastChangeT) >= DEBOUNCE_MS) {
          this.currentGesture = voted;
          this._lastChangeT = now;
        }
  
        // ── Accuracy tracking ───────────────────────────────
        this._tracker.update(this.currentGesture);
  
        // ── Draw preview ────────────────────────────────────
        this._drawPreview();
      },
  
      _drawPreview() {
        if (!this._previewCtx || !this._video) return;
        const ctx = this._previewCtx;
        const c   = this._previewCanvas;
  
        // Mirror video horizontally for selfie view
        ctx.save();
        ctx.scale(-1, 1);
        ctx.drawImage(this._video, -c.width, 0, c.width, c.height);
        ctx.restore();
  
        // Hand landmark overlay
        if (this._lastLandmarks) {
          const connections = [
            [0,1],[1,2],[2,3],[3,4],          // thumb
            [0,5],[5,6],[6,7],[7,8],          // index
            [5,9],[9,10],[10,11],[11,12],     // middle
            [9,13],[13,14],[14,15],[15,16],   // ring
            [13,17],[17,18],[18,19],[19,20],  // pinky
            [0,17]                            // palm base
          ];
          ctx.strokeStyle = '#00ff88';
          ctx.lineWidth   = 1.5;
          ctx.fillStyle   = '#d4642a';
          for (const [a, b] of connections) {
            const pa = this._lastLandmarks[a];
            const pb = this._lastLandmarks[b];
            ctx.beginPath();
            ctx.moveTo((1 - pa.x) * c.width, pa.y * c.height);
            ctx.lineTo((1 - pb.x) * c.width, pb.y * c.height);
            ctx.stroke();
          }
          for (const p of this._lastLandmarks) {
            ctx.beginPath();
            ctx.arc((1 - p.x) * c.width, p.y * c.height, 2.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      },
    };
  
    window.BrowserGesture = BrowserGesture;
  })();