"""
Genereer migration SQL voor het ÉCHTE zaalplan Ter Dilft.

Geometrie:
- Gebogen waaier: rijen lopen in concentrische bogen rond een denkbeeldig
  middelpunt achter het podium.
- Center-x = 550 (canvas breedte 1100)
- Podium-y = 180 (bovenkant podium-uitsparing, op canvas)
- Rijen A→S: y groeit van vooraan (190) naar achteren (700)
- Stoelafstand horizontaal: 26 px
- Lichte boog: stoelen aan de buitenkant zitten ietsje hoger (y kleiner)
  ----> elke stoel-x afwijking van center geeft -0.03 * dx² aan y
"""

# Rij-config: (rij_letter, links_aantal, midden_aantal, rechts_aantal, comment)
# Conventie: oneven nummers (1,3,5,...) links van centerline, even (2,4,6,...) rechts
# Midden = doorlopende centrale strook (rij A-S allemaal)
# Links/rechts = zijvleugel-stoelen (alleen rij G-S)
ROWS = [
    # rij  links_zijvl  midden  rechts_zijvl  rij_y_offset (basis 190 + 28*idx)
    ('A',  0,  12, 0),   # voorste (klein, vlak bij podium)
    ('B',  0,  19, 0),   # 14 actief + 5 grijs (geblocked rechts)
    ('C',  0,  18, 0),
    ('D',  0,  18, 0),
    ('E',  0,  20, 0),
    ('F',  0,  20, 0),
    ('G',  2,  22, 2),   # zijvleugels beginnen hier
    ('H',  3,  22, 3),   # H heeft 1 grijze stip per zijde
    ('I',  3,  22, 4),   # I heeft 1 witte (companion) rechts
    ('J',  4,  22, 4),
    ('K',  4,  22, 4),
    ('L',  5,  22, 5),
    ('M',  5,  22, 5),
    ('N',  5,  22, 5),
    ('O',  6,  22, 6),
    ('P',  6,  22, 6),   # 3 VIP-stoelen midden (regio rond center)
    ('Q',  6,  22, 6),   # 8 rolstoelplaatsen midden (regio links-midden)
    ('R',  6,  22, 6),
    ('S',  6,  22, 6),   # achterste rij — veel grijs (geblocked)
]

CENTER_X = 550
ROW_Y_START = 220
ROW_Y_STEP = 28
SEAT_X_STEP = 26          # horizontale spacing center stoelen
WING_GAP = 24             # extra ruimte tussen midden en zijvleugel (gangpad)
# Curve conventie van bestaande zalen (zie migration 0072):
# uiteinden van een rij krullen NAAR HET PODIUM toe = kleinere y aan de buitenkant.
# Dit is consistent met de UI-renderer (podium bovenaan, kleinere y = vooraan).
# Formule: dy = -CURVE_FACTOR_PX * dx²  (negatief omdat hoger op canvas = kleinere y)
CURVE_FACTOR_PX = 0.0005  # pixels-naar-pixels, gekalibreerd vs migration 0072

# Geblokkeerde stoelen (status='blocked') — uit foto-observatie
BLOCKED = {
    # (rij, sectie, nummer) — let op nummering: oneven links, even rechts
    # Rij B: 5 grijze stippen aan rechterkant (rechtsachter)
    ('B', 'Midden', 12), ('B', 'Midden', 14), ('B', 'Midden', 16),
    ('B', 'Midden', 18), ('B', 'Midden', 20),
    # Rij H: 1 grijs links + 1 grijs rechts (op de zijvleugel buitenrand)
    ('H', 'Zijvleugel Links', 5),   # buitenste oneven nr van H-links
    ('H', 'Zijvleugel Rechts', 6),  # buitenste even nr van H-rechts
    # Rij S: veel grijs — 5 links, 6 midden, 5 rechts. Voor hands-off start:
    # 5 buitenste links, 5 buitenste rechts, 6 midden-achter geblokkeerd
    ('S', 'Zijvleugel Links', 3), ('S', 'Zijvleugel Links', 5),
    ('S', 'Zijvleugel Links', 7), ('S', 'Zijvleugel Links', 9),
    ('S', 'Zijvleugel Links', 11),
    ('S', 'Zijvleugel Rechts', 2), ('S', 'Zijvleugel Rechts', 4),
    ('S', 'Zijvleugel Rechts', 6), ('S', 'Zijvleugel Rechts', 8),
    ('S', 'Zijvleugel Rechts', 10),
    ('S', 'Midden', 7), ('S', 'Midden', 9), ('S', 'Midden', 11),
    ('S', 'Midden', 13), ('S', 'Midden', 15), ('S', 'Midden', 17),
}

