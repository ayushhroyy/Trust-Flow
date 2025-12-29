-- TrustFlow D1 Database Schema

-- Users table for storing user details
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  aadhar_id TEXT UNIQUE NOT NULL,
  phone_number TEXT UNIQUE NOT NULL,
  image_key TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Verifications table for login history and confidence scores
CREATE TABLE IF NOT EXISTS verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  aadhar_masked TEXT,
  user_name TEXT,
  phone_masked TEXT,
  status TEXT NOT NULL CHECK(status IN ('success', 'failed')),
  confidence_score REAL,
  identity_type TEXT,
  timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_aadhar ON users(aadhar_id);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone_number);
CREATE INDEX IF NOT EXISTS idx_verifications_timestamp ON verifications(timestamp DESC);
