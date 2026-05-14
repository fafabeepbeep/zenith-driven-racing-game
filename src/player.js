// src/player.js
// ═══════════════════════════════════════════════════════════════════════════
//  ZENITH DRIVEN — Player (Smoothed Arcade Physics)
//
//  WHAT CHANGED IN THIS REVISION
//  ─────────────────────────────────────────────────────────────────────────
//  [UPDATED] Lateral movement is now velocity-based, not position-based.
//            steerVelocity ramps toward a target each frame and decays to 0
//            when no steering input is active. Result: smoother turns, NO
//            ghost-drift after gesture changes, no oversteering at speed.
//
//  [UPDATED] maxSpeed reduced to ~70% of previous value. Acceleration uses
//            a slower ramp-up curve. Game feels controllable, not chaotic.
//
//  [UPDATED] Brake decel softened slightly. Friction stronger so coasting
//            naturally slows the car — keyboards and slow gestures both
//            benefit from this.
//
//  [ADDED]   _targetSpeed system. Inputs set a target; actual speed lerps
//            toward it. Removes the "either full throttle or full brake"
//            twitchiness that made the game feel jerky.
//
//  [ADDED]   turbulence state. While turbulent (set externally by circuit
//            bump detection in main.js), steering randomly wobbles unless
//            BALANCE gesture is held. See main.js for the trigger system.
//
//  [PRESERVED] x clamp at ±2 (road edges at ±1; ±2 is the hard wall).
//              Off-track penalty is unchanged.
// ═══════════════════════════════════════════════════════════════════════════

class Player
{
    constructor(scene)
    {
        this.scene  = scene;
        this.sprite = scene.sprites[PLAYER];

        this.x = 0;
        this.y = 0;
        this.z = 0;
        this.w = (this.sprite.width / 1000) * 2;

        this.screen = { x: 0, y: 0, w: 0, h: 0 };

        // ── [UPDATED] Top speed reduced from segmentLength*60 → *42 ──
        // Old: maxSpeed = (segmentLength) / (1/60) = 6000 units/s
        // New: ~4200 units/s — visibly slower, gives ~1.5s reaction time
        //      to dodge cars 60 segments ahead instead of <1s.
        this.speed     = 0;
        this.maxSpeed  = (scene.circuit.segmentLength) / (1/60) * 0.70;
        this._targetSpeed = 0;          // [ADDED] target the actual speed lerps to

        // Input flags (set externally each frame from gesture/keyboard)
        this.moveLeft   = false;
        this.moveRight  = false;
        this.accelerate = false;
        this.brake      = false;
        this.reverse    = false;

        // [ADDED] Turbulence — set by main.js when player hits a road bump.
        // While true, steering wobbles unless BALANCE gesture is held.
        this.turbulent     = false;
        this.balanceActive = false;
        this._turbulencePhase = 0;

        // ── [UPDATED] Steering tuning — smoother, more forgiving ──
        // Old: instantaneous position deltas → felt twitchy
        // New: velocity target lerp → feels like real wheel turning
        this.maxSteerVelocity = 0.85;   // how fast we can move sideways at low speed
        this.steerAccel       = 4.0;    // how quickly velocity ramps to target
        this.steerDecay       = 6.0;    // how quickly velocity decays to 0 (faster than accel
                                        // → "release the gesture, car straightens fast")
        this.minSteerFactor   = 0.30;   // ratio at top speed (oversteer protection)

        this.steerVelocity = 0;         // [ADDED] current lateral velocity

        // Slight pull toward outside of curves — feels arcadey
        this.centrifugal = 0.08;

        // ── [UPDATED] Acceleration tuned for smoother throttle ──
        // Old: throttle was nearly instant → could max out in 1s
        // New: ~2.5s to reach top speed, ~1s to brake to 0
        this.accelRate   = this.maxSpeed * 0.40;
        this.brakeRate   = this.maxSpeed * 1.10;
        this.reverseRate = this.maxSpeed * 0.35;
        this.friction    = this.maxSpeed * 0.45;
        this.maxReverseSpeed = -this.maxSpeed / 2;

        // Internal flag — collision freeze (set by main.js)
        this.controlLocked = false;
    }

    init()
    {
        this.screen.w = this.sprite.width;
        this.screen.h = this.sprite.height;
        this.screen.x = SCREEN_CX;
        this.screen.y = SCREEN_H - this.screen.h / 2;
    }

    restart()
    {
        this.x = 0;
        this.y = 0;
        this.z = 0;
        // [UPDATED] Start at a comfortable cruise speed, not max — gives the
        //           player a moment to orient themselves at race start.
        this.speed         = this.maxSpeed * 0.50;
        this._targetSpeed  = this.maxSpeed * 0.50;
        this.steerVelocity = 0;
        this.turbulent     = false;
        this.controlLocked = false;
    }