# Rolstoelplaatsen (type='wheelchair') — 8 stoelen op rij Q in het midden
# Foto toont ze als 8 witte cirkels nét links van center op rij Q.
# Vervang de 8 binnenste midden-stoelen aan de oneven-kant.
WHEELCHAIRS = {
    ('Q', 'Midden', 1), ('Q', 'Midden', 3), ('Q', 'Midden', 5),
    ('Q', 'Midden', 7), ('Q', 'Midden', 9), ('Q', 'Midden', 11),
    ('Q', 'Midden', 13), ('Q', 'Midden', 15),
}

# Companion (begeleider) stoelen — 1 wit rechts op rij I
COMPANIONS = {
    ('I', 'Zijvleugel Rechts', 8),  # buitenste companion-stoel rij I
}

# VIP-stoelen: rij P, 3 lichtgroene rond center
# Markeren via category_id (we gebruiken een hard-coded "1" als VIP categorie marker;
# de echte category_id kan later worden ingesteld via admin). Voor nu geven we ze
# een aparte INSERT-flag zodat we ze kunnen identificeren.
VIPS = {
    ('P', 'Midden', 1), ('P', 'Midden', 2), ('P', 'Midden', 3),
}


def compute_y(base_y: int, x_offset_from_center: int) -> int:
    """Lichte waaier-boog: hoe verder van center, hoe iets hoger (kleinere y).
    
    Consistent met UI-conventie en migration 0072: rij-uiteinden krullen naar
    het podium toe (concave). Bv. voor rij A is midden y=220, en 6 stoelen
    naar buiten (dx=156 px) levert dy = -0.0005 * 156² = -12 px → y=208.
    """
    return int(round(base_y - CURVE_FACTOR_PX * x_offset_from_center ** 2))


