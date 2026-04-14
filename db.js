// backend/db.js (for future folder structure)
// MySQL2 connection pool with automatic database + table creation.
// Root cause fix: pool was connecting to 'racing_game' before it existed.
// Fix: connect without a database first, create DB + tables, then export the pool.

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

    // Create tables
    await conn.query(`
      CREATE TABLE IF NOT EXISTS users (
        id            INT          AUTO_INCREMENT PRIMARY KEY,
        username      VARCHAR(50)  NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id         INT          AUTO_INCREMENT PRIMARY KEY,
        user_id    INT          NOT NULL,
        token      VARCHAR(128) NOT NULL UNIQUE,
        expires_at DATETIME     NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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

    // Create index (ignore error if already exists)
    await conn.query(`
      CREATE INDEX IF NOT EXISTS idx_leaderboard_status_time
        ON leaderboard (status, time_completed)
    `).catch(() => {});  // older MySQL versions don't support IF NOT EXISTS on indexes

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

// Run bootstrap then make the pool available
let _ready = null;
function ensureReady() {
  if (!_ready) _ready = bootstrap();
  return _ready;
}

// Wrap pool so callers automatically wait for DB init
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