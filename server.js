// server.js — PRODUCTION VERSION (for Render / cloud hosting)
// ─────────────────────────────────────────────────────────────
//  KEY CHANGES vs local server.js:
//
//  1. WebSocket merged onto same HTTP server (one port, required for cloud)
//     Local:   ws://localhost:8765
//     Cloud:   wss://your-app.onrender.com  (same domain, secure)
//
//  2. Port from environment ($PORT) — Render assigns this automatically
//
//  3. Trust proxy enabled — Render runs behind a reverse proxy
//
//  4. CORS configured for production domain
//
//  5. Static files served from src/  (unchanged)
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
const PORT        = process.env.PORT || 3000;            // Render injects this
const JWT_SECRET  = process.env.JWT_SECRET || 'change_me_in_production';
const SALT_ROUNDS = 10;

// ── Trust proxy (required behind Render's load balancer) ─────
app.set('trust proxy', 1);

// ── Middleware ────────────────────────────────────────────────
app.use(cors({
  origin: '*',  // Tighten this to your domain in production if desired
  credentials: false,
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'src')));

// Lightweight request logger
app.use((req, _res, next) => {
  if (!req.path.startsWith('/assets')) {
    console.log(`[API] ${req.method} ${req.path}`);
  }
  next();
});

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

// ── HEALTH + STATIC ROUTES ───────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ ok: true, env: process.env.NODE_ENV || 'production' }));
app.get('/',      (_req, res) => res.sendFile(path.join(__dirname, 'src', 'index.html')));
app.get('/index', (_req, res) => res.sendFile(path.join(__dirname, 'src', 'index.html')));
app.get('/game',  (_req, res) => res.sendFile(path.join(__dirname, 'src', 'game.html')));

// ════════════════════════════════════════════════════════════
//  AUTH
// ════════════════════════════════════════════════════════════
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
    console.log('[AUTH] Registered:', username);
    res.json({ success: true, message: 'Account created. Please sign in.' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ error: 'Username already taken' });
    console.error('[AUTH] Register error:', err);
    res.status(500).json({ error: 'Server error during registration' });
  }
});

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
    console.log('[AUTH] Login:', username);
    res.json({ token, username: user.username });
  } catch (err) {
    console.error('[AUTH] Login error:', err);
    res.status(500).json({ error: 'Server error during login' });
  }
});

// ════════════════════════════════════════════════════════════
//  LEADERBOARD
// ════════════════════════════════════════════════════════════
app.get('/api/leaderboard', async (_req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT id, username, time_completed, levels_completed, status,
             DATE_FORMAT(created_at, '%Y-%m-%d %H:%i') AS date
      FROM leaderboard
      ORDER BY
        CASE status WHEN 'Completed' THEN 0 ELSE 1 END,
        time_completed ASC, levels_completed DESC, created_at DESC
      LIMIT 5
    `);
    res.json(rows);
  } catch (err) {
    console.error('[LB] Fetch error:', err);
    res.status(500).json({ error: 'Could not fetch leaderboard' });
  }
});

app.get('/api/leaderboard/full', async (_req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT id, username, time_completed, levels_completed, status,
             DATE_FORMAT(created_at, '%Y-%m-%d %H:%i') AS date
      FROM leaderboard
      ORDER BY
        CASE status WHEN 'Completed' THEN 0 ELSE 1 END,
        time_completed ASC, levels_completed DESC, created_at DESC
      LIMIT 50
    `);
    res.json(rows);
  } catch (err) {
    console.error('[LB] Fetch full error:', err);
    res.status(500).json({ error: 'Could not fetch full leaderboard' });
  }
});

app.post('/api/leaderboard/save', requireAuth, async (req, res) => {
  const { time_completed, levels_completed, status } = req.body || {};
  const { id: user_id, username } = req.user;

  const validStatus = ['Completed', 'Game Unfinished'];
  if (!validStatus.includes(status))
    return res.status(400).json({ error: 'Invalid status value' });

  try {
    const [result] = await pool.execute(
      `INSERT INTO leaderboard
         (user_id, username, time_completed, levels_completed, status)
       VALUES (?, ?, ?, ?, ?)`,
      [user_id, username, time_completed ?? null, levels_completed ?? 0, status]
    );
    console.log('[LB] INSERTED — id:', result.insertId);
    res.json({ success: true, insertId: result.insertId });
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
//  HTTP + WEBSOCKET — SHARED PORT (cloud-friendly)
// ════════════════════════════════════════════════════════════
const httpServer = http.createServer(app);

// WebSocket on the SAME server, not a separate port.
// Path `/gesture` lets Render route correctly behind HTTPS proxy.
const wss = new WebSocket.Server({ server: httpServer, path: '/gesture' });

wss.on('connection', (ws, req) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  console.log('[WS] Client connected from', ip);

  ws.on('message', (message) => {
    const payload = message.toString();
    try {
      const parsed = JSON.parse(payload);
      if (parsed.gesture && parsed.gesture !== 'NONE') {
        process.stdout.write(`\r[WS] Gesture → ${parsed.gesture}        `);
      }
    } catch {}

    wss.clients.forEach((client) => {
      if (client !== ws && client.readyState === WebSocket.OPEN)
        client.send(payload);
    });
  });

  ws.on('close', () => console.log(`\n[WS] Client disconnected (${ip})`));
  ws.on('error', (err) => console.warn(`[WS] Error (${ip}):`, err.message));
});

httpServer.listen(PORT, () => {
  console.log('═══════════════════════════════════════════════════');
  console.log(`  ZENITH DRIVEN — Production Server`);
  console.log(`  HTTP + WS  → port ${PORT}`);
  console.log(`  WS path    → /gesture`);
  console.log(`  Env        → ${process.env.NODE_ENV || 'production'}`);
  console.log('═══════════════════════════════════════════════════');
});