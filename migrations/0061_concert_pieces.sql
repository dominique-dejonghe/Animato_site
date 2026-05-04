-- Koppeltabel: welke stukken/partituren horen bij welk concert + in welke volgorde
-- Hergebruikt het bestaande pieces/materials systeem ipv een nieuwe upload-tabel

CREATE TABLE IF NOT EXISTS concert_pieces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  concert_id INTEGER NOT NULL,
  piece_id INTEGER NOT NULL,
  volgorde INTEGER NOT NULL DEFAULT 0,
  opmerking TEXT, -- bv. "alleen sopraan" of "uittreemoment"
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (concert_id) REFERENCES concerts(id) ON DELETE CASCADE,
  FOREIGN KEY (piece_id) REFERENCES pieces(id) ON DELETE CASCADE,
  UNIQUE(concert_id, piece_id)
);

CREATE INDEX IF NOT EXISTS idx_concert_pieces_concert ON concert_pieces(concert_id, volgorde);
CREATE INDEX IF NOT EXISTS idx_concert_pieces_piece ON concert_pieces(piece_id);
