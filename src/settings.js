// src/settings.js
// FIX: moved pause hint below username to avoid overlap.
// Username is drawn at (SCREEN_W - 20, 20) with origin(1,0) in main.js.
// This text sits directly below it at y=60.

class Settings
{
    constructor(scene)
    {
        this.scene = scene;

        // FIX: was at (1750, 5) with default origin — overlapped username.
        // Now anchored to top-right with setOrigin(1,0), positioned at y=60
        // (just below the username text which occupies y=20..55 approx).
        this.txtPause = scene.add.text(
            SCREEN_W - 20, 60,
            '[ P ] Pause',
            {
                fontFamily: 'monospace',
                fontSize:   '20px',
                fill:       '#888888',
                backgroundColor: '#00000066',
                padding: { x: 8, y: 4 }
            }
        ).setOrigin(1, 0).setDepth(50);
    }

    show()
    {
        this.txtPause.setText('[ P ] Pause').setStyle({ fill: '#888888' });
    }

    showPaused()
    {
        this.txtPause.setText('[ P ] Resume').setStyle({ fill: '#e8ff00' });
    }
}