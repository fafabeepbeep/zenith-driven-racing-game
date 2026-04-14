// server.js
// ─────────────────────────────────────────────────────────────
//  Single process:
//    • Express REST API  (auth + leaderboard)   → port 3000
//    • WebSocket relay   (Python → Game)        → port 8765
//
//  Install:
//    npm install express mysql2 bcrypt jsonwebtoken cors ws dotenv
//
//  Run gesture:   python gestureControl.py
// ─────────────────────────────────────────────────────────────

require('dotenv').config();

const express   = require('express');
const cors      = require('cors');
const bcrypt    = require('bcrypt');
const jwt       = require('jsonwebtoken');
const WebSocket = require('ws');
const http      = require('http');
const path      = require('path');
const pool      = require('./db');

const app         = express();
const JWT_SECRET  = process.env.JWT_SECRET || 'change_me_in_production';
const SALT_ROUNDS = 10;

// ── Middleware ────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ── FIX: Serve frontend static files from /src ───────────────
// game.html, index.html, JS files and assets all live in ./src
app.use(express.static(path.join(__dirname, 'src')));

// ── Request logger (debug) ────────────────────────────────────
app.use((req, _res, next) => {
  console.log(`[API] ${req.method} ${req.path}`);
  next();
});

// ── Auth helper ───────────────────────────────────────────────
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    console.warn('[AUTH] Token error:', err.message);
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ════════════════════════════════════════════════════════════
//  HEALTH CHECK
// ════════════════════════════════════════════════════════════
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// ── FIX: Explicit HTML routes ─────────────────────────────────
// Serve index.html for root and /index
app.get('/',       (_req, res) => res.sendFile(path.join(__dirname, 'src', 'index.html')));
app.get('/index',  (_req, res) => res.sendFile(path.join(__dirname, 'src', 'index.html')));

// Serve game.html for /game route (previously caused 404)
app.get('/game',   (_req, res) => res.sendFile(path.join(__dirname, 'src', 'game.html')));

// ════════════════════════════════════════════════════════════
//  AUTH ROUTES
// ════════════════════════════════════════════════════════════

// POST /api/register
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password)
    return res.status(400).json({ error: 'Username and password required' });
  if (username.length < 3 || username.length > 50)
    return res.status(400).json({ error: 'Username must be 3–50 characters' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });

  try {
    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    await pool.execute(
      'INSERT INTO users (username, password_hash) VALUES (?, ?)',
      [username, hash]
    );
    console.log(`[AUTH] Registered: ${username}`);
    res.json({ success: true, message: 'Account created. Please sign in.' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ error: 'Username already taken' });
    console.error('[AUTH] Register error:', err);
    res.status(500).json({ error: 'Server error during registration' });
  }
});

// POST /api/login
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password required' });

  try {
    const [rows] = await pool.execute(
      'SELECT id, username, password_hash FROM users WHERE username = ?',
      [username]
    );
    if (!rows.length)
      return res.status(401).json({ error: 'Invalid credentials' });

    const user = rows[0];
    const ok   = await bcrypt.compare(password, user.password_hash);
    if (!ok)
      return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { id: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: '8h' }
    );
    console.log(`[AUTH] Login: ${username}`);
    res.json({ token, username: user.username });
  } catch (err) {
    console.error('[AUTH] Login error:', err);
    res.status(500).json({ error: 'Server error during login' });
  }
});

// ════════════════════════════════════════════════════════════
//  LEADERBOARD ROUTES
// ════════════════════════════════════════════════════════════

// GET /api/leaderboard
app.get('/api/leaderboard', async (_req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT username, time_completed, levels_completed, status,
             DATE_FORMAT(created_at, '%Y-%m-%d') AS date
      FROM leaderboard
      ORDER BY
        CASE status WHEN 'Completed' THEN 0 ELSE 1 END,
        time_completed ASC,
        levels_completed DESC
      LIMIT 20
    `);
    res.json(rows);
  } catch (err) {
    console.error('[LB] Fetch error:', err);
    res.status(500).json({ error: 'Could not fetch leaderboard' });
  }
});

// POST /api/leaderboard/save
app.post('/api/leaderboard/save', requireAuth, async (req, res) => {
  const { time_completed, levels_completed, status } = req.body || {};
  const { id: user_id, username } = req.user;

  const validStatus = ['Completed', 'Game Unfinished'];
  if (!validStatus.includes(status))
    return res.status(400).json({ error: 'Invalid status value' });

  try {
    await pool.execute(
      `INSERT INTO leaderboard (user_id, username, time_completed, levels_completed, status)
       VALUES (?, ?, ?, ?, ?)`,
      [user_id, username, time_completed ?? null, levels_completed ?? 0, status]
    );
    console.log(`[LB] Saved: ${username} — ${status}, ${levels_completed} levels`);
    res.json({ success: true });
  } catch (err) {
    console.error('[LB] Save error:', err);
    res.status(500).json({ error: 'Could not save record' });
  }
});

// ── Global error handler ──────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[EXPRESS] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ════════════════════════════════════════════════════════════
//  HTTP SERVER
// ════════════════════════════════════════════════════════════
const httpServer = http.createServer(app);
httpServer.listen(3000, () => {
  console.log('[SERVER] API      → http://localhost:3000');
  console.log('[SERVER] Game     → http://localhost:3000/game');
  console.log('[SERVER] Login    → http://localhost:3000/');
});

// ════════════════════════════════════════════════════════════
//  WEBSOCKET RELAY  (gestureControl.py → browser game)
// ════════════════════════════════════════════════════════════
const wss = new WebSocket.Server({ port: 8765 });

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress;
  console.log(`[WS] Client connected from ${ip}`);

  ws.on('message', (message) => {
    const payload = message.toString();

    // Debug — log gesture (throttled)
    try {
      const parsed = JSON.parse(payload);
      if (parsed.gesture && parsed.gesture !== 'NONE') {
        process.stdout.write(`\r[WS] Gesture → ${parsed.gesture}        `);
      }
    } catch {}

    // Relay to all OTHER connected clients (Python → browser)
    wss.clients.forEach((client) => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  });

  ws.on('close', () => console.log(`\n[WS] Client disconnected (${ip})`));
  ws.on('error', (err) => console.warn(`[WS] Error (${ip}):`, err.message));
});

console.log('[SERVER] WebSocket relay → ws://localhost:8765');
console.log('[SERVER] Gesture script:  python gestureControl.py');
console.log("JWT:", process.env.JWT_SECRET);
console.log("DB:", process.env.DB_NAME);