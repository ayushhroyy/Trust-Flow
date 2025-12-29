-- TrustFlow D1 Database Schema
-- Run: wrangler d1 execute trustflow-db --file=./schema.sql

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  aadhar_id TEXT UNIQUE NOT NULL,
  phone_number TEXT UNIQUE NOT NULL,
  photo_url TEXT,
  credit_score INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Verification logs table
CREATE TABLE IF NOT EXISTS verification_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  user_name TEXT,
  aadhar_masked TEXT,
  phone_masked TEXT,
  status TEXT CHECK(status IN ('success', 'failed')),
  confidence_score REAL,
  identity_type TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_logs_created_at ON verification_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_aadhar ON users(aadhar_id);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone_number);
