// db.js
// MySQL2 connection pool with automatic database + table creation.
//
// LEADERBOARD POLICY (this revision):
//   Reverted to "every play = new row" model.
//   No UNIQUE constraint on user_id, no upsert.
//   When a user replays they appear as a separate row with their new time.
//   The leaderboard endpoint orders by status + time, so a user's best
//   run naturally floats to the top while older runs remain visible.

require('dotenv').config();
const mysql = require('mysql2/promise');

const DB_HOST = process.env.DB_HOST     || 'localhost';
const DB_USER = process.env.DB_USER     || 'root';
const DB_PASS = process.env.DB_PASSWORD || '';
const DB_NAME = process.env.DB_NAME     || 'racing_game';

// ── Step 1: Bootstrap (no DB selected) ───────────────────────────────────
async function bootstrap() {
  let conn;
  try {
    conn = await mysql.createConnection({
      host:     DB_HOST,
      user:     DB_USER,
      password: DB_PASS,
    });

    // Create database if it doesn't exist
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\`
       CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await conn.query(`USE \`${DB_NAME}\``);

    // ── Users table ──────────────────────────────────────────
    await conn.query(`
      CREATE TABLE IF NOT EXISTS users (
        id            INT          AUTO_INCREMENT PRIMARY KEY,
        username      VARCHAR(50)  NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ── Sessions table ───────────────────────────────────────
    await conn.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id         INT          AUTO_INCREMENT PRIMARY KEY,
        user_id    INT          NOT NULL,
        token      VARCHAR(128) NOT NULL UNIQUE,
        expires_at DATETIME     NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // ── Leaderboard table ────────────────────────────────────
    // No UNIQUE on user_id — every save creates a new row.
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

    // ── Migration: drop UNIQUE KEY uk_user_id if it was added previously ──
    // This is safe to run even on fresh installs (catches no-such-key error).
    try {
      const [idxRows] = await conn.query(`
        SELECT COUNT(*) AS cnt
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = 'leaderboard'
          AND INDEX_NAME   = 'uk_user_id'
      `);
      if (idxRows[0].cnt > 0) {
        await conn.query(`ALTER TABLE leaderboard DROP INDEX uk_user_id`);
        console.log('[DB] Migration: dropped legacy UNIQUE KEY uk_user_id (multi-row mode).');
      }
    } catch (e) {
      console.warn('[DB] Migration warning (non-fatal):', e.message);
    }

    // ── Status index ─────────────────────────────────────────
    await conn.query(`
      CREATE INDEX IF NOT EXISTS idx_leaderboard_status_time
        ON leaderboard (status, time_completed)
    `).catch(() => {
      // Older MySQL versions don't support IF NOT EXISTS on indexes — ignore
    });

    console.log(`[DB] Database "${DB_NAME}" ready.`);

  } catch (err) {
    console.error('[DB] Bootstrap failed:', err.message);
    console.error('     Make sure XAMPP MySQL is running and credentials are correct.');
    process.exit(1);
  } finally {
    if (conn) await conn.end();
  }
}

// ── Step 2: Export pool (with DB selected) ────────────────────────────────
const pool = mysql.createPool({
  host:               DB_HOST,
  user:               DB_USER,
  password:           DB_PASS,
  database:           DB_NAME,
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
  async execute(...args) {
    await ensureReady();
    return pool.execute(...args);
  },
  async query(...args) {
    await ensureReady();
    return pool.query(...args);
  },
};

module.exports = safePool;