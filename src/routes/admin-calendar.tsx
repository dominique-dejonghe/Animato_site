// Admin Calendar View
// Visual calendar with month/week views for events

import { Hono } from 'hono'
import type { Bindings, SessionUser } from '../types'
import { Layout } from '../components/Layout'
import { requireAuth, requireRole } from '../middleware/auth'
import { queryAll, noCacheHeaders } from '../utils/db'

const app = new Hono<{ Bindings: Bindings }>()

// Apply auth middleware
app.use('*', requireAuth)
app.use('*', requireRole('admin', 'moderator'))

// =====================================================
// CALENDAR VIEW
// =====================================================

app.get('/admin/calendar', async (c) => {
  const user = c.get('user') as SessionUser
  const view = c.req.query('view') || 'month'
  const dateParam = c.req.query('date') || new Date().toISOString().split('T')[0]
  
  const currentDate = new Date(dateParam)
  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()
  
  // Get start and end of calendar view range
  let startDate: Date, endDate: Date
  
  if (view === 'week') {
    // Week view: Monday to Sunday
    const day = currentDate.getDay()
    const diff = currentDate.getDate() - day + (day === 0 ? -6 : 1) // Adjust for Monday start
    startDate = new Date(currentDate.setDate(diff))
    endDate = new Date(startDate)
    endDate.setDate(startDate.getDate() + 6)
  } else {
    // Month view: First day of month to last day
    startDate = new Date(year, month, 1)
    endDate = new Date(year, month + 1, 0)
    
    // Extend to full weeks for calendar grid
    const firstDay = startDate.getDay()
    const lastDay = endDate.getDay()
    
    // Adjust to Monday start
    const mondayDiff = firstDay === 0 ? -6 : -(firstDay - 1)
    startDate.setDate(startDate.getDate() + mondayDiff)
    
    const sundayDiff = lastDay === 0 ? 0 : 7 - lastDay
    endDate.setDate(endDate.getDate() + sundayDiff)
  }
  
  // Query events in date range
  const events = await queryAll(
    c.env.DB,
    `SELECT e.*, l.naam as locatie_naam, l.stad as locatie_stad,
            COUNT(DISTINCT ea.id) as aanmeldingen
     FROM events e
     LEFT JOIN locations l ON l.id = e.location_id
     LEFT JOIN event_attendance ea ON ea.event_id = e.id AND ea.status = 'aanwezig'
     WHERE DATE(e.start_at) >= DATE(?) AND DATE(e.start_at) <= DATE(?)
     GROUP BY e.id
     ORDER BY e.start_at ASC`,
    [startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]]
  )
  
  // Group events by date
  const eventsByDate: Record<string, any[]> = {}
  events.forEach((event: any) => {
    const eventDate = new Date(event.start_at).toISOString().split('T')[0]
    if (!eventsByDate[eventDate]) {
      eventsByDate[eventDate] = []
    }
    eventsByDate[eventDate].push(event)
  })
  
  // Disable caching
  noCacheHeaders(c)
  
  return c.html(
    <Layout 
      title="Kalender"
      user={user}
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Kalender', href: '/admin/calendar' }
      ]}
    >
      {renderCalendarView(view, currentDate, eventsByDate, startDate, endDate)}
    </Layout>
  )
})

