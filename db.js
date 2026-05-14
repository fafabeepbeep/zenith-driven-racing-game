// db.js — PRODUCTION VERSION (Aiven MySQL with SSL)
// ─────────────────────────────────────────────────────────────
//  Changes vs local db.js:
//    • SSL enabled (Aiven requires it)
//    • Connection retry on cold start (cloud DBs may be slow first connect)
//    • Same plain-INSERT leaderboard model (every play = new row)
// ─────────────────────────────────────────────────────────────

require('dotenv').config();
const mysql = require('mysql2/promise');
const fs    = require('fs');
const path  = require('path');

const DB_HOST   = process.env.DB_HOST     || 'localhost';
const DB_PORT   = parseInt(process.env.DB_PORT || '3306', 10);
const DB_USER   = process.env.DB_USER     || 'root';
const DB_PASS   = process.env.DB_PASSWORD || '';
const DB_NAME   = process.env.DB_NAME     || 'racing_game';
const DB_SSL    = process.env.DB_SSL === 'true';

// ── SSL config for Aiven ──────────────────────────────────────
// Aiven gives you a ca.pem certificate to download. Save it to ca.pem
// in the project root, then set DB_SSL=true in your env.
let sslConfig = null;
if (DB_SSL) {
  const caPath = path.join(__dirname, 'ca.pem');
  if (fs.existsSync(caPath)) {
    sslConfig = {
      ca: fs.readFileSync(caPath),
      rejectUnauthorized: true,
    };
    console.log('[DB] SSL enabled with CA certificate.');
  } else {
    // Fallback: allow SSL without verifying CA (less secure but works)
    sslConfig = { rejectUnauthorized: false };
    console.log('[DB] SSL enabled WITHOUT CA cert (ca.pem not found).');
  }
}

// ── Bootstrap (creates database + tables on first run) ────────
async function bootstrap() {
  let conn;
  let attempts = 0;
  const MAX_ATTEMPTS = 5;

  while (attempts < MAX_ATTEMPTS) {
    try {
      conn = await mysql.createConnection({
        host:     DB_HOST,
        port:     DB_PORT,
        user:     DB_USER,
        password: DB_PASS,
        ssl:      sslConfig,
      });
      break;
    } catch (err) {
      attempts++;
      console.error(`[DB] Bootstrap attempt ${attempts} failed:`, err.message);
      if (attempts >= MAX_ATTEMPTS) {
        console.error('[DB] Giving up after', MAX_ATTEMPTS, 'attempts.');
        process.exit(1);
      }
      // Exponential backoff: 1s, 2s, 4s, 8s, 16s
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempts - 1)));
    }
  }

  try {
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\`
       CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await conn.query(`USE \`${DB_NAME}\``);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS users (
        id            INT          AUTO_INCREMENT PRIMARY KEY,
        username      VARCHAR(50)  NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS leaderboard (
        id               INT         AUTO_INCREMENT PRIMARY KEY,
        user_id          INT         NOT NULL,
        username         VARCHAR(50) NOT NULL,
        time_completed   FLOAT       NULL,
        levels_completed TINYINT     NOT NULL DEFAULT 0,
        status           ENUM('Completed','Game Unfinished') NOT NULL DEFAULT 'Game Unfinished',
        created_at       TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    await conn.query(`
      CREATE INDEX IF NOT EXISTS idx_leaderboard_status_time
        ON leaderboard (status, time_completed)
    `).catch(() => {});

    console.log(`[DB] Database "${DB_NAME}" ready.`);
  } catch (err) {
    console.error('[DB] Schema setup failed:', err.message);
    process.exit(1);
  } finally {
    if (conn) await conn.end();
  }
}

// ── Connection pool ──────────────────────────────────────────
const pool = mysql.createPool({
  host:               DB_HOST,
  port:               DB_PORT,
  user:               DB_USER,
  password:           DB_PASS,
  database:           DB_NAME,
  ssl:                sslConfig,
  waitForConnections: true,
  connectionLimit:    10,
  queueLimit:         0,
});

let _ready = null;
function ensureReady() {
  if (!_ready) _ready = bootstrap();
  return _ready;
}

const safePool = {
  async execute(...args) { await ensureReady(); return pool.execute(...args); },
  async query(...args)   { await ensureReady(); return pool.query(...args); },
};

module.exports = safePool;