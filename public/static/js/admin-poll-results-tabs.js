/**
 * Admin Poll Results — Tab Switcher
 *
 * Werkt met markup:
 *   <div id="tab-bar">
 *     <button data-tab="foo" class="tab-btn ...">...</button>
 *   </div>
 *   <div data-pane="foo" class="...">...</div>
 *
 * Toggelt `hidden` op de panes en wisselt active styling op de knoppen.
 */
(function () {
  'use strict';

  const ACTIVE_CLASSES = ['text-animato-primary', 'border-animato-primary'];
  const INACTIVE_CLASSES = ['text-gray-500', 'hover:text-gray-700', 'border-transparent'];

  function init() {
    const bar = document.getElementById('tab-bar');
    if (!bar) return;

    const buttons = Array.from(bar.querySelectorAll('button[data-tab]'));
    if (buttons.length === 0) return;

    const panes = Array.from(document.querySelectorAll('[data-pane]'));
    if (panes.length === 0) return;

    function activate(tabName) {
      // Knoppen
      buttons.forEach((btn) => {
        const isActive = btn.dataset.tab === tabName;
        if (isActive) {
          btn.classList.remove(...INACTIVE_CLASSES);
          btn.classList.add(...ACTIVE_CLASSES);
        } else {
          btn.classList.remove(...ACTIVE_CLASSES);
          btn.classList.add(...INACTIVE_CLASSES);
        }
      });

      // Panes
      panes.forEach((pane) => {
        if (pane.dataset.pane === tabName) {
          pane.classList.remove('hidden');
        } else {
          pane.classList.add('hidden');
        }
      });

      // URL hash bijwerken zonder scroll-jump
      if (history.replaceState) {
        history.replaceState(null, '', '#' + tabName);
      }
    }

    buttons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const tab = btn.dataset.tab;
        if (tab) activate(tab);
      });
    });

    // Bij page-load: kijk of er een hash is die overeenkomt met een tab
    const hash = (location.hash || '').replace(/^#/, '');
    if (hash && buttons.some((b) => b.dataset.tab === hash)) {
      activate(hash);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
