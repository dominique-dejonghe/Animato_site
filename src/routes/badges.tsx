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
      <div class="bg-gray-50 min-h-screen py-8">
        <div class="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Terug-link */}
          <a href="/leden" class="inline-flex items-center text-sm text-animato-primary hover:underline font-semibold mb-4">
            <i class="fas fa-arrow-left mr-2"></i> Terug naar dashboard
          </a>

          {/* Header — Animato-stijl gradient banner */}
          <div class="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden mb-8">
            <div class="bg-gradient-to-r from-animato-primary to-animato-secondary px-6 py-6 sm:px-8 sm:py-8 text-white">
              <div class="flex items-start justify-between flex-wrap gap-4">
                <div>
                  <h1 class="text-3xl sm:text-4xl font-extrabold tracking-tight" style="font-family: 'Playfair Display', serif;">
                    <i class="fas fa-medal mr-2"></i>Badges
                  </h1>
                  <p class="text-white/90 mt-1 text-sm sm:text-base">Verdien onderscheidingen door actief deel te nemen aan Animato</p>
                </div>
                <div class="bg-white/15 backdrop-blur-sm rounded-xl px-5 py-3 border border-white/20">
                  <div class="text-[10px] uppercase tracking-widest text-white/70 font-semibold">Verdiend</div>
                  <div class="text-3xl font-extrabold leading-tight">
                    {summary.earned}
                    <span class="text-white/60 text-xl"> / {summary.total}</span>
                  </div>
                </div>
              </div>
              {/* Progress bar */}
              {summary.total > 0 && (
                <div class="mt-4">
                  <div class="w-full bg-white/15 rounded-full h-2 overflow-hidden">
                    <div
                      class="bg-amber-300 h-2 rounded-full transition-all shadow-lg shadow-amber-300/40"
                      style={`width:${Math.round((summary.earned / summary.total) * 100)}%`}
                    ></div>
                  </div>
                  <div class="text-xs text-white/70 mt-1 text-right">
                    {Math.round((summary.earned / summary.total) * 100)}% van alle badges
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Net verdiend banner — warme amber-tint, past bij site */}
          {newlyEarned.length > 0 && (
            <div class="bg-gradient-to-r from-amber-50 to-yellow-50 border-2 border-amber-300 rounded-2xl p-4 mb-8 flex items-center gap-4 shadow-sm">
              <div class="flex-shrink-0 w-12 h-12 bg-gradient-to-br from-amber-400 to-orange-500 rounded-full flex items-center justify-center shadow-lg shadow-amber-400/40">
                <i class="fas fa-trophy text-white text-xl"></i>
              </div>
              <div>
                <div class="font-bold text-lg text-amber-900">
                  {newlyEarned.length === 1 ? 'Nieuwe badge verdiend!' : `${newlyEarned.length} nieuwe badges verdiend!`}
                </div>
                <div class="text-sm text-amber-800">Scroll naar beneden om je nieuwe onderscheiding(en) te bekijken.</div>
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
              <div class="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 sm:p-6 mb-6">
                <div class="flex items-center justify-between mb-5 pb-3 border-b border-gray-100">
                  <h2 class="text-xl font-bold flex items-center gap-3 text-gray-800" style="font-family: 'Playfair Display', serif;">
                    <span class={`w-8 h-8 rounded-full bg-${meta.color}-100 text-${meta.color}-600 flex items-center justify-center`}>
                      <i class={`fas ${meta.icon} text-sm`}></i>
                    </span>
                    {meta.label}
                  </h2>
                  <span class="text-sm text-gray-500 font-medium">
                    <span class="text-animato-primary font-bold">{earnedInCat}</span> / {list.length}
                  </span>
                </div>

                <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {list.map(badge => {
                    const colors = BADGE_COLOR_CLASSES[badge.kleur] || BADGE_COLOR_CLASSES.sky
                    const rarity = RARITY_LABEL[badge.zeldzaamheid] || RARITY_LABEL.gewoon

                    if (badge.earned) {
                      // Geünlocked: zachte gekleurde tint + neon-glow ring rond badge
                      return (
                        <div class={`group relative bg-gradient-to-br from-white ${colors.bg} rounded-xl p-4 border border-gray-200 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 cursor-pointer`}>
                          <div class={`relative mx-auto w-20 h-20 rounded-full flex items-center justify-center ring-4 ${colors.ring} ${colors.bg} shadow-xl ${colors.glow} mb-3`}>
                            <i class={`fas ${badge.icon} text-3xl ${colors.text}`}></i>
                          </div>
                          <div class="text-center">
                            <div class="font-bold text-sm text-gray-800">{badge.naam}</div>
                            <div class="text-[10px] text-gray-500 mt-1 line-clamp-2 h-8">{badge.beschrijving}</div>
                            {badge.earned_at && (
                              <div class="text-[10px] text-emerald-600 mt-2 flex items-center justify-center gap-1 font-semibold">
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
                      // Locked: zachtgrijs met progress
                      return (
                        <div class="group relative bg-gray-50 rounded-xl p-4 border border-gray-200 hover:border-gray-300 transition">
                          <div class="relative mx-auto w-20 h-20 rounded-full flex items-center justify-center bg-white border-2 border-dashed border-gray-300 mb-3">
                            <i class={`fas ${badge.icon} text-3xl text-gray-300`}></i>
                            <div class="absolute -bottom-1 -right-1 bg-gray-300 rounded-full w-7 h-7 flex items-center justify-center border-2 border-gray-50">
                              <i class="fas fa-lock text-xs text-gray-600"></i>
                            </div>
                          </div>
                          <div class="text-center">
                            <div class="font-semibold text-sm text-gray-600">{badge.naam}</div>
                            <div class="text-[10px] text-gray-500 mt-1 line-clamp-2 h-8">{badge.beschrijving}</div>
                            {badge.criteria_value > 1 && (
                              <div class="mt-2">
                                <div class="w-full bg-gray-200 rounded-full h-1.5">
                                  <div
                                    class={`bg-${badge.kleur}-500 h-1.5 rounded-full transition-all`}
                                    style={`width:${badge.percent}%`}
                                  ></div>
                                </div>
                                <div class="text-[10px] text-gray-500 mt-1 font-semibold">
                                  {badge.progress} / {badge.criteria_value}
                                </div>
                              </div>
                            )}
                            <div class={`inline-block mt-2 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide ${rarity.class} opacity-70`}>
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

          {/* Footer-tip — past bij site */}
          <div class="mt-8 bg-white border-l-4 border-animato-primary rounded-xl p-5 shadow-sm">
            <div class="flex items-start gap-3">
              <i class="fas fa-lightbulb text-animato-primary text-xl mt-0.5"></i>
              <p class="text-gray-700 text-sm">
                <strong class="text-gray-900">Tip:</strong> Verdien meer badges door regelmatig in te loggen, je profiel compleet te maken, deel te nemen aan polls en agenda-events te bevestigen.
              </p>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
})

export default app
