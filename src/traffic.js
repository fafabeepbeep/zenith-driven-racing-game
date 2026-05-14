// src/traffic.js
// ═══════════════════════════════════════════════════════════════════════════
//  ZENITH DRIVEN — Traffic System (Rebalanced for Playability)
//
//  WHAT CHANGED IN THIS REVISION
//  ─────────────────────────────────────────────────────────────────────────
//  [UPDATED] Speeds reduced ~40% across the board. Old traffic was faster
//            than the player after a few difficulty bumps — impossible to
//            overtake, unfair. New traffic always remains overtakable.
//
//  [UPDATED] Spacing increased. Minimum gap raised from 20→35 segments.
//            Visual: clear road between cars, not a wall of vehicles.
//
//  [UPDATED] Difficulty ramps more gently. +1 vehicle every level (was +2),
//            +3 speed (was +5), -2 spacing (was -3). The progression now
//            feels like the game is gradually getting harder, not punishing.
//
//  [UPDATED] Lane discipline. Vehicles stick to their lane offset; no
//            lateral jitter. Looks deliberate, like real traffic.
//
//  [PRESERVED] Curve-following positioning (anchors to segment screen.x).
//  [PRESERVED] Painter's-algorithm depth sort, sub-segment interpolation.
//  [PRESERVED] Fallback coloured rectangles when textures unavailable.
//  [PRESERVED] Collision system + cooldown.
// ═══════════════════════════════════════════════════════════════════════════

const VEHICLE_WORLD_W = 300;
const VEHICLE_WORLD_H = 400;

class Traffic
{
    constructor(scene)
    {
        this.scene = scene;

        this.lanes = [-0.6, 0.0, 0.6];
        this.vehicles = [];

        // ── [UPDATED] Rebalanced defaults (overridden by levelManager) ──
        this.maxVehicles        = 5;     // was 8
        this.minSpacingSegments = 35;    // was 20
        this.minSpeed           = 14;    // was 20
        this.maxSpeed           = 28;    // was 45

        this.difficultyTimer    = 0;
        this.difficultyLevel    = 1;
        this.difficultyInterval = 28;    // was 20 — longer between bumps
        this.maxDifficulty      = 4;     // was 5 — softer ceiling

        this.collisionCooldown     = 0;
        this.collisionCooldownTime = 2.5;   // [UPDATED] was 1.5 — see main.js
        this.isColliding           = false;

        this.spriteKeys = ['imageTraffic1', 'imageTraffic2', 'imageTraffic3'];
        this.tints      = [0xff4444, 0x4488ff, 0xffcc00, 0x44cc44, 0xff8800, 0xcc44ff];

        this._hasTextures = false;
        this._pool        = [];
        this._POOL_SIZE   = 24;          // [UPDATED] less than before — fewer cars
        this._fbGraphics  = null;
        this._baseCfg     = null;
    }

    init()
    {
        this.vehicles          = [];
        this.difficultyTimer   = 0;
        this.difficultyLevel   = 1;
        this.collisionCooldown = 0;
        this.isColliding       = false;

        this._hasTextures = this.spriteKeys.some(k => this.scene.textures.exists(k));
        console.log('[Traffic] init() — textures:', this._hasTextures,
            '| maxVehicles:', this.maxVehicles,
            '| speed:', this.minSpeed, '-', this.maxSpeed);

        this._buildPool();

        for (var i = 0; i < this.maxVehicles; i++)
            this.spawnVehicle();
    }

    _buildPool()
    {
        for (var i = 0; i < this._pool.length; i++)
            try { this._pool[i].destroy(); } catch (e) {}
        this._pool = [];

        if (this._fbGraphics) try { this._fbGraphics.destroy(); } catch (e) {}
        this._fbGraphics = this.scene.add.graphics().setDepth(10);

        var key = this._firstAvailableKey();
        if (!key) {
            this._hasTextures = false;
            return;
        }

        for (var j = 0; j < this._POOL_SIZE; j++) {
            var img = this.scene.add.image(0, 0, key);
            img.setOrigin(0.5, 1.0);
            img.setDepth(5);
            img.setVisible(false);
            this._pool.push(img);
        }
    }

