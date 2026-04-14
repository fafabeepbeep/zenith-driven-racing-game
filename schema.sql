-- =============================================================
--  Pseudo-3D Racer  ·  Database Schema
-- =============================================================

CREATE DATABASE IF NOT EXISTS racing_game
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE racing_game;

-- -------------------------------------------------------------
-- Users
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            INT          AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(50)  NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

-- -------------------------------------------------------------
-- Sessions  (simple server-side token store)
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  id         INT          AUTO_INCREMENT PRIMARY KEY,
  user_id    INT          NOT NULL,
  token      VARCHAR(128) NOT NULL UNIQUE,
  expires_at DATETIME     NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- -------------------------------------------------------------
-- Leaderboard
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leaderboard (
  id               INT           AUTO_INCREMENT PRIMARY KEY,
  user_id          INT           NOT NULL,
  username         VARCHAR(50)   NOT NULL,

  -- NULL means still playing / abandoned before finishing
  time_completed   FLOAT         NULL         COMMENT 'Total seconds for a full 6-level run',

  levels_completed TINYINT       NOT NULL DEFAULT 0,

  -- 'Completed' only when all 6 levels are finished
  status           ENUM(
                     'Completed',
                     'Game Unfinished'
                   )             NOT NULL DEFAULT 'Game Unfinished',

  created_at       TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Handy index for the public leaderboard query
CREATE INDEX idx_leaderboard_status_time
  ON leaderboard (status, time_completed);