// src/main.js — ZENITH DRIVEN
// ═══════════════════════════════════════════════════════════════════════════
//  Gesture emoji mapping (matches gestureControl.py):
//    START   → 🫵   (pointing finger at camera)
//    FORWARD → ✋🫳  (palm down, fingers closed)
//    BRAKE   → 🖐   (open palm facing camera)
//    REVERSE → 🤜   (closed fist)
//    LEFT    → 🫲   (hand sign pointing left)
//    RIGHT   → 🫱   (hand sign pointing right)
//    BALANCE → 🖐🫳  (palm down, fingers spread)
// ═══════════════════════════════════════════════════════════════════════════

const SCREEN_W  = 1920;
const SCREEN_H  = 1080;
const SCREEN_CX = SCREEN_W / 2;
const SCREEN_CY = SCREEN_H / 2;

const STATE_COUNTDOWN  = 0;
const STATE_PLAY       = 3;
const STATE_GAMEOVER   = 4;
const STATE_COMPLETE   = 5;
const STATE_PAUSED     = 6;
const STATE_REDEMPTION = 7;

const PLAYER = 0;
const OFFROAD_X_THRESHOLD     = 1.10;
const BALANCE_COUNTDOWN_LIMIT = 10;

// Gesture-to-display mapping (icon + label + status colour)
const GESTURE_DISPLAY = {
  'NONE':    { icon: '—',     label: 'NONE',    color: '#5a6678' },
  'START':   { icon: '🫵',    label: 'START',   color: '#3a9d40' },
  'FORWARD': { icon: '✋🫳',   label: 'FORWARD', color: '#3a9d40' },
  'BRAKE':   { icon: '🖐',    label: 'BRAKE',   color: '#c83a3a' },
  'REVERSE': { icon: '🤜',    label: 'REVERSE', color: '#d4a52a' },
  'LEFT':    { icon: '🫲',    label: 'LEFT',    color: '#1a3d6e' },
  'RIGHT':   { icon: '🫱',    label: 'RIGHT',   color: '#1a3d6e' },
  'BALANCE': { icon: '🖐🫳',   label: 'BALANCE', color: '#d4642a' },
};

// Cross-scene WebSocket state (shared between start scene and main scene)
var sharedSocket      = null;
var sharedGesture     = 'NONE';
var sharedWsConnected = false;
var sharedAccuracy    = null;

const API_BASE = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
  ? 'http://localhost:3000/api'
  : `${location.protocol}//${location.host}/api`;

var _savedRecordThisRun = false;

