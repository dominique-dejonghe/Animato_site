-- Test data for materials management system
-- Creates sample works, pieces and materials for demonstration

-- Insert test works
INSERT INTO works (componist, titel, beschrijving, genre, jaar) VALUES 
  ('Wolfgang Amadeus Mozart', 'Requiem in D minor', 'Laatste compositie van Mozart, onvoltooid bij zijn dood', 'Klassiek', 1791),
  ('Johann Sebastian Bach', 'Magnificat in D major, BWV 243', 'Geestelijk koormuziek uit de Barokperiode', 'Barok', 1733),
  ('Eric Whitacre', 'Lux Aurumque', 'Modern koorwerk met prachtige harmonieën', 'Hedendaags', 2000);

-- Get the IDs (SQLite doesn't support RETURNING, so we'll use last_insert_rowid in next statements)

-- Insert pieces for Mozart Requiem (work_id = 1)
INSERT INTO pieces (work_id, titel, nummer, moeilijkheidsgraad, toonsoort) VALUES 
  (1, 'Introitus - Requiem aeternam', 1, 'gevorderd', 'd-klein'),
  (1, 'Kyrie', 2, 'gevorderd', 'd-klein'),
  (1, 'Dies Irae', 3, 'expert', 'd-klein'),
  (1, 'Lacrimosa', 8, 'gevorderd', 'd-klein');

-- Insert pieces for Bach Magnificat (work_id = 2)
INSERT INTO pieces (work_id, titel, nummer, moeilijkheidsgraad, toonsoort) VALUES 
  (2, 'Magnificat anima mea', 1, 'gevorderd', 'D-majeur'),
  (2, 'Et exsultavit spiritus meus', 2, 'gemiddeld', 'A-majeur');

-- Insert pieces for Lux Aurumque (work_id = 3)
INSERT INTO pieces (work_id, titel, nummer, moeilijkheidsgraad) VALUES 
  (3, 'Lux Aurumque', 1, 'gemiddeld');

-- Insert materials for Mozart Requiem - Kyrie (piece_id = 2)
INSERT INTO materials (piece_id, stem, type, titel, url, beschrijving, zichtbaar_voor, upload_door, versie) VALUES 
  (2, 'S', 'pdf', 'Partituur Sopraan - Kyrie', 'https://example.com/mozart-requiem-kyrie-sopraan.pdf', 'Officiële partituur voor sopraan stemmen', 'alle_leden', 1, 1),
  (2, 'A', 'pdf', 'Partituur Alt - Kyrie', 'https://example.com/mozart-requiem-kyrie-alt.pdf', 'Officiële partituur voor alt stemmen', 'alle_leden', 1, 1),
  (2, 'T', 'pdf', 'Partituur Tenor - Kyrie', 'https://example.com/mozart-requiem-kyrie-tenor.pdf', 'Officiële partituur voor tenor stemmen', 'alle_leden', 1, 1),
  (2, 'B', 'pdf', 'Partituur Bas - Kyrie', 'https://example.com/mozart-requiem-kyrie-bas.pdf', 'Officiële partituur voor bas stemmen', 'alle_leden', 1, 1),
  (2, 'SATB', 'pdf', 'Volledige Partituur - Kyrie', 'https://example.com/mozart-requiem-kyrie-satb.pdf', 'Volledige partituur alle stemmen', 'alle_leden', 1, 1),
  (2, 'piano', 'pdf', 'Piano Begeleiding - Kyrie', 'https://example.com/mozart-requiem-kyrie-piano.pdf', 'Piano reduction', 'alle_leden', 1, 1);

-- Insert audio materials for Kyrie
INSERT INTO materials (piece_id, stem, type, titel, url, beschrijving, zichtbaar_voor, upload_door, versie) VALUES 
  (2, 'S', 'audio', 'Oefentrack Sopraan - Kyrie', 'https://example.com/mozart-requiem-kyrie-sopraan.mp3', 'Langzame oefentrack met alleen sopraan stem', 'alle_leden', 1, 1),
  (2, 'A', 'audio', 'Oefentrack Alt - Kyrie', 'https://example.com/mozart-requiem-kyrie-alt.mp3', 'Langzame oefentrack met alleen alt stem', 'alle_leden', 1, 1),
  (2, 'T', 'audio', 'Oefentrack Tenor - Kyrie', 'https://example.com/mozart-requiem-kyrie-tenor.mp3', 'Langzame oefentrack met alleen tenor stem', 'alle_leden', 1, 1),
  (2, 'B', 'audio', 'Oefentrack Bas - Kyrie', 'https://example.com/mozart-requiem-kyrie-bas.mp3', 'Langzame oefentrack met alleen bas stem', 'alle_leden', 1, 1);

-- Insert YouTube links
INSERT INTO materials (piece_id, stem, type, titel, url, beschrijving, zichtbaar_voor, upload_door, versie) VALUES 
  (2, 'SATB', 'link', 'YouTube Performance - Kyrie', 'https://www.youtube.com/watch?v=Dp2SJN4UiE4', 'Professionele uitvoering van het Kyrie', 'alle_leden', 1, 1),
  (2, 'algemeen', 'link', 'YouTube Leer-video - Kyrie', 'https://www.youtube.com/watch?v=example', 'Stap-voor-stap uitleg van het Kyrie', 'alle_leden', 1, 1);

-- Insert materials for Dies Irae (piece_id = 3)
INSERT INTO materials (piece_id, stem, type, titel, url, beschrijving, zichtbaar_voor, upload_door, versie) VALUES 
  (3, 'SATB', 'pdf', 'Volledige Partituur - Dies Irae', 'https://example.com/mozart-requiem-dies-irae.pdf', 'Complete SATB score', 'alle_leden', 1, 1),
  (3, 'SATB', 'link', 'YouTube Performance - Dies Irae', 'https://www.youtube.com/watch?v=ZDFFHaz9GsY', 'Dramatische uitvoering', 'alle_leden', 1, 1);

-- Insert materials for Lux Aurumque (piece_id = 7)
INSERT INTO materials (piece_id, stem, type, titel, url, beschrijving, zichtbaar_voor, upload_door, versie) VALUES 
  (7, 'S', 'pdf', 'Partituur Sopraan - Lux Aurumque', 'https://example.com/lux-aurumque-sopraan.pdf', 'Modern hedendaags koorwerk', 'alle_leden', 1, 1),
  (7, 'A', 'pdf', 'Partituur Alt - Lux Aurumque', 'https://example.com/lux-aurumque-alt.pdf', 'Modern hedendaags koorwerk', 'alle_leden', 1, 1),
  (7, 'T', 'pdf', 'Partituur Tenor - Lux Aurumque', 'https://example.com/lux-aurumque-tenor.pdf', 'Modern hedendaags koorwerk', 'alle_leden', 1, 1),
  (7, 'B', 'pdf', 'Partituur Bas - Lux Aurumque', 'https://example.com/lux-aurumque-bas.pdf', 'Modern hedendaags koorwerk', 'alle_leden', 1, 1),
  (7, 'SATB', 'link', 'YouTube Eric Whitacre Dirigeert', 'https://www.youtube.com/watch?v=0j2JRcC6wBs', 'Eric Whitacre dirigeert zijn eigen compositie', 'alle_leden', 1, 1);