def gen_row(idx: int, label: str, n_left: int, n_mid: int, n_right: int):
    """Genereer alle stoelen voor één rij. Yields (sectie, nummer, x, y, type, status)."""
    base_y = ROW_Y_START + idx * ROW_Y_STEP

    # === Middensectie ===
    # n_mid stoelen verdeeld rond CENTER_X
    # Oneven links (1,3,5,...), even rechts (2,4,6,...)
    # Bij even aantal stoelen: n_mid/2 links + n_mid/2 rechts, symmetrisch
    # Bij oneven aantal: stoel "1" zit links van center (klein offset),
    #                    laatste rechtse stoel is bv. (n_mid)
    half = n_mid // 2
    extra = n_mid % 2  # 0 of 1
    # Linkse kant: oneven nummers 1,3,...,2*half-1 + 1 (als extra=1) ook nr 2*half+1
    n_left_mid = half + extra
    n_right_mid = half

    # Genereer linkse oneven seats van center naar buiten
    for i in range(n_left_mid):
        seat_num = 2 * i + 1
        # offset: i=0 → -SEAT_X_STEP/2, i=1 → -SEAT_X_STEP*1.5, ...
        dx = -(i + 0.5) * SEAT_X_STEP
        x = int(round(CENTER_X + dx))
        y = compute_y(base_y, int(dx))
        yield ('Midden', seat_num, x, y)

    # Genereer rechtse even seats van center naar buiten
    for i in range(n_right_mid):
        seat_num = 2 * (i + 1)
        dx = (i + 0.5) * SEAT_X_STEP
        x = int(round(CENTER_X + dx))
        y = compute_y(base_y, int(dx))
        yield ('Midden', seat_num, x, y)

    # === Zijvleugel Links ===
    # Begint links van het uiterste midden-stoel + WING_GAP
    if n_left > 0:
        # Berekening: laatste linkse midden-stoel zat op CENTER_X - (n_left_mid - 0.5) * SEAT_X_STEP
        leftmost_mid_x = CENTER_X - (n_left_mid - 0.5) * SEAT_X_STEP
        # Zijvleugel oneven nummering: 1,3,5,... van binnen (dichtst bij midden) naar buiten
        for i in range(n_left):
            seat_num = 2 * i + 1
            dx_from_wing_start = -(i + 0.5) * SEAT_X_STEP
            x_offset = leftmost_mid_x - WING_GAP + dx_from_wing_start
            x = int(round(x_offset))
            y = compute_y(base_y, int(x - CENTER_X))
            yield ('Zijvleugel Links', seat_num, x, y)

    # === Zijvleugel Rechts ===
    if n_right > 0:
        rightmost_mid_x = CENTER_X + (n_right_mid - 0.5) * SEAT_X_STEP
        for i in range(n_right):
            seat_num = 2 * (i + 1)
            dx_from_wing_start = (i + 0.5) * SEAT_X_STEP
            x_offset = rightmost_mid_x + WING_GAP + dx_from_wing_start
            x = int(round(x_offset))
            y = compute_y(base_y, int(x - CENTER_X))
            yield ('Zijvleugel Rechts', seat_num, x, y)


def determine_attrs(row: str, sec: str, num: int):
    """Bepaal (type, status, is_vip) voor een stoel."""
    key = (row, sec, num)
    typ = 'standard'
    status = 'available'
    is_vip = False

    if key in WHEELCHAIRS:
        typ = 'wheelchair'
    elif key in COMPANIONS:
        typ = 'companion'
    if key in BLOCKED:
        status = 'blocked'
    if key in VIPS:
        is_vip = True
    return typ, status, is_vip


# === Generate SQL ===
out_lines = []
out_lines.append("""-- ============================================================================
-- Migration 0105: ECHT zaalplan CC Ter Dilft Bornem (vervangt oude versie)
-- Date: 2026-06-28
-- Description: Vervangt het zaalplan voor CC Ter Dilft Bornem met de échte
-- layout zoals afgebeeld op de officiële zaalfoto:
--   • 19 rijen A→S (rij I ontbrak in vorige versie)
--   • Rij A-F: doorlopende middensectie (geen Oneven/Even splitsing vooraan)
--   • Rij G-S: midden + zijvleugels (zijvleugels GROEIEN van 2→6 per kant)
--   • Rij P: 3 VIP-stoelen in het midden (markeerbaar via category_id)
--   • Rij Q: 8 rolstoelplaatsen midden (type='wheelchair')
--   • Rij I: 1 begeleidersplaats rechts (type='companion')
--   • Rij B, H, S: geblokkeerde stoelen (status='blocked') zoals op foto
--   • Oneven/Even nummering behouden (1,3,5... links / 2,4,6... rechts)
--   • Gebogen waaiervorm via lichte x/y curve-correctie
--
-- VEILIG: bij stand 2026-06-28 zijn er 0 verkochte ticket_seats voor dit plan
-- (gecheckt via 'SELECT COUNT(*) FROM ticket_seats ts JOIN seats s ON s.id=ts.seat_id
--  WHERE s.plan_id = (SELECT id FROM seating_plans WHERE name = 'CC Ter Dilft Bornem')'
--  → 0). Geen actief concert gebruikt dit plan (alleen concert 7 → plan 1).
--
-- IDEMPOTENT: DELETE+INSERT pattern. Bij herstart wordt het plan volledig
-- opnieuw opgebouwd. Geen impact op seating_plans-row zelf (UPDATE op naam/desc).
-- ============================================================================

-- Update plan metadata
UPDATE seating_plans
SET description = 'Schouwburg CC Ter Dilft Bornem — gebogen waaiervorm volgens officiële zaalfoto. 19 rijen A-S, doorlopende middensectie vooraan (rij A-F), zijvleugels groeiend in rij G-S, 8 rolstoelplaatsen op rij Q, 1 begeleidersplaats rij I, 3 VIP-stoelen rij P.',
    width = 1100,
    height = 800
WHERE name = 'CC Ter Dilft Bornem';

-- Verwijder oude stoelen
DELETE FROM seats WHERE plan_id = (SELECT id FROM seating_plans WHERE name = 'CC Ter Dilft Bornem');

-- Nieuwe stoelen (gegenereerd door scripts/gen_ter_dilft_plan.py)
""")

