// src/levelManager.js
// 
//   Level 1 — Open Road      (was level 2)
//   Level 2 — Speed Demon    (was level 4)
//   Level 3 — Apex Challenge (was level 6)

const LEVEL_CONFIGS = [
  // ── Level 1: Open Road ──────────────────────────────────────
  {
    label:             'Level 1 — Open Road',
    trafficMax:         6,
    trafficMinSpeed:    20,
    trafficMaxSpeed:    40,
    trafficSpacing:     30,
    difficultyInterval: 22,
    visibleSegments:    200,
    road: [
      { type: 'straight', count: 200 },
      { type: 'curve',    count: 200, value:  4 },
      { type: 'straight', count: 150 },
      { type: 'curve',    count: 200, value: -4 },
      { type: 'straight', count: 100 },
    ],
  },

  // ── Level 2: Speed Demon ─────────────────────────────────────
  {
    label:             'Level 2 — Speed Demon',
    trafficMax:        12,
    trafficMinSpeed:    32,
    trafficMaxSpeed:    63,
    trafficSpacing:     20,
    difficultyInterval: 15,
    visibleSegments:    220,
    road: [
      { type: 'straight', count: 100 },
      { type: 'curve',    count: 200, value:  6 },
      { type: 'straight', count: 100 },
      { type: 'curve',    count: 150, value: -7 },
      { type: 'curve',    count: 150, value:  7 },
      { type: 'straight', count: 150 },
      { type: 'curve',    count: 100, value: -6 },
      { type: 'straight', count: 100 },
    ],
  },

  // ── Level 3: Apex Challenge ───────────────────────────────────
  {
    label:             'Level 3 — Apex Challenge',
    trafficMax:        20,
    trafficMinSpeed:    44,
    trafficMaxSpeed:    90,
    trafficSpacing:     10,
    difficultyInterval:  9,
    visibleSegments:    240,
    road: [
      { type: 'straight', count:  60 },
      { type: 'curve',    count: 200, value:  10 },
      { type: 'curve',    count: 200, value: -10 },
      { type: 'straight', count: 100 },
      { type: 'curve',    count: 150, value:   8 },
      { type: 'straight', count:  80 },
      { type: 'curve',    count: 150, value:  -8 },
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
    this.totalLevels  = LEVEL_CONFIGS.length;   // 3
    this.lapsLeft     = LAPS_PER_LEVEL;
    this.lastPlayerZ  = 0;
    this.levelText    = null;
  }

  reset() {
    this.currentLevel = 0;
    this.lapsLeft     = LAPS_PER_LEVEL;
    this.lastPlayerZ  = 0;
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
    traffic.minSpacingSegments = cfg.trafficSpacing || 25;
    traffic.difficultyInterval = cfg.difficultyInterval || 20;
    traffic.difficultyLevel    = 1;
    traffic.difficultyTimer    = 0;

    traffic._baseCfg = {
      max:      cfg.trafficMax,
      minSpeed: cfg.trafficMinSpeed,
      maxSpeed: cfg.trafficMaxSpeed,
      spacing:  cfg.trafficSpacing || 25,
    };

    traffic.init();
    this._updateHUD();
  }

  _updateHUD() {
    var cfg = this.getConfig();
    if (this.levelText) {
      var lapNum = LAPS_PER_LEVEL - this.lapsLeft + 1;
      this.levelText.setText(
        cfg.label + '  [Lap ' + lapNum + '/' + LAPS_PER_LEVEL + ']'
      );
    }
  }

  getConfig() {
    return LEVEL_CONFIGS[this.currentLevel];
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
          return 'complete';      // all 3 levels done
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