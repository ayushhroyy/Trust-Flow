-- Seed data for TrustFlow D1 database
-- Run: wrangler d1 execute trustflow-db --file=./seed.sql

INSERT OR IGNORE INTO users (name, aadhar_id, phone_number, credit_score) VALUES 
  ('Aryan Singh', '449961503595', '7499853367', 820),
  ('Navya Aggarwal', '530785223307', '9315186262', NULL),
  ('Anjali', '661813090329', '7818093783', NULL);
