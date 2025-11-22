-- Test data voor Materials/Partituren systeem

-- Insert test works
INSERT INTO works (componist, titel, beschrijving, genre, jaar) VALUES 
  ('Wolfgang Amadeus Mozart', 'Requiem in D minor', 'Requiem mass in D minor', 'Klassiek', 1791),
  ('Johann Sebastian Bach', 'Matthäus-Passion', 'Passie volgens Mattheüs', 'Barok', 1727),
  ('Giuseppe Verdi', 'Messa da Requiem', 'Requiem voor sopraan, alt, tenor en bas', 'Romantiek', 1874),
  ('John Rutter', 'A Gaelic Blessing', 'Zegenwens in Gaelic stijl', 'Modern', 1978);

-- Insert test pieces for Mozart Requiem
INSERT INTO pieces (work_id, titel, nummer, moeilijkheidsgraad) VALUES 
  (1, 'Requiem aeternam', 1, 'gemiddeld'),
  (1, 'Kyrie', 2, 'gevorderd'),
  (1, 'Dies irae', 3, 'expert'),
  (1, 'Lacrimosa', 4, 'gevorderd');

-- Insert test pieces for Bach Matthäus-Passion
INSERT INTO pieces (work_id, titel, nummer, moeilijkheidsgraad) VALUES 
  (2, 'Kommt, ihr Töchter', 1, 'expert'),
  (2, 'O Mensch, bewein dein Sünde groß', 35, 'gevorderd');

-- Insert test pieces for Verdi Requiem
INSERT INTO pieces (work_id, titel, nummer, moeilijkheidsgraad) VALUES 
  (3, 'Requiem', 1, 'expert'),
  (3, 'Dies irae', 2, 'expert');

-- Insert test pieces for Rutter
INSERT INTO pieces (work_id, titel, nummer, moeilijkheidsgraad) VALUES 
  (4, 'A Gaelic Blessing', 1, 'gemiddeld');

-- Insert test materials (using placeholder URLs)
-- Mozart Requiem - Kyrie materials
INSERT INTO materials (piece_id, stem, type, titel, url, beschrijving, zichtbaar_voor, upload_door, versie) VALUES 
  -- PDF Partituren
  (2, 'S', 'pdf', 'Kyrie - Sopraan Partituur', 'https://example.com/mozart-kyrie-soprano.pdf', 'Originele partituur voor sopraan stem', 'alle_leden', 1, 1),
  (2, 'A', 'pdf', 'Kyrie - Alt Partituur', 'https://example.com/mozart-kyrie-alto.pdf', 'Originele partituur voor alt stem', 'alle_leden', 1, 1),
  (2, 'T', 'pdf', 'Kyrie - Tenor Partituur', 'https://example.com/mozart-kyrie-tenor.pdf', 'Originele partituur voor tenor stem', 'alle_leden', 1, 1),
  (2, 'B', 'pdf', 'Kyrie - Bas Partituur', 'https://example.com/mozart-kyrie-bass.pdf', 'Originele partituur voor bas stem', 'alle_leden', 1, 1),
  (2, 'SATB', 'pdf', 'Kyrie - Volledige Partituur', 'https://example.com/mozart-kyrie-full.pdf', 'Complete SATB partituur', 'alle_leden', 1, 1),
  
  -- Audio Oefentracks
  (2, 'S', 'audio', 'Kyrie - Sopraan Oefentrack', 'https://example.com/mozart-kyrie-soprano-practice.mp3', 'Langzaam tempo oefentrack', 'alle_leden', 1, 1),
  (2, 'A', 'audio', 'Kyrie - Alt Oefentrack', 'https://example.com/mozart-kyrie-alto-practice.mp3', 'Langzaam tempo oefentrack', 'alle_leden', 1, 1),
  (2, 'T', 'audio', 'Kyrie - Tenor Oefentrack', 'https://example.com/mozart-kyrie-tenor-practice.mp3', 'Langzaam tempo oefentrack', 'alle_leden', 1, 1),
  (2, 'B', 'audio', 'Kyrie - Bas Oefentrack', 'https://example.com/mozart-kyrie-bass-practice.mp3', 'Langzaam tempo oefentrack', 'alle_leden', 1, 1),
  
  -- Piano begeleiding
  (2, 'piano', 'audio', 'Kyrie - Piano Begeleiding', 'https://example.com/mozart-kyrie-piano.mp3', 'Piano begeleiding voor oefening', 'alle_leden', 1, 1),
  
  -- YouTube links
  (2, 'SATB', 'link', 'Kyrie - Uitvoering Video', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'Professionele uitvoering van het Kyrie', 'alle_leden', 1, 1);

-- Mozart Requiem - Lacrimosa materials
INSERT INTO materials (piece_id, stem, type, titel, url, beschrijving, zichtbaar_voor, upload_door, versie) VALUES 
  (4, 'S', 'pdf', 'Lacrimosa - Sopraan', 'https://example.com/mozart-lacrimosa-soprano.pdf', 'Sopraan partituur', 'alle_leden', 1, 1),
  (4, 'A', 'pdf', 'Lacrimosa - Alt', 'https://example.com/mozart-lacrimosa-alto.pdf', 'Alt partituur', 'alle_leden', 1, 1),
  (4, 'T', 'pdf', 'Lacrimosa - Tenor', 'https://example.com/mozart-lacrimosa-tenor.pdf', 'Tenor partituur', 'alle_leden', 1, 1),
  (4, 'B', 'pdf', 'Lacrimosa - Bas', 'https://example.com/mozart-lacrimosa-bass.pdf', 'Bas partituur', 'alle_leden', 1, 1);

-- Rutter - A Gaelic Blessing materials
INSERT INTO materials (piece_id, stem, type, titel, url, beschrijving, zichtbaar_voor, upload_door, versie) VALUES 
  (9, 'SATB', 'pdf', 'A Gaelic Blessing - Volledige Partituur', 'https://example.com/rutter-blessing-full.pdf', 'Complete SATB partituur', 'alle_leden', 1, 1),
  (9, 'S', 'audio', 'A Gaelic Blessing - Sopraan', 'https://example.com/rutter-blessing-soprano.mp3', 'Sopraan oefentrack', 'alle_leden', 1, 1),
  (9, 'A', 'audio', 'A Gaelic Blessing - Alt', 'https://example.com/rutter-blessing-alto.mp3', 'Alt oefentrack', 'alle_leden', 1, 1),
  (9, 'SATB', 'link', 'A Gaelic Blessing - Video', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'Prachtige uitvoering', 'alle_leden', 1, 1);
