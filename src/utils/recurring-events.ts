// Recurring Events Generator
// Utility functions for creating and managing recurring events

import type { RecurrenceRule, RecurrenceFrequency } from '../types'

/**
 * Generate occurrence dates based on recurrence rule
 */
export function generateOccurrences(
  startDate: Date,
  endTime: Date,
  rule: RecurrenceRule,
  maxOccurrences: number = 52 // Default: 1 year weekly
): Date[] {
  const occurrences: Date[] = []
  let currentDate = new Date(startDate)
  
  const endDate = rule.end_date ? new Date(rule.end_date) : null
  const maxCount = rule.count || maxOccurrences
  
  while (occurrences.length < maxCount) {
    // Check if we've passed the end date
    if (endDate && currentDate > endDate) {
      break
    }
    
    // Add current occurrence
    occurrences.push(new Date(currentDate))
    
    // Calculate next occurrence based on frequency
    switch (rule.frequency) {
      case 'daily':
        currentDate.setDate(currentDate.getDate() + rule.interval)
        break
        
      case 'weekly':
        if (rule.days_of_week && rule.days_of_week.length > 0) {
          // Find next matching day of week
          let foundNext = false
          for (let i = 1; i <= 7; i++) {
            const testDate = new Date(currentDate)
            testDate.setDate(testDate.getDate() + i)
            
            if (rule.days_of_week.includes(testDate.getDay())) {
              currentDate = testDate
              foundNext = true
              break
            }
          }
          
          if (!foundNext) {
            // Skip to next week
            currentDate.setDate(currentDate.getDate() + (7 * rule.interval))
          }
        } else {
          // Simple weekly: same day next week(s)
          currentDate.setDate(currentDate.getDate() + (7 * rule.interval))
        }
        break
        
      case 'monthly':
        currentDate.setMonth(currentDate.getMonth() + rule.interval)
        break
    }
  }
  
  return occurrences
}

/**
 * Create event instances from recurrence rule
 */
export interface EventOccurrence {
  titel: string
  start_at: string
  end_at: string
  occurrence_date: string
}

export function createEventOccurrences(
  baseEvent: {
    titel: string
    start_at: string
    end_at: string
  },
  rule: RecurrenceRule
): EventOccurrence[] {
  const startDate = new Date(baseEvent.start_at)
  const endDate = new Date(baseEvent.end_at)
  const duration = endDate.getTime() - startDate.getTime()
  
  const occurrences = generateOccurrences(startDate, endDate, rule)
  
  return occurrences.map(occDate => {
    const occEndDate = new Date(occDate.getTime() + duration)
    
    return {
      titel: baseEvent.titel,
      start_at: occDate.toISOString(),
      end_at: occEndDate.toISOString(),
      occurrence_date: occDate.toISOString().split('T')[0]
    }
  })
}

/**
 * Format recurrence rule for display
 */
export function formatRecurrenceRule(rule: RecurrenceRule): string {
  const { frequency, interval, end_date, days_of_week, count } = rule
  
  let text = ''
  
  // Frequency
  if (interval === 1) {
    text = frequency === 'daily' ? 'Dagelijks' :
           frequency === 'weekly' ? 'Wekelijks' :
           'Maandelijks'
  } else {
    text = frequency === 'daily' ? `Elke ${interval} dagen` :
           frequency === 'weekly' ? `Elke ${interval} weken` :
           `Elke ${interval} maanden`
  }
  
  // Days of week for weekly recurrence
  if (frequency === 'weekly' && days_of_week && days_of_week.length > 0) {
    const dayNames = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za']
    const days = days_of_week.map(d => dayNames[d]).join(', ')
    text += ` op ${days}`
  }
  
  // End condition
  if (count) {
    text += ` (${count} keer)`
  } else if (end_date) {
    const date = new Date(end_date)
    text += ` tot ${date.toLocaleDateString('nl-NL')}`
  }
  
  return text
}

/**
 * Parse days of week from checkbox values
 */
export function parseDaysOfWeek(formData: FormData): number[] {
  const days: number[] = []
  for (let i = 0; i <= 6; i++) {
    if (formData.get(`day_${i}`) === 'on') {
      days.push(i)
    }
  }
  return days
}
