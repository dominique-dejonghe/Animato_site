-- 0068: Editable static pages (#121)
-- Doel: pagina-content (bv. /over met geschiedenis koor) editeerbaar maken zonder dat er
-- code-wijzigingen nodig zijn. Admin kan via /admin/paginas elk veld bewerken.
--
-- Velden:
--   slug         — uniek pad (bv. 'over', 'visie', 'historiek')
--   titel        — H1 op de pagina
--   intro        — korte introtekst (plain text of HTML)
--   body         — volledige inhoud (HTML, Quill rich text)
--   hero_image   — optionele hero-afbeelding URL
--   updated_at   — laatste update tijdstempel
--   updated_by   — admin user_id die laatst bewerkt heeft

CREATE TABLE IF NOT EXISTS editable_pages (
  slug TEXT PRIMARY KEY,
  titel TEXT NOT NULL,
  intro TEXT,
  body TEXT,
  hero_image TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_by INTEGER,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Initiele content voor /over
INSERT OR IGNORE INTO editable_pages (slug, titel, intro, body) VALUES (
  'over',
  'Over Gemengd Koor Animato',
  'Al bijna 40 jaar brengt Gemengd Koor Animato uit Oppuurs zijn passie voor zang naar het publiek.',
  '<h2>Onze Geschiedenis</h2><p>Gemengd Koor Animato werd opgericht in 1988 in het Klein-Brabantse Oppuurs. Wat begon als een kleine groep enthousiaste zangers is uitgegroeid tot een ensemble van een veertigtal stemmen.</p><p>In 2013 vierde het koor zijn 25-jarig bestaan met een feestelijk jubileumconcert. In 2014 brachten we Karl Jenkins'' indrukwekkende werk <em>The Peacemakers</em> met groot orkest. In september 2018 deelden we het podium met Eurovisie-zangeres Ishtar.</p><p>Een hoogtepunt was de gezamenlijke uitvoering van Karl Jenkins'' <em>The Armed Man</em> in september 2019, samen met het Mechels Harmonie Orkest, Korokan en Laudate.</p><h2>Wat we doen</h2><p>Het koor repeteert wekelijks en geeft jaarlijks minstens één eigen concert. Daarnaast verzorgen we vaak gastoptredens en werken we samen met andere ensembles. Ons repertoire is breed: van klassiek over musical tot pop, gospel en wereldmuziek.</p><h2>Onze dirigente</h2><p>Anja Holbrechts leidt het koor al meer dan tien jaar. Ze studeerde trombone aan het Conservatorium van Gent en specialiseerde zich in orkestdirectie bij Dirk Brossé en Eddy Van Oosthuyse.</p><p><em>Deze tekst kan via de admin pas aangepast worden — geen code-wijziging nodig.</em></p>'
);
