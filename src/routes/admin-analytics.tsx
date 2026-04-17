// Admin Analytics Dashboard
// Login statistics, activity per voice group, per-user activity, email reports

import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import type { Bindings, SessionUser } from '../types'
import { Layout } from '../components/Layout'
import { AdminSidebar } from '../components/AdminSidebar'
import { queryOne, queryAll, execute } from '../utils/db'
import { verifyToken } from '../utils/auth'
import { sendEmail } from '../utils/email'

const app = new Hono<{ Bindings: Bindings }>()

// Auth middleware – scoped to /admin/* only
const adminAuthMiddleware = async (c: any, next: any) => {
  const token = getCookie(c, 'auth_token')
  if (!token) return c.redirect('/login?redirect=' + c.req.path)
  const payload = await verifyToken(token, c.env.JWT_SECRET)
  if (!payload || payload.role !== 'admin') return c.redirect('/login?error=unauthorized')
  c.set('user', payload)
  await next()
}
app.use('/admin/*', adminAuthMiddleware)
app.use('/api/admin/*', adminAuthMiddleware)

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: fetch all analytics data
// ─────────────────────────────────────────────────────────────────────────────
async function fetchAnalytics(db: D1Database, period: string = '30') {
  const days = parseInt(period) || 30

  // ── Total logins in period ──
  const totalLogins = await queryOne<any>(db,
    `SELECT COUNT(*) as cnt FROM user_sessions
     WHERE login_at >= datetime('now', '-${days} days')`
  )

  // ── Unique users who logged in ──
  const uniqueUsers = await queryOne<any>(db,
    `SELECT COUNT(DISTINCT user_id) as cnt FROM user_sessions
     WHERE login_at >= datetime('now', '-${days} days')`
  )

  // ── Total users and active users ──
  const totalUsers = await queryOne<any>(db,
    `SELECT COUNT(*) as cnt FROM users WHERE status != 'verwijderd'`
  )

  // ── Logins per day (last 30 days) ──
  const loginsByDay = await queryAll(db,
    `SELECT DATE(login_at) as dag, COUNT(*) as aantal
     FROM user_sessions
     WHERE login_at >= datetime('now', '-${days} days')
     GROUP BY DATE(login_at)
     ORDER BY dag ASC`
  )

  // ── Activity per stemgroep ──
  const stemgroepStats = await queryAll(db,
    `SELECT 
       COALESCE(u.stemgroep, 'onbekend') as stemgroep,
       COUNT(DISTINCT s.user_id) as uniek_actief,
       COUNT(s.id) as totaal_logins,
       MAX(s.login_at) as laatste_login,
       COUNT(DISTINCT u.id) as totaal_leden
     FROM users u
     LEFT JOIN user_sessions s ON s.user_id = u.id 
       AND s.login_at >= datetime('now', '-${days} days')
     WHERE u.status != 'verwijderd' AND u.role = 'lid'
     GROUP BY COALESCE(u.stemgroep, 'onbekend')
     ORDER BY totaal_logins DESC`
  )

  // ── Per-user activity (last N days) ──
  const userActivity = await queryAll(db,
    `SELECT 
       u.id, u.email, u.stemgroep, u.last_login_at, u.role,
       COALESCE(p.voornaam, '') as voornaam,
       COALESCE(p.achternaam, '') as achternaam,
       COUNT(s.id) as login_count,
       MAX(s.login_at) as laatste_login_periode
     FROM users u
     LEFT JOIN profiles p ON p.user_id = u.id
     LEFT JOIN user_sessions s ON s.user_id = u.id
       AND s.login_at >= datetime('now', '-${days} days')
     WHERE u.status != 'verwijderd'
     GROUP BY u.id
     ORDER BY login_count DESC, laatste_login_periode DESC NULLS LAST
     LIMIT 50`
  )

  // ── Never logged in ──
  const neverLoggedIn = await queryOne<any>(db,
    `SELECT COUNT(*) as cnt FROM users 
     WHERE last_login_at IS NULL AND status != 'verwijderd'`
  )

  // ── Login trend: this period vs previous period ──
  const prevPeriodLogins = await queryOne<any>(db,
    `SELECT COUNT(*) as cnt FROM user_sessions
     WHERE login_at >= datetime('now', '-${days * 2} days')
       AND login_at < datetime('now', '-${days} days')`
  )

  // ── Most active day of week ──
  const dayOfWeekStats = await queryAll(db,
    `SELECT 
       CASE CAST(strftime('%w', login_at) AS INTEGER)
         WHEN 0 THEN 'Zondag'
         WHEN 1 THEN 'Maandag'
         WHEN 2 THEN 'Dinsdag'
         WHEN 3 THEN 'Woensdag'
         WHEN 4 THEN 'Donderdag'
         WHEN 5 THEN 'Vrijdag'
         WHEN 6 THEN 'Zaterdag'
       END as dag_naam,
       strftime('%w', login_at) as dag_nr,
       COUNT(*) as aantal
     FROM user_sessions
     WHERE login_at >= datetime('now', '-${days} days')
     GROUP BY dag_nr
     ORDER BY dag_nr ASC`
  )

  // ── Recent audit actions ──
  const recentActions = await queryAll(db,
    `SELECT a.actie, a.created_at, a.entity_type,
       COALESCE(p.voornaam || ' ' || p.achternaam, u.email) as naam,
       u.stemgroep
     FROM audit_logs a
     LEFT JOIN users u ON u.id = a.user_id
     LEFT JOIN profiles p ON p.user_id = a.user_id
     WHERE a.created_at >= datetime('now', '-${days} days')
     ORDER BY a.created_at DESC
     LIMIT 20`
  )

  return {
    days,
    totalLogins: totalLogins?.cnt || 0,
    uniqueUsers: uniqueUsers?.cnt || 0,
    totalUsers: totalUsers?.cnt || 0,
    neverLoggedIn: neverLoggedIn?.cnt || 0,
    prevPeriodLogins: prevPeriodLogins?.cnt || 0,
    loginsByDay,
    stemgroepStats,
    userActivity,
    dayOfWeekStats,
    recentActions,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: build printable HTML report
// ─────────────────────────────────────────────────────────────────────────────
function buildReportHtml(data: Awaited<ReturnType<typeof fetchAnalytics>>, reportDate: string, forEmail = false): string {
  const trendPct = data.prevPeriodLogins > 0
    ? Math.round(((data.totalLogins - data.prevPeriodLogins) / data.prevPeriodLogins) * 100)
    : null

  const stemGroepLabel: Record<string, string> = { S: 'Sopraan', A: 'Alt', T: 'Tenor', B: 'Bas', onbekend: 'Onbekend' }

  const userRows = (data.userActivity as any[]).map(u => {
    const naam = (u.voornaam || u.achternaam) ? `${u.voornaam} ${u.achternaam}`.trim() : u.email
    const sg = stemGroepLabel[u.stemgroep] || u.stemgroep || '—'
    const last = u.laatste_login_periode
      ? new Date(u.laatste_login_periode).toLocaleDateString('nl-BE')
      : (u.last_login_at ? new Date(u.last_login_at).toLocaleDateString('nl-BE') + ' (eerder)' : 'Nooit')
    const logins = u.login_count || 0
    const activeClass = logins > 0 ? '' : 'color:#999;'
    return `<tr style="${activeClass}">
      <td style="padding:6px 10px;border-bottom:1px solid #eee;">${naam}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center;">${sg}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center;font-weight:${logins > 0 ? 'bold' : 'normal'}">${logins}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;">${last}</td>
    </tr>`
  }).join('')

  const sgRows = (data.stemgroepStats as any[]).map(sg => {
    const label = stemGroepLabel[sg.stemgroep] || sg.stemgroep
    const pct = sg.totaal_leden > 0 ? Math.round((sg.uniek_actief / sg.totaal_leden) * 100) : 0
    const barColor = pct >= 70 ? '#10b981' : pct >= 40 ? '#f59e0b' : '#ef4444'
    return `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:600;">${label}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center;">${sg.totaal_leden}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center;">${sg.uniek_actief}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center;">${sg.totaal_logins}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;">
        <div style="background:#e5e7eb;border-radius:4px;height:14px;width:100%;min-width:80px;">
          <div style="background:${barColor};height:14px;border-radius:4px;width:${pct}%;"></div>
        </div>
        <span style="font-size:11px;color:#666;">${pct}% actief</span>
      </td>
    </tr>`
  }).join('')

  return `<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="UTF-8">
<title>Activiteitsrapport Animato — ${reportDate}</title>
<style>
  body{font-family:Arial,sans-serif;color:#222;max-width:900px;margin:0 auto;padding:24px;line-height:1.5;}
  h1{color:#4c1d95;font-size:24px;margin-bottom:4px;}
  h2{color:#4c1d95;font-size:17px;margin:24px 0 10px;border-bottom:2px solid #e9d5ff;padding-bottom:6px;}
  .meta{color:#666;font-size:13px;margin-bottom:24px;}
  .stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin:16px 0 24px;}
  .stat-box{background:#f5f3ff;border-radius:10px;padding:16px;text-align:center;}
  .stat-num{font-size:32px;font-weight:900;color:#6d28d9;}
  .stat-label{font-size:12px;color:#666;margin-top:4px;}
  .trend-up{color:#10b981;} .trend-down{color:#ef4444;}
  table{width:100%;border-collapse:collapse;font-size:13px;}
  th{background:#6d28d9;color:white;padding:8px 12px;text-align:left;font-size:12px;}
  tr:nth-child(even){background:#faf5ff;}
  @media print{
    body{padding:0;max-width:100%;}
    .no-print{display:none!important;}
    h2{page-break-after:avoid;}
    table{page-break-inside:auto;}
    tr{page-break-inside:avoid;}
  }
</style>
</head>
<body>
<h1>📊 Activiteitsrapport — Gemengd Koor Animato</h1>
<div class="meta">
  Periode: <strong>laatste ${data.days} dagen</strong> &nbsp;|&nbsp; 
  Gegenereerd op: <strong>${reportDate}</strong> &nbsp;|&nbsp;
  Totaal leden: <strong>${data.totalUsers}</strong>
</div>

<h2>Samenvatting</h2>
<div class="stat-grid">
  <div class="stat-box">
    <div class="stat-num">${data.totalLogins}</div>
    <div class="stat-label">Inloggen (periode)</div>
    ${trendPct !== null ? `<div class="trend-${trendPct >= 0 ? 'up' : 'down'}" style="font-size:12px;">${trendPct >= 0 ? '▲' : '▼'} ${Math.abs(trendPct)}% vs vorige periode</div>` : ''}
  </div>
  <div class="stat-box">
    <div class="stat-num">${data.uniqueUsers}</div>
    <div class="stat-label">Unieke actieve leden</div>
  </div>
  <div class="stat-box">
    <div class="stat-num">${data.totalUsers - data.uniqueUsers}</div>
    <div class="stat-label">Niet ingelogd (periode)</div>
  </div>
  <div class="stat-box">
    <div class="stat-num" style="color:#ef4444;">${data.neverLoggedIn}</div>
    <div class="stat-label">Nog nooit ingelogd</div>
  </div>
</div>

<h2>Activiteit per stemgroep</h2>
<table>
  <thead><tr>
    <th>Stemgroep</th><th>Totaal leden</th><th>Actief (uniek)</th><th>Inloggen</th><th>Activiteitsgraad</th>
  </tr></thead>
  <tbody>${sgRows}</tbody>
</table>

<h2>Activiteit per lid (top 50)</h2>
<table>
  <thead><tr>
    <th>Naam / Email</th><th>Stemgroep</th><th>Inloggen</th><th>Laatste activiteit</th>
  </tr></thead>
  <tbody>${userRows}</tbody>
</table>

${!forEmail ? `
<h2>Meest actieve dag van de week</h2>
<table>
  <thead><tr><th>Dag</th><th>Aantal inloggen</th></tr></thead>
  <tbody>
    ${(data.dayOfWeekStats as any[]).map(d => `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee;">${d.dag_naam}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;font-weight:600;">${d.aantal}</td></tr>`).join('')}
  </tbody>
</table>
` : ''}

<div style="margin-top:40px;padding-top:16px;border-top:1px solid #e5e7eb;color:#999;font-size:12px;">
  Gemengd Koor Animato &nbsp;|&nbsp; Activiteitsrapport &nbsp;|&nbsp; ${reportDate}
</div>
</body>
</html>`
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/analytics — Dashboard
// ─────────────────────────────────────────────────────────────────────────────
app.get('/admin/analytics', async (c) => {
  const user = c.get('user') as SessionUser
  const period = c.req.query('period') || '30'
  const data = await fetchAnalytics(c.env.DB, period)

  const stemGroepLabel: Record<string, string> = { S: 'Sopraan', A: 'Alt', T: 'Tenor', B: 'Bas', onbekend: 'Onbekend' }
  const stemGroepColor: Record<string, string> = {
    S: 'bg-pink-100 text-pink-800', A: 'bg-purple-100 text-purple-800',
    T: 'bg-blue-100 text-blue-800', B: 'bg-green-100 text-green-800',
    onbekend: 'bg-gray-100 text-gray-600'
  }

  const trendPct = data.prevPeriodLogins > 0
    ? Math.round(((data.totalLogins - data.prevPeriodLogins) / data.prevPeriodLogins) * 100)
    : null

  // Get email report settings
  const emailReportSetting = await queryOne<any>(c.env.DB,
    `SELECT value FROM settings WHERE key = 'analytics_email_rapport'`
  )
  const emailSettings = emailReportSetting?.value ? JSON.parse(emailReportSetting.value) : {
    enabled: false, frequency: 'weekly', recipients: '', last_sent: null
  }

  // Chart data for inline bar chart (logins per day)
  const chartDays = (data.loginsByDay as any[]).slice(-14)
  const maxLogins = Math.max(...chartDays.map((d: any) => d.aantal), 1)

  return c.html(
    <Layout title="Analytics & Statistieken" user={user}>
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar activeSection="analytics" />
        <div class="flex-1 min-w-0 p-8">

          {/* Header */}
          <div class="flex items-center justify-between mb-8 flex-wrap gap-4">
            <div>
              <h1 class="text-3xl font-bold text-gray-900">📊 Analytics & Statistieken</h1>
              <p class="text-gray-500 mt-1">Activiteit, inloggedrag en betrokkenheid per stemgroep</p>
            </div>
            <div class="flex items-center gap-3 flex-wrap">
              {/* Period selector */}
              <form method="GET" class="flex items-center gap-2">
                <label class="text-sm text-gray-600 font-medium">Periode:</label>
                <select name="period" onchange="this.form.submit()"
                  class="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500">
                  <option value="7" selected={period === '7'}>7 dagen</option>
                  <option value="30" selected={period === '30'}>30 dagen</option>
                  <option value="60" selected={period === '60'}>60 dagen</option>
                  <option value="90" selected={period === '90'}>90 dagen</option>
                </select>
              </form>
              <a href={`/admin/analytics/print?period=${period}`} target="_blank"
                class="inline-flex items-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold text-sm px-4 py-2 rounded-lg transition">
                <i class="fas fa-print"></i> Afdrukken / Word
              </a>
              <a href={`/admin/analytics/email-rapport`}
                class="inline-flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white font-semibold text-sm px-4 py-2 rounded-lg transition">
                <i class="fas fa-envelope"></i> E-mail instellen
              </a>
            </div>
          </div>

          {/* KPI Cards */}
          <div class="grid grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <div class="bg-white rounded-xl shadow-sm p-6 border border-purple-100">
              <div class="flex items-center justify-between mb-3">
                <div class="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                  <i class="fas fa-sign-in-alt text-purple-600"></i>
                </div>
                {trendPct !== null && (
                  <span class={`text-xs font-bold px-2 py-1 rounded-full ${trendPct >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {trendPct >= 0 ? '▲' : '▼'} {Math.abs(trendPct)}%
                  </span>
                )}
              </div>
              <div class="text-3xl font-black text-gray-900">{data.totalLogins}</div>
              <div class="text-sm text-gray-500 mt-1">Inloggen in {period} dagen</div>
            </div>

            <div class="bg-white rounded-xl shadow-sm p-6 border border-blue-100">
              <div class="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center mb-3">
                <i class="fas fa-user-check text-blue-600"></i>
              </div>
              <div class="text-3xl font-black text-gray-900">{data.uniqueUsers}</div>
              <div class="text-sm text-gray-500 mt-1">Unieke actieve leden</div>
            </div>

            <div class="bg-white rounded-xl shadow-sm p-6 border border-amber-100">
              <div class="w-10 h-10 bg-amber-100 rounded-lg flex items-center justify-center mb-3">
                <i class="fas fa-user-clock text-amber-600"></i>
              </div>
              <div class="text-3xl font-black text-gray-900">{data.totalUsers - data.uniqueUsers}</div>
              <div class="text-sm text-gray-500 mt-1">Niet actief (periode)</div>
            </div>

            <div class="bg-white rounded-xl shadow-sm p-6 border border-red-100">
              <div class="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center mb-3">
                <i class="fas fa-user-slash text-red-500"></i>
              </div>
              <div class="text-3xl font-black text-red-500">{data.neverLoggedIn}</div>
              <div class="text-sm text-gray-500 mt-1">Nog nooit ingelogd</div>
            </div>
          </div>

          {/* Mini bar chart — logins per day */}
          <div class="bg-white rounded-xl shadow-sm p-6 mb-8 border border-gray-100">
            <h2 class="text-lg font-bold text-gray-800 mb-4">
              <i class="fas fa-chart-bar text-purple-500 mr-2"></i>
              Inloggen per dag (laatste 14 dagen)
            </h2>
            <div class="flex items-end gap-1 h-32">
              {chartDays.length === 0 ? (
                <p class="text-gray-400 text-sm">Geen data beschikbaar</p>
              ) : (
                chartDays.map((d: any) => {
                  const pct = Math.round((d.aantal / maxLogins) * 100)
                  const date = new Date(d.dag)
                  const label = date.toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' })
                  return (
                    <div class="flex-1 flex flex-col items-center gap-1 group" title={`${label}: ${d.aantal} inloggen`}>
                      <span class="text-xs text-gray-500 opacity-0 group-hover:opacity-100 transition">{d.aantal}</span>
                      <div class="w-full bg-purple-500 rounded-t transition-all hover:bg-purple-700"
                        style={`height: ${Math.max(pct, 4)}%;`}></div>
                      <span class="text-xs text-gray-400 rotate-0" style="font-size:9px;">{label}</span>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">

            {/* Stemgroep stats */}
            <div class="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
              <h2 class="text-lg font-bold text-gray-800 mb-4">
                <i class="fas fa-users text-blue-500 mr-2"></i>
                Activiteit per stemgroep
              </h2>
              <div class="space-y-4">
                {(data.stemgroepStats as any[]).map((sg: any) => {
                  const label = stemGroepLabel[sg.stemgroep] || sg.stemgroep
                  const colorClass = stemGroepColor[sg.stemgroep] || 'bg-gray-100 text-gray-700'
                  const pct = sg.totaal_leden > 0 ? Math.round((sg.uniek_actief / sg.totaal_leden) * 100) : 0
                  const barColor = pct >= 70 ? 'bg-green-500' : pct >= 40 ? 'bg-amber-400' : 'bg-red-400'
                  return (
                    <div>
                      <div class="flex items-center justify-between mb-1">
                        <div class="flex items-center gap-2">
                          <span class={`px-2 py-0.5 rounded-full text-xs font-bold ${colorClass}`}>{label}</span>
                          <span class="text-sm text-gray-500">{sg.uniek_actief} / {sg.totaal_leden} leden actief</span>
                        </div>
                        <div class="text-right text-xs text-gray-500">
                          <span class="font-semibold text-gray-700">{sg.totaal_logins}</span> inloggen
                        </div>
                      </div>
                      <div class="w-full bg-gray-100 rounded-full h-3">
                        <div class={`${barColor} h-3 rounded-full transition-all`} style={`width: ${pct}%`}></div>
                      </div>
                      <div class="text-xs text-gray-400 mt-0.5">{pct}% actief</div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Day of week stats */}
            <div class="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
              <h2 class="text-lg font-bold text-gray-800 mb-4">
                <i class="fas fa-calendar-week text-green-500 mr-2"></i>
                Meest actieve dag van de week
              </h2>
              {(data.dayOfWeekStats as any[]).length === 0 ? (
                <p class="text-gray-400 text-sm">Geen data beschikbaar</p>
              ) : (
                <div class="space-y-3">
                  {(() => {
                    const maxD = Math.max(...(data.dayOfWeekStats as any[]).map((d: any) => d.aantal), 1)
                    return (data.dayOfWeekStats as any[]).map((d: any) => {
                      const pct = Math.round((d.aantal / maxD) * 100)
                      const isTop = pct === 100
                      return (
                        <div class="flex items-center gap-3">
                          <span class={`w-24 text-sm font-medium ${isTop ? 'text-green-700 font-bold' : 'text-gray-600'}`}>{d.dag_naam}</span>
                          <div class="flex-1 bg-gray-100 rounded-full h-4">
                            <div class={`${isTop ? 'bg-green-500' : 'bg-blue-400'} h-4 rounded-full`} style={`width: ${pct}%`}></div>
                          </div>
                          <span class="w-8 text-right text-sm font-semibold text-gray-700">{d.aantal}</span>
                        </div>
                      )
                    })
                  })()}
                </div>
              )}
            </div>
          </div>

          {/* Per-user table */}
          <div class="bg-white rounded-xl shadow-sm p-6 mb-8 border border-gray-100">
            <div class="flex items-center justify-between mb-4">
              <h2 class="text-lg font-bold text-gray-800">
                <i class="fas fa-user-friends text-purple-500 mr-2"></i>
                Activiteit per lid
              </h2>
              <span class="text-sm text-gray-400">Top 50 — gesorteerd op activiteit</span>
            </div>
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead>
                  <tr class="bg-gray-50 border-b border-gray-200">
                    <th class="text-left px-4 py-3 font-semibold text-gray-700">Naam / Email</th>
                    <th class="text-center px-4 py-3 font-semibold text-gray-700">Stemgroep</th>
                    <th class="text-center px-4 py-3 font-semibold text-gray-700">Inloggen</th>
                    <th class="text-left px-4 py-3 font-semibold text-gray-700">Laatste activiteit</th>
                    <th class="text-center px-4 py-3 font-semibold text-gray-700">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.userActivity as any[]).map((u: any, i: number) => {
                    const naam = (u.voornaam || u.achternaam) ? `${u.voornaam} ${u.achternaam}`.trim() : u.email
                    const sgLabel = stemGroepLabel[u.stemgroep] || u.stemgroep || '—'
                    const sgColor = stemGroepColor[u.stemgroep] || 'bg-gray-100 text-gray-500'
                    const logins = u.login_count || 0
                    const lastLogin = u.laatste_login_periode
                      ? new Date(u.laatste_login_periode).toLocaleDateString('nl-BE')
                      : (u.last_login_at ? new Date(u.last_login_at).toLocaleDateString('nl-BE') + ' *' : '—')
                    return (
                      <tr class={`border-b border-gray-50 hover:bg-purple-50 transition ${logins === 0 ? 'opacity-50' : ''}`}>
                        <td class="px-4 py-3">
                          <div class="font-medium text-gray-900">{naam}</div>
                          {(u.voornaam || u.achternaam) && <div class="text-xs text-gray-400">{u.email}</div>}
                        </td>
                        <td class="px-4 py-3 text-center">
                          <span class={`px-2 py-0.5 rounded-full text-xs font-bold ${sgColor}`}>{sgLabel}</span>
                        </td>
                        <td class="px-4 py-3 text-center">
                          <span class={`font-bold text-lg ${logins > 5 ? 'text-green-600' : logins > 0 ? 'text-amber-600' : 'text-gray-300'}`}>
                            {logins}
                          </span>
                        </td>
                        <td class="px-4 py-3 text-gray-500 text-xs">{lastLogin}</td>
                        <td class="px-4 py-3 text-center">
                          {logins > 5 ? (
                            <span class="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-semibold">Actief</span>
                          ) : logins > 0 ? (
                            <span class="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs font-semibold">Weinig actief</span>
                          ) : (
                            <span class="px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full text-xs font-semibold">Inactief</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <p class="text-xs text-gray-400 mt-2">* = ingelogd vóór de geselecteerde periode</p>
            </div>
          </div>

        </div>
      </div>
    </Layout>
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/analytics/print — Printable / Word-export rapport
// ─────────────────────────────────────────────────────────────────────────────
app.get('/admin/analytics/print', async (c) => {
  const period = c.req.query('period') || '30'
  const format = c.req.query('format') || 'html' // 'html' or 'word'
  const data = await fetchAnalytics(c.env.DB, period)
  const reportDate = new Date().toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric' })
  const html = buildReportHtml(data, reportDate)

  if (format === 'word') {
    // Serve as .doc (Word can open HTML)
    c.header('Content-Type', 'application/msword')
    c.header('Content-Disposition', `attachment; filename="animato-rapport-${new Date().toISOString().split('T')[0]}.doc"`)
    return c.body(html)
  }

  // Print-friendly HTML — includes print button
  return c.html(`<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="UTF-8">
<title>Activiteitsrapport Animato</title>
<style>
  body{font-family:Arial,sans-serif;color:#222;max-width:960px;margin:0 auto;padding:24px;}
  .no-print{margin-bottom:24px;display:flex;gap:12px;flex-wrap:wrap;}
  .btn{display:inline-flex;align-items:center;gap:8px;padding:10px 20px;border-radius:8px;font-weight:600;font-size:14px;text-decoration:none;cursor:pointer;border:none;}
  .btn-print{background:#6d28d9;color:white;}
  .btn-word{background:#1d4ed8;color:white;}
  .btn-back{background:#e5e7eb;color:#374151;}
  @media print{.no-print{display:none!important;}}
</style>
</head>
<body>
<div class="no-print">
  <button onclick="window.print()" class="btn btn-print">🖨️ Afdrukken</button>
  <a href="/admin/analytics/print?period=${period}&format=word" class="btn btn-word">📄 Downloaden als Word (.doc)</a>
  <a href="/admin/analytics?period=${period}" class="btn btn-back">← Terug naar dashboard</a>
</div>
${buildReportHtml(data, reportDate)}
</body>
</html>`)
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/analytics/email-rapport — Email rapport instellingen
// ─────────────────────────────────────────────────────────────────────────────
app.get('/admin/analytics/email-rapport', async (c) => {
  const user = c.get('user') as SessionUser
  const success = c.req.query('success')
  const error = c.req.query('error')

  const setting = await queryOne<any>(c.env.DB,
    `SELECT value FROM settings WHERE key = 'analytics_email_rapport'`
  )
  const cfg = setting?.value ? JSON.parse(setting.value) : {
    enabled: false, frequency: 'weekly', recipients: '', last_sent: null
  }

  return c.html(
    <Layout title="E-mail Rapport Instellen" user={user}>
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar activeSection="analytics" />
        <div class="flex-1 min-w-0 p-8">
          <div class="max-w-2xl">
            <div class="mb-6">
              <a href="/admin/analytics" class="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-purple-600 transition mb-4">
                <i class="fas fa-arrow-left"></i> Terug naar analytics
              </a>
              <h1 class="text-2xl font-bold text-gray-900">📧 E-mail Rapport Instellen</h1>
              <p class="text-gray-500 mt-1">Verstuur automatisch activiteitsrapporten naar beheerders</p>
            </div>

            {success && (
              <div class="bg-green-50 border border-green-200 rounded-lg p-4 mb-6 flex items-center gap-3">
                <i class="fas fa-check-circle text-green-500"></i>
                <span class="text-green-800 font-medium">Instellingen opgeslagen</span>
              </div>
            )}
            {error && (
              <div class="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 flex items-center gap-3">
                <i class="fas fa-exclamation-circle text-red-500"></i>
                <span class="text-red-800">{error === 'send_failed' ? 'Versturen mislukt — controleer de RESEND_API_KEY' : 'Er is een fout opgetreden'}</span>
              </div>
            )}
            {success === 'sent' && (
              <div class="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6 flex items-center gap-3">
                <i class="fas fa-paper-plane text-blue-500"></i>
                <span class="text-blue-800 font-medium">Testrapport verstuurd!</span>
              </div>
            )}

            <div class="bg-white rounded-xl shadow-sm p-8 border border-gray-100">
              <form method="POST" action="/admin/analytics/email-rapport/save" class="space-y-6">

                <div class="flex items-center justify-between p-4 bg-purple-50 rounded-lg border border-purple-200">
                  <div>
                    <div class="font-semibold text-gray-900">Automatisch e-mail rapport</div>
                    <div class="text-sm text-gray-500">Verstuur periodiek een activiteitsoverzicht</div>
                  </div>
                  <label class="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" name="enabled" value="1" checked={cfg.enabled} class="sr-only peer" />
                    <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:bg-purple-600 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all"></div>
                  </label>
                </div>

                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">Frequentie</label>
                  <select name="frequency" class="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500">
                    <option value="daily" selected={cfg.frequency === 'daily'}>Dagelijks</option>
                    <option value="weekly" selected={cfg.frequency === 'weekly'}>Wekelijks (maandag)</option>
                    <option value="monthly" selected={cfg.frequency === 'monthly'}>Maandelijks (1ste van de maand)</option>
                  </select>
                </div>

                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">
                    Ontvangers <span class="text-gray-400">(kommagescheiden)</span>
                  </label>
                  <input type="text" name="recipients"
                    value={cfg.recipients}
                    placeholder="dominique@pensato.org, admin@animato.be"
                    class="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                  />
                  <p class="text-xs text-gray-400 mt-1">Meerdere adressen scheiden met een komma</p>
                </div>

                <div class="flex gap-3 pt-4 border-t border-gray-100">
                  <button type="submit"
                    class="flex-1 bg-purple-600 hover:bg-purple-700 text-white font-semibold py-3 rounded-lg transition">
                    <i class="fas fa-save mr-2"></i>Opslaan
                  </button>
                </div>
              </form>

              {/* Send test now */}
              <div class="mt-6 pt-6 border-t border-gray-100">
                <div class="flex items-center justify-between">
                  <div>
                    <div class="font-medium text-gray-900">Testrapport versturen</div>
                    <div class="text-sm text-gray-500">Verstuur nu een rapport naar de ingestelde ontvangers</div>
                  </div>
                  <form method="POST" action="/admin/analytics/email-rapport/send-now">
                    <button type="submit"
                      class="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2 rounded-lg transition text-sm">
                      <i class="fas fa-paper-plane"></i> Nu versturen
                    </button>
                  </form>
                </div>
                {cfg.last_sent && (
                  <p class="text-xs text-gray-400 mt-2">
                    Laatste verzending: {new Date(cfg.last_sent).toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/analytics/email-rapport/save
// ─────────────────────────────────────────────────────────────────────────────
app.post('/admin/analytics/email-rapport/save', async (c) => {
  const body = await c.req.parseBody()
  const cfg = {
    enabled: body.enabled === '1',
    frequency: String(body.frequency || 'weekly'),
    recipients: String(body.recipients || '').trim(),
    last_sent: null as string | null
  }

  // Preserve last_sent
  const existing = await queryOne<any>(c.env.DB, `SELECT value FROM settings WHERE key = 'analytics_email_rapport'`)
  if (existing?.value) {
    const prev = JSON.parse(existing.value)
    cfg.last_sent = prev.last_sent || null
  }

  await execute(c.env.DB,
    `INSERT INTO settings (key, value, type, beschrijving, updated_at)
     VALUES ('analytics_email_rapport', ?, 'json', 'E-mail rapport instellingen voor analytics', CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    [JSON.stringify(cfg)]
  )

  return c.redirect('/admin/analytics/email-rapport?success=1')
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/analytics/email-rapport/send-now
// ─────────────────────────────────────────────────────────────────────────────
app.post('/admin/analytics/email-rapport/send-now', async (c) => {
  const setting = await queryOne<any>(c.env.DB, `SELECT value FROM settings WHERE key = 'analytics_email_rapport'`)
  const cfg = setting?.value ? JSON.parse(setting.value) : { recipients: '' }

  const recipients = cfg.recipients
    ? cfg.recipients.split(',').map((r: string) => r.trim()).filter(Boolean)
    : []

  if (recipients.length === 0) {
    return c.redirect('/admin/analytics/email-rapport?error=no_recipients')
  }

  const data = await fetchAnalytics(c.env.DB, '30')
  const reportDate = new Date().toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric' })
  const htmlContent = buildReportHtml(data, reportDate, true)

  let allOk = true
  for (const recipient of recipients) {
    const ok = await sendEmail({
      to: recipient,
      subject: `📊 Activiteitsrapport Animato — ${reportDate}`,
      html: htmlContent
    }, c.env.RESEND_API_KEY)
    if (!ok) allOk = false
  }

  // Update last_sent
  const newCfg = { ...cfg, last_sent: new Date().toISOString() }
  await execute(c.env.DB,
    `UPDATE settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = 'analytics_email_rapport'`,
    [JSON.stringify(newCfg)]
  )

  return c.redirect(`/admin/analytics/email-rapport?success=${allOk ? 'sent' : 'partial'}`)
})

export default app
