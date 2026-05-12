// src/main.js — ZENITH DRIVEN
// FIXES & ADDITIONS THIS REVISION:
//   ROOT CAUSE FIX (leaderboard duplication):
//     • Added _savedRecordThisRun module-level guard flag
//     • saveRecord() blocks any second call within the same run
//     • Flag is reset on _doRestart() and _doFullRestart()
//     • On network error, the flag is reset to allow a retry
//   Combined with server.js UPSERT logic and db.js UNIQUE KEY,
//   this prevents the same user from getting multiple leaderboard rows.
//
//   TASK 3 — End-game animated leaderboard screen
//   TASK 2 — saveRecord() hits the UPSERT endpoint in server.js
//   GESTURE ACCURACY — AccuracyDisplay overlay shown after game ends;
//                       game_reset signal sent to gestureControl.py on restart

const SCREEN_W  = 1920;
const SCREEN_H  = 1080;
const SCREEN_CX = SCREEN_W / 2;
const SCREEN_CY = SCREEN_H / 2;

const STATE_COUNTDOWN = 0;
const STATE_PLAY      = 3;
const STATE_GAMEOVER  = 4;
const STATE_COMPLETE  = 5;
const STATE_PAUSED    = 6;

const PLAYER = 0;

var sharedSocket      = null;
var sharedGesture     = 'NONE';
var sharedWsConnected = false;

const API_BASE = 'http://localhost:3000/api';

// ─────────────────────────────────────────────────────────────────────────
// LEADERBOARD GUARD — prevents duplicate saves from the same run
// ─────────────────────────────────────────────────────────────────────────
// saveRecord() is reachable from 4 code paths:
//   1. STATE_COMPLETE (win)               → "Completed"
//   2. _triggerGameOver (off-track loss)  → "Game Unfinished"
//   3. _doPauseQuit (quit from pause)     → "Game Unfinished"
//   4. _doQuit (quit from game over /     → "Game Unfinished"
//      win screen)
//
// Without this guard, a winning run that uses the win-screen Quit button
// would fire saveRecord("Completed") then saveRecord("Game Unfinished"),
// creating two API requests. The flag ensures only the FIRST save per run
// reaches the server.
//
// Reset by _doRestart() / _doFullRestart() so the next run can save again.
// On network error, reset so the player can retry.
// ─────────────────────────────────────────────────────────────────────────
var _savedRecordThisRun = false;

async function saveRecord(timeSec, levelsCompleted, status) {
  if (_savedRecordThisRun) {
    console.log('[LB] saveRecord() blocked — already saved this run.',
      '| Attempted:', status, levelsCompleted, 'levels');
    return;
  }
  _savedRecordThisRun = true;

  const token = sessionStorage.getItem('token');
  if (!token) {
    console.warn('[LB] saveRecord() — no token in sessionStorage, skipping.');
    return;
  }

  console.log('[LB] Saving record —',
    'status:', status,
    'levels:', levelsCompleted,
    'time:', timeSec
  );

  try {
    const res = await fetch(`${API_BASE}/leaderboard/save`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({
        time_completed:   timeSec,
        levels_completed: levelsCompleted,
        status
      })
    });
    const data = await res.json().catch(() => ({}));
    console.log('[LB] Server response:', data);

    if (!res.ok) {
      console.error('[LB] Save failed — HTTP', res.status, data.error);
    }
  } catch (e) {
    // Network error: allow retry on the next call
    _savedRecordThisRun = false;
    console.warn('[LB] Could not save record (network error):', e.message);
  }
}

// ── Format seconds → MM:SS.s ──
function formatTime(secs) {
  if (secs == null) return '—';
  const m = Math.floor(secs / 60).toString().padStart(2, '0');
  const s = (secs % 60).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
}