async function saveRecord(timeSec, levelsCompleted, status) {
  if (_savedRecordThisRun) return;
  _savedRecordThisRun = true;
  const token = sessionStorage.getItem('token');
  if (!token) return;
  try {
    await fetch(`${API_BASE}/leaderboard/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ time_completed: timeSec, levels_completed: levelsCompleted, status })
    });
  } catch (e) {
    _savedRecordThisRun = false;
    console.warn('[LB] Save failed:', e.message);
  }
}

function formatTime(secs) {
  if (secs == null) return '—';
  const m = Math.floor(secs / 60).toString().padStart(2, '0');
  const s = (secs % 60).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
}

// ══════════════════════════════════════════════════════════════
//  StartScene
// ══════════════════════════════════════════════════════════════
class StartScene extends Phaser.Scene {
  constructor() { super({ key: 'SceneStart' }); }

  create() {
    const username = sessionStorage.getItem('username') || 'DRIVER';

    var bg = this.add.graphics();
    bg.fillGradientStyle(0xc8e0f5, 0xc8e0f5, 0xfaf0d8, 0xfaf0d8, 1);
    bg.fillRect(0, 0, SCREEN_W, SCREEN_H);

    this.add.text(SCREEN_CX, 180, 'ZENITH\nDRIVEN', {
      fontFamily: "'Bebas Neue','Arial Black',sans-serif",
      fontSize: '160px', fill: '#1a3d6e', align: 'center', lineSpacing: -20,
      stroke: '#ffffff', strokeThickness: 6
    }).setOrigin(0.5);

    this.add.text(SCREEN_CX, 400, 'HAND-GESTURE RACING', {
      fontFamily: 'monospace', fontSize: '32px', fill: '#406080', letterSpacing: 8
    }).setOrigin(0.5);

    this.add.text(SCREEN_CX, 470, 'WELCOME, ' + username.toUpperCase(), {
      fontFamily: "'Bebas Neue',sans-serif", fontSize: '52px', fill: '#1a3d6e'
    }).setOrigin(0.5);

    // ── Small note: gesture controls require local Python script ──
    var noteBg = this.add.rectangle(SCREEN_CX, 580, 920, 80, 0xffffff, 0.92)
      .setStrokeStyle(2, 0xd4642a);
    this.add.text(SCREEN_CX, 560,
      'NOTE',
      { fontFamily: 'monospace', fontSize: '14px',
        fill: '#d4642a', letterSpacing: 3, fontStyle: 'bold' }
    ).setOrigin(0.5);
    this.add.text(SCREEN_CX, 595,
      'Gesture controls available locally via Python script for now · Arrow keys work as fallback',
      { fontFamily: 'monospace', fontSize: '17px', fill: '#5a6678', align: 'center' }
    ).setOrigin(0.5);

    // ── START GAME button ──────────────────────────────────────
    this._startText = this.add.text(SCREEN_CX, 720, 'START GAME', {
      fontFamily: "'Press Start 2P',monospace",
      fontSize: '48px', fill: '#d4642a', stroke: '#ffffff', strokeThickness: 4
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    this._startText.on('pointerdown', () => this._startGame());

    this._flickerOn = true;
    this.time.addEvent({ delay: 520, loop: true, callback: () => {
      this._flickerOn = !this._flickerOn;
      this._startText.setAlpha(this._flickerOn ? 1 : 0.3);
    }});

    this.add.text(SCREEN_CX, 790, 'Press SPACE, click START GAME, or show 🫵 START gesture', {
      fontFamily: 'monospace', fontSize: '22px', fill: '#506680'
    }).setOrigin(0.5);

    // ── Gesture legend ─────────────────────────────────────────
    var legendImg = this.add.image(SCREEN_CX, 925, 'gestureLegend').setOrigin(0.5);
    var boxW = 1500, boxH = 205;          // available band: ~822 → 1028
    var scale = Math.min(boxW / legendImg.width, boxH / legendImg.height);
    legendImg.setScale(scale);

    this._wsStatusText = this.add.text(20, SCREEN_H - 40, 'Python script: checking…', {
      fontFamily:'monospace', fontSize:'18px', fill:'#5a6678',
      backgroundColor:'#ffffffcc', padding:{x:10, y:5}
    });

    this._connectWS();
    this.input.keyboard.once('keydown-SPACE', () => this._startGame());
    this._started = false;
  }

  _connectWS() {
    try {
      const wsProto = location.protocol === 'https:' ? 'wss' : 'ws';
      const wsUrl   = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
        ? 'ws://localhost:3000/gesture'
        : `${wsProto}://${location.host}/gesture`;
      sharedSocket = new WebSocket(wsUrl);

      sharedSocket.onopen = () => {
        sharedWsConnected = true;
        this._wsStatusText?.setText('🐍 Python script: ✓ CONNECTED').setStyle({ fill:'#3a9d40' });
      };
      sharedSocket.onmessage = (event) => {
        try {
          var data = JSON.parse(event.data);
          if (typeof data.gesture === 'string') {
            sharedGesture = data.gesture;
            if (data.gesture === 'START' && !this._started) this._startGame();
          }
          if (data.type === 'accuracy_update' || data.type === 'accuracy_report') {
            sharedAccuracy = data.data;
          }
        } catch {}
      };
      sharedSocket.onerror = () => {
        sharedWsConnected = false;
        this._wsStatusText?.setText('Python script: not connected').setStyle({ fill:'#c83a3a' });
      };
      sharedSocket.onclose = () => {
        sharedWsConnected = false;
        this._wsStatusText?.setText('Python script: not connected (keyboard works)').setStyle({ fill:'#d4642a' });
      };
    } catch (e) { console.warn('WebSocket init failed:', e); }
  }

  _startGame() {
    if (this._started) return;
    this._started = true;
    var flash = this.add.rectangle(SCREEN_CX, SCREEN_CY, SCREEN_W, SCREEN_H, 0xffffff, 0);
    this.tweens.add({ targets: flash, alpha: 0.6, duration: 120, yoyo: true,
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
    this.load.image('imageTrees',    'assets/img_trees.png');
    this.load.image('gestureLegend', 'assets/img_gestureLegend.png');
  }

  create() {
    const username = sessionStorage.getItem('username') || 'DRIVER';
    _savedRecordThisRun = false;
    sharedAccuracy = null;

    this.currentGesture = sharedGesture;
    this.wsConnected    = sharedWsConnected;

    if (sharedSocket) {
      sharedSocket.onmessage = (event) => {
        try {
          var d = JSON.parse(event.data);
          if (typeof d.gesture === 'string') {
            this.currentGesture = sharedGesture = d.gesture;
          }
          if (d.type === 'accuracy_update' || d.type === 'accuracy_report') {
            sharedAccuracy = d.data;
          }
        } catch {}
      };
      sharedSocket.onopen  = () => { this.wsConnected = sharedWsConnected = true; };
      sharedSocket.onerror = () => { this.wsConnected = false; };
      sharedSocket.onclose = () => { this.wsConnected = false; };

      // Notify Python script to reset its accuracy tracker for a new game.
      if (sharedSocket.readyState === WebSocket.OPEN) {
        sharedSocket.send(JSON.stringify({ type: 'game_reset' }));
      }
    }

    this.sprBack = this.add.image(SCREEN_CX, SCREEN_CY, 'imageBack');
    this.sprites = [this.add.image(0, 0, 'imagePlayer').setVisible(false)];

    this.circuit      = new Circuit(this);
    this.camera       = new Camera(this);
    this.player       = new Player(this);
    this.traffic      = new Traffic(this);
    this.settings     = new Settings(this);
    this.levelManager = new LevelManager(this);

    this.elapsedSec        = 0;
    this.timerRunning      = false;
    this._gameState        = STATE_COUNTDOWN;
    this.OFFTRACK_LIMIT    = 15;
    this.offTrackCountdown = this.OFFTRACK_LIMIT;
    this.offTrackTime      = 0;
    this.offTrackWarned    = false;
    this.offTrackTimer     = null;

    this._onBump           = false;
    this._turbulenceCarry  = 0;
    this._balanceTime      = 0;
    this._balanceWarned    = false;
    this._balanceTimer     = null;
    this._balanceCountdown = BALANCE_COUNTDOWN_LIMIT;

    this._shakeIntensity = 0;
    this._shakeTime      = 0;
    this._turbShakePhase = 0;

    // ─────────────────────────────────────────────────────────
    //  Left-side gesture HUD — large, vertically stacked,
    //  non-overlapping cards.
    // ─────────────────────────────────────────────────────────
    const HUD_LEFT_X = 30;
    let yCursor = 30;

    // Big gesture card (icon + name + sub-line)
    this.gestureCard = this.add.rectangle(HUD_LEFT_X + 130, yCursor + 70, 260, 140, 0xffffff, 0.95)
      .setOrigin(0.5).setStrokeStyle(3, 0xd4642a).setDepth(50);
    this.gestureIconText = this.add.text(HUD_LEFT_X + 60, yCursor + 70, '—', {
      fontSize: '60px'
    }).setOrigin(0.5).setDepth(51);
    this.gestureLabelText = this.add.text(HUD_LEFT_X + 140, yCursor + 50, 'NONE', {
      fontFamily: "'Bebas Neue',sans-serif",
      fontSize: '36px',
      fill: '#5a6678',
      letterSpacing: 2,
    }).setOrigin(0, 0.5).setDepth(51);
    this.gestureSubText = this.add.text(HUD_LEFT_X + 140, yCursor + 90, 'Awaiting input', {
      fontFamily: 'monospace', fontSize: '14px', fill: '#8a96a8'
    }).setOrigin(0, 0.5).setDepth(51);
    yCursor += 160;

    // Input source pill
    this.wsStatusText = this.add.text(HUD_LEFT_X, yCursor, '', {
      fontFamily: 'monospace', fontSize: '17px', fill: '#5a6678',
      backgroundColor: '#ffffffe6', padding: { x: 12, y: 6 }
    }).setDepth(50);
    yCursor += 48;

    // Level + lap pill
    this.levelText = this.add.text(HUD_LEFT_X, yCursor, '', {
      fontFamily: 'monospace', fontSize: '20px', fill: '#1a3d6e',
      backgroundColor: '#ffffffe6', padding: { x: 12, y: 6 }
    }).setDepth(50);
    this.levelManager.levelText = this.levelText;

    // Top-center timer
    this.timerText = this.add.text(SCREEN_CX, 30, '00:00.0', {
      fontSize: '42px', fill: '#ffffff', fontFamily: 'monospace',
      backgroundColor: '#d4642a', padding: { x: 22, y: 10 }
    }).setOrigin(0.5, 0).setDepth(50);

    // Top-right username
    this.add.text(SCREEN_W - 30, 30, '👤 ' + username, {
      fontFamily: 'monospace', fontSize: '22px', fill: '#2a3340',
      backgroundColor: '#ffffffe6', padding: { x: 14, y: 7 }
    }).setOrigin(1, 0).setDepth(50);

    // Bottom-left speed + difficulty
    this.speedText = this.add.text(HUD_LEFT_X, SCREEN_H - 60, 'Speed: 0 km/h', {
      fontFamily: 'monospace', fontSize: '28px', fill: '#2a3340',
      backgroundColor: '#ffffffe6', padding: { x: 12, y: 6 }
    }).setDepth(50);
    this.diffText  = this.add.text(HUD_LEFT_X, SCREEN_H - 110, 'Traffic Lvl: 1', {
      fontFamily: 'monospace', fontSize: '22px', fill: '#3a9d40',
      backgroundColor: '#ffffffe6', padding: { x: 12, y: 6 }
    }).setDepth(50);

    // Center alerts
    this.offTrackText = this.add.text(SCREEN_CX, SCREEN_CY - 200, '', {
      fontSize: '64px', fill: '#ffffff', fontFamily: 'monospace',
      backgroundColor: '#c83a3a', padding: { x: 28, y: 14 }
    }).setOrigin(0.5).setDepth(90).setVisible(false);

    this.balanceText = this.add.text(SCREEN_CX, SCREEN_CY - 200, '', {
      fontSize: '60px', fill: '#ffffff', fontFamily: 'monospace',
      backgroundColor: '#d4642a', padding: { x: 28, y: 14 }
    }).setOrigin(0.5).setDepth(90).setVisible(false);

    this.countdownText = this.add.text(SCREEN_CX, SCREEN_CY - 80, '', {
      fontSize: '220px', fill: '#d4642a', fontFamily: 'monospace',
      stroke: '#ffffff', strokeThickness: 12
    }).setOrigin(0.5).setDepth(200).setVisible(false);
    this.countdownLabel = this.add.text(SCREEN_CX, SCREEN_CY + 160, '', {
      fontFamily: "'Bebas Neue',sans-serif", fontSize: '52px',
      fill: '#1a3d6e', stroke: '#ffffff', strokeThickness: 4
    }).setOrigin(0.5).setDepth(200).setVisible(false);

    this.collisionOverlay = this.add.rectangle(SCREEN_CX, SCREEN_CY, SCREEN_W, SCREEN_H, 0xff0000, 0).setDepth(100);
    this.collisionText = this.add.text(SCREEN_CX, SCREEN_CY - 60, '⚠ COLLISION!', {
      fontSize: '96px', fill: '#c83a3a', stroke: '#ffffff', strokeThickness: 8
    }).setOrigin(0.5).setDepth(101).setVisible(false);

    this._injectModalCSS();
    this._createModals(username);
    this._createPauseModal(username);

    this.keyLeft  = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT);
    this.keyRight = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT);
    this.keyUp    = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.UP);
    this.keyDown  = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN);
    this.keySpace = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.keyB     = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.B);

    this.input.keyboard.on('keydown-P', () => {
      if      (this._gameState === STATE_PLAY)   this._doPause();
      else if (this._gameState === STATE_PAUSED) this._doResume();
    });
    this.input.keyboard.on('keydown-Q', () => {
      if (this._gameState === STATE_PAUSED) this._doPauseQuit();
    });

    this.camera.init();
    this.player.init();
    this.levelManager.reset();
    this._startCountdown();
  }

  _updateGestureIndicator(gestureName) {
    var info = GESTURE_DISPLAY[gestureName] || GESTURE_DISPLAY['NONE'];
    this.gestureIconText.setText(info.icon);
    this.gestureLabelText.setText(info.label).setStyle({ fill: info.color });
    this.gestureSubText.setText(this.wsConnected ? '🐍 Python script' : '⌨  Keyboard mode');
    this.gestureCard.setStrokeStyle(3, parseInt(info.color.slice(1), 16));
  }

  _createPauseModal(username) {
    this._modalPause = this._makeModal(
      '⏸  PAUSED',
      username.toUpperCase() + ' — your race is on hold',
      [
        { label: '▶  RESUME  [ P ]', cls: 'btn-primary',   cb: () => this._doResume() },
        { label: '✕  QUIT    [ Q ]', cls: 'btn-secondary', cb: () => this._doPauseQuit() },
      ]
    );
    document.body.appendChild(this._modalPause);
  }

  _doPause() {
    if (this._gameState !== STATE_PLAY) return;
    this._gameState = STATE_PAUSED;
    this.timerRunning = false;
    this.settings.showPaused();
    this._modalPause.classList.add('show');
  }

  _doResume() {
    if (this._gameState !== STATE_PAUSED) return;
    this._gameState = STATE_PLAY;
    this.timerRunning = true;
    this.settings.show();
    this._modalPause.classList.remove('show');
  }

  async _doPauseQuit() {
    this._modalPause.classList.remove('show');
    this._gameState = STATE_GAMEOVER;
    this.timerRunning = false;
    await saveRecord(
      Math.round(this.elapsedSec * 10) / 10,
      this.levelManager.currentLevel,
      'Game Unfinished'
    );
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('username');
    window.location.href = 'index.html';
  }

  _startCountdown() {
    var steps = ['3','2','1','GO!'], colors = ['#c83a3a','#d4642a','#d4a52a','#3a9d40'], idx = 0;
    this._gameState = STATE_COUNTDOWN;
    this.player.speed = 0;
    this.player.steerVelocity = 0;
    this.player.controlLocked = false;
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

  _isOffTrack() { return Math.abs(this.player.x) > OFFROAD_X_THRESHOLD; }

  _hideOffTrackUI() {
    this.offTrackText.setVisible(false);
    if (this.offTrackTimer) { this.offTrackTimer.remove(false); this.offTrackTimer = null; }
    this.offTrackCountdown = this.OFFTRACK_LIMIT;
    this.offTrackWarned    = false;
  }

  _startOffTrackCountdown() {
    if (this.offTrackWarned) return;
    this.offTrackWarned    = true;
    this.offTrackCountdown = this.OFFTRACK_LIMIT;
    this.offTrackText.setText('⚠ RETURN TO ROAD!  ' + this.OFFTRACK_LIMIT).setVisible(true);
    this.offTrackTimer = this.time.addEvent({
      delay: 1000, repeat: this.OFFTRACK_LIMIT - 1,
      callback: () => {
        this.offTrackCountdown--;
        this.offTrackText.setText('⚠ RETURN TO ROAD!  ' + this.offTrackCountdown);
        if (this.offTrackCountdown <= 0) this._handleFailure('off-track');
      }
    });
  }

  _hideBalanceUI() {
    this.balanceText.setVisible(false);
    if (this._balanceTimer) { this._balanceTimer.remove(false); this._balanceTimer = null; }
    this._balanceCountdown = BALANCE_COUNTDOWN_LIMIT;
    this._balanceWarned    = false;
    this._balanceTime      = 0;
  }

  _startBalanceCountdown() {
    if (this._balanceWarned) return;
    this._balanceWarned    = true;
    this._balanceCountdown = BALANCE_COUNTDOWN_LIMIT;
    this.balanceText.setText('🖐 HOLD BALANCE!  ' + BALANCE_COUNTDOWN_LIMIT).setVisible(true);
    this._balanceTimer = this.time.addEvent({
      delay: 1000, repeat: BALANCE_COUNTDOWN_LIMIT - 1,
      callback: () => {
        this._balanceCountdown--;
        this.balanceText.setText('🖐 HOLD BALANCE!  ' + this._balanceCountdown);
        if (this._balanceCountdown <= 0) this._handleFailure('balance');
      }
    });
  }

  _handleFailure(reason) {
    if (this._gameState === STATE_REDEMPTION || this._gameState === STATE_GAMEOVER) return;
    this._hideOffTrackUI();
    this._hideBalanceUI();
    this.timerRunning = false;
    this.player.controlLocked = true;
    this.player.speed = 0;
    this.player.steerVelocity = 0;
    this.player.turbulent = false;
    this._onBump = false;
    this._turbulenceCarry = 0;

    if (this.levelManager.useRedemption()) {
      this._gameState = STATE_REDEMPTION;
      this._showRedemptionToast(reason);
      this.time.delayedCall(2200, () => {
        this.levelManager.restartCurrentLevel();
        this._hideOffTrackUI();
        this._hideBalanceUI();
        this._startCountdown();
      });
    } else {
      this._gameState = STATE_GAMEOVER;
      saveRecord(Math.round(this.elapsedSec * 10) / 10,
                 this.levelManager.currentLevel, 'Game Unfinished');
      this._showGameOver();
    }
  }

  _showRedemptionToast(reason) {
    var reasonLabel = (reason === 'balance') ? 'Lost balance' : 'Went off-road';
    this._hideAllModals();
    this._modalRedemption.querySelector('.modal-sub').textContent =
      reasonLabel + ' — using your one retry for this level';
    this._modalRedemption.classList.add('show');
    this.time.delayedCall(2000, () => this._modalRedemption.classList.remove('show'));
  }

  flashCollision() {
    this.collisionOverlay.setAlpha(0.6);
    this.tweens.add({ targets: this.collisionOverlay, alpha: 0, duration: 1800, ease: 'Power2' });
    this.collisionText.setVisible(true).setAlpha(1).setScale(1.3);
    this.tweens.add({ targets: this.collisionText, scaleX: 1, scaleY: 1, duration: 250 });
    this.time.delayedCall(1800, () => {
      this.tweens.add({ targets: this.collisionText, alpha: 0, duration: 400,
        onComplete: () => this.collisionText.setVisible(false) });
    });
    this._shakeIntensity = 20;
    this._shakeTime      = 1.5;
  }

  update(_time, delta) {
    switch (this._gameState) {

      case STATE_COUNTDOWN:
      case STATE_REDEMPTION:
        this.camera.update();
        this.circuit.render3D();
        break;

      case STATE_PLAY: {
        var dt = Math.min(1, delta / 1000);
        if (this.timerRunning) this.elapsedSec += dt;

        var inCooldown = this.traffic.collisionCooldown > 0;
        var balanceHeld = false;

        var activeGesture = this.wsConnected ? this.currentGesture : 'NONE';

        var gestureLeft   = !inCooldown && activeGesture === 'LEFT';
        var gestureRight  = !inCooldown && activeGesture === 'RIGHT';
        var gestureAccel  = !inCooldown && activeGesture === 'FORWARD';
        var gestureBrake  = activeGesture === 'BRAKE';
        var gestureRev    = !inCooldown && activeGesture === 'REVERSE';
        balanceHeld       = (activeGesture === 'BALANCE');

        if (activeGesture === 'BALANCE' || activeGesture === 'NONE' || activeGesture === '') {
          gestureLeft = gestureRight = gestureAccel = gestureBrake = gestureRev = false;
        }

        // Keyboard always works — OR-merged with gesture input
        this.player.moveLeft   = gestureLeft  || (!inCooldown && this.keyLeft.isDown);
        this.player.moveRight  = gestureRight || (!inCooldown && this.keyRight.isDown);
        this.player.accelerate = gestureAccel || (!inCooldown && this.keyUp.isDown);
        this.player.brake      = gestureBrake || this.keySpace.isDown;
        this.player.reverse    = gestureRev   || (!inCooldown && this.keyDown.isDown);
        balanceHeld            = balanceHeld  || this.keyB.isDown;

        this.player.balanceActive = balanceHeld;

        // Bump detection with turbulence carry-over
        var onBumpNow = this.circuit.isOnBump(this.player.z);
        if (onBumpNow) {
          if (!this._onBump) this._onBump = true;
          this.player.turbulent = true;
          this._turbulenceCarry = 4.0;
        } else if (this._onBump) {
          this._onBump = false;
        }

        if (this._turbulenceCarry > 0) {
          this.player.turbulent = true;
          if (!balanceHeld) this._turbulenceCarry -= dt * 0.5;
          else              this._turbulenceCarry -= dt * 1.8;
          if (this._turbulenceCarry <= 0) {
            this._turbulenceCarry = 0;
            this.player.turbulent = false;
            this._hideBalanceUI();
          }
        }

        if (this.player.turbulent) {
          if (!balanceHeld) {
            this._balanceTime += dt;
            if (this._balanceTime >= 0.5 && !this._balanceWarned) {
              this._startBalanceCountdown();
            }
          } else {
            this._balanceTime = Math.max(0, this._balanceTime - dt * 2);
            if (this._balanceTime < 0.2 && this._balanceWarned) this._hideBalanceUI();
          }
        } else {
          this._balanceTime = 0;
        }

        this.player.update(dt);
        this.camera.update();
        this.traffic.update(dt);

        // Collision shake
        if (this._shakeTime > 0) {
          this._shakeTime -= dt;
          var shakeAmount = this._shakeIntensity * (this._shakeTime / 1.5);
          this.camera.x += (Math.random() - 0.5) * shakeAmount * 2;
        }

        // Continuous turbulence shake while on bumps
        if (this.player.turbulent) {
          this._turbShakePhase += dt * 22;
          var turbStrength = balanceHeld ? 6 : 18;
          var turbX = Math.sin(this._turbShakePhase) * turbStrength
                    + Math.sin(this._turbShakePhase * 2.3) * turbStrength * 0.4;
          var turbY = Math.cos(this._turbShakePhase * 1.7) * turbStrength * 0.6;
          this.camera.x += turbX;
          this.camera.y += turbY;
        }

        this.circuit.render3D();

        if (this._isOffTrack()) {
          var maxOT = this.player.maxSpeed * 0.30;
          if (this.player.speed > maxOT) this.player.speed = maxOT;
          this.offTrackTime += dt;
          if (!this.offTrackWarned) this._startOffTrackCountdown();
        } else {
          if (this.offTrackWarned) this._hideOffTrackUI();
          this.offTrackTime = 0;
        }

        var levelResult = this.levelManager.update();
        if (levelResult === 'complete') {
          this.timerRunning = false;
          this._gameState   = STATE_COMPLETE;
          saveRecord(Math.round(this.elapsedSec * 10) / 10, this.levelManager.totalLevels, 'Completed');
          this._requestAccuracyAndShow(() => this._showWinScreen(Math.round(this.elapsedSec * 10) / 10));
        } else if (levelResult === 'next') {
          this._hideAllModals();
          this._modalLevelClear.classList.add('show');
          this.time.delayedCall(2200, () => {
            this._modalLevelClear.classList.remove('show');
            this._startCountdown();
          });
        }

        var kph = Math.round(Math.abs(this.player.speed) * 0.06);
        var speedSuffix = '';
        if (this._isOffTrack())         speedSuffix = '  ⚠ OFF-TRACK';
        else if (this.player.turbulent) speedSuffix = '  💨 BUMP';
        this.speedText.setText('Speed: ' + kph + ' km/h' + speedSuffix);
        this.diffText.setText('Traffic Lvl: ' + this.traffic.difficultyLevel
                              + '  |  Cars: ' + this.traffic.vehicles.length);

        this.currentGesture = activeGesture;
        this._updateGestureIndicator(activeGesture);

        this.wsStatusText.setText(this.wsConnected ? 'Input: 🐍 Python script' : 'Input: ⌨  Keyboard only');
        this.wsStatusText.setStyle({ fill: this.wsConnected ? '#3a9d40' : '#d4642a' });

        var mins = Math.floor(this.elapsedSec / 60).toString().padStart(2, '0');
        var secs = (this.elapsedSec % 60).toFixed(1).padStart(4, '0');
        this.timerText.setText(mins + ':' + secs);

        var warn = this.traffic.getCollisionWarning();
        this.speedText.setStyle({
          fill: warn > 0.6 ? '#c83a3a' :
                warn > 0.3 ? '#d4642a' :
                (this._isOffTrack() ? '#c83a3a' :
                (this.player.turbulent ? '#d4a52a' : '#2a3340'))
        });
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

  _requestAccuracyAndShow(showFn) {
    if (sharedSocket && sharedSocket.readyState === WebSocket.OPEN) {
      sharedSocket.send(JSON.stringify({ type: 'request_accuracy' }));
      this.time.delayedCall(700, () => showFn());
    } else {
      showFn();
    }
  }

  _showWinScreen(finalTimeSec) {
    const username = sessionStorage.getItem('username') || 'DRIVER';
    const acc = sharedAccuracy;

    const overlay  = document.createElement('div');
    overlay.id = 'win-overlay';
    overlay.innerHTML = `
      <style>
        #win-overlay { position: fixed; inset: 0; z-index: 10000;
          background: linear-gradient(180deg, #c8e0f5 0%, #faf0d8 100%);
          display: flex; flex-direction: column; align-items: center; justify-content: flex-start;
          padding: 40px 20px; overflow-y: auto; font-family: 'Bebas Neue',sans-serif; }
        .win-title { font-size: 72px; color: #d4642a; letter-spacing: 3px; }
        .win-time  { font-size: 40px; color: #1a3d6e; margin-top: 8px; }
        .win-row   { display: flex; gap: 24px; margin-top: 16px; align-items: stretch; justify-content: center; }
        .win-card  { background: #fff; border: 2px solid #d8d2c0; border-radius: 8px;
                     padding: 24px 32px; min-width: 280px; }
        .win-card h3 { font-family: 'Bebas Neue',sans-serif; font-size: 28px; color: #d4642a;
                       letter-spacing: 2px; margin-bottom: 12px; }
        .stat-row { display: flex; justify-content: space-between; font-family: monospace;
                    font-size: 16px; color: #2a3340; padding: 6px 0; border-bottom: 1px solid #f0eadd; }
        .stat-row:last-child { border-bottom: none; }
        .stat-row .v { font-weight: bold; color: #d4642a; }
        .win-btn-row { display: flex; gap: 16px; margin-top: 32px; }
        .win-btn { font-family: 'Bebas Neue',sans-serif; font-size: 26px; letter-spacing: 2px;
          padding: 16px 48px; border: none; border-radius: 4px; cursor: pointer; }
        .win-btn-primary   { background: #d4642a; color: #fff; }
        .win-btn-primary:hover { background: #b85220; }
        .win-btn-secondary { background: #fff; color: #2a3340; border: 1.5px solid #d8d2c0; }
      </style>
      <div style="text-align:center;margin-bottom:24px;margin-top:40px">
        <div style="font-size:84px">🏆</div>
        <div class="win-title">ALL LEVELS COMPLETE</div>
        <div class="win-time">Final time: <span style="color:#d4642a">${formatTime(finalTimeSec)}</span></div>
        <div style="font-size:24px;color:#5a6678;margin-top:14px">Congratulations, ${username}!</div>
      </div>
      ${this._buildAccuracyHtml(acc)}
      <div class="win-btn-row">
        <button class="win-btn win-btn-primary"   id="winBtnPlay">PLAY AGAIN</button>
        <button class="win-btn win-btn-secondary" id="winBtnQuit">QUIT</button>
      </div>`;
    document.body.appendChild(overlay);
    document.getElementById('winBtnPlay').addEventListener('click', () => {
      overlay.remove(); this._doFullRestart();
    });
    document.getElementById('winBtnQuit').addEventListener('click', () => {
      overlay.remove(); this._doQuit();
    });
  }

  _buildAccuracyHtml(acc) {
    if (!acc) {
      return `<div style="margin-top:8px;font-family:monospace;color:#5a6678;font-size:18px">
        (No gesture data — Python script was not connected)
      </div>`;
    }
    const dist = acc.gesture_distribution || {};
    const distRows = Object.keys(dist).sort((a,b) => dist[b] - dist[a])
      .map(g => `<div class="stat-row"><span>${g}</span><span class="v">${dist[g]} frames</span></div>`).join('');
    return `
      <div class="win-row">
        <div class="win-card">
          <h3>🎯 GESTURE ACCURACY</h3>
          <div class="stat-row"><span>Accuracy</span><span class="v">${(acc.accuracy ?? 0).toFixed(1)}%</span></div>
          <div class="stat-row"><span>Total attempts</span><span class="v">${acc.total_gestures || 0}</span></div>
          <div class="stat-row"><span>Stable holds</span><span class="v">${acc.correct_detections || 0}</span></div>
          <div class="stat-row"><span>Flickering</span><span class="v">${acc.incorrect_detections || 0}</span></div>
          <div class="stat-row"><span>Detected frames</span><span class="v">${acc.detected_frames || 0} / ${acc.total_frames || 0}</span></div>
        </div>
        <div class="win-card">
          <h3>📊 GESTURE BREAKDOWN</h3>
          ${distRows || '<div class="stat-row"><span>No gestures detected</span></div>'}
        </div>
      </div>`;
  }

  _showGameOver() {
    this._requestAccuracyAndShow(() => {
      const username = sessionStorage.getItem('username') || 'DRIVER';
      const acc = sharedAccuracy;
      this._hideAllModals();
      const overlay = document.createElement('div');
      overlay.id = 'gameover-overlay';
      overlay.innerHTML = `
        <style>
          #gameover-overlay { position: fixed; inset: 0; z-index: 10000;
            background: linear-gradient(180deg, #c8e0f5 0%, #faf0d8 100%);
            display: flex; flex-direction: column; align-items: center; justify-content: flex-start;
            padding: 40px 20px; overflow-y: auto; font-family: 'Bebas Neue',sans-serif; }
          .go-title { font-size: 72px; color: #c83a3a; letter-spacing: 3px; }
          .go-sub   { font-size: 24px; color: #5a6678; margin-top: 8px; font-family: monospace; }
          .go-row   { display: flex; gap: 24px; margin-top: 16px; align-items: stretch; justify-content: center; }
          .go-card  { background: #fff; border: 2px solid #d8d2c0; border-radius: 8px;
                      padding: 24px 32px; min-width: 280px; }
          .go-card h3 { font-family: 'Bebas Neue',sans-serif; font-size: 28px; color: #d4642a;
                        letter-spacing: 2px; margin-bottom: 12px; }
          .stat-row { display: flex; justify-content: space-between; font-family: monospace;
                      font-size: 16px; color: #2a3340; padding: 6px 0; border-bottom: 1px solid #f0eadd; }
          .stat-row:last-child { border-bottom: none; }
          .stat-row .v { font-weight: bold; color: #d4642a; }
          .go-btn-row { display: flex; gap: 16px; margin-top: 32px; }
          .go-btn { font-family: 'Bebas Neue',sans-serif; font-size: 26px; letter-spacing: 2px;
            padding: 16px 48px; border: none; border-radius: 4px; cursor: pointer; }
          .go-btn-primary   { background: #d4642a; color: #fff; }
          .go-btn-primary:hover { background: #b85220; }
          .go-btn-secondary { background: #fff; color: #2a3340; border: 1.5px solid #d8d2c0; }
        </style>
        <div style="text-align:center;margin-top:40px">
          <div style="font-size:84px">💀</div>
          <div class="go-title">GAME OVER</div>
          <div class="go-sub">${username}, your run has ended.</div>
        </div>
        ${this._buildAccuracyHtml(acc)}
        <div class="go-btn-row">
          <button class="go-btn go-btn-primary"   id="goBtnRestart">RESTART</button>
          <button class="go-btn go-btn-secondary" id="goBtnQuit">QUIT</button>
        </div>`;
      document.body.appendChild(overlay);
      this._gameOverOverlay = overlay;
      document.getElementById('goBtnRestart').addEventListener('click', () => {
        overlay.remove(); this._doFullRestart();
      });
      document.getElementById('goBtnQuit').addEventListener('click', () => {
        overlay.remove(); this._doQuit();
      });
    });
  }

  _doFullRestart() {
    _savedRecordThisRun = false;
    sharedAccuracy = null;
    this._hideAllModals();
    if (this._gameOverOverlay) { this._gameOverOverlay.remove(); this._gameOverOverlay = null; }
    this.elapsedSec = 0; this.offTrackTime = 0;
    this._hideOffTrackUI(); this._hideBalanceUI();
    this.levelManager.reset();
    if (sharedSocket && sharedSocket.readyState === WebSocket.OPEN) {
      sharedSocket.send(JSON.stringify({ type: 'game_reset' }));
    }
    this._startCountdown();
  }

  async _doQuit() {
    this._hideAllModals();
    await saveRecord(Math.round(this.elapsedSec * 10) / 10,
                     this.levelManager.currentLevel, 'Game Unfinished');
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('username');
    window.location.href = 'index.html';
  }

  _injectModalCSS() {
    if (document.getElementById('modal-css')) return;
    const s = document.createElement('style');
    s.id = 'modal-css';
    s.textContent = `
      .modal-overlay { position:fixed;inset:0;background:rgba(40,50,60,0.5);display:none;
        align-items:center;justify-content:center;z-index:9999;
        font-family:'Bebas Neue',sans-serif;backdrop-filter:blur(8px); }
      .modal-overlay.show { display:flex; }
      .modal-box { background:#ffffff;border:2px solid #d4642a;border-radius:8px;
        padding:48px 64px;text-align:center;min-width:520px;animation:modalPop .22s ease;
        box-shadow:0 12px 40px rgba(100,120,150,0.25); }
      @keyframes modalPop { from{transform:scale(.88);opacity:0} to{transform:scale(1);opacity:1} }
      .modal-title { font-size:54px;color:#d4642a;letter-spacing:2px;margin-bottom:12px; }
      .modal-sub { font-family:monospace;font-size:16px;color:#5a6678;margin-bottom:36px; }
      .modal-btn { font-family:'Bebas Neue',sans-serif;font-size:24px;letter-spacing:2px;
        padding:14px 44px;border:none;border-radius:4px;cursor:pointer;margin:0 10px; }
      .btn-primary   { background:#d4642a;color:#fff; }
      .btn-primary:hover { background:#b85220; }
      .btn-secondary { background:#fff;color:#2a3340;border:1.5px solid #d8d2c0; }
      .btn-secondary:hover { background:#f5f0e6; }
      .btn-danger    { background:#c83a3a;color:#fff; }
      .modal-redemption .modal-box { border-color:#d4a52a; }
      .modal-redemption .modal-title { color:#d4a52a; }
    `;
    document.head.appendChild(s);
  }

  _createModals(username) {
    this._modalLevelClear = this._makeModal('LEVEL CLEAR!', 'Get ready for the next stage…', []);
    this._modalRedemption = this._makeModal('⚠ ONE MORE CHANCE',
      'Your one retry — restarting this level', []);
    this._modalRedemption.classList.add('modal-redemption');
    document.body.append(this._modalLevelClear, this._modalRedemption);
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
    [this._modalLevelClear, this._modalRedemption, this._modalPause].forEach(m => m && m.classList.remove('show'));
  }
}

var config = {
  type:   Phaser.AUTO,
  width:  SCREEN_W,
  height: SCREEN_H,
  scale:  { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene:  [StartScene, MainScene]
};

var game = new Phaser.Game(config);