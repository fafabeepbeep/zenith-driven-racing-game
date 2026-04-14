class Player
{
    constructor(scene)
    {
        //reference to main scene
        this.scene = scene;

        //reference to the player sprite
        this.sprite = scene.sprites[PLAYER];

        //player world coordinates
        this.x = 0;
        this.y = 0;
        this.z = 0;
        this.w = (this.sprite.width/1000)*2; //this parameter is for collision detection

        //player screen coordinates
        this.screen = {x:0, y:0, w:0, h:0};

        //max car speed (to avoid moving for more than 1 road segments, assuming fps=60)
        this.maxSpeed = (scene.circuit.segmentLength) / (1/60);

        //driving control parameters
        this.speed = 0; //current speed

        // steering movement input
        this.moveLeft = false;
        this.moveRight = false;

        this.accelerate = false;
        this.brake = false;
        this.reverse = false;

        // steering speed
        this.steerSpeed = 2;
        this.steerMin = 0.3;   // steering at max speed
        this.steerMax = 1.0;   // steering at low speed

        // drifting effect
        this.centrifugal = 0.1;

        // speed control
        this.speed = 0;
        this.maxSpeed = (scene.circuit.segmentLength) / (1/60);

        this.accelRate = this.maxSpeed * 0.5;
        this.brakeRate = this.maxSpeed * 1.5;
        this.reverseRate = this.maxSpeed * 0.5;

        this.friction = this.maxSpeed * 0.3;
        this.maxReverseSpeed = -this.maxSpeed / 2;



    }

    /** initializers player (must be called when initializing game or changing settings) */

    init()
    {
        //set the player screen size
        this.screen.w = this.sprite.width;
        this.screen.h = this.sprite.height;

        //set the player screen position
        this.screen.x = SCREEN_CX;
        this.screen.y = SCREEN_H - this.screen.h/2;
    }

    /**restarts player */

    restart()
    {
        this.x=0;
        this.y=0;
        this.z=0;

        this.speed = this.maxSpeed;
    }

    /**update player position */
    update(dt)
    {
        //reference to the scene objects
        var circuit = this.scene.circuit;

        //-----------------------------------------------------
        //Moving in z-direction
        //-----------------------------------------------------
        this.z += this.speed*dt; 
        if (this.z >= circuit.roadLength) this.z -= circuit.roadLength;

        /** the distance travel in 1 frame
         * this speed multiplies by lapse time
         * using lapse time from last frame, prevent the game from lagging
         */

        //---------------------------------
        // ACCEL / BRAKE / REVERSE 
        //---------------------------------

        //---------------------------------
        // ACCELERATION
        //---------------------------------

        if (this.accelerate)
            {
                this.speed += this.accelRate * dt;
            }
        
        //---------------------------------
        // BRAKE (only slow down, no reverse)
        //---------------------------------
        
        if (this.brake)
        {
            if (this.speed > 0)
            {
                this.speed -= this.brakeRate * dt;
        
                if (this.speed < 0)
                    this.speed = 0;
            }
        }
        
        //---------------------------------
        // REVERSE (only when break can reverse)
        //---------------------------------
        
        if (this.reverse)
        {
            if (this.speed <= 0)
            {
                this.speed -= this.reverseRate * dt;
            }
        }
        
        //---------------------------------
        // FRICTION (when no input)
        //---------------------------------
        
        if (!this.accelerate && !this.brake && !this.reverse)
        {
            if (this.speed > 0)
            {
                this.speed -= this.friction * dt;
                if (this.speed < 0) this.speed = 0;
            }
            else if (this.speed < 0)
            {
                this.speed += this.friction * dt;
                if (this.speed > 0) this.speed = 0;
            }
        }
        //---------------------------------
        // limit speed
        //---------------------------------
    
        if (this.speed > this.maxSpeed)
            this.speed = this.maxSpeed;
    
        if (this.speed < this.maxReverseSpeed)
            this.speed = this.maxReverseSpeed;
    
        //---------------------------------
        // move forward / backward
        //---------------------------------
    
        this.z += this.speed * dt;
    
        if (this.z >= circuit.roadLength)
            this.z -= circuit.roadLength;
    
        if (this.z < 0)
            this.z += circuit.roadLength;

        // steering sensitivity based on speed

        var speedPercent = Math.abs(this.speed) / this.maxSpeed;

        //centrifugal force
        this.x += speedPercent * this.centrifugal * dt; 

        var steerFactor =
            this.steerMax -
            (this.steerMax - this.steerMin) * speedPercent;

        //-------------------------------------------------
        // steering movement
        //-------------------------------------------------

        if (this.moveLeft)
            {
                this.x -= this.steerSpeed * steerFactor * dt;
            }
            
            if (this.moveRight)
            {
                this.x += this.steerSpeed * steerFactor * dt;
            }
        
            // limit movement to road range
            if (this.x < -1) this.x = -1; //left side
            if (this.x > 1) this.x = 1; //right side
        }

        
    
}