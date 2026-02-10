-- Migration: Update print_requests status constraint to include 'ready'
-- Date: 2026-02-07

CREATE TABLE print_requests_v3 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  material_id INTEGER,
  work_id INTEGER,
  opmerking TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'ready', 'completed', 'cancelled')),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cost DECIMAL(10,2) DEFAULT 0.00,
  is_subscription_covered BOOLEAN DEFAULT 0,
  payment_status TEXT DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'free')),
  mollie_payment_id TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE CASCADE,
  FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE CASCADE
);

INSERT INTO print_requests_v3 (
  id, user_id, material_id, work_id, opmerking, status, created_at,
  cost, is_subscription_covered, payment_status, mollie_payment_id
)
SELECT 
  id, user_id, material_id, work_id, opmerking, status, created_at,
  cost, is_subscription_covered, payment_status, mollie_payment_id
FROM print_requests;

DROP TABLE print_requests;
ALTER TABLE print_requests_v3 RENAME TO print_requests;

CREATE INDEX idx_print_requests_user_v3 ON print_requests(user_id);
CREATE INDEX idx_print_requests_status_v3 ON print_requests(status);
CREATE INDEX idx_print_requests_work_v3 ON print_requests(work_id);
