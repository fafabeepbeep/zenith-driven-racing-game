// src/levelManager.js
// ═══════════════════════════════════════════════════════════════════════════
//  ZENITH DRIVEN — Level Manager (Redemption Checkpoint + Bump Placement)
//
//  WHAT CHANGED IN THIS REVISION
//  ─────────────────────────────────────────────────────────────────────────
//  [ADDED]   Per-level redemption state. Each level allows ONE retry. Going
//            off-track or crashing once → redeem (restart current level).
//            A second fail in the same level → game over (back to login).
//
//  [UPDATED] Road specs now include bump sections — each level has 2-3
//            bump zones placed throughout. Difficulty increases with level.
//
//  [UPDATED] Traffic config rebalanced per level (slower, fewer cars,
//            longer difficulty interval).
//
//  [ADDED]   redemptionUsed[] — tracks per-level whether redemption is spent.
//  [ADDED]   useRedemption()  — returns true if a redemption is available
//            and consumes it; returns false if already used (= game over).
//
//  [PRESERVED] All level definitions, lap counting, HUD updates.
// ═══════════════════════════════════════════════════════════════════════════

const LEVEL_CONFIGS = [
  // ── Level 1: Open Road ──────────────────────────────────────
  {
    label:             'Level 1 — Open Road',
    trafficMax:         4,                          // [UPDATED] was 6
    trafficMinSpeed:    12,                         // [UPDATED] was 20
    trafficMaxSpeed:    24,                         // [UPDATED] was 40
    trafficSpacing:     40,                         // [UPDATED] was 30
    difficultyInterval: 28,                         // [UPDATED] was 22
    visibleSegments:    200,
    road: [
      { type: 'straight', count: 180 },
      { type: 'curve',    count: 200, value:  4 },
      { type: 'straight', count: 120 },
      { type: 'bump',     count: 10  },             // [ADDED]
      { type: 'curve',    count: 200, value: -4 },
      { type: 'straight', count: 100 },
    ],
  },

  // ── Level 2: Speed Demon ─────────────────────────────────────
  {
    label:             'Level 2 — Speed Demon',
    trafficMax:         8,                          // [UPDATED] was 12
    trafficMinSpeed:    20,                         // [UPDATED] was 32
    trafficMaxSpeed:    38,                         // [UPDATED] was 63
    trafficSpacing:     32,                         // [UPDATED] was 20
    difficultyInterval: 22,                         // [UPDATED] was 15
    visibleSegments:    220,
    road: [
      { type: 'straight', count: 100 },
      { type: 'curve',    count: 200, value:  6 },
      { type: 'bump',     count: 12  },             // [ADDED]
      { type: 'straight', count: 100 },
      { type: 'curve',    count: 150, value: -7 },
      { type: 'curve',    count: 150, value:  7 },
      { type: 'straight', count: 120 },
      { type: 'bump',     count: 10  },             // [ADDED]
      { type: 'curve',    count: 100, value: -6 },
      { type: 'straight', count: 100 },
    ],
  },

  // ── Level 3: Apex Challenge ───────────────────────────────────
  {
    label:             'Level 3 — Apex Challenge',
    trafficMax:        12,                          // [UPDATED] was 20
    trafficMinSpeed:    28,                         // [UPDATED] was 44
    trafficMaxSpeed:    52,                         // [UPDATED] was 90
    trafficSpacing:     22,                         // [UPDATED] was 10
    difficultyInterval: 16,                         // [UPDATED] was 9
    visibleSegments:    240,
    road: [
      { type: 'straight', count:  60 },
      { type: 'curve',    count: 200, value:  10 },
      { type: 'bump',     count: 14  },             // [ADDED]
      { type: 'curve',    count: 200, value: -10 },
      { type: 'straight', count: 100 },
      { type: 'curve',    count: 150, value:   8 },
      { type: 'bump',     count: 12  },             // [ADDED]
      { type: 'straight', count:  80 },
      { type: 'curve',    count: 150, value:  -8 },
      { type: 'bump',     count: 10  },             // [ADDED]
      { type: 'curve',    count: 100, value:   9 },
      { type: 'straight', count:  60 },
    ],
  },
];

