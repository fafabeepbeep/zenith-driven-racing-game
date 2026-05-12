// frontend/js/circuit.js
// Additions vs original:
//   • Elevation system: segments have varying Y (hills/valleys via sin waves)
//   • camera.y is driven by road elevation in camera.js (see update())
//   • roadSpec accepts optional { elevation: true/false } per-section (future use)
// frontend/js/circuit.js
// CHANGE vs previous: this.texture render texture gets .setDepth(25) so the
// player sprite drawn onto it always renders in front of all traffic images
// (which occupy depths 1–19). Road graphics stay at depth 0.

class Circuit
{
    constructor(scene)
    {
        this.scene    = scene;
        this.graphics = scene.add.graphics(0, 0);   // depth 0 — road quads

        // ── DEPTH FIX: player render texture must be above all traffic (1–19) ──
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
    }

    create(roadSpec)
    {
        this.segments = [];

        if (roadSpec && roadSpec.length)
            this._buildFromSpec(roadSpec);
        else
            this._createDefaultRoad();

        for (var n = 0; n < this.rumble_segments; n++)
        {
            this.segments[n].colour.road = 0xFFFFFF;
            this.segments[this.segments.length - 1 - n].colour.road = 0x222222;
        }

        this.total_segments = this.segments.length;
        this.roadLength     = this.total_segments * this.segmentLength;
    }

    _buildFromSpec(spec)
    {
        for (var i = 0; i < spec.length; i++)
        {
            var part = spec[i];
            if (part.type === 'curve')
                this.createCurve(part.count, part.value);
            else
                this.createSection(part.count);
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
        for (var i = 0; i < nSegments; i++)
        {
            this.createSegment();
            this.segments[this.segments.length - 1].curve = curveValue;
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

        for (var n = 0; n < this.visible_segments; n++)
        {
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

            if (n > 0 && currBottomLine < clipBottomLine)
            {
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

        // ── Draw traffic via NEW scene-sprite renderer ────────
        this.texture.clear();

        if (this.scene.traffic)
            this.scene.traffic.render(this.lastVisibleSegments, this, camera);

        // ── Draw player into render texture (depth 25) ────────
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

        if (colour.lane)
        {
            var lw1     = (w1 / 20) / 2, lw2 = (w2 / 20) / 2;
            var lane_w1 = (w1 * 2) / this.roadLanes;
            var lane_w2 = (w2 * 2) / this.roadLanes;
            var lane_x1 = x1 - w1, lane_x2 = x2 - w2;

            for (var i = 1; i < this.roadLanes; i++)
            {
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
}