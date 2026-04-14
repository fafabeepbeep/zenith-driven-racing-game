// frontend/js/traffic.js
// ─────────────────────────────────────────────────────────────
// BUG FIX SUMMARY:
//   1. Segment matching was exact (vSegIdx === seg.index).
//      Vehicles whose segmentIndex is fractional (due to dt accumulation)
//      could shift ±1 segment vs. the visible list on certain frames.
//      Fix: build a Map of segment-index → screen-point from the visible list,
//           then look up with a ±2 tolerance so no vehicle is ever skipped.
//
//   2. RenderTexture.draw() needs the source image to have correct dimensions
//      BEFORE the draw call. setDisplaySize is applied AFTER creation but
//      the RT snapshots current state. Fix: setDisplaySize + setPosition first.
//
//   3. Added fallback: if ALL traffic textures are missing, draw coloured
//      rectangles directly on the graphics layer so vehicles are always visible.
//
//   4. Depth ordering: circuit.texture (RenderTexture) is created AFTER
//      circuit.graphics in the constructor, so it naturally sits on top.
//      No change needed, but this is documented here for clarity.
// ─────────────────────────────────────────────────────────────

class Traffic
{
    constructor(scene)
    {
        this.scene = scene;

        this.lanes               = [-0.6, 0.0, 0.6];
        this.vehicles            = [];
        this.maxVehicles         = 8;
        this.minSpacingSegments  = 30;
        this.minSpeed            = 20;
        this.maxSpeed            = 45;

        this.difficultyTimer    = 0;
        this.difficultyLevel    = 1;
        this.difficultyInterval = 20;
        this.maxDifficulty      = 5;

        this.collisionCooldown     = 0;
        this.collisionCooldownTime = 1.5;
        this.isColliding           = false;

        this.spriteKeys = ['imageTraffic1', 'imageTraffic2', 'imageTraffic3'];
        this.tints      = [0xff4444, 0x4488ff, 0xffcc00, 0x44cc44, 0xff8800, 0xcc44ff];

        this._drawSprites = null;
        this._poolSize    = 32;

        // Whether ANY traffic texture loaded OK — used for fallback
        this._hasTextures = false;
    }

    // ── INIT ─────────────────────────────────────────────────────────────
    init()
    {
        this.vehicles          = [];
        this.difficultyTimer   = 0;
        this.difficultyLevel   = 1;
        this.collisionCooldown = 0;
        this.isColliding       = false;

        this._checkTextures();
        this._buildDrawSprites();

        for (var i = 0; i < this.maxVehicles; i++)
            this.spawnVehicle();
    }

    _checkTextures()
    {
        this._hasTextures = this.spriteKeys.some(k => this.scene.textures.exists(k));
        if (!this._hasTextures)
            console.warn('[Traffic] No traffic textures found — using coloured rectangles.');
    }

    _buildDrawSprites()
    {
        // Destroy old pool
        if (this._drawSprites)
        {
            this._drawSprites.forEach(s => { try { s.destroy(); } catch {} });
        }
        this._drawSprites = [];

        // Choose best available key as initial texture
        var initKey = this.spriteKeys.find(k => this.scene.textures.exists(k))
                      || (this.scene.textures.exists('imagePlayer') ? 'imagePlayer' : null);

        if (!initKey) { return; }  // no textures at all — fallback to rects

        for (var i = 0; i < this._poolSize; i++)
        {
            var img = this.scene.make.image({ x: 0, y: 0, key: initKey, add: false });
            this._drawSprites.push(img);
        }
    }

    // ── SPAWN ─────────────────────────────────────────────────────────────
    spawnVehicle()
    {
        var circuit = this.scene.circuit;
        var player  = this.scene.player;

        var lane     = this.lanes[Math.floor(Math.random() * this.lanes.length)];
        var attempts = 0;
        var segIndex;

        do
        {
            var aheadOffset = 50 + Math.floor(Math.random() * 350);
            var playerSeg   = Math.floor(player.z / circuit.segmentLength);
            segIndex        = (playerSeg + aheadOffset) % circuit.total_segments;
            attempts++;
        }
        while (attempts < 20 && this.isTooClose(segIndex, lane));

        if (attempts >= 20) return;

        var speed     = this.minSpeed + Math.random() * (this.maxSpeed - this.minSpeed);
        var tint      = this.tints[Math.floor(Math.random() * this.tints.length)];
        var spriteKey = this._randomSpriteKey();

        this.vehicles.push(new Vehicle(segIndex, lane, speed, spriteKey, tint));
    }