    _firstAvailableKey()
    {
        var k = this.spriteKeys.find(k => this.scene.textures.exists(k));
        if (!k && this.scene.textures.exists('imagePlayer')) k = 'imagePlayer';
        return k || null;
    }

    spawnVehicle()
    {
        var circuit = this.scene.circuit;
        var player  = this.scene.player;

        var lane     = this.lanes[Math.floor(Math.random() * this.lanes.length)];
        var attempts = 0;
        var segIndex;

        do {
            // [UPDATED] Spawn farther ahead (40-180 segments) for more
            //           reaction time, less "appearing out of nowhere".
            var aheadOffset = 40 + Math.floor(Math.random() * 140);
            var playerSeg   = Math.floor(player.z / circuit.segmentLength);
            segIndex        = (playerSeg + aheadOffset) % circuit.total_segments;
            attempts++;
        } while (attempts < 25 && this.isTooClose(segIndex, lane));

        if (attempts >= 25) return;   // give up — too crowded

        var speed     = this.minSpeed + Math.random() * (this.maxSpeed - this.minSpeed);
        var tint      = this.tints[Math.floor(Math.random() * this.tints.length)];
        var spriteKey = this._randomKey();

        this.vehicles.push(new Vehicle(segIndex, lane, speed, spriteKey, tint));
    }

    _randomKey()
    {
        var avail = this.spriteKeys.filter(k => this.scene.textures.exists(k));
        if (!avail.length) return this._firstAvailableKey() || 'imagePlayer';
        return avail[Math.floor(Math.random() * avail.length)];
    }

    isTooClose(segIndex, lane)
    {
        var circuit = this.scene.circuit;
        for (var i = 0; i < this.vehicles.length; i++) {
            var v   = this.vehicles[i];
            var gap = Math.abs(v.segmentIndex - segIndex);
            if (gap > circuit.total_segments / 2) gap = circuit.total_segments - gap;
            // [UPDATED] Same lane = full spacing. Different lane = half spacing.
            //           Creates more natural-looking traffic pattern.
            if (Math.abs(v.laneOffset - lane) < 0.3) {
                if (gap < this.minSpacingSegments) return true;
            } else {
                if (gap < this.minSpacingSegments * 0.4) return true;
            }
        }
        return false;
    }

    update(dt)
    {
        this.difficultyTimer += dt;
        if (this.difficultyTimer >= this.difficultyInterval
            && this.difficultyLevel < this.maxDifficulty) {
            this.difficultyTimer = 0;
            this.difficultyLevel++;
            this.applyDifficulty();
        }

        var circuit = this.scene.circuit;
        for (var i = 0; i < this.vehicles.length; i++)
            this.vehicles[i].update(dt, circuit.total_segments);

        this.checkCollisions();

        if (this.collisionCooldown > 0) {
            this.collisionCooldown -= dt;
            if (this.collisionCooldown <= 0) {
                this.collisionCooldown = 0;
                this.isColliding = false;
            }
        }
    }

    render(visibleSegmentsList, circuit, camera)
    {
        for (var i = 0; i < this._pool.length; i++)
            this._pool[i].setVisible(false);
        if (this._fbGraphics) this._fbGraphics.clear();

        var segMap = new Map();
        for (var n = 0; n < visibleSegmentsList.length; n++) {
            var s = visibleSegmentsList[n];
            segMap.set(s.index, s);
        }

        var toRender = [];

        for (var i = 0; i < this.vehicles.length; i++) {
            var v        = this.vehicles[i];
            var vSegIdx  = Math.floor(v.segmentIndex) % circuit.total_segments;
            var vSegFrac = v.segmentIndex - Math.floor(v.segmentIndex);

            var segA = segMap.get(vSegIdx);
            var segB = segMap.get((vSegIdx + 1) % circuit.total_segments);

            if (!segA) {
                for (var off = 1; off <= 2 && !segA; off++) {
                    var tryA = (vSegIdx + off) % circuit.total_segments;
                    var tryB = (vSegIdx - off + circuit.total_segments) % circuit.total_segments;
                    if      (segMap.has(tryA)) { segA = segMap.get(tryA); segB = null; }
                    else if (segMap.has(tryB)) { segA = segMap.get(tryB); segB = null; }
                }
            }
            if (!segA || !segA.point.screen || segA.point.scale <= 0) continue;

            var pa = segA.point.screen;
            var sa = segA.point.scale;

            var screenX_A = pa.x + v.laneOffset * pa.w;
            var screenY_A = pa.y;
            var spriteW_A = sa * VEHICLE_WORLD_W * SCREEN_CX;
            var spriteH_A = sa * VEHICLE_WORLD_H * SCREEN_CY;

            var screenX, screenY, spriteW, spriteH, segScale;

            if (segB && segB.point.screen && segB.point.scale > 0) {
                var pb        = segB.point.screen;
                var sb        = segB.point.scale;
                var screenX_B = pb.x + v.laneOffset * pb.w;
                var screenY_B = pb.y;
                var spriteW_B = sb * VEHICLE_WORLD_W * SCREEN_CX;
                var spriteH_B = sb * VEHICLE_WORLD_H * SCREEN_CY;

                var t  = vSegFrac;
                var ti = 1 - t;
                screenX  = Math.round(screenX_A * ti + screenX_B * t);
                screenY  = Math.round(screenY_A * ti + screenY_B * t);
                spriteW  = Math.round(spriteW_A * ti + spriteW_B * t);
                spriteH  = Math.round(spriteH_A * ti + spriteH_B * t);
                segScale = sa * ti + sb * t;
            } else {
                screenX  = Math.round(screenX_A);
                screenY  = Math.round(screenY_A);
                spriteW  = Math.round(spriteW_A);
                spriteH  = Math.round(spriteH_A);
                segScale = sa;
            }

            if (spriteH < 4 || spriteW < 2) continue;
            if (screenX < -spriteW || screenX > SCREEN_W + spriteW) continue;

            var transZ = camera.distToPlane / Math.max(segScale, 0.0000001);

            v.screen.x = screenX; v.screen.y = screenY;
            v.screen.w = spriteW; v.screen.h = spriteH;
            v.screen.scale = segScale;
            v.visible = true;

            toRender.push({ v, screenX, screenY, spriteW, spriteH, transZ });
        }

        toRender.sort(function(a, b) { return b.transZ - a.transZ; });

        var maxTransZ = toRender.length > 0 ? toRender[0].transZ : 1000;
        var drawIdx = 0;

        for (var j = 0; j < toRender.length; j++) {
            var item = toRender[j];
            var v = item.v;
            var t = Math.min(1.0, item.transZ / Math.max(maxTransZ, 1));
            var depth = Math.max(1, Math.min(19, Math.round(1 + 18 * (1.0 - t))));

            if (!this._hasTextures) {
                var g  = this._fbGraphics;
                var col = v.colliding ? 0xff2200 : v.tint;
                var sx = item.screenX, sy = item.screenY;
                var sw = item.spriteW,  sh = item.spriteH;
                g.fillStyle(col, 1);
                g.fillRect(sx - sw/2, sy - sh, sw, sh);
                g.fillStyle(0x88ccff, 0.82);
                g.fillRect(sx - sw*0.27, sy - sh*0.88, sw*0.54, sh*0.22);
                g.fillStyle(0x111111, 1);
                var ww = sw*0.18, wh = sh*0.13;
                g.fillRect(sx - sw*0.43, sy - wh, ww, wh);
                g.fillRect(sx + sw*0.25, sy - wh, ww, wh);
                continue;
            }

            if (drawIdx >= this._pool.length) break;
            var spr = this._pool[drawIdx++];
            var key = this.scene.textures.exists(v.spriteKey)
                      ? v.spriteKey
                      : this._firstAvailableKey();
            if (!key) continue;

            spr.setTexture(key);
            spr.setDisplaySize(item.spriteW, item.spriteH);
            spr.setTint(v.colliding ? 0xff2200 : v.tint);
            spr.setPosition(item.screenX, item.screenY);
            spr.setDepth(depth);
            spr.setVisible(true);
        }
    }

