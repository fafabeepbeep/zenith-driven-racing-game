// src/player.js
// FIX: expanded clamp from [-1, 1] to [-2, 2] so the player can drive
// onto the grass (off-track area). The off-track mechanic in main.js
// detects |player.x| > 1.0 and applies penalties. Without this change
// the player was hard-clamped to the road edge and could never trigger
// the off-track system.

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

        this.speed    = 0;
        this.maxSpeed = (scene.circuit.segmentLength) / (1 / 60);

        this.moveLeft  = false;
        this.moveRight = false;
        this.accelerate = false;
        this.brake      = false;
        this.reverse    = false;

        this.steerSpeed = 2;
        this.steerMin   = 0.3;
        this.steerMax   = 1.0;

        this.centrifugal = 0.1;

        this.accelRate   = this.maxSpeed * 0.5;
        this.brakeRate   = this.maxSpeed * 1.5;
        this.reverseRate = this.maxSpeed * 0.5;
        this.friction    = this.maxSpeed * 0.3;
        this.maxReverseSpeed = -this.maxSpeed / 2;
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
        this.x     = 0;
        this.y     = 0;
        this.z     = 0;
        this.speed = this.maxSpeed;
    }

    update(dt)
    {
        var circuit = this.scene.circuit;

        // ── Forward / backward movement ────────────────────────
        if (this.accelerate)
            this.speed += this.accelRate * dt;

        if (this.brake && this.speed > 0)
        {
            this.speed -= this.brakeRate * dt;
            if (this.speed < 0) this.speed = 0;
        }

        if (this.reverse && this.speed <= 0)
            this.speed -= this.reverseRate * dt;

        // Friction when no input
        if (!this.accelerate && !this.brake && !this.reverse)
        {
            if (this.speed > 0)
            {
                this.speed -= this.friction * dt;
                if (this.speed < 0) this.speed = 0;
            }
            else if (this.speed < 0)
            {
                this.speed += this.friction * dt;
                if (this.speed > 0) this.speed = 0;
            }
        }

        if (this.speed > this.maxSpeed)      this.speed = this.maxSpeed;
        if (this.speed < this.maxReverseSpeed) this.speed = this.maxReverseSpeed;

        this.z += this.speed * dt;
        if (this.z >= circuit.roadLength) this.z -= circuit.roadLength;
        if (this.z < 0)                   this.z += circuit.roadLength;

        // ── Steering ───────────────────────────────────────────
        var speedPercent = Math.abs(this.speed) / this.maxSpeed;

        // Centrifugal drift from road curve
        this.x += speedPercent * this.centrifugal * dt;

        var steerFactor = this.steerMax - (this.steerMax - this.steerMin) * speedPercent;

        if (this.moveLeft)  this.x -= this.steerSpeed * steerFactor * dt;
        if (this.moveRight) this.x += this.steerSpeed * steerFactor * dt;

        // FIX: expanded clamp from ±1 to ±2 to allow grass / off-track area.
        // The road edge is at |x| = 1.0. The hard boundary (invisible wall)
        // is at |x| = 2.0 so the player can't escape too far into the grass.
        if (this.x < -2) this.x = -2;
        if (this.x >  2) this.x =  2;
    }
}