function escHtml(str) {
  return String(str).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// ══════════════════════════════════════════════════════════════
//  StartScene
// ══════════════════════════════════════════════════════════════
class StartScene extends Phaser.Scene {
  constructor() { super({ key: 'SceneStart' }); }

  create() {
    const username = sessionStorage.getItem('username') || 'DRIVER';

    var bg = this.add.graphics();
    bg.fillGradientStyle(0x0a0a1f, 0x0a0a1f, 0x12001a, 0x12001a, 1);
    bg.fillRect(0, 0, SCREEN_W, SCREEN_H);

    this._roadLines = this.add.graphics();
    this._roadTimer = 0;
    this._drawRoadLines(0);

    this.add.text(SCREEN_CX, 160, 'ZENITH\nDRIVEN', {
      fontFamily: "'Bebas Neue','Arial Black',sans-serif",
      fontSize: '140px', fill: '#e8ff00', align: 'center', lineSpacing: -20,
      stroke: '#000', strokeThickness: 4,
      shadow: { offsetX:0, offsetY:0, color:'#e8ff00', blur:50, fill:true }
    }).setOrigin(0.5);

    this.add.text(SCREEN_CX, 370, 'HAND-GESTURE RACING', {
      fontFamily: 'monospace', fontSize: '28px', fill: '#55556a', letterSpacing: 8
    }).setOrigin(0.5);

    this.add.text(SCREEN_CX, 470, 'WELCOME, ' + username.toUpperCase(), {
      fontFamily: "'Bebas Neue','Arial Black',sans-serif",
      fontSize: '56px', fill: '#ffffff', letterSpacing: 4
    }).setOrigin(0.5);

    this._startText = this.add.text(SCREEN_CX, 590, 'START GAME', {
      fontFamily: "'Press Start 2P',monospace",
      fontSize: '54px', fill: '#e8ff00', stroke: '#000', strokeThickness: 3
    }).setOrigin(0.5);

    this._flickerOn = true;
    this.time.addEvent({ delay: 520, loop: true, callback: () => {
      this._flickerOn = !this._flickerOn;
      this._startText.setAlpha(this._flickerOn ? 1 : 0.15);
    }});

    this.add.text(SCREEN_CX, 690, 'Point your index finger toward the camera to start', {
      fontFamily: 'monospace', fontSize: '26px', fill: '#aaaaaa'
    }).setOrigin(0.5);

    var legends = [
      ['✋ BRAKE','Open palm toward camera'], ['👆 START','Index finger → camera'],
      ['🤜 REVERSE','Closed fist'],           ['👐 FORWARD','Palm facing down'],
      ['⬅ LEFT','Back of hand, fingers left'],['➡ RIGHT','Palm to cam, fingers right'],
    ];
    var legX = SCREEN_CX - 340, legY = 800;
    legends.forEach(function(pair, i) {
      var col = i % 2 === 0 ? legX : legX + 380;
      var row = legY + Math.floor(i / 2) * 50;
      this.add.text(col,     row, pair[0], { fontFamily:'monospace', fontSize:'20px', fill:'#e8ff00' });
      this.add.text(col+145, row, pair[1], { fontFamily:'monospace', fontSize:'20px', fill:'#777' });
    }, this);

    this.add.text(SCREEN_CX, 1020,
      'KEYBOARD: SPACE=Start · Arrows=Drive · SPACE=Brake · P=Pause · Q=Quit(paused)',
      { fontFamily:'monospace', fontSize:'17px', fill:'#333355' }
    ).setOrigin(0.5);

    this._wsStatusText = this.add.text(20, SCREEN_H - 40, 'WS: Connecting…', {
      fontFamily:'monospace', fontSize:'18px', fill:'#ffff00',
      backgroundColor:'#00000088', padding:{x:6,y:3}
    });

    this._connectWS();
    this.input.keyboard.once('keydown-SPACE', () => this._startGame());
    this._started = false;
  }

  _drawRoadLines(offset) {
    this._roadLines.clear();
    var vanX = SCREEN_CX, vanY = 400;
    for (var i = 0; i < 12; i++) {
      var t = i / 12, y = vanY + (SCREEN_H - vanY) * t, w = 20 + 500 * t;
      for (var l = -1; l <= 1; l++) {
        this._roadLines.lineStyle(2, 0xe8ff00, 0.03 + 0.07 * t);
        this._roadLines.lineBetween(vanX + l * 5, vanY, vanX + l * w * 0.33, y);
      }
    }
    var dashOffset = (offset % 80) / 80;
    for (var d = 0; d < 8; d++) {
      var dt2 = (d / 8 + dashOffset) % 1;
      var dy = vanY + (SCREEN_H - vanY) * dt2;
      this._roadLines.fillStyle(0xe8ff00, 0.25 * dt2);
      this._roadLines.fillRect(SCREEN_CX - 5, dy, 10, 18 * dt2);
    }
  }

  _connectWS() {
    try {
      sharedSocket = new WebSocket('ws://localhost:8765');
      sharedSocket.onopen = () => {
        sharedWsConnected = true;
        this._wsStatusText && this._wsStatusText.setText('WS: Connected ✓').setStyle({ fill:'#00ff00' });
      };
      sharedSocket.onmessage = (event) => {
        try {
          var data = JSON.parse(event.data);
          if (typeof data.gesture === 'string') {
            sharedGesture = data.gesture;
            if (data.gesture === 'START' && !this._started) this._startGame();
          }
        } catch {}
      };
      sharedSocket.onerror = () => {
        sharedWsConnected = false;
        this._wsStatusText && this._wsStatusText.setText('WS: Error').setStyle({ fill:'#ff4444' });
      };
      sharedSocket.onclose = () => {
        sharedWsConnected = false;
        this._wsStatusText && this._wsStatusText.setText('WS: Offline (keyboard only)').setStyle({ fill:'#ff8800' });
      };
    } catch (e) { console.warn('WebSocket init failed:', e); }
  }

  update(_time, delta) {
    this._roadTimer = (this._roadTimer || 0) + delta;
    this._drawRoadLines(this._roadTimer * 0.05);
  }

  _startGame() {
    if (this._started) return;
    this._started = true;
    var flash = this.add.rectangle(SCREEN_CX, SCREEN_CY, SCREEN_W, SCREEN_H, 0xe8ff00, 0);
    this.tweens.add({ targets: flash, alpha: 0.5, duration: 120, yoyo: true,
      onComplete: () => this.scene.start('SceneMain') });
  }
}

// ══════════════════════════════════════════════════════════════
//  MainScene
// ══════════════════════════════════════════════════════════════
class MainScene extends Phaser.Scene {
  constructor() { super({ key: 'SceneMain' }); }

  preload() {
    this.load.image('imageBack',     'assets/img_nightback.png');
    this.load.image('imagePlayer',   'assets/img_player.png');
    this.load.image('imageTraffic1', 'assets/img_bluetruck.png');
    this.load.image('imageTraffic2', 'assets/img_pinkcar.png');
    this.load.image('imageTraffic3', 'assets/img_greencar.png');
  }

  create() {
    const username = sessionStorage.getItem('username') || 'DRIVER';

    // ── New game run starts here — reset the leaderboard guard ──
    _savedRecordThisRun = false;

    // ── WebSocket ──────────────────────────────────────────
    this.currentGesture = sharedGesture;
    this.wsConnected    = sharedWsConnected;

    // Accuracy data received from gestureControl.py
    this._gestureAccuracy = null;

    if (sharedSocket) {
      sharedSocket.onmessage = (event) => {
        try {
          var d = JSON.parse(event.data);
          if (typeof d.gesture === 'string') {
            this.currentGesture = sharedGesture = d.gesture;
          }
          // Receive accuracy updates from Python
          if (d.type === 'accuracy_update' || d.type === 'accuracy_report') {
            this._gestureAccuracy = d.data;
            if (this._accDisplay) this._refreshAccDisplay();
          }
        } catch {}
      };
      sharedSocket.onopen  = () => { this.wsConnected = sharedWsConnected = true; };
      sharedSocket.onerror = () => { this.wsConnected = false; };
      sharedSocket.onclose = () => { this.wsConnected = false; };
    } else {
      this.wsConnected = false;
      this._connectWS();
    }

    // ── Background + player sprite ─────────────────────────
    this.sprBack = this.add.image(SCREEN_CX, SCREEN_CY, 'imageBack');
    this.sprites = [this.add.image(0, 0, 'imagePlayer').setVisible(false)];

    // ── Core systems ───────────────────────────────────────
    this.circuit      = new Circuit(this);
    this.camera       = new Camera(this);
    this.player       = new Player(this);
    this.traffic      = new Traffic(this);
    this.settings     = new Settings(this);
    this.levelManager = new LevelManager(this);

    // ── State ──────────────────────────────────────────────
    this.elapsedSec        = 0;
    this.timerRunning      = false;
    this._gameState        = STATE_COUNTDOWN;
    this._isPaused         = false;
    this.offTrackTime      = 0;
    this.offTrackWarned    = false;
    this.offTrackCountdown = 5;
    this.offTrackTimer     = null;

    // ── HUD ───────────────────────────────────────────────
    var hs = (sz, col) => ({
      fontFamily: 'monospace', fontSize: sz, fill: col || '#ffffff',
      backgroundColor: '#00000088', padding: { x:8, y:4 }
    });

    this.gestureText  = this.add.text(20, 20, 'Gesture: NONE', hs('28px')).setDepth(50);
    this.wsStatusText = this.add.text(20, 65,
      sharedWsConnected ? 'WS: ✓ Connected' : 'WS: Connecting…',
      hs('20px', sharedWsConnected ? '#00ff00' : '#ffff00')
    ).setDepth(50);

    this.timerText = this.add.text(SCREEN_CX, 20, '00:00.0', {
      fontSize: '36px', fill: '#e8ff00', fontFamily: 'monospace',
      backgroundColor: '#00000088', padding: { x:12, y:6 }
    }).setOrigin(0.5, 0).setDepth(50);

    this.levelText = this.add.text(SCREEN_CX, 72, '', hs('22px', '#aaffaa'))
      .setOrigin(0.5, 0).setDepth(50);
    this.levelManager.levelText = this.levelText;

    this.add.text(SCREEN_W - 20, 20, '👤 ' + username, {
      fontFamily: 'monospace', fontSize: '22px', fill: '#ffffff',
      backgroundColor: '#00000088', padding: { x:10, y:5 }
    }).setOrigin(1, 0).setDepth(50);

    this.speedText = this.add.text(20, SCREEN_H - 60,  'Speed: 0 km/h', hs('28px')).setDepth(50);
    this.diffText  = this.add.text(20, SCREEN_H - 110, 'Traffic Lvl: 1', hs('24px', '#aaffaa')).setDepth(50);

    this.offTrackText = this.add.text(SCREEN_CX, SCREEN_CY - 180, '', {
      fontSize: '64px', fill: '#ff8800', fontFamily: 'monospace',
      stroke: '#000', strokeThickness: 6
    }).setOrigin(0.5).setDepth(90).setVisible(false);

    this.countdownText = this.add.text(SCREEN_CX, SCREEN_CY - 80, '', {
      fontSize: '220px', fill: '#e8ff00', fontFamily: 'monospace',
      stroke: '#000', strokeThickness: 12
    }).setOrigin(0.5).setDepth(200).setVisible(false);
    this.countdownLabel = this.add.text(SCREEN_CX, SCREEN_CY + 160, '', {
      fontFamily: "'Bebas Neue',sans-serif", fontSize: '52px',
      fill: '#ffffff', stroke: '#000', strokeThickness: 4
    }).setOrigin(0.5).setDepth(200).setVisible(false);

    this.collisionOverlay = this.add.rectangle(SCREEN_CX, SCREEN_CY, SCREEN_W, SCREEN_H, 0xff0000, 0).setDepth(100);
    this.collisionText = this.add.text(SCREEN_CX, SCREEN_CY - 60, '⚠ COLLISION!', {
      fontSize: '72px', fill: '#ff0000', stroke: '#000', strokeThickness: 6
    }).setOrigin(0.5).setDepth(101).setVisible(false);

    // ── DOM Modals ────────────────────────────────────────
    this._injectModalCSS();
    this._createModals(username);
    this._createPauseModal(username);

    // ── Keyboard ─────────────────────────────────────────
    this.keyLeft  = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT);
    this.keyRight = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT);
    this.keyUp    = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.UP);
    this.keyDown  = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN);
    this.keySpace = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    this.input.keyboard.on('keydown-P', () => {
      if      (this._gameState === STATE_PLAY)   this._doPause();
      else if (this._gameState === STATE_PAUSED) this._doResume();
    });
    this.input.keyboard.on('keydown-Q', () => {
      if (this._gameState === STATE_PAUSED) this._doPauseQuit();
    });

    // ── Init ─────────────────────────────────────────────
    this.camera.init();
    this.player.init();
    this.levelManager.reset();
    this._startCountdown();
  }

  // ─────────────────────────────────────────────────────────
  //  PAUSE SYSTEM
  // ─────────────────────────────────────────────────────────
  _createPauseModal(username) {
    this._modalPause = this._makeModal(
      '⏸  PAUSED',
      username.toUpperCase() + ' — your race is on hold',
      [
        { label: '▶  RESUME  [ P ]', cls: 'btn-primary', cb: () => this._doResume() },
        { label: '✕  QUIT    [ Q ]', cls: 'btn-danger',  cb: () => this._doPauseQuit() },
      ]
    );
    document.body.appendChild(this._modalPause);
  }

  _doPause() {
    if (this._gameState !== STATE_PLAY) return;
    this._gameState   = STATE_PAUSED;
    this.timerRunning = false;
    this.settings.showPaused();
    this._modalPause.classList.add('show');
  }

  _doResume() {
    if (this._gameState !== STATE_PAUSED) return;
    this._gameState   = STATE_PLAY;
    this.timerRunning = true;
    this.settings.show();
    this._modalPause.classList.remove('show');
  }

  async _doPauseQuit() {
    this._modalPause.classList.remove('show');
    this._gameState   = STATE_GAMEOVER;
    this.timerRunning = false;
    await saveRecord(
      Math.round(this.elapsedSec * 10) / 10,
      this.levelManager.currentLevel,
      'Game Unfinished'
    );
    var sub = this._modalGameOver.querySelector('.modal-sub');
    if (sub) sub.textContent = 'Run saved as unfinished. You are now logged out.';
    this._showGameOver();
    this.time.delayedCall(4000, () => {
      sessionStorage.removeItem('token');
      sessionStorage.removeItem('username');
      window.location.href = 'index.html';
    });
  }

  // ─────────────────────────────────────────────────────────
  //  COUNTDOWN
  // ─────────────────────────────────────────────────────────
  _startCountdown() {
    var steps = ['3','2','1','GO!'], colors = ['#ff3c3c','#ff8800','#ffff00','#00ff88'], idx = 0;
    this._gameState = STATE_COUNTDOWN;
    this.player.speed = 0;

    var showNext = () => {
      if (idx >= steps.length) {
        this.countdownText.setVisible(false);
        this.countdownLabel.setVisible(false);
        this._gameState = STATE_PLAY;
        this.timerRunning = true;
        this.player.restart();
        return;
      }
      var label = steps[idx], color = colors[idx]; idx++;
      this.countdownText.setText(label).setStyle({ fill: color }).setVisible(true).setScale(1.4);
      this.tweens.add({ targets: this.countdownText, scaleX: 1.0, scaleY: 1.0, duration: 400, ease: 'Power2' });
      this.time.delayedCall(label === 'GO!' ? 700 : 900, showNext);
    };

    this.countdownLabel.setText('GET READY').setVisible(true);
    this.time.delayedCall(300, showNext);
  }

  // ─────────────────────────────────────────────────────────
  //  WS helpers
  // ─────────────────────────────────────────────────────────
  _connectWS() {
    try {
      sharedSocket = new WebSocket('ws://localhost:8765');
      sharedSocket.onopen = () => {
        this.wsConnected = sharedWsConnected = true;
        sharedSocket.onmessage = (event) => {
          try {
            var d = JSON.parse(event.data);
            if (typeof d.gesture === 'string') this.currentGesture = sharedGesture = d.gesture;
            if (d.type === 'accuracy_update' || d.type === 'accuracy_report') {
              this._gestureAccuracy = d.data;
              if (this._accDisplay) this._refreshAccDisplay();
            }
          } catch {}
        };
      };
      sharedSocket.onerror = sharedSocket.onclose = () => { this.wsConnected = false; };
    } catch {}
  }

  // Send a typed event to gestureControl.py via the relay
  _sendWsEvent(payload) {
    if (sharedSocket && sharedSocket.readyState === WebSocket.OPEN)
      sharedSocket.send(JSON.stringify(payload));
  }

  // ─────────────────────────────────────────────────────────
  //  OFF-TRACK
  // ─────────────────────────────────────────────────────────
  _isOffTrack() { return Math.abs(this.player.x) > 1.0; }

  _hideOffTrackUI() {
    this.offTrackText.setVisible(false);
    if (this.offTrackTimer) { this.offTrackTimer.remove(false); this.offTrackTimer = null; }
    this.offTrackCountdown = 5;
    this.offTrackWarned    = false;
  }

  _startOffTrackCountdown() {
    if (this.offTrackWarned) return;
    this.offTrackWarned    = true;
    this.offTrackCountdown = 5;
    this.offTrackText.setText('⚠ RETURN TO ROAD!  5').setVisible(true);
    this.offTrackTimer = this.time.addEvent({
      delay: 1000, repeat: 4,
      callback: () => {
        this.offTrackCountdown--;
        this.offTrackText.setText('⚠ RETURN TO ROAD!  ' + this.offTrackCountdown);
        if (this.offTrackCountdown <= 0) this._triggerGameOver();
      }
    });
  }

  _triggerGameOver() {
    this._hideOffTrackUI();
    this.timerRunning = false;
    this._gameState   = STATE_GAMEOVER;
    this._showGameOver();
    saveRecord(Math.round(this.elapsedSec * 10) / 10, this.levelManager.currentLevel, 'Game Unfinished');
  }

  // ─────────────────────────────────────────────────────────
  //  Collision flash
  // ─────────────────────────────────────────────────────────
  flashCollision() {
    this.collisionOverlay.setAlpha(0.45);
    this.tweens.add({ targets: this.collisionOverlay, alpha: 0, duration: 600, ease: 'Power2' });
    this.collisionText.setVisible(true);
    this.time.delayedCall(900, () => this.collisionText.setVisible(false));
  }

  // ─────────────────────────────────────────────────────────
  //  UPDATE
  // ─────────────────────────────────────────────────────────
  update(_time, delta) {
    switch (this._gameState) {

      case STATE_COUNTDOWN:
        this.camera.update();
        this.circuit.render3D();
        break;

      case STATE_PLAY: {
        var dt = Math.min(1, delta / 1000);
        if (this.timerRunning) this.elapsedSec += dt;

        var inCooldown = this.traffic.collisionCooldown > 0;

        if (this.wsConnected) {
          var g = this.currentGesture;
          this.player.moveLeft   = !inCooldown && g === 'LEFT';
          this.player.moveRight  = !inCooldown && g === 'RIGHT';
          this.player.accelerate = !inCooldown && g === 'FORWARD';
          this.player.brake      = g === 'BRAKE';
          this.player.reverse    = !inCooldown && g === 'REVERSE';
          if (g === 'BALANCE') {
            this.player.moveLeft = this.player.moveRight = this.player.accelerate =
            this.player.brake    = this.player.reverse   = false;
          }
        } else {
          this.player.moveLeft   = !inCooldown && this.keyLeft.isDown;
          this.player.moveRight  = !inCooldown && this.keyRight.isDown;
          this.player.accelerate = !inCooldown && this.keyUp.isDown;
          this.player.brake      = this.keySpace.isDown;
          this.player.reverse    = !inCooldown && this.keyDown.isDown;
        }

        this.player.update(dt);
        this.camera.update();
        this.traffic.update(dt);
        this.circuit.render3D();

        if (this._isOffTrack()) {
          var maxOT = this.player.maxSpeed * 0.3;
          if (this.player.speed > maxOT) this.player.speed = maxOT;
          this.offTrackTime += dt;
          if (this.offTrackTime >= 2 && !this.offTrackWarned)
            this._startOffTrackCountdown();
        } else {
          if (this.offTrackWarned) this._hideOffTrackUI();
          this.offTrackTime = 0;
        }

        var levelResult = this.levelManager.update();
        if (levelResult === 'complete') {
          this.timerRunning = false;
          this._gameState   = STATE_COMPLETE;
          saveRecord(Math.round(this.elapsedSec * 10) / 10, this.levelManager.totalLevels, 'Completed');
          this._hideAllModals();
          // TASK 3 — Show animated win screen instead of plain modal
          this._showWinScreen(Math.round(this.elapsedSec * 10) / 10);
        } else if (levelResult === 'next') {
          this._hideAllModals();
          this._modalLevelClear.classList.add('show');
          this.time.delayedCall(2200, () => {
            this._modalLevelClear.classList.remove('show');
            this._startCountdown();
          });
        }

        var kph = Math.round(Math.abs(this.player.speed) * 0.06);
        this.speedText.setText('Speed: ' + kph + ' km/h' + (this._isOffTrack() ? '  ⚠ OFF-TRACK' : ''));
        this.diffText.setText('Traffic Lvl: ' + this.traffic.difficultyLevel + '  |  Cars: ' + this.traffic.vehicles.length);
        this.gestureText.setText('Gesture: ' + this.currentGesture);
        this.wsStatusText.setText(this.wsConnected ? 'WS: ✓ Connected' : 'WS: Offline (keyboard)');

        var mins = Math.floor(this.elapsedSec / 60).toString().padStart(2, '0');
        var secs = (this.elapsedSec % 60).toFixed(1).padStart(4, '0');
        this.timerText.setText(mins + ':' + secs);

        var warn = this.traffic.getCollisionWarning();
        this.speedText.setStyle({ fill: warn > 0.6 ? '#ff4444' : warn > 0.3 ? '#ffaa00' : (this._isOffTrack() ? '#ff8800' : '#ffffff') });
        break;
      }

      case STATE_PAUSED:
        this.circuit.render3D();
        break;

      case STATE_GAMEOVER:
      case STATE_COMPLETE:
        break;
    }
  }

  // ─────────────────────────────────────────────────────────
  //  TASK 3 — ANIMATED WIN SCREEN  (congratulations → leaderboard)
  // ─────────────────────────────────────────────────────────
  _showWinScreen(finalTimeSec) {
    const username = sessionStorage.getItem('username') || 'DRIVER';
    const overlay  = document.createElement('div');
    overlay.id = 'win-overlay';

    overlay.innerHTML = `
      <style>
        #win-overlay {
          position: fixed; inset: 0; z-index: 10000;
          background: rgba(0,0,0,0.92);
          display: flex; flex-direction: column;
          align-items: center; justify-content: flex-start;
          padding: 40px 20px; overflow-y: auto;
          font-family: 'Bebas Neue','Arial Black',sans-serif;
        }
        .win-congrats {
          text-align: center; margin-bottom: 32px;
          opacity: 0; transform: translateY(-30px);
          animation: winSlideIn 0.7s 0.1s ease forwards;
        }
        @keyframes winSlideIn {
          to { opacity: 1; transform: none; }
        }
        .win-trophy   { font-size: 80px; line-height: 1; }
        .win-title    { font-size: 72px; color: #e8ff00; letter-spacing: 3px; line-height: 1; }
        .win-subtitle { font-family: monospace; font-size: 18px; color: #888; margin-top: 8px; letter-spacing: 2px; }
        .win-time     { font-size: 40px; color: #fff; margin-top: 10px; }
        .win-time span { color: #e8ff00; }

        .win-lb-title {
          font-family: monospace; font-size: 13px; letter-spacing: 5px;
          text-transform: uppercase; color: #e8ff00; margin-bottom: 16px;
          opacity: 0; animation: winSlideIn 0.5s 0.8s ease forwards;
        }
        .win-lb-table { width: 700px; max-width: 96vw; border-collapse: collapse; }
        .win-lb-row {
          opacity: 0; transform: translateX(-40px);
          transition: background 0.3s;
        }
        .win-lb-row td {
          padding: 10px 14px; font-family: monospace; font-size: 15px;
          border-bottom: 1px solid rgba(255,255,255,0.06);
        }
        .win-lb-row.rank-1 { background: linear-gradient(90deg,rgba(255,215,0,0.14),transparent); }
        .win-lb-row.rank-2 { background: linear-gradient(90deg,rgba(192,192,192,0.08),transparent); }
        .win-lb-row.rank-3 { background: linear-gradient(90deg,rgba(205,127,50,0.08),transparent); }
        .win-lb-row.is-me  { background: linear-gradient(90deg,rgba(232,255,0,0.10),transparent);
                              box-shadow: inset 3px 0 0 #e8ff00; }
        .win-lb-row td.rank-icon { font-size: 20px; width: 36px; }
        .win-lb-row td.lb-name { color: #fff; font-weight: 600; }
        .win-lb-row.rank-1 td.lb-name { color: #ffd700; }
        .win-lb-row.is-me  td.lb-name { color: #e8ff00; }
        .win-lb-row td.lb-time { color: #e8ff00; font-size: 14px; }
        .win-lb-row td.lb-badge {
          font-size: 11px; padding: 3px 8px; border-radius: 2px;
          text-transform: uppercase; letter-spacing: 1px;
        }
        .win-lb-row td.lb-badge.done       { background: rgba(232,255,0,0.15); color: #e8ff00; }
        .win-lb-row td.lb-badge.unfinished { background: rgba(255,60,60,0.15);  color: #ff3c3c; }
        .win-lb-row.visible-row {
          animation: lbRowIn 0.5s ease forwards;
        }
        @keyframes lbRowIn {
          from { opacity: 0; transform: translateX(-40px); }
          to   { opacity: 1; transform: none; }
        }
        .win-player-rank {
          margin-top: 12px; margin-bottom: 24px;
          font-family: monospace; font-size: 15px; color: #aaa;
          opacity: 0; animation: winSlideIn 0.5s 1s ease forwards;
        }
        .win-player-rank span { color: #e8ff00; font-size: 18px; }
        .win-btn-row {
          display: flex; gap: 16px; margin-top: 32px;
          opacity: 0; animation: winSlideIn 0.5s 0.9s ease forwards;
        }
        .win-btn {
          font-family: 'Bebas Neue',sans-serif; font-size: 22px; letter-spacing: 2px;
          padding: 14px 40px; border: none; border-radius: 4px;
          cursor: pointer; transition: opacity .15s, transform .1s;
        }
        .win-btn:hover { opacity: 0.85; }
        .win-btn:active { transform: scale(0.97); }
        .win-btn-primary   { background: #e8ff00; color: #000; }
        .win-btn-secondary { background: #1e1e2e; color: #fff; border: 1px solid #444; }

        /* ── ACCURACY PANEL ── */
        .win-acc-panel {
          width: 700px; max-width: 96vw; margin: 20px 0 0;
          background: rgba(255,255,255,0.03); border: 1px solid #1e1e2e;
          border-radius: 6px; padding: 20px 28px;
          opacity: 0; animation: winSlideIn 0.5s 1.1s ease forwards;
        }
        .win-acc-title {
          font-family: monospace; font-size: 12px; letter-spacing: 4px;
          text-transform: uppercase; color: #e8ff00; margin-bottom: 14px;
        }
        .win-acc-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; }
        .win-acc-stat { font-family: monospace; font-size: 14px; color: #aaa; }
        .win-acc-stat span { color: #fff; font-size: 16px; }
        .win-acc-bar-wrap {
          grid-column: 1/-1; margin-top: 10px;
          background: #1a1a2e; border-radius: 4px; height: 14px; overflow: hidden;
        }
        .win-acc-bar { height: 100%; border-radius: 4px; transition: width 1.2s ease; }
        .win-acc-pct {
          grid-column: 1/-1; text-align: right;
          font-family: 'Bebas Neue',sans-serif; font-size: 36px; color: #e8ff00;
          margin-top: 4px;
        }
      </style>

      <div class="win-congrats">
        <div class="win-trophy">🏆</div>
        <div class="win-title">ALL LEVELS COMPLETE</div>
        <div class="win-subtitle">LEGENDARY PERFORMANCE — ALL 3 STAGES CLEARED</div>
        <div class="win-time">Final Time: <span id="winFinalTime">--:--.-</span></div>
      </div>

      <div class="win-lb-title">🏁 GLOBAL LEADERBOARD 🏁</div>
      <div class="win-player-rank" id="winPlayerRank">Fetching your rank…</div>
      <table class="win-lb-table" id="winLbTable"><tbody id="winLbBody"></tbody></table>

      <div class="win-acc-panel" id="winAccPanel">
        <div class="win-acc-title">📊 Gesture Accuracy Report</div>
        <div class="win-acc-grid" id="winAccGrid">
          <div class="win-acc-stat">Total Gestures: <span id="accTotal">—</span></div>
          <div class="win-acc-stat">Correct: <span id="accCorrect">—</span></div>
          <div class="win-acc-stat">Incorrect: <span id="accIncorrect">—</span></div>
          <div class="win-acc-stat">Session Frames: <span id="accFrames">—</span></div>
          <div class="win-acc-bar-wrap"><div class="win-acc-bar" id="accBar" style="width:0%;background:#e8ff00"></div></div>
          <div class="win-acc-pct" id="accPct">—%</div>
        </div>
      </div>

      <div class="win-btn-row">
        <button class="win-btn win-btn-primary"   id="winBtnPlay">PLAY AGAIN</button>
        <button class="win-btn win-btn-secondary" id="winBtnQuit">QUIT</button>
      </div>
    `;

    document.body.appendChild(overlay);

    // Set final time
    document.getElementById('winFinalTime').textContent = formatTime(finalTimeSec);

    // Wire buttons
    document.getElementById('winBtnPlay').addEventListener('click', () => {
      overlay.remove();
      this._winOverlay = null;
      this._doFullRestart();
    });
    document.getElementById('winBtnQuit').addEventListener('click', () => {
      overlay.remove();
      this._doQuit();
    });

    this._winOverlay = overlay;

    // Request accuracy data from Python immediately
    this._sendWsEvent({ type: 'request_accuracy' });

    // Populate accuracy panel from cached data if already received
    if (this._gestureAccuracy) this._refreshAccDisplay();

    // Fetch & animate leaderboard
    this._animateWinLeaderboard(username);
  }

  async _animateWinLeaderboard(username) {
    const tbody      = document.getElementById('winLbBody');
    const rankEl     = document.getElementById('winPlayerRank');
    const rankIcons  = ['🥇', '🥈', '🥉'];
    const rankClasses = ['rank-1', 'rank-2', 'rank-3'];

    try {
      const res  = await fetch(`${API_BASE}/leaderboard`);
      const rows = await res.json();

      tbody.innerHTML = '';

      // Find player's rank
      const playerRankIdx = rows.findIndex(r => r.username === username);
      if (playerRankIdx >= 0) {
        rankEl.innerHTML = `Your rank: <span>#${playerRankIdx + 1}</span> out of ${rows.length} drivers`;
      } else {
        rankEl.textContent = 'Leaderboard updated!';
      }

      // Build all rows (hidden initially)
      const displayRows = rows.slice(0, 10).map((r, i) => {
        const rankIcon  = rankIcons[i]  || (i + 1).toString();
        const rowCls    = rankClasses[i] || '';
        const isMeCls   = (r.username === username) ? 'is-me' : '';
        const badgeCls  = r.status === 'Completed' ? 'done' : 'unfinished';
        const badgeTxt  = r.status === 'Completed' ? '✓ Done' : 'DNF';
        const timeStr   = formatTime(r.time_completed);

        const tr = document.createElement('tr');
        tr.className = `win-lb-row ${rowCls} ${isMeCls}`.trim();
        tr.innerHTML = `
          <td class="rank-icon">${rankIcon}</td>
          <td class="lb-name">${escHtml(r.username)}</td>
          <td class="lb-time">${timeStr}</td>
          <td class="lb-badge ${badgeCls}">${badgeTxt}</td>
        `;
        tbody.appendChild(tr);
        return tr;
      });

      // Animate rows one-by-one
      displayRows.forEach((tr, i) => {
        setTimeout(() => {
          tr.classList.add('visible-row');
        }, 900 + i * 180);   // 180 ms stagger per row; starts after lb-title fades in
      });

    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="4" style="color:#555;font-size:13px;padding:12px">Could not load leaderboard.</td></tr>';
      rankEl.textContent = '';
    }
  }

  // Refresh the accuracy panel inside the win screen
  _refreshAccDisplay() {
    const d = this._gestureAccuracy;
    if (!d) return;

    var totalEl    = document.getElementById('accTotal');
    var correctEl  = document.getElementById('accCorrect');
    var incorrectEl= document.getElementById('accIncorrect');
    var framesEl   = document.getElementById('accFrames');
    var barEl      = document.getElementById('accBar');
    var pctEl      = document.getElementById('accPct');

    if (!totalEl) return;  // win screen not visible yet

    totalEl.textContent     = d.total_gestures     ?? '—';
    correctEl.textContent   = d.correct_detections ?? '—';
    incorrectEl.textContent = d.incorrect_detections ?? '—';
    framesEl.textContent    = d.total_frames        ?? '—';

    var pct = d.accuracy ?? 0;
    pctEl.textContent = pct.toFixed(1) + '%';

    // Colour: green ≥ 80, yellow 60–79, red < 60
    var barColor = pct >= 80 ? '#00e676' : pct >= 60 ? '#e8ff00' : '#ff3c3c';
    if (barEl) { barEl.style.width = pct + '%'; barEl.style.background = barColor; }
    if (pctEl) pctEl.style.color = barColor;

    // Also store for the HUD accuracy display in-game (if accessed mid-game)
    this._accDisplay = true;
  }

  // ─────────────────────────────────────────────────────────
  //  MODAL actions
  // ─────────────────────────────────────────────────────────
  _showGameOver()    { this._hideAllModals(); this._modalGameOver.classList.add('show'); }
  _showQuitConfirm() { this._hideAllModals(); this._modalQuitConfirm.classList.add('show'); }

  _doRestart() {
    // ── Reset leaderboard guard so the next run can save ──
    _savedRecordThisRun = false;

    this._hideAllModals();
    this.elapsedSec = 0; this.offTrackTime = 0;
    this._hideOffTrackUI();
    this.levelManager._applyConfig();
    // Notify Python to reset accuracy tracker
    this._sendWsEvent({ type: 'game_reset' });
    this._gestureAccuracy = null;
    this._startCountdown();
  }

  _doFullRestart() {
    // ── Reset leaderboard guard so the next run can save ──
    _savedRecordThisRun = false;

    this._hideAllModals();
    this.elapsedSec = 0; this.offTrackTime = 0;
    this._hideOffTrackUI();
    this.levelManager.reset();
    // Notify Python to reset accuracy tracker
    this._sendWsEvent({ type: 'game_reset' });
    this._gestureAccuracy = null;
    this._startCountdown();
  }

  async _doQuit() {
    this._hideAllModals();
    await saveRecord(Math.round(this.elapsedSec * 10) / 10, this.levelManager.currentLevel, 'Game Unfinished');
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('username');
    window.location.href = 'index.html';
  }

  // ─────────────────────────────────────────────────────────
  //  DOM helpers
  // ─────────────────────────────────────────────────────────
  _injectModalCSS() {
    if (document.getElementById('modal-css')) return;
    const s = document.createElement('style');
    s.id = 'modal-css';
    s.textContent = `
      .modal-overlay { position:fixed;inset:0;background:rgba(0,0,0,.78);display:none;
        align-items:center;justify-content:center;z-index:9999;
        font-family:'Bebas Neue','Arial Black',sans-serif; }
      .modal-overlay.show { display:flex; }
      .modal-box { background:#111118;border:2px solid #e8ff00;border-radius:6px;
        padding:48px 64px;text-align:center;min-width:520px;animation:modalPop .22s ease; }
      @keyframes modalPop { from{transform:scale(.88);opacity:0} to{transform:scale(1);opacity:1} }
      .modal-title { font-size:52px;color:#e8ff00;letter-spacing:2px;margin-bottom:12px; }
      .modal-sub   { font-family:monospace;font-size:16px;color:#aaa;margin-bottom:36px; }
      .modal-btn   { font-family:'Bebas Neue',sans-serif;font-size:24px;letter-spacing:2px;
        padding:14px 40px;border:none;border-radius:4px;cursor:pointer;margin:0 10px;transition:opacity .15s; }
      .modal-btn:hover { opacity:.8; }
      .btn-primary   { background:#e8ff00;color:#000; }
      .btn-secondary { background:#1e1e2e;color:#fff;border:1px solid #444; }
      .btn-danger    { background:#ff3c3c;color:#fff; }
    `;
    document.head.appendChild(s);
  }

  _createModals(username) {
    this._modalGameOver = this._makeModal('GAME OVER',
      username + ', your run has ended.',
      [{ label:'RESTART', cls:'btn-primary', cb:()=>this._doRestart() },
       { label:'QUIT',    cls:'btn-secondary', cb:()=>this._showQuitConfirm() }]);

    this._modalLevelClear = this._makeModal('LEVEL CLEAR!', 'Get ready for the next stage…', []);

    this._modalQuitConfirm = this._makeModal('LOG OUT?',
      'Your progress will be saved as "Game Unfinished".',
      [{ label:'YES, QUIT', cls:'btn-danger',    cb:()=>this._doQuit() },
       { label:'NO, BACK',  cls:'btn-secondary', cb:()=>this._showGameOver() }]);

    document.body.append(this._modalGameOver, this._modalLevelClear, this._modalQuitConfirm);
  }

  _makeModal(title, sub, buttons) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const box = document.createElement('div');
    box.className = 'modal-box';
    box.innerHTML = `<div class="modal-title">${title}</div><div class="modal-sub">${sub}</div>`;
    buttons.forEach(b => {
      const btn = document.createElement('button');
      btn.className = 'modal-btn ' + b.cls;
      btn.textContent = b.label;
      btn.addEventListener('click', b.cb);
      box.appendChild(btn);
    });
    overlay.appendChild(box);
    return overlay;
  }

  _hideAllModals() {
    [this._modalGameOver, this._modalLevelClear,
     this._modalQuitConfirm, this._modalPause].forEach(m => m && m.classList.remove('show'));
  }
}

// ══════════════════════════════════════════════════════════════
//  PauseScene — kept empty; pause handled by DOM modal
// ══════════════════════════════════════════════════════════════
class PauseScene extends Phaser.Scene {
  constructor() { super({ key: 'ScenePause' }); }
  create() {}
}

// ══════════════════════════════════════════════════════════════
//  Phaser Config
// ══════════════════════════════════════════════════════════════
var config = {
  type:   Phaser.AUTO,
  width:  SCREEN_W,
  height: SCREEN_H,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene:  [StartScene, MainScene, PauseScene]
};

var game = new Phaser.Game(config);