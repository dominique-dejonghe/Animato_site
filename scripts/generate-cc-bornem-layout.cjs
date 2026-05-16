// Generates a SQL migration for CC Ter Dilft Bornem seating plan.
// Based on the curved-fan layout reference image (rows A-S, ONEVEN/EVEN sections,
// podium at the bottom, two side wings, two small wheelchair sections up front).
//
// CC Ter Dilft has 514 fixed seats + ~42 removable seats. We'll model 514 fixed.
// Layout: curved rows A (closest to podium) → S (back), split by central aisle
// into ONEVEN (odd, left from audience POV) and EVEN (right). Plus 2 side wings.
//
// Output: writes migration SQL to migrations/0072_cc_bornem_seating_plan.sql

const fs = require('fs');
const path = require('path');

const CANVAS_W = 1100;
const CANVAS_H = 800;

// Stage at the bottom; rows curve upward.
const STAGE_Y = 760;        // bottom of canvas
const FIRST_ROW_Y = 220;    // y of row A (front)
const ROW_SPACING = 28;     // pixels between rows
const SEAT_SPACING = 26;    // pixels between seats horizontally
const CENTER_GAP = 60;      // gap for central aisle (odd | even split)

// Rows A through S (skip I to avoid confusion with 1, common theater convention)
const ROW_LABELS = ['A','B','C','D','E','F','G','H','J','K','L','M','N','O','P','Q','R','S'];

// Per-row seat counts (curved: wider rows in the middle/back)
// Tuned so total ≈ 460 in main floor; side wings + back = ~514 total
const SEATS_PER_ROW = {
  A: 20, B: 22, C: 24, D: 24, E: 26, F: 26, G: 28, H: 28,
  J: 28, K: 30, L: 30, M: 30, N: 30, O: 30, P: 28, Q: 28, R: 26, S: 24
};

// Center x of the canvas
const CX = CANVAS_W / 2;

// Curvature: rows curve gently upward at the edges (concave-up arc)
// Larger radius = flatter curve. We use a big radius to mimic the reference.
const ARC_RADIUS = 1400;

// Map a column index within a row to (x, y) along a curved row.
// rowIdx 0 = front row (A), N-1 = back row (S)
function seatPositionInRow(rowIdx, rowLen, colIdx, side /* 'odd' | 'even' */) {
  const baseY = FIRST_ROW_Y + rowIdx * ROW_SPACING;
  const half = rowLen / 2;
  // Within one side, seats are spaced from center-out
  const offsetFromCenter = (colIdx + 0.5) * SEAT_SPACING + CENTER_GAP / 2;
  const x = side === 'odd' ? CX - offsetFromCenter : CX + offsetFromCenter;

  // Apply slight curve: outer seats sit slightly higher (smaller y) than inner ones
  // distance from center → curve drop
  const dx = Math.abs(x - CX);
  const dy = ARC_RADIUS - Math.sqrt(ARC_RADIUS * ARC_RADIUS - dx * dx);
  const y = baseY - dy; // outer seats higher (lower y)

  return { x: Math.round(x), y: Math.round(y) };
}

const seats = [];

// MAIN FLOOR — curved fan, split into ONEVEN (left) and EVEN (right)
ROW_LABELS.forEach((row, rowIdx) => {
  const total = SEATS_PER_ROW[row];
  const perSide = Math.floor(total / 2);

  // ONEVEN (odd): seat numbers 1, 3, 5, ... from center outward
  for (let i = 0; i < perSide; i++) {
    const pos = seatPositionInRow(rowIdx, total, i, 'odd');
    const seatNum = (i * 2 + 1); // 1, 3, 5, ...
    seats.push({
      section: 'Oneven',
      row_label: row,
      seat_number: String(seatNum),
      x: pos.x,
      y: pos.y,
      type: 'standard'
    });
  }
  // EVEN: seat numbers 2, 4, 6, ... from center outward
  for (let i = 0; i < perSide; i++) {
    const pos = seatPositionInRow(rowIdx, total, i, 'even');
    const seatNum = (i * 2 + 2); // 2, 4, 6, ...
    seats.push({
      section: 'Even',
      row_label: row,
      seat_number: String(seatNum),
      x: pos.x,
      y: pos.y,
      type: 'standard'
    });
  }
});

// LEFT WING — small block hugging the wall on the audience-left side
// 4 rows of 4 seats each, lettered W (Wing)
const WING_LEFT_X = 60;
const WING_TOP_Y = 320;
for (let r = 0; r < 4; r++) {
  for (let c = 0; c < 4; c++) {
    seats.push({
      section: 'Zijvleugel Links',
      row_label: `WL${r + 1}`,
      seat_number: String(c + 1),
      x: WING_LEFT_X + c * 24,
      y: WING_TOP_Y + r * 28,
      type: 'standard'
    });
  }
}

// RIGHT WING — mirror of left
const WING_RIGHT_X = CANVAS_W - 60 - 3 * 24;
for (let r = 0; r < 4; r++) {
  for (let c = 0; c < 4; c++) {
    seats.push({
      section: 'Zijvleugel Rechts',
      row_label: `WR${r + 1}`,
      seat_number: String(c + 1),
      x: WING_RIGHT_X + c * 24,
      y: WING_TOP_Y + r * 28,
      type: 'standard'
    });
  }
}

// TWO SMALL SECTIONS FRONT — wheelchair / accessibility blocks near the podium
// Left block (in front of stage, audience-left)
const WC_LEFT_X = CX - 220;
const WC_Y = 700;
for (let i = 0; i < 4; i++) {
  seats.push({
    section: 'Rolstoel Links',
    row_label: 'RL',
    seat_number: String(i + 1),
    x: WC_LEFT_X + i * 32,
    y: WC_Y,
    type: 'wheelchair'
  });
}
// Right block
const WC_RIGHT_X = CX + 220 - 3 * 32;
for (let i = 0; i < 4; i++) {
  seats.push({
    section: 'Rolstoel Rechts',
    row_label: 'RR',
    seat_number: String(i + 1),
    x: WC_RIGHT_X + i * 32,
    y: WC_Y,
    type: 'wheelchair'
  });
}

console.log(`Generated ${seats.length} seats.`);
const mainFloor = seats.filter(s => s.section === 'Oneven' || s.section === 'Even').length;
const wings = seats.filter(s => s.section.startsWith('Zijvleugel')).length;
const wheelchairs = seats.filter(s => s.type === 'wheelchair').length;
console.log(`  Main floor (Oneven+Even): ${mainFloor}`);
console.log(`  Side wings: ${wings}`);
console.log(`  Wheelchair: ${wheelchairs}`);

// Build SQL
let sql = `-- Migration: CC Ter Dilft Bornem seating plan seed
-- Date: 2026-05-16
-- Description: Inserts the CC Bornem (Ter Dilft schouwburg, 514 seats) seating plan
-- with curved fan layout, ONEVEN/EVEN central sections, 2 side wings,
-- and 2 wheelchair sections near the podium.
-- Idempotent: only inserts if no plan with name 'CC Ter Dilft Bornem' exists.

-- Insert the plan only if it doesn't exist yet
INSERT INTO seating_plans (name, description, width, height, is_active)
SELECT
  'CC Ter Dilft Bornem',
  'Schouwburg CC Ter Dilft Bornem — gebogen waaiervorm met centrale Oneven/Even-secties, 2 zijvleugels en 2 rolstoelsecties vooraan. Capaciteit ${seats.length} stoelen.',
  ${CANVAS_W},
  ${CANVAS_H},
  1
WHERE NOT EXISTS (SELECT 1 FROM seating_plans WHERE name = 'CC Ter Dilft Bornem');

-- Clear any existing seats for this plan (safe re-run)
DELETE FROM seats WHERE plan_id = (SELECT id FROM seating_plans WHERE name = 'CC Ter Dilft Bornem');

-- Insert all seats
`;

// Batch insert in chunks of 50 (D1 has statement size limits)
const CHUNK = 50;
for (let i = 0; i < seats.length; i += CHUNK) {
  const chunk = seats.slice(i, i + CHUNK);
  const values = chunk.map(s =>
    `((SELECT id FROM seating_plans WHERE name = 'CC Ter Dilft Bornem'), ` +
    `'${s.section}', '${s.row_label}', '${s.seat_number}', ${s.x}, ${s.y}, '${s.type}', 'available')`
  ).join(',\n  ');
  sql += `INSERT INTO seats (plan_id, section_name, row_label, seat_number, x, y, type, status) VALUES\n  ${values};\n\n`;
}

const outPath = path.join(__dirname, '..', 'migrations', '0072_cc_bornem_seating_plan.sql');
fs.writeFileSync(outPath, sql);
console.log(`\n✓ Wrote ${outPath}`);
console.log(`  Total seats inserted: ${seats.length}`);
