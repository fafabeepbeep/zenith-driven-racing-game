// src/levelManager.js
// ═══════════════════════════════════════════════════════════════════════════
//  ZENITH DRIVEN — Level Manager
//
//  WHAT CHANGED IN THIS REVISION
//  ─────────────────────────────────────────────────────────────────────────
//  [REMOVED] Level 3 — Apex Challenge has been temporarily removed.
//            The design is preserved in docs/LEVEL3_DESIGN.md for later
//            re-addition. Game now ends after Level 2 — Speed Demon.
//
//  [PRESERVED] Level 1 (Open Road), Level 2 (Speed Demon), redemption
//              mechanic, lap counting, HUD updates, bump zones.
// ═══════════════════════════════════════════════════════════════════════════

const LEVEL_CONFIGS = [
  // ── Level 1: Open Road ─────────────────────────────────────
  {
    label: 'Level 1 — Open Road',
    trafficMax: 4, trafficMinSpeed: 12, trafficMaxSpeed: 24,
    trafficSpacing: 40, difficultyInterval: 28, visibleSegments: 200,
    road: [
      { type: 'straight', count: 180 },
      { type: 'curve',    count: 200, value:  4 },
      { type: 'straight', count: 120 },
      { type: 'bump',     count: 10  },
      { type: 'curve',    count: 200, value: -4 },
      { type: 'straight', count: 100 },
    ],
  },
  // ── Level 2: Speed Demon (NOW THE FINAL LEVEL) ─────────────
  {
    label: 'Level 2 — Speed Demon',
    trafficMax: 8, trafficMinSpeed: 20, trafficMaxSpeed: 38,
    trafficSpacing: 32, difficultyInterval: 22, visibleSegments: 220,
    road: [
      { type: 'straight', count: 100 },
      { type: 'curve',    count: 200, value:  6 },
      { type: 'bump',     count: 12  },
      { type: 'straight', count: 100 },
      { type: 'curve',    count: 150, value: -7 },
      { type: 'curve',    count: 150, value:  7 },
      { type: 'straight', count: 120 },
      { type: 'bump',     count: 10  },
      { type: 'curve',    count: 100, value: -6 },
      { type: 'straight', count: 100 },
    ],
  },
  // ── [REMOVED] Level 3 — Apex Challenge ─────────────────────
  // The Level 3 spec is preserved in docs/LEVEL3_DESIGN.md.
  // To re-enable, copy it back here and increment totalLevels.
];

const LAPS_PER_LEVEL = 2;

class LevelManager {
  constructor(scene) {
    this.scene        = scene;
    this.currentLevel = 0;
    this.totalLevels  = LEVEL_CONFIGS.length;       // automatically reflects level count
    this.lapsLeft     = LAPS_PER_LEVEL;
    this.lastPlayerZ  = 0;
    this.levelText    = null;
    this.redemptionUsed = new Array(this.totalLevels).fill(false);
  }

  reset() {
    this.currentLevel = 0;
    this.lapsLeft     = LAPS_PER_LEVEL;
    this.lastPlayerZ  = 0;
    this.redemptionUsed = new Array(this.totalLevels).fill(false);
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
      var redemptionLabel = this.redemptionUsed[this.currentLevel]
        ? '  ⚠ NO RETRY LEFT'
        : '  ♥ 1 RETRY';
      this.levelText.setText(
        cfg.label + '  [Lap ' + lapNum + '/' + LAPS_PER_LEVEL + ']' + redemptionLabel
      );
    }
  }

  getConfig() { return LEVEL_CONFIGS[this.currentLevel]; }

  useRedemption() {
    if (this.redemptionUsed[this.currentLevel]) return false;
    this.redemptionUsed[this.currentLevel] = true;
    return true;
  }

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