// Voice Range Analyzer Routes
// Upload audio, analyze pitch range, suggest stemgroep

import { Hono } from 'hono'
import type { Bindings, SessionUser } from '../types'
import { Layout } from '../components/Layout'
import { queryOne, execute, formatDateForDB } from '../utils/db'

const app = new Hono<{ Bindings: Bindings }>()

// =====================================================
// VOICE ANALYZER PAGE (Public - no auth required)
// =====================================================

app.get('/stem-test', async (c) => {
  const user = c.get('user') as SessionUser | null

  return c.html(
    <Layout 
      title="Stem Bereik Test" 
      user={user}
      description="Ontdek welke stemgroep het beste bij jouw stem past"
    >
      <div class="bg-gradient-to-b from-gray-50 to-white min-h-screen py-12">
        <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          
          {/* Header */}
          <div class="text-center mb-12">
            <div class="inline-block p-4 bg-animato-primary/10 rounded-full mb-4">
              <i class="fas fa-microphone text-5xl text-animato-primary"></i>
            </div>
            <h1 class="text-4xl font-bold text-gray-900 mb-4" style="font-family: 'Playfair Display', serif;">
              Stem Bereik Analyse
            </h1>
            <p class="text-xl text-gray-600 max-w-2xl mx-auto">
              Upload een audio sample van je stem en ontdek welke stemgroep het beste bij je past
            </p>
          </div>

          {/* Instructions Card */}
          <div class="bg-blue-50 border-2 border-blue-200 rounded-lg p-6 mb-8">
            <h3 class="text-lg font-bold text-blue-900 mb-3 flex items-center">
              <i class="fas fa-info-circle mr-2"></i>
              Hoe werkt het?
            </h3>
            <ol class="space-y-2 text-blue-800">
              <li class="flex items-start">
                <span class="font-bold mr-2">1.</span>
                <span>Neem een audio sample op (15-30 seconden) waarin je zingt van je <strong>laagste</strong> tot je <strong>hoogste</strong> comfortabele noot</span>
              </li>
              <li class="flex items-start">
                <span class="font-bold mr-2">2.</span>
                <span>Upload het bestand (MP3, WAV, of M4A - max 5MB)</span>
              </li>
              <li class="flex items-start">
                <span class="font-bold mr-2">3.</span>
                <span>Wacht enkele seconden terwijl we je stem analyseren</span>
              </li>
              <li class="flex items-start">
                <span class="font-bold mr-2">4.</span>
                <span>Bekijk je resultaten en stemgroep aanbeveling</span>
              </li>
            </ol>
          </div>

          {/* Upload Section */}
          <div class="bg-white rounded-lg shadow-lg p-8">
            <form id="voice-upload-form" class="space-y-6">
              
              {/* Audio File Input */}
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  <i class="fas fa-upload text-animato-primary mr-2"></i>
                  Upload Audio Sample
                </label>
                <div class="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-gray-300 border-dashed rounded-lg hover:border-animato-primary transition">
                  <div class="space-y-1 text-center">
                    <i class="fas fa-music text-4xl text-gray-400 mb-3"></i>
                    <div class="flex text-sm text-gray-600">
                      <label for="audio-file" class="relative cursor-pointer bg-white rounded-md font-medium text-animato-primary hover:text-animato-secondary">
                        <span>Upload een bestand</span>
                        <input 
                          id="audio-file" 
                          name="audio-file" 
                          type="file" 
                          class="sr-only" 
                          accept="audio/mp3,audio/wav,audio/m4a,audio/mpeg,audio/x-m4a"
                          required
                        />
                      </label>
                      <p class="pl-1">of sleep hier</p>
                    </div>
                    <p class="text-xs text-gray-500">
                      MP3, WAV, M4A tot 5MB
                    </p>
                  </div>
                </div>
                <div id="file-info" class="mt-2 text-sm text-gray-600 hidden"></div>
              </div>

              {/* Optional: Email for results */}
              {!user && (
                <div>
                  <label for="email" class="block text-sm font-medium text-gray-700 mb-2">
                    <i class="fas fa-envelope text-animato-primary mr-2"></i>
                    Email (optioneel)
                  </label>
                  <input
                    type="email"
                    id="email"
                    name="email"
                    placeholder="jouw@email.com"
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-animato-primary focus:border-transparent"
                  />
                  <p class="mt-1 text-sm text-gray-500">
                    Ontvang je resultaten per email (niet verplicht)
                  </p>
                </div>
              )}

              {/* Analyze Button */}
              <button
                type="submit"
                id="analyze-btn"
                class="w-full px-6 py-4 bg-animato-primary text-white font-bold rounded-lg hover:bg-animato-secondary transition text-lg"
              >
                <i class="fas fa-chart-line mr-2"></i>
                Analyseer Mijn Stem
              </button>
            </form>

            {/* Processing State */}
            <div id="processing" class="hidden mt-8 text-center">
              <div class="inline-block animate-spin text-4xl text-animato-primary mb-4">
                <i class="fas fa-spinner"></i>
              </div>
              <p class="text-lg text-gray-700 font-medium">Analyseren...</p>
              <p class="text-sm text-gray-500 mt-2">Dit kan 5-10 seconden duren</p>
            </div>

            {/* Results Section */}
            <div id="results" class="hidden mt-8">
              <div class="border-t-2 border-gray-200 pt-8">
                <h2 class="text-2xl font-bold text-gray-900 mb-6" style="font-family: 'Playfair Display', serif;">
                  <i class="fas fa-chart-bar text-animato-accent mr-2"></i>
                  Jouw Resultaten
                </h2>

                {/* Range Display */}
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                  <div class="bg-gradient-to-r from-blue-50 to-blue-100 rounded-lg p-6">
                    <div class="text-sm text-blue-700 font-medium mb-2">Laagste Noot</div>
                    <div id="lowest-note" class="text-3xl font-bold text-blue-900">-</div>
                    <div id="lowest-freq" class="text-sm text-blue-600 mt-1">- Hz</div>
                  </div>
                  <div class="bg-gradient-to-r from-purple-50 to-purple-100 rounded-lg p-6">
                    <div class="text-sm text-purple-700 font-medium mb-2">Hoogste Noot</div>
                    <div id="highest-note" class="text-3xl font-bold text-purple-900">-</div>
                    <div id="highest-freq" class="text-sm text-purple-600 mt-1">- Hz</div>
                  </div>
                </div>

                {/* Stemgroep Recommendation */}
                <div class="bg-gradient-to-r from-animato-primary to-animato-secondary rounded-lg p-8 text-white mb-6">
                  <div class="text-center">
                    <div class="text-lg font-medium mb-2">Aanbevolen Stemgroep</div>
                    <div id="primary-stemgroep" class="text-5xl font-bold mb-2">-</div>
                    <div id="confidence" class="text-xl opacity-90">- match</div>
                  </div>
                </div>

                {/* Secondary Recommendation */}
                <div id="secondary-recommendation" class="hidden bg-gray-50 rounded-lg p-6 mb-6">
                  <div class="text-sm text-gray-600 mb-2">Ook geschikt voor:</div>
                  <div class="flex items-center justify-between">
                    <span id="secondary-stemgroep" class="text-xl font-bold text-gray-900">-</span>
                    <span id="secondary-confidence" class="text-sm text-gray-600">- match</span>
                  </div>
                </div>

                {/* Range Visualization Placeholder */}
                <div class="bg-white border-2 border-gray-200 rounded-lg p-6 mb-6">
                  <h3 class="text-lg font-bold text-gray-900 mb-4">Jouw Bereik</h3>
                  <div id="range-viz" class="h-24 bg-gray-100 rounded flex items-center justify-center">
                    <span class="text-gray-500">Visuele weergave wordt geladen...</span>
                  </div>
                </div>

                {/* Action Buttons */}
                <div class="flex gap-4">
                  <button
                    onclick="location.reload()"
                    class="flex-1 px-6 py-3 border-2 border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-50 transition"
                  >
                    <i class="fas fa-redo mr-2"></i>
                    Nieuwe Test
                  </button>
                  <a
                    href="/word-lid"
                    class="flex-1 px-6 py-3 bg-animato-accent text-white font-semibold rounded-lg hover:bg-amber-600 transition text-center"
                  >
                    <i class="fas fa-user-plus mr-2"></i>
                    Word Lid
                  </a>
                </div>
              </div>
            </div>
          </div>

          {/* Info Footer */}
          <div class="mt-8 text-center text-sm text-gray-500">
            <p class="mb-2">
              <i class="fas fa-lock mr-1"></i>
              Je audio wordt <strong>niet opgeslagen</strong> - alleen de analyse resultaten
            </p>
            <p>
              Deze tool gebruikt Web Audio API voor client-side pitch detection
            </p>
          </div>
        </div>
      </div>

      {/* Voice Analysis JavaScript */}
      <script dangerouslySetInnerHTML={{
        __html: `
        // Voice Analysis Client-Side Implementation
        // Using Web Audio API for pitch detection
        
        const form = document.getElementById('voice-upload-form');
        const fileInput = document.getElementById('audio-file');
        const fileInfo = document.getElementById('file-info');
        const analyzeBtn = document.getElementById('analyze-btn');
        const processing = document.getElementById('processing');
        const results = document.getElementById('results');
        
        let audioBuffer = null;
        let audioContext = null;
        
        // Show file info when selected
        fileInput.addEventListener('change', (e) => {
          const file = e.target.files[0];
          if (file) {
            const sizeMB = (file.size / 1024 / 1024).toFixed(2);
            fileInfo.textContent = \`Geselecteerd: \${file.name} (\${sizeMB}MB)\`;
            fileInfo.classList.remove('hidden');
            fileInfo.classList.add('text-green-600', 'font-medium');
          }
        });
        
        // Handle form submission
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          
          const file = fileInput.files[0];
          if (!file) {
            alert('Selecteer eerst een audio bestand');
            return;
          }
          
          // Check file size
          if (file.size > 5 * 1024 * 1024) {
            alert('Bestand is te groot (max 5MB)');
            return;
          }
          
          // Show processing
          form.classList.add('hidden');
          processing.classList.remove('hidden');
          
          try {
            // Initialize audio context
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            // Read file
            const arrayBuffer = await file.arrayBuffer();
            audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
            
            // Analyze pitch
            const analysis = await analyzePitchRange(audioBuffer);
            
            // Save to database
            await saveAnalysis(analysis);
            
            // Show results
            displayResults(analysis);
            
            processing.classList.add('hidden');
            results.classList.remove('hidden');
            
          } catch (error) {
            console.error('Analysis error:', error);
            processing.classList.add('hidden');
            form.classList.remove('hidden');
            alert('Er ging iets mis bij de analyse. Probeer opnieuw.');
          }
        });
        
        // Pitch detection function (simplified autocorrelation)
        function analyzePitchRange(audioBuffer) {
          return new Promise((resolve) => {
            const channelData = audioBuffer.getChannelData(0);
            const sampleRate = audioBuffer.sampleRate;
            const windowSize = 4096;
            const hopSize = 2048;
            
            const frequencies = [];
            
            // Process audio in windows
            for (let i = 0; i < channelData.length - windowSize; i += hopSize) {
              const window = channelData.slice(i, i + windowSize);
              const freq = detectPitch(window, sampleRate);
              if (freq > 0 && freq >= 60 && freq <= 1200) {
                frequencies.push(freq);
              }
            }
            
            // Filter and sort
            frequencies.sort((a, b) => a - b);
            
            // Get lowest and highest (ignore outliers)
            const percentile10 = Math.floor(frequencies.length * 0.1);
            const percentile90 = Math.floor(frequencies.length * 0.9);
            
            const lowestFreq = frequencies[percentile10] || frequencies[0] || 100;
            const highestFreq = frequencies[percentile90] || frequencies[frequencies.length - 1] || 400;
            
            const lowestNote = frequencyToNote(lowestFreq);
            const highestNote = frequencyToNote(highestFreq);
            
            // Determine stemgroep
            const stemgroep = determineStemgroep(lowestFreq, highestFreq);
            
            resolve({
              lowestFreq: lowestFreq.toFixed(1),
              highestFreq: highestFreq.toFixed(1),
              lowestNote,
              highestNote,
              primaryStemgroep: stemgroep.primary.name,
              primaryConfidence: stemgroep.primary.confidence,
              secondaryStemgroep: stemgroep.secondary?.name,
              secondaryConfidence: stemgroep.secondary?.confidence,
              duration: audioBuffer.duration
            });
          });
        }
        
        // Simple autocorrelation pitch detection
        function detectPitch(buffer, sampleRate) {
          const minFreq = 60; // Hz
          const maxFreq = 1200; // Hz
          const minPeriod = Math.floor(sampleRate / maxFreq);
          const maxPeriod = Math.floor(sampleRate / minFreq);
          
          let bestCorrelation = 0;
          let bestPeriod = 0;
          
          for (let period = minPeriod; period < maxPeriod; period++) {
            let correlation = 0;
            for (let i = 0; i < buffer.length - period; i++) {
              correlation += Math.abs(buffer[i] - buffer[i + period]);
            }
            correlation = 1 - (correlation / (buffer.length - period));
            
            if (correlation > bestCorrelation && correlation > 0.5) {
              bestCorrelation = correlation;
              bestPeriod = period;
            }
          }
          
          return bestPeriod > 0 ? sampleRate / bestPeriod : 0;
        }
        
        // Convert frequency to note name
        function frequencyToNote(freq) {
          const A4 = 440;
          const C0 = A4 * Math.pow(2, -4.75);
          const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
          
          const halfSteps = 12 * Math.log2(freq / C0);
          const octave = Math.floor(halfSteps / 12);
          const note = Math.round(halfSteps % 12);
          
          return noteNames[note] + octave;
        }
        
        // Determine stemgroep based on range
        function determineStemgroep(lowFreq, highFreq) {
          const avgFreq = (lowFreq + highFreq) / 2;
          
          // Stemgroep ranges (approximate)
          const ranges = {
            'Sopraan': { low: 260, high: 1047, ideal: 500 },
            'Alt': { low: 196, high: 698, ideal: 400 },
            'Tenor': { low: 130, high: 523, ideal: 300 },
            'Bas': { low: 82, high: 349, ideal: 200 }
          };
          
          const scores = Object.entries(ranges).map(([name, range]) => {
            const inRange = lowFreq >= range.low * 0.8 && highFreq <= range.high * 1.2;
            const avgMatch = 1 - Math.abs(avgFreq - range.ideal) / range.ideal;
            const rangeMatch = (Math.min(highFreq, range.high) - Math.max(lowFreq, range.low)) / 
                              (range.high - range.low);
            
            const confidence = (inRange ? 0.5 : 0) + (avgMatch * 0.3) + (rangeMatch * 0.2);
            
            return { name, confidence: Math.max(0, Math.min(1, confidence)) };
          }).sort((a, b) => b.confidence - a.confidence);
          
          return {
            primary: scores[0],
            secondary: scores[1].confidence > 0.4 ? scores[1] : null
          };
        }
        
        // Display results
        function displayResults(analysis) {
          document.getElementById('lowest-note').textContent = analysis.lowestNote;
          document.getElementById('lowest-freq').textContent = analysis.lowestFreq + ' Hz';
          document.getElementById('highest-note').textContent = analysis.highestNote;
          document.getElementById('highest-freq').textContent = analysis.highestFreq + ' Hz';
          
          const stemgroepNames = {
            'Sopraan': 'Sopraan (S)',
            'Alt': 'Alt (A)',
            'Tenor': 'Tenor (T)',
            'Bas': 'Bas (B)'
          };
          
          document.getElementById('primary-stemgroep').textContent = 
            stemgroepNames[analysis.primaryStemgroep] || analysis.primaryStemgroep;
          document.getElementById('confidence').textContent = 
            Math.round(analysis.primaryConfidence * 100) + '% match';
          
          if (analysis.secondaryStemgroep) {
            document.getElementById('secondary-recommendation').classList.remove('hidden');
            document.getElementById('secondary-stemgroep').textContent = 
              stemgroepNames[analysis.secondaryStemgroep];
            document.getElementById('secondary-confidence').textContent = 
              Math.round(analysis.secondaryConfidence * 100) + '% match';
          }
          
          // Simple range visualization
          const rangeViz = document.getElementById('range-viz');
          const notes = ['C2', 'E2', 'G2', 'C3', 'E3', 'G3', 'C4', 'E4', 'G4', 'C5', 'E5', 'G5', 'C6'];
          rangeViz.innerHTML = \`
            <div class="flex justify-between items-center w-full px-4">
              \${notes.map(note => \`
                <div class="text-xs text-gray-600">\${note}</div>
              \`).join('')}
            </div>
          \`;
        }
        
        // Save analysis to database
        async function saveAnalysis(analysis) {
          try {
            const email = document.getElementById('email')?.value || null;
            const stemgroepMap = { 'Sopraan': 'S', 'Alt': 'A', 'Tenor': 'T', 'Bas': 'B' };
            
            await fetch('/api/voice-analysis/save', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                email,
                lowest_note: analysis.lowestNote,
                lowest_frequency: parseFloat(analysis.lowestFreq),
                highest_note: analysis.highestNote,
                highest_frequency: parseFloat(analysis.highestFreq),
                primary_stemgroep: stemgroepMap[analysis.primaryStemgroep],
                primary_confidence: analysis.primaryConfidence,
                secondary_stemgroep: analysis.secondaryStemgroep ? stemgroepMap[analysis.secondaryStemgroep] : null,
                secondary_confidence: analysis.secondaryConfidence || null,
                audio_duration_seconds: analysis.duration
              })
            });
          } catch (error) {
            console.error('Save error:', error);
          }
        }
        `
      }} />
    </Layout>
  )
})

// =====================================================
// API: Save Voice Analysis Results
// =====================================================

app.post('/api/voice-analysis/save', async (c) => {
  try {
    const user = c.get('user') as SessionUser | null
    const body = await c.req.json()

    const {
      email,
      lowest_note,
      lowest_frequency,
      highest_note,
      highest_frequency,
      primary_stemgroep,
      primary_confidence,
      secondary_stemgroep,
      secondary_confidence,
      audio_duration_seconds
    } = body

    await execute(
      c.env.DB,
      `INSERT INTO voice_analyses (
        user_id, email, lowest_note, lowest_frequency, highest_note, highest_frequency,
        primary_stemgroep, primary_confidence, secondary_stemgroep, secondary_confidence,
        audio_duration_seconds, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)`,
      [
        user?.id || null,
        email,
        lowest_note,
        lowest_frequency,
        highest_note,
        highest_frequency,
        primary_stemgroep,
        primary_confidence,
        secondary_stemgroep,
        secondary_confidence,
        audio_duration_seconds,
        formatDateForDB()
      ]
    )

    return c.json({ success: true })
  } catch (error) {
    console.error('Save voice analysis error:', error)
    return c.json({ error: 'Failed to save analysis' }, 500)
  }
})

export default app
