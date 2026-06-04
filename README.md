# ZENITH DRIVEN — Installation & Deployment Guide

> **Hand Gesture Controller for Navigation Gameplay using OpenCV and MediaPipe**
>
> This guide takes a new developer from zero to a fully running system — locally on their own machine and live on the internet. Read every step before you start. Do not skip steps.

---

## Table of Contents

- [Part A — Project Overview](#part-a--project-overview)
- [Part B — Localhost Development Setup](#part-b--localhost-development-setup)
  - [Windows Installation](#windows-installation)
  - [macOS Installation](#macos-installation)
- [Part C — Gesture Model Training Pipeline](#part-c--gesture-model-training-pipeline)
- [Part D — Localhost Database (XAMPP)](#part-d--localhost-database-xampp)
- [Part E — Cloud Database Migration (Aiven)](#part-e--cloud-database-migration-aiven)
- [Part F — Render Deployment](#part-f--render-deployment)
- [Part G — GitHub Workflow](#part-g--github-workflow)
- [Part H — GitHub to Render Automatic Deployment](#part-h--github-to-render-automatic-deployment)
- [Part I — Moving the Project to Another Computer](#part-i--moving-the-project-to-another-computer)
- [Part J — Troubleshooting Guide](#part-j--troubleshooting-guide)
- [Part K — System Startup Checklist](#part-k--system-startup-checklist)

---

# Part A — Project Overview

## What This Project Is

ZENITH DRIVEN is a browser-based pseudo-3D racing game that uses your laptop's built-in webcam and hand gestures as the game controller. No extra hardware is needed. You wave your hand in front of your camera, and the car responds in real time.

## System Architecture

The system has three main parts that run at the same time and talk to each other:

```
┌──────────────────────────────────────────────────────┐
│                    YOUR COMPUTER                     │
│                                                      │
│  [Webcam]                                            │
│     │                                                │
│     ▼                                                │
│  gestureControl.py  ─── WebSocket ──► Browser Game  │
│  (Python + OpenCV                     (Phaser.js)    │
│   + MediaPipe)                             │         │
│                                            │         │
│                                     HTTP REST API    │
└────────────────────────────────────────────┼─────────┘
                                             │
                              ┌──────────────▼──────────────┐
                              │     Render (Cloud Server)   │
                              │                             │
                              │  server.js (Node.js)        │
                              │  - Express REST API         │
                              │  - WebSocket relay          │
                              │         │                   │
                              │         ▼                   │
                              │  Aiven MySQL Database       │
                              │  - users table              │
                              │  - leaderboard table        │
                              └─────────────────────────────┘
```

**What happens step by step:**

1. You open the game website in your browser
2. You start the Python gesture script on your laptop
3. The Python script reads your webcam and recognises your hand gesture
4. It sends the gesture name (e.g. `FORWARD`) over WebSocket to the server
5. The server relays it to your browser
6. The browser moves the car

## System Components

| Component | Technology | Where it runs |
|---|---|---|
| Racing game frontend | HTML, CSS, JavaScript, Phaser.js | Browser (served from Render) |
| Backend server + WebSocket relay | Node.js, Express, `ws` library | Render (cloud) or `localhost:3000` |
| REST API | Node.js, Express | Same Node.js process |
| Authentication | JWT tokens, bcrypt password hashing | Node.js |
| Database | MySQL 8.0 | Aiven (cloud) or XAMPP (local) |
| Gesture recognition | Python, OpenCV, MediaPipe | Your laptop only — local always |
| Gesture classification model | MediaPipe Model Maker `.task` file | Your laptop only |

## Development Tools Used

| Tool | Purpose |
|---|---|
| Visual Studio Code | Code editor |
| Git + GitHub | Version control and repository hosting |
| XAMPP | Local MySQL database + phpMyAdmin |
| Google Colab | Training the gesture model (GPU cloud) |
| Render | Hosting the Node.js server and game website |
| Aiven | Hosted cloud MySQL database |
| Postman (optional) | Testing REST API endpoints |

## Software Requirements

| Software | Version | Required for |
|---|---|---|
| Python | 3.12.0 (Apple Silicon) / 3.10+ (others) | Gesture recognition script |
| Node.js | 18 or higher | Backend server |
| npm | Comes with Node.js | Installing Node.js packages |
| Git | Any recent version | Cloning and version control |
| XAMPP | Any recent version | Local MySQL database |
| VS Code | Any recent version | Editing code |
| Google Chrome / Edge / Firefox | Latest | Playing the game |

## Hardware Requirements

| Component | Minimum | Recommended |
|---|---|---|
| Webcam | 720p built-in or USB | 1080p |
| CPU | Intel Core i5 (8th Gen) or Apple M1 | Intel Core i7 or Apple M2 |
| RAM | 8 GB | 16 GB |
| Storage | 2 GB free | 5 GB free |
| Internet | Required (stable) | Broadband |

> **Apple Silicon (M1/M2) users:** You must use Python 3.12.0. This is because MediaPipe requires a specific build that only works with Python 3.12 on ARM64 Macs. Any other Python version will fail silently or crash.

## Network Requirements

- Stable internet connection for WebSocket communication to Render
- WebSocket connections use port 443 (HTTPS/WSS) — this is almost always open on home and university networks
- The local MySQL (XAMPP) runs on port 3306 — this only needs to be accessible on your own machine

## Folder Structure

```
zenith-driven/               ← project root (this is what you clone)
│
├── server.js                ← Node.js backend: REST API + WebSocket relay
├── db.js                    ← MySQL database connection and bootstrap
├── schema.sql               ← Database table definitions (for reference)
├── package.json             ← Node.js dependencies list
├── .env                     ← Your private config (you create this — never commit it)
├── ca.pem                   ← Aiven SSL certificate (you download this — never commit it)
│
├── src/                     ← Game frontend (served as static files)
│   ├── index.html           ← Login and signup page
│   ├── game.html            ← Game page
│   ├── main.js              ← Phaser.js game scenes
│   ├── circuit.js           ← Road geometry
│   ├── player.js            ← Vehicle physics
│   ├── camera.js            ← Camera follow logic
│   ├── traffic.js           ← AI traffic vehicles
│   ├── levelManager.js      ← Level progression
│   ├── settings.js          ← Pause button
│   ├── vehicle.js           ← AI vehicle class
│   ├── libs/
│   │   └── phaser.min.js    ← Phaser.js game engine (bundled locally)
│   └── assets/
│       ├── gesturelegend.png
│       ├── img_player.png
│       ├── img_bluetruck.png
│       └── ...              ← Other game images
│
├── gestureControl.py        ← Gesture recognition — run this on your laptop
├── gestureDatasetCollector.py ← Webcam dataset image collector
├── gestureModelTrainer.py   ← Model training script
│
├── models/
│   └── gestureModel.task    ← Trained gesture model (you add this)
│
└── dataset/                 ← Dataset images for training (you collect these)
    ├── START/
    ├── FORWARD/
    ├── BRAKE/
    ├── LEFT/
    ├── RIGHT/
    ├── REVERSE/
    ├── BALANCE/
    └── NONE/
```

---

# Part B — Localhost Development Setup

> This section sets up the full project on your own computer so you can develop and test without needing the internet (except for the Aiven cloud database if you choose to use it).

---

## Windows Installation

### Step 1 — Install Python

1. Go to [https://www.python.org/downloads/](https://www.python.org/downloads/)
2. Download **Python 3.11.x** (recommended for Windows — do NOT use 3.13 as MediaPipe does not yet support it)
3. Run the installer. **Before clicking Install Now, tick the checkbox that says "Add Python to PATH"** — this is critical

   ![Add Python to PATH checkbox must be ticked](https://www.python.org/static/img/python-logo.png)

4. Click **Install Now**
5. When finished, open **Command Prompt** (search for `cmd` in the Start menu) and verify:

```cmd
python --version
pip --version
```

You should see something like:
```
Python 3.11.9
pip 24.x.x from ...
```

> **If you see "python is not recognized":** You forgot to tick "Add Python to PATH". Uninstall Python, run the installer again, and tick the checkbox this time.

---

### Step 2 — Install Node.js and npm

1. Go to [https://nodejs.org/](https://nodejs.org/)
2. Download the **LTS** version (Long Term Support — labelled "Recommended For Most Users")
3. Run the installer and click through all defaults
4. Open a **new** Command Prompt window and verify:

```cmd
node --version
npm --version
```

Expected output:
```
v20.x.x
10.x.x
```

---

### Step 3 — Install Git

1. Go to [https://git-scm.com/download/win](https://git-scm.com/download/win)
2. Download and run the installer
3. Click through all defaults (the defaults are fine)
4. Verify:

```cmd
git --version
```

Expected:
```
git version 2.x.x.windows.x
```

---

### Step 4 — Install Visual Studio Code

1. Go to [https://code.visualstudio.com/](https://code.visualstudio.com/)
2. Download and install for Windows
3. After installing, open VS Code and install these extensions (click the Extensions icon on the left sidebar, search by name):

| Extension | Why you need it |
|---|---|
| Python (by Microsoft) | Python syntax highlighting, IntelliSense, virtual environment support |
| Pylance | Better Python type checking |
| ESLint | JavaScript code quality |
| Prettier | Auto-format JavaScript |
| GitLens | Better Git integration |
| DotENV | Syntax highlighting for `.env` files |

**Recommended settings** — open VS Code settings (`Ctrl+,`) and add:

```json
{
  "editor.formatOnSave": true,
  "files.autoSave": "onFocusChange",
  "terminal.integrated.defaultProfile.windows": "Command Prompt"
}
```

---

### Step 5 — Install XAMPP

XAMPP gives you a local MySQL database and phpMyAdmin (a web interface for managing databases).

1. Go to [https://www.apachefriends.org/download.html](https://www.apachefriends.org/download.html)
2. Download XAMPP for Windows (any recent version)
3. Run the installer — install to `C:\xampp` (the default)
4. When the installer finishes, launch **XAMPP Control Panel**
5. Click **Start** next to **Apache** — the row turns green
6. Click **Start** next to **MySQL** — the row turns green

> **If port 80 is blocked (Apache won't start):** Another program is using port 80. Click **Config** next to Apache → `httpd.conf` → change `Listen 80` to `Listen 8080`. This is only needed for phpMyAdmin access, not for the game.

> **If port 3306 is blocked (MySQL won't start):** Another MySQL installation is already running. Stop it from Windows Services, or change XAMPP MySQL to port 3307 in `my.ini`.

Verify MySQL is running by opening your browser and going to:
```
http://localhost/phpmyadmin
```
You should see the phpMyAdmin dashboard.

---

### Step 6 — Create Local Database

1. In phpMyAdmin, click **New** in the left sidebar
2. Type `racing_game` as the database name
3. Choose `utf8mb4_unicode_ci` as the collation
4. Click **Create**
5. Click on the `racing_game` database in the left sidebar
6. Click the **SQL** tab at the top
7. Copy and paste the following SQL:

```sql
CREATE TABLE IF NOT EXISTS users (
  id            INT          AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(50)  NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS leaderboard (
  id               INT           AUTO_INCREMENT PRIMARY KEY,
  user_id          INT           NOT NULL,
  username         VARCHAR(50)   NOT NULL,
  time_completed   FLOAT         NULL,
  levels_completed TINYINT       NOT NULL DEFAULT 0,
  status           ENUM('Completed','Game Unfinished') NOT NULL DEFAULT 'Game Unfinished',
  created_at       TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_leaderboard_status_time
  ON leaderboard (status, time_completed);
```

8. Click **Go** to run the SQL
9. In the left sidebar, expand `racing_game` — you should see `users` and `leaderboard` tables

> **Alternative:** The backend server (`server.js`) automatically creates these tables when it starts for the first time. You only need to create the database `racing_game` manually; the tables are handled automatically.

---

### Step 7 — Clone the GitHub Repository

Open Command Prompt, navigate to where you want the project folder (e.g. your Desktop or Documents), then run:

```cmd
cd C:\Users\YourName\Documents
git clone https://github.com/fafabeepbeep/zenith-driven-racing-game.git
cd zenith-driven-racing-game
```

Verify the folder structure looks correct:

```cmd
dir
```

You should see `server.js`, `db.js`, `package.json`, `gestureControl.py`, and a `src` folder.

---

### Step 8 — Install Node.js Dependencies

Inside the project folder, run:

```cmd
npm install
```

This reads `package.json` and downloads all required packages into a `node_modules` folder. This may take 1–2 minutes.

Verify it worked:

```cmd
dir node_modules
```

You should see folders including `express`, `bcrypt`, `ws`, `jsonwebtoken`, `mysql2`, `dotenv`.

---

### Step 9 — Install Python Dependencies

**Create a virtual environment** (an isolated Python setup just for this project):

```cmd
python -m venv venv
```

**Activate the virtual environment:**

```cmd
venv\Scripts\activate
```

Your command prompt should now show `(venv)` at the start of the line.

**Install Python packages:**

```cmd
pip install opencv-python mediapipe websocket-client certifi
```

Verify they installed:

```cmd
pip list
```

Look for `opencv-python`, `mediapipe`, `websocket-client`, `certifi` in the list.

> **Important:** Every time you open a new terminal to run the Python script, you must activate the virtual environment first with `venv\Scripts\activate`. If you forget, the script will fail with import errors.

---

### Step 10 — Configure Environment Variables

In the project root folder, create a new file called `.env` (exactly that name, with the dot, no extension):

```cmd
notepad .env
```

When Notepad opens, type the following (replacing `your_secret_key` with any long random string of your choice):

```env
# Database
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=racing_game
DB_SSL=false

# Authentication
JWT_SECRET=your_very_long_random_secret_key_change_this

# Server
PORT=3000
NODE_ENV=development
```

Save and close Notepad.

> **What is the JWT secret?** It's a password that the server uses to sign login tokens. It can be any string of random characters — the longer the better. For example: `z3n1thDr1v3n$uper$ecr3tK3y2024!`. Never share it publicly or commit it to GitHub.

> **What about DB_PASSWORD?** By default XAMPP MySQL root has no password. Leave it empty. If you set a root password in XAMPP, put it here.

---

### Step 11 — Add the Gesture Model

The trained gesture model file (`gestureModel.task`) is not in the GitHub repository because it is a large binary file. You need to place it manually.

1. If you have the model file already, place it at:
   ```
   zenith-driven-racing-game/models/gestureModel.task
   ```

2. If the `models` folder does not exist, create it:
   ```cmd
   mkdir models
   ```

3. Place `gestureModel.task` inside the `models` folder

4. Verify the model loads by running:
   ```cmd
   python gestureControl.py --model
   ```
   You should see the webcam window open and the label `ML: gestureModel.task loaded` appear in the terminal output. If you see `[WARN] Model file not found`, the path is wrong.

> **Don't have the model yet?** See [Part C — Gesture Model Training Pipeline](#part-c--gesture-model-training-pipeline) to train your own.

---

### Step 12 — Start XAMPP Services

Open XAMPP Control Panel and make sure:
- **Apache** → Status: Running (green)
- **MySQL** → Status: Running (green)

---

### Step 13 — Start the Backend Server

Open a Command Prompt in the project root folder and run:

```cmd
node server.js
```

You should see:
```
═══════════════════════════════════════════════════
  ZENITH DRIVEN — Server
  Listening   → http://localhost:3000
  WebSocket   → ws://localhost:3000/gesture
  Environment → development
═══════════════════════════════════════════════════
[DB] Database "racing_game" ready.
```

Keep this terminal open — the server must keep running.

---

### Step 14 — The WebSocket Server

There is no separate WebSocket server to start. The WebSocket relay runs inside the same `node server.js` process on the path `/gesture`. You only need one terminal for Node.js.

---

### Step 15 — Start the Python Gesture Controller

Open a **second** Command Prompt, navigate to the project folder, activate the virtual environment, and run:

**Rule-based mode (no model needed):**
```cmd
venv\Scripts\activate
python gestureControl.py
```

**ML model mode (recommended — uses trained model):**
```cmd
venv\Scripts\activate
python gestureControl.py --model
```

**Production mode (connects to Render server instead of localhost):**
```cmd
venv\Scripts\activate
python gestureControl.py --model --server wss://zenith-driven-racing-game.onrender.com/gesture
```

A webcam window will open showing your hand landmarks and the current detected gesture label. The status bar should show `WS: ONLINE`.

---

### Step 16 — Access the Local Website

Open your browser and go to:
```
http://localhost:3000
```

You should see the ZENITH DRIVEN login page with the leaderboard on the left.

---

### Step 17 — Verify Full System Operation

Run through this quick check:

- [ ] Login page loads at `http://localhost:3000`
- [ ] You can create a new account
- [ ] You can log in
- [ ] The game starts (click START or press Space)
- [ ] The Python gesture window shows `WS: ONLINE`
- [ ] Point your index finger at the camera — the game countdown starts
- [ ] Hold your palm flat — the car accelerates
- [ ] The leaderboard updates after a completed run

If all of these work, your local setup is complete.

---

## macOS Installation

### Step 1 — Install Homebrew

Homebrew is a package manager for macOS that makes installing developer tools much easier.

Open **Terminal** (find it in Applications → Utilities → Terminal) and run:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Follow the on-screen prompts. This may take several minutes.

After installation, if you're on Apple Silicon (M1/M2), Homebrew installs to `/opt/homebrew`. Run the following to add it to your PATH:

```bash
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
eval "$(/opt/homebrew/bin/brew shellenv)"
```

Verify Homebrew:
```bash
brew --version
```

---

### Step 2 — Install Python

> **Critical for Apple Silicon Mac (M1/M2):** You must install Python **3.12.0** exactly. MediaPipe Model Maker requires tensorflow-text 2.13, which only has an ARM64-compatible wheel for Python 3.12. Other Python versions will fail.

**Apple Silicon (M1/M2):**
```bash
brew install python@3.12
```

After installation, check which Python is active:
```bash
python3 --version
```

If it shows a different version, create an alias:
```bash
echo 'alias python3=/opt/homebrew/bin/python3.12' >> ~/.zprofile
source ~/.zprofile
python3 --version
```

**Intel Mac:**
```bash
brew install python@3.11
```

Verify:
```bash
python3 --version
pip3 --version
```

---

### Step 3 — Install Node.js

```bash
brew install node@20
```

If `node` is not found after installation, add it to PATH:
```bash
echo 'export PATH="/opt/homebrew/opt/node@20/bin:$PATH"' >> ~/.zprofile
source ~/.zprofile
```

Verify:
```bash
node --version
npm --version
```

---

### Step 4 — Install Git

macOS may already have Git. Check first:
```bash
git --version
```

If it's not installed, Homebrew will install it automatically when you run the above command (macOS will prompt you to install Xcode Command Line Tools — click Install).

Or install manually:
```bash
brew install git
```

---

### Step 5 — Install Visual Studio Code

1. Go to [https://code.visualstudio.com/](https://code.visualstudio.com/)
2. Download the **macOS** version
3. Open the downloaded `.zip` file — it extracts `Visual Studio Code.app`
4. Drag `Visual Studio Code.app` to your **Applications** folder
5. Open VS Code, then press `Cmd+Shift+P` and type `Shell Command: Install 'code' command in PATH` — click it. This lets you open VS Code from the terminal with the `code` command.

Install the same extensions as in the Windows section:

```
Python, Pylance, ESLint, Prettier, GitLens, DotENV
```

---

### Step 6 — Install XAMPP

1. Go to [https://www.apachefriends.org/download.html](https://www.apachefriends.org/download.html)
2. Download XAMPP for **macOS**
3. Open the `.dmg` file and follow the installer
4. Launch **XAMPP** from Applications
5. In the XAMPP Manager, click **Start All** or start MySQL individually

Verify MySQL is running:
```bash
/Applications/XAMPP/bin/mysql -u root -p
```
Press Enter when asked for a password (no password by default). Type `exit` to close the MySQL shell.

Access phpMyAdmin:
```
http://localhost/phpmyadmin
```

> **macOS Privacy:** If macOS blocks XAMPP from running, go to System Preferences → Privacy & Security → and click "Open Anyway".

---

### Step 7 — Create Local Database

Same as Windows Step 6. Open phpMyAdmin at `http://localhost/phpmyadmin`, create database `racing_game`, and run the SQL to create tables.

---

### Step 8 — Clone the GitHub Repository

```bash
cd ~/Documents
git clone https://github.com/fafabeepbeep/zenith-driven-racing-game.git
cd zenith-driven-racing-game
```

---

### Step 9 — Install Node.js Dependencies

```bash
npm install
```

---

### Step 10 — Install Python Dependencies

**Create a virtual environment:**
```bash
python3 -m venv venv
```

**Activate it:**
```bash
source venv/bin/activate
```

Your terminal prompt should now show `(venv)` at the start.

**Install Python packages:**
```bash
pip install opencv-python mediapipe websocket-client certifi
```

> **macOS webcam permission:** The first time you run the gesture script, macOS will ask for camera permission. Click **OK** to allow Terminal to access the camera. If you accidentally denied it, go to System Preferences → Privacy & Security → Camera → enable Terminal or your terminal app.

---

### Step 11 — Configure Environment Variables

```bash
touch .env
open -e .env
```

Add the following content:

```env
# Database
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=racing_game
DB_SSL=false

# Authentication
JWT_SECRET=your_very_long_random_secret_key_change_this

# Server
PORT=3000
NODE_ENV=development
```

Save and close.

---

### Step 12 — Add the Gesture Model

```bash
mkdir -p models
# Copy your gestureModel.task file into the models folder
cp /path/to/your/gestureModel.task models/gestureModel.task
```

---

### Step 13 — Start XAMPP Services

Open XAMPP Manager → Start MySQL (and Apache if needed for phpMyAdmin).

---

### Step 14 — Start the Backend Server

```bash
node server.js
```

---

### Step 15 — Start the Python Gesture Controller

Open a **new** terminal tab (`Cmd+T` in Terminal), navigate to the project folder, activate the virtual environment, and run:

```bash
source venv/bin/activate
python3 gestureControl.py --model
```

---

### Step 16 — Access the Local Website

```
http://localhost:3000
```

---

### Step 17 — Verify Full System Operation

Same checklist as Windows Step 17.

---

# Part C — Gesture Model Training Pipeline

This section explains how to collect your own hand gesture images and train the custom gesture recognition model used by `gestureControl.py`.

> **Why Google Colab?** Training requires TensorFlow 2.13 and `mediapipe-model-maker`. On Apple Silicon Macs, the required `tensorflow-text` package has no ARM64-compatible wheel, making local training impossible on M1/M2. Google Colab provides a free cloud GPU environment that works on any operating system.

---

## Dataset Structure

Your dataset must follow this exact folder structure:

```
dataset/
├── START/
│   ├── START_000001.jpg
│   ├── START_000002.jpg
│   └── ... (minimum 80, recommended 200+)
├── FORWARD/
├── BRAKE/
├── LEFT/
├── RIGHT/
├── REVERSE/
├── BALANCE/
└── NONE/
    └── ... (random non-gesture poses — hard negatives)
```

**Rules:**
- Each folder name is the class label — it must exactly match the `GESTURE_DISPLAY` constants in `main.js`
- `NONE` is the "no gesture / random hand" class — include hands in unusual positions, resting hands, and partial hands
- File names can be anything — the model only uses the folder name as the label
- Images must be `.jpg` or `.png`
- Do NOT flip/mirror images during collection — `gestureDatasetCollector.py` captures raw unflipped frames deliberately to match the inference pipeline

---

## Step 1 — Collect Dataset Images

Run the dataset collector script while your virtual environment is active:

```bash
# Windows
venv\Scripts\activate
python gestureDatasetCollector.py

# macOS/Linux
source venv/bin/activate
python3 gestureDatasetCollector.py
```

The script opens a webcam window. Use these keyboard shortcuts to capture images:

| Key | Gesture class | Target images |
|---|---|---|
| `S` | START | 200+ |
| `F` | FORWARD | 200+ |
| `B` | BRAKE | 200+ |
| `L` | LEFT | 200+ |
| `R` | RIGHT | 200+ |
| `E` | REVERSE | 200+ |
| `A` | BALANCE | 200+ |
| `N` | NONE | 200+ |
| `Q` | Quit | — |
| `Delete` / `Backspace` | Delete last 5 images for current class | — |

**Tips for good images:**
- Vary your distance from the camera (30–70 cm)
- Vary the angle — tilt your hand slightly left, right, up, down
- Try different lighting (bright room, darker room)
- Try different backgrounds
- Include both "perfect" poses and slightly imperfect variations

---

## Step 2 — Compress Dataset for Upload

After collection, compress the `dataset` folder into a ZIP file:

```bash
# Windows (PowerShell)
Compress-Archive -Path dataset -DestinationPath dataset.zip

# macOS/Linux
zip -r dataset.zip dataset/
```

---

## Step 3 — Google Colab Setup

1. Go to [https://colab.research.google.com/](https://colab.research.google.com/)
2. Sign in with your Google account
3. Click **New Notebook**
4. Click **Runtime** → **Change runtime type** → set Hardware Accelerator to **GPU** (T4 recommended) → **Save**

---

## Step 4 — Upload Dataset to Colab

In your Colab notebook, run this cell to mount Google Drive (optional but recommended for saving the model):

```python
from google.colab import drive
drive.mount('/content/drive')
```

Or upload the dataset ZIP directly using the Files panel on the left sidebar → Upload.

Then unzip it:
```python
import zipfile
with zipfile.ZipFile('/content/dataset.zip', 'r') as z:
    z.extractall('/content/')
```

Verify the structure:
```python
import os
for cls in sorted(os.listdir('/content/dataset')):
    count = len(os.listdir(f'/content/dataset/{cls}'))
    print(f'{cls}: {count} images')
```

---

## Step 5 — Install Libraries in Colab

```python
!pip install mediapipe-model-maker
!pip install tensorflow==2.13.*
```

This installs into the Colab environment. You do not need to install anything on your own machine for this step.

---

## Step 6 — Upload the Training Script

Upload `gestureModelTrainer.py` to Colab using the Files panel, or paste the training code directly into a cell.

Alternatively, run the training inline with the following code:

```python
import os
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python.vision import GestureRecognizer
from mediapipe_model_maker import gesture_recognizer

# ── Config ──────────────────────────────────────────────────────────────────
DATASET_DIR    = '/content/dataset'
MODEL_OUTPUT   = '/content/gestureModel.task'
TRAIN_EPOCHS   = 50
BATCH_SIZE     = 32
LEARNING_RATE  = 0.001
DROPOUT_RATE   = 0.05
HIDDEN_LAYERS  = [128, 64]

# ── Load dataset ─────────────────────────────────────────────────────────────
print("Loading dataset...")
data = gesture_recognizer.Dataset.from_folder(
    dirname=DATASET_DIR,
    hparams=gesture_recognizer.HandDataPreprocessingParams()
)

# ── Split into train / validation ─────────────────────────────────────────────
train_data, val_data = data.split(0.8)
print(f"Training samples: {len(train_data)}, Validation samples: {len(val_data)}")

# ── Train ─────────────────────────────────────────────────────────────────────
print("Training model (this takes several minutes)...")
options = gesture_recognizer.GestureRecognizerOptions(
    model_options=gesture_recognizer.ModelOptions(
        dropout_rate=DROPOUT_RATE,
        layer_widths=HIDDEN_LAYERS
    ),
    hparams=gesture_recognizer.HParams(
        epochs=TRAIN_EPOCHS,
        batch_size=BATCH_SIZE,
        learning_rate=LEARNING_RATE,
        export_dir='/content/gesture_model_export'
    )
)
model = gesture_recognizer.GestureRecognizer.create(
    train_data=train_data,
    validation_data=val_data,
    options=options
)

# ── Evaluate ─────────────────────────────────────────────────────────────────
loss, acc = model.evaluate(val_data, batch_size=BATCH_SIZE)
print(f"Validation accuracy: {acc * 100:.1f}%  |  Loss: {loss:.4f}")

# ── Export ───────────────────────────────────────────────────────────────────
model.export_model(MODEL_OUTPUT)
print(f"Model saved to: {MODEL_OUTPUT}")
```

---

## Step 7 — Download the Trained Model

After training, download `gestureModel.task` from Colab:

```python
from google.colab import files
files.download('/content/gestureModel.task')
```

The file will be saved to your computer's Downloads folder.

---

## Step 8 — Integrate the Model into the Project

1. Move `gestureModel.task` into your project's `models` folder:

```bash
# Windows
move %USERPROFILE%\Downloads\gestureModel.task models\gestureModel.task

# macOS
mv ~/Downloads/gestureModel.task models/gestureModel.task
```

2. Verify it loads:

```bash
# Windows
venv\Scripts\activate
python gestureControl.py --model

# macOS
source venv/bin/activate
python3 gestureControl.py --model
```

The terminal should print:
```
[ML] Model loaded: models/gestureModel.task
```

The webcam window should open and start showing gesture labels.

---

# Part D — Localhost Database (XAMPP)

## Database Structure

The project uses two tables:

**`users` table** — stores registered player accounts

| Column | Type | Notes |
|---|---|---|
| `id` | INT AUTO_INCREMENT | Primary key |
| `username` | VARCHAR(50) UNIQUE | Must be unique — duplicate registration rejected with 409 error |
| `password_hash` | VARCHAR(255) | bcrypt hash — plaintext is never stored |
| `created_at` | TIMESTAMP | Set automatically |

**`leaderboard` table** — stores every game session

| Column | Type | Notes |
|---|---|---|
| `id` | INT AUTO_INCREMENT | Primary key |
| `user_id` | INT FK | Links to users.id — row deleted if user deleted |
| `username` | VARCHAR(50) | Stored here for fast reads without JOIN |
| `time_completed` | FLOAT NULL | Total seconds for a completed run — NULL if unfinished |
| `levels_completed` | TINYINT | 0, 1, or 2 |
| `status` | ENUM | `'Completed'` or `'Game Unfinished'` |
| `created_at` | TIMESTAMP | Set automatically |

## Authentication and JWT Flow

1. Player submits username + password to `POST /api/register`
2. Server hashes password with bcrypt (10 salt rounds) and stores in `users`
3. Player submits credentials to `POST /api/login`
4. Server verifies password against stored hash using bcrypt.compare
5. If correct, server signs a **JSON Web Token (JWT)** using `JWT_SECRET` from `.env` — token is valid for 8 hours
6. Token is returned to the browser and stored in `sessionStorage`
7. All future API calls include the token in the `Authorization: Bearer <token>` header
8. The `requireAuth` middleware on protected endpoints verifies the token signature before allowing the request

## Bootstrap Table Initialization

You do not need to create tables manually if you are using the production flow. When `server.js` starts for the first time, `db.js` automatically runs `CREATE TABLE IF NOT EXISTS` for both tables. This means:

- **First startup:** tables are created
- **Subsequent startups:** the `IF NOT EXISTS` clause skips creation — existing data is preserved

The bootstrap function also retries the database connection up to 5 times with exponential backoff (1s, 2s, 4s, 8s, 16s) to handle slow database startup on cloud instances.

## Verification Steps

After starting the server:

1. Open phpMyAdmin: `http://localhost/phpmyadmin`
2. Click on `racing_game` database
3. You should see `users` and `leaderboard` tables in the left sidebar
4. Register a new account at `http://localhost:3000`
5. Go back to phpMyAdmin → `users` table → click **Browse** — you should see a new row with the username and a hashed password starting with `$2b$10$`

---

# Part E — Cloud Database Migration (Aiven)

Aiven provides a hosted MySQL database. This is what the production version of the game uses instead of your local XAMPP database. You need this when deploying to Render.

## Step 1 — Create an Aiven Account

1. Go to [https://aiven.io/](https://aiven.io/)
2. Click **Start free** and sign up with your email
3. Verify your email address

## Step 2 — Create a MySQL Service

1. Click **Create service**
2. Choose **MySQL**
3. Select the **Free** plan (labeled "Hobbyist" or "Free tier")
4. Choose the closest region to you
5. Give the service a name, for example `zenith-driven-mysql`
6. Click **Create service** — this takes 1–2 minutes to provision

## Step 3 — Obtain Connection Details

Once the service is running:

1. Click on your service name
2. Go to the **Overview** tab
3. Look for the **Connection information** panel — click **Show password**
4. Note down these values:

```
Host:     your-service.aivencloud.com
Port:     12345 (Aiven uses a non-standard port)
Database: defaultdb  (or the name you chose)
User:     avnadmin
Password: (shown when you click "Show password")
```

5. Click **Download CA certificate** — this downloads `ca.pem`
6. Place `ca.pem` in your **project root folder** (same folder as `server.js`):

```
zenith-driven-racing-game/
├── server.js
├── ca.pem          ← put it here
├── .env
└── ...
```

## Step 4 — Update Environment Variables

Edit your `.env` file and replace the local database values with the Aiven values:

```env
# Database — Aiven cloud
DB_HOST=your-service.aivencloud.com
DB_PORT=12345
DB_USER=avnadmin
DB_PASSWORD=your_aiven_password_here
DB_NAME=defaultdb
DB_SSL=true

# Authentication (keep the same)
JWT_SECRET=your_very_long_random_secret_key_change_this

# Server
PORT=3000
NODE_ENV=development
```

## Step 5 — Test the Connection

Restart the server:

```bash
# Press Ctrl+C to stop the current server, then:
node server.js
```

Watch the terminal output. You should see:
```
[DB] SSL enabled with CA certificate.
[DB] Database "defaultdb" ready.
```

If you see a connection error, check that:
- The host, port, username, and password are exact (no extra spaces)
- `ca.pem` is in the project root folder
- `DB_SSL=true` is set in `.env`

## Troubleshooting Aiven

| Problem | Solution |
|---|---|
| `ECONNREFUSED` | Wrong port number — check the Aiven dashboard |
| `SSL connection error` | `ca.pem` is missing or in the wrong folder |
| `Access denied for user` | Wrong username or password |
| `Unknown database` | Wrong `DB_NAME` — use `defaultdb` unless you created a different one |

---

# Part F — Render Deployment

Render hosts the Node.js server and serves the game website to the internet. Once deployed, anyone in the world can access the game at your Render URL.

## Step 1 — Create a Render Account

1. Go to [https://render.com/](https://render.com/)
2. Click **Get Started** and sign up (you can sign up with your GitHub account — recommended)

## Step 2 — Connect Your GitHub Repository

1. After signing in, go to your **Dashboard**
2. Click **New** → **Web Service**
3. Click **Connect account** under GitHub if you haven't already — authorize Render to access your repositories
4. Find `zenith-driven-racing-game` in the list and click **Connect**

## Step 3 — Configure the Web Service

Fill in the settings:

| Setting | Value |
|---|---|
| **Name** | `zenith-driven-racing-game` (or anything you like) |
| **Region** | Choose the closest to your users |
| **Branch** | `main` |
| **Root Directory** | Leave blank |
| **Runtime** | `Node` |
| **Build Command** | `npm install` |
| **Start Command** | `node server.js` |
| **Plan** | Free |

## Step 4 — Configure Environment Variables

Scroll down to the **Environment Variables** section and add each variable separately:

| Key | Value |
|---|---|
| `DB_HOST` | Your Aiven host (e.g. `your-service.aivencloud.com`) |
| `DB_PORT` | Your Aiven port (e.g. `12345`) |
| `DB_USER` | `avnadmin` |
| `DB_PASSWORD` | Your Aiven password |
| `DB_NAME` | `defaultdb` |
| `DB_SSL` | `true` |
| `JWT_SECRET` | Your long random secret key |
| `NODE_ENV` | `production` |
| `PORT` | `10000` (Render assigns a port automatically but you can set this) |

> **What about `ca.pem`?** You cannot upload `ca.pem` to Render as a file. Instead, set `DB_SSL=true` and leave `ca.pem` absent — `db.js` will fall back to SSL without certificate verification (`rejectUnauthorized: false`) which is less secure but works. For production grade security, consider using Render's secret file feature or encoding the certificate as an environment variable.

## Step 5 — Deploy the Application

1. Click **Create Web Service**
2. Render will begin the build process — you can watch the logs in real time
3. The build runs `npm install` to install dependencies
4. Then it runs `node server.js` to start the server
5. When the status shows **Live**, your deployment is successful

Your game is now accessible at:
```
https://your-service-name.onrender.com
```

## Step 6 — Verify the Deployment

1. Open the URL in your browser — you should see the login page
2. Create an account and log in
3. Start `gestureControl.py` with the Render server URL:

```bash
python3 gestureControl.py --model --server wss://your-service-name.onrender.com/gesture
```

4. Play the game — verify gestures work

> **Free tier cold start:** On Render's free plan, the server goes to sleep after 15 minutes of inactivity. The first visit after inactivity may take 30–60 seconds to load. This is normal. You can use a service like [UptimeRobot](https://uptimerobot.com/) to ping `/api/health` every 5 minutes to keep it awake.

---

# Part G — GitHub Workflow

## Clone the Repository

**Windows:**
```cmd
git clone https://github.com/fafabeepbeep/zenith-driven-racing-game.git
cd zenith-driven-racing-game
```

**macOS:**
```bash
git clone https://github.com/fafabeepbeep/zenith-driven-racing-game.git
cd zenith-driven-racing-game
```

## Create a New Branch

Always work on a separate branch — never commit directly to `main`.

```bash
git checkout -b feature/your-feature-name
```

Example:
```bash
git checkout -b feature/add-level-3
```

## Make Changes

Edit your files in VS Code. When you're ready to save your progress:

## Check What Changed

```bash
git status
```

This shows which files you've modified. Files in red have changes not yet staged for commit.

## Stage Your Changes

```bash
# Stage a specific file
git add main.js

# Stage all changed files
git add .
```

## Commit Your Changes

```bash
git commit -m "Brief description of what you changed"
```

Good commit message examples:
- `"Add Level 3 road geometry"`
- `"Fix BALANCE gesture detection threshold"`
- `"Update leaderboard to show top 50 entries"`

## Push to GitHub

```bash
git push origin feature/your-feature-name
```

The first time you push a new branch, Git will ask you to set the upstream — just follow the instruction it prints.

## Create a Pull Request

1. Go to `https://github.com/fafabeepbeep/zenith-driven-racing-game`
2. You should see a yellow banner saying your branch was recently pushed — click **Compare & pull request**
3. Add a title and description explaining your changes
4. Click **Create pull request**

## Merge Changes

If you are the only developer and ready to merge:

1. On the Pull Request page, click **Merge pull request**
2. Click **Confirm merge**
3. Click **Delete branch** to clean up

## Update Your Local Main Branch

After merging, update your local copy:

```bash
git checkout main
git pull origin main
```

---

# Part H — GitHub to Render Automatic Deployment

## How It Works

Render monitors your GitHub repository's `main` branch. Every time you push a commit to `main` (either directly or by merging a pull request), Render:

1. Detects the new commit within a few seconds
2. Automatically pulls the latest code
3. Runs the build command (`npm install`)
4. Restarts the server with the new code

This means **you never need to manually trigger a deployment** — just push to `main` and Render handles the rest.

## Step-by-Step: Deploying an Update

```bash
# 1. Make your changes locally
# 2. Stage and commit
git checkout -b feature-name
git add .
git commit -m "Update leaderboard styling"

# 3. Push to main
git push origin main
```

Render detects the push and starts a new deployment automatically.

## Verify Deployment Status

1. Go to [https://dashboard.render.com/](https://dashboard.render.com/)
2. Click on your service
3. Click the **Events** or **Logs** tab
4. You will see entries like:
   - `Deploy started for commit abc1234`
   - `Build successful`
   - `Deploy live for commit abc1234`

The deployment usually takes 1–3 minutes.

## Rollback to a Previous Version

If a deployment breaks something:

1. Go to your Render dashboard → your service → **Events** tab
2. Find a previous successful deployment
3. Click the **...** menu next to it → **Rollback to this deploy**

Render will revert to that version immediately.

Alternatively, revert in Git and push:

```bash
# Find the commit hash you want to revert to
git log --oneline

# Revert to that commit
git revert <commit-hash>
git push origin main
```

---

# Part I — Moving the Project to Another Computer

## What You Need to Transfer

| Item | Where to get it | Notes |
|---|---|---|
| Source code | GitHub — just clone | No need to copy files manually |
| `.env` file | Copy manually — it is NOT on GitHub | Contains your secrets |
| `ca.pem` file | Download fresh from Aiven | Or copy from old computer |
| `models/gestureModel.task` | Copy manually — NOT on GitHub | Or retrain from scratch |
| `dataset/` folder | Copy manually — NOT on GitHub (large) | Only needed if retraining |

## Windows to Windows

On the new computer:

1. Install Python, Node.js, Git, XAMPP — follow [Part B Windows Installation](#windows-installation)
2. Clone the repository:
   ```cmd
   git clone https://github.com/fafabeepbeep/zenith-driven-racing-game.git
   cd zenith-driven-racing-game
   ```
3. Copy your `.env` file from the old computer to the new project root
4. Copy `ca.pem` from the old computer (or re-download from Aiven)
5. Copy `models/gestureModel.task` from the old computer
6. Run `npm install`
7. Create and activate a virtual environment:
   ```cmd
   python -m venv venv
   venv\Scripts\activate
   pip install opencv-python mediapipe websocket-client certifi
   ```
8. Start the server and Python script — done

## Mac to Mac

1. Install Homebrew, Python 3.12, Node.js, Git — follow [Part B macOS Installation](#macos-installation)
2. Clone the repository
3. Copy `.env`, `ca.pem`, and `models/gestureModel.task` from the old Mac using AirDrop or a USB drive
4. Run `npm install`
5. Create and activate virtual environment:
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   pip install opencv-python mediapipe websocket-client certifi
   ```
6. Start — done

## Windows to Mac

Same as Mac to Mac, but transfer files using a USB drive, cloud storage (Google Drive, OneDrive), or email.

> **Note:** The virtual environment folder (`venv/`) is NOT transferable between operating systems. You must always create a new `venv` on the new machine and reinstall the Python packages.

## Mac to Windows

Same as Windows to Windows. Transfer `.env`, `ca.pem`, and `gestureModel.task` manually. Create a new `venv` on Windows and reinstall.

## Verification After Transfer

Run through the [Part K Localhost Checklist](#localhost-mode) to confirm everything works on the new computer.

---

# Part J — Troubleshooting Guide

## Python Issues

| Symptom | Cause | Solution |
|---|---|---|
| `python` is not recognized as a command | Python not added to PATH during installation | Uninstall Python, reinstall, and tick "Add Python to PATH" checkbox |
| `python3: command not found` (macOS) | Python not installed via Homebrew | `brew install python@3.12` |
| `ModuleNotFoundError: No module named 'cv2'` | Packages installed outside virtual environment, or venv not activated | Activate venv first: `source venv/bin/activate` (mac) or `venv\Scripts\activate` (win) then `pip install opencv-python` |
| `ModuleNotFoundError: No module named 'mediapipe'` | MediaPipe not installed | `pip install mediapipe` inside activated venv |
| `ModuleNotFoundError: No module named 'websocket'` | websocket-client not installed | `pip install websocket-client` |
| Python version mismatch on Apple Silicon | Wrong Python version | Use exactly Python 3.12.0 — `brew install python@3.12` |
| `SSL: CERTIFICATE_VERIFY_FAILED` on macOS when running gestureControl.py | macOS Python certificate issue | Run `/Applications/Python\ 3.x/Install\ Certificates.command` or `pip install certifi` |

## Webcam Issues

| Symptom | Cause | Solution |
|---|---|---|
| Webcam window opens but is black | Camera permission denied | macOS: System Preferences → Privacy → Camera → enable Terminal. Windows: Settings → Privacy → Camera → allow apps |
| `cv2.VideoCapture(0)` fails | Wrong camera index or camera in use | Try `--camera 1` flag: `python gestureControl.py --camera 1`. Close other apps using the camera (Zoom, Teams, etc.) |
| Camera opens but shows wrong device | Multiple cameras connected | Try different index values: `--camera 0`, `--camera 1`, `--camera 2` |
| Webcam permission repeatedly denied on macOS | System-level block | Go to System Preferences → Privacy & Security → Camera → add or re-enable Terminal |

## Gesture Model Issues

| Symptom | Cause | Solution |
|---|---|---|
| `[WARN] Model file not found at models/gestureModel.task` | Model file missing or wrong path | Verify file exists at `models/gestureModel.task` relative to where you run the script |
| `Error initializing gesture recognizer` | Corrupted model file or wrong TensorFlow version | Re-export the model from Colab with a fresh session |
| Model always predicts `NONE` | Poor dataset — too few images or poor variety | Collect more images (200+ per class) with varied lighting, angles, distances |
| Model confuses FORWARD and BALANCE | Geometric similarity between the two poses | Collect more distinct images for each class. Ensure FORWARD images have clear forward motion, BALANCE images are clearly stationary |
| Script runs but `--model` flag is ignored | Old cached model or wrong flag | Verify you're typing `--model` exactly; check `USE_ML_MODEL` prints `True` in terminal |

## npm Install Failures

| Symptom | Cause | Solution |
|---|---|---|
| `npm: command not found` | Node.js not installed or not in PATH | Install Node.js from nodejs.org, open a new terminal |
| `ENOENT: no such file or directory, open 'package.json'` | You are not in the project root folder | `cd zenith-driven-racing-game` first |
| `EACCES: permission denied` (macOS) | npm trying to write to system folders | Never use `sudo npm install`. Fix npm permissions: `npm config set prefix ~/.npm-global` |
| `node-gyp` build errors with `bcrypt` | Missing native build tools | Windows: `npm install --global windows-build-tools`. macOS: `xcode-select --install` |
| Packages install but server crashes on start | Incomplete install | Delete `node_modules` folder and run `npm install` again |

## Node.js Startup Errors

| Symptom | Cause | Solution |
|---|---|---|
| `Error: listen EADDRINUSE :::3000` | Port 3000 is already in use | Kill the other process: Windows: `netstat -ano | findstr :3000` then `taskkill /PID <number> /F`. macOS: `lsof -ti:3000 | xargs kill -9` |
| `Cannot find module './db'` | db.js is missing | Make sure you cloned the full repository — `db.js` should be in the root |
| `JWT_SECRET is not set` warning | .env file missing or not loaded | Verify `.env` exists in project root and contains `JWT_SECRET=...` |
| Server starts but immediately crashes | Syntax error in code | Read the error message carefully — it shows the file name and line number |

## WebSocket Connection Failures

| Symptom | Cause | Solution |
|---|---|---|
| Python script shows `WS: OFFLINE` | Server is not running, or wrong URL | Start `node server.js` first. Verify URL matches: `ws://localhost:3000/gesture` for local, `wss://your-app.onrender.com/gesture` for production |
| `SSL: CERTIFICATE_VERIFY_FAILED` (macOS, production) | macOS certificate bundle issue | `pip install certifi` inside venv. The script uses certifi by default |
| Game shows gesture as `NONE` always | WebSocket connected but game not receiving | Check browser console (F12) for WebSocket errors. Refresh the game page |
| `WebSocket connection to 'ws://...' failed` in browser | Server not running or wrong port | Confirm `node server.js` is running and showing port 3000 |

## JWT Authentication Failures

| Symptom | Cause | Solution |
|---|---|---|
| `Invalid or expired token` | Token has expired (8 hour limit) | Log out and log back in |
| `No token provided` | sessionStorage was cleared | This happens if you open the game in a private/incognito window between page loads — log in again |
| All logins rejected | `JWT_SECRET` changed between sessions | Old tokens become invalid when `JWT_SECRET` changes. Clear browser sessionStorage and log in again |
| Register succeeds but login fails | Database not saving properly | Check XAMPP MySQL is running. Verify `users` table exists in phpMyAdmin |

## XAMPP Issues

| Symptom | Cause | Solution |
|---|---|---|
| Apache won't start (port 80 blocked) | Another service using port 80 | Change Apache port to 8080 in XAMPP config. Or stop IIS (Windows): `net stop w3svc` |
| MySQL won't start (port 3306 blocked) | Another MySQL running | Stop the other MySQL service. Or change XAMPP MySQL port to 3307 |
| phpMyAdmin shows `Access denied for user 'root'` | Root password set | Enter the password, or reset it via XAMPP shell |
| `Can't connect to MySQL server` in Node.js | MySQL not running | Open XAMPP Control Panel and start MySQL |

## MySQL Connection Errors

| Symptom | Cause | Solution |
|---|---|---|
| `ECONNREFUSED 127.0.0.1:3306` | MySQL not running | Start MySQL in XAMPP |
| `ER_ACCESS_DENIED_ERROR` | Wrong username or password in `.env` | Check `DB_USER` and `DB_PASSWORD` in `.env` |
| `ER_BAD_DB_ERROR: Unknown database 'racing_game'` | Database not created | Open phpMyAdmin and create the database manually |
| Tables missing on startup | Bootstrap failed silently | Check server logs for `[DB] Schema setup failed`. Fix the DB connection first |

## Aiven Connection Errors

| Symptom | Cause | Solution |
|---|---|---|
| `ECONNREFUSED` | Wrong host or port | Copy host and port exactly from Aiven dashboard |
| `HANDSHAKE_SSL_ERROR` | SSL config wrong | Ensure `DB_SSL=true` and `ca.pem` is in project root |
| `Access denied for user 'avnadmin'` | Wrong password | Re-copy password from Aiven dashboard — it contains special characters |
| Connection works locally but fails on Render | `ca.pem` not available on Render | Set `DB_SSL=true` without `ca.pem` — db.js falls back to `rejectUnauthorized: false` automatically |
| Connection times out | Aiven service paused (free tier) | Log into Aiven dashboard and resume/unpause the service |

## Render Deployment Failures

| Symptom | Cause | Solution |
|---|---|---|
| Build fails with `npm install` error | Dependency conflict or package error | Check build logs — usually a specific package is the issue. Update `package.json` |
| Deploy succeeds but site shows error page | Environment variables missing | Check all env vars are set in Render dashboard → Environment |
| `Cannot connect to database` in server logs | Aiven credentials wrong on Render | Re-enter all DB_ variables in Render environment settings |
| Game loads but WebSocket fails | Wrong WebSocket URL in game code | The game auto-detects WSS URL from `location.host` — no manual URL needed |
| Cold start takes too long | Free tier sleep | Use UptimeRobot to ping `/api/health` every 5 minutes |

## GitHub Sync Issues

| Symptom | Cause | Solution |
|---|---|---|
| `Permission denied (publickey)` | SSH key not set up | Use HTTPS clone URL instead: `https://github.com/...` |
| `Updates were rejected because the tip of your current branch is behind` | Local is behind remote | `git pull origin main` first, resolve conflicts, then push |
| Merge conflicts | Two people edited the same line | Open the conflicting file, look for `<<<<<<`, choose which version to keep, `git add`, `git commit` |
| `.env` was accidentally committed | `.gitignore` missing `.env` | Add `.env` to `.gitignore`, then: `git rm --cached .env`, commit, push |
| `ca.pem` was accidentally committed | `.gitignore` missing `ca.pem` | Same as above — `git rm --cached ca.pem` |

---

# Part K — System Startup Checklist

## Localhost Mode

Use this checklist every time you want to run the full system on your own computer.

### Before you start
- [ ] You have XAMPP installed
- [ ] You have created the `racing_game` database
- [ ] Your `.env` file exists in the project root with `DB_HOST=localhost`
- [ ] Your `models/gestureModel.task` file is in the `models/` folder
- [ ] Your Python virtual environment has `opencv-python`, `mediapipe`, `websocket-client`, `certifi` installed

### Startup sequence

```
① XAMPP Control Panel
    → Start MySQL (wait for green)
    → Start Apache (only needed for phpMyAdmin)

② Terminal 1 — Backend server
    cd zenith-driven-racing-game
    node server.js
    ✓ Wait until you see: "ZENITH DRIVEN — Server  Listening → http://localhost:3000"

③ Terminal 2 — Python gesture controller
    cd zenith-driven-racing-game
    source venv/bin/activate     (macOS)
    venv\Scripts\activate        (Windows)
    python3 gestureControl.py --model
    ✓ Wait until webcam window opens and shows "WS: ONLINE"

④ Browser
    Open: http://localhost:3000
    ✓ Login page should load

⑤ Verify gesture detection
    → Log in and start the game
    → Point index finger at camera
    → Countdown should begin (3 → 2 → 1 → GO!)
```

### Quick stop
- Press `Ctrl+C` in Terminal 1 to stop the server
- Press `Q` in the Python webcam window (or `Ctrl+C` in Terminal 2) to stop the gesture script
- XAMPP: click Stop next to MySQL

---

## Production Mode

Use this checklist when you want to play the live deployed version.

### Before you start
- [ ] The Render service is deployed and showing status **Live** on the Render dashboard
- [ ] The Aiven MySQL service is running (not paused)
- [ ] Your local Python virtual environment is set up

### Startup sequence

```
① Check Render is online
    → Open: https://your-app.onrender.com/api/health
    → Should return: {"ok":true,"env":"production"}
    → If it takes 30+ seconds, the server was sleeping (free tier) — wait for it

② Terminal — Python gesture controller
    cd zenith-driven-racing-game
    source venv/bin/activate     (macOS)
    venv\Scripts\activate        (Windows)
    python3 gestureControl.py --model --server wss://your-app.onrender.com/gesture
    ✓ Wait until: "WS: ONLINE" appears in the webcam window

③ Browser
    Open: https://your-app.onrender.com
    → Log in (or create a new account)

④ Start the game
    → Perform START gesture (point index finger at camera)
    → Countdown begins

⑤ Verify full system
    → FORWARD gesture (palm down) → car accelerates
    → BRAKE gesture (open palm toward camera) → car slows
    → LEFT / RIGHT gestures → car steers
    → Finish both levels → leaderboard saves and updates
```

### If gestures are not working
1. Check the Python window shows `WS: ONLINE` (not `OFFLINE`)
2. Check the game HUD shows your current gesture name changing in real time
3. If the gesture name is stuck on `NONE`, check lighting and hand positioning
4. Check you are running with the `--model` flag for the trained ML model

---

## .gitignore Reference

Make sure your `.gitignore` file includes at minimum:

```gitignore
# Never commit these
.env
ca.pem
node_modules/
venv/
__pycache__/
*.pyc
models/gestureModel.task
dataset/

# OS files
.DS_Store
Thumbs.db
```

---
