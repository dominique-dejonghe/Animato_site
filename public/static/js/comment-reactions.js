// =====================================================================
// Comment reactions UI — herbruikbaar voor alle commentaar-types
// =====================================================================
// Gebruik: plaats ergens in je HTML een element met:
//   <div class="comment-reactions"
//        data-target-type="event_reply"
//        data-target-id="42"
//        data-counts='{"like":2,"love":1}'
//        data-mine='["like"]'></div>
//
// Dit script vindt elke .comment-reactions, rendert de 6 emoji-knopjes,
// en hangt event listeners aan voor toggle via /api/leden/comment-reactions/toggle.
// =====================================================================

(function() {
  'use strict';

  var EMOJI = {
    like:  '\uD83D\uDC4D',
    love:  '\u2764\uFE0F',
    laugh: '\uD83D\uDE04',
    music: '\uD83C\uDFB5',
    clap:  '\uD83D\uDC4F',
    pray:  '\uD83D\uDE4F'
  };
  var LABELS = {
    like:'Duim', love:'Hartje', laugh:'Glimlach',
    music:'Muzieknoot', clap:'Applaus', pray:'Dankbaar'
  };
  var ORDER = ['like','love','laugh','music','clap','pray'];

  function render(el) {
    var counts = {};
    var mine = [];
    try { counts = JSON.parse(el.getAttribute('data-counts') || '{}'); } catch(_) {}
    try { mine = JSON.parse(el.getAttribute('data-mine') || '[]'); } catch(_) {}
    var mineSet = {};
    for (var i=0; i<mine.length; i++) mineSet[mine[i]] = true;

    var html = '<div class="flex items-center gap-1 flex-wrap">';

    // Add-button (+) opent picker
    html += '<button type="button" class="cr-add inline-flex items-center justify-center w-7 h-7 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition" title="Reageren" aria-label="Reactie toevoegen">';
    html += '<i class="far fa-smile text-sm"></i>';
    html += '</button>';

    // Existing reaction-chips (alleen die met count > 0)
    for (var j=0; j<ORDER.length; j++) {
      var r = ORDER[j];
      var n = counts[r] || 0;
      if (n <= 0) continue;
      var isMine = !!mineSet[r];
      html += '<button type="button" data-reaction="' + r + '" ';
      html += 'class="cr-chip inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs transition ';
      html += (isMine
        ? 'bg-animato-primary/15 text-animato-primary border border-animato-primary/40'
        : 'bg-gray-100 text-gray-700 border border-gray-200 hover:bg-gray-200');
      html += '" title="' + LABELS[r] + (isMine ? ' (jouw reactie)' : '') + '">';
      html += '<span class="text-sm leading-none">' + EMOJI[r] + '</span>';
      html += '<span class="font-medium">' + n + '</span>';
      html += '</button>';
    }
    html += '</div>';

    // Picker-popover (initieel verborgen)
    html += '<div class="cr-picker hidden absolute z-20 mt-1 bg-white shadow-lg border border-gray-200 rounded-full p-1 flex items-center gap-1">';
    for (var k=0; k<ORDER.length; k++) {
      var rr = ORDER[k];
      html += '<button type="button" data-reaction="' + rr + '" ';
      html += 'class="cr-pick w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center transition text-lg" ';
      html += 'title="' + LABELS[rr] + '">' + EMOJI[rr] + '</button>';
    }
    html += '</div>';

    el.innerHTML = html;
    el.classList.add('relative');
  }

  function postToggle(el, reaction) {
    var targetType = el.getAttribute('data-target-type');
    var targetId = parseInt(el.getAttribute('data-target-id'), 10);
    return fetch('/api/comment-reactions/toggle', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target_type: targetType,
        target_id: targetId,
        reaction: reaction
      })
    }).then(function(r) {
      if (!r.ok) throw new Error('toggle failed (' + r.status + ')');
      return r.json();
    }).then(function(data) {
      // Update data-attrs en re-render
      el.setAttribute('data-counts', JSON.stringify(data.counts || {}));
      el.setAttribute('data-mine', JSON.stringify(data.mine || []));
      render(el);
      attach(el);
    });
  }

  function attach(el) {
    // Add-button: toggle picker
    var addBtn = el.querySelector('.cr-add');
    var picker = el.querySelector('.cr-picker');
    if (addBtn && picker) {
      addBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        // Sluit andere pickers
        document.querySelectorAll('.cr-picker').forEach(function(p) {
          if (p !== picker) p.classList.add('hidden');
        });
        picker.classList.toggle('hidden');
      });
    }
    // Picker-knoppen
    el.querySelectorAll('.cr-pick').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        var r = btn.getAttribute('data-reaction');
        if (picker) picker.classList.add('hidden');
        postToggle(el, r).catch(function(err) { console.warn('reaction toggle failed', err); });
      });
    });
    // Chip-klik: toggle af
    el.querySelectorAll('.cr-chip').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        var r = btn.getAttribute('data-reaction');
        postToggle(el, r).catch(function(err) { console.warn('reaction toggle failed', err); });
      });
    });
  }

  // Sluit alle pickers bij klik buiten
  document.addEventListener('click', function() {
    document.querySelectorAll('.cr-picker').forEach(function(p) {
      p.classList.add('hidden');
    });
  });

  function init() {
    document.querySelectorAll('.comment-reactions').forEach(function(el) {
      if (el.getAttribute('data-cr-init') === '1') return;
      el.setAttribute('data-cr-init', '1');
      render(el);
      attach(el);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose voor dynamisch toegevoegde nodes
  window.CommentReactions = { init: init };
})();
