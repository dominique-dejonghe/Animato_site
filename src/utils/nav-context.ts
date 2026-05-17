// =====================================================
// NAV CONTEXT — request-scoped navigatie-items via AsyncLocalStorage
// =====================================================
//
// Probleem: Layout.tsx is een synchronous JSX component die op 120+
// plekken wordt aangeroepen. We willen er dynamische editable_pages
// in de header tonen zonder elke call-site aan te passen.
//
// Oplossing: middleware fetcht editable_pages (1x per request, met
// SELECT show_in_nav=1) en stopt ze in een AsyncLocalStorage. Layout
// leest de store sync op render-tijd. Werkt in Cloudflare Workers
// dankzij nodejs_compat compatibility flag.
//
// Async-isolatie: elk request krijgt zijn eigen store, geen leakage
// tussen concurrent requests in dezelfde worker isolate.

import { AsyncLocalStorage } from 'node:async_hooks'
import type { D1Database } from '@cloudflare/workers-types'
import { queryAll } from './db'

export interface NavPage {
  slug: string
  titel: string
  nav_order: number
}

const navStore = new AsyncLocalStorage<NavPage[]>()

/** Lees nav-items vanuit de huidige request-scope. Lege array als niet
 *  ingesteld (bv. tijdens admin-routes waar we geen extra items willen). */
export const getNavPages = (): NavPage[] => {
  return navStore.getStore() || []
}

/** Run een handler binnen een request-scope met navPages geladen. */
export const runWithNavPages = <T>(pages: NavPage[], fn: () => T): T => {
  return navStore.run(pages, fn)
}

/** Haal show_in_nav=1 pagina's op uit DB, gesorteerd op nav_order. */
export const fetchNavPages = async (db: D1Database): Promise<NavPage[]> => {
  try {
    const rows = await queryAll<NavPage>(
      db,
      `SELECT slug, titel, COALESCE(nav_order, 100) as nav_order
       FROM editable_pages
       WHERE show_in_nav = 1
       ORDER BY nav_order ASC, slug ASC`
    )
    return rows
  } catch (e) {
    // Bij DB-fouten (bv. tijdens migraties): silently fallback naar leeg
    console.error('[nav] fetchNavPages failed:', e)
    return []
  }
}