    update(dt)
    {
        var circuit = this.scene.circuit;

        // ── [ADDED] Control lock during collision — freeze inputs but keep
        //           applying friction so we don't slide forever.
        if (this.controlLocked) {
            this._applyFriction(dt);
            this._integratePosition(dt);
            return;
        }

        // ─────────────────────────────────────────────────────────────
        //  THROTTLE / BRAKE / REVERSE — target-based smoothing
        // ─────────────────────────────────────────────────────────────
        if (this.accelerate) {
            this._targetSpeed = this.maxSpeed;
        } else if (this.brake) {
            this._targetSpeed = 0;
        } else if (this.reverse) {
            this._targetSpeed = this.maxReverseSpeed;
        } else {
            // No input → coast toward 0 (friction)
            this._targetSpeed = 0;
        }

        // Lerp current speed toward target using appropriate rate
        var rate;
        if (this.brake && this.speed > 0) {
            rate = this.brakeRate;
        } else if (this._targetSpeed > this.speed) {
            rate = this.accelRate;
        } else {
            rate = this.friction;
        }

        var diff = this._targetSpeed - this.speed;
        var step = Math.sign(diff) * Math.min(Math.abs(diff), rate * dt);
        this.speed += step;

        // Clamp
        if (this.speed > this.maxSpeed)       this.speed = this.maxSpeed;
        if (this.speed < this.maxReverseSpeed) this.speed = this.maxReverseSpeed;

        // ─────────────────────────────────────────────────────────────
        //  POSITION (Z) — forward integration
        // ─────────────────────────────────────────────────────────────
        this._integratePosition(dt);

        // ─────────────────────────────────────────────────────────────
        //  STEERING — velocity-based, gesture-synced
        //  [FIXED] No more position deltas: we maintain a steerVelocity
        //          that ramps toward a target each frame. When gesture
        //          stops, target = 0 and velocity decays fast → car
        //          immediately stops drifting sideways. This was the
        //          "abrupt + delayed" feel the user complained about.
        // ─────────────────────────────────────────────────────────────
        var speedPercent = Math.abs(this.speed) / this.maxSpeed;
        var steerFactor  = 1.0 - (1.0 - this.minSteerFactor) * speedPercent;

        // Compute target lateral velocity from current input
        var targetSteer = 0;
        if (this.moveLeft  && !this.moveRight) targetSteer = -this.maxSteerVelocity * steerFactor;
        if (this.moveRight && !this.moveLeft)  targetSteer =  this.maxSteerVelocity * steerFactor;

        // [ADDED] Turbulence wobble — adds random sideways force unless balanced
        if (this.turbulent && !this.balanceActive) {
            this._turbulencePhase += dt * 14;
            var wobble = Math.sin(this._turbulencePhase) * 0.6
                       + Math.sin(this._turbulencePhase * 2.7) * 0.3;
            targetSteer += wobble;
        }

        // Lerp steer velocity toward target
        var steerDiff = targetSteer - this.steerVelocity;
        var steerRate = (Math.abs(targetSteer) > 0.01) ? this.steerAccel : this.steerDecay;
        var steerStep = Math.sign(steerDiff) * Math.min(Math.abs(steerDiff), steerRate * dt);
        this.steerVelocity += steerStep;

        // Apply lateral motion
        this.x += this.steerVelocity * dt;

        // Centrifugal drift on curves
        var seg = circuit.getSegment(this.z);
        if (seg && seg.curve) {
            this.x += seg.curve * 0.0008 * speedPercent;
        }

        // [PRESERVED] Hard road boundaries: road = ±1, walls = ±2
        if (this.x < -2) { this.x = -2; this.steerVelocity = 0; }
        if (this.x >  2) { this.x =  2; this.steerVelocity = 0; }
    }

    // [ADDED] Used during control lock — friction only, no input.
    _applyFriction(dt)
    {
        if (Math.abs(this.speed) < 1) { this.speed = 0; return; }
        var drag = this.friction * 1.5 * dt;
        if (this.speed > 0) this.speed = Math.max(0, this.speed - drag);
        else                 this.speed = Math.min(0, this.speed + drag);
    }

    _integratePosition(dt)
    {
        var circuit = this.scene.circuit;
        this.z += this.speed * dt;
        if (this.z >= circuit.roadLength) this.z -= circuit.roadLength;
        if (this.z < 0)                   this.z += circuit.roadLength;
    }
}