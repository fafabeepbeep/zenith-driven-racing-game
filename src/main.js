// frontend/js/main.js
// ─────────────────────────────────────────────────────────────
//  ZENITH DRIVEN — Main game script
//  Scenes: StartScene → MainScene (with countdown) → PauseScene
//
//  Changes vs original:
//    • Title: "ZENITH DRIVEN"
//    • New StartScene: WELCOME screen, flickering START GAME,
//      gesture hint, waits for START gesture or SPACE
//    • Countdown 3 → 2 → 1 → GO! before gameplay starts
//    • Fixed gesture mapping: BRAKE (was 'STOP'), REVERSE now mapped
//    • BALANCE gesture: maintain speed, no steer input
//    • Gesture reconnect: StartScene opens WS, passes it to MainScene
// ─────────────────────────────────────────────────────────────

const SCREEN_W  = 1920;
const SCREEN_H  = 1080;
const SCREEN_CX = SCREEN_W / 2;
const SCREEN_CY = SCREEN_H / 2;

// Game states (used inside MainScene)
const STATE_COUNTDOWN = 0;
const STATE_PLAY      = 3;
const STATE_GAMEOVER  = 4;
const STATE_COMPLETE  = 5;

const PLAYER = 0;

// Shared WebSocket reference (StartScene creates it, MainScene reuses it)
var sharedSocket   = null;
var sharedGesture  = 'NONE';
var sharedWsConnected = false;

// ── API helper ────────────────────────────────────────────────
const API_BASE = 'http://localhost:3000/api';

