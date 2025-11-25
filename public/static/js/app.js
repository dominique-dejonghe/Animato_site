// JavaScript voor Gemengd Koor Animato Website
// Client-side interactiviteit en form handling

console.log('🎵 Animato Koor Website geladen');

// =====================================================
// UTILITY FUNCTIONS
// =====================================================

/**
 * Show toast notification
 */
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `fixed bottom-4 right-4 px-6 py-3 rounded-lg shadow-lg text-white z-50 animate-fade-in ${
    type === 'success' ? 'bg-green-500' :
    type === 'error' ? 'bg-red-500' :
    type === 'warning' ? 'bg-yellow-500' :
    'bg-blue-500'
  }`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 300ms';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

/**
 * Format date for display
 */
function formatDate(dateString) {
  const date = new Date(dateString);
  return new Intl.DateTimeFormat('nl-BE', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }).format(date);
}

/**
 * Format time for display
 */
function formatTime(dateString) {
  const date = new Date(dateString);
  return new Intl.DateTimeFormat('nl-BE', {
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

// =====================================================
// FORM HANDLING
// =====================================================

/**
 * Handle form submissions with fetch API
 */
document.addEventListener('DOMContentLoaded', () => {
  // Handle all forms with data-ajax attribute
  document.querySelectorAll('form[data-ajax]').forEach(form => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const submitBtn = form.querySelector('button[type="submit"]');
      const originalText = submitBtn?.textContent;
      
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Bezig...';
      }

      const formData = new FormData(form);
      const data = Object.fromEntries(formData.entries());

      try {
        const response = await fetch(form.action, {
          method: form.method || 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(data)
        });

        const result = await response.json();

        if (response.ok) {
          showToast(result.message || 'Succes!', 'success');
          form.reset();
          
          // Redirect if specified
          if (result.redirect) {
            setTimeout(() => {
              window.location.href = result.redirect;
            }, 1000);
          }
        } else {
          showToast(result.error || 'Er is een fout opgetreden', 'error');
        }
      } catch (error) {
        console.error('Form submission error:', error);
        showToast('Er is een fout opgetreden. Probeer het later opnieuw.', 'error');
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = originalText;
        }
      }
    });
  });
});

// =====================================================
// MOBILE MENU
// =====================================================

document.addEventListener('DOMContentLoaded', () => {
  const mobileMenuButton = document.getElementById('mobile-menu-button');
  const mobileMenu = document.getElementById('mobile-menu');

  if (mobileMenuButton && mobileMenu) {
    mobileMenuButton.addEventListener('click', () => {
      mobileMenu.classList.toggle('hidden');
    });

    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
      if (!mobileMenuButton.contains(e.target) && !mobileMenu.contains(e.target)) {
        mobileMenu.classList.add('hidden');
      }
    });
  }
});

// =====================================================
// SMOOTH SCROLL
// =====================================================

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      const href = this.getAttribute('href');
      if (href === '#') return;

      e.preventDefault();
      const target = document.querySelector(href);
      
      if (target) {
        target.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      }
    });
  });
});

// =====================================================
// IMAGE LAZY LOADING
// =====================================================

if ('IntersectionObserver' in window) {
  const imageObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const img = entry.target;
        if (img.dataset.src) {
          img.src = img.dataset.src;
          img.removeAttribute('data-src');
          observer.unobserve(img);
        }
      }
    });
  });

  document.querySelectorAll('img[data-src]').forEach(img => {
    imageObserver.observe(img);
  });
}

// =====================================================
// TICKET BOOKING (voor later)
// =====================================================

window.AnimatoTicketing = {
  async bookTickets(concertId, ticketData) {
    try {
      const response = await fetch('/api/tickets/book', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ concertId, ...ticketData })
      });

      const result = await response.json();

      if (response.ok) {
        showToast('Tickets gereserveerd!', 'success');
        return result;
      } else {
        showToast(result.error || 'Kon tickets niet reserveren', 'error');
        return null;
      }
    } catch (error) {
      console.error('Booking error:', error);
      showToast('Er is een fout opgetreden', 'error');
      return null;
    }
  }
};

// =====================================================
// ANALYTICS (Google Analytics - optioneel)
// =====================================================

// Uncomment wanneer GA tracking code beschikbaar is:
// window.dataLayer = window.dataLayer || [];
// function gtag(){dataLayer.push(arguments);}
// gtag('js', new Date());
// gtag('config', 'GA_MEASUREMENT_ID');

// =====================================================
// SERVICE WORKER (voor later - PWA support)
// =====================================================

// if ('serviceWorker' in navigator) {
//   window.addEventListener('load', () => {
//     navigator.serviceWorker.register('/sw.js')
//       .then(registration => console.log('SW registered:', registration))
//       .catch(error => console.log('SW registration failed:', error));
//   });
// }