function renderCalendarView(
  view: string, 
  currentDate: Date, 
  eventsByDate: Record<string, any[]>,
  startDate: Date,
  endDate: Date
) {
  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()
  const today = new Date().toISOString().split('T')[0]
  
  // Navigation dates
  const prevMonth = new Date(year, month - 1, 1)
  const nextMonth = new Date(year, month + 1, 1)
  const prevWeek = new Date(currentDate)
  prevWeek.setDate(prevWeek.getDate() - 7)
  const nextWeek = new Date(currentDate)
  nextWeek.setDate(nextWeek.getDate() + 7)
  
  const monthNames = ['Januari', 'Februari', 'Maart', 'April', 'Mei', 'Juni', 'Juli', 'Augustus', 'September', 'Oktober', 'November', 'December']
  const dayNames = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo']
  
  return (
    <div class="bg-gray-50 min-h-screen">
      {/* Header */}
      <div class="bg-white border-b border-gray-200">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div class="flex items-center justify-between">
            <div>
              <h1 class="text-3xl font-bold text-gray-900" style="font-family: 'Playfair Display', serif;">
                <i class="fas fa-calendar-alt text-purple-600 mr-3"></i>
                Kalender
              </h1>
              <p class="mt-2 text-gray-600">
                {view === 'month' ? monthNames[month] : 'Week'} {year}
              </p>
            </div>
            <div class="flex items-center gap-3">
              <a href="/admin/events" class="px-4 py-2 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg transition">
                <i class="fas fa-list mr-2"></i>
                Lijst Weergave
              </a>
              <a href="/admin/events/nieuw" class="px-4 py-2 bg-animato-primary text-white hover:bg-animato-secondary rounded-lg transition">
                <i class="fas fa-plus mr-2"></i>
                Nieuwe Activiteit
              </a>
            </div>
          </div>
        </div>
      </div>

      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* Calendar Controls */}
        <div class="bg-white rounded-lg shadow-md p-4 mb-6">
          <div class="flex items-center justify-between">
            {/* View Toggle */}
            <div class="flex gap-2">
              <a 
                href={`/admin/calendar?view=month&date=${currentDate.toISOString().split('T')[0]}`}
                class={`px-4 py-2 rounded-lg transition ${
                  view === 'month' 
                    ? 'bg-animato-primary text-white' 
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <i class="fas fa-calendar mr-2"></i>Maand
              </a>
              <a 
                href={`/admin/calendar?view=week&date=${currentDate.toISOString().split('T')[0]}`}
                class={`px-4 py-2 rounded-lg transition ${
                  view === 'week' 
                    ? 'bg-animato-primary text-white' 
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <i class="fas fa-calendar-week mr-2"></i>Week
              </a>
            </div>

            {/* Navigation */}
            <div class="flex items-center gap-4">
              <a 
                href={`/admin/calendar?view=${view}&date=${view === 'month' ? prevMonth.toISOString().split('T')[0] : prevWeek.toISOString().split('T')[0]}`}
                class="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition"
              >
                <i class="fas fa-chevron-left"></i>
              </a>
              
              <a 
                href={`/admin/calendar?view=${view}&date=${new Date().toISOString().split('T')[0]}`}
                class="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition font-medium"
              >
                Vandaag
              </a>
              
              <a 
                href={`/admin/calendar?view=${view}&date=${view === 'month' ? nextMonth.toISOString().split('T')[0] : nextWeek.toISOString().split('T')[0]}`}
                class="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition"
              >
                <i class="fas fa-chevron-right"></i>
              </a>
            </div>

            {/* Current Date Display */}
            <div class="text-lg font-semibold text-gray-900">
              {monthNames[month]} {year}
            </div>
          </div>
        </div>

        {/* Calendar Grid */}
        <div class="bg-white rounded-lg shadow-md overflow-hidden">
          {view === 'month' 
            ? renderMonthView(startDate, endDate, eventsByDate, today, currentDate)
            : renderWeekView(startDate, endDate, eventsByDate, today)
          }
        </div>

        {/* Legend */}
        <div class="mt-6 bg-white rounded-lg shadow-md p-4">
          <div class="flex items-center gap-6 text-sm">
            <div class="flex items-center gap-2">
              <div class="w-3 h-3 bg-blue-500 rounded"></div>
              <span>Repetitie</span>
            </div>
            <div class="flex items-center gap-2">
              <div class="w-3 h-3 bg-purple-500 rounded"></div>
              <span>Concert</span>
            </div>
            <div class="flex items-center gap-2">
              <div class="w-3 h-3 bg-gray-500 rounded"></div>
              <span>Ander</span>
            </div>
            <div class="flex items-center gap-2">
              <div class="w-3 h-3 bg-animato-primary rounded ring-2 ring-animato-primary ring-offset-2"></div>
              <span>Vandaag</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function renderMonthView(
  startDate: Date, 
  endDate: Date, 
  eventsByDate: Record<string, any[]>,
  today: string,
  currentDate: Date
) {
  const days: Date[] = []
  const current = new Date(startDate)
  
  while (current <= endDate) {
    days.push(new Date(current))
    current.setDate(current.getDate() + 1)
  }
  
  const weeks: Date[][] = []
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7))
  }
  
  const currentMonth = currentDate.getMonth()
  
  return (
    <div class="calendar-grid">
      {/* Day Names Header */}
      <div class="grid grid-cols-7 bg-gray-50 border-b">
        {['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'].map(day => (
          <div class="p-2 text-center text-xs font-semibold text-gray-600 uppercase">
            {day}
          </div>
        ))}
      </div>
      
      {/* Calendar Days */}
      <div class="grid grid-cols-7">
        {days.map(day => {
          const dateStr = day.toISOString().split('T')[0]
          const dayEvents = eventsByDate[dateStr] || []
          const isToday = dateStr === today
          const isCurrentMonth = day.getMonth() === currentMonth
          
          return (
            <div class={`min-h-32 border border-gray-200 p-2 ${
              !isCurrentMonth ? 'bg-gray-50' : 'bg-white'
            } ${isToday ? 'ring-2 ring-animato-primary ring-inset' : ''}`}>
              <div class={`text-sm font-semibold mb-2 ${
                isToday ? 'text-animato-primary' : isCurrentMonth ? 'text-gray-900' : 'text-gray-400'
              }`}>
                {day.getDate()}
              </div>
              
              <div class="space-y-1">
                {dayEvents.slice(0, 3).map((event: any) => (
                  <a 
                    href={`/admin/events/${event.id}`}
                    class={`block text-xs px-2 py-1 rounded truncate ${
                      event.type === 'repetitie' ? 'bg-blue-100 text-blue-800 hover:bg-blue-200' :
                      event.type === 'concert' ? 'bg-purple-100 text-purple-800 hover:bg-purple-200' :
                      'bg-gray-100 text-gray-800 hover:bg-gray-200'
                    }`}
                    title={`${event.titel} - ${new Date(event.start_at).toLocaleTimeString('nl-NL', {hour: '2-digit', minute: '2-digit'})}`}
                  >
                    {new Date(event.start_at).toLocaleTimeString('nl-NL', {hour: '2-digit', minute: '2-digit'})} {event.titel}
                  </a>
                ))}
                {dayEvents.length > 3 && (
                  <div class="text-xs text-gray-500 px-2">
                    +{dayEvents.length - 3} meer
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function renderWeekView(
  startDate: Date, 
  endDate: Date, 
  eventsByDate: Record<string, any[]>,
  today: string
) {
  const days: Date[] = []
  const current = new Date(startDate)
  
  while (current <= endDate) {
    days.push(new Date(current))
    current.setDate(current.getDate() + 1)
  }
  
  return (
    <div class="week-grid">
      {/* Day Headers */}
      <div class="grid grid-cols-7 bg-gray-50 border-b">
        {days.map(day => {
          const dateStr = day.toISOString().split('T')[0]
          const isToday = dateStr === today
          const dayName = ['Zo', 'Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za'][day.getDay()]
          
          return (
            <div class={`p-4 text-center border-r last:border-r-0 ${
              isToday ? 'bg-animato-primary text-white' : ''
            }`}>
              <div class="text-xs font-semibold uppercase">{dayName}</div>
              <div class="text-2xl font-bold mt-1">{day.getDate()}</div>
            </div>
          )
        })}
      </div>
      
      {/* Events Timeline */}
      <div class="grid grid-cols-7">
        {days.map(day => {
          const dateStr = day.toISOString().split('T')[0]
          const dayEvents = eventsByDate[dateStr] || []
          const isToday = dateStr === today
          
          return (
            <div class={`min-h-96 border-r last:border-r-0 p-3 ${
              isToday ? 'bg-blue-50' : 'bg-white'
            }`}>
              <div class="space-y-2">
                {dayEvents.map((event: any) => (
                  <a 
                    href={`/admin/events/${event.id}`}
                    class={`block px-3 py-2 rounded-lg shadow-sm hover:shadow-md transition ${
                      event.type === 'repetitie' ? 'bg-blue-100 border-l-4 border-blue-500' :
                      event.type === 'concert' ? 'bg-purple-100 border-l-4 border-purple-500' :
                      'bg-gray-100 border-l-4 border-gray-500'
                    }`}
                  >
                    <div class="text-xs font-semibold text-gray-900">
                      {new Date(event.start_at).toLocaleTimeString('nl-NL', {hour: '2-digit', minute: '2-digit'})}
                    </div>
                    <div class="text-sm font-medium mt-1">{event.titel}</div>
                    {event.locatie_naam && (
                      <div class="text-xs text-gray-600 mt-1">
                        <i class="fas fa-map-marker-alt mr-1"></i>
                        {event.locatie_naam}
                      </div>
                    )}
                  </a>
                ))}
                {dayEvents.length === 0 && (
                  <div class="text-center text-gray-400 text-sm py-8">
                    Geen events
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default app
