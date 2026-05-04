-- Maak de partituurlijst event-gedreven ipv concert-gedreven.
-- De huidige concert_pieces tabel is leeg, dus we kunnen veilig droppen + recreaten.
-- Doel: ook andere event-types (activiteiten, uitstappen) kunnen partituurlijst krijgen.

DROP TABLE IF EXISTS concert_pieces;

CREATE TABLE IF NOT EXISTS event_pieces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  piece_id INTEGER NOT NULL,
  volgorde INTEGER NOT NULL DEFAULT 0,
  opmerking TEXT, -- bv. "alleen sopraan", "encore", "intro voor de pauze"
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY (piece_id) REFERENCES pieces(id) ON DELETE CASCADE,
  UNIQUE(event_id, piece_id)
);

CREATE INDEX IF NOT EXISTS idx_event_pieces_event ON event_pieces(event_id, volgorde);
CREATE INDEX IF NOT EXISTS idx_event_pieces_piece ON event_pieces(piece_id);