    _randomSpriteKey()
    {
        var available = this.spriteKeys.filter(k => this.scene.textures.exists(k));
        if (available.length === 0) return 'imagePlayer';
        return available[Math.floor(Math.random() * available.length)];
    }

    isTooClose(segIndex, lane)
    {
        var circuit = this.scene.circuit;
        for (var i = 0; i < this.vehicles.length; i++)
        {
            var v   = this.vehicles[i];
            var gap = Math.abs(v.segmentIndex - segIndex);
            if (gap > circuit.total_segments / 2)
                gap = circuit.total_segments - gap;
            if (gap < this.minSpacingSegments && Math.abs(v.laneOffset - lane) < 0.3)
                return true;
        }
        return false;
    }

    // ── UPDATE ────────────────────────────────────────────────────────────
    update(dt)
    {
        var circuit = this.scene.circuit;

        this.difficultyTimer += dt;
        if (this.difficultyTimer >= this.difficultyInterval &&
            this.difficultyLevel < this.maxDifficulty)
        {
            this.difficultyTimer = 0;
            this.difficultyLevel++;
            this.applyDifficulty();
        }

        for (var i = 0; i < this.vehicles.length; i++)
            this.vehicles[i].update(dt, circuit.total_segments);

        this.checkCollisions();

        if (this.collisionCooldown > 0)
        {
            this.collisionCooldown -= dt;
            if (this.collisionCooldown <= 0)
            {
                this.collisionCooldown = 0;
                this.isColliding       = false;
            }
        }
    }

    // ── RENDER ────────────────────────────────────────────────────────────
    render(visibleSegmentsList, circuit, camera)
    {
        var texture = circuit.texture;
        var drawIdx = 0;

        // ── Build a fast segment-index → screen lookup ────────
        // This replaces the old O(segments × vehicles) double loop.
        // A vehicle is matched to the NEAREST visible segment within ±2.
        var segMap = new Map();
        for (var n = 0; n < visibleSegmentsList.length; n++)
        {
            var seg = visibleSegmentsList[n];
            segMap.set(seg.index, seg);
        }

        var toRender = [];

        for (var i = 0; i < this.vehicles.length; i++)
        {
            var v       = this.vehicles[i];
            var vSegIdx = Math.floor(v.segmentIndex) % circuit.total_segments;

            // Try exact match first, then ±1, ±2
            var matchSeg = null;
            for (var off = 0; off <= 2 && !matchSeg; off++)
            {
                var tryA = (vSegIdx + off) % circuit.total_segments;
                var tryB = (vSegIdx - off + circuit.total_segments) % circuit.total_segments;
                if (segMap.has(tryA)) matchSeg = segMap.get(tryA);
                else if (off > 0 && segMap.has(tryB)) matchSeg = segMap.get(tryB);
            }

            if (!matchSeg) continue;

            // Project vehicle world position to screen
            var worldX  = v.laneOffset * circuit.roadWidth;
            var worldZ  = vSegIdx * circuit.segmentLength;

            var camSegZ = Math.floor(camera.z / circuit.segmentLength);
            var offsetZ = (vSegIdx < camSegZ) ? circuit.roadLength : 0;
            var transZ  = (worldZ + offsetZ) - camera.z;

            if (transZ <= 0) continue;

            var scale   = camera.distToPlane / transZ;
            var screenX = Math.round((1 + scale * (worldX - camera.x)) * SCREEN_CX);
            var screenY = matchSeg.point.screen.y;
            var spriteH = Math.round(scale * 420);
            var spriteW = Math.round(scale * 320);

            if (spriteH < 4) continue;

            // Cache for collision system
            v.screen.x     = screenX;
            v.screen.y     = screenY;
            v.screen.w     = spriteW;
            v.screen.h     = spriteH;
            v.screen.scale = scale;
            v.visible      = true;

            toRender.push({ v, screenX, screenY, spriteW, spriteH, transZ });
        }

        // Sort far → near (painter's algorithm)
        toRender.sort(function(a, b) { return b.transZ - a.transZ; });

        // ── Draw sprites OR coloured rects (fallback) ─────────
        var noTextures = !this._drawSprites || this._drawSprites.length === 0;

        for (var j = 0; j < toRender.length; j++)
        {
            var item = toRender[j];
            var v    = item.v;

            if (noTextures)
            {
                // Fallback: draw a tinted rectangle directly onto the graphics layer
                var g = circuit.graphics;
                var col = v.colliding ? 0xff0000 : v.tint;
                g.fillStyle(col, 1);
                g.fillRect(
                    item.screenX - item.spriteW / 2,
                    item.screenY - item.spriteH,
                    item.spriteW,
                    item.spriteH
                );
                // Windshield indicator
                g.fillStyle(0x99ccff, 0.7);
                g.fillRect(
                    item.screenX - item.spriteW * 0.3,
                    item.screenY - item.spriteH * 0.85,
                    item.spriteW * 0.6,
                    item.spriteH * 0.25
                );
                continue;
            }

            if (drawIdx >= this._drawSprites.length) break;

            var spr = this._drawSprites[drawIdx++];

            var key = this.scene.textures.exists(v.spriteKey)
                      ? v.spriteKey
                      : (this.scene.textures.exists('imagePlayer') ? 'imagePlayer' : null);

            if (!key) continue;

            spr.setTexture(key);
            spr.setDisplaySize(item.spriteW, item.spriteH);
            spr.setTint(v.colliding ? 0xff0000 : v.tint);

            // Bottom-centre alignment: top-left corner = (cx - w/2, screenY - h)
            var drawX = item.screenX - item.spriteW / 2;
            var drawY = item.screenY - item.spriteH;

            texture.draw(spr, drawX, drawY);
        }
    }

