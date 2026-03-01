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

    // Check if we need to redirect to start page
    const firstStep = data.steps[0]
    const currentPath = window.location.pathname
    
    // Only redirect if target_url is defined and we are not on that page
    if (firstStep.target_url && currentPath !== firstStep.target_url) {
       const targetUrl = firstStep.target_url
       const separator = targetUrl.includes('?') ? '&' : '?'
       window.location.href = `${targetUrl}${separator}start_tour=${tourId}`
       return
    }

    // Initialize tour
    const tour = initWalkthroughTour(
      data,
      // onComplete callback
      async () => {
        await fetch(`/api/walkthrough/tours/${tourId}/complete`, { method: 'POST' })
        showToast('Tour voltooid! 🎉', 'success')
        // Refresh the list if modal is open (unlikely) or just update state for next open
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
    modalContent.className = 'bg-white rounded-lg shadow-xl max-w-2xl w-full overflow-hidden'
    
    modalContent.innerHTML = `
      <div class="p-5 border-b border-gray-200">
        <div class="flex items-center justify-between">
          <h2 class="text-2xl font-bold text-gray-900 flex items-center">
            <i class="fas fa-route text-animato-primary mr-3"></i>
            Kies een Tour
          </h2>
          <button onclick="document.getElementById('tour-selector-modal').remove()" class="text-gray-400 hover:text-gray-600 transition">
            <i class="fas fa-times text-xl"></i>
          </button>
        </div>
      </div>
      <div class="p-5 bg-gray-50 max-h-[60vh] overflow-y-auto">
        ${data.tours.length > 0 ? `<div class="mb-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Beschikbare Tours</div>` : ''}
        <div class="space-y-4">
          ${data.tours.map(tour => {
            const isCompleted = tour.completed === 1;
            return `
            <div class="bg-white border border-gray-200 rounded-xl p-5 hover:border-animato-primary hover:shadow-md transition-all cursor-pointer relative group" onclick="startWalkthroughTour(${tour.id}); document.getElementById('tour-selector-modal').remove();">
              <div class="flex items-start">
                <div class="w-12 h-12 ${isCompleted ? 'bg-green-100 text-green-600' : 'bg-animato-primary text-white'} rounded-xl flex items-center justify-center mr-4 flex-shrink-0 text-xl shadow-sm">
                  <i class="${tour.icon}"></i>
                </div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center justify-between mb-1">
                    <h3 class="font-bold text-gray-900 truncate pr-2 text-lg">${tour.title}</h3>
                    ${isCompleted 
                      ? '<span class="px-2.5 py-1 bg-green-100 text-green-700 text-xs font-bold rounded-full flex items-center flex-shrink-0 border border-green-200"><i class="fas fa-check mr-1.5"></i>Voltooid</span>' 
                      : '<span class="px-2.5 py-1 bg-blue-50 text-blue-700 text-xs font-bold rounded-full flex-shrink-0 border border-blue-100">Nieuw</span>'
                    }
                  </div>
                  <p class="text-sm text-gray-600 mb-4 line-clamp-2">${tour.description || ''}</p>
                  
                  <div class="flex items-center justify-between mt-auto pt-2 border-t border-gray-50">
                    <div class="flex items-center gap-4 text-xs font-medium text-gray-500">
                      <span class="flex items-center"><i class="fas fa-list-ol mr-1.5 text-gray-400"></i>${tour.step_count} stappen</span>
                      ${tour.current_step > 1 && !isCompleted ? `<span class="text-animato-primary"><i class="fas fa-spinner mr-1.5 fa-pulse"></i>${Math.round((tour.current_step / tour.step_count) * 100)}%</span>` : ''}
                    </div>
                    <button class="px-4 py-1.5 text-xs font-semibold rounded-lg transition-colors ${isCompleted ? 'bg-gray-100 text-gray-600 hover:bg-gray-200' : 'bg-animato-primary text-white hover:bg-animato-secondary shadow-sm'}">
                      ${isCompleted ? '<i class="fas fa-redo-alt mr-1.5"></i>Opnieuw' : '<i class="fas fa-play mr-1.5"></i>Starten'}
                    </button>
                  </div>
                  
                  ${!isCompleted && tour.current_step > 1 ? `
                    <div class="absolute bottom-0 left-0 right-0 h-1 bg-gray-100 rounded-b-xl overflow-hidden">
                      <div class="bg-animato-primary h-full rounded-r-full" style="width: ${(tour.current_step / tour.step_count) * 100}%"></div>
                    </div>
                  ` : ''}
                </div>
              </div>
            </div>
          `}).join('')}
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
    
    // Check for direct start via URL param (e.g. from admin preview)
    const urlParams = new URLSearchParams(window.location.search)
    const startTourId = urlParams.get('start_tour')
    if (startTourId) {
      // Small delay to ensure page is ready
      setTimeout(() => {
        startWalkthroughTour(startTourId)
      }, 1000)
    }
  })
} else {
  initFloatingHelpButton()
  if (window.location.search.includes('first_login=1')) {
    checkAutoStartTour()
  }
  
  // Check for direct start via URL param
  const urlParams = new URLSearchParams(window.location.search)
  const startTourId = urlParams.get('start_tour')
  if (startTourId) {
    setTimeout(() => {
      startWalkthroughTour(startTourId)
    }, 1000)
  }
}

// Make functions globally available
window.startWalkthroughTour = startWalkthroughTour
window.showTourSelector = showTourSelector
