// Text formatting utilities

/**
 * Convert escaped line breaks to actual line breaks
 * Handles: \r\n, \n, \r
 */
export function formatLineBreaks(text: string | null | undefined): string {
  if (!text) return ''
  
  return text
    .replace(/\\r\\n/g, '\n')  // Windows style (escaped)
    .replace(/\\n/g, '\n')     // Unix style (escaped)
    .replace(/\\r/g, '\n')     // Old Mac style (escaped)
    .replace(/\r\n/g, '\n')    // Windows style (real)
    .replace(/\r/g, '\n')      // Old Mac style (real)
}

/**
 * Truncate text to a certain length with ellipsis
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.substring(0, maxLength).trim() + '...'
}

/**
 * Convert plain text to HTML with line breaks
 */
export function textToHtml(text: string | null | undefined): string {
  if (!text) return ''
  
  return formatLineBreaks(text)
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => `<p>${escapeHtml(line)}</p>`)
    .join('')
}

/**
 * Escape HTML special characters
 */
export function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }
  return text.replace(/[&<>"']/g, char => map[char])
}
