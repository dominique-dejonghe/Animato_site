-- Migration: Update print_requests to support work-level requests
-- Date: 2025-12-16

CREATE TABLE print_requests_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  material_id INTEGER, -- Now nullable
  work_id INTEGER,     -- New column
  opmerking TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'completed', 'cancelled')),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE CASCADE,
  FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE CASCADE
);

-- Copy existing data (assuming all existing requests have material_id)
-- We need to find the work_id for existing materials to populate it
INSERT INTO print_requests_new (id, user_id, material_id, work_id, opmerking, status, created_at)
SELECT 
  pr.id, 
  pr.user_id, 
  pr.material_id, 
  w.id as work_id,
  pr.opmerking, 
  pr.status, 
  pr.created_at
FROM print_requests pr
JOIN materials m ON pr.material_id = m.id
JOIN pieces p ON m.piece_id = p.id
JOIN works w ON p.work_id = w.id;

DROP TABLE print_requests;
ALTER TABLE print_requests_new RENAME TO print_requests;

CREATE INDEX idx_print_requests_user ON print_requests(user_id);
CREATE INDEX idx_print_requests_status ON print_requests(status);
CREATE INDEX idx_print_requests_work ON print_requests(work_id);
