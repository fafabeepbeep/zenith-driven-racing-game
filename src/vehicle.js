class Vehicle
{
    /**
     * Represents one AI traffic vehicle on the road.
     * 
     * @param {number} segmentIndex - which road segment it starts on
     * @param {number} laneOffset   - lateral position: -0.6 (left), 0.0 (centre), 0.6 (right)
     * @param {number} speed        - segments per second (positive = forward)
     * @param {string} spriteKey    - Phaser texture key for this vehicle's sprite
     * @param {number} tint         - hex colour tint so cars look different
     */
    constructor(segmentIndex, laneOffset, speed, spriteKey, tint)
    {
        this.segmentIndex = segmentIndex;
        this.laneOffset   = laneOffset;
        this.speed        = speed;
        this.spriteKey    = spriteKey;
        this.tint         = tint;

        this.screen    = { x: 0, y: 0, w: 0, h: 0, scale: 0 };
        this.visible   = false;
        this.colliding = false;

        // The live Phaser Image object assigned from the pool
        this.sprite = null;
    }

    update(dt, totalSegments)
    {
        this.segmentIndex += this.speed * dt;

        if (this.segmentIndex >= totalSegments)
            this.segmentIndex -= totalSegments;

        if (this.segmentIndex < 0)
            this.segmentIndex += totalSegments;
    }
}