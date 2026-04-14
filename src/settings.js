class Settings
{
    constructor(scene)
    //reference to the game scene
    {
        this.scene = scene;

        var font = {font: '32px Arial', fill: '#000000'};
        this.txtPause = scene.add.text(1750, 5 , '', font);
        this.show();

    }

    /** shows all the settings */

    show()
    {
        this.txtPause.text = '[P] Pause';
    }

}