    checkCollisions()
    {
        if (this.collisionCooldown > 0) return;

        var player    = this.scene.player;
        var circuit   = this.scene.circuit;
        var playerSeg = Math.floor(player.z / circuit.segmentLength) % circuit.total_segments;

        for (var i = 0; i < this.vehicles.length; i++) {
            var v       = this.vehicles[i];
            var vSeg    = Math.floor(v.segmentIndex) % circuit.total_segments;
            var segDist = Math.abs(playerSeg - vSeg);
            if (segDist > circuit.total_segments / 2)
                segDist = circuit.total_segments - segDist;

            if (segDist < 4 && Math.abs(player.x - v.laneOffset) < 0.32) {
                this.triggerCollision(player, v);
                return;
            }
        }
    }

    triggerCollision(player, vehicle)
    {
        console.log('[Traffic] COLLISION — player.x:', player.x.toFixed(2),
                    'vehicle.lane:', vehicle.laneOffset);

        this.isColliding       = true;
        this.collisionCooldown = this.collisionCooldownTime;
        vehicle.colliding      = true;

        // [UPDATED] Stronger reverse + control lock — see main.js for camera shake
        player.speed         = player.speed * -0.55;
        player.steerVelocity = 0;
        player.controlLocked = true;

        // Reset control lock partway through cooldown so player can recover
        this.scene.time.delayedCall(1400, () => { player.controlLocked = false; });

        if (this.scene.flashCollision) this.scene.flashCollision();

        var v = vehicle;
        this.scene.time.delayedCall(
            this.collisionCooldownTime * 1000,
            () => { v.colliding = false; }
        );
    }

    applyDifficulty()
    {
        var extra = this.difficultyLevel - 1;
        // [UPDATED] Gentler curves
        this.maxVehicles        = (this._baseCfg ? this._baseCfg.max      : 5) + extra * 1;
        this.minSpeed           = (this._baseCfg ? this._baseCfg.minSpeed : 14) + extra * 3;
        this.maxSpeed           = (this._baseCfg ? this._baseCfg.maxSpeed : 28) + extra * 5;
        this.minSpacingSegments = Math.max(20, (this._baseCfg ? this._baseCfg.spacing : 35) - extra * 2);
        while (this.vehicles.length < this.maxVehicles) this.spawnVehicle();

        console.log('[Traffic] Difficulty', this.difficultyLevel,
            '| vehicles:', this.maxVehicles,
            '| speed:', this.minSpeed, '-', this.maxSpeed,
            '| spacing:', this.minSpacingSegments);
    }

    getCollisionWarning()
    {
        if (this.isColliding) return 1;
        var player    = this.scene.player;
        var circuit   = this.scene.circuit;
        var playerSeg = Math.floor(player.z / circuit.segmentLength) % circuit.total_segments;
        var closest   = 999;
        for (var i = 0; i < this.vehicles.length; i++) {
            var v       = this.vehicles[i];
            var vSeg    = Math.floor(v.segmentIndex) % circuit.total_segments;
            var segDist = Math.abs(playerSeg - vSeg);
            if (segDist > circuit.total_segments / 2)
                segDist = circuit.total_segments - segDist;
            if (Math.abs(player.x - v.laneOffset) < 0.5 && segDist < closest)
                closest = segDist;
        }
        return closest < 15 ? 1 - (closest / 15) : 0;
    }
}