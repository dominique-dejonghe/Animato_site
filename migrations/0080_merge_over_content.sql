-- Migration 0080: merge /koor + /over content in editable_pages.over
--
-- Achtergrond: tot nu toe waren er DRIE "Over ons" varianten:
--   1. /koor → hardcoded HTML in public.tsx (rijk: dirigent-foto, CTA, missie)
--   2. /over → renderde uit editable_pages.over (DB had historie sinds 1988,
--             concerten 2014/2018/2019, kortere versie)
--   3. /admin/paginas/over → bewerkte alleen variant 2
--
-- Beslissing: /over wordt canonical, /koor wordt redirect.
-- Deze migratie zet de gemergde rijke content in editable_pages.over zodat
-- niets verloren gaat én alles bewerkbaar wordt vanuit /admin/paginas.

UPDATE editable_pages
SET
  titel = 'Over Gemengd Koor Animato',
  intro = 'Sinds 1988 brengt Gemengd Koor Animato uit Oppuurs muziek tot leven met passie, vakmanschap en toewijding. Een zestig-tal enthousiaste zangers en zangeressen die wekelijks samenkomen om te repeteren en te groeien als ensemble.',
  body = '<h2>Onze Geschiedenis</h2>
<p>Gemengd Koor Animato werd opgericht in 1988 in het Klein-Brabantse Oppuurs. Wat begon als een kleine groep enthousiaste zangers is uitgegroeid tot een ensemble van een zestig-tal stemmen.</p>
<p>In 2013 vierde het koor zijn 25-jarig bestaan met een feestelijk jubileumconcert. In 2014 brachten we Karl Jenkins'' indrukwekkende werk <em>The Peacemakers</em> met groot orkest. In september 2018 deelden we het podium met Eurovisie-zanggroep Ishtar.</p>
<p>Een hoogtepunt was de gezamenlijke uitvoering van Karl Jenkins'' <em>The Armed Man</em> in september 2019, samen met het Mechels Harmonie Orkest, Korokan en Laudate.</p>

<h2>Onze Missie</h2>
<p>Bij Animato geloven we in de kracht van samen musiceren. Onze missie is om hoogwaardige koormuziek te brengen, van klassieke meesterwerken tot moderne composities, en om tegelijkertijd een warme, inclusieve gemeenschap te creëren waar iedereen welkom is.</p>

<h2>Repertoire</h2>
<p>Ons repertoire is veelzijdig en uitdagend. We brengen werken van componisten zoals Mozart, Fauré, Rutter, Poulenc en vele anderen. Van renaissance-polyfonie tot hedendaagse muziek, van geestelijke muziek tot wereldlijke liederen — onze programmering is altijd verrassend en boeiend. Daarnaast brengen we ook musical, pop, gospel en wereldmuziek.</p>

<h2>Dirigent & Begeleiding</h2>
<figure style="float: right; max-width: 280px; margin: 0 0 1rem 1.5rem;">
  <img src="/static/images/dirigent.jpg" alt="Anja Holbrechts — Dirigent van Animato" style="width: 100%; border-radius: 0.5rem; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1);" loading="lazy" />
  <figcaption style="text-align: center; font-size: 0.875rem; color: #6b7280; margin-top: 0.5rem; font-style: italic;">Anja Holbrechts — Dirigent</figcaption>
</figure>
<blockquote><em>"Zingen is gezond, het kan zelfs zorgen voor een gezonder hart- en vaatstelsel."</em><br><strong>— Anja Holbrechts</strong></blockquote>
<p>Animato staat reeds meer dan <strong>10 jaar</strong> onder de deskundige leiding van <strong>Anja Holbrechts</strong>. Zij behaalde het diploma <em>"Meester in de muziek"</em> voor trombone in het conservatorium van Gent bij Michel Tilkin.</p>
<p>Anja volgde verder:</p>
<ul>
  <li>Orkestdirectie bij Dirk Brossé en Eddy Van Oosthuyse</li>
  <li>Euphonium bij Staf DeVolder en Bart Van Neyghem</li>
</ul>
<p>Onder haar bezielende leiding en met ondersteuning van professionele muzikanten, werken we aan een verfijnde koorklank en muzikale expressie. Regelmatige stemgroeprepeties en workshops zorgen voor continue groei en ontwikkeling.</p>
<p style="clear: both;">Anja initieerde ook ambitieuze projecten zoals <em>"The Peacemakers"</em> (Karl Jenkins, 2014) en <em>"The Armed Man"</em> (Karl Jenkins, 2019, samen met het Mechels Harmonie Orkest).</p>

<h2>Concerten & Optredens</h2>
<p>Jaarlijks verzorgen we meerdere concerten in prachtige locaties. Van intieme kerkconcerten tot grootse uitvoeringen in concertzalen, elk optreden is een feest voor koor en publiek.</p>

<div style="margin-top: 2rem; padding: 1.5rem; background: rgba(59, 130, 246, 0.08); border-radius: 0.75rem;">
<h3>Interesse om mee te zingen?</h3>
<p>We zijn altijd op zoek naar nieuwe leden in alle stemgroepen (Sopraan, Alt, Tenor, Bas). Geen audities vereist, gewoon passie voor zingen!</p>
<p><a href="/word-lid" style="display: inline-block; background: #f59e0b; color: white; padding: 0.75rem 2rem; border-radius: 0.5rem; font-weight: 600; text-decoration: none;">Word Lid</a></p>
</div>',
  updated_at = CURRENT_TIMESTAMP
WHERE slug = 'over';
