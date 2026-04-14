// frontend/js/levelManager.js
// Difficulty scaling additions:
//   • Each level has stronger minSpacingSegments reduction
//   • traffic.applyDifficulty() reset per-level so dynamic scaling is from a
//     higher base on harder levels
//   • difficultyInterval decreases per level (faster ramp-up)

const LEVEL_CONFIGS = [
  {
    label:              'Level 1 — Learning Curve',
    trafficMax:          4,
    trafficMinSpeed:     15,
    trafficMaxSpeed:     30,
    trafficSpacing:      35,   // min segments between cars
    difficultyInterval:  25,   // seconds between auto-difficulty bumps
    visibleSegments:     200,
    road: [
      { type: 'straight', count: 250 },
      { type: 'curve',    count: 150, value:  3 },
      { type: 'straight', count: 250 },
    ],
  },
  {
    label:              'Level 2 — Open Road',
    trafficMax:          6,
    trafficMinSpeed:     20,
    trafficMaxSpeed:     40,
    trafficSpacing:      30,
    difficultyInterval:  22,
    visibleSegments:     200,
    road: [
      { type: 'straight', count: 200 },
      { type: 'curve',    count: 200, value:  4 },
      { type: 'straight', count: 150 },
      { type: 'curve',    count: 200, value: -4 },
      { type: 'straight', count: 100 },
    ],
  },
  {
    label:              'Level 3 — Serpentine',
    trafficMax:          9,
    trafficMinSpeed:     25,
    trafficMaxSpeed:     52,
    trafficSpacing:      25,
    difficultyInterval:  18,
    visibleSegments:     210,
    road: [
      { type: 'straight', count: 150 },
      { type: 'curve',    count: 200, value:  5 },
      { type: 'curve',    count: 200, value: -5 },
      { type: 'straight', count: 150 },
      { type: 'curve',    count: 150, value:  6 },
      { type: 'straight', count: 100 },
    ],
  },
  {
    label:              'Level 4 — Speed Demon',
    trafficMax:         12,
    trafficMinSpeed:     32,
    trafficMaxSpeed:     63,
    trafficSpacing:      20,
    difficultyInterval:  15,
    visibleSegments:     220,
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
  {
    label:              'Level 5 — Grand Prix',
    trafficMax:         16,
    trafficMinSpeed:     38,
    trafficMaxSpeed:     74,
    trafficSpacing:      15,
    difficultyInterval:  12,
    visibleSegments:     230,
    road: [
      { type: 'straight', count:  80 },
      { type: 'curve',    count: 200, value:  8 },
      { type: 'straight', count: 120 },
      { type: 'curve',    count: 200, value: -8 },
      { type: 'curve',    count: 200, value:  6 },
      { type: 'straight', count: 100 },
      { type: 'curve',    count: 200, value: -6 },
      { type: 'straight', count:  80 },
    ],
  },
  {
    label:              'Level 6 — Apex Challenge',
    trafficMax:         20,
    trafficMinSpeed:     44,
    trafficMaxSpeed:     90,
    trafficSpacing:      10,
    difficultyInterval:   9,
    visibleSegments:     240,
    road: [
      { type: 'straight', count:  60 },
      { type: 'curve',    count: 200, value: 10 },
      { type: 'curve',    count: 200, value: -10 },
      { type: 'straight', count: 100 },
      { type: 'curve',    count: 150, value:  8 },
      { type: 'straight', count:  80 },
      { type: 'curve',    count: 150, value: -8 },
      { type: 'curve',    count: 100, value:  9 },
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

    // Apply level-specific traffic settings
    traffic.maxVehicles         = cfg.trafficMax;
    traffic.minSpeed            = cfg.trafficMinSpeed;
    traffic.maxSpeed            = cfg.trafficMaxSpeed;
    traffic.minSpacingSegments  = cfg.trafficSpacing || 25;
    traffic.difficultyInterval  = cfg.difficultyInterval || 20;
    traffic.difficultyLevel     = 1;
    traffic.difficultyTimer     = 0;

    // Store base config on traffic so applyDifficulty can scale from it
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
      this.levelText.setText(cfg.label + '  [Lap ' + lapNum + '/' + LAPS_PER_LEVEL + ']');
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