/**
 * Tailwind config voor Animato koorwebsite.
 *
 * BELANGRIJK — waarom deze config bestaat (2026-07-08):
 *  We laadden Tailwind eerst via cdn.tailwindcss.com. Dat is een browser-based
 *  compiler die bij elke pageload je HTML scant en on-the-fly CSS bouwt.
 *  Kwetsbaarheden die dat veroorzaakte:
 *    - Trage first-paint (Dominique's oorspronkelijke perf-klacht).
 *    - Layout-breuk als je 'defer' zet: custom classes (bg-animato-secondary)
 *      blijven leeg tot het CDN-script laadt → witte tekst op witte achtergrond.
 *    - Officieel: Tailwind zelf noemt de CDN "niet voor productie".
 *
 *  Daarom compilen we nu één statisch bestand (public/static/css/tailwind.css)
 *  dat mét het HTML antwoord meekomt via <link> — snel én FOUC-vrij.
 *
 * CONTENT-PATHS:
 *  Elke .tsx die classes gebruikt MOET hier staan, anders "purgt" Tailwind ze
 *  weg en zie je opnieuw ongestylede pagina's.
 */

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/**/*.{ts,tsx,js,jsx}',
    './public/**/*.html',
  ],
  theme: {
    extend: {
      colors: {
        // Animato huisstijl — zie ook Layout.tsx window.tailwind.config fallback
        'animato-primary': '#00A9CE',
        'animato-secondary': '#1B4D5C',
        'animato-accent': '#F59E0B',
      },
      fontFamily: {
        'serif': ['Playfair Display', 'serif'],
        'sans': ['Inter', 'sans-serif'],
      },
    },
  },
  // Safelist voor classes die pas at runtime via string-concat gegenereerd worden
  // (bijv. `bg-${color}-500` patronen in dashboard-tegels). Zonder dit worden ze
  // uit de bundle gepurged.
  safelist: [
    // Kleuren die dynamisch in template-strings worden gebouwd
    { pattern: /^(bg|text|border|ring|shadow)-(red|amber|yellow|green|blue|indigo|purple|pink|orange|teal|cyan|emerald|rose|sky|violet|fuchsia|gray|slate|zinc|neutral|stone)-(50|100|200|300|400|500|600|700|800|900)$/ },
    // Ring + shadow met opacity
    { pattern: /^(shadow|ring)-(red|amber|yellow|green|blue|indigo|purple|pink|orange|teal|cyan|emerald|rose|sky|violet|fuchsia)-(400|500|600)\/(20|30|40|50)$/ },
    // Animato-kleuren met opacity variants
    { pattern: /^(bg|text|border|ring)-animato-(primary|secondary|accent)(\/(5|10|15|20|25|30|40|50|60|75|80|90))?$/ },
  ],
  plugins: [
    require('@tailwindcss/typography'),
  ],
}
