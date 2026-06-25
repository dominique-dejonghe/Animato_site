            let betaScreenshotData = null;
            let betaFeedbackLoaded = false;

            (async function() {
                try {
                    const res = await fetch('/api/system/beta-status');
                    const data = await res.json();
                    if (data.enabled) {
                        const container = document.getElementById('beta-bubble-container');
                        const btn = document.getElementById('beta-bubble-btn');
                        const popup = document.getElementById('beta-popup');
                        const close = document.getElementById('beta-close');
                        const zone = document.getElementById('screenshot-zone');
                        const fileInput = document.getElementById('screenshot-file');

                        container.classList.remove('hidden');
                        btn.onclick = () => {
                            popup.classList.toggle('hidden');
                        };
                        close.onclick = () => {
                            popup.classList.add('hidden');
                            clearScreenshot();
                        };

                        // Paste event (Ctrl+V anywhere in popup)
                        popup.addEventListener('paste', function(e) {
                            const items = (e.clipboardData || e.originalEvent.clipboardData).items;
                            for (const item of items) {
                                if (item.type.startsWith('image/')) {
                                    e.preventDefault();
                                    const blob = item.getAsFile();
                                    loadScreenshot(blob);
                                    break;
                                }
                            }
                        });

                        // Also listen for global paste when popup is open
                        document.addEventListener('paste', function(e) {
                            if (popup.classList.contains('hidden')) return;
                            const items = (e.clipboardData || e.originalEvent.clipboardData).items;
                            for (const item of items) {
                                if (item.type.startsWith('image/')) {
                                    e.preventDefault();
                                    const blob = item.getAsFile();
                                    loadScreenshot(blob);
                                    break;
                                }
                            }
                        });

                        // File input (click to upload)
                        if (fileInput) fileInput.addEventListener('change', function(e) {
                            const file = e.target.files[0];
                            if (file) loadScreenshot(file);
                        });

                        // Drag & drop
                        if (zone) {
                            zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('border-animato-primary'); });
                            zone.addEventListener('dragleave', () => zone.classList.remove('border-animato-primary'));
                            zone.addEventListener('drop', (e) => {
                                e.preventDefault();
                                zone.classList.remove('border-animato-primary');
                                const file = e.dataTransfer.files[0];
                                if (file && file.type.startsWith('image/')) loadScreenshot(file);
                            });
                        }
                    }
                } catch(e) { console.error('Beta status check failed', e); }
            })();

            function switchBetaTab(tab) {
                const submitTab = document.getElementById('beta-tab-submit');
                const mineTab = document.getElementById('beta-tab-mine');
                const btnSubmit = document.getElementById('tab-submit');
                const btnMine = document.getElementById('tab-mine');

                if (tab === 'submit') {
                    submitTab.classList.remove('hidden');
                    mineTab.classList.add('hidden');
                    btnSubmit.classList.add('text-animato-primary', 'border-animato-primary');
                    btnSubmit.classList.remove('text-gray-500', 'border-transparent');
                    btnMine.classList.remove('text-animato-primary', 'border-animato-primary');
                    btnMine.classList.add('text-gray-500', 'border-transparent');
                } else {
                    submitTab.classList.add('hidden');
                    mineTab.classList.remove('hidden');
                    btnMine.classList.add('text-animato-primary', 'border-animato-primary');
                    btnMine.classList.remove('text-gray-500', 'border-transparent');
                    btnSubmit.classList.remove('text-animato-primary', 'border-animato-primary');
                    btnSubmit.classList.add('text-gray-500', 'border-transparent');
                    loadMyFeedback();
                }
            }

            let currentDetailFeedbackId = null;
            let allFeedbackItems = [];
            let currentFeedbackFilter = 'all';

            const fbTypeLabels = { bug: '\\u{1F41B} Bug', feature: '\\u{1F4A1} Idee', other: '\\u{1F4DD} Anders' };
            const fbStatusColors = {
                open: 'bg-blue-100 text-blue-700',
                meer_info_nodig: 'bg-orange-100 text-orange-700',
                in_progress: 'bg-yellow-100 text-yellow-700',
                hertesten: 'bg-purple-100 text-purple-700',
                resolved: 'bg-green-100 text-green-700',
                rejected: 'bg-red-50 text-red-500'
            };
            const fbStatusLabels = {
                open: 'Open',
                meer_info_nodig: '\\u26a0\\ufe0f Meer info nodig',
                in_progress: 'In behandeling',
                hertesten: '\\ud83d\\udd01 Hertesten',
                resolved: 'Opgelost',
                rejected: 'Afgewezen'
            };

            function renderFeedbackItem(item) {
                const sColor = fbStatusColors[item.status] || 'bg-gray-100 text-gray-500';
                const sLabel = fbStatusLabels[item.status] || item.status;
                const tLabel = fbTypeLabels[item.type] || item.type;
                const date = new Date(item.created_at).toLocaleDateString('nl-BE', { day: '2-digit', month: 'short', year: 'numeric' });
                const hasComments = item.comment_count > 0;
                const hasNewReplies = item.unread_admin_replies > 0;
                
                const actionBadge = item.status === 'hertesten'
                    ? '<span style="display:inline-flex;align-items:center;gap:2px;background:#f3e8ff;color:#7c3aed;font-size:10px;font-weight:600;padding:1px 6px;border-radius:9999px;animation:pulse 2s infinite;"><i class="fas fa-sync-alt"></i> Graag hertesten!</span>'
                    : item.status === 'meer_info_nodig'
                    ? '<span style="display:inline-flex;align-items:center;gap:2px;background:#fff7ed;color:#ea580c;font-size:10px;font-weight:600;padding:1px 6px;border-radius:9999px;animation:pulse 2s infinite;"><i class="fas fa-question-circle"></i> Info gevraagd</span>'
                    : '';
                const commentBadge = hasNewReplies 
                    ? '<span style="display:inline-flex;align-items:center;gap:2px;background:#fef3c7;color:#d97706;font-size:10px;font-weight:600;padding:1px 6px;border-radius:9999px;"><i class="fas fa-comment-dots"></i> Nieuw antwoord</span>'
                    : hasComments 
                    ? '<span style="display:inline-flex;align-items:center;gap:2px;color:#9ca3af;font-size:10px;"><i class="fas fa-comments"></i> ' + item.comment_count + '</span>'
                    : '';

                return '<div onclick="openFeedbackDetail(' + item.id + ')" class="px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition cursor-pointer" data-status="' + item.status + '">' +
                    '<div class="flex items-start justify-between gap-2">' +
                    '<div class="flex-1 min-w-0">' +
                    '<div class="flex items-center gap-1.5 mb-1 flex-wrap">' +
                    '<span class="text-xs text-gray-500">' + tLabel + '</span>' +
                    '<span class="text-gray-300">&middot;</span>' +
                    '<span class="text-xs text-gray-400">' + date + '</span>' +
                    actionBadge +
                    commentBadge +
                    '</div>' +
                    '<p class="text-xs text-gray-700 leading-relaxed" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">' + _escHtml(item.message) + '</p>' +
                    '</div>' +
                    '<div class="flex flex-col items-end gap-1 shrink-0">' +
                    '<span class="text-xs font-medium px-2 py-0.5 rounded-full ' + sColor + '">' + sLabel + '</span>' +
                    '<i class="fas fa-chevron-right text-xs text-gray-300"></i>' +
                    '</div>' +
                    '</div>' +
                    '</div>';
            }

            function renderFilteredList(items) {
                const list = document.getElementById('my-feedback-list');
                const empty = document.getElementById('my-feedback-empty');
                const filtered = currentFeedbackFilter === 'all' ? items : items.filter(function(i) { return i.status === currentFeedbackFilter; });
                
                if (filtered.length === 0) {
                    list.classList.add('hidden');
                    empty.classList.remove('hidden');
                    const filterLabel = currentFeedbackFilter === 'all' ? '' : ' met status "' + (fbStatusLabels[currentFeedbackFilter] || currentFeedbackFilter) + '"';
                    empty.innerHTML = '<i class="fas fa-filter text-3xl text-gray-200 mb-2 block"></i>' +
                        '<p class="text-sm text-gray-400">Geen feedback' + filterLabel + ' gevonden.</p>';
                } else {
                    empty.classList.add('hidden');
                    list.innerHTML = filtered.map(renderFeedbackItem).join('');
                    list.classList.remove('hidden');
                }

                // Update filter button counts + active state
                updateFilterButtons(items);
            }

            function updateFilterButtons(items) {
                const counts = { all: items.length };
                items.forEach(function(i) { counts[i.status] = (counts[i.status] || 0) + 1; });
                
                document.querySelectorAll('.fb-filter-btn').forEach(function(btn) {
                    const f = btn.getAttribute('data-filter');
                    const count = counts[f] || 0;
                    const isActive = f === currentFeedbackFilter;
                    
                    // Determine color based on filter type
                    var activeColors = {
                        all: 'bg-animato-primary text-white border-animato-primary',
                        open: 'bg-blue-500 text-white border-blue-500',
                        hertesten: 'bg-purple-500 text-white border-purple-500',
                        meer_info_nodig: 'bg-orange-500 text-white border-orange-500',
                        in_progress: 'bg-yellow-500 text-white border-yellow-500',
                        resolved: 'bg-green-500 text-white border-green-500'
                    };
                    var inactiveClass = 'bg-white text-gray-500 border-gray-200';
                    
                    // Strip all state classes
                    btn.className = btn.className.replace(/bg-\\S+|text-\\S+|border-\\S+/g, '').trim();
                    btn.classList.add(...(isActive ? (activeColors[f] || activeColors.all) : inactiveClass).split(' '));
                    
                    // Hide button if count is 0 (except 'all')
                    if (f !== 'all' && count === 0) {
                        btn.style.display = 'none';
                    } else {
                        btn.style.display = '';
                    }
                    
                    // Update text with count
                    var labels = { all: 'Alles', open: 'Open', hertesten: 'Hertesten', meer_info_nodig: 'Info nodig', in_progress: 'In behandeling', resolved: 'Opgelost' };
                    btn.textContent = (labels[f] || f) + (count > 0 ? ' (' + count + ')' : '');
                });
            }

            function filterFeedback(status) {
                currentFeedbackFilter = status;
                renderFilteredList(allFeedbackItems);
            }

            async function loadMyFeedback() {
                const loading = document.getElementById('my-feedback-loading');
                const list = document.getElementById('my-feedback-list');
                const empty = document.getElementById('my-feedback-empty');
                const detail = document.getElementById('my-feedback-detail');
                const filters = document.getElementById('my-feedback-filters');

                loading.classList.remove('hidden');
                list.classList.add('hidden');
                empty.classList.add('hidden');
                detail.classList.add('hidden');
                filters.classList.add('hidden');

                try {
                    const res = await fetch('/api/feedback/mine');
                    if (!res.ok) {
                        loading.innerHTML = '<i class="fas fa-lock text-gray-300 text-2xl mb-2 block"></i><p class="text-xs text-gray-400">Log in om je feedback te bekijken.</p>';
                        return;
                    }
                    const data = await res.json();
                    loading.classList.add('hidden');

                    if (!data.items || data.items.length === 0) {
                        empty.classList.remove('hidden');
                        empty.innerHTML = '<i class="fas fa-inbox text-3xl text-gray-200 mb-2 block"></i><p class="text-sm text-gray-400">Je hebt nog geen feedback ingediend.</p>';
                        return;
                    }

                    allFeedbackItems = data.items;
                    filters.classList.remove('hidden');
                    renderFilteredList(allFeedbackItems);
                } catch(e) {
                    loading.innerHTML = '<i class="fas fa-exclamation-circle text-red-300 text-2xl mb-2 block"></i><p class="text-xs text-gray-400">Kon feedback niet laden.</p>';
                }
            }

            function _escHtml(text) {
                const d = document.createElement('div');
                d.textContent = text;
                return d.innerHTML;
            }

            async function openFeedbackDetail(feedbackId) {
                currentDetailFeedbackId = feedbackId;
                const list = document.getElementById('my-feedback-list');
                const detail = document.getElementById('my-feedback-detail');
                const header = document.getElementById('my-feedback-detail-header');
                const messages = document.getElementById('my-feedback-detail-messages');
                const empty = document.getElementById('my-feedback-empty');
                const filters = document.getElementById('my-feedback-filters');

                list.classList.add('hidden');
                empty.classList.add('hidden');
                if (filters) filters.classList.add('hidden');
                detail.classList.remove('hidden');
                messages.innerHTML = '<div class="text-center text-xs text-gray-400 py-4"><i class="fas fa-spinner fa-spin mr-1"></i> Laden...</div>';

                try {
                    // Load the feedback item details + comments
                    const [mineRes, commentsRes] = await Promise.all([
                        fetch('/api/feedback/mine'),
                        fetch('/api/feedback/' + feedbackId + '/comments')
                    ]);
                    
                    const mineData = await mineRes.json();
                    const commentsData = await commentsRes.json();
                    const item = (mineData.items || []).find(function(i) { return i.id === feedbackId; });
                    
                    if (!item) {
                        messages.innerHTML = '<div class="text-center text-xs text-red-400 py-4">Item niet gevonden.</div>';
                        return;
                    }

                    const typeLabels = { bug: '🐛 Bug', feature: '💡 Idee', other: '📝 Anders' };
                    const statusLabels = { open: 'Open', meer_info_nodig: '\u26a0\ufe0f Meer info nodig', in_progress: 'In behandeling', hertesten: '\ud83d\udd01 Hertesten', resolved: 'Opgelost', rejected: 'Afgewezen' };
                    const statusColors = { open: '#3b82f6', meer_info_nodig: '#f97316', in_progress: '#f59e0b', hertesten: '#a855f7', resolved: '#22c55e', rejected: '#ef4444' };
                    
                    // Build header with status badge
                    let headerHtml = '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
                        '<span style="font-size:11px;font-weight:600;">' + (typeLabels[item.type] || item.type) + '</span>' +
                        '<span style="font-size:10px;font-weight:600;padding:1px 8px;border-radius:9999px;background:' + (statusColors[item.status] || '#9ca3af') + '15;color:' + (statusColors[item.status] || '#9ca3af') + ';">' + (statusLabels[item.status] || item.status) + '</span>' +
                        '</div>' +
                        '<p style="font-size:12px;color:#374151;margin-top:4px;line-height:1.5;">' + _escHtml(item.message) + '</p>';

                    // Add retest response buttons when status is 'hertesten'
                    if (item.status === 'hertesten') {
                        headerHtml += '<div id="retest-response-block" style="margin-top:10px;padding:10px;background:#f5f3ff;border:1px solid #ddd6fe;border-radius:10px;">' +
                            '<p style="font-size:11px;font-weight:600;color:#6d28d9;margin-bottom:8px;"><i class="fas fa-sync-alt" style="margin-right:4px;"></i> Er is een fix toegepast. Werkt het nu?</p>' +
                            '<div style="display:flex;gap:6px;margin-bottom:6px;">' +
                            '<button onclick="submitRetestResponse(' + item.id + ', &quot;ok&quot;)" style="flex:1;padding:8px 12px;background:#22c55e;color:white;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px;transition:all .2s;" onmouseover="this.style.background=&quot;#16a34a&quot;" onmouseout="this.style.background=&quot;#22c55e&quot;">' +
                            '<i class="fas fa-check-circle"></i> Ja, werkt nu!</button>' +
                            '<button onclick="submitRetestResponse(' + item.id + ', &quot;not_ok&quot;)" style="flex:1;padding:8px 12px;background:#ef4444;color:white;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px;transition:all .2s;" onmouseover="this.style.background=&quot;#dc2626&quot;" onmouseout="this.style.background=&quot;#ef4444&quot;">' +
                            '<i class="fas fa-times-circle"></i> Nee, nog niet goed</button>' +
                            '</div>' +
                            '<input type="text" id="retest-comment-input" placeholder="Optioneel: geef extra uitleg..." style="width:100%;box-sizing:border-box;padding:6px 10px;border:1px solid #ddd6fe;border-radius:6px;font-size:11px;background:white;" />' +
                            '</div>';
                    }

                    header.innerHTML = headerHtml;

                    const comments = commentsData.comments || [];
                    if (comments.length === 0) {
                        messages.innerHTML = '<div class="text-center py-6">' +
                            '<i class="fas fa-comments text-2xl text-gray-200 mb-2 block"></i>' +
                            '<p class="text-xs text-gray-400">Nog geen reacties.</p>' +
                            '<p class="text-xs text-gray-300 mt-1">Stel een vraag of geef meer info hieronder.</p>' +
                            '</div>';
                    } else {
                        messages.innerHTML = comments.map(function(c) {
                            const isAdmin = c.is_admin === 1;
                            const name = ((c.voornaam || '') + ' ' + (c.achternaam || '')).trim();
                            const date = new Date(c.created_at).toLocaleDateString('nl-BE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
                            
                            if (isAdmin) {
                                return '<div style="display:flex;justify-content:flex-start;">' +
                                    '<div style="max-width:85%;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;border-bottom-left-radius:2px;padding:6px 10px;">' +
                                    '<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">' +
                                    '<span style="font-size:10px;font-weight:700;color:#166534;"><i class="fas fa-shield-alt" style="margin-right:2px;"></i>Admin</span>' +
                                    '<span style="font-size:9px;color:#9ca3af;">' + date + '</span>' +
                                    '</div>' +
                                    '<p style="font-size:12px;color:#1f2937;margin:0;line-height:1.4;">' + _escHtml(c.message) + '</p>' +
                                    '</div></div>';
                            } else {
                                return '<div style="display:flex;justify-content:flex-end;">' +
                                    '<div style="max-width:85%;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;border-bottom-right-radius:2px;padding:6px 10px;">' +
                                    '<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">' +
                                    '<span style="font-size:10px;font-weight:600;color:#1e40af;"><i class="fas fa-user" style="margin-right:2px;"></i>Jij</span>' +
                                    '<span style="font-size:9px;color:#9ca3af;">' + date + '</span>' +
                                    '</div>' +
                                    '<p style="font-size:12px;color:#1f2937;margin:0;line-height:1.4;">' + _escHtml(c.message) + '</p>' +
                                    '</div></div>';
                            }
                        }).join('');
                        messages.scrollTop = messages.scrollHeight;
                    }
                } catch(e) {
                    messages.innerHTML = '<div class="text-center text-xs text-red-400 py-4"><i class="fas fa-exclamation-triangle mr-1"></i> Kon conversatie niet laden.</div>';
                }
            }

            function closeFeedbackDetail() {
                currentDetailFeedbackId = null;
                document.getElementById('my-feedback-detail').classList.add('hidden');
                // Re-fetch to get updated statuses (e.g. after retest response)
                loadMyFeedback();
            }

            async function submitRetestResponse(feedbackId, verdict) {
                const commentInput = document.getElementById('retest-comment-input');
                const comment = commentInput ? commentInput.value.trim() : '';
                
                // Disable buttons to prevent double-click
                const block = document.getElementById('retest-response-block');
                if (block) {
                    block.innerHTML = '<div style="text-align:center;padding:8px;"><i class="fas fa-spinner fa-spin" style="color:#6d28d9;"></i> <span style="font-size:11px;color:#6d28d9;font-weight:600;">Verwerken...</span></div>';
                }

                try {
                    const res = await fetch('/api/feedback/' + feedbackId + '/retest-response', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ verdict: verdict, comment: comment })
                    });

                    if (!res.ok) {
                        const err = await res.json();
                        throw new Error(err.error || 'Fout bij versturen');
                    }

                    const data = await res.json();
                    
                    // Show success message
                    if (block) {
                        if (verdict === 'ok') {
                            block.innerHTML = '<div style="text-align:center;padding:10px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;">' +
                                '<i class="fas fa-check-circle" style="color:#22c55e;font-size:18px;display:block;margin-bottom:4px;"></i>' +
                                '<span style="font-size:11px;color:#166534;font-weight:600;">Bedankt! Gemarkeerd als opgelost.</span></div>';
                        } else {
                            block.innerHTML = '<div style="text-align:center;padding:10px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;">' +
                                '<i class="fas fa-redo" style="color:#ef4444;font-size:18px;display:block;margin-bottom:4px;"></i>' +
                                '<span style="font-size:11px;color:#991b1b;font-weight:600;">Feedback ontvangen. We kijken er opnieuw naar!</span></div>';
                        }
                    }

                    // Refresh the detail view after a short delay
                    setTimeout(function() { openFeedbackDetail(feedbackId); }, 1500);
                } catch(e) {
                    if (block) {
                        block.innerHTML = '<div style="text-align:center;padding:8px;color:#ef4444;font-size:11px;font-weight:600;"><i class="fas fa-exclamation-triangle" style="margin-right:4px;"></i> ' + _escHtml(e.message) + '</div>';
                    }
                }
            }

            async function sendUserComment() {
                if (!currentDetailFeedbackId) return;
                const input = document.getElementById('my-feedback-reply-input');
                const message = input.value.trim();
                if (!message) return;
                
                input.disabled = true;
                try {
                    const res = await fetch('/api/feedback/' + currentDetailFeedbackId + '/comments', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ message: message })
                    });
                    if (!res.ok) {
                        const err = await res.json();
                        throw new Error(err.error || 'Fout');
                    }
                    input.value = '';
                    openFeedbackDetail(currentDetailFeedbackId);
                } catch(e) {
                    alert('Fout: ' + e.message);
                } finally {
                    input.disabled = false;
                    input.focus();
                }
            }

            function loadScreenshot(blob) {
                // Compress screenshot client-side voor snellere upload (#bug-report-traagheid)
                // Doel: max 1280px breed, JPEG q=0.75 — typisch < 200 KB ipv 2-3 MB
                const reader = new FileReader();
                reader.onload = function(e) {
                    const img = new Image();
                    img.onload = function() {
                        try {
                            const maxW = 1280;
                            const scale = img.width > maxW ? maxW / img.width : 1;
                            const w = Math.round(img.width * scale);
                            const h = Math.round(img.height * scale);
                            const canvas = document.createElement('canvas');
                            canvas.width = w; canvas.height = h;
                            const ctx = canvas.getContext('2d');
                            ctx.drawImage(img, 0, 0, w, h);
                            // JPEG voor kleinere bestanden; behoud transparency niet nodig voor screenshots
                            betaScreenshotData = canvas.toDataURL('image/jpeg', 0.75);
                        } catch(err) {
                            // Fallback: gebruik origineel
                            betaScreenshotData = e.target.result;
                        }
                        document.getElementById('screenshot-img').src = betaScreenshotData;
                        document.getElementById('screenshot-preview').classList.remove('hidden');
                        document.getElementById('screenshot-zone').classList.add('hidden');
                    };
                    img.onerror = function() {
                        // Fallback: gebruik raw data url
                        betaScreenshotData = e.target.result;
                        document.getElementById('screenshot-img').src = betaScreenshotData;
                        document.getElementById('screenshot-preview').classList.remove('hidden');
                        document.getElementById('screenshot-zone').classList.add('hidden');
                    };
                    img.src = e.target.result;
                };
                reader.readAsDataURL(blob);
            }

            function clearScreenshot() {
                betaScreenshotData = null;
                document.getElementById('screenshot-img').src = '';
                document.getElementById('screenshot-preview').classList.add('hidden');
                document.getElementById('screenshot-zone').classList.remove('hidden');
                const fi = document.getElementById('screenshot-file');
                if (fi) fi.value = '';
            }

            async function submitBetaFeedback(e) {
                e.preventDefault();
                const form = e.target;
                const submitBtn = form.querySelector('button[type="submit"]');
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Versturen...';
                // Top loading bar tonen voor zichtbare feedback
                if (window.__topbar && window.__topbar.start) window.__topbar.start();

                const formData = new FormData(form);
                const data = {
                    type: formData.get('type'),
                    message: formData.get('message'),
                    url: window.location.href,
                    screenshot: betaScreenshotData || '',
                    browser_info: navigator.userAgent + ' | ' + screen.width + 'x' + screen.height + ' | ' + (navigator.language || '')
                };

                try {
                    // Timeout van 30s zodat een hangende fetch niet eeuwig draait
                    const ctrl = new AbortController();
                    const timer = setTimeout(() => ctrl.abort(), 30000);
                    const res = await fetch('/api/feedback', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify(data),
                        signal: ctrl.signal
                    });
                    clearTimeout(timer);

                    if (window.__topbar && window.__topbar.done) window.__topbar.done();
                    if (res.ok) {
                        submitBtn.innerHTML = '<i class="fas fa-check mr-1"></i> Verzonden!';
                        betaFeedbackLoaded = false; // reset so it reloads next time
                        setTimeout(() => {
                            document.getElementById('beta-popup').classList.add('hidden');
                            form.reset();
                            clearScreenshot();
                            submitBtn.disabled = false;
                            submitBtn.innerHTML = '<i class="fas fa-paper-plane mr-1"></i> Versturen';
                        }, 1500);
                    } else {
                        const err = await res.json().catch(() => ({}));
                        submitBtn.disabled = false;
                        submitBtn.innerHTML = '<i class="fas fa-paper-plane mr-1"></i> Versturen';
                        if(err.error === 'Unauthorized') alert('Je moet ingelogd zijn om feedback te geven.');
                        else alert('Er ging iets mis: ' + (err.error || 'Onbekende fout'));
                    }
                } catch(e) {
                    if (window.__topbar && window.__topbar.done) window.__topbar.done();
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = '<i class="fas fa-paper-plane mr-1"></i> Versturen';
                    if (e && e.name === 'AbortError') {
                        alert('De verbinding duurde te lang. Probeer opnieuw met een kleinere screenshot of zonder screenshot.');
                    } else {
                        alert('Verbindingsfout');
                    }
                }
            }
