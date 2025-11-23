// ICS (iCalendar) Export Utilities
// Generate .ics files compatible with Google Calendar, Outlook, Apple Calendar

interface ICSEvent {
  id: number
  titel: string
  beschrijving?: string
  locatie?: string
  start_at: string
  end_at: string
  url?: string
}

/**
 * Generate ICS file content for a single event
 */
export function generateICS(event: ICSEvent): string {
  const now = new Date()
  const timestamp = formatICSDate(now)
  
  // Parse dates
  const startDate = new Date(event.start_at)
  const endDate = new Date(event.end_at)
  
  // Generate unique UID
  const uid = `event-${event.id}@animato-koor.pages.dev`
  
  // Escape special characters in text fields
  const title = escapeICSText(event.titel)
  const description = escapeICSText(event.beschrijving || '')
  const location = escapeICSText(event.locatie || '')
  
  const icsContent = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Gemengd Koor Animato//Events//NL',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Animato Koor Events',
    'X-WR-TIMEZONE:Europe/Brussels',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${timestamp}`,
    `DTSTART:${formatICSDate(startDate)}`,
    `DTEND:${formatICSDate(endDate)}`,
    `SUMMARY:${title}`,
    description ? `DESCRIPTION:${description}` : '',
    location ? `LOCATION:${location}` : '',
    event.url ? `URL:${event.url}` : '',
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
    'END:VEVENT',
    'END:VCALENDAR'
  ].filter(line => line !== '').join('\r\n')
  
  return icsContent
}

/**
 * Generate ICS file for multiple events
 */
export function generateBulkICS(events: ICSEvent[]): string {
  const now = new Date()
  const timestamp = formatICSDate(now)
  
  const eventBlocks = events.map(event => {
    const startDate = new Date(event.start_at)
    const endDate = new Date(event.end_at)
    const uid = `event-${event.id}@animato-koor.pages.dev`
    const title = escapeICSText(event.titel)
    const description = escapeICSText(event.beschrijving || '')
    const location = escapeICSText(event.locatie || '')
    
    return [
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${timestamp}`,
      `DTSTART:${formatICSDate(startDate)}`,
      `DTEND:${formatICSDate(endDate)}`,
      `SUMMARY:${title}`,
      description ? `DESCRIPTION:${description}` : '',
      location ? `LOCATION:${location}` : '',
      event.url ? `URL:${event.url}` : '',
      'STATUS:CONFIRMED',
      'SEQUENCE:0',
      'END:VEVENT'
    ].filter(line => line !== '').join('\r\n')
  }).join('\r\n')
  
  const icsContent = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Gemengd Koor Animato//Events//NL',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Animato Koor Events',
    'X-WR-TIMEZONE:Europe/Brussels',
    eventBlocks,
    'END:VCALENDAR'
  ].join('\r\n')
  
  return icsContent
}

/**
 * Format date to ICS format: 20250126T193000Z
 */
function formatICSDate(date: Date): string {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  const hours = String(date.getUTCHours()).padStart(2, '0')
  const minutes = String(date.getUTCMinutes()).padStart(2, '0')
  const seconds = String(date.getUTCSeconds()).padStart(2, '0')
  
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`
}

/**
 * Escape special characters for ICS format
 */
function escapeICSText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')  // Backslash
    .replace(/;/g, '\\;')    // Semicolon
    .replace(/,/g, '\\,')    // Comma
    .replace(/\n/g, '\\n')   // Newline
    .replace(/\r/g, '')      // Remove carriage return
}

/**
 * Generate Google Calendar add URL
 */
export function generateGoogleCalendarURL(event: ICSEvent): string {
  const startDate = new Date(event.start_at)
  const endDate = new Date(event.end_at)
  
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.titel,
    dates: `${formatGoogleDate(startDate)}/${formatGoogleDate(endDate)}`,
    details: event.beschrijving || '',
    location: event.locatie || '',
    ctz: 'Europe/Brussels'
  })
  
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

/**
 * Format date for Google Calendar: 20250126T193000
 */
function formatGoogleDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  
  return `${year}${month}${day}T${hours}${minutes}${seconds}`
}