vip_keys = []
seat_count = 0
blocked_count = 0
wheelchair_count = 0
companion_count = 0
vip_count = 0

for idx, (label, n_left, n_mid, n_right) in enumerate(ROWS):
    out_lines.append(f"-- Rij {label} ({n_left} links + {n_mid} midden + {n_right} rechts = {n_left + n_mid + n_right} stoelen)")
    insert_values = []
    for sec, num, x, y in gen_row(idx, label, n_left, n_mid, n_right):
        typ, status, is_vip = determine_attrs(label, sec, num)
        seat_count += 1
        if status == 'blocked': blocked_count += 1
        if typ == 'wheelchair': wheelchair_count += 1
        if typ == 'companion': companion_count += 1
        if is_vip:
            vip_count += 1
            vip_keys.append((label, sec, num))
        insert_values.append(
            f"((SELECT id FROM seating_plans WHERE name = 'CC Ter Dilft Bornem'), "
            f"'{sec}', '{label}', '{num}', {x}, {y}, '{typ}', '{status}')"
        )
    # Split in chunks of 50
    chunk_size = 50
    for i in range(0, len(insert_values), chunk_size):
        chunk = insert_values[i:i+chunk_size]
        out_lines.append(
            "INSERT INTO seats (plan_id, section_name, row_label, seat_number, x, y, type, status) VALUES\n  " +
            ",\n  ".join(chunk) + ";"
        )
    out_lines.append("")

# Footer
out_lines.append("-- VIP-stoelen (rij P midden, nrs 1/2/3) — markeer via comment.")
out_lines.append("-- (Echte category_id wordt later via admin gekoppeld zodra prijscategorieën bestaan.)")
out_lines.append("-- Identificeerbaar via: SELECT id FROM seats WHERE plan_id=(SELECT id FROM seating_plans WHERE name='CC Ter Dilft Bornem') AND row_label='P' AND section_name='Midden' AND seat_number IN ('1','2','3');")
out_lines.append("")
out_lines.append(f"-- Totaal: {seat_count} stoelen | {blocked_count} blocked | {wheelchair_count} rolstoel | {companion_count} companion | {vip_count} VIP")

with open('migrations/0105_ter_dilft_real_seating_plan.sql', 'w') as f:
    f.write("\n".join(out_lines))

print(f"=== Generated migrations/0105_ter_dilft_real_seating_plan.sql ===")
print(f"Total seats: {seat_count}")
print(f"  - blocked: {blocked_count}")
print(f"  - wheelchair: {wheelchair_count}")
print(f"  - companion: {companion_count}")
print(f"  - VIP: {vip_count}")
print(f"  - standard (rest): {seat_count - blocked_count - wheelchair_count - companion_count}")
