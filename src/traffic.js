const VEHICLE_WORLD_W = 300;
const VEHICLE_WORLD_H = 400;
 
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
 
        this._hasTextures = false;
        this._pool        = [];
        this._POOL_SIZE   = 32;
        this._fbGraphics  = null;
        this._baseCfg     = null;
    }
 
    // ── INIT ──────────────────────────────────────────────────────────────────
    init()
    {
        this.vehicles          = [];
        this.difficultyTimer   = 0;
        this.difficultyLevel   = 1;
        this.collisionCooldown = 0;
        this.isColliding       = false;
 
        this._hasTextures = this.spriteKeys.some(k => this.scene.textures.exists(k));
 
        console.log('[Traffic] init() — textures available:', this._hasTextures,
            '| keys checked:', this.spriteKeys.join(', '));
 
        this._buildPool();
 
        for (var i = 0; i < this.maxVehicles; i++)
            this.spawnVehicle();
 
        console.log('[Traffic] Spawned', this.vehicles.length, 'vehicles. Pool size:', this._pool.length);
    }
 
    _buildPool()
    {
        // Destroy old pool
        for (var i = 0; i < this._pool.length; i++)
            try { this._pool[i].destroy(); } catch (e) {}
        this._pool = [];
 
        // Destroy old fallback graphics
        if (this._fbGraphics) try { this._fbGraphics.destroy(); } catch (e) {}
 
        // Fallback layer: sits at depth 10, always drawn when no textures
        this._fbGraphics = this.scene.add.graphics().setDepth(10);
 
        var key = this._firstAvailableKey();
        if (!key)
        {
            this._hasTextures = false;
            console.warn('[Traffic] _buildPool: no textures found, using fallback rectangles only.');
            return;
        }
 
        for (var j = 0; j < this._POOL_SIZE; j++)
        {
            var img = this.scene.add.image(0, 0, key);
            // origin(0.5, 1.0): bottom-centre so setPosition(screenX, screenY)
            // places the sprite bottom exactly on the road surface Y.
            img.setOrigin(0.5, 1.0);
            img.setDepth(5);
            img.setVisible(false);
            this._pool.push(img);
        }
 
        console.log('[Traffic] _buildPool: pool ready —', this._POOL_SIZE, 'images, key=', key);
    }
 
    _firstAvailableKey()
    {
        var k = this.spriteKeys.find(k => this.scene.textures.exists(k));
        // Absolute last resort: re-use player texture so something is visible
        if (!k && this.scene.textures.exists('imagePlayer')) k = 'imagePlayer';
        return k || null;
    }
 
    // ── SPAWN ─────────────────────────────────────────────────────────────────
    spawnVehicle()
    {
        var circuit = this.scene.circuit;
        var player  = this.scene.player;
 
        var lane     = this.lanes[Math.floor(Math.random() * this.lanes.length)];
        var attempts = 0;
        var segIndex;
 
        do {
            // Spawn 20–150 segments ahead so vehicles are always in the visible range
            var aheadOffset = 20 + Math.floor(Math.random() * 130);
            var playerSeg   = Math.floor(player.z / circuit.segmentLength);
            segIndex        = (playerSeg + aheadOffset) % circuit.total_segments;
            attempts++;
        } while (attempts < 20 && this.isTooClose(segIndex, lane));
 
        if (attempts >= 20) return;
 
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
        for (var i = 0; i < this.vehicles.length; i++)
        {
            var v   = this.vehicles[i];
            var gap = Math.abs(v.segmentIndex - segIndex);
            if (gap > circuit.total_segments / 2) gap = circuit.total_segments - gap;
            if (gap < this.minSpacingSegments && Math.abs(v.laneOffset - lane) < 0.3)
                return true;
        }
        return false;
    }
 
    // ── UPDATE ────────────────────────────────────────────────────────────────
    update(dt)
    {
        this.difficultyTimer += dt;
        if (this.difficultyTimer >= this.difficultyInterval
            && this.difficultyLevel < this.maxDifficulty)
        {
            this.difficultyTimer = 0;
            this.difficultyLevel++;
            this.applyDifficulty();
        }
 
        var circuit = this.scene.circuit;
        for (var i = 0; i < this.vehicles.length; i++)
            this.vehicles[i].update(dt, circuit.total_segments);
 
        this.checkCollisions();
 
        if (this.collisionCooldown > 0)
        {
            this.collisionCooldown -= dt;
            if (this.collisionCooldown <= 0)
            {
                this.collisionCooldown = 0;
                this.isColliding = false;
            }
        }
    }
 
    // ── RENDER ────────────────────────────────────────────────────────────────
    // Called by circuit.render3D() AFTER the road has been projected.
    // At this point every segment in visibleSegmentsList has its curve+hill
    // adjusted screen position in `segment.point.screen` and its perspective
    // factor in `segment.point.scale`.
    render(visibleSegmentsList, circuit, camera)
    {
        // ── 1. Reset pool and fallback ─────────────────────────
        for (var i = 0; i < this._pool.length; i++)
            this._pool[i].setVisible(false);
        if (this._fbGraphics) this._fbGraphics.clear();
 
        // ── 2. Build segment lookup table ─────────────────────
        var segMap = new Map();
        for (var n = 0; n < visibleSegmentsList.length; n++)
        {
            var s = visibleSegmentsList[n];
            segMap.set(s.index, s);
        }
 
        // ── 3. Project each vehicle by RIDING on the road segment ─
        var toRender = [];
 
        for (var i = 0; i < this.vehicles.length; i++)
        {
            var v       = this.vehicles[i];
            var vSegIdx = Math.floor(v.segmentIndex) % circuit.total_segments;
 
            // Fuzzy match: ±2 segment tolerance handles boundary cases
            var matchSeg = null;
            for (var off = 0; off <= 2 && !matchSeg; off++)
            {
                var tryA = (vSegIdx + off) % circuit.total_segments;
                var tryB = (vSegIdx - off + circuit.total_segments) % circuit.total_segments;
                if      (segMap.has(tryA))            matchSeg = segMap.get(tryA);
                else if (off > 0 && segMap.has(tryB)) matchSeg = segMap.get(tryB);
            }
            if (!matchSeg) continue;   // vehicle is outside visible range
 
            // ── THE KEY CHANGE: ride on the segment's projection ──
            //
            // matchSeg.point.screen.x — road CENTER X for this segment, including
            //                           full curve accumulation and any future
            //                           lateral road shifts.
            // matchSeg.point.screen.w — projected road HALF-WIDTH in screen pixels.
            // matchSeg.point.screen.y — Y of road surface (already curve+hill).
            // matchSeg.point.scale    — perspective scale (cameraDepth / transZ).
            //
            // The lane offset becomes a fraction of the half-width:
            //   lane=0    → vehicle on centre line
            //   lane=+0.6 → vehicle 60% of half-width to the right of centre
            //   lane=-0.6 → vehicle 60% of half-width to the left of centre
            //
            // Because point.screen.x already has curves baked in, lateral
            // bending of the road moves the vehicle's screen X with it
            // automatically. No more straight-line drift through corners.
 
            var pt = matchSeg.point;
            if (pt.scale <= 0) continue;             // segment somehow behind camera
 
            var roadCenterX   = pt.screen.x;
            var roadHalfWidth = pt.screen.w;
            var screenY       = pt.screen.y;
            var scale         = pt.scale;
 
            var screenX = Math.round(roadCenterX + v.laneOffset * roadHalfWidth);
 
            // Sprite size in screen pixels (corrected formula from previous fix)
            var spriteH = Math.round(scale * VEHICLE_WORLD_H * SCREEN_CY);
            var spriteW = Math.round(scale * VEHICLE_WORLD_W * SCREEN_CX);
 
            // transZ is still useful for depth sorting (painter's algorithm)
            var worldZ  = vSegIdx * circuit.segmentLength;
            var camSegZ = Math.floor(camera.z / circuit.segmentLength);
            var offsetZ = (vSegIdx < camSegZ) ? circuit.roadLength : 0;
            var transZ  = (worldZ + offsetZ) - camera.z;
            if (transZ <= 0) continue;
 
            // Debug: log first frame a vehicle becomes visible
            if (!v._wasVisible && spriteH >= 4)
            {
                console.log('[Traffic] Vehicle visible — transZ:', Math.round(transZ),
                    'roadCenterX:', roadCenterX,
                    'screenX:', screenX,
                    'spriteW:', spriteW, 'spriteH:', spriteH);
                v._wasVisible = true;
            }
 
            // Filter sprites that are too small or fully off-screen
            if (spriteH < 4 || spriteW < 2) continue;
            if (screenX < -spriteW || screenX > SCREEN_W + spriteW) continue;
 
            v.screen.x     = screenX;
            v.screen.y     = screenY;
            v.screen.w     = spriteW;
            v.screen.h     = spriteH;
            v.screen.scale = scale;
            v.visible      = true;
 
            toRender.push({ v, screenX, screenY, spriteW, spriteH, transZ });
        }
 
        // ── 4. Painter's sort: far → near ─────────────────────
        toRender.sort(function(a, b) { return b.transZ - a.transZ; });
 
        var maxTransZ = toRender.length > 0 ? toRender[0].transZ : 1000;
        var drawIdx   = 0;
 
        // ── 5. Draw each visible vehicle ──────────────────────
        for (var j = 0; j < toRender.length; j++)
        {
            var item = toRender[j];
            var v    = item.v;
 
            // Depth: far=1, near=19 (player at 25, road at 0)
            var t     = Math.min(1.0, item.transZ / Math.max(maxTransZ, 1));
            var depth = Math.max(1, Math.min(19, Math.round(1 + 18 * (1.0 - t))));
 
            // ── FALLBACK: coloured rectangles ──────────────────
            // Used when textures failed to load — always something on screen
            if (!this._hasTextures)
            {
                var g   = this._fbGraphics;
                var col = v.colliding ? 0xff2200 : v.tint;
                var sx  = item.screenX, sy = item.screenY;
                var sw  = item.spriteW,  sh = item.spriteH;
 
                // Car body
                g.fillStyle(col, 1);
                g.fillRect(sx - sw / 2, sy - sh, sw, sh);
 
                // Windscreen
                g.fillStyle(0x88ccff, 0.82);
                g.fillRect(sx - sw * 0.27, sy - sh * 0.88, sw * 0.54, sh * 0.22);
 
                // Wheels
                g.fillStyle(0x111111, 1);
                var ww = sw * 0.18, wh = sh * 0.13;
                g.fillRect(sx - sw * 0.43, sy - wh, ww, wh);
                g.fillRect(sx + sw * 0.25, sy - wh, ww, wh);
 
                // Tail lights
                g.fillStyle(v.colliding ? 0xff0000 : 0xffffaa, 1);
                g.fillRect(sx - sw * 0.43, sy - sh * 0.28, sw * 0.12, sh * 0.08);
                g.fillRect(sx + sw * 0.31, sy - sh * 0.28, sw * 0.12, sh * 0.08);
                continue;
            }
 
            // ── SCENE SPRITE (scene image from pool) ───────────
            if (drawIdx >= this._pool.length) break;
            var spr = this._pool[drawIdx++];
 
            var key = this.scene.textures.exists(v.spriteKey)
                      ? v.spriteKey
                      : this._firstAvailableKey();
            if (!key) continue;
 
            spr.setTexture(key);
            spr.setDisplaySize(item.spriteW, item.spriteH);
            spr.setTint(v.colliding ? 0xff2200 : v.tint);
            spr.setPosition(item.screenX, item.screenY);   // bottom-centre origin
            spr.setDepth(depth);
            spr.setVisible(true);
        }
    }
 
    // ── COLLISION ─────────────────────────────────────────────────────────────
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
        console.log('[Traffic] COLLISION triggered — player.x:', player.x.toFixed(2),
            'vehicle.lane:', vehicle.laneOffset);
 
        this.isColliding       = true;
        this.collisionCooldown = this.collisionCooldownTime;
        vehicle.colliding      = true;
        player.speed           = player.speed * -0.3;
        if (player.speed > 0) player.speed = 0;
 
        if (this.scene.flashCollision) this.scene.flashCollision();
 
        var v = vehicle;
        this.scene.time.delayedCall(
            this.collisionCooldownTime * 1000,
            () => { v.colliding = false; }
        );
    }
 
    // ── DIFFICULTY ────────────────────────────────────────────────────────────
    applyDifficulty()
    {
        var extra = this.difficultyLevel - 1;
        this.maxVehicles        = (this._baseCfg ? this._baseCfg.max      : 8)  + extra * 2;
        this.minSpeed           = (this._baseCfg ? this._baseCfg.minSpeed : 20) + extra * 5;
        this.maxSpeed           = (this._baseCfg ? this._baseCfg.maxSpeed : 45) + extra * 8;
        this.minSpacingSegments = Math.max(8, (this._baseCfg ? this._baseCfg.spacing : 30) - extra * 3);
        while (this.vehicles.length < this.maxVehicles) this.spawnVehicle();
 
        console.log('[Traffic] Difficulty up → level', this.difficultyLevel,
            '| vehicles:', this.maxVehicles,
            '| speed:', this.minSpeed, '-', this.maxSpeed);
    }
 
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
        return closest < 15 ? 1 - (closest / 15) : 0;
    }
}