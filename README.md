## 🚀 ZENITH DRIVEN — Setup & Testing Guide (UPDATED)

---

## ⚙️ Setup Instructions (Step-by-Step)

---

### 1. XAMPP (MySQL)

* Open XAMPP Control Panel → Start **Apache** and **MySQL**
* You do NOT need to manually create the database — `db.js` auto-creates it

**Default credentials:**

```
host=localhost  
user=root  
password= (empty)
```

If you use a password, create `.env` in project root:

```
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=yourpassword
DB_NAME=racing_game
JWT_SECRET=pick_a_long_random_string
```

---

### 2. Python Virtual Environment (IMPORTANT ⚠️)

Before running anything, you MUST activate `venv`.

#### First time setup:

```bash
python3 -m venv venv
```

---

### ▶️ Activate venv

#### Mac / Linux:

```bash
source venv/bin/activate
```

#### Windows:

```bash
venv\Scripts\activate
```

You will see:

```
(venv) your-name@your-machine %
```

---

### ⛔ Deactivate venv

```bash
deactivate
```

---

## 3. Install Python Dependencies

⚠️ Make sure venv is ACTIVE before installing

```bash
pip install mediapipe opencv-python websocket-client
```

---

## 4. Node.js Backend + WebSocket Server

⚠️ Run this in a **SEPARATE TERMINAL**

```bash
npm install
node server.js
```

You should see:

```
[DB] Database "racing_game" ready.
[SERVER] API → http://localhost:3000
[SERVER] WebSocket relay → ws://localhost:8765
```

---

## 5. Python Gesture Control

⚠️ Run this in a **SECOND TERMINAL (different from Node)**
⚠️ Ensure venv is ACTIVE in THIS terminal too

```bash
python3 gestureControl.py
```

You should see:

```
Connected to WebSocket server
```

A webcam window will open showing:

* Hand landmarks (MediaPipe)
* Current gesture text

---

## ⚠️ IMPORTANT: RUN ORDER

You MUST run **ALL THREE in order**

### Terminal 1 (venv active):

```
node server.js
```

### Terminal 2 (venv active):

```
python3 gestureControl.py
```

### Browser:

Open game via local server

---

## 6. Frontend (Browser)

⚠️ DO NOT open using `file://`

Use a local server:

```bash
npx serve .
```

Then open:

```
http://localhost:3000/index.html
```

OR use VS Code Live Server.

---

## ✅ Testing Checklist
Database

 XAMPP MySQL is running
 node server.js shows [DB] Database "racing_game" ready.
 Visit http://localhost:3000/api/health → should return {"ok":true}
 Register a user at http://localhost:3000/api/register

Backend API

 POST /api/register → returns { success: true }
 POST /api/login → returns { token, username }
 GET /api/leaderboard → returns JSON array (empty [] is fine initially)
 POST /api/leaderboard/save with Bearer token → returns { success: true }
 No HTTP 500 errors in the Node console

WebSocket

 node server.js shows WebSocket relay → ws://localhost:8765
 python gestureControl.py shows [WS] Connected to server.
 Game HUD shows WS: Connected ✓ (green)

Gesture Detection

 Webcam window opens
 Right hand is detected (landmarks drawn)
 Gestures change as you move your hand:

Index finger toward camera → START
Open palm facing camera → BRAKE
Fist → REVERSE
Palm down → FORWARD
Back of hand, fingers left → LEFT
Palm toward camera, fingers right → RIGHT


 Game responds to gestures (HUD shows current gesture)

Start Screen

 After login, game.html shows "ZENITH DRIVEN" logo
 "WELCOME, {username}" is shown
 "START GAME" flickers
 START gesture OR SPACE key triggers flash → enters game

Countdown

 After start screen, countdown 3 → 2 → 1 → GO! plays
 Player is frozen during countdown
 Car starts moving after GO!

Gameplay

 Road renders with hills/valleys (elevation system active)
 Traffic vehicles are visible (coloured rectangles if images missing)
 Collision causes red flash + speed reversal
 Off-track shows warning countdown
 Level clears after 2 laps
 Game saves to leaderboard on quit or completion
 Leaderboard on index.html shows gold/silver/bronze highlights for top 3


🚀 Final Notes & Assumptions
Traffic Rendering Fix

Root cause: segment matching was exact (===) but vehicle segmentIndex is a float.
Vehicles near segment boundaries could fall between two visible segments.
Fix: ±2 segment tolerance lookup using a Map for O(1) access.
Secondary fix: if ALL three traffic images (img_bluetruck.png, img_pinkcar.png,
img_greencar.png) are missing from src/assets/, the system now renders
coloured rectangles so the game is always playable.

Database Fix

db.js no longer connects with database: 'racing_game' from the start.
It first bootstraps (creates DB + tables if needed), then the pool uses the DB.
This eliminates the "Unknown database" error permanently.

Gesture Mapping Fix

Original: player.brake = this.currentGesture === 'STOP' — but Python sends 'BRAKE'.
Fixed to 'BRAKE'. REVERSE was never mapped in WS mode — now mapped to 'REVERSE'.

Elevation

Segments use dual-frequency sine waves for natural hill/valley feel.
Camera Y smoothly lerps toward road elevation (factor 0.10) — prevents jitter.

Press Start 2P Font

Added to game.html via Google Fonts for the "START GAME" flicker text.
Phaser's fontFamily must match exactly: "'Press Start 2P', monospace".

MediaPipe Hand Orientation Note

After cv2.flip(frame, 1) (mirror), MediaPipe labels the player's physical
right hand as "Left" in its classification. The code accounts for this.

Improvements Made

levelManager.js: added per-level trafficSpacing and difficultyInterval
so later levels ramp up faster and cars are closer together.
camera.js: added elevation tracking with smooth lerp.
server.js: added request logging, health check endpoint, global error handler.

## 🚀 Final Notes

### 🔁 System Architecture (IMPORTANT UNDERSTANDING)

```
Python (MediaPipe + OpenCV)
        ↓
   WebSocket (ws://localhost:8765)
        ↓
Node.js server.js (relay)
        ↓
Phaser Game (main.js)
```

---

### ⚠️ Common Mistakes (Avoid These)

❌ Running Python without venv
❌ Running both in same terminal
❌ Not starting server first
❌ Opening HTML via file://
❌ Mediapipe not installed in venv

---

### 🧠 Key Rule

> Node server + Python script MUST run **simultaneously in different terminals**, both inside the virtual environment.