    // ── COLLISION ─────────────────────────────────────────────────────────
    checkCollisions()
    {
        if (this.collisionCooldown > 0) return;

        var player    = this.scene.player;
        var circuit   = this.scene.circuit;
        var playerSeg = Math.floor(player.z / circuit.segmentLength) % circuit.total_segments;

        for (var i = 0; i < this.vehicles.length; i++)
        {
            var v       = this.vehicles[i];
            var vSeg    = Math.floor(v.segmentIndex) % circuit.total_segments;
            var segDist = Math.abs(playerSeg - vSeg);
            if (segDist > circuit.total_segments / 2)
                segDist = circuit.total_segments - segDist;

            if (segDist < 5 && Math.abs(player.x - v.laneOffset) < 0.35)
            {
                this.triggerCollision(player, v);
                return;
            }
        }
    }

    triggerCollision(player, vehicle)
    {
        this.isColliding       = true;
        this.collisionCooldown = this.collisionCooldownTime;
        vehicle.colliding      = true;

        player.speed = player.speed * -0.3;
        if (player.speed > 0) player.speed = 0;

        if (this.scene.flashCollision)
            this.scene.flashCollision();

        var v = vehicle;
        this.scene.time.delayedCall(this.collisionCooldownTime * 1000, () =>
        {
            v.colliding = false;
        });
    }

    // ── DIFFICULTY ────────────────────────────────────────────────────────
    applyDifficulty()
    {
        var extra = this.difficultyLevel - 1;
        this.maxVehicles        = this._baseCfg ? this._baseCfg.max + extra * 2 : 8 + extra * 2;
        this.minSpeed           = 20 + extra * 5;
        this.maxSpeed           = 45 + extra * 8;
        this.minSpacingSegments = Math.max(10, 30 - extra * 3);

        while (this.vehicles.length < this.maxVehicles)
            this.spawnVehicle();
    }

    // ── HELPERS ───────────────────────────────────────────────────────────
    getCollisionWarning()
    {
        if (this.isColliding) return 1;

        var player    = this.scene.player;
        var circuit   = this.scene.circuit;
        var playerSeg = Math.floor(player.z / circuit.segmentLength) % circuit.total_segments;
        var closest   = 999;

        for (var i = 0; i < this.vehicles.length; i++)
        {
            var v       = this.vehicles[i];
            var vSeg    = Math.floor(v.segmentIndex) % circuit.total_segments;
            var segDist = Math.abs(playerSeg - vSeg);
            if (segDist > circuit.total_segments / 2)
                segDist = circuit.total_segments - segDist;

            if (Math.abs(player.x - v.laneOffset) < 0.5 && segDist < closest)
                closest = segDist;
        }

        return (closest < 15) ? 1 - (closest / 15) : 0;
    }
}