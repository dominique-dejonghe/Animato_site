// Wie-is-wie quiz: leden leren elkaars namen via foto-quiz
// - GET  /leden/quiz                — start/landing pagina
// - GET  /api/leden/quiz/question   — geeft volgende vraag (1 foto + 3 namen)
// - POST /api/leden/quiz/answer     — registreert antwoord
// - POST /api/leden/quiz/end        — sluit sessie af, geeft eindscore
//
// Admin:
// - GET  /admin/quiz                — dashboard met leaderboard, deelname, moeilijkste gezichten

import { Hono } from 'hono'
import type { Bindings, SessionUser } from '../types'
import { Layout } from '../components/Layout'
import { queryAll, queryOne, execute } from '../utils/db'
import { requireLid, requireAdmin } from '../middleware/auth'

const app = new Hono<{ Bindings: Bindings }>()

app.use('/leden/quiz', requireLid)
app.use('/leden/quiz/*', requireLid)
app.use('/api/leden/quiz/*', requireLid)
app.use('/admin/quiz', requireAdmin)
app.use('/admin/quiz/*', requireAdmin)
app.use('/api/admin/quiz/*', requireAdmin)

// =====================================================
// Helper: Quiz-pool — wie is geschikt als 'target' voor quiz?
// =====================================================
//   - actief lid (status = 'actief')
//   - geen test account
//   - smoelenboek_zichtbaar = 1
//   - foto_url ingesteld én niet leeg én geen placeholder
async function getQuizPool(db: D1Database, excludeUserId?: number): Promise<any[]> {
  const rows = await queryAll<any>(db, `
    SELECT u.id, p.voornaam, p.achternaam, p.foto_url, u.stemgroep
    FROM users u
    JOIN profiles p ON p.user_id = u.id
    WHERE u.status = 'actief'
      AND u.is_test_account = 0
      AND p.smoelenboek_zichtbaar = 1
      AND p.foto_url IS NOT NULL
      AND TRIM(p.foto_url) != ''
      AND p.foto_url NOT LIKE '%placeholder%'
      AND p.foto_url NOT LIKE '%default-avatar%'
      AND p.voornaam IS NOT NULL
      AND p.achternaam IS NOT NULL
      ${excludeUserId ? 'AND u.id != ?' : ''}
  `, excludeUserId ? [excludeUserId] : [])
  return rows
}

