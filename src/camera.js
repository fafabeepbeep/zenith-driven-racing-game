// frontend/js/camera.js
// Change vs original: camera.y now tracks road elevation so uphill/downhill
// actually tilts the view perspective correctly.

class Camera
{
    constructor(scene)
    {
        this.scene = scene;

        this.x = 0;
        this.y = 1000;   // base camera height
        this.z = 0;

        this.distToPlayer = 500;
        this.distToPlane  = null;

        // Base height (stays constant; elevation is added on top)
        this.baseY = 1000;
    }

    init()
    {
        this.distToPlane = 1 / (this.baseY / this.distToPlayer);
    }

    update()
    {
        var player  = this.scene.player;
        var circuit = this.scene.circuit;

        // Follow player laterally
        this.x = player.x * circuit.roadWidth;

        // Follow player forward
        this.z = player.z - this.distToPlayer;

        if (this.z < 0)
            this.z += circuit.roadLength;
        if (this.z >= circuit.roadLength)
            this.z -= circuit.roadLength;

        // ── Elevation: lift camera to match current road height ──
        // Smoothly interpolate to avoid sudden jumps at segment boundaries
        var seg      = circuit.getSegment(player.z);
        var targetY  = this.baseY + seg.point.world.y;

        // Smooth follow (lerp factor 0.1 per frame ≈ gentle hill feel)
        this.y += (targetY - this.y) * 0.10;
    }
}