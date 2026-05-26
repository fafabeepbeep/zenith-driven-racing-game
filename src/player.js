// src/player.js
// ═══════════════════════════════════════════════════════════════════════════
//  ZENITH DRIVEN — Player (Smoothed Arcade Physics)
//
//  WHAT CHANGED IN THIS REVISION
//  ─────────────────────────────────────────────────────────────────────────
//  [FIXED] Turbulence wobble made much stronger (was barely visible). Now
//          the car shakes meaningfully when on a bump so the player clearly
//          knows they need to use BALANCE gesture to stabilize.
//
//  [FIXED] Added speed penalty when turbulent without balance — caps speed
//          at 50% of max. Makes the mechanic feel impactful.
//
//  [PRESERVED] Velocity-based steering, ±2 clamp, smooth throttle/brake.
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

        this.speed     = 0;
        this.maxSpeed  = (scene.circuit.segmentLength) / (1/60) * 0.70;
        this._targetSpeed = 0;

        this.moveLeft   = false;
        this.moveRight  = false;
        this.accelerate = false;
        this.brake      = false;
        this.reverse    = false;

        this.turbulent     = false;
        this.balanceActive = false;
        this._turbulencePhase = 0;

        this.maxSteerVelocity = 0.85;
        this.steerAccel       = 4.0;
        this.steerDecay       = 6.0;
        this.minSteerFactor   = 0.30;
        this.steerVelocity = 0;

        this.centrifugal = 0.08;

        this.accelRate   = this.maxSpeed * 0.40;
        this.brakeRate   = this.maxSpeed * 1.10;
        this.reverseRate = this.maxSpeed * 0.35;
        this.friction    = this.maxSpeed * 0.45;
        this.maxReverseSpeed = -this.maxSpeed / 2;

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
        // ── Lateral CENTER of road + race start ──────────────────
        // Called on full restart AND on redemption restart. Player x=0
        // is the middle lane; z=0 is race-start. Steer velocity, speed,
        // and turbulence all cleared so the redo is a clean slate.
        this.x = 0;
        this.y = 0;
        this.z = 0;
        this.speed         = this.maxSpeed * 0.50;
        this._targetSpeed  = this.maxSpeed * 0.50;
        this.steerVelocity = 0;
        this.turbulent     = false;
        this.balanceActive = false;
        this.controlLocked = false;
    }

    update(dt)
    {
        var circuit = this.scene.circuit;

        if (this.controlLocked) {
            this._applyFriction(dt);
            this._integratePosition(dt);
            return;
        }

        if (this.accelerate)      this._targetSpeed = this.maxSpeed;
        else if (this.brake)      this._targetSpeed = 0;
        else if (this.reverse)    this._targetSpeed = this.maxReverseSpeed;
        else                      this._targetSpeed = 0;

        // [FIXED] Speed penalty when turbulent (and not balanced)
        // Caps top speed at 50% so bumps actually slow the player.
        if (this.turbulent && !this.balanceActive) {
            this._targetSpeed = Math.min(this._targetSpeed, this.maxSpeed * 0.50);
        }

        var rate;
        if (this.brake && this.speed > 0)         rate = this.brakeRate;
        else if (this._targetSpeed > this.speed)  rate = this.accelRate;
        else                                       rate = this.friction;

        var diff = this._targetSpeed - this.speed;
        var step = Math.sign(diff) * Math.min(Math.abs(diff), rate * dt);
        this.speed += step;

        if (this.speed > this.maxSpeed)        this.speed = this.maxSpeed;
        if (this.speed < this.maxReverseSpeed) this.speed = this.maxReverseSpeed;

        this._integratePosition(dt);

        var speedPercent = Math.abs(this.speed) / this.maxSpeed;
        var steerFactor  = 1.0 - (1.0 - this.minSteerFactor) * speedPercent;

        var targetSteer = 0;
        if (this.moveLeft  && !this.moveRight) targetSteer = -this.maxSteerVelocity * steerFactor;
        if (this.moveRight && !this.moveLeft)  targetSteer =  this.maxSteerVelocity * steerFactor;

        // [FIXED] Turbulence wobble — significantly stronger.
        //   Old: 0.6 + 0.3                  = 0.9 max  (barely visible)
        //   New: 1.4 + 0.7 + 0.4            = 2.5 max  (clearly tossed)
        if (this.turbulent && !this.balanceActive) {
            this._turbulencePhase += dt * 18;
            var wobble = Math.sin(this._turbulencePhase) * 1.4
                       + Math.sin(this._turbulencePhase * 2.7) * 0.7
                       + Math.sin(this._turbulencePhase * 4.3 + 0.5) * 0.4;
            targetSteer += wobble;
        }

        var steerDiff = targetSteer - this.steerVelocity;
        var steerRate = (Math.abs(targetSteer) > 0.01) ? this.steerAccel : this.steerDecay;
        var steerStep = Math.sign(steerDiff) * Math.min(Math.abs(steerDiff), steerRate * dt);
        this.steerVelocity += steerStep;

        this.x += this.steerVelocity * dt;

        var seg = circuit.getSegment(this.z);
        if (seg && seg.curve) this.x += seg.curve * 0.0008 * speedPercent;

        if (this.x < -2) { this.x = -2; this.steerVelocity = 0; }
        if (this.x >  2) { this.x =  2; this.steerVelocity = 0; }
    }

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