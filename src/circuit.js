// src/circuit.js
// ═══════════════════════════════════════════════════════════════════════════
//  ZENITH DRIVEN — Circuit (Procedural 3D Bumps)
//
//  WHAT CHANGED IN THIS REVISION
//  ─────────────────────────────────────────────────────────────────────────
//  [FIXED] Bumps now render as proper 3D-shaded speed humps with alternating
//          warning stripes, NOT a flat yellow rectangle. The bump is drawn
//          as a series of arched segments — darker at the base, lighter at
//          the crest — giving it the appearance of a real road hump.
//
//  [PRESERVED] All other rendering, isOnBump(), tree population, etc.
// ═══════════════════════════════════════════════════════════════════════════

class Circuit
{
    constructor(scene)
    {
        this.scene    = scene;
        this.graphics = scene.add.graphics(0, 0);
        this.texture  = scene.add.renderTexture(0, 0, SCREEN_W, SCREEN_H).setDepth(25);

        this.segments = [];
        this.segmentLength = 100;
        this.total_segments = null;
        this.visible_segments = 200;
        this.rumble_segments = 5;
        this.roadLanes = 3;
        this.roadWidth = 1000;
        this.roadLength = null;

        this.elevationAmplitude = 180;
        this.elevationFreq1 = 0.028;
        this.elevationFreq2 = 0.071;

        this.lastVisibleSegments = [];

        this.trees = [];
        this._treePool = [];
        this._TREE_POOL_SIZE = 32;
        this._treeFallback = null;
        this._treeKey = 'imageTrees';

        this.bumpSegments = [];
        this.bumpZones    = [];          // [ADDED] list of {startIndex, endIndex}
    }

    create(roadSpec)
    {
        this.segments     = [];
        this.bumpSegments = [];
        this.bumpZones    = [];

        if (roadSpec && roadSpec.length) this._buildFromSpec(roadSpec);
        else this._createDefaultRoad();

        for (var n = 0; n < this.rumble_segments; n++) {
            this.segments[n].colour.road = 0xFFFFFF;
            this.segments[this.segments.length - 1 - n].colour.road = 0x222222;
        }
        this.total_segments = this.segments.length;
        this.roadLength = this.total_segments * this.segmentLength;
        this._populateTrees();
        this._buildTreePool();
    }

    _buildFromSpec(spec)
    {
        for (var i = 0; i < spec.length; i++) {
            var part = spec[i];
            if (part.type === 'curve')      this.createCurve(part.count, part.value);
            else if (part.type === 'bump')  this._createBumpZone(part.count || 8);
            else this.createSection(part.count);
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

    createSection(n) { for (var i = 0; i < n; i++) this.createSegment(); }

    createCurve(n, value)
    {
        for (var i = 0; i < n; i++) {
            this.createSegment();
            this.segments[this.segments.length - 1].curve = value;
        }
    }

    // [FIXED] Bump zones — mark center segments as `isBump` AND record the
    // zone bounds so we can render an arched hump shape across the zone.
    _createBumpZone(n)
    {
        var startIndex = this.segments.length;
        for (var i = 0; i < n; i++) {
            this.createSegment();
            var seg = this.segments[this.segments.length - 1];
            if (i >= 2 && i <= n - 3) {
                seg.isBump = true;
                this.bumpSegments.push(seg.index);
            }
            // [REMOVED] The flat yellow recolor — handled by render override now
        }
        this.bumpZones.push({
            startIndex: startIndex,
            endIndex:   this.segments.length - 1,
            length:     n,
        });
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
        var n = this.segments.length;
        var elv = this._computeElevation(n);
        this.segments.push({
            index: n, curve: 0, elevation: elv, isBump: false,
            colour: Math.floor(n / this.rumble_segments) % 2 ? colours.DARK : colours.LIGHT,
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
        var camera = this.scene.camera;
        var clipBottomLine = SCREEN_H;
        var x = 0, dx = 0;
        var baseSegment = this.getSegment(camera.z);
        var baseIndex = baseSegment.index;
        dx = baseSegment.curve;
        this.lastVisibleSegments = [];

        for (var n = 0; n < this.visible_segments; n++) {
            var currIndex = (baseIndex + n) % this.total_segments;
            var currSegment = this.segments[currIndex];
            var offsetZ = (currIndex < baseIndex) ? this.roadLength : 0;
            dx += currSegment.curve;
            x += dx;
            this.project3D(currSegment.point, camera.x - x, camera.y, camera.z - offsetZ, camera.distToPlane);
            if (currSegment.point.scale < 0) continue;
            var currBottomLine = currSegment.point.screen.y;
            if (n > 0 && currBottomLine < clipBottomLine) {
                var prevIndex = (currIndex > 0) ? currIndex - 1 : this.total_segments - 1;
                var prevSegment = this.segments[prevIndex];
                var p1 = prevSegment.point.screen;
                var p2 = currSegment.point.screen;
                this.drawSegment(p1.x, p1.y, p1.w, p2.x, p2.y, p2.w, currSegment.colour);

                // [FIXED] If this segment is part of a bump zone, overlay the
                // 3D-shaded hump on top of the base road.
                if (currSegment.isBump) {
                    this._drawBump(p1, p2, currSegment);
                }

                this.lastVisibleSegments.push(currSegment);
                clipBottomLine = currBottomLine;
            }
        }

        this._renderTrees();

        this.texture.clear();
        if (this.scene.traffic)
            this.scene.traffic.render(this.lastVisibleSegments, this, camera);

        var player = this.scene.player;
        var px = player.screen.x - player.screen.w / 2;
        var py = player.screen.y - player.screen.h;
        this.texture.draw(player.sprite, px, py);
    }

    // ─────────────────────────────────────────────────────────
    //  [NEW] Procedural 3D bump rendering — replaces flat yellow stripe
    //
    //  Draws a strip with alternating black/yellow chevrons and a brighter
    //  "crest" highlight, giving a 3D speed-hump appearance. Uses the same
    //  perspective projection as the road so it follows curves correctly.
    // ─────────────────────────────────────────────────────────
    _drawBump(p1, p2, segment)
    {
        // Determine the hump's vertical position in screen-space.
        // Far segments draw thinner stripes; near segments draw wider chevrons.
        var x1 = p1.x, y1 = p1.y, w1 = p1.w;
        var x2 = p2.x, y2 = p2.y, w2 = p2.w;

        // Hump crest highlight (lighter band where the hump peaks)
        this.drawPolygon(
            x1 - w1 * 0.95, y1, x1 + w1 * 0.95, y1,
            x2 + w2 * 0.95, y2, x2 - w2 * 0.95, y2,
            0xb89030                          // dark amber base
        );

        // Inner highlight band (the visual "top" of the hump)
        var midY1 = y1 + (y2 - y1) * 0.2;
        var midY2 = y1 + (y2 - y1) * 0.7;
        var midX1 = x1 + (x2 - x1) * 0.2;
        var midX2 = x1 + (x2 - x1) * 0.7;
        var midW1 = w1 + (w2 - w1) * 0.2;
        var midW2 = w1 + (w2 - w1) * 0.7;

        this.drawPolygon(
            midX1 - midW1 * 0.9, midY1, midX1 + midW1 * 0.9, midY1,
            midX2 + midW2 * 0.9, midY2, midX2 - midW2 * 0.9, midY2,
            0xf0c850                          // bright yellow crest
        );

        // Chevron warning stripes (alternating black) — uses segment index
        // to alternate, so they form a striped pattern across consecutive
        // bump segments.
        var chevronOn = (segment.index % 2) === 0;
        if (chevronOn) {
            // Draw a short black chevron strip in the middle of the segment
            var chevY1 = y1 + (y2 - y1) * 0.4;
            var chevY2 = y1 + (y2 - y1) * 0.55;
            var chevX1 = x1 + (x2 - x1) * 0.4;
            var chevX2 = x1 + (x2 - x1) * 0.55;
            var chevW1 = w1 + (w2 - w1) * 0.4;
            var chevW2 = w1 + (w2 - w1) * 0.55;

            this.drawPolygon(
                chevX1 - chevW1 * 0.85, chevY1, chevX1 + chevW1 * 0.85, chevY1,
                chevX2 + chevW2 * 0.85, chevY2, chevX2 - chevW2 * 0.85, chevY2,
                0x2a2a2a                      // black chevron
            );
        }

        // Edge shadow (darker line at the leading edge — visual depth cue)
        this.drawPolygon(
            x1 - w1 * 0.95, y1, x1 + w1 * 0.95, y1,
            x1 + w1 * 0.95, y1 + 2, x1 - w1 * 0.95, y1 + 2,
            0x000000
        );
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
            var lw1 = (w1 / 20) / 2, lw2 = (w2 / 20) / 2;
            var lane_w1 = (w1 * 2) / this.roadLanes;
            var lane_w2 = (w2 * 2) / this.roadLanes;
            var lane_x1 = x1 - w1, lane_x2 = x2 - w2;
            for (var i = 1; i < this.roadLanes; i++) {
                lane_x1 += lane_w1; lane_x2 += lane_w2;
                this.drawPolygon(lane_x1 - lw1, y1, lane_x1 + lw1, y1,
                                 lane_x2 + lw2, y2, lane_x2 - lw2, y2, colour.lane);
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

    _populateTrees()
    {
        this.trees = [];
        for (var i = 0; i < this.total_segments; i += 8 + Math.floor(Math.random() * 6)) {
            if (Math.random() < 0.85) {
                this.trees.push({
                    segmentIndex: i, side: -1,
                    xOffset: -1.6 - Math.random() * 0.8,
                    scale: 0.9 + Math.random() * 0.4,
                });
            }
            if (Math.random() < 0.85) {
                this.trees.push({
                    segmentIndex: i + 2, side: 1,
                    xOffset: 1.6 + Math.random() * 0.8,
                    scale: 0.9 + Math.random() * 0.4,
                });
            }
        }
    }

    _buildTreePool()
    {
        for (var i = 0; i < this._treePool.length; i++)
            try { this._treePool[i].destroy(); } catch (e) {}
        this._treePool = [];
        if (this._treeFallback) try { this._treeFallback.destroy(); } catch (e) {}
        this._treeFallback = this.scene.add.graphics().setDepth(2);

        var hasTexture = this.scene.textures.exists(this._treeKey);
        if (!hasTexture) return;
        for (var j = 0; j < this._TREE_POOL_SIZE; j++) {
            var img = this.scene.add.image(0, 0, this._treeKey);
            img.setOrigin(0.5, 1.0);
            img.setDepth(3);
            img.setVisible(false);
            this._treePool.push(img);
        }
    }

    _renderTrees()
    {
        if (this._treeFallback) this._treeFallback.clear();
        for (var i = 0; i < this._treePool.length; i++) this._treePool[i].setVisible(false);

        var camera = this.scene.camera;
        var segMap = new Map();
        for (var n = 0; n < this.lastVisibleSegments.length; n++) {
            var s = this.lastVisibleSegments[n];
            segMap.set(s.index, s);
        }
        var hasTexture = this._treePool.length > 0;
        var drawIdx = 0;
        var TREE_WORLD_W = 600;
        var TREE_WORLD_H = 900;
        var visible = [];

        for (var t = 0; t < this.trees.length; t++) {
            var tree = this.trees[t];
            var seg = segMap.get(tree.segmentIndex);
            if (!seg || !seg.point.screen || seg.point.scale <= 0) continue;
            var pa = seg.point.screen;
            var scale = seg.point.scale;
            var screenX = pa.x + tree.xOffset * pa.w;
            var screenY = pa.y;
            var spriteW = scale * TREE_WORLD_W * SCREEN_CX * tree.scale;
            var spriteH = scale * TREE_WORLD_H * SCREEN_CY * tree.scale;
            if (spriteH < 6) continue;
            if (screenX < -spriteW || screenX > SCREEN_W + spriteW) continue;
            var transZ = camera.distToPlane / Math.max(scale, 0.0000001);
            visible.push({ screenX, screenY, spriteW, spriteH, transZ });
        }
        visible.sort((a, b) => b.transZ - a.transZ);

        for (var v = 0; v < visible.length; v++) {
            var item = visible[v];
            if (hasTexture) {
                if (drawIdx >= this._treePool.length) break;
                var spr = this._treePool[drawIdx++];
                spr.setDisplaySize(item.spriteW, item.spriteH);
                spr.setPosition(item.screenX, item.screenY);
                spr.setVisible(true);
            } else {
                var g = this._treeFallback;
                var tx = item.screenX, ty = item.screenY;
                var tw = item.spriteW * 0.7, th = item.spriteH;
                g.fillStyle(0x5a3a1a, 1);
                g.fillRect(tx - tw * 0.08, ty - th * 0.3, tw * 0.16, th * 0.3);
                g.fillStyle(0x2d5a2d, 1);
                g.fillTriangle(tx, ty - th, tx - tw * 0.5, ty - th * 0.3, tx + tw * 0.5, ty - th * 0.3);
                g.fillStyle(0x3a6e3a, 1);
                g.fillTriangle(tx, ty - th * 0.85, tx - tw * 0.4, ty - th * 0.25, tx + tw * 0.4, ty - th * 0.25);
            }
        }
    }
}