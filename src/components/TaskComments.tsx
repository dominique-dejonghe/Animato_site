/**
 * TaskComments — UI block voor commentaar op een taak
 *
 * Twee varianten:
 *  - TaskCommentsCollapsible: kop met "X reacties" + uitklapbaar paneel (voor lijst/table-view)
 *  - TaskCommentsInline: altijd open (voor kanban-detail-modals)
 *
 * Server-side rendert deze component een minimale, lege placeholder.
 * Bij openen wordt de lijst client-side opgehaald via /api/admin/tasks/comments/list/...
 *
 * Eén globaal init-script (TaskCommentsScript) handelt:
 *  - lazy load on first expand
 *  - submit (top-level + reply)
 *  - delete (soft)
 *  - badge-update (X reacties)
 */

interface CommentsBlockProps {
  taskType: 'meeting_action' | 'project_task'
  taskId: number
  initialCount?: number  // gekend uit een count-query (optioneel; anders 0)
  startOpen?: boolean
}

export function TaskCommentsCollapsible(props: CommentsBlockProps) {
  const { taskType, taskId, initialCount = 0, startOpen = false } = props
  const wrapperId = `tc-${taskType}-${taskId}`
  return (
    <div class="task-comments-wrap mt-2" data-task-comments={wrapperId} data-task-type={taskType} data-task-id={taskId}>
      <button
        type="button"
        class="task-comments-toggle inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-purple-700 hover:bg-purple-50 rounded-md transition"
        aria-expanded={startOpen ? 'true' : 'false'}
      >
        <i class="far fa-comments"></i>
        <span class="task-comments-count">{initialCount}</span>
        <span>{initialCount === 1 ? 'reactie' : 'reacties'}</span>
        <i class="fas fa-chevron-down text-[10px] task-comments-chevron transition-transform"></i>
      </button>
      <div class={`task-comments-panel mt-2 ${startOpen ? '' : 'hidden'}`} data-loaded={startOpen ? '0' : '0'}>
        <div class="task-comments-list space-y-2 mb-2"></div>
        <form class="task-comments-form flex items-start gap-2">
          <input type="hidden" name="task_type" value={taskType} />
          <input type="hidden" name="task_id" value={String(taskId)} />
          <input type="hidden" name="parent_id" value="" />
          <textarea
            name="body"
            rows={2}
            required
            class="flex-1 text-sm border-gray-300 rounded-lg p-2 border focus:ring-purple-500 focus:border-purple-500 resize-y"
            placeholder="Schrijf een reactie..."
            maxlength={4000}
          ></textarea>
          <button type="submit" class="px-3 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 text-sm font-medium flex-shrink-0">
            <i class="fas fa-paper-plane"></i>
          </button>
        </form>
      </div>
    </div>
  )
}

/**
 * Eén globaal script dat alle comment-blocks op de pagina aanstuurt.
 * Plak één keer onderaan elke pagina die comment-blocks bevat.
 */
export function TaskCommentsScript() {
  return (
    <script dangerouslySetInnerHTML={{ __html: `
(function() {
  if (window.__taskCommentsInit) return;
  window.__taskCommentsInit = true;

  function fmtDateTime(s) {
    if (!s) return '';
    try {
      var d = new Date(s.replace(' ', 'T') + 'Z');
      return d.toLocaleString('nl-BE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (e) { return s; }
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, function(c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  }

  function buildTree(comments) {
    // Map id -> node with children[]
    var byId = {};
    comments.forEach(function(c) { c.children = []; byId[c.id] = c; });
    var roots = [];
    comments.forEach(function(c) {
      if (c.parent_id && byId[c.parent_id]) {
        byId[c.parent_id].children.push(c);
      } else {
        roots.push(c);
      }
    });
    return roots;
  }

  function renderComment(c, depth) {
    var initial = ((c.voornaam || '?').charAt(0) + (c.achternaam || '').charAt(0)).toUpperCase();
    var avatar = c.foto_url
      ? '<img src="' + escapeHtml(c.foto_url) + '" class="w-7 h-7 rounded-full object-cover flex-shrink-0" alt="" />'
      : '<div class="w-7 h-7 rounded-full bg-purple-200 text-purple-800 text-xs font-bold flex items-center justify-center flex-shrink-0">' + escapeHtml(initial) + '</div>';
    var canDelete = (window.__currentUserId && Number(window.__currentUserId) === Number(c.user_id)) || window.__isAdmin === true;
    var deleteBtn = canDelete
      ? '<button type="button" class="tc-delete text-xs text-gray-400 hover:text-red-600 ml-2" data-id="' + c.id + '" title="Verwijder"><i class="fas fa-trash-alt"></i></button>'
      : '';
    var replyBtn = depth < 2
      ? '<button type="button" class="tc-reply text-xs text-purple-600 hover:underline ml-2" data-id="' + c.id + '">Antwoord</button>'
      : '';
    var html = ''
      + '<div class="tc-item flex items-start gap-2 ' + (depth > 0 ? 'ml-7 pl-3 border-l-2 border-purple-100' : '') + '" data-comment-id="' + c.id + '">'
      +   avatar
      +   '<div class="flex-1 min-w-0">'
      +     '<div class="bg-gray-50 rounded-lg px-3 py-2">'
      +       '<div class="flex items-center justify-between gap-2 flex-wrap">'
      +         '<span class="text-xs font-semibold text-gray-800">' + escapeHtml((c.voornaam || '') + ' ' + (c.achternaam || '')) + '</span>'
      +         '<span class="text-[10px] text-gray-400">' + fmtDateTime(c.created_at) + '</span>'
      +       '</div>'
      +       '<div class="text-sm text-gray-700 mt-0.5 whitespace-pre-wrap">' + escapeHtml(c.body) + '</div>'
      +     '</div>'
      +     '<div class="mt-1">' + replyBtn + deleteBtn + '</div>'
      +     (c.children && c.children.length ? '<div class="tc-children mt-2 space-y-2">' + c.children.map(function(ch) { return renderComment(ch, depth + 1); }).join('') + '</div>' : '')
      +   '</div>'
      + '</div>';
    return html;
  }

  function renderList(panel, comments) {
    var list = panel.querySelector('.task-comments-list');
    var tree = buildTree(comments);
    if (tree.length === 0) {
      list.innerHTML = '<p class="text-xs text-gray-400 italic">Nog geen reacties. Wees de eerste!</p>';
    } else {
      list.innerHTML = tree.map(function(c) { return renderComment(c, 0); }).join('');
    }
    // update count badge
    var wrap = panel.closest('[data-task-comments]');
    if (wrap) {
      var countEl = wrap.querySelector('.task-comments-count');
      var labelEl = countEl ? countEl.nextElementSibling : null;
      var n = comments.length;
      if (countEl) countEl.textContent = n;
      if (labelEl) labelEl.textContent = (n === 1 ? 'reactie' : 'reacties');
    }
  }

  function loadComments(wrap) {
    var taskType = wrap.getAttribute('data-task-type');
    var taskId   = wrap.getAttribute('data-task-id');
    var panel    = wrap.querySelector('.task-comments-panel');
    var list     = wrap.querySelector('.task-comments-list');
    list.innerHTML = '<p class="text-xs text-gray-400 italic">Laden...</p>';
    fetch('/api/admin/tasks/comments/list/' + encodeURIComponent(taskType) + '/' + encodeURIComponent(taskId), {
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data && data.ok) {
        renderList(panel, data.comments || []);
        panel.setAttribute('data-loaded', '1');
      } else {
        list.innerHTML = '<p class="text-xs text-red-500">Kon reacties niet laden.</p>';
      }
    })
    .catch(function() {
      list.innerHTML = '<p class="text-xs text-red-500">Netwerkfout bij laden van reacties.</p>';
    });
  }

  function submitComment(wrap, form) {
    var fd = new FormData(form);
    fd.append('_ajax', '1');
    fetch('/api/admin/tasks/comments', {
      method: 'POST',
      credentials: 'same-origin',
      body: fd,
      headers: { 'Accept': 'application/json' }
    })
    .then(function(r) { return r.json().then(function(j) { return { ok: r.ok, data: j }; }); })
    .then(function(res) {
      if (!res.ok) {
        alert((res.data && res.data.error) || 'Kon reactie niet posten.');
        return;
      }
      form.querySelector('textarea[name=body]').value = '';
      form.querySelector('input[name=parent_id]').value = '';
      // reset reply-state visual
      var replyHint = wrap.querySelector('.tc-reply-hint');
      if (replyHint) replyHint.remove();
      loadComments(wrap);
    })
    .catch(function() { alert('Netwerkfout — probeer opnieuw.'); });
  }

  function deleteComment(wrap, id) {
    if (!confirm('Reactie verwijderen?')) return;
    fetch('/api/admin/tasks/comments/' + id + '/delete', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    })
    .then(function(r) { return r.json(); })
    .then(function() { loadComments(wrap); })
    .catch(function() { alert('Netwerkfout — probeer opnieuw.'); });
  }

  // Click delegation
  document.addEventListener('click', function(e) {
    var toggle = e.target.closest('.task-comments-toggle');
    if (toggle) {
      var wrap  = toggle.closest('[data-task-comments]');
      var panel = wrap.querySelector('.task-comments-panel');
      var chev  = toggle.querySelector('.task-comments-chevron');
      var open  = !panel.classList.contains('hidden');
      if (open) {
        panel.classList.add('hidden');
        toggle.setAttribute('aria-expanded', 'false');
        if (chev) chev.style.transform = '';
      } else {
        panel.classList.remove('hidden');
        toggle.setAttribute('aria-expanded', 'true');
        if (chev) chev.style.transform = 'rotate(180deg)';
        if (panel.getAttribute('data-loaded') !== '1') {
          loadComments(wrap);
        }
      }
      e.preventDefault();
      return;
    }

    var reply = e.target.closest('.tc-reply');
    if (reply) {
      var wrap2 = reply.closest('[data-task-comments]');
      var form2 = wrap2.querySelector('.task-comments-form');
      form2.querySelector('input[name=parent_id]').value = reply.getAttribute('data-id');
      form2.querySelector('textarea[name=body]').focus();
      // Visual hint
      var oldHint = wrap2.querySelector('.tc-reply-hint');
      if (oldHint) oldHint.remove();
      var hint = document.createElement('div');
      hint.className = 'tc-reply-hint text-[11px] text-purple-700 italic mb-1';
      hint.innerHTML = '<i class="fas fa-reply mr-1"></i>Antwoord op reactie #' + reply.getAttribute('data-id') + ' <button type="button" class="tc-cancel-reply text-gray-400 hover:text-red-600 ml-1"><i class="fas fa-times"></i></button>';
      form2.parentNode.insertBefore(hint, form2);
      e.preventDefault();
      return;
    }

    var cancelReply = e.target.closest('.tc-cancel-reply');
    if (cancelReply) {
      var wrap3 = cancelReply.closest('[data-task-comments]');
      var form3 = wrap3.querySelector('.task-comments-form');
      form3.querySelector('input[name=parent_id]').value = '';
      var hint2 = wrap3.querySelector('.tc-reply-hint');
      if (hint2) hint2.remove();
      e.preventDefault();
      return;
    }

    var del = e.target.closest('.tc-delete');
    if (del) {
      var wrap4 = del.closest('[data-task-comments]');
      deleteComment(wrap4, del.getAttribute('data-id'));
      e.preventDefault();
      return;
    }
  });

  // Submit delegation
  document.addEventListener('submit', function(e) {
    var form = e.target.closest('.task-comments-form');
    if (!form) return;
    e.preventDefault();
    var wrap = form.closest('[data-task-comments]');
    submitComment(wrap, form);
  });

  // Auto-load any block that starts open
  Array.prototype.forEach.call(document.querySelectorAll('[data-task-comments]'), function(wrap) {
    var panel = wrap.querySelector('.task-comments-panel');
    if (panel && !panel.classList.contains('hidden') && panel.getAttribute('data-loaded') !== '1') {
      loadComments(wrap);
    }
  });
})();
` }} />
  )
}
