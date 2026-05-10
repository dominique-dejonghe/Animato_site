-- 0069: Wie-is-wie quiz (namen-leren met foto's)
-- Doel: leden helpen elkaars namen te leren via een korte quiz
-- die ze starten vanuit het smoelenboek.
--
-- Datamodel:
--   quiz_sessions     — één rij per gestarte quiz-sessie (5+ vragen, eindscore)
--   quiz_answers      — één rij per gegeven antwoord (target persoon, gekozen persoon, juist/fout)
--
-- Aggregatie (queries, geen aparte tabellen) gebruiken deze data voor:
--   • leaderboard per lid
--   • deelnamegraad (wie heeft nooit meegedaan)
--   • moeilijkste gezichten (welke leden worden het minst herkend)
--   • per lid: welke gezichten zij structureel fout raden

CREATE TABLE IF NOT EXISTS quiz_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,                 -- wie speelt
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ended_at TIMESTAMP,                       -- NULL = nog bezig (of afgebroken)
  total_questions INTEGER NOT NULL DEFAULT 0,
  correct_answers INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_quiz_sessions_user ON quiz_sessions(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_quiz_sessions_started ON quiz_sessions(started_at DESC);

CREATE TABLE IF NOT EXISTS quiz_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,                 -- speler (denormalized voor snelle queries)
  target_user_id INTEGER NOT NULL,          -- correcte antwoord (persoon op foto)
  chosen_user_id INTEGER NOT NULL,          -- wat speler koos
  is_correct INTEGER NOT NULL DEFAULT 0,    -- 1 = juist, 0 = fout
  answered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES quiz_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (chosen_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_quiz_answers_session ON quiz_answers(session_id);
CREATE INDEX IF NOT EXISTS idx_quiz_answers_user ON quiz_answers(user_id, answered_at DESC);
CREATE INDEX IF NOT EXISTS idx_quiz_answers_target ON quiz_answers(target_user_id, is_correct);
CREATE INDEX IF NOT EXISTS idx_quiz_answers_user_target ON quiz_answers(user_id, target_user_id);