const LAPS_PER_LEVEL = 2;

class LevelManager {
  constructor(scene) {
    this.scene        = scene;
    this.currentLevel = 0;
    this.totalLevels  = LEVEL_CONFIGS.length;
    this.lapsLeft     = LAPS_PER_LEVEL;
    this.lastPlayerZ  = 0;
    this.levelText    = null;

    // [ADDED] Redemption tracking. One redemption per level.
    this.redemptionUsed = new Array(this.totalLevels).fill(false);
  }

  reset() {
    this.currentLevel = 0;
    this.lapsLeft     = LAPS_PER_LEVEL;
    this.lastPlayerZ  = 0;
    this.redemptionUsed = new Array(this.totalLevels).fill(false);  // [ADDED]
    this._applyConfig();
  }

  _applyConfig() {
    var cfg     = this.getConfig();
    var circuit = this.scene.circuit;
    var traffic = this.scene.traffic;

    circuit.visible_segments = cfg.visibleSegments;
    circuit.create(cfg.road);

    this.scene.player.restart();
    this.lastPlayerZ = 0;

    traffic.maxVehicles        = cfg.trafficMax;
    traffic.minSpeed           = cfg.trafficMinSpeed;
    traffic.maxSpeed           = cfg.trafficMaxSpeed;
    traffic.minSpacingSegments = cfg.trafficSpacing || 35;
    traffic.difficultyInterval = cfg.difficultyInterval || 28;
    traffic.difficultyLevel    = 1;
    traffic.difficultyTimer    = 0;

    traffic._baseCfg = {
      max:      cfg.trafficMax,
      minSpeed: cfg.trafficMinSpeed,
      maxSpeed: cfg.trafficMaxSpeed,
      spacing:  cfg.trafficSpacing || 35,
    };

    traffic.init();
    this._updateHUD();
  }

  _updateHUD() {
    var cfg = this.getConfig();
    if (this.levelText) {
      var lapNum = LAPS_PER_LEVEL - this.lapsLeft + 1;
      // [ADDED] Show redemption status in HUD
      var redemptionLabel = this.redemptionUsed[this.currentLevel]
        ? '  ⚠ NO RETRY LEFT'
        : '  ♥ 1 RETRY';
      this.levelText.setText(
        cfg.label + '  [Lap ' + lapNum + '/' + LAPS_PER_LEVEL + ']' + redemptionLabel
      );
    }
  }

  getConfig() {
    return LEVEL_CONFIGS[this.currentLevel];
  }

  // [ADDED] Called by main.js when player fails (off-track / crash):
  //   returns true  → redemption available, current level restarts
  //   returns false → no redemption left, game over
  useRedemption() {
    if (this.redemptionUsed[this.currentLevel]) {
      console.log('[LM] Redemption already used for level', this.currentLevel + 1, '→ game over');
      return false;
    }
    this.redemptionUsed[this.currentLevel] = true;
    console.log('[LM] Redemption consumed for level', this.currentLevel + 1, '→ restarting same level');
    return true;
  }

  // [ADDED] Restart current level only (keeps redemptionUsed state)
  restartCurrentLevel() {
    this.lapsLeft = LAPS_PER_LEVEL;
    this._applyConfig();
  }

  update() {
    var player  = this.scene.player;
    var circuit = this.scene.circuit;

    if (this.lastPlayerZ > circuit.roadLength * 0.8 &&
        player.z < circuit.roadLength * 0.2)
    {
      this.lapsLeft--;

      if (this.lapsLeft <= 0) {
        if (this.currentLevel >= this.totalLevels - 1) {
          return 'complete';
        } else {
          this.currentLevel++;
          this.lapsLeft = LAPS_PER_LEVEL;
          this._applyConfig();
          return 'next';
        }
      } else {
        this._updateHUD();
      }
    }

    this.lastPlayerZ = player.z;
    return null;
  }
}