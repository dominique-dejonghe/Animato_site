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
              Neem je stem op of upload een audio bestand en ontdek welke stemgroep het beste bij je past
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
                <span><strong>Klik op "Start Opname"</strong> en geef microfoon toegang</span>
              </li>
              <li class="flex items-start">
                <span class="font-bold mr-2">2.</span>
                <span>Zing van je <strong>laagste</strong> tot je <strong>hoogste</strong> comfortabele noot (15-30 seconden)</span>
              </li>
              <li class="flex items-start">
                <span class="font-bold mr-2">3.</span>
                <span><strong>Stop de opname</strong> en wacht terwijl we je stem analyseren</span>
              </li>
              <li class="flex items-start">
                <span class="font-bold mr-2">4.</span>
                <span>Bekijk je resultaten en stemgroep aanbeveling!</span>
              </li>
            </ol>
          </div>

          {/* Recording Section */}
          <div class="bg-white rounded-lg shadow-lg p-8">
            {/* Recording Controls */}
            <div class="space-y-6" id="recording-section">
              
              {/* Microphone Visualizer */}
              <div class="bg-gradient-to-r from-animato-primary/10 to-animato-secondary/10 rounded-lg p-8 text-center">
                <div id="mic-icon" class="mb-4">
                  <i class="fas fa-microphone text-6xl text-gray-400"></i>
                </div>
                <div id="recording-timer" class="text-2xl font-bold text-gray-700 mb-2">00:00</div>
                <div id="recording-status" class="text-sm text-gray-600">Klaar om op te nemen</div>
                
                {/* Waveform Canvas */}
                <canvas id="waveform" class="w-full h-24 mt-4 hidden"></canvas>
              </div>

              {/* Recording Buttons */}
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <button
                  type="button"
                  id="start-recording-btn"
                  class="px-6 py-4 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 transition text-lg"
                >
                  <i class="fas fa-circle mr-2"></i>
                  Start Opname
                </button>
                <button
                  type="button"
                  id="stop-recording-btn"
                  class="hidden px-6 py-4 bg-gray-600 text-white font-bold rounded-lg hover:bg-gray-700 transition text-lg"
                  disabled
                >
                  <i class="fas fa-stop mr-2"></i>
                  Stop Opname
                </button>
              </div>

              {/* Playback Controls (after recording) */}
              <div id="playback-controls" class="hidden space-y-4">
                <div class="bg-green-50 border-2 border-green-300 rounded-lg p-4">
                  <div class="flex items-center justify-between">
                    <div class="flex items-center space-x-3">
                      <i class="fas fa-check-circle text-green-600 text-2xl"></i>
                      <div>
                        <div class="font-bold text-green-900">Opname voltooid!</div>
                        <div id="recording-duration" class="text-sm text-green-700">Duur: 00:00</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      id="play-recording-btn"
                      class="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition"
                    >
                      <i class="fas fa-play mr-2"></i>
                      Beluister
                    </button>
                  </div>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <button
                    type="button"
                    id="analyze-recording-btn"
                    class="px-6 py-4 bg-animato-primary text-white font-bold rounded-lg hover:bg-animato-secondary transition text-lg"
                  >
                    <i class="fas fa-chart-line mr-2"></i>
                    Analyseer Opname
                  </button>
                  <button
                    type="button"
                    id="new-recording-btn"
                    class="px-6 py-4 border-2 border-gray-300 text-gray-700 font-bold rounded-lg hover:bg-gray-50 transition text-lg"
                  >
                    <i class="fas fa-redo mr-2"></i>
                    Nieuwe Opname
                  </button>
                </div>
              </div>

              {/* Optional File Upload */}
              <details class="mt-6">
                <summary class="cursor-pointer text-sm text-gray-600 hover:text-animato-primary">
                  <i class="fas fa-upload mr-1"></i>
                  Of upload een bestaand audio bestand
                </summary>
                <div class="mt-4 p-4 bg-gray-50 rounded-lg">
                  <input 
                    id="audio-file" 
                    type="file" 
                    accept="audio/mp3,audio/wav,audio/m4a,audio/mpeg,audio/x-m4a"
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  />
                  <button
                    type="button"
                    id="upload-analyze-btn"
                    class="mt-3 w-full px-6 py-3 bg-animato-accent text-white font-bold rounded-lg hover:bg-amber-600 transition"
                  >
                    <i class="fas fa-chart-line mr-2"></i>
                    Analyseer Upload
                  </button>
                </div>
              </details>

              {/* Gender Selection (IMPORTANT for accurate results) */}
              <div class="pt-4 border-t border-gray-200">
                <label class="block text-sm font-medium text-gray-700 mb-3">
                  <i class="fas fa-user text-animato-primary mr-2"></i>
                  Geslacht (belangrijk voor nauwkeurige analyse)
                </label>
                <div class="grid grid-cols-3 gap-3">
                  <label class="flex items-center justify-center px-4 py-3 border-2 border-gray-300 rounded-lg cursor-pointer hover:border-animato-primary transition has-[:checked]:border-animato-primary has-[:checked]:bg-animato-primary/5">
                    <input type="radio" name="gender" value="male" id="gender-male" class="mr-2" required />
                    <span class="font-medium">Man</span>
                  </label>
                  <label class="flex items-center justify-center px-4 py-3 border-2 border-gray-300 rounded-lg cursor-pointer hover:border-animato-primary transition has-[:checked]:border-animato-primary has-[:checked]:bg-animato-primary/5">
                    <input type="radio" name="gender" value="female" id="gender-female" class="mr-2" required />
                    <span class="font-medium">Vrouw</span>
                  </label>
                  <label class="flex items-center justify-center px-4 py-3 border-2 border-gray-300 rounded-lg cursor-pointer hover:border-animato-primary transition has-[:checked]:border-animato-primary has-[:checked]:bg-animato-primary/5">
                    <input type="radio" name="gender" value="other" id="gender-other" class="mr-2" />
                    <span class="font-medium text-sm">Neutraal</span>
                  </label>
                </div>
                <p class="mt-2 text-xs text-gray-600">
                  <i class="fas fa-info-circle mr-1"></i>
                  Mannen: Tenor/Bariton/Bas | Vrouwen: Sopraan/Mezzo/Alt
                </p>
              </div>

              {/* Optional: Email for results */}
              {!user && (
                <div class="pt-4">
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
            </div>

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
        // Voice Analysis with Live Recording
        // Using Web Audio API for recording and pitch detection
        
        const startRecordingBtn = document.getElementById('start-recording-btn');
        const stopRecordingBtn = document.getElementById('stop-recording-btn');
        const playRecordingBtn = document.getElementById('play-recording-btn');
        const analyzeRecordingBtn = document.getElementById('analyze-recording-btn');
        const newRecordingBtn = document.getElementById('new-recording-btn');
        const uploadAnalyzeBtn = document.getElementById('upload-analyze-btn');
        const fileInput = document.getElementById('audio-file');
        const playbackControls = document.getElementById('playback-controls');
        const recordingTimer = document.getElementById('recording-timer');
        const recordingStatus = document.getElementById('recording-status');
        const recordingDuration = document.getElementById('recording-duration');
        const micIcon = document.getElementById('mic-icon');
        const waveformCanvas = document.getElementById('waveform');
        const processing = document.getElementById('processing');
        const results = document.getElementById('results');
        
        let audioBuffer = null;
        let audioContext = null;
        let mediaRecorder = null;
        let audioChunks = [];
        let recordingStartTime = 0;
        let timerInterval = null;
        let recordedBlob = null;
        let stream = null;
        
        // Start Recording
        startRecordingBtn.addEventListener('click', async () => {
          try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];
            
            mediaRecorder.ondataavailable = (event) => {
              audioChunks.push(event.data);
            };
            
            mediaRecorder.onstop = async () => {
              recordedBlob = new Blob(audioChunks, { type: 'audio/webm' });
              const duration = (Date.now() - recordingStartTime) / 1000;
              recordingDuration.textContent = \`Duur: \${formatTime(duration)}\`;
              
              // Stop all tracks
              stream.getTracks().forEach(track => track.stop());
              
              // Show playback controls
              playbackControls.classList.remove('hidden');
              waveformCanvas.classList.add('hidden');
            };
            
            mediaRecorder.start();
            recordingStartTime = Date.now();
            
            // Update UI
            startRecordingBtn.classList.add('hidden');
            stopRecordingBtn.classList.remove('hidden');
            stopRecordingBtn.disabled = false;
            micIcon.innerHTML = '<i class="fas fa-microphone text-6xl text-red-600 animate-pulse"></i>';
            recordingStatus.textContent = 'Opname bezig...';
            waveformCanvas.classList.remove('hidden');
            
            // Start timer
            timerInterval = setInterval(() => {
              const elapsed = (Date.now() - recordingStartTime) / 1000;
              recordingTimer.textContent = formatTime(elapsed);
            }, 100);
            
            // Draw waveform
            drawWaveform();
            
          } catch (error) {
            console.error('Microphone error:', error);
            alert('Kan geen toegang krijgen tot de microfoon. Controleer je browser instellingen.');
          }
        });
        
        // Stop Recording
        stopRecordingBtn.addEventListener('click', () => {
          if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
            clearInterval(timerInterval);
            
            // Update UI
            stopRecordingBtn.classList.add('hidden');
            startRecordingBtn.classList.remove('hidden');
            micIcon.innerHTML = '<i class="fas fa-check-circle text-6xl text-green-600"></i>';
            recordingStatus.textContent = 'Opname voltooid!';
          }
        });
        
        // Play Recording
        playRecordingBtn.addEventListener('click', () => {
          if (recordedBlob) {
            const audioUrl = URL.createObjectURL(recordedBlob);
            const audio = new Audio(audioUrl);
            audio.play();
          }
        });
        
        // Analyze Recording
        analyzeRecordingBtn.addEventListener('click', async () => {
          if (!recordedBlob) return;
          
          // Check gender selection
          const gender = document.querySelector('input[name="gender"]:checked')?.value;
          if (!gender) {
            alert('Selecteer eerst je geslacht voor een nauwkeurige analyse');
            return;
          }
          
          playbackControls.classList.add('hidden');
          processing.classList.remove('hidden');
          
          try {
            const arrayBuffer = await recordedBlob.arrayBuffer();
            audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
            
            const analysis = await analyzePitchRange(audioBuffer, gender);
            await saveAnalysis(analysis);
            displayResults(analysis);
            
            processing.classList.add('hidden');
            results.classList.remove('hidden');
          } catch (error) {
            console.error('Analysis error:', error);
            processing.classList.add('hidden');
            playbackControls.classList.remove('hidden');
            alert('Er ging iets mis bij de analyse. Probeer opnieuw.');
          }
        });
        
        // New Recording
        newRecordingBtn.addEventListener('click', () => {
          location.reload();
        });
        
        // Upload and Analyze
        uploadAnalyzeBtn.addEventListener('click', async () => {
          const file = fileInput.files[0];
          if (!file) {
            alert('Selecteer eerst een audio bestand');
            return;
          }
          
          if (file.size > 5 * 1024 * 1024) {
            alert('Bestand is te groot (max 5MB)');
            return;
          }
          
          // Check gender selection
          const gender = document.querySelector('input[name="gender"]:checked')?.value;
          if (!gender) {
            alert('Selecteer eerst je geslacht voor een nauwkeurige analyse');
            return;
          }
          
          document.getElementById('recording-section').classList.add('hidden');
          processing.classList.remove('hidden');
          
          try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const arrayBuffer = await file.arrayBuffer();
            audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
            
            const analysis = await analyzePitchRange(audioBuffer, gender);
            await saveAnalysis(analysis);
            displayResults(analysis);
            
            processing.classList.add('hidden');
            results.classList.remove('hidden');
          } catch (error) {
            console.error('Analysis error:', error);
            processing.classList.add('hidden');
            document.getElementById('recording-section').classList.remove('hidden');
            alert('Er ging iets mis bij de analyse. Probeer opnieuw.');
          }
        });
        
        // Format time helper
        function formatTime(seconds) {
          const mins = Math.floor(seconds / 60);
          const secs = Math.floor(seconds % 60);
          return \`\${mins.toString().padStart(2, '0')}:\${secs.toString().padStart(2, '0')}\`;
        }
        
        // Simple waveform visualization
        function drawWaveform() {
          if (!stream || mediaRecorder.state !== 'recording') return;
          
          const ctx = waveformCanvas.getContext('2d');
          const analyser = audioContext.createAnalyser();
          const source = audioContext.createMediaStreamSource(stream);
          source.connect(analyser);
          
          analyser.fftSize = 2048;
          const bufferLength = analyser.frequencyBinCount;
          const dataArray = new Uint8Array(bufferLength);
          
          const draw = () => {
            if (mediaRecorder.state !== 'recording') return;
            
            requestAnimationFrame(draw);
            analyser.getByteTimeDomainData(dataArray);
            
            ctx.fillStyle = 'rgb(243, 244, 246)';
            ctx.fillRect(0, 0, waveformCanvas.width, waveformCanvas.height);
            
            ctx.lineWidth = 2;
            ctx.strokeStyle = 'rgb(0, 169, 206)';
            ctx.beginPath();
            
            const sliceWidth = waveformCanvas.width / bufferLength;
            let x = 0;
            
            for (let i = 0; i < bufferLength; i++) {
              const v = dataArray[i] / 128.0;
              const y = v * waveformCanvas.height / 2;
              
              if (i === 0) {
                ctx.moveTo(x, y);
              } else {
                ctx.lineTo(x, y);
              }
              
              x += sliceWidth;
            }
            
            ctx.lineTo(waveformCanvas.width, waveformCanvas.height / 2);
            ctx.stroke();
          };
          
          draw();
        }
        
        // Pitch detection function with gender-aware filtering
        function analyzePitchRange(audioBuffer, gender) {
          return new Promise((resolve) => {
            const channelData = audioBuffer.getChannelData(0);
            const sampleRate = audioBuffer.sampleRate;
            const windowSize = 4096;
            const hopSize = 2048;
            
            const frequencies = [];
            
            // Gender-specific frequency limits (Hz)
            const limits = {
              male: { min: 70, max: 650 },     // E2 to E5
              female: { min: 150, max: 1200 }, // D3 to D6
              other: { min: 70, max: 1200 }    // Full range
            };
            
            const freqLimits = limits[gender] || limits.other;
            
            // Process audio in windows
            for (let i = 0; i < channelData.length - windowSize; i += hopSize) {
              const window = channelData.slice(i, i + windowSize);
              const freq = detectPitch(window, sampleRate);
              
              // Apply gender-specific filtering
              if (freq > 0 && freq >= freqLimits.min && freq <= freqLimits.max) {
                frequencies.push(freq);
              }
            }
            
            // Filter and sort
            frequencies.sort((a, b) => a - b);
            
            if (frequencies.length === 0) {
              resolve({
                lowestFreq: 0,
                highestFreq: 0,
                lowestNote: 'N/A',
                highestNote: 'N/A',
                primaryStemgroep: 'Onbekend',
                primaryConfidence: 0,
                secondaryStemgroep: null,
                secondaryConfidence: null,
                duration: audioBuffer.duration
              });
              return;
            }
            
            // Use percentiles to filter outliers (more robust)
            const p15 = Math.floor(frequencies.length * 0.15);
            const p85 = Math.floor(frequencies.length * 0.85);
            
            const lowestFreq = frequencies[p15] || frequencies[0];
            const highestFreq = frequencies[p85] || frequencies[frequencies.length - 1];
            
            const lowestNote = frequencyToNote(lowestFreq);
            const highestNote = frequencyToNote(highestFreq);
            
            // Determine stemgroep with gender context
            const stemgroep = determineStemgroep(lowestFreq, highestFreq, gender);
            
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
        
        // Determine stemgroep with gender-specific ranges
        function determineStemgroep(lowFreq, highFreq, gender) {
          const avgFreq = (lowFreq + highFreq) / 2;
          
          // Gender-specific stemgroep ranges (Hz)
          const rangesByGender = {
            male: {
              'Tenor': { low: 130, high: 523, ideal: 320 },      // C3-C5
              'Bariton': { low: 110, high: 440, ideal: 260 },    // A2-A4
              'Bas': { low: 82, high: 349, ideal: 196 }          // E2-F4
            },
            female: {
              'Sopraan': { low: 260, high: 1047, ideal: 523 },   // C4-C6
              'Mezzosopraan': { low: 220, high: 880, ideal: 440 }, // A3-A5
              'Alt': { low: 175, high: 698, ideal: 349 }         // F3-F5
            },
            other: {
              'Sopraan': { low: 260, high: 1047, ideal: 523 },
              'Alt': { low: 175, high: 698, ideal: 349 },
              'Tenor': { low: 130, high: 523, ideal: 320 },
              'Bas': { low: 82, high: 349, ideal: 196 }
            }
          };
          
          const ranges = rangesByGender[gender] || rangesByGender.other;
          
          const scores = Object.entries(ranges).map(([name, range]) => {
            // Check if frequencies fall within range (with 20% tolerance)
            const lowInRange = lowFreq >= range.low * 0.8 && lowFreq <= range.high * 1.2;
            const highInRange = highFreq >= range.low * 0.8 && highFreq <= range.high * 1.2;
            const inRange = lowInRange || highInRange;
            
            // Calculate how well average frequency matches ideal
            const avgMatch = 1 - Math.min(1, Math.abs(avgFreq - range.ideal) / range.ideal);
            
            // Calculate overlap between detected range and expected range
            const overlapLow = Math.max(lowFreq, range.low);
            const overlapHigh = Math.min(highFreq, range.high);
            const overlap = Math.max(0, overlapHigh - overlapLow);
            const rangeMatch = overlap / (range.high - range.low);
            
            // Weighted confidence score
            const confidence = (inRange ? 0.4 : 0) + (avgMatch * 0.35) + (rangeMatch * 0.25);
            
            return { name, confidence: Math.max(0, Math.min(1, confidence)) };
          }).sort((a, b) => b.confidence - a.confidence);
          
          return {
            primary: scores[0],
            secondary: scores[1].confidence > 0.3 ? scores[1] : null
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
            'Mezzosopraan': 'Mezzosopraan (A)',
            'Alt': 'Alt (A)',
            'Tenor': 'Tenor (T)',
            'Bariton': 'Bariton (B)',
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
            const stemgroepMap = { 
              'Sopraan': 'S', 
              'Mezzosopraan': 'A', 
              'Alt': 'A', 
              'Tenor': 'T', 
              'Bariton': 'B', 
              'Bas': 'B' 
            };
            
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
