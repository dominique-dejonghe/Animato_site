-- 0070: Reacties op posts (nieuws, board, posts, ...)
-- Doel: leden kunnen reageren op nieuwsberichten — gevraagd door Christa
-- Reacties zijn enkel voor ingelogde gebruikers (geen anonieme spam mogelijk)
--
-- Datamodel:
--   post_comments — één rij per reactie, gekoppeld aan een post + auteur
--
-- Moderatie:
--   • Eigenaar mag zijn eigen reactie verwijderen
--   • Admin/moderator mag alle reacties verwijderen
--   • Geen edit-functie (eenvoud > flexibiliteit; bij fout: verwijder en opnieuw)

CREATE TABLE IF NOT EXISTS post_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_post_comments_post ON post_comments(post_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_post_comments_user ON post_comments(user_id, created_at DESC);
