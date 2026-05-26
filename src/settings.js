// src/settings.js
// ═══════════════════════════════════════════════════════════════════════════
//  ZENITH DRIVEN — Pause Button (Day Theme)
//
//  [FIXED] Now matches the day theme: white surface, orange accent text.
//          Previously used dark colors that clashed with the login page.
//
//  [FIXED] Pause button is now CLICKABLE (was decorative only). Clicking
//          toggles pause/resume by calling the scene's existing handlers.
// ═══════════════════════════════════════════════════════════════════════════

class Settings
{
    constructor(scene)
    {
        this.scene = scene;

        this.txtPause = scene.add.text(
            SCREEN_W - 20, 80,
            '[ P ] Pause',
            {
                fontFamily: 'monospace',
                fontSize:   '22px',
                fill:       '#d4642a',
                backgroundColor: '#ffffffe6',
                padding: { x: 14, y: 7 }
            }
        ).setOrigin(1, 0).setDepth(50);

        // [FIXED] Make clickable
        this.txtPause.setInteractive({ useHandCursor: true });
        this.txtPause.on('pointerdown', () => {
            if      (scene._gameState === STATE_PLAY)   scene._doPause();
            else if (scene._gameState === STATE_PAUSED) scene._doResume();
        });

        this.txtPause.on('pointerover', () => {
            this.txtPause.setStyle({ backgroundColor: '#fae8d8' });
        });
        this.txtPause.on('pointerout', () => {
            if (scene._gameState === STATE_PAUSED) this.showPaused();
            else                                    this.show();
        });
    }

    show()
    {
        this.txtPause.setText('[ P ] Pause').setStyle({
            fill: '#d4642a',
            backgroundColor: '#ffffffe6'
        });
    }

    showPaused()
    {
        this.txtPause.setText('[ P ] Resume').setStyle({
            fill: '#ffffff',
            backgroundColor: '#d4642a'
        });
    }
}