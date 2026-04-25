/**
 * Quill Link Picker (#120)
 * 
 * Drop-in JSX component die:
 *   1. Een herbruikbare modal rendert (zoek interne pagina's of vul externe URL in)
 *   2. Een globale `window.__attachQuillLinkPicker(quill)` functie installeert
 *      die de standaard 'link'-knop overschrijft.
 *
 * Gebruik:
 *   - Render <QuillLinkPicker /> één keer onderaan je editor-pagina.
 *   - Gebruik in je Quill init:
 *       const quill = new Quill('#editor', { 
 *         theme: 'snow', 
 *         modules: { 
 *           toolbar: { container: [...], handlers: { link: window.__quillLinkHandler } } 
 *         } 
 *       });
 *       // OF na init:  window.__attachQuillLinkPicker(quill)
 */

export function QuillLinkPicker() {
  return (
    <>
      {/* Modal */}
      <div id="linkPickerModal" class="hidden fixed inset-0 z-[60] bg-black bg-opacity-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
        <div class="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col">
          <div class="flex items-center justify-between px-5 py-3 border-b border-gray-200">
            <h3 class="text-lg font-semibold text-gray-900">
              <i class="fas fa-link text-animato-primary mr-2"></i>
              Link toevoegen
            </h3>
            <button type="button" onclick="window.__closeLinkPicker()" class="text-gray-400 hover:text-gray-600 text-xl leading-none" aria-label="Sluiten">&times;</button>
          </div>

          {/* Tabs */}
          <div class="flex border-b border-gray-200 bg-gray-50">
            <button id="linkTabIntern" type="button" onclick="window.__switchLinkTab('intern')" class="px-4 py-2 border-b-2 border-animato-primary text-animato-primary font-semibold text-sm transition">
              <i class="fas fa-sitemap mr-1.5"></i> Pagina op deze site
            </button>
            <button id="linkTabExtern" type="button" onclick="window.__switchLinkTab('extern')" class="px-4 py-2 border-b-2 border-transparent text-gray-500 hover:text-gray-700 text-sm transition">
              <i class="fas fa-external-link-alt mr-1.5"></i> Externe URL
            </button>
          </div>

          {/* Linktekst */}
          <div class="px-5 pt-3">
            <label class="block text-xs font-medium text-gray-600 mb-1">
              Linktekst (optioneel — leeg laten = geselecteerde tekst behouden)
            </label>
            <input id="linkPickerText" type="text" placeholder="bv. Lees meer over ons najaarsconcert" class="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-animato-primary focus:border-transparent" />
          </div>

          {/* Pane: Intern */}
          <div id="linkPaneIntern" class="flex-1 flex flex-col min-h-0 px-5 py-3">
            <div class="relative mb-2">
              <i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm"></i>
              <input id="linkPickerSearch" type="text" placeholder="Zoek op titel, URL of categorie…" class="w-full pl-9 pr-3 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-animato-primary focus:border-transparent" />
            </div>
            <div id="linkPickerResults" class="flex-1 overflow-y-auto border border-gray-200 rounded bg-white" style="max-height: 420px; min-height: 200px;">
              <div class="p-6 text-center text-gray-400"><i class="fas fa-spinner fa-spin mr-1"></i> Pagina's laden…</div>
            </div>
            <p class="mt-2 text-xs text-gray-500 italic">
              <i class="fas fa-info-circle mr-1"></i>
              Tip: interne links openen in dezelfde tab — externe links automatisch in een nieuw tabblad.
            </p>
          </div>

          {/* Pane: Extern */}
          <div id="linkPaneExtern" class="hidden flex-1 px-5 py-3">
            <label class="block text-xs font-medium text-gray-600 mb-1">URL</label>
            <input id="linkPickerExternalUrl" type="text" placeholder="https://www.example.com  of  /nieuws/eigen-pagina" class="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-animato-primary focus:border-transparent" />
            <p class="mt-2 text-xs text-gray-500 italic">
              <i class="fas fa-info-circle mr-1"></i>
              Begint met <code>http://</code> of <code>https://</code> → externe link (opent in nieuw tabblad). Begint met <code>/</code> → interne link (zelfde tab).
            </p>
            <div class="mt-4 flex justify-end gap-2">
              <button type="button" onclick="window.__closeLinkPicker()" class="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Annuleren</button>
              <button type="button" onclick="window.__applyExternalLink()" class="px-4 py-2 bg-animato-primary text-white rounded text-sm hover:bg-animato-secondary">
                <i class="fas fa-check mr-1"></i> Link plaatsen
              </button>
            </div>
          </div>

          <div class="px-5 py-3 border-t border-gray-200 flex justify-end bg-gray-50 rounded-b-lg">
            <button type="button" onclick="window.__closeLinkPicker()" class="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Sluiten</button>
          </div>
        </div>
      </div>

      {/* Globale picker JS — werkt voor elke Quill-instance op de pagina */}
      <script dangerouslySetInnerHTML={{ __html: `
        (function() {
          if (window.__quillLinkPickerInstalled) return;
          window.__quillLinkPickerInstalled = true;

          var pickerQuill = null;
          var pickerRange = null;
          var pickerCache = null;
          var pickerCacheTime = 0;

          window.__openLinkPicker = function(quill, range, selectedText) {
            pickerQuill = quill;
            pickerRange = range;
            var modal = document.getElementById('linkPickerModal');
            if (!modal) {
              var url = prompt('Link URL:');
              if (url && range) {
                if (range.length > 0) quill.format('link', url);
                else quill.insertText(range.index, url, 'link', url);
              }
              return;
            }
            var txt = document.getElementById('linkPickerText');
            if (txt) txt.value = selectedText || '';
            var ext = document.getElementById('linkPickerExternalUrl');
            if (ext) ext.value = '';
            var search = document.getElementById('linkPickerSearch');
            if (search) search.value = '';
            var list = document.getElementById('linkPickerResults');
            if (list) list.innerHTML = '<div class="p-6 text-center text-gray-400"><i class="fas fa-spinner fa-spin mr-1"></i> Pagina\\'s laden…</div>';
            switchLinkTab('intern');
            modal.classList.remove('hidden');
            loadInternalPages();
            setTimeout(function(){ if (search) search.focus(); }, 50);
          };

          window.__closeLinkPicker = function() {
            var modal = document.getElementById('linkPickerModal');
            if (modal) modal.classList.add('hidden');
            pickerQuill = null;
            pickerRange = null;
          };

          function switchLinkTab(tab) {
            var tabIntern = document.getElementById('linkTabIntern');
            var tabExtern = document.getElementById('linkTabExtern');
            var paneIntern = document.getElementById('linkPaneIntern');
            var paneExtern = document.getElementById('linkPaneExtern');
            if (!tabIntern || !tabExtern || !paneIntern || !paneExtern) return;
            if (tab === 'intern') {
              tabIntern.classList.add('border-animato-primary', 'text-animato-primary', 'font-semibold');
              tabIntern.classList.remove('text-gray-500', 'border-transparent');
              tabExtern.classList.remove('border-animato-primary', 'text-animato-primary', 'font-semibold');
              tabExtern.classList.add('text-gray-500', 'border-transparent');
              paneIntern.classList.remove('hidden');
              paneExtern.classList.add('hidden');
            } else {
              tabExtern.classList.add('border-animato-primary', 'text-animato-primary', 'font-semibold');
              tabExtern.classList.remove('text-gray-500', 'border-transparent');
              tabIntern.classList.remove('border-animato-primary', 'text-animato-primary', 'font-semibold');
              tabIntern.classList.add('text-gray-500', 'border-transparent');
              paneExtern.classList.remove('hidden');
              paneIntern.classList.add('hidden');
              setTimeout(function(){
                var ext = document.getElementById('linkPickerExternalUrl');
                if (ext) ext.focus();
              }, 50);
            }
          }
          window.__switchLinkTab = switchLinkTab;

          async function loadInternalPages(force) {
            var now = Date.now();
            if (!force && pickerCache && (now - pickerCacheTime) < 60000) {
              renderInternalPages(pickerCache, '');
              return;
            }
            try {
              var res = await fetch('/api/admin/internal-pages', { credentials: 'same-origin' });
              if (!res.ok) throw new Error('HTTP ' + res.status);
              var data = await res.json();
              pickerCache = data.items || [];
              pickerCacheTime = now;
              renderInternalPages(pickerCache, '');
            } catch(err) {
              var list = document.getElementById('linkPickerResults');
              if (list) list.innerHTML = '<div class="p-6 text-center text-red-500"><i class="fas fa-exclamation-triangle mr-1"></i> Pagina\\'s konden niet geladen worden: ' + (err.message || 'fout') + '</div>';
            }
          }

          function renderInternalPages(items, query) {
            var list = document.getElementById('linkPickerResults');
            if (!list) return;
            var filtered = items;
            if (query) {
              var q = query.toLowerCase();
              filtered = items.filter(function(it){
                return (it.titel || '').toLowerCase().includes(q) ||
                       (it.url || '').toLowerCase().includes(q) ||
                       (it.category || '').toLowerCase().includes(q) ||
                       (it.subtitel || '').toLowerCase().includes(q);
              });
            }
            if (filtered.length === 0) {
              list.innerHTML = '<div class="p-6 text-center text-gray-400">Geen pagina\\'s gevonden voor "' + escapeHtml(query || '') + '"</div>';
              return;
            }
            var groups = {};
            filtered.forEach(function(it){
              var cat = it.category || 'Andere';
              if (!groups[cat]) groups[cat] = [];
              groups[cat].push(it);
            });
            var order = ['Vaste pagina', 'Nieuws', 'Concert', 'Activiteit', 'Repetitie', 'Fotoalbum'];
            var sortedCats = Object.keys(groups).sort(function(a, b){
              var ai = order.indexOf(a), bi = order.indexOf(b);
              return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
            });
            var html = '';
            for (var ci = 0; ci < sortedCats.length; ci++) {
              var cat = sortedCats[ci];
              html += '<div class="border-b border-gray-100 last:border-0">';
              html += '<div class="px-3 py-1.5 bg-gray-50 text-xs font-semibold uppercase tracking-wider text-gray-500">' + escapeHtml(cat) + ' <span class="font-normal lowercase tracking-normal text-gray-400">(' + groups[cat].length + ')</span></div>';
              for (var i = 0; i < groups[cat].length; i++) {
                var it = groups[cat][i];
                var icon = catIcon(cat);
                html += '<button type="button" class="w-full text-left px-3 py-2 hover:bg-blue-50 flex items-start gap-2 group" '
                  + 'onclick="__pickInternalPage(' + JSON.stringify(it.url).replace(/"/g, '&quot;') + ', ' + JSON.stringify(it.titel).replace(/"/g, '&quot;') + ')">'
                  + '<i class="fas ' + icon + ' text-gray-400 mt-1 group-hover:text-animato-primary"></i>'
                  + '<div class="flex-1 min-w-0">'
                  + '<div class="text-sm text-gray-900 truncate font-medium">' + escapeHtml(it.titel) + '</div>'
                  + '<div class="text-xs text-gray-500 truncate">' + escapeHtml(it.url) + (it.subtitel ? ' · ' + escapeHtml(it.subtitel) : '') + '</div>'
                  + '</div>'
                  + '<i class="fas fa-arrow-right text-gray-300 group-hover:text-animato-primary mt-1.5 opacity-0 group-hover:opacity-100 transition"></i>'
                  + '</button>';
              }
              html += '</div>';
            }
            list.innerHTML = html;
          }

          function catIcon(cat) {
            switch(cat) {
              case 'Nieuws': return 'fa-newspaper';
              case 'Concert': return 'fa-music';
              case 'Activiteit': return 'fa-calendar';
              case 'Repetitie': return 'fa-microphone';
              case 'Fotoalbum': return 'fa-images';
              case 'Vaste pagina': return 'fa-file';
              default: return 'fa-link';
            }
          }

          function escapeHtml(s) {
            return String(s == null ? '' : s)
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;');
          }

          window.__pickInternalPage = function(url, suggestedText) {
            if (!pickerQuill || !pickerRange) return;
            applyLink(pickerQuill, pickerRange, url, suggestedText);
            window.__closeLinkPicker();
          };

          window.__applyExternalLink = function() {
            if (!pickerQuill || !pickerRange) return;
            var ext = document.getElementById('linkPickerExternalUrl');
            var url = (ext && ext.value || '').trim();
            if (!url) { alert('Vul een URL in.'); return; }
            if (!/^(https?:|mailto:|tel:|\\/|#)/i.test(url)) url = 'https://' + url;
            applyLink(pickerQuill, pickerRange, url, '');
            window.__closeLinkPicker();
          };

          function applyLink(quill, range, url, suggestedText) {
            var txtField = document.getElementById('linkPickerText');
            var customText = (txtField && txtField.value || '').trim();
            if (range.length > 0) {
              if (customText && customText !== quill.getText(range.index, range.length)) {
                quill.deleteText(range.index, range.length);
                quill.insertText(range.index, customText, 'link', url);
                quill.setSelection(range.index + customText.length, 0);
              } else {
                quill.format('link', url);
              }
            } else {
              var insertText = customText || suggestedText || url;
              quill.insertText(range.index, insertText, 'link', url);
              quill.setSelection(range.index + insertText.length, 0);
            }
          }

          // Universele link-handler die je in Quill toolbar.handlers.link kan zetten
          window.__quillLinkHandler = function(value) {
            if (value) {
              var range = this.quill.getSelection(true);
              var selectedText = range && range.length > 0
                ? this.quill.getText(range.index, range.length)
                : '';
              window.__openLinkPicker(this.quill, range, selectedText);
            } else {
              this.quill.format('link', false);
            }
          };

          // Helper: hang de picker aan een al-geïnitialiseerde Quill instance (overschrijft de toolbar link-handler)
          window.__attachQuillLinkPicker = function(quill) {
            try {
              var toolbar = quill.getModule('toolbar');
              if (toolbar && toolbar.addHandler) {
                toolbar.addHandler('link', function(value){
                  if (value) {
                    var range = quill.getSelection(true);
                    var selectedText = range && range.length > 0 ? quill.getText(range.index, range.length) : '';
                    window.__openLinkPicker(quill, range, selectedText);
                  } else {
                    quill.format('link', false);
                  }
                });
              }
            } catch(e) {
              console.warn('attachQuillLinkPicker failed:', e);
            }
          };

          // Search en globale event handlers
          document.addEventListener('input', function(e) {
            if (e.target && e.target.id === 'linkPickerSearch') {
              if (pickerCache) renderInternalPages(pickerCache, e.target.value);
            }
          });
          document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
              var modal = document.getElementById('linkPickerModal');
              if (modal && !modal.classList.contains('hidden')) window.__closeLinkPicker();
            }
            if (e.target && e.target.id === 'linkPickerExternalUrl' && e.key === 'Enter') {
              e.preventDefault();
              window.__applyExternalLink();
            }
          });
        })();
      ` }} />
    </>
  )
}