// Fisher-Yates shuffle
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// =====================================================
// /leden/quiz — landing
// =====================================================
app.get('/leden/quiz', async (c) => {
  const user = c.get('user') as SessionUser
  const pool = await getQuizPool(c.env.DB, user.id)
  const tooSmall = pool.length < 3

  // Recente sessies van deze speler (laatste 5 afgesloten)
  const recentSessions = await queryAll<any>(c.env.DB, `
    SELECT id, started_at, ended_at, total_questions, correct_answers
    FROM quiz_sessions
    WHERE user_id = ? AND ended_at IS NOT NULL AND total_questions > 0
    ORDER BY started_at DESC LIMIT 5
  `, [user.id])

  // Persoonlijke totalen
  const stats = await queryOne<any>(c.env.DB, `
    SELECT
      COUNT(*) as sessies,
      COALESCE(SUM(total_questions), 0) as antwoorden_totaal,
      COALESCE(SUM(correct_answers), 0) as juist_totaal
    FROM quiz_sessions
    WHERE user_id = ? AND ended_at IS NOT NULL
  `, [user.id])

  const accuracy = stats && stats.antwoorden_totaal > 0
    ? Math.round((stats.juist_totaal / stats.antwoorden_totaal) * 100)
    : null

  return c.html(
    <Layout title="Wie-is-wie quiz" user={user}
      breadcrumbs={[{label: 'Leden', href: '/leden'}, {label: 'Smoelenboek', href: '/leden/smoelenboek'}, {label: 'Quiz', href: '/leden/quiz'}]}>
      <div class="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div class="text-center mb-8">
          <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-pink-100 to-purple-100 mb-4">
            <i class="fas fa-question text-3xl text-animato-primary"></i>
          </div>
          <h1 class="text-4xl font-bold text-gray-900 mb-2" style="font-family: 'Playfair Display', serif;">
            Wie-is-wie?
          </h1>
          <p class="text-lg text-gray-600">Leer de namen van je mede-koorleden — 5 vragen per ronde</p>
        </div>

        {tooSmall ? (
          <div class="bg-amber-50 border border-amber-200 rounded-xl p-6 text-amber-800">
            <i class="fas fa-exclamation-triangle text-2xl mb-2"></i>
            <p class="font-semibold">Nog niet genoeg foto's beschikbaar</p>
            <p class="text-sm mt-1">
              We hebben minstens 3 leden nodig met een profielfoto en zichtbaar smoelenboek
              om de quiz te starten. Vraag je mede-koorleden om hun foto op te laden via
              <a href="/leden/profiel" class="underline ml-1">hun profiel</a>.
            </p>
          </div>
        ) : (
          <>
            <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center mb-6">
              <p class="text-gray-700 mb-6">
                Klaar voor een ronde? <strong>{pool.length}</strong> gezichten in de pool.
                Geen tijdsdruk, na 5 vragen kies je of je verder gaat of stopt.
              </p>
              <button id="startBtn"
                class="bg-gradient-to-r from-animato-primary to-animato-secondary text-white px-8 py-4 rounded-xl text-lg font-bold shadow-lg hover:opacity-90 transition">
                <i class="fas fa-play mr-2"></i> Start quiz
              </button>
            </div>

            {/* Quiz container — verborgen tot start */}
            <div id="quizContainer" class="hidden bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <div class="flex items-center justify-between mb-4 text-sm text-gray-600">
                <div>Vraag <span id="qNum" class="font-bold text-animato-primary">1</span> van <span id="qTotal">5</span></div>
                <div>Score: <span id="score" class="font-bold text-green-600">0</span></div>
              </div>

              <div class="bg-gray-50 rounded-lg overflow-hidden mb-4 aspect-square max-w-sm mx-auto">
                <img id="quizPhoto" src="" alt="" class="w-full h-full object-cover" />
              </div>

              <p class="text-center text-lg font-semibold text-gray-800 mb-4">Wie is dit?</p>

              <div id="quizOptions" class="grid grid-cols-1 gap-3">
                {/* knoppen worden in JS gegenereerd */}
              </div>

              <div id="quizFeedback" class="hidden mt-4 p-4 rounded-lg text-center font-semibold"></div>

              <button id="nextBtn" class="hidden w-full mt-4 bg-animato-primary text-white py-3 rounded-lg font-semibold hover:opacity-90">
                Volgende vraag <i class="fas fa-arrow-right ml-1"></i>
              </button>
            </div>

            {/* Eindresultaat */}
            <div id="quizResult" class="hidden bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
              <div class="text-6xl mb-4" id="resultEmoji">🎉</div>
              <h2 class="text-2xl font-bold text-gray-900 mb-2">Sessie afgerond!</h2>
              <p class="text-lg text-gray-600 mb-6">
                Je had <span id="resultCorrect" class="font-bold text-green-600">0</span>
                van de <span id="resultTotal" class="font-bold">5</span> juist
                (<span id="resultPct">0</span>%)
              </p>
              <div class="flex flex-col sm:flex-row gap-3 justify-center">
                <button id="continueBtn" class="bg-animato-primary text-white px-6 py-3 rounded-lg font-semibold hover:opacity-90">
                  <i class="fas fa-redo mr-2"></i> Nog een ronde
                </button>
                <a href="/leden/smoelenboek" class="bg-gray-100 text-gray-700 px-6 py-3 rounded-lg font-semibold hover:bg-gray-200">
                  <i class="fas fa-users mr-2"></i> Terug naar smoelenboek
                </a>
              </div>
            </div>

            <script dangerouslySetInnerHTML={{ __html: `
              (function() {
                var sessionId = null;
                var currentTarget = null;
                var qNum = 0;
                var qTotal = 5;
                var score = 0;
                var locked = false;

                function $(id) { return document.getElementById(id); }

                async function startSession() {
                  $('startBtn').disabled = true;
                  $('startBtn').innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Bezig...';
                  try {
                    var r = await fetch('/api/leden/quiz/start', { method: 'POST' });
                    var d = await r.json();
                    if (!d.session_id) throw new Error('Geen sessie');
                    sessionId = d.session_id;
                    qNum = 0; score = 0;
                    $('startBtn').parentElement.classList.add('hidden');
                    $('quizContainer').classList.remove('hidden');
                    $('quizResult').classList.add('hidden');
                    loadQuestion();
                  } catch (e) {
                    alert('Kon quiz niet starten. Probeer opnieuw.');
                    $('startBtn').disabled = false;
                    $('startBtn').innerHTML = '<i class="fas fa-play mr-2"></i> Start quiz';
                  }
                }

                async function loadQuestion() {
                  locked = false;
                  $('quizFeedback').className = 'hidden mt-4 p-4 rounded-lg text-center font-semibold';
                  $('nextBtn').classList.add('hidden');
                  qNum++;
                  $('qNum').textContent = qNum;
                  $('score').textContent = score;
                  try {
                    var r = await fetch('/api/leden/quiz/question?session_id=' + sessionId);
                    var d = await r.json();
                    if (!d.target) {
                      alert('Geen vraag beschikbaar — pool te klein?');
                      return;
                    }
                    currentTarget = d.target;
                    $('quizPhoto').src = d.target.foto_url;
                    $('quizPhoto').alt = 'Wie is dit?';
                    var opts = $('quizOptions');
                    opts.innerHTML = '';
                    d.options.forEach(function(opt) {
                      var btn = document.createElement('button');
                      btn.className = 'border-2 border-gray-200 hover:border-animato-primary hover:bg-animato-primary/5 rounded-lg py-3 px-4 text-left font-medium text-gray-800 transition';
                      btn.textContent = opt.voornaam + ' ' + opt.achternaam;
                      btn.dataset.userId = opt.id;
                      btn.addEventListener('click', function() { submitAnswer(opt.id, btn); });
                      opts.appendChild(btn);
                    });
                  } catch (e) {
                    alert('Vraag laden mislukt.');
                  }
                }

                async function submitAnswer(chosenId, btnEl) {
                  if (locked) return;
                  locked = true;
                  // disable alle knoppen
                  Array.from($('quizOptions').children).forEach(function(b) { b.disabled = true; });

                  try {
                    var r = await fetch('/api/leden/quiz/answer', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ session_id: sessionId, target_user_id: currentTarget.id, chosen_user_id: chosenId })
                    });
                    var d = await r.json();
                    var fb = $('quizFeedback');
                    if (d.is_correct) {
                      score++;
                      btnEl.className = 'border-2 border-green-500 bg-green-50 rounded-lg py-3 px-4 text-left font-medium text-green-800';
                      fb.className = 'mt-4 p-4 rounded-lg text-center font-semibold bg-green-50 text-green-800';
                      fb.innerHTML = '<i class="fas fa-check-circle mr-1"></i> Juist! Dat was ' + d.correct_name + '.';
                    } else {
                      btnEl.className = 'border-2 border-red-500 bg-red-50 rounded-lg py-3 px-4 text-left font-medium text-red-800';
                      // markeer juiste antwoord
                      Array.from($('quizOptions').children).forEach(function(b) {
                        if (b.dataset.userId == d.correct_user_id) {
                          b.className = 'border-2 border-green-500 bg-green-50 rounded-lg py-3 px-4 text-left font-medium text-green-800';
                        }
                      });
                      fb.className = 'mt-4 p-4 rounded-lg text-center font-semibold bg-red-50 text-red-800';
                      fb.innerHTML = '<i class="fas fa-times-circle mr-1"></i> Mis! Het was ' + d.correct_name + '.';
                    }
                    $('score').textContent = score;
                    if (qNum >= qTotal) {
                      $('nextBtn').textContent = 'Toon resultaat';
                      $('nextBtn').innerHTML = 'Toon resultaat <i class="fas fa-flag-checkered ml-1"></i>';
                    } else {
                      $('nextBtn').innerHTML = 'Volgende vraag <i class="fas fa-arrow-right ml-1"></i>';
                    }
                    $('nextBtn').classList.remove('hidden');
                  } catch (e) {
                    alert('Antwoord kon niet bewaard worden.');
                    locked = false;
                  }
                }

                async function nextOrEnd() {
                  if (qNum >= qTotal) {
                    await endSession();
                  } else {
                    loadQuestion();
                  }
                }

                async function endSession() {
                  try {
                    await fetch('/api/leden/quiz/end', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ session_id: sessionId })
                    });
                  } catch (e) {}
                  $('quizContainer').classList.add('hidden');
                  var pct = qTotal > 0 ? Math.round((score / qTotal) * 100) : 0;
                  $('resultCorrect').textContent = score;
                  $('resultTotal').textContent = qTotal;
                  $('resultPct').textContent = pct;
                  $('resultEmoji').textContent = pct >= 80 ? '🏆' : pct >= 60 ? '🎉' : pct >= 40 ? '👍' : '💪';
                  $('quizResult').classList.remove('hidden');
                }

                $('startBtn').addEventListener('click', startSession);
                $('nextBtn').addEventListener('click', nextOrEnd);
                $('continueBtn').addEventListener('click', function() {
                  $('quizResult').classList.add('hidden');
                  $('startBtn').parentElement.classList.remove('hidden');
                  $('startBtn').disabled = false;
                  $('startBtn').innerHTML = '<i class="fas fa-play mr-2"></i> Start quiz';
                });
              })();
            ` }} />
          </>
        )}

        {/* Persoonlijke stats */}
        {stats && stats.sessies > 0 && (
          <div class="mt-8 bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h3 class="font-bold text-gray-800 mb-4">
              <i class="fas fa-chart-line text-animato-primary mr-2"></i> Jouw stats
            </h3>
            <div class="grid grid-cols-3 gap-4 text-center mb-4">
              <div>
                <div class="text-2xl font-bold text-animato-primary">{stats.sessies}</div>
                <div class="text-xs text-gray-500 uppercase tracking-wide">Sessies</div>
              </div>
              <div>
                <div class="text-2xl font-bold text-animato-primary">{stats.antwoorden_totaal}</div>
                <div class="text-xs text-gray-500 uppercase tracking-wide">Antwoorden</div>
              </div>
              <div>
                <div class="text-2xl font-bold text-green-600">{accuracy !== null ? accuracy + '%' : '—'}</div>
                <div class="text-xs text-gray-500 uppercase tracking-wide">Juist</div>
              </div>
            </div>
            {recentSessions.length > 0 && (
              <div class="border-t pt-3">
                <p class="text-xs font-semibold text-gray-500 uppercase mb-2">Recente sessies</p>
                <ul class="space-y-1 text-sm">
                  {recentSessions.map((s: any) => {
                    const pct = s.total_questions > 0 ? Math.round((s.correct_answers / s.total_questions) * 100) : 0
                    return (
                      <li class="flex justify-between text-gray-700">
                        <span>{new Date(s.started_at + 'Z').toLocaleString('nl-BE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                        <span class={pct >= 60 ? 'text-green-600 font-semibold' : 'text-gray-500'}>
                          {s.correct_answers}/{s.total_questions} ({pct}%)
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  )
})

// =====================================================
// API: /api/leden/quiz/start — start nieuwe sessie
// =====================================================
app.post('/api/leden/quiz/start', async (c) => {
  const user = c.get('user') as SessionUser
  const result = await c.env.DB.prepare(
    `INSERT INTO quiz_sessions (user_id, total_questions, correct_answers) VALUES (?, 0, 0)`
  ).bind(user.id).run()
  return c.json({ session_id: Number(result.meta.last_row_id) })
})

// =====================================================
// API: /api/leden/quiz/question — geeft volgende vraag
// Logica: 1 random target + 2 afleiders waarvan minstens 1 uit zelfde stemgroep
// Gewogen: targets die de speler nog nooit zag of recent fout had krijgen voorrang
// =====================================================
app.get('/api/leden/quiz/question', async (c) => {
  const user = c.get('user') as SessionUser
  const sessionId = parseInt(c.req.query('session_id') || '0', 10)

  // Sessie moet van deze user zijn en nog niet beëindigd
  const session = await queryOne<any>(c.env.DB,
    `SELECT id FROM quiz_sessions WHERE id = ? AND user_id = ? AND ended_at IS NULL`,
    [sessionId, user.id])
  if (!session) return c.json({ error: 'invalid_session' }, 400)

  const pool = await getQuizPool(c.env.DB, user.id)
  if (pool.length < 3) return c.json({ error: 'pool_too_small' }, 400)

  // Helper: leid geslacht af uit stemgroep
  //   S (sopraan) / A (alt) -> vrouw
  //   T (tenor)  / B (bas)  -> man
  //   anders                 -> null (onbekend)
  // Gebruikt voor het kiezen van geslachts-consistente alternatieven.
  const genderOf = (stem: string | null | undefined): 'F' | 'M' | null => {
    if (!stem) return null
    const s = String(stem).toUpperCase().trim()
    if (s.startsWith('S') || s.startsWith('A')) return 'F'
    if (s.startsWith('T') || s.startsWith('B')) return 'M'
    return null
  }

  // Weighted target selectie — doel: alle leden komen over sessies heen
  // ongeveer gelijk aan bod, met lichte voorrang voor wie de speler nog
  // niet of vaker fout had.
  //
  // Per kandidaat halen we 'seen' (totaal gezien door deze speler) en
  // 'wrong' (aantal foute antwoorden) op.
  //
  // Selectie in twee stappen:
  //   1. NOOIT-GEZIEN bucket: kandidaten met seen=0 krijgen ALTIJD voorrang.
  //      Pas als die bucket leeg is, gaan we naar de gewone weighted pool.
  //      Dit garandeert dat een speler eerst alle leden minstens 1× ziet
  //      voor er herhaling komt.
  //   2. Binnen de gewone pool: weight = 1 / (1 + seen - 2*wrong)
  //      Minder gezien of vaker fout = hogere kans.
  const seenStats = await queryAll<any>(c.env.DB, `
    SELECT target_user_id, COUNT(*) as seen, SUM(CASE WHEN is_correct=0 THEN 1 ELSE 0 END) as wrong
    FROM quiz_answers WHERE user_id = ?
    GROUP BY target_user_id
  `, [user.id])
  const seenMap = new Map<number, { seen: number, wrong: number }>()
  seenStats.forEach((s: any) => seenMap.set(s.target_user_id, { seen: s.seen, wrong: s.wrong }))

  // Vermijd dezelfde target te vaak in zelfde sessie
  const sessionAnswered = await queryAll<any>(c.env.DB,
    `SELECT DISTINCT target_user_id FROM quiz_answers WHERE session_id = ?`, [sessionId])
  const alreadyInSession = new Set(sessionAnswered.map((r: any) => r.target_user_id))
  let candidates = pool.filter(p => !alreadyInSession.has(p.id))
  if (candidates.length === 0) candidates = pool // fallback als pool kleiner is dan 5

  // Stap 1: bucket "nog nooit gezien door deze speler"
  const neverSeen = candidates.filter(p => !seenMap.has(p.id))

  let target: any
  if (neverSeen.length > 0) {
    // Pure random uit de nog-nooit-geziene leden — gegarandeerde spreiding
    target = shuffle(neverSeen)[0]
  } else {
    // Stap 2: alle leden zijn al eens voorgekomen → weighted fallback
    const weighted = candidates.map(p => {
      const s = seenMap.get(p.id) || { seen: 0, wrong: 0 }
      const score = s.seen - s.wrong * 2
      const weight = 1 / (1 + Math.max(0, score))
      return { person: p, weight }
    })
    const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0)
    let r = Math.random() * totalWeight
    target = weighted[0].person
    for (const w of weighted) {
      r -= w.weight
      if (r <= 0) { target = w.person; break }
    }
  }

  // ===== DISTRACTORS =====
  // Regel: enkel leden van hetzelfde geslacht als target (afgeleid uit stemgroep).
  // Een vrouwelijke foto met als afleider een mannelijke naam is een gratis hint —
  // dat ondermijnt de quiz. Als er onvoldoende same-gender kandidaten zijn,
  // valt de logica terug op de hele pool (eerlijke graceful degradation).
  const targetGender = genderOf(target.stemgroep)
  const others = pool.filter(p => p.id !== target.id)

  const sameGender = targetGender
    ? others.filter(p => genderOf(p.stemgroep) === targetGender)
    : others

  // We hebben minstens 2 distractors nodig. Als same-gender pool te klein is,
  // vullen we aan met "onbekend geslacht" (stemgroep null), nooit met de andere sekse.
  // Pas als ook dat ontoereikend is, gebruiken we de volledige pool.
  let distractorPool = sameGender
  if (distractorPool.length < 2 && targetGender) {
    const unknownGender = others.filter(p => genderOf(p.stemgroep) === null)
    distractorPool = [...sameGender, ...unknownGender]
  }
  if (distractorPool.length < 2) {
    distractorPool = others // ultieme fallback
  }

  // Binnen die pool: minstens 1 uit zelfde stemgroep indien mogelijk
  const sameStem = distractorPool.filter(p => p.stemgroep && p.stemgroep === target.stemgroep)

  const distractors: any[] = []
  if (sameStem.length > 0) {
    distractors.push(shuffle(sameStem)[0])
  }
  // Vul aan tot 2 distractors
  const remaining = distractorPool.filter(p => !distractors.find(d => d.id === p.id))
  const extra = shuffle(remaining).slice(0, 2 - distractors.length)
  distractors.push(...extra)

  const options = shuffle([target, ...distractors]).map(p => ({
    id: p.id, voornaam: p.voornaam, achternaam: p.achternaam
  }))

  return c.json({
    target: { id: target.id, foto_url: target.foto_url },
    options
  })
})

// =====================================================
// API: /api/leden/quiz/answer — registreer antwoord
// =====================================================
app.post('/api/leden/quiz/answer', async (c) => {
  const user = c.get('user') as SessionUser
  const body = await c.req.json<any>()
  const sessionId = parseInt(body.session_id, 10)
  const targetUserId = parseInt(body.target_user_id, 10)
  const chosenUserId = parseInt(body.chosen_user_id, 10)

  if (!sessionId || !targetUserId || !chosenUserId) {
    return c.json({ error: 'missing_fields' }, 400)
  }

  // Check sessie ownership + niet beëindigd
  const session = await queryOne<any>(c.env.DB,
    `SELECT id FROM quiz_sessions WHERE id = ? AND user_id = ? AND ended_at IS NULL`,
    [sessionId, user.id])
  if (!session) return c.json({ error: 'invalid_session' }, 400)

  const isCorrect = targetUserId === chosenUserId ? 1 : 0

  await execute(c.env.DB,
    `INSERT INTO quiz_answers (session_id, user_id, target_user_id, chosen_user_id, is_correct) VALUES (?, ?, ?, ?, ?)`,
    [sessionId, user.id, targetUserId, chosenUserId, isCorrect])

  await execute(c.env.DB,
    `UPDATE quiz_sessions SET total_questions = total_questions + 1, correct_answers = correct_answers + ? WHERE id = ?`,
    [isCorrect, sessionId])

  // Naam van correcte target ophalen voor feedback
  const targetProfile = await queryOne<any>(c.env.DB,
    `SELECT voornaam, achternaam FROM profiles WHERE user_id = ?`, [targetUserId])
  const correctName = targetProfile ? `${targetProfile.voornaam} ${targetProfile.achternaam}` : '?'

  return c.json({
    is_correct: !!isCorrect,
    correct_user_id: targetUserId,
    correct_name: correctName
  })
})

// =====================================================
// API: /api/leden/quiz/end — sluit sessie af
// =====================================================
app.post('/api/leden/quiz/end', async (c) => {
  const user = c.get('user') as SessionUser
  const body = await c.req.json<any>()
  const sessionId = parseInt(body.session_id, 10)

  await execute(c.env.DB,
    `UPDATE quiz_sessions SET ended_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND ended_at IS NULL`,
    [sessionId, user.id])

  return c.json({ ok: true })
})

// =====================================================
// ADMIN: /admin/quiz — dashboard
// =====================================================
app.get('/admin/quiz', async (c) => {
  const user = c.get('user') as SessionUser

  // Globale stats
  const globalStats = await queryOne<any>(c.env.DB, `
    SELECT
      (SELECT COUNT(*) FROM quiz_sessions WHERE ended_at IS NOT NULL) as total_sessions,
      (SELECT COUNT(DISTINCT user_id) FROM quiz_sessions WHERE ended_at IS NOT NULL) as unique_players,
      (SELECT COUNT(*) FROM quiz_answers) as total_answers,
      (SELECT COUNT(*) FROM quiz_answers WHERE is_correct = 1) as correct_answers
  `)
  const globalAccuracy = globalStats && globalStats.total_answers > 0
    ? Math.round((globalStats.correct_answers / globalStats.total_answers) * 100)
    : 0

  // Leaderboard: per speler totaal correct + accuracy (min 5 antwoorden om in lijst)
  const leaderboard = await queryAll<any>(c.env.DB, `
    SELECT
      qa.user_id,
      p.voornaam, p.achternaam,
      COUNT(*) as antwoorden,
      SUM(qa.is_correct) as juist,
      ROUND(100.0 * SUM(qa.is_correct) / COUNT(*), 1) as accuracy,
      (SELECT COUNT(*) FROM quiz_sessions s WHERE s.user_id = qa.user_id AND s.ended_at IS NOT NULL) as sessies,
      MAX(qa.answered_at) as laatste_activiteit
    FROM quiz_answers qa
    JOIN profiles p ON p.user_id = qa.user_id
    GROUP BY qa.user_id, p.voornaam, p.achternaam
    HAVING COUNT(*) >= 5
    ORDER BY accuracy DESC, juist DESC
    LIMIT 25
  `)

  // Moeilijkste gezichten — minstens 5 keer als target gezien én laagste accuracy
  const moeilijkste = await queryAll<any>(c.env.DB, `
    SELECT
      qa.target_user_id,
      p.voornaam, p.achternaam, p.foto_url, u.stemgroep,
      COUNT(*) as keer_gezien,
      SUM(qa.is_correct) as keer_juist,
      ROUND(100.0 * SUM(qa.is_correct) / COUNT(*), 1) as herkenning_pct
    FROM quiz_answers qa
    JOIN profiles p ON p.user_id = qa.target_user_id
    JOIN users u ON u.id = qa.target_user_id
    GROUP BY qa.target_user_id, p.voornaam, p.achternaam, p.foto_url, u.stemgroep
    HAVING COUNT(*) >= 5
    ORDER BY herkenning_pct ASC
    LIMIT 10
  `)

  // Alle deelnemers (ook minder dan 5 antwoorden) — chronologisch op laatste activiteit
  const alleDeelnemers = await queryAll<any>(c.env.DB, `
    SELECT
      qa.user_id,
      p.voornaam, p.achternaam,
      COUNT(*) as antwoorden,
      SUM(qa.is_correct) as juist,
      ROUND(100.0 * SUM(qa.is_correct) / COUNT(*), 1) as accuracy,
      (SELECT COUNT(*) FROM quiz_sessions s WHERE s.user_id = qa.user_id AND s.ended_at IS NOT NULL) as sessies,
      MAX(qa.answered_at) as laatste_activiteit
    FROM quiz_answers qa
    JOIN profiles p ON p.user_id = qa.user_id
    GROUP BY qa.user_id, p.voornaam, p.achternaam
    ORDER BY laatste_activiteit DESC
  `)

  // Niet-deelnemers — actieve leden die nooit een sessie afmaakten
  const nietDeelnemers = await queryAll<any>(c.env.DB, `
    SELECT u.id, p.voornaam, p.achternaam, u.stemgroep
    FROM users u
    JOIN profiles p ON p.user_id = u.id
    WHERE u.status = 'actief' AND u.is_test_account = 0
      AND u.id NOT IN (SELECT DISTINCT user_id FROM quiz_sessions WHERE ended_at IS NOT NULL)
    ORDER BY p.voornaam ASC
  `)

  // Pool-grootte
  const poolStats = await queryOne<any>(c.env.DB, `
    SELECT COUNT(*) as pool_size FROM users u
    JOIN profiles p ON p.user_id = u.id
    WHERE u.status = 'actief' AND u.is_test_account = 0
      AND p.smoelenboek_zichtbaar = 1
      AND p.foto_url IS NOT NULL AND TRIM(p.foto_url) != ''
      AND p.foto_url NOT LIKE '%placeholder%'
  `)

  return c.html(
    <Layout title="Quiz-dashboard" user={user} currentPath="/admin/quiz">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div class="mb-8">
          <h1 class="text-3xl font-bold text-gray-900" style="font-family: 'Playfair Display', serif;">
            <i class="fas fa-question-circle text-animato-primary mr-3"></i>
            Wie-is-wie quiz
          </h1>
          <p class="text-gray-600 mt-2">Opvolging van de namen-leer-quiz: deelname, scores en moeilijkste gezichten.</p>
        </div>

        {/* KPI cards */}
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
            <div class="text-xs uppercase tracking-wide text-gray-500 font-semibold">Sessies</div>
            <div class="text-3xl font-bold text-animato-primary mt-1">{globalStats?.total_sessions || 0}</div>
          </div>
          <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
            <div class="text-xs uppercase tracking-wide text-gray-500 font-semibold">Spelers</div>
            <div class="text-3xl font-bold text-animato-primary mt-1">{globalStats?.unique_players || 0}</div>
          </div>
          <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
            <div class="text-xs uppercase tracking-wide text-gray-500 font-semibold">Antwoorden</div>
            <div class="text-3xl font-bold text-animato-primary mt-1">{globalStats?.total_answers || 0}</div>
          </div>
          <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
            <div class="text-xs uppercase tracking-wide text-gray-500 font-semibold">Globale accuracy</div>
            <div class="text-3xl font-bold text-green-600 mt-1">{globalAccuracy}%</div>
          </div>
        </div>

        <div class="text-sm text-gray-600 mb-6">
          <i class="fas fa-info-circle mr-1 text-animato-primary"></i>
          Pool: <strong>{poolStats?.pool_size || 0}</strong> leden hebben een foto + zichtbaar smoelenboek en kunnen als vraag gesteld worden.
        </div>

        <div class="grid lg:grid-cols-2 gap-6 mb-6">
          {/* Leaderboard */}
          <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div class="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 class="font-bold text-gray-900">
                <i class="fas fa-trophy text-amber-500 mr-2"></i> Leaderboard (min. 5 antwoorden)
              </h2>
            </div>
            {leaderboard.length === 0 ? (
              <div class="p-8 text-center text-gray-500">Nog geen voldoende data.</div>
            ) : (
              <table class="min-w-full text-sm">
                <thead class="bg-gray-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th class="px-4 py-2 text-left">#</th>
                    <th class="px-4 py-2 text-left">Speler</th>
                    <th class="px-4 py-2 text-right">Sessies</th>
                    <th class="px-4 py-2 text-right">Juist</th>
                    <th class="px-4 py-2 text-right">Accuracy</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-100">
                  {leaderboard.map((p: any, idx: number) => (
                    <tr class="hover:bg-gray-50">
                      <td class="px-4 py-2 font-bold text-gray-400">
                        {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : (idx + 1)}
                      </td>
                      <td class="px-4 py-2 font-medium">
                        <a href={`/admin/quiz/lid/${p.user_id}`} class="text-animato-primary hover:underline">
                          {p.voornaam} {p.achternaam}
                        </a>
                      </td>
                      <td class="px-4 py-2 text-right text-gray-600">{p.sessies}</td>
                      <td class="px-4 py-2 text-right">{p.juist}/{p.antwoorden}</td>
                      <td class="px-4 py-2 text-right">
                        <span class={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                          p.accuracy >= 80 ? 'bg-green-100 text-green-800' :
                          p.accuracy >= 50 ? 'bg-amber-100 text-amber-800' :
                          'bg-red-100 text-red-800'
                        }`}>{p.accuracy}%</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Moeilijkste gezichten */}
          <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div class="px-6 py-4 border-b border-gray-100">
              <h2 class="font-bold text-gray-900">
                <i class="fas fa-user-secret text-purple-500 mr-2"></i> Moeilijkste gezichten
              </h2>
              <p class="text-xs text-gray-500 mt-1">Leden die het minst herkend worden — meer in de spotlight zetten?</p>
            </div>
            {moeilijkste.length === 0 ? (
              <div class="p-8 text-center text-gray-500">Nog geen voldoende data.</div>
            ) : (
              <ul class="divide-y divide-gray-100">
                {moeilijkste.map((m: any) => (
                  <li class="px-4 py-3 flex items-center gap-3">
                    <img src={m.foto_url} alt="" class="w-12 h-12 rounded-full object-cover flex-shrink-0 border" />
                    <div class="flex-1 min-w-0">
                      <div class="font-medium text-gray-900 truncate">{m.voornaam} {m.achternaam}</div>
                      <div class="text-xs text-gray-500">{m.stemgroep || '—'} · {m.keer_juist}/{m.keer_gezien} juist</div>
                    </div>
                    <span class={`px-2 py-1 rounded text-xs font-bold ${
                      m.herkenning_pct >= 70 ? 'bg-green-100 text-green-800' :
                      m.herkenning_pct >= 40 ? 'bg-amber-100 text-amber-800' :
                      'bg-red-100 text-red-800'
                    }`}>{m.herkenning_pct}%</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Alle deelnemers — volledig overzicht met klikbare detailpagina */}
        <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden mb-6">
          <div class="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
            <h2 class="font-bold text-gray-900">
              <i class="fas fa-users text-blue-500 mr-2"></i> Alle deelnemers ({alleDeelnemers.length})
            </h2>
            <span class="text-xs text-gray-500">Klik op een naam voor sessies + antwoorden</span>
          </div>
          {alleDeelnemers.length === 0 ? (
            <div class="p-8 text-center text-gray-500">Nog geen deelnemers.</div>
          ) : (
            <div class="overflow-x-auto">
              <table class="min-w-full text-sm">
                <thead class="bg-gray-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th class="px-4 py-2 text-left">Speler</th>
                    <th class="px-4 py-2 text-right">Sessies</th>
                    <th class="px-4 py-2 text-right">Antwoorden</th>
                    <th class="px-4 py-2 text-right">Juist</th>
                    <th class="px-4 py-2 text-right">Accuracy</th>
                    <th class="px-4 py-2 text-right">Laatste activiteit</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-100">
                  {alleDeelnemers.map((p: any) => (
                    <tr class="hover:bg-gray-50">
                      <td class="px-4 py-2 font-medium">
                        <a href={`/admin/quiz/lid/${p.user_id}`} class="text-animato-primary hover:underline">
                          {p.voornaam} {p.achternaam}
                        </a>
                      </td>
                      <td class="px-4 py-2 text-right text-gray-600">{p.sessies}</td>
                      <td class="px-4 py-2 text-right text-gray-600">{p.antwoorden}</td>
                      <td class="px-4 py-2 text-right text-gray-600">{p.juist}</td>
                      <td class="px-4 py-2 text-right">
                        <span class={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                          p.accuracy >= 80 ? 'bg-green-100 text-green-800' :
                          p.accuracy >= 50 ? 'bg-amber-100 text-amber-800' :
                          'bg-red-100 text-red-800'
                        }`}>{p.accuracy}%</span>
                      </td>
                      <td class="px-4 py-2 text-right text-xs text-gray-500">
                        {p.laatste_activiteit
                          ? new Date(p.laatste_activiteit + 'Z').toLocaleString('nl-BE', {
                              day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
                            })
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Niet-deelnemers */}
        <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div class="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
            <h2 class="font-bold text-gray-900">
              <i class="fas fa-user-clock text-gray-400 mr-2"></i> Nooit meegedaan ({nietDeelnemers.length})
            </h2>
            <span class="text-xs text-gray-500">Aanporren? Knop op /leden/smoelenboek</span>
          </div>
          {nietDeelnemers.length === 0 ? (
            <div class="p-8 text-center text-gray-500">
              <i class="fas fa-check-circle text-green-500 text-2xl mb-2"></i>
              <p>Iedereen heeft al meegedaan. Top!</p>
            </div>
          ) : (
            <div class="p-4 flex flex-wrap gap-2">
              {nietDeelnemers.map((n: any) => (
                <span class="inline-flex items-center bg-gray-100 text-gray-700 text-sm px-3 py-1.5 rounded-full">
                  {n.voornaam} {n.achternaam}
                  {n.stemgroep && <span class="text-xs text-gray-400 ml-1.5">· {n.stemgroep}</span>}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
})

// =====================================================
// ADMIN: /admin/quiz/lid/:id — detail per lid
// =====================================================
app.get('/admin/quiz/lid/:id', async (c) => {
  const user = c.get('user') as SessionUser
  const memberId = parseInt(c.req.param('id'), 10)

  const member = await queryOne<any>(c.env.DB, `
    SELECT u.id, p.voornaam, p.achternaam, p.foto_url, u.stemgroep
    FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = ?
  `, [memberId])

  if (!member) return c.redirect('/admin/quiz')

  const sessions = await queryAll<any>(c.env.DB, `
    SELECT id, started_at, ended_at, total_questions, correct_answers
    FROM quiz_sessions WHERE user_id = ? AND ended_at IS NOT NULL
    ORDER BY started_at DESC LIMIT 50
  `, [memberId])

  // Volledige antwoordhistoriek voor dit lid (per sessie groeperen in de view)
  // Joint met profielen voor target én chosen → toont volledige naam i.p.v. ID's
  const answers = await queryAll<any>(c.env.DB, `
    SELECT
      qa.id, qa.session_id, qa.is_correct, qa.answered_at,
      qa.target_user_id, qa.chosen_user_id,
      tp.voornaam AS target_voornaam, tp.achternaam AS target_achternaam, tp.foto_url AS target_foto,
      cp.voornaam AS chosen_voornaam, cp.achternaam AS chosen_achternaam
    FROM quiz_answers qa
    JOIN profiles tp ON tp.user_id = qa.target_user_id
    LEFT JOIN profiles cp ON cp.user_id = qa.chosen_user_id
    WHERE qa.user_id = ?
    ORDER BY qa.answered_at DESC
    LIMIT 500
  `, [memberId])

  // Groepeer antwoorden per session_id voor weergave
  const answersBySession = new Map<number, any[]>()
  for (const a of answers) {
    if (!answersBySession.has(a.session_id)) answersBySession.set(a.session_id, [])
    answersBySession.get(a.session_id)!.push(a)
  }

  // Welke gezichten dit lid structureel fout heeft
  const blindeVlekken = await queryAll<any>(c.env.DB, `
    SELECT
      qa.target_user_id,
      tp.voornaam, tp.achternaam, tp.foto_url,
      COUNT(*) as keer,
      SUM(qa.is_correct) as juist
    FROM quiz_answers qa
    JOIN profiles tp ON tp.user_id = qa.target_user_id
    WHERE qa.user_id = ?
    GROUP BY qa.target_user_id, tp.voornaam, tp.achternaam, tp.foto_url
    HAVING COUNT(*) >= 2 AND SUM(qa.is_correct) < COUNT(*) / 2.0
    ORDER BY (1.0 * SUM(qa.is_correct) / COUNT(*)) ASC, COUNT(*) DESC
    LIMIT 12
  `, [memberId])

  return c.html(
    <Layout title={`Quiz — ${member.voornaam}`} user={user} currentPath="/admin/quiz">
      <div class="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div class="mb-6">
          <a href="/admin/quiz" class="text-animato-primary hover:underline text-sm">
            <i class="fas fa-arrow-left mr-1"></i> Terug naar dashboard
          </a>
        </div>

        <div class="flex items-center gap-4 mb-8">
          {member.foto_url && <img src={member.foto_url} class="w-16 h-16 rounded-full object-cover border" alt="" />}
          <div>
            <h1 class="text-2xl font-bold text-gray-900">{member.voornaam} {member.achternaam}</h1>
            <p class="text-gray-500">{member.stemgroep || '—'} · {sessions.length} sessies</p>
          </div>
        </div>

        <div class="grid lg:grid-cols-3 gap-6">
          {/* Sessiehistoriek met uitklapbare details */}
          <div class="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div class="px-6 py-4 border-b border-gray-100">
              <h2 class="font-bold text-gray-900">
                <i class="fas fa-history text-blue-500 mr-2"></i> Sessies + antwoorden
              </h2>
              <p class="text-xs text-gray-500 mt-1">Klik op een sessie om alle gegeven antwoorden te zien.</p>
            </div>
            {sessions.length === 0 ? (
              <div class="p-8 text-center text-gray-500">Nog geen sessies.</div>
            ) : (
              <div class="divide-y divide-gray-100 max-h-[600px] overflow-y-auto">
                {sessions.map((s: any) => {
                  const pct = s.total_questions > 0 ? Math.round((s.correct_answers / s.total_questions) * 100) : 0
                  const sessionAnswers = answersBySession.get(s.id) || []
                  return (
                    <details class="group">
                      <summary class="px-4 py-3 flex items-center justify-between text-sm cursor-pointer hover:bg-gray-50 list-none">
                        <span class="flex items-center gap-2 text-gray-700">
                          <i class="fas fa-chevron-right text-xs text-gray-400 transition-transform group-open:rotate-90"></i>
                          {new Date(s.started_at + 'Z').toLocaleString('nl-BE', {
                            day: 'numeric', month: 'short', year: 'numeric',
                            hour: '2-digit', minute: '2-digit'
                          })}
                        </span>
                        <span class={`font-semibold ${pct >= 60 ? 'text-green-600' : pct >= 40 ? 'text-amber-600' : 'text-red-600'}`}>
                          {s.correct_answers}/{s.total_questions} ({pct}%)
                        </span>
                      </summary>
                      <div class="px-4 pb-4 pt-1 bg-gray-50">
                        {sessionAnswers.length === 0 ? (
                          <div class="text-xs text-gray-400 italic">Geen antwoord-detail beschikbaar (oude sessie?).</div>
                        ) : (
                          <ol class="space-y-2">
                            {sessionAnswers
                              .sort((a, b) => new Date(a.answered_at).getTime() - new Date(b.answered_at).getTime())
                              .map((a: any, idx: number) => (
                                <li class={`flex items-center gap-3 text-sm bg-white p-2 rounded border ${
                                  a.is_correct ? 'border-green-200' : 'border-red-200'
                                }`}>
                                  <span class="text-xs font-semibold text-gray-400 w-5 text-center">{idx + 1}</span>
                                  {a.target_foto && (
                                    <img src={a.target_foto} alt="" class="w-10 h-10 rounded-full object-cover border flex-shrink-0" />
                                  )}
                                  <div class="flex-1 min-w-0">
                                    <div class="text-xs text-gray-500">Foto van</div>
                                    <div class="font-medium text-gray-900 truncate">
                                      {a.target_voornaam} {a.target_achternaam}
                                    </div>
                                  </div>
                                  <div class="flex-1 min-w-0 text-right">
                                    <div class="text-xs text-gray-500">Koos</div>
                                    <div class={`font-medium truncate ${a.is_correct ? 'text-green-700' : 'text-red-700'}`}>
                                      {a.chosen_voornaam ? `${a.chosen_voornaam} ${a.chosen_achternaam || ''}` : '(onbekend)'}
                                    </div>
                                  </div>
                                  <i class={`fas ${a.is_correct ? 'fa-check text-green-500' : 'fa-times text-red-500'} text-lg`}></i>
                                </li>
                              ))}
                          </ol>
                        )}
                      </div>
                    </details>
                  )
                })}
              </div>
            )}
          </div>

          {/* Blinde vlekken */}
          <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden h-fit">
            <div class="px-6 py-4 border-b border-gray-100">
              <h2 class="font-bold text-gray-900"><i class="fas fa-eye-slash text-red-500 mr-2"></i> Blinde vlekken</h2>
              <p class="text-xs text-gray-500 mt-1">Gezichten die {member.voornaam} structureel fout raadt.</p>
            </div>
            {blindeVlekken.length === 0 ? (
              <div class="p-8 text-center text-gray-500">Geen patroon gedetecteerd.</div>
            ) : (
              <ul class="divide-y divide-gray-100">
                {blindeVlekken.map((b: any) => (
                  <li class="px-4 py-3 flex items-center gap-3">
                    <img src={b.foto_url} alt="" class="w-10 h-10 rounded-full object-cover border flex-shrink-0" />
                    <div class="flex-1">
                      <div class="font-medium text-gray-900">{b.voornaam} {b.achternaam}</div>
                      <div class="text-xs text-gray-500">{b.juist}/{b.keer} juist</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </Layout>
  )
})

export default app
