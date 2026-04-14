# 🚀 ZENITH DRIVEN — Setup & Project Guide (FINAL)

---

## ⚙️ Setup Instructions (Step-by-Step)

---

### 1. XAMPP (MySQL)

* Open XAMPP Control Panel
* Start **Apache** and **MySQL**
* Database is auto-created by `db.js`

**Default credentials:**

```
host=localhost
user=root
password=
```

If you use a password, create `.env` in project root:

```
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=yourpassword
DB_NAME=racing_game
JWT_SECRET=pick_a_long_random_string
```
To check databases: View data
phpMyAdmin → http://localhost/phpmyadmin
---

### 2. Python Virtual Environment (IMPORTANT ⚠️)

#### Create venv (first time only)

```bash
python3 -m venv venv
```

---

### ▶️ Activate venv

**Mac / Linux:**

```bash
source venv/bin/activate
```

**Windows:**

```bash
venv\Scripts\activate
```

---

### ⛔ Deactivate venv

```bash
deactivate
```

---

## 3. Install Python Dependencies

⚠️ Must be inside activated venv

```bash
pip install mediapipe opencv-python websocket-client
```

---

## 4. Node.js Backend

Run in a separate terminal:

```bash
npm install
node server.js
```

Expected output:

```
[SERVER] API → http://localhost:3000
[SERVER] WebSocket relay → ws://localhost:8765
```

---

## 5. Python Gesture Control

Run in another terminal (venv active):

```bash
python3 gestureControl.py
```

Expected:

```
Connected to WebSocket server
```

---

## ⚠️ IMPORTANT RUN ORDER

You MUST run in this order:

1. XAMPP (MySQL ON)
2. Node.js server
3. Python gesture system
4. Open browser

---

## 6. Frontend (Game Launch)

DO NOT open using `file://`

Use:

```bash
npx serve .
```

Then open:

```
http://localhost:3000/index.html
```

---

# 🚀 Project Overview

## System Architecture

```
Python (MediaPipe Gesture Detection)
        ↓
WebSocket (ws://localhost:8765)
        ↓
Node.js (server.js relay)
        ↓
Phaser Game (main.js)
```

---

## 🎮 Core Gameplay Flow

1. Login / Register
2. Start Screen ("ZENITH DRIVEN")
3. Gesture START → Begin Game
4. Countdown (3 → 2 → 1 → GO)
5. Gameplay
6. Level Progression (3 levels)
7. Leaderboard update

---

## 🎯 Key Features

### 🎮 Gameplay

* 3-level racing system
* Traffic AI + collision system
* Off-track grass penalty (70% speed reduction)
* Game over countdown when off-track too long

---

### 🎨 UI System

* Pause button fixed top-right
* Username display aligned properly
* Pause / Resume toggle icons
* Quit system with logout message

---

### 🧠 Levels

| Level | Name           | Base Scene      |
| ----- | -------------- | --------------- |
| 1     | Open Road      | current level 2 |
| 2     | Speed Demon    | current level 4 |
| 3     | Apex Challenge | current level 6 |

---

### 🏆 Leaderboard

* Top 3 highlighted (Gold / Silver / Bronze)
* Others normal style
* Tracks completed + unfinished runs

---

### 🧍 Gesture Control (MediaPipe)

System uses **RIGHT HAND ONLY**

| Gesture      | Action  |
| ------------ | ------- |
| Index finger | START   |
| Palm down    | FORWARD |
| Fist         | REVERSE |
| Open palm    | BRAKE   |
| Left tilt    | LEFT    |
| Right tilt   | RIGHT   |
| Static palm  | BALANCE |

---

# 🚀 GitHub Setup & Push Instructions

## 🆕 Create New Repository

```bash
echo "# zenith-driven-racing-game" >> README.md
git init
git add README.md
git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/fafabeepbeep/zenith-driven-racing-game.git
git push -u origin main
```

---

## 📤 Push Existing Project

```bash
git remote add origin https://github.com/fafabeepbeep/zenith-driven-racing-game.git
git branch -M main
git push -u origin main
```

---

# 📌 README (PROJECT OVERVIEW)

## 📌 Overview

This project is developed using VS Code and managed with Git for version control.

---

## ⚙️ Setup Instructions

### Clone Repository

```bash
git clone https://github.com/your-username/your-repo.git
cd your-repo
```

---

### Install Dependencies

```bash
npm install
```

or

```bash
pip install -r requirements.txt
```

---

## 🚀 Running the Project

```bash
node server.js
```

or

```bash
python app.py
```

---

## 🌿 Git Workflow (IMPORTANT)

❗ DO NOT PUSH DIRECTLY TO MAIN

### Steps:

```bash
git checkout main
git pull origin main
git checkout -b feature-name
git add .
git commit -m "describe changes"
git push origin feature-name
```

Then create a Pull Request on GitHub.

---

## 📛 Branch Naming Convention

* feature/feature-name
* fix/bug-name
* update/version-name

---

## 🛡️ Best Practices

* Never push directly to main
* Always pull latest changes first
* Use meaningful commit messages
* Delete branches after merging

---

## 👨‍💻 Tech Stack

* Node.js
* Python (MediaPipe)
* Phaser.js
* MySQL (XAMPP)
* Git & GitHub
* VS Code

---

## 📬 Contact

fafabeepbeep – [fareehahj@gmail.com](mailto:fareehahj@gmail.com)

