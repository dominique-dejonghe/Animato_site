-- Migration 0059: Voeg public_share kolom toe aan posts.
-- Wanneer 1: het bericht is via /posts/:slug toegankelijk zonder login,
-- ongeacht de zichtbaarheid (bv. om via WhatsApp breder te delen).
-- Default 0: gedrag blijft zoals voorheen (zichtbaarheid bepaalt toegang).

ALTER TABLE posts ADD COLUMN public_share INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_posts_public_share ON posts(public_share) WHERE public_share = 1;
