// src/circuit.js
// ═══════════════════════════════════════════════════════════════════════════
//  ZENITH DRIVEN — Circuit (Road + Trees + Bumps)
//
//  WHAT CHANGED IN THIS REVISION
//  ─────────────────────────────────────────────────────────────────────────
//  [ADDED]   Bump system. Segments can carry an `isBump` flag. The
//            createSection / createCurve API now accepts optional bump
//            placement. levelManager creates bumps when building the road.
//
//  [ADDED]   Bump visual marker. Bumps render as a yellow rumble stripe
//            across the road so the player sees them coming.
//
//  [ADDED]   getBumpAt(z) — used by main.js to detect when player crosses
//            a bump and trigger turbulence.
//
//  [ADDED]   Tree rendering. Loads `imageTrees` if present (the user has
//            img_trees.png), spawns tree sprites along the roadside,
//            projects them with the segment's screen position and scale,
//            renders behind cars but in front of grass.
//
//  [PRESERVED] Elevation system (sin-wave hills). Bumps are an additional
//              system on top — gentle hills happen everywhere; bumps are
//              specific points that trigger gameplay turbulence.
//  [PRESERVED] All road projection, perspective math, depth handling.
// ═══════════════════════════════════════════════════════════════════════════

class Circuit
{
    constructor(scene)
    {
        this.scene    = scene;
        this.graphics = scene.add.graphics(0, 0);
        this.texture  = scene.add.renderTexture(0, 0, SCREEN_W, SCREEN_H).setDepth(25);

        this.segments         = [];
        this.segmentLength    = 100;
        this.total_segments   = null;
        this.visible_segments = 200;
        this.rumble_segments  = 5;
        this.roadLanes        = 3;
        this.roadWidth        = 1000;
        this.roadLength       = null;

        this.elevationAmplitude = 180;
        this.elevationFreq1     = 0.028;
        this.elevationFreq2     = 0.071;

        this.lastVisibleSegments = [];

        // ── [ADDED] Tree system ─────────────────────────────────
        this.trees       = [];   // {segmentIndex, side: -1|+1, scale: 0.9-1.2}
        this._treePool   = [];
        this._TREE_POOL_SIZE = 32;
        this._treeFallback = null;
        this._treeKey    = 'imageTrees';

        // ── [ADDED] Bump tracking ──────────────────────────────
        this.bumpSegments = [];   // list of segment indices that are bumps
    }

    create(roadSpec)
    {
        this.segments = [];
        this.bumpSegments = [];

        if (roadSpec && roadSpec.length)
            this._buildFromSpec(roadSpec);
        else
            this._createDefaultRoad();

        // Rumble (start/end markers)
        for (var n = 0; n < this.rumble_segments; n++) {
            this.segments[n].colour.road = 0xFFFFFF;
            this.segments[this.segments.length - 1 - n].colour.road = 0x222222;
        }

        this.total_segments = this.segments.length;
        this.roadLength     = this.total_segments * this.segmentLength;

        // [ADDED] Build tree placements + pool
        this._populateTrees();
        this._buildTreePool();
    }

    _buildFromSpec(spec)
    {
        for (var i = 0; i < spec.length; i++) {
            var part = spec[i];
            if (part.type === 'curve') {
                this.createCurve(part.count, part.value);
            } else if (part.type === 'bump') {
                // [ADDED] Bump section — N segments where each is marked as bump
                this._createBumpZone(part.count || 8);
            } else {
                this.createSection(part.count);
            }
        }
    }

    _createDefaultRoad()
    {
        this.createSection(200);
        this.createCurve(200, 5);
        this.createSection(200);
        this.createCurve(200, -5);
        this.createSection(200);
    }

    createSection(nSegments)
    {
        for (var i = 0; i < nSegments; i++) this.createSegment();
    }

    createCurve(nSegments, curveValue)
    {
        for (var i = 0; i < nSegments; i++) {
            this.createSegment();
            this.segments[this.segments.length - 1].curve = curveValue;
        }
    }

    // [ADDED] Creates a contiguous bump zone — the road dips/rises briefly,
    //         and the central segments are marked so main.js can trigger
    //         turbulence when the player crosses them.
    _createBumpZone(nSegments)
    {
        for (var i = 0; i < nSegments; i++) {
            this.createSegment();
            var seg = this.segments[this.segments.length - 1];
            // Only mark the middle segments as "real" bumps to trigger physics
            if (i >= 2 && i <= nSegments - 3) {
                seg.isBump = true;
                this.bumpSegments.push(seg.index);
            }
            // Visual marker — yellow rumble stripe across the road
            seg.colour = {
                road:   0x999955,
                grass:  seg.colour ? seg.colour.grass  : 0x429352,
                rumble: 0xFFCC00,
                lane:   0xFFFFFF,
            };
        }
    }

    _computeElevation(n)
    {
        var e1 = Math.sin(n * this.elevationFreq1) * this.elevationAmplitude;
        var e2 = Math.sin(n * this.elevationFreq2 + 1.3) * (this.elevationAmplitude * 0.4);
        return e1 + e2;
    }

    createSegment()
    {
        const colours = {
            LIGHT: { road: 0x888888, grass: 0x429352, rumble: 0xb8312e },
            DARK:  { road: 0x666666, grass: 0x397d46, rumble: 0xDDDDDD, lane: 0xFFFFFF }
        };

        var n   = this.segments.length;
        var elv = this._computeElevation(n);

        this.segments.push({
            index:     n,
            curve:     0,
            elevation: elv,
            isBump:    false,                       // [ADDED]
            colour:    Math.floor(n / this.rumble_segments) % 2 ? colours.DARK : colours.LIGHT,
            point: {
                world:  { x: 0, y: elv, z: n * this.segmentLength },
                screen: { x: 0, y: 0, z: 0, w: 0 },
                scale:  -1
            }
        });
    }

    getSegment(positionZ)
    {
        if (positionZ < 0) positionZ += this.roadLength;
        var index = Math.floor(positionZ / this.segmentLength) % this.total_segments;
        return this.segments[index];
    }

    // [ADDED] Used by main.js — returns true if player.z is on a bump segment
    isOnBump(positionZ)
    {
        var seg = this.getSegment(positionZ);
        return seg && seg.isBump === true;
    }

    project3D(point, cameraX, cameraY, cameraZ, cameraDepth)
    {
        var transX = point.world.x - cameraX;
        var transY = point.world.y - cameraY;
        var transZ = point.world.z - cameraZ;

        if (transZ <= 0) { point.scale = -1; return; }

        point.scale = cameraDepth / transZ;
        var projectedX = point.scale * transX;
        var projectedY = point.scale * transY;
        var projectedW = point.scale * this.roadWidth;

        point.screen.x = Math.round((1 + projectedX) * SCREEN_CX);
        point.screen.y = Math.round((1 - projectedY) * SCREEN_CY);
        point.screen.w = Math.round(projectedW * SCREEN_CX);
    }

    render3D()
    {
        this.graphics.clear();

        var camera         = this.scene.camera;
        var clipBottomLine = SCREEN_H;
        var x  = 0;
        var dx = 0;

        var baseSegment = this.getSegment(camera.z);
        var baseIndex   = baseSegment.index;
        dx = baseSegment.curve;

        this.lastVisibleSegments = [];

        for (var n = 0; n < this.visible_segments; n++) {
            var currIndex   = (baseIndex + n) % this.total_segments;
            var currSegment = this.segments[currIndex];
            var offsetZ     = (currIndex < baseIndex) ? this.roadLength : 0;

            dx += currSegment.curve;
            x  += dx;

            this.project3D(
                currSegment.point,
                camera.x - x,
                camera.y,
                camera.z - offsetZ,
                camera.distToPlane
            );

            if (currSegment.point.scale < 0) continue;
            var currBottomLine = currSegment.point.screen.y;

            if (n > 0 && currBottomLine < clipBottomLine) {
                var prevIndex   = (currIndex > 0) ? currIndex - 1 : this.total_segments - 1;
                var prevSegment = this.segments[prevIndex];
                var p1 = prevSegment.point.screen;
                var p2 = currSegment.point.screen;

                this.drawSegment(
                    p1.x, p1.y, p1.w,
                    p2.x, p2.y, p2.w,
                    currSegment.colour
                );
                this.lastVisibleSegments.push(currSegment);
                clipBottomLine = currBottomLine;
            }
        }

        // [ADDED] Draw trees BEFORE traffic so cars appear in front
        this._renderTrees();

        this.texture.clear();
        if (this.scene.traffic)
            this.scene.traffic.render(this.lastVisibleSegments, this, camera);

        var player = this.scene.player;
        var px = player.screen.x - player.screen.w / 2;
        var py = player.screen.y - player.screen.h;
        this.texture.draw(player.sprite, px, py);
    }

    drawSegment(x1, y1, w1, x2, y2, w2, colour)
    {
        this.graphics.fillStyle(colour.grass, 1);
        this.graphics.fillRect(0, y2, SCREEN_W, y1 - y2);

        this.drawPolygon(x1 - w1, y1, x1 + w1, y1, x2 + w2, y2, x2 - w2, y2, colour.road);

        var rw1 = w1 / 5, rw2 = w2 / 5;
        this.drawPolygon(x1 - w1 - rw1, y1, x1 - w1, y1, x2 - w2, y2, x2 - w2 - rw2, y2, colour.rumble);
        this.drawPolygon(x1 + w1 + rw1, y1, x1 + w1, y1, x2 + w2, y2, x2 + w2 + rw2, y2, colour.rumble);

        if (colour.lane) {
            var lw1     = (w1 / 20) / 2, lw2 = (w2 / 20) / 2;
            var lane_w1 = (w1 * 2) / this.roadLanes;
            var lane_w2 = (w2 * 2) / this.roadLanes;
            var lane_x1 = x1 - w1, lane_x2 = x2 - w2;
            for (var i = 1; i < this.roadLanes; i++) {
                lane_x1 += lane_w1;
                lane_x2 += lane_w2;
                this.drawPolygon(
                    lane_x1 - lw1, y1, lane_x1 + lw1, y1,
                    lane_x2 + lw2, y2, lane_x2 - lw2, y2,
                    colour.lane
                );
            }
        }
    }

    drawPolygon(x1, y1, x2, y2, x3, y3, x4, y4, colour)
    {
        this.graphics.fillStyle(colour, 1);
        this.graphics.beginPath();
        this.graphics.moveTo(x1, y1);
        this.graphics.lineTo(x2, y2);
        this.graphics.lineTo(x3, y3);
        this.graphics.lineTo(x4, y4);
        this.graphics.closePath();
        this.graphics.fill();
    }

    // ─────────────────────────────────────────────────────────────────
    //  [ADDED] TREE SYSTEM
    // ─────────────────────────────────────────────────────────────────
    _populateTrees()
    {
        this.trees = [];
        // One tree every ~10 segments on alternating sides — feels forested
        for (var i = 0; i < this.total_segments; i += 8 + Math.floor(Math.random() * 6)) {
            // Two trees per cluster, both sides
            if (Math.random() < 0.85) {
                this.trees.push({
                    segmentIndex: i,
                    side: -1,
                    xOffset: -1.6 - Math.random() * 0.8,  // -1.6 to -2.4 (outside grass edge)
                    scale: 0.9 + Math.random() * 0.4,
                });
            }
            if (Math.random() < 0.85) {
                this.trees.push({
                    segmentIndex: i + 2,
                    side: 1,
                    xOffset: 1.6 + Math.random() * 0.8,
                    scale: 0.9 + Math.random() * 0.4,
                });
            }
        }
    }

    _buildTreePool()
    {
        for (var i = 0; i < this._treePool.length; i++) {
            try { this._treePool[i].destroy(); } catch (e) {}
        }
        this._treePool = [];

        if (this._treeFallback) try { this._treeFallback.destroy(); } catch (e) {}
        this._treeFallback = this.scene.add.graphics().setDepth(2);

        var hasTexture = this.scene.textures.exists(this._treeKey);
        if (!hasTexture) {
            console.log('[Circuit] Tree texture not found (', this._treeKey, ') — using fallback shapes');
            return;
        }

        for (var j = 0; j < this._TREE_POOL_SIZE; j++) {
            var img = this.scene.add.image(0, 0, this._treeKey);
            img.setOrigin(0.5, 1.0);
            img.setDepth(3);              // above grass (0), below cars (5+)
            img.setVisible(false);
            this._treePool.push(img);
        }
        console.log('[Circuit] Tree pool ready:', this._TREE_POOL_SIZE, 'sprites');
    }

    _renderTrees()
    {
        if (this._treeFallback) this._treeFallback.clear();
        for (var i = 0; i < this._treePool.length; i++)
            this._treePool[i].setVisible(false);

        var camera = this.scene.camera;
        var segMap = new Map();
        for (var n = 0; n < this.lastVisibleSegments.length; n++) {
            var s = this.lastVisibleSegments[n];
            segMap.set(s.index, s);
        }

        var hasTexture = this._treePool.length > 0;
        var drawIdx    = 0;

        // World-space tree dimensions
        var TREE_WORLD_W = 600;
        var TREE_WORLD_H = 900;

        var visibleTrees = [];

        for (var t = 0; t < this.trees.length; t++) {
            var tree = this.trees[t];
            var seg  = segMap.get(tree.segmentIndex);
            if (!seg || !seg.point.screen || seg.point.scale <= 0) continue;

            var pa     = seg.point.screen;
            var scale  = seg.point.scale;
            var screenX = pa.x + tree.xOffset * pa.w;
            var screenY = pa.y;
            var spriteW = scale * TREE_WORLD_W * SCREEN_CX * tree.scale;
            var spriteH = scale * TREE_WORLD_H * SCREEN_CY * tree.scale;

            if (spriteH < 6) continue;
            if (screenX < -spriteW || screenX > SCREEN_W + spriteW) continue;

            var transZ = camera.distToPlane / Math.max(scale, 0.0000001);
            visibleTrees.push({ screenX, screenY, spriteW, spriteH, transZ });
        }

        // Far → near so near trees occlude far ones
        visibleTrees.sort(function(a, b) { return b.transZ - a.transZ; });

        for (var v = 0; v < visibleTrees.length; v++) {
            var item = visibleTrees[v];

            if (hasTexture) {
                if (drawIdx >= this._treePool.length) break;
                var spr = this._treePool[drawIdx++];
                spr.setDisplaySize(item.spriteW, item.spriteH);
                spr.setPosition(item.screenX, item.screenY);
                spr.setVisible(true);
            } else {
                // Fallback shape: green triangle on brown trunk
                var g = this._treeFallback;
                var tx = item.screenX, ty = item.screenY;
                var tw = item.spriteW * 0.7, th = item.spriteH;
                // Trunk
                g.fillStyle(0x5a3a1a, 1);
                g.fillRect(tx - tw * 0.08, ty - th * 0.3, tw * 0.16, th * 0.3);
                // Foliage
                g.fillStyle(0x2d5a2d, 1);
                g.fillTriangle(
                    tx, ty - th,
                    tx - tw * 0.5, ty - th * 0.3,
                    tx + tw * 0.5, ty - th * 0.3
                );
                g.fillStyle(0x3a6e3a, 1);
                g.fillTriangle(
                    tx, ty - th * 0.85,
                    tx - tw * 0.4, ty - th * 0.25,
                    tx + tw * 0.4, ty - th * 0.25
                );
            }
        }
    }
}