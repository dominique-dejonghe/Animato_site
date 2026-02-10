-- Migration: Enrich sheet music details
-- Date: 2025-12-16

-- 1. Dance of the Sugar Plum Fairy (Tchaikovsky)
UPDATE works 
SET jaar = 1892, 
    genre = 'Ballet / Klassiek',
    beschrijving = 'Een van de bekendste nummers uit het ballet "De Notenkraker". De dans is geschreven voor de Suikerfee en wordt gekenmerkt door het gebruik van de celesta.'
WHERE titel = 'Dance of the Sugar Plum Fairy';

-- 2. Fragile (Sting)
UPDATE works 
SET jaar = 1987, 
    genre = 'Soft Rock / Jazz Pop',
    beschrijving = 'Een nummer van Sting van zijn album "...Nothing Like the Sun". Het is een eerbetoon aan Ben Linder, een Amerikaanse ingenieur die in Nicaragua werd vermoord.'
WHERE titel = 'Fragile';

-- 3. Your Song (Elton John)
UPDATE works 
SET jaar = 1970, 
    genre = 'Pop / Ballad',
    beschrijving = 'Een klassieke ballad gecomponeerd door Elton John met teksten van Bernie Taupin. Het was Elton John''s eerste grote internationale hit.'
WHERE titel = 'Your Song';

-- 4. Bailamos (Enrique Iglesias)
UPDATE works 
SET jaar = 1999, 
    genre = 'Latin Pop',
    beschrijving = 'Een energieke Latin pop song van Enrique Iglesias, bekend van de soundtrack van de film "Wild Wild West".'
WHERE titel = 'Bailamos';

-- 5. Moon River (Mancini)
UPDATE works 
SET jaar = 1961, 
    genre = 'Filmmuziek / Jazz Standard',
    beschrijving = 'Gecomponeerd door Henry Mancini met tekst van Johnny Mercer. Werd wereldberoemd door Audrey Hepburn in de film "Breakfast at Tiffany''s".'
WHERE titel = 'Moon River';

-- 6. Boogie Woogie Bugle Boy
UPDATE works 
SET jaar = 1941, 
    genre = 'Swing / Jazz',
    beschrijving = 'Een iconisch Tweede Wereldoorlog-nummer, beroemd gemaakt door The Andrews Sisters. Een uptempo swing song over een trompettist in het leger.'
WHERE titel = 'Boogie Woogie Bugle Boy';

-- 7. The Rhythm of Life (Cy Coleman)
UPDATE works 
SET jaar = 1966, 
    genre = 'Musical',
    beschrijving = 'Een krachtig en ritmisch nummer uit de musical "Sweet Charity". Het beschrijft de filosofie van de "Rhythm of Life Church".'
WHERE titel = 'The Rhythm of Life';

-- 8. Life on Mars (Bowie)
UPDATE works 
SET jaar = 1971, 
    genre = 'Glam Rock / Art Pop',
    beschrijving = 'Een surrealistisch nummer van David Bowie van het album "Hunky Dory". Het wordt vaak beschouwd als een van de beste nummers aller tijden.'
WHERE titel = 'Life on Mars';

-- 9. Rollercoaster (Danny Vera)
UPDATE works 
SET jaar = 2019, 
    genre = 'Americana / Country Pop',
    beschrijving = 'Een grote hit van de Nederlandse zanger Danny Vera. Een emotioneel nummer over de ups en downs van het leven.'
WHERE titel = 'Rollercoaster';

-- 10. Celtic Dance (Kirby Shaw)
UPDATE works 
SET jaar = 2000, 
    genre = 'Choral / Folk',
    beschrijving = 'Een koorwerk van Kirby Shaw dat de sfeer van traditionele Ierse dansmuziek oproept, vaak uitgevoerd a cappella of met lichte begeleiding.'
WHERE titel = 'Celtic Dance';

-- 11. Oye Como Va (Tito Puente)
UPDATE works 
SET jaar = 1963, 
    genre = 'Mambo / Latin Rock',
    beschrijving = 'Oorspronkelijk geschreven door Tito Puente, maar wereldwijd populair gemaakt door Santana in 1970. Een klassieker in het Latin-genre.'
WHERE titel = 'Oye Como Va';

-- 12. I''ve Had the Time of My Life
UPDATE works 
SET jaar = 1987, 
    genre = 'Pop / Filmmuziek',
    beschrijving = 'Het themanummer van de film "Dirty Dancing". Oorspronkelijk uitgevoerd door Bill Medley en Jennifer Warnes. Won een Oscar voor Best Original Song.'
WHERE titel = 'I''ve Had the Time of My Life';

-- 13. I Wanna Dance with Somebody
UPDATE works 
SET jaar = 1987, 
    genre = 'Dance-Pop',
    beschrijving = 'Een van de grootste hits van Whitney Houston. Een vrolijk, uptempo nummer dat uitnodigt om te dansen en de liefde te vieren.'
WHERE titel = 'I Wanna Dance with Somebody';
