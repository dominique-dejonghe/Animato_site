import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { Layout } from '../components/Layout'
import { AdminSidebar } from '../components/AdminSidebar'
import { queryAll, execute } from '../utils/db'
import { verifyToken } from '../utils/auth'
import type { Bindings, SessionUser } from '../types'

const app = new Hono<{ Bindings: Bindings }>()

// Middleware
app.use('*', async (c, next) => {
  const token = getCookie(c, 'auth_token')
  if (!token) return c.redirect('/login')
  const user = await verifyToken(token, c.env.JWT_SECRET)
  if (!user || user.role !== 'admin') return c.redirect('/leden')
  c.set('user', user)
  await next()
})

app.get('/admin/feedback', async (c) => {
  const user = c.get('user') as SessionUser
  
  const feedback = await queryAll(
    c.env.DB,
    `SELECT f.*, u.email, p.voornaam, p.achternaam
     FROM feedback f
     LEFT JOIN users u ON u.id = f.user_id
     LEFT JOIN profiles p ON p.user_id = u.id
     ORDER BY f.created_at DESC`
  )

  return c.html(
    <Layout title="Beta Feedback" user={user}>
      <div class="flex min-h-screen bg-gray-50">
        <AdminSidebar activeSection="feedback" />
        <div class="flex-1 p-8">
          <h1 class="text-3xl font-bold text-gray-900 mb-6">
            <i class="fas fa-bug text-animato-primary mr-3"></i>
            Beta Feedback
          </h1>

          <div class="space-y-4">
            {feedback.map((item: any) => (
              <div class={`bg-white rounded-lg shadow p-5 border-l-4 ${
                item.type === 'bug' ? 'border-red-400' :
                item.type === 'feature' ? 'border-blue-400' : 'border-gray-400'
              }`}>
                <div class="flex justify-between items-start gap-4">
                  {/* Left: info */}
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 mb-1 flex-wrap">
                      <span class={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                        item.type === 'bug' ? 'bg-red-100 text-red-800' :
                        item.type === 'feature' ? 'bg-blue-100 text-blue-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {item.type === 'bug' ? '🐛 Bug' : item.type === 'feature' ? '💡 Idee' : '📝 Anders'}
                      </span>
                      <span class={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                        item.status === 'open' ? 'bg-yellow-100 text-yellow-800' :
                        item.status === 'resolved' ? 'bg-green-100 text-green-800' :
                        item.status === 'in_progress' ? 'bg-blue-100 text-blue-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {item.status}
                      </span>
                      <span class="text-xs text-gray-400">
                        {item.voornaam} {item.achternaam} — {new Date(item.created_at).toLocaleDateString('nl-BE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p class="text-sm text-gray-800 mb-1">{item.message}</p>
                    {item.url && (
                      <a href={item.url} target="_blank" class="text-xs text-blue-500 hover:underline break-all">
                        <i class="fas fa-link mr-1"></i>{item.url}
                      </a>
                    )}
                  </div>
                  {/* Right: status selector */}
                  <form action="/api/admin/feedback/update" method="POST" class="shrink-0">
                    <input type="hidden" name="id" value={item.id} />
                    <select name="status" onchange="this.form.submit()" class="text-xs border rounded p-1.5 bg-gray-50">
                      <option value="open" selected={item.status === 'open'}>Open</option>
                      <option value="in_progress" selected={item.status === 'in_progress'}>In Behandeling</option>
                      <option value="resolved" selected={item.status === 'resolved'}>Opgelost</option>
                      <option value="rejected" selected={item.status === 'rejected'}>Afgewezen</option>
                    </select>
                  </form>
                </div>
                {/* Screenshot */}
                {item.screenshot && (
                  <div class="mt-3">
                    <p class="text-xs text-gray-400 mb-1"><i class="fas fa-image mr-1"></i>Screenshot</p>
                    <img
                      src={item.screenshot}
                      alt="Screenshot"
                      class="max-h-64 rounded border border-gray-200 cursor-pointer hover:opacity-90 transition"
                      onclick="document.getElementById('screenshot-modal-img').src=this.src; document.getElementById('screenshot-modal').classList.remove('hidden');"
                    />
                  </div>
                )}
              </div>
            ))}
            {feedback.length === 0 && (
              <div class="bg-white rounded-lg shadow p-12 text-center text-gray-400">
                <i class="fas fa-inbox text-4xl mb-3"></i>
                <p>Nog geen feedback ontvangen.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Screenshot lightbox modal */}
      <div id="screenshot-modal" class="fixed inset-0 bg-black bg-opacity-75 z-50 hidden flex items-center justify-center p-4" onclick="this.classList.add('hidden')">
        <div class="max-w-4xl max-h-full">
          <img id="screenshot-modal-img" src="" alt="Screenshot" class="max-w-full max-h-screen rounded shadow-2xl" />
          <p class="text-white text-center text-sm mt-2 opacity-60">Klik ergens om te sluiten</p>
        </div>
      </div>
    </Layout>
  )
})

app.post('/api/admin/feedback/update', async (c) => {
  const body = await c.req.parseBody()
  await execute(c.env.DB, "UPDATE feedback SET status = ? WHERE id = ?", [body.status, body.id])
  return c.redirect('/admin/feedback')
})

export default app