async function saveRecord(timeSec, levelsCompleted, status) {
  const token = sessionStorage.getItem('token');
  if (!token) return;
  try {
    await fetch(`${API_BASE}/leaderboard/save`, {
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
  } catch (e) {
    console.warn('Could not save record:', e);
  }
}

// ══════════════════════════════════════════════════════════════
//  StartScene  — Welcome / start-game screen
// ══════════════════════════════════════════════════════════════
class StartScene extends Phaser.Scene {
  constructor() { super({ key: 'SceneStart' }); }

  create() {
    const username = sessionStorage.getItem('username') || 'DRIVER';

    // ── Dark gradient background ───────────────────────────
    var bg = this.add.graphics();
    bg.fillGradientStyle(0x0a0a1f, 0x0a0a1f, 0x12001a, 0x12001a, 1);
    bg.fillRect(0, 0, SCREEN_W, SCREEN_H);

    // ── Animated road lines ───────────────────────────────
    this._roadLines = this.add.graphics();
    this._roadTimer = 0;
    this._drawRoadLines(0);

    // ── Logo: ZENITH DRIVEN ───────────────────────────────
    this.add.text(SCREEN_CX, 160,
      'ZENITH\nDRIVEN',
      {
        fontFamily: "'Bebas Neue', 'Arial Black', sans-serif",
        fontSize:   '140px',
        fill:       '#e8ff00',
        align:      'center',
        lineSpacing: -20,
        stroke:     '#000',
        strokeThickness: 4,
        shadow: { offsetX: 0, offsetY: 0, color: '#e8ff00', blur: 50, fill: true }
      }
    ).setOrigin(0.5);

    // ── Tagline ───────────────────────────────────────────
    this.add.text(SCREEN_CX, 370,
      'HAND-GESTURE RACING',
      {
        fontFamily: 'monospace',
        fontSize:   '28px',
        fill:       '#55556a',
        letterSpacing: 8
      }
    ).setOrigin(0.5);

    // ── WELCOME {username} ────────────────────────────────
    this.add.text(SCREEN_CX, 470,
      'WELCOME, ' + username.toUpperCase(),
      {
        fontFamily: "'Bebas Neue', 'Arial Black', sans-serif",
        fontSize:   '56px',
        fill:       '#ffffff',
        letterSpacing: 4
      }
    ).setOrigin(0.5);

    // ── START GAME (flickering) ───────────────────────────
    this._startText = this.add.text(SCREEN_CX, 590,
      'START GAME',
      {
        fontFamily: "'Press Start 2P', monospace",
        fontSize:   '54px',
        fill:       '#e8ff00',
        stroke:     '#000',
        strokeThickness: 3
      }
    ).setOrigin(0.5);

    // Flicker animation: toggle visibility on a fast timer
    this._flickerOn = true;
    this.time.addEvent({
      delay:    520,
      loop:     true,
      callback: () => {
        this._flickerOn = !this._flickerOn;
        this._startText.setAlpha(this._flickerOn ? 1 : 0.15);
      }
    });

    // ── Hint text ─────────────────────────────────────────
    this.add.text(SCREEN_CX, 690,
      'Point your index finger toward the camera to start',
      {
        fontFamily: 'monospace',
        fontSize:   '26px',
        fill:       '#aaaaaa'
      }
    ).setOrigin(0.5);

    // ── Gesture legend ────────────────────────────────────
    var legends = [
      ['✋ BRAKE',   'Open palm toward camera'],
      ['👆 START',   'Index finger → camera'],
      ['🤜 REVERSE', 'Closed fist'],
      ['👐 FORWARD', 'Palm facing down'],
      ['⬅ LEFT',    'Back of hand, fingers left'],
      ['➡ RIGHT',   'Palm toward camera, fingers right'],
    ];
    var legX = SCREEN_CX - 340;
    var legY = 800;
    legends.forEach(function(pair, i) {
      var col = i % 2 === 0 ? legX : legX + 380;
      var row = legY + Math.floor(i / 2) * 50;
      this.add.text(col, row, pair[0],
        { fontFamily: 'monospace', fontSize: '20px', fill: '#e8ff00' });
      this.add.text(col + 145, row, pair[1],
        { fontFamily: 'monospace', fontSize: '20px', fill: '#777' });
    }, this);

    // ── Keyboard fallback hint ─────────────────────────────
    this.add.text(SCREEN_CX, 1020,
      'KEYBOARD FALLBACK: SPACE = Start  ·  Arrows = Drive  ·  SPACE = Brake',
      { fontFamily: 'monospace', fontSize: '18px', fill: '#333355' }
    ).setOrigin(0.5);

    // ── WS status ─────────────────────────────────────────
    this._wsStatusText = this.add.text(20, SCREEN_H - 40,
      'WS: Connecting…',
      { fontFamily: 'monospace', fontSize: '18px', fill: '#ffff00',
        backgroundColor: '#00000088', padding: { x: 6, y: 3 } }
    );

    // ── Connect WebSocket ─────────────────────────────────
    this._connectWS();

    // ── Keyboard: SPACE to start ──────────────────────────
    this.input.keyboard.once('keydown-SPACE', () => this._startGame());

    this._started = false;
  }

  _drawRoadLines(offset) {
    this._roadLines.clear();
    // Perspective road lines
    var vanX = SCREEN_CX;
    var vanY = 400;
    var nLines = 12;
    for (var i = 0; i < nLines; i++) {
      var t = i / nLines;
      var y = vanY + (SCREEN_H - vanY) * t;
      var w = 20 + 500 * t;
      // Lane lines
      for (var l = -1; l <= 1; l++) {
        var lx = vanX + l * w * 0.33;
        var alpha = 0.03 + 0.07 * t;
        this._roadLines.lineStyle(2, 0xe8ff00, alpha);
        this._roadLines.lineBetween(vanX + l * 5, vanY, lx, y);
      }
    }
    // Animated dashes
    var dashOffset = (offset % 80) / 80;
    for (var d = 0; d < 8; d++) {
      var dt2 = (d / 8 + dashOffset) % 1;
      var dy = vanY + (SCREEN_H - vanY) * dt2;
      var dw = 500 * dt2;
      this._roadLines.fillStyle(0xe8ff00, 0.25 * dt2);
      this._roadLines.fillRect(vanX - 5, dy, 10, 18 * dt2);
    }
  }

  _connectWS() {
    try {
      sharedSocket = new WebSocket('ws://localhost:8765');

      sharedSocket.onopen = () => {
        sharedWsConnected = true;
        this._wsStatusText && this._wsStatusText.setText('WS: Connected ✓')
          .setStyle({ fill: '#00ff00' });
      };

      sharedSocket.onmessage = (event) => {
        try {
          var data = JSON.parse(event.data);
          if (typeof data.gesture === 'string') {
            sharedGesture = data.gesture;
            if (data.gesture === 'START' && !this._started)
              this._startGame();
          }
        } catch {}
      };

      sharedSocket.onerror = () => {
        sharedWsConnected = false;
        this._wsStatusText && this._wsStatusText.setText('WS: Error — Is server.js running?')
          .setStyle({ fill: '#ff4444' });
      };

      sharedSocket.onclose = () => {
        sharedWsConnected = false;
        this._wsStatusText && this._wsStatusText.setText('WS: Offline (keyboard only)')
          .setStyle({ fill: '#ff8800' });
      };
    } catch (e) {
      console.warn('WebSocket init failed:', e);
    }
  }

  update(_time, delta) {
    this._roadTimer = (this._roadTimer || 0) + delta;
    this._drawRoadLines(this._roadTimer * 0.05);
  }

  _startGame() {
    if (this._started) return;
    this._started = true;

    // Flash effect
    var flash = this.add.rectangle(SCREEN_CX, SCREEN_CY, SCREEN_W, SCREEN_H, 0xe8ff00, 0);
    this.tweens.add({
      targets: flash, alpha: 0.5,
      duration: 120, yoyo: true,
      onComplete: () => {
        this.scene.start('SceneMain');
      }
    });
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

    // Re-use the WS from StartScene (already connected)
    this.currentGesture = sharedGesture;
    this.wsConnected    = sharedWsConnected;

    if (sharedSocket) {
      sharedSocket.onmessage = (event) => {
        try {
          var data = JSON.parse(event.data);
          if (typeof data.gesture === 'string') {
            this.currentGesture = data.gesture;
            sharedGesture       = data.gesture;
          }
        } catch {}
      };
      sharedSocket.onopen = () => {
        this.wsConnected = true;
        sharedWsConnected = true;
        this.wsStatusText && this.wsStatusText.setText('WS: Connected ✓')
          .setStyle({ fill: '#00ff00' });
      };
      sharedSocket.onerror = () => {
        this.wsConnected = false;
        this.wsStatusText && this.wsStatusText.setText('WS: Error')
          .setStyle({ fill: '#ff0000' });
      };
      sharedSocket.onclose = () => {
        this.wsConnected = false;
        this.wsStatusText && this.wsStatusText.setText('WS: Offline (keyboard)')
          .setStyle({ fill: '#ff4444' });
      };
    } else {
      // Start fresh connection if StartScene somehow didn't create one
      this.wsConnected = false;
      this._connectWS();
    }

    // ── Background + sprites ───────────────────────────────
    this.sprBack = this.add.image(SCREEN_CX, SCREEN_CY, 'imageBack');
    this.sprites = [this.add.image(0, 0, 'imagePlayer').setVisible(false)];

    // ── Core systems ───────────────────────────────────────
    this.circuit      = new Circuit(this);
    this.camera       = new Camera(this);
    this.player       = new Player(this);
    this.traffic      = new Traffic(this);
    this.settings     = new Settings(this);
    this.levelManager = new LevelManager(this);

    // ── Timer state ────────────────────────────────────────
    this.elapsedSec   = 0;
    this.timerRunning = false;

    // ── Off-track state ────────────────────────────────────
    this.offTrackTime      = 0;
    this.offTrackWarned    = false;
    this.offTrackCountdown = 5;
    this.offTrackTimer     = null;

    // ── HUD ───────────────────────────────────────────────
    var hudStyle = (size, color) => ({
      fontSize: size,
      fill:     color || '#ffffff',
      backgroundColor: '#00000088',
      padding: { x: 8, y: 4 }
    });

    this.gestureText  = this.add.text(20, 20,  'Gesture: NONE',   hudStyle('28px'));
    this.wsStatusText = this.add.text(20, 65,  sharedWsConnected ? 'WS: Connected ✓' : 'WS: Connecting…',
                                                hudStyle('22px', sharedWsConnected ? '#00ff00' : '#ffff00'));
    this.speedText    = this.add.text(20, SCREEN_H - 60, 'Speed: 0',        hudStyle('28px'));
    this.diffText     = this.add.text(20, SCREEN_H - 110,'Traffic Level: 1', hudStyle('24px', '#aaffaa'));
    this.timerText    = this.add.text(SCREEN_CX, 20, '00:00.0',
      { fontSize: '36px', fill: '#e8ff00', fontFamily: 'monospace',
        backgroundColor: '#00000088', padding: { x: 12, y: 6 } })
      .setOrigin(0.5, 0);

    this.levelText = this.add.text(SCREEN_CX, 72, '',
      hudStyle('22px', '#aaffaa')).setOrigin(0.5, 0);
    this.levelManager.levelText = this.levelText;

    this.offTrackText = this.add.text(SCREEN_CX, SCREEN_CY - 180, '',
      { fontSize: '64px', fill: '#ff8800', fontFamily: 'monospace',
        stroke: '#000', strokeThickness: 6 })
      .setOrigin(0.5).setDepth(90).setVisible(false);

    // ── Countdown overlay ─────────────────────────────────
    this.countdownText = this.add.text(SCREEN_CX, SCREEN_CY - 80, '',
      { fontSize: '220px', fill: '#e8ff00', fontFamily: 'monospace',
        stroke: '#000', strokeThickness: 12 })
      .setOrigin(0.5).setDepth(200).setVisible(false);

    this.countdownLabel = this.add.text(SCREEN_CX, SCREEN_CY + 160, '',
      { fontFamily: "'Bebas Neue', sans-serif", fontSize: '52px',
        fill: '#ffffff', stroke: '#000', strokeThickness: 4 })
      .setOrigin(0.5).setDepth(200).setVisible(false);

    // ── Collision overlay ─────────────────────────────────
    this.collisionOverlay = this.add.rectangle(
      SCREEN_CX, SCREEN_CY, SCREEN_W, SCREEN_H, 0xff0000, 0).setDepth(100);
    this.collisionText = this.add.text(SCREEN_CX, SCREEN_CY - 60, '⚠ COLLISION!',
      { fontSize: '72px', fill: '#ff0000', stroke: '#000', strokeThickness: 6 })
      .setOrigin(0.5).setDepth(101).setVisible(false);

    // ── Username HUD (top right) ───────────────────────────
    this.add.text(SCREEN_W - 20, 20,
      '👤 ' + username,
      { fontSize: '22px', fill: '#ffffff', backgroundColor: '#00000088',
        padding: { x: 10, y: 5 } }).setOrigin(1, 0);

    // ── DOM Modals ────────────────────────────────────────
    this._createModals(username);

    // ── Keyboard ─────────────────────────────────────────
    this.input.keyboard.on('keydown-P', () => {
      this.settings.txtPause.text = '[P] Resume';
      this.scene.pause();
      this.scene.launch('ScenePause');
    });
    this.events.on('resume', () => this.settings.show());

    this.keyLeft  = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT);
    this.keyRight = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT);
    this.keyUp    = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.UP);
    this.keyDown  = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN);
    this.keySpace = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    // ── Init camera/player THEN start countdown ───────────
    this.camera.init();
    this.player.init();
    this.levelManager.reset();

    this._gameState = STATE_COUNTDOWN;
    this._startCountdown();
  }

  // ─────────────────────────────────────────────────────────
  //  Countdown 3 → 2 → 1 → GO!
  // ─────────────────────────────────────────────────────────
  _startCountdown() {
    var steps = ['3', '2', '1', 'GO!'];
    var colors = ['#ff3c3c', '#ff8800', '#ffff00', '#00ff88'];
    var idx = 0;

    // Freeze player during countdown
    this.player.speed = 0;

    var showNext = () => {
      if (idx >= steps.length) {
        // Countdown done — start playing
        this.countdownText.setVisible(false);
        this.countdownLabel.setVisible(false);
        this._gameState = STATE_PLAY;
        this.timerRunning = true;
        this.player.restart();
        return;
      }

      var label = steps[idx];
      var color = colors[idx];
      idx++;

      this.countdownText
        .setText(label)
        .setStyle({ fill: color })
        .setVisible(true)
        .setScale(1.4);

      // Zoom-in animation
      this.tweens.add({
        targets:  this.countdownText,
        scaleX:   1.0, scaleY: 1.0,
        duration: 400, ease: 'Power2'
      });

      var delay = label === 'GO!' ? 700 : 900;
      this.time.delayedCall(delay, showNext);
    };

    // Small "GET READY" label
    this.countdownLabel.setText('GET READY').setVisible(true);

    this.time.delayedCall(300, showNext);
  }

  // ─────────────────────────────────────────────────────────
  //  WS connection (fallback if StartScene didn't create one)
  // ─────────────────────────────────────────────────────────
  _connectWS() {
    try {
      sharedSocket = new WebSocket('ws://localhost:8765');
      sharedSocket.onopen = () => {
        this.wsConnected = true;
        sharedWsConnected = true;
        this.wsStatusText && this.wsStatusText.setText('WS: Connected ✓')
          .setStyle({ fill: '#00ff00' });
        sharedSocket.onmessage = (event) => {
          try {
            var data = JSON.parse(event.data);
            if (typeof data.gesture === 'string')
              this.currentGesture = sharedGesture = data.gesture;
          } catch {}
        };
      };
      sharedSocket.onerror  = () => { this.wsConnected = false; };
      sharedSocket.onclose  = () => { this.wsConnected = false; };
    } catch {}
  }

  // ─────────────────────────────────────────────────────────
  //  DOM Modal builder
  // ─────────────────────────────────────────────────────────
  _createModals(username) {
    if (!document.getElementById('modal-css')) {
      const style = document.createElement('style');
      style.id = 'modal-css';
      style.textContent = `
        .modal-overlay {
          position: fixed; inset: 0;
          background: rgba(0,0,0,0.78);
          display: none; align-items: center; justify-content: center;
          z-index: 9999;
          font-family: 'Bebas Neue', 'Arial Black', sans-serif;
        }
        .modal-overlay.show { display: flex; }
        .modal-box {
          background: #111118; border: 2px solid #e8ff00; border-radius: 6px;
          padding: 48px 64px; text-align: center; min-width: 500px;
          animation: modalPop 0.22s ease;
        }
        @keyframes modalPop {
          from { transform: scale(0.88); opacity: 0; }
          to   { transform: scale(1);    opacity: 1; }
        }
        .modal-title { font-size: 52px; color: #e8ff00; letter-spacing: 2px; margin-bottom: 12px; }
        .modal-sub   { font-family: monospace; font-size: 16px; color: #aaa; margin-bottom: 36px; }
        .modal-btn   {
          font-family: 'Bebas Neue', sans-serif; font-size: 24px;
          letter-spacing: 2px; padding: 14px 40px; border: none; border-radius: 4px;
          cursor: pointer; margin: 0 10px; transition: opacity .15s;
        }
        .modal-btn:hover { opacity: 0.8; }
        .btn-primary   { background: #e8ff00; color: #000; }
        .btn-secondary { background: #1e1e2e; color: #fff; border: 1px solid #444; }
        .btn-danger    { background: #ff3c3c; color: #fff; }
      `;
      document.head.appendChild(style);
    }

    this._modalGameOver = this._makeModal('GAME OVER',
      username + ', do you want to restart?',
      [
        { label: 'RESTART', cls: 'btn-primary',   cb: () => this._doRestart() },
        { label: 'QUIT',    cls: 'btn-secondary',  cb: () => this._showQuitConfirm() },
      ]);

    this._modalLevelClear = this._makeModal('LEVEL CLEAR!',
      'Get ready for the next stage…', []);

    this._modalAllClear = this._makeModal('YOU WIN!',
      'All 6 levels complete. Legendary.',
      [
        { label: 'PLAY AGAIN', cls: 'btn-primary',   cb: () => this._doFullRestart() },
        { label: 'QUIT',       cls: 'btn-secondary',  cb: () => this._doQuit() },
      ]);

    this._modalQuitConfirm = this._makeModal('LOG OUT?',
      'Your progress will be saved as "Game Unfinished".',
      [
        { label: 'YES, QUIT', cls: 'btn-danger',    cb: () => this._doQuit() },
        { label: 'NO, BACK',  cls: 'btn-secondary', cb: () => this._showGameOver() },
      ]);

    document.body.append(
      this._modalGameOver, this._modalLevelClear,
      this._modalAllClear, this._modalQuitConfirm
    );
  }

  _makeModal(title, sub, buttons) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const box = document.createElement('div');
    box.className = 'modal-box';
    box.innerHTML = `<div class="modal-title">${title}</div><div class="modal-sub">${sub}</div>`;
    buttons.forEach(b => {
      const btn = document.createElement('button');
      btn.className   = 'modal-btn ' + b.cls;
      btn.textContent = b.label;
      btn.addEventListener('click', b.cb);
      box.appendChild(btn);
    });
    overlay.appendChild(box);
    return overlay;
  }

  _hideAllModals() {
    [this._modalGameOver, this._modalLevelClear,
     this._modalAllClear, this._modalQuitConfirm]
      .forEach(m => m && m.classList.remove('show'));
  }

  _showGameOver() {
    this._hideAllModals();
    this._modalGameOver.classList.add('show');
  }

  _showQuitConfirm() {
    this._hideAllModals();
    this._modalQuitConfirm.classList.add('show');
  }

  _doRestart() {
    this._hideAllModals();
    this.elapsedSec = 0;
    this.offTrackTime = 0;
    this.offTrackWarned = false;
    this._hideOffTrackUI();
    this.levelManager._applyConfig();
    this._gameState = STATE_COUNTDOWN;
    this._startCountdown();
  }

  _doFullRestart() {
    this._hideAllModals();
    this.elapsedSec = 0;
    this.offTrackTime = 0;
    this.offTrackWarned = false;
    this._hideOffTrackUI();
    this.levelManager.reset();
    this._gameState = STATE_COUNTDOWN;
    this._startCountdown();
  }

  async _doQuit() {
    this._hideAllModals();
    await saveRecord(
      Math.round(this.elapsedSec * 10) / 10,
      this.levelManager.currentLevel,
      'Game Unfinished'
    );
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('username');
    window.location.href = 'index.html';
  }

  // ─────────────────────────────────────────────────────────
  //  Collision flash
  // ─────────────────────────────────────────────────────────
  flashCollision() {
    this.collisionOverlay.setAlpha(0.45);
    this.tweens.add({
      targets: this.collisionOverlay, alpha: 0,
      duration: 600, ease: 'Power2'
    });
    this.collisionText.setVisible(true);
    this.time.delayedCall(900, () => this.collisionText.setVisible(false));
  }

  // ─────────────────────────────────────────────────────────
  //  Off-track helpers
  // ─────────────────────────────────────────────────────────
  _isOffTrack() {
    return Math.abs(this.player.x) > 1.05;
  }

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

    this.offTrackText.setText('⚠ RETURN TO ROAD!').setVisible(true);

    this.offTrackTimer = this.time.addEvent({
      delay:    1000,
      repeat:   4,
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
    this._gameState = STATE_GAMEOVER;
    this._showGameOver();
    saveRecord(
      Math.round(this.elapsedSec * 10) / 10,
      this.levelManager.currentLevel,
      'Game Unfinished'
    );
  }

  // ─────────────────────────────────────────────────────────
  //  Main update loop
  // ─────────────────────────────────────────────────────────
  update(_time, delta) {
    switch (this._gameState) {

      case STATE_COUNTDOWN:
        // Keep road rendering active but freeze player
        this.camera.update();
        this.circuit.render3D();
        break;

      case STATE_PLAY: {
        var dt = Math.min(1, delta / 1000);

        if (this.timerRunning) this.elapsedSec += dt;

        // ── Gesture → control mapping ─────────────────────
        var inCooldown = this.traffic.collisionCooldown > 0;

        if (this.wsConnected) {
          var g = this.currentGesture;
          this.player.moveLeft   = !inCooldown && g === 'LEFT';
          this.player.moveRight  = !inCooldown && g === 'RIGHT';
          this.player.accelerate = !inCooldown && g === 'FORWARD';
          this.player.brake      = g === 'BRAKE';
          this.player.reverse    = !inCooldown && g === 'REVERSE';
          // BALANCE: no steering, no accel, no brake — natural deceleration
          if (g === 'BALANCE') {
            this.player.moveLeft   = false;
            this.player.moveRight  = false;
            this.player.accelerate = false;
            this.player.brake      = false;
            this.player.reverse    = false;
          }
        } else {
          // Keyboard fallback
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

        // ── Off-track ─────────────────────────────────────
        if (this._isOffTrack()) {
          this.player.speed *= 0.4;
          this.offTrackTime += dt;
          if (this.offTrackTime >= 2 && !this.offTrackWarned)
            this._startOffTrackCountdown();
        } else {
          if (this.offTrackWarned) this._hideOffTrackUI();
          this.offTrackTime = 0;
        }

        // ── Level progression ─────────────────────────────
        var levelResult = this.levelManager.update();

        if (levelResult === 'complete') {
          this.timerRunning = false;
          this._gameState   = STATE_COMPLETE;
          saveRecord(
            Math.round(this.elapsedSec * 10) / 10,
            this.levelManager.totalLevels,
            'Completed'
          );
          this._hideAllModals();
          this._modalAllClear.classList.add('show');

        } else if (levelResult === 'next') {
          this._hideAllModals();
          this._modalLevelClear.classList.add('show');
          this.time.delayedCall(2200, () => {
            this._modalLevelClear.classList.remove('show');
            // Brief countdown for new level
            this._gameState = STATE_COUNTDOWN;
            this._startCountdown();
          });
        }

        // ── HUD ──────────────────────────────────────────
        var kph = Math.round(Math.abs(this.player.speed) * 0.06);
        this.speedText.setText('Speed: ' + kph + ' km/h');
        this.diffText.setText(
          'Traffic Lvl: ' + this.traffic.difficultyLevel +
          '  |  Cars: '   + this.traffic.vehicles.length
        );
        this.gestureText.setText('Gesture: ' + this.currentGesture);

        var mins = Math.floor(this.elapsedSec / 60).toString().padStart(2, '0');
        var secs = (this.elapsedSec % 60).toFixed(1).padStart(4, '0');
        this.timerText.setText(mins + ':' + secs);

        var warn = this.traffic.getCollisionWarning();
        if      (warn > 0.6) this.speedText.setStyle({ fill: '#ff4444' });
        else if (warn > 0.3) this.speedText.setStyle({ fill: '#ffaa00' });
        else                 this.speedText.setStyle({ fill: '#ffffff' });

        break;
      }

      case STATE_GAMEOVER:
      case STATE_COMPLETE:
        break;
    }
  }
}

// ══════════════════════════════════════════════════════════════
//  Pause Scene
// ══════════════════════════════════════════════════════════════
class PauseScene extends Phaser.Scene {
  constructor() { super({ key: 'ScenePause' }); }
  create() {
    this.input.keyboard.on('keydown-P', () => {
      this.scene.resume('SceneMain');
      this.scene.stop();
    });
  }
}

// ══════════════════════════════════════════════════════════════
//  Phaser Config — StartScene first, then Main
// ══════════════════════════════════════════════════════════════
var config = {
  type:   Phaser.AUTO,
  width:  SCREEN_W,
  height: SCREEN_H,
  scale: {
    mode:       Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  scene: [StartScene, MainScene, PauseScene]
};

var game = new Phaser.Game(config);