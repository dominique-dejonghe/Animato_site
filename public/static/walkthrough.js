/**
 * Walkthrough Tours - Shepherd.js Integration
 * Interactive guided tours for Animato Koor
 */

// =====================================================
// INIT SHEPHERD TOUR
// =====================================================

function initWalkthroughTour(tourData, onComplete, onSkip) {
  // Check if Shepherd is loaded
  if (typeof Shepherd === 'undefined') {
    console.error('Shepherd.js not loaded')
    return null
  }

  const tour = new Shepherd.Tour({
    useModalOverlay: true,
    defaultStepOptions: {
      cancelIcon: {
        enabled: true
      },
      scrollTo: { behavior: 'smooth', block: 'center' },
      classes: 'walkthrough-step',
      modalOverlayOpeningPadding: 10,
      modalOverlayOpeningRadius: 8
    }
  })

  // Build steps from tour data
  tourData.steps.forEach((step, index) => {
    const isFirst = index === 0
    const isLast = index === tourData.steps.length - 1
    
    const stepConfig = {
      id: `step-${step.id}`,
      title: step.title,
      text: step.description,
      buttons: []
    }

    // Add attachTo if target element exists
    if (step.target_element) {
      stepConfig.attachTo = {
        element: step.target_element,
        on: step.position || 'bottom'
      }
      
      // Check if element exists, if not show warning
      stepConfig.beforeShowPromise = function() {
        return new Promise((resolve) => {
          const element = document.querySelector(step.target_element)
          if (!element && step.target_element !== 'body') {
            console.warn(`Element not found: ${step.target_element}`)
            // Modify step to show without attachment
            stepConfig.attachTo = { element: 'body', on: 'center' }
            stepConfig.text = `⚠️ <em>Element niet gevonden op deze pagina.</em><br><br>${step.description}`
          }
          resolve()
        })
      }
    }

    // Back button (except first step)
    if (!isFirst) {
      stepConfig.buttons.push({
        text: 'Terug',
        action: tour.back,
        classes: 'shepherd-button-secondary'
      })
    }

    // Skip button
    stepConfig.buttons.push({
      text: 'Skip Tour',
      action: () => {
        tour.cancel()
        if (onSkip) onSkip()
      },
      classes: 'shepherd-button-skip'
    })

    // Next/Complete button
    if (isLast) {
      stepConfig.buttons.push({
        text: 'Voltooien! 🎉',
        action: () => {
          tour.complete()
          if (onComplete) onComplete()
        },
        classes: 'shepherd-button-primary'
      })
    } else {
      stepConfig.buttons.push({
        text: `Volgende (${index + 1}/${tourData.steps.length})`,
        action: tour.next,
        classes: 'shepherd-button-primary'
      })
    }

    tour.addStep(stepConfig)
  })

  // Track progress on step change
  tour.on('show', (event) => {
    const currentStep = tour.getCurrentStep()
    const stepIndex = tour.steps.indexOf(currentStep)
    
    // Send progress to API
    fetch(`/api/walkthrough/tours/${tourData.tour.id}/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_step: stepIndex + 1 })
    }).catch(err => console.error('Failed to update progress:', err))
  })

  return tour
}

// =====================================================
// LOAD AND START TOUR
// =====================================================

async function startWalkthroughTour(tourId) {
  try {
    // Start the tour in backend
    await fetch(`/api/walkthrough/tours/${tourId}/start`, { method: 'POST' })

    // Get tour data with steps
    const response = await fetch(`/api/walkthrough/tours/${tourId}`)
    const data = await response.json()

    if (!data.tour || !data.steps || data.steps.length === 0) {
      alert('Tour heeft geen stappen')
      return
    }

    // Initialize tour
    const tour = initWalkthroughTour(
      data,
      // onComplete callback
      async () => {
        await fetch(`/api/walkthrough/tours/${tourId}/complete`, { method: 'POST' })
        showToast('Tour voltooid! 🎉', 'success')
      },
      // onSkip callback
      async () => {
        await fetch(`/api/walkthrough/tours/${tourId}/skip`, { method: 'POST' })
        showToast('Tour overgeslagen', 'info')
      }
    )

    if (tour) {
      tour.start()
    }
  } catch (error) {
    console.error('Failed to start tour:', error)
    alert('Kon tour niet starten. Probeer het later opnieuw.')
  }
}

// =====================================================
// AUTO-START TOUR ON FIRST LOGIN
// =====================================================

async function checkAutoStartTour() {
  try {
    const response = await fetch('/api/walkthrough/auto-start')
    const data = await response.json()

    if (data.tour) {
      // Wait a bit for page to fully load
      setTimeout(() => {
        const shouldStart = confirm(
          `🎯 Welkom!\n\nWil je een snelle rondleiding van ${data.tour.title}?\n\nDit duurt ongeveer ${Math.ceil(data.tour.step_count * 0.5)} minuten.`
        )
        
        if (shouldStart) {
          startWalkthroughTour(data.tour.id)
        } else {
          // Mark as skipped
          fetch(`/api/walkthrough/tours/${data.tour.id}/skip`, { method: 'POST' })
        }
      }, 1500)
    }
  } catch (error) {
    console.error('Failed to check auto-start tour:', error)
  }
}

// =====================================================
// TOAST NOTIFICATIONS
// =====================================================

function showToast(message, type = 'info') {
  const toast = document.createElement('div')
  toast.className = `fixed top-4 right-4 px-6 py-3 rounded-lg shadow-lg text-white z-50 animate-fade-in`
  
  const bgColors = {
    success: 'bg-green-500',
    info: 'bg-blue-500',
    warning: 'bg-yellow-500',
    error: 'bg-red-500'
  }
  
  toast.classList.add(bgColors[type] || bgColors.info)
  toast.textContent = message
  
  document.body.appendChild(toast)
  
  setTimeout(() => {
    toast.classList.add('animate-fade-out')
    setTimeout(() => toast.remove(), 300)
  }, 3000)
}

// =====================================================
// FLOATING HELP BUTTON
// =====================================================

function initFloatingHelpButton() {
  // Create floating help button
  const helpBtn = document.createElement('button')
  helpBtn.id = 'floating-help-btn'
  helpBtn.className = 'fixed bottom-6 right-6 w-14 h-14 bg-animato-primary text-white rounded-full shadow-lg hover:scale-110 transition-transform z-40 flex items-center justify-center'
  helpBtn.innerHTML = '<i class="fas fa-question text-xl"></i>'
  helpBtn.title = 'Help & Tours'
  
  helpBtn.addEventListener('click', showTourSelector)
  
  document.body.appendChild(helpBtn)
}

// =====================================================
// TOUR SELECTOR MODAL
// =====================================================

async function showTourSelector() {
  try {
    const response = await fetch('/api/walkthrough/tours')
    const data = await response.json()

    if (!data.tours || data.tours.length === 0) {
      alert('Geen tours beschikbaar')
      return
    }

    // Create modal
    const modal = document.createElement('div')
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4'
    modal.id = 'tour-selector-modal'
    
    const modalContent = document.createElement('div')
    modalContent.className = 'bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto'
    
    modalContent.innerHTML = `
      <div class="p-6 border-b border-gray-200">
        <div class="flex items-center justify-between">
          <h2 class="text-2xl font-bold text-gray-900">
            <i class="fas fa-route text-animato-primary mr-2"></i>
            Kies een Tour
          </h2>
          <button onclick="document.getElementById('tour-selector-modal').remove()" class="text-gray-400 hover:text-gray-600">
            <i class="fas fa-times text-xl"></i>
          </button>
        </div>
      </div>
      <div class="p-6">
        <div class="space-y-3">
          ${data.tours.map(tour => `
            <div class="border border-gray-200 rounded-lg p-4 hover:border-animato-primary transition cursor-pointer" onclick="startWalkthroughTour(${tour.id}); document.getElementById('tour-selector-modal').remove();">
              <div class="flex items-start">
                <div class="w-10 h-10 bg-animato-primary text-white rounded-lg flex items-center justify-center mr-3 flex-shrink-0">
                  <i class="${tour.icon}"></i>
                </div>
                <div class="flex-1">
                  <h3 class="font-semibold text-gray-900 mb-1">${tour.title}</h3>
                  <p class="text-sm text-gray-600 mb-2">${tour.description || ''}</p>
                  <div class="flex items-center gap-4 text-xs text-gray-500">
                    <span><i class="fas fa-list-ol mr-1"></i>${tour.step_count} steps</span>
                    ${tour.completed ? '<span class="text-green-600"><i class="fas fa-check-circle mr-1"></i>Voltooid</span>' : ''}
                  </div>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `
    
    modal.appendChild(modalContent)
    document.body.appendChild(modal)
    
    // Close on backdrop click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove()
    })
  } catch (error) {
    console.error('Failed to load tours:', error)
    alert('Kon tours niet laden')
  }
}

// =====================================================
// INIT ON PAGE LOAD
// =====================================================

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initFloatingHelpButton()
    // Check for auto-start tours
    if (window.location.search.includes('first_login=1')) {
      checkAutoStartTour()
    }
  })
} else {
  initFloatingHelpButton()
  if (window.location.search.includes('first_login=1')) {
    checkAutoStartTour()
  }
}

// Make functions globally available
window.startWalkthroughTour = startWalkthroughTour
window.showTourSelector = showTourSelector
