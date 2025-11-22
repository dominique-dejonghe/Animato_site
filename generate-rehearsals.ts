// Generate recurring rehearsal occurrences
// Run with: npx tsx generate-rehearsals.ts

import { createClient } from '@libsql/client'

const client = createClient({
  url: 'file:.wrangler/state/v3/d1/miniflare-D1DatabaseObject/9c4ee1c45d7be3a6e4e5a8e961aa1b1e3b1e7ce7b1c8c5e9f5e1a8b7c3d9e5f1.sqlite'
})

async function generateRehearsals() {
  // Get parent event
  const parent = await client.execute({
    sql: 'SELECT * FROM events WHERE is_recurring = 1 AND type = ? ORDER BY id DESC LIMIT 1',
    args: ['repetitie']
  })

  if (parent.rows.length === 0) {
    console.log('No parent rehearsal event found')
    return
  }

  const parentEvent = parent.rows[0]
  console.log('Parent event:', parentEvent.titel)

  // Generate occurrences for every Wednesday from now until end of 2026
  const startDate = new Date('2024-11-20T19:30:00')
  const endDate = new Date('2026-12-31')
  
  let currentDate = new Date(startDate)
  let count = 0

  while (currentDate <= endDate) {
    // Check if it's a Wednesday (day 3)
    if (currentDate.getDay() === 3) {
      const startAt = currentDate.toISOString().replace('T', ' ').substring(0, 19)
      const endTime = new Date(currentDate)
      endTime.setHours(21, 0, 0)
      const endAt = endTime.toISOString().replace('T', ' ').substring(0, 19)

      // Insert occurrence
      await client.execute({
        sql: `INSERT INTO events (
          type, titel, beschrijving, start_at, end_at, locatie, 
          is_publiek, parent_event_id, occurrence_date, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          'repetitie',
          'Koorrepetitie',
          'Wekelijkse repetitie voor alle leden. Breng je partituur en een flesje water mee!',
          startAt,
          endAt,
          'Repetitielokaal Animato, Kerkstraat 15',
          1,
          parentEvent.id,
          startAt.split(' ')[0],
          1
        ]
      })

      count++
    }

    // Next day
    currentDate.setDate(currentDate.getDate() + 1)
  }

  console.log(`✅ Generated ${count} rehearsal occurrences`)
}

generateRehearsals()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Error:', error)
    process.exit(1)
  })
