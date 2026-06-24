// Badges-routes: catalogus + persoonlijke voortgang
// Geïnspireerd op Tesla's neon-glow badges-scherm

import { Hono } from 'hono'
import type { Bindings, SessionUser } from '../types'
import { Layout } from '../components/Layout'
import { requireLid } from '../middleware/auth'
import {
  evaluateBadges,
  getUserBadgesWithProgress,
  getBadgeSummary,
  BADGE_COLOR_CLASSES,
  RARITY_LABEL,
  type UserBadgeRow
} from '../utils/badges'

const app = new Hono<{ Bindings: Bindings }>()

app.use('/leden/badges*', requireLid)

// =====================================================
// BADGES OVERZICHTSPAGINA
// =====================================================
app.get('/leden/badges', async (c) => {
  const user = c.get('user') as SessionUser

  // Eerst evalueren of er nieuwe badges zijn (idempotent), dan ophalen
  const newlyEarned = await evaluateBadges(c.env.DB, user.id)
  const badges = await getUserBadgesWithProgress(c.env.DB, user.id)
  const summary = await getBadgeSummary(c.env.DB, user.id)

  // Groepering per categorie
  const byCategory = new Map<string, UserBadgeRow[]>()
  for (const b of badges) {
    if (!byCategory.has(b.categorie)) byCategory.set(b.categorie, [])
    byCategory.get(b.categorie)!.push(b)
  }

  const CATEGORY_META: Record<string, { label: string, icon: string, color: string }> = {
    engagement: { label: 'Activiteit',  icon: 'fa-bolt',          color: 'sky' },
    profiel:    { label: 'Profiel',     icon: 'fa-user-pen',      color: 'pink' },
    muziek:     { label: 'Muziek',      icon: 'fa-music',         color: 'purple' },
    community:  { label: 'Community',   icon: 'fa-people-group',  color: 'teal' },
    milestone:  { label: 'Mijlpalen',   icon: 'fa-flag-checkered',color: 'amber' }
  }

  const orderedCategories = ['engagement', 'profiel', 'muziek', 'community', 'milestone']

  return c.html(
    <Layout
      title="Badges"
      user={user}
      breadcrumbs={[
        { label: 'Ledenportaal', href: '/leden' },
        { label: 'Badges',       href: '/leden/badges' }
      ]}
    >
      <div class="bg-gray-900 min-h-screen text-white">
        <div class="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Header */}
          <div class="mb-6">
            <a href="/leden" class="inline-flex items-center text-sm text-gray-400 hover:text-white transition mb-4">
              <i class="fas fa-arrow-left mr-2"></i> Terug naar dashboard
            </a>
            <div class="flex items-start justify-between flex-wrap gap-4">
              <div>
                <h1 class="text-4xl font-extrabold tracking-tight">Badges</h1>
                <p class="text-gray-400 mt-1">Verdien onderscheidingen door actief deel te nemen aan Animato</p>
              </div>
              <div class="bg-gray-800 rounded-2xl px-6 py-4 border border-gray-700">
                <div class="text-xs uppercase tracking-widest text-gray-500">Verdiend</div>
                <div class="text-3xl font-extrabold">
                  <span class="text-emerald-400">{summary.earned}</span>
                  <span class="text-gray-600 text-2xl"> / {summary.total}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Net verdiend banner */}
          {newlyEarned.length > 0 && (
            <div class="bg-gradient-to-r from-amber-500/20 to-emerald-500/20 border border-amber-400/30 rounded-2xl p-4 mb-8 flex items-center gap-4">
              <i class="fas fa-trophy text-amber-400 text-3xl"></i>
              <div>
                <div class="font-bold text-lg">
                  {newlyEarned.length === 1 ? 'Nieuwe badge verdiend!' : `${newlyEarned.length} nieuwe badges verdiend!`}
                </div>
                <div class="text-sm text-gray-300">Scroll naar beneden om je nieuwe onderscheiding(en) te bekijken.</div>
              </div>
            </div>
          )}

          {/* Categorieën */}
          {orderedCategories.map(catKey => {
            const list = byCategory.get(catKey)
            if (!list || list.length === 0) return null
            const meta = CATEGORY_META[catKey]
            const earnedInCat = list.filter(b => b.earned).length

            return (
              <div class="mb-10">
                <div class="flex items-center justify-between mb-4 pb-2 border-b border-gray-800">
                  <h2 class="text-xl font-bold flex items-center gap-3">
                    <i class={`fas ${meta.icon} text-${meta.color}-400`}></i>
                    {meta.label}
                  </h2>
                  <span class="text-sm text-gray-400">
                    {earnedInCat} / {list.length} verdiend
                  </span>
                </div>

                <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {list.map(badge => {
                    const colors = BADGE_COLOR_CLASSES[badge.kleur] || BADGE_COLOR_CLASSES.sky
                    const rarity = RARITY_LABEL[badge.zeldzaamheid] || RARITY_LABEL.gewoon

                    if (badge.earned) {
                      // Geünlocked: vol kleurig met glow
                      return (
                        <div class={`group relative bg-gray-800 rounded-2xl p-4 border border-gray-700 hover:border-gray-500 transition cursor-pointer`}>
                          <div class={`relative mx-auto w-20 h-20 rounded-full flex items-center justify-center ring-4 ${colors.ring} ${colors.bg} shadow-2xl ${colors.glow} mb-3`}>
                            <i class={`fas ${badge.icon} text-3xl ${colors.text}`}></i>
                          </div>
                          <div class="text-center">
                            <div class="font-bold text-sm text-white">{badge.naam}</div>
                            <div class="text-[10px] text-gray-400 mt-1 line-clamp-2 h-8">{badge.beschrijving}</div>
                            {badge.earned_at && (
                              <div class="text-[10px] text-emerald-400 mt-2 flex items-center justify-center gap-1">
                                <i class="fas fa-check-circle"></i>
                                {new Date(badge.earned_at).toLocaleDateString('nl-BE', { day: '2-digit', month: 'short', year: 'numeric' })}
                              </div>
                            )}
                            <div class={`inline-block mt-2 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide ${rarity.class}`}>
                              {rarity.label}
                            </div>
                          </div>
                        </div>
                      )
                    } else {
                      // Locked: grijs, met progress bar
                      return (
                        <div class="group relative bg-gray-800/50 rounded-2xl p-4 border border-gray-800 hover:border-gray-700 transition">
                          <div class="relative mx-auto w-20 h-20 rounded-full flex items-center justify-center bg-gray-900 border-2 border-gray-700 mb-3">
                            <i class={`fas ${badge.icon} text-3xl text-gray-600`}></i>
                            <div class="absolute -bottom-1 -right-1 bg-gray-700 rounded-full w-7 h-7 flex items-center justify-center border-2 border-gray-900">
                              <i class="fas fa-lock text-xs text-gray-400"></i>
                            </div>
                          </div>
                          <div class="text-center">
                            <div class="font-semibold text-sm text-gray-300">{badge.naam}</div>
                            <div class="text-[10px] text-gray-500 mt-1 line-clamp-2 h-8">{badge.beschrijving}</div>
                            {badge.criteria_value > 1 && (
                              <div class="mt-2">
                                <div class="w-full bg-gray-900 rounded-full h-1.5">
                                  <div
                                    class={`bg-${badge.kleur}-500 h-1.5 rounded-full transition-all`}
                                    style={`width:${badge.percent}%`}
                                  ></div>
                                </div>
                                <div class="text-[10px] text-gray-500 mt-1">
                                  {badge.progress} / {badge.criteria_value}
                                </div>
                              </div>
                            )}
                            <div class={`inline-block mt-2 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide ${rarity.class} opacity-60`}>
                              {rarity.label}
                            </div>
                          </div>
                        </div>
                      )
                    }
                  })}
                </div>
              </div>
            )
          })}

          {/* Footer-tip */}
          <div class="mt-12 bg-gray-800/50 border border-gray-700 rounded-2xl p-6 text-center">
            <i class="fas fa-lightbulb text-amber-400 text-2xl mb-2"></i>
            <p class="text-gray-300 text-sm">
              <strong class="text-white">Tip:</strong> Verdien meer badges door regelmatig in te loggen, je profiel compleet te maken, deel te nemen aan polls en agenda-events te bevestigen.
            </p>
          </div>
        </div>
      </div>
    </Layout>
  )
})

export default app
