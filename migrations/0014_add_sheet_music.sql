-- Migration: Add sheet music
-- Date: 2025-12-16

-- 1. Dance of the Sugar Plum Fairy
INSERT INTO works (componist, titel, genre) VALUES ('Pyotr Ilyich Tchaikovsky', 'Dance of the Sugar Plum Fairy', 'Klassiek');
INSERT INTO pieces (work_id, titel, nummer) VALUES (last_insert_rowid(), 'Volledig', 1);
INSERT INTO materials (piece_id, stem, type, titel, url, upload_door, is_actief, zichtbaar_voor) 
VALUES (last_insert_rowid(), 'algemeen', 'link', 'Partituur', 'https://drive.google.com/file/d/1GcVa5s0Gj3m_VK3SXczk1HevH0mbYjB8', 1, 1, 'alle_leden');

-- 2. Fragile
INSERT INTO works (componist, titel, genre) VALUES ('Sting', 'Fragile', 'Pop');
INSERT INTO pieces (work_id, titel, nummer) VALUES (last_insert_rowid(), 'Volledig', 1);
INSERT INTO materials (piece_id, stem, type, titel, url, upload_door, is_actief, zichtbaar_voor) 
VALUES (last_insert_rowid(), 'algemeen', 'link', 'Partituur', 'https://drive.google.com/file/d/1bhhYTHs6vb3J1RYxtzr7ohv27kFa-Aik', 1, 1, 'alle_leden');

-- 3. Your Song
INSERT INTO works (componist, titel, genre) VALUES ('Elton John', 'Your Song', 'Pop');
INSERT INTO pieces (work_id, titel, nummer) VALUES (last_insert_rowid(), 'Volledig', 1);
INSERT INTO materials (piece_id, stem, type, titel, url, upload_door, is_actief, zichtbaar_voor) 
VALUES (last_insert_rowid(), 'algemeen', 'link', 'Partituur', 'https://drive.google.com/file/d/1_tIed3VqaC3VylQV1Q8fF35ByhECnCIf', 1, 1, 'alle_leden');

-- 4. Bailamos
INSERT INTO works (componist, titel, genre) VALUES ('Enrique Iglesias', 'Bailamos', 'Latin Pop');
INSERT INTO pieces (work_id, titel, nummer) VALUES (last_insert_rowid(), 'Volledig', 1);
INSERT INTO materials (piece_id, stem, type, titel, url, upload_door, is_actief, zichtbaar_voor) 
VALUES (last_insert_rowid(), 'algemeen', 'link', 'Partituur', 'https://drive.google.com/file/d/164lDTyp6Uw8wOz-qlPTgs4kGxUVGWolL', 1, 1, 'alle_leden');

-- 5. Moon River
INSERT INTO works (componist, titel, genre) VALUES ('Henry Mancini', 'Moon River', 'Filmmuziek');
INSERT INTO pieces (work_id, titel, nummer) VALUES (last_insert_rowid(), 'Volledig', 1);
INSERT INTO materials (piece_id, stem, type, titel, url, upload_door, is_actief, zichtbaar_voor) 
VALUES (last_insert_rowid(), 'algemeen', 'link', 'Partituur', 'https://drive.google.com/file/d/14qFiIwjuBA_fe6LrSAgDmIUEQkkRZe7f', 1, 1, 'alle_leden');

-- 6. Boogie Woogie Bugle Boy
INSERT INTO works (componist, titel, genre) VALUES ('Don Raye & Hughie Prince', 'Boogie Woogie Bugle Boy', 'Jazz/Swing');
INSERT INTO pieces (work_id, titel, nummer) VALUES (last_insert_rowid(), 'Volledig', 1);
INSERT INTO materials (piece_id, stem, type, titel, url, upload_door, is_actief, zichtbaar_voor) 
VALUES (last_insert_rowid(), 'algemeen', 'link', 'Partituur', 'https://drive.google.com/file/d/1sXYURA3upOxmPHCnSeZPTGgXm9HIldlK', 1, 1, 'alle_leden');

-- 7. The Rhythm of Life
INSERT INTO works (componist, titel, genre) VALUES ('Cy Coleman', 'The Rhythm of Life', 'Musical');
INSERT INTO pieces (work_id, titel, nummer) VALUES (last_insert_rowid(), 'Volledig', 1);
INSERT INTO materials (piece_id, stem, type, titel, url, upload_door, is_actief, zichtbaar_voor) 
VALUES (last_insert_rowid(), 'algemeen', 'link', 'Partituur', 'https://drive.google.com/file/d/1RrbyAUUXt9HSyXRR42v00Fqk0545WgFP', 1, 1, 'alle_leden');

-- 8. Life on Mars
INSERT INTO works (componist, titel, genre) VALUES ('David Bowie', 'Life on Mars', 'Rock');
INSERT INTO pieces (work_id, titel, nummer) VALUES (last_insert_rowid(), 'Volledig', 1);
INSERT INTO materials (piece_id, stem, type, titel, url, upload_door, is_actief, zichtbaar_voor) 
VALUES (last_insert_rowid(), 'algemeen', 'link', 'Partituur', 'https://drive.google.com/file/d/18Nm4FC-bSwKiKz9Tm8WvLtXpQ20Nj', 1, 1, 'alle_leden');

-- 9. Rollercoaster
INSERT INTO works (componist, titel, genre) VALUES ('Danny Vera', 'Rollercoaster', 'Pop');
INSERT INTO pieces (work_id, titel, nummer) VALUES (last_insert_rowid(), 'Volledig', 1);
INSERT INTO materials (piece_id, stem, type, titel, url, upload_door, is_actief, zichtbaar_voor) 
VALUES (last_insert_rowid(), 'algemeen', 'link', 'Partituur', 'https://drive.google.com/file/d/1s0sSwQfuejfujWUIxX0emSuQkFoR36aB', 1, 1, 'alle_leden');

-- 10. Celtic Dance
INSERT INTO works (componist, titel, genre) VALUES ('Kirby Shaw', 'Celtic Dance', 'Choral/Folk');
INSERT INTO pieces (work_id, titel, nummer) VALUES (last_insert_rowid(), 'Volledig', 1);
INSERT INTO materials (piece_id, stem, type, titel, url, upload_door, is_actief, zichtbaar_voor) 
VALUES (last_insert_rowid(), 'algemeen', 'link', 'Partituur', 'https://drive.google.com/file/d/1LindMiMLUBJpRzK_r0LmJOBpvFeW1m0Z', 1, 1, 'alle_leden');

-- 11. Oye Como Va
INSERT INTO works (componist, titel, genre) VALUES ('Tito Puente', 'Oye Como Va', 'Latin/Jazz');
INSERT INTO pieces (work_id, titel, nummer) VALUES (last_insert_rowid(), 'Volledig', 1);
INSERT INTO materials (piece_id, stem, type, titel, url, upload_door, is_actief, zichtbaar_voor) 
VALUES (last_insert_rowid(), 'algemeen', 'link', 'Partituur', 'https://drive.google.com/file/d/1fDua_915pF-XV0c6ZS2h9Ly5a27IviQ7', 1, 1, 'alle_leden');

-- 12. I\'ve Had the Time of My Life
INSERT INTO works (componist, titel, genre) VALUES ('Franke Previte', 'I''ve Had the Time of My Life', 'Pop/Filmmuziek');
INSERT INTO pieces (work_id, titel, nummer) VALUES (last_insert_rowid(), 'Volledig', 1);
INSERT INTO materials (piece_id, stem, type, titel, url, upload_door, is_actief, zichtbaar_voor) 
VALUES (last_insert_rowid(), 'algemeen', 'link', 'Partituur', 'https://drive.google.com/file/d/1UCWftWSBY2vgYTbpzGf8ZObNDOXMa0t5', 1, 1, 'alle_leden');

-- 13. I Wanna Dance with Somebody
INSERT INTO works (componist, titel, genre) VALUES ('George Merrill & Shannon Rubicam', 'I Wanna Dance with Somebody', 'Pop');
INSERT INTO pieces (work_id, titel, nummer) VALUES (last_insert_rowid(), 'Volledig', 1);
INSERT INTO materials (piece_id, stem, type, titel, url, upload_door, is_actief, zichtbaar_voor) 
VALUES (last_insert_rowid(), 'algemeen', 'link', 'Partituur', 'https://drive.google.com/file/d/18E5wBpQ7bWBlIs5zeYeI87Fl5jPezTB3', 1, 1, 'alle_leden');
