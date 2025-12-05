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
                <span><strong>Selecteer je geslacht</strong> (Man of Vrouw)</span>
              </li>
              <li class="flex items-start">
                <span class="font-bold mr-2">2.</span>
                <span><strong>Kies een liedje</strong> om de partituur te zien en noten te horen</span>
              </li>
              <li class="flex items-start">
                <span class="font-bold mr-2">3.</span>
                <span><strong>Klik op "Start Opname"</strong> en zing het liedje</span>
              </li>
              <li class="flex items-start">
                <span class="font-bold mr-2">4.</span>
                <span><strong>Analyseer je opname</strong> en ontdek je stemgroep</span>
              </li>
            </ol>
          </div>

          {/* STAP 1: Gender Selection */}
          <div class="bg-white rounded-lg shadow-lg p-8 mb-8">
            <h2 class="text-2xl font-bold text-gray-900 mb-6 text-center" style="font-family: 'Playfair Display', serif;">
              <span class="inline-block bg-animato-primary text-white rounded-full w-8 h-8 text-center leading-8 mr-2">1</span>
              Ik ben een...
            </h2>
            <div class="grid grid-cols-2 gap-6 max-w-lg mx-auto">
              <label class="flex flex-col items-center justify-center px-6 py-6 border-2 border-gray-300 rounded-xl cursor-pointer hover:border-blue-500 hover:bg-blue-50 transition-all transform hover:scale-105 has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50 has-[:checked]:shadow-lg">
                <input type="radio" name="gender" value="male" id="gender-male" class="sr-only" required />
                <i class="fas fa-male text-6xl text-blue-600 mb-3"></i>
                <span class="font-bold text-xl text-gray-900">Man</span>
                <span class="text-sm text-gray-600 mt-2">Tenor / Bas</span>
              </label>
              <label class="flex flex-col items-center justify-center px-6 py-6 border-2 border-gray-300 rounded-xl cursor-pointer hover:border-pink-500 hover:bg-pink-50 transition-all transform hover:scale-105 has-[:checked]:border-pink-500 has-[:checked]:bg-pink-50 has-[:checked]:shadow-lg">
                <input type="radio" name="gender" value="female" id="gender-female" class="sr-only" required />
                <i class="fas fa-female text-6xl text-pink-600 mb-3"></i>
                <span class="font-bold text-xl text-gray-900">Vrouw</span>
                <span class="text-sm text-gray-600 mt-2">Sopraan / Alt</span>
              </label>
            </div>
            <p class="mt-4 text-xs text-center text-gray-600">
              <i class="fas fa-info-circle mr-1"></i>
              Essentieel voor correcte stemgroep analyse
            </p>
          </div>

          {/* STAP 2: Song Selection */}
          <div class="bg-white rounded-lg shadow-lg p-8 mb-8">
            <h2 class="text-2xl font-bold text-gray-900 mb-6 text-center" style="font-family: 'Playfair Display', serif;">
              <span class="inline-block bg-animato-primary text-white rounded-full w-8 h-8 text-center leading-8 mr-2">2</span>
              Kies een liedje
            </h2>
            
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Women's Songs */}
              <div class="bg-white rounded-lg p-4">
                <div class="flex items-center mb-3">
                  <i class="fas fa-venus text-pink-600 text-xl mr-2"></i>
                  <h4 class="font-bold text-gray-900">Voor Vrouwen:</h4>
                </div>
                <ul class="space-y-2 text-sm">
                  <li class="flex items-start hover:bg-purple-50 p-2 rounded cursor-pointer transition" 
                      data-song="Somewhere Over the Rainbow" data-range-low="C4" data-range-high="C6" data-freq-low="261.6" data-freq-high="1046.5">
                    <i class="fas fa-check-circle text-green-600 mr-2 mt-0.5"></i>
                    <div>
                      <strong>"Somewhere Over the Rainbow"</strong>
                      <div class="text-xs text-gray-600">Perfect bereik (C4-C6)</div>
                    </div>
                  </li>
                  <li class="flex items-start hover:bg-purple-50 p-2 rounded cursor-pointer transition"
                      data-song="Hallelujah (vrouwen)" data-range-low="A3" data-range-high="E5" data-freq-low="220.0" data-freq-high="659.3">
                    <i class="fas fa-check-circle text-green-600 mr-2 mt-0.5"></i>
                    <div>
                      <strong>"Hallelujah" (Leonard Cohen)</strong>
                      <div class="text-xs text-gray-600">Emotioneel bereik (A3-E5)</div>
                    </div>
                  </li>
                  <li class="flex items-start hover:bg-purple-50 p-2 rounded cursor-pointer transition"
                      data-song="Happy Birthday (vrouwen)" data-range-low="C4" data-range-high="C5" data-freq-low="261.6" data-freq-high="523.3">
                    <i class="fas fa-check-circle text-green-600 mr-2 mt-0.5"></i>
                    <div>
                      <strong>"Happy Birthday"</strong>
                      <div class="text-xs text-gray-600">Simpel en effectief (C4-C5)</div>
                    </div>
                  </li>
                  <li class="flex items-start hover:bg-purple-50 p-2 rounded cursor-pointer transition"
                      data-song="Amazing Grace" data-range-low="D4" data-range-high="D5" data-freq-low="293.7" data-freq-high="587.3">
                    <i class="fas fa-check-circle text-green-600 mr-2 mt-0.5"></i>
                    <div>
                      <strong>"Amazing Grace"</strong>
                      <div class="text-xs text-gray-600">Langzaam en duidelijk (D4-D5)</div>
                    </div>
                  </li>
                </ul>
              </div>

              {/* Men's Songs */}
              <div class="bg-white rounded-lg p-4">
                <div class="flex items-center mb-3">
                  <i class="fas fa-mars text-blue-600 text-xl mr-2"></i>
                  <h4 class="font-bold text-gray-900">Voor Mannen:</h4>
                </div>
                <ul class="space-y-2 text-sm">
                  <li class="flex items-start hover:bg-purple-50 p-2 rounded cursor-pointer transition"
                      data-song="Hallelujah (mannen)" data-range-low="G2" data-range-high="D4" data-freq-low="98.0" data-freq-high="293.7">
                    <i class="fas fa-check-circle text-green-600 mr-2 mt-0.5"></i>
                    <div>
                      <strong>"Hallelujah"</strong>
                      <div class="text-xs text-gray-600">Populair en breed (G2-D4)</div>
                    </div>
                  </li>
                  <li class="flex items-start hover:bg-purple-50 p-2 rounded cursor-pointer transition"
                      data-song="My Way" data-range-low="F2" data-range-high="F4" data-freq-low="87.3" data-freq-high="349.2">
                    <i class="fas fa-check-circle text-green-600 mr-2 mt-0.5"></i>
                    <div>
                      <strong>"My Way" (Frank Sinatra)</strong>
                      <div class="text-xs text-gray-600">Klassiek bereik (F2-F4)</div>
                    </div>
                  </li>
                  <li class="flex items-start hover:bg-purple-50 p-2 rounded cursor-pointer transition"
                      data-song="Ol' Man River" data-range-low="E2" data-range-high="E4" data-freq-low="82.4" data-freq-high="329.6">
                    <i class="fas fa-check-circle text-green-600 mr-2 mt-0.5"></i>
                    <div>
                      <strong>"Ol' Man River"</strong>
                      <div class="text-xs text-gray-600">Ideaal voor bas (E2-E4)</div>
                    </div>
                  </li>
                  <li class="flex items-start hover:bg-purple-50 p-2 rounded cursor-pointer transition"
                      data-song="Happy Birthday (mannen)" data-range-low="C3" data-range-high="C4" data-freq-low="130.8" data-freq-high="261.6">
                    <i class="fas fa-check-circle text-green-600 mr-2 mt-0.5"></i>
                    <div>
                      <strong>"Happy Birthday"</strong>
                      <div class="text-xs text-gray-600">Universeel bekend (C3-C4)</div>
                    </div>
                  </li>
                </ul>
              </div>
            </div>

            <p class="mt-4 text-sm text-center text-gray-600">
              <i class="fas fa-music text-purple-600 mr-1"></i>
              Klik op een liedje om de partituur te zien
            </p>
          </div>

          {/* Piano Visualization (shown after song selection) */}
          <div id="piano-container" class="hidden bg-gradient-to-r from-purple-50 to-pink-50 rounded-lg shadow-lg p-8 mb-8 border-2 border-purple-300">
            <h3 class="text-xl font-bold text-purple-900 mb-4 text-center flex items-center justify-center">
              <i class="fas fa-file-audio text-purple-600 mr-2"></i>
              <span id="selected-song-title">Geselecteerd Liedje</span>
            </h3>
            
            {/* Piano Keys */}
            <div class="bg-white rounded-lg p-6">
              {/* Playback Controls */}
              <div class="flex justify-center gap-4 mb-4">
                <button
                  id="play-melody-btn"
                  class="px-6 py-3 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700 transition flex items-center"
                >
                  <i class="fas fa-play mr-2"></i>
                  Speel Melodie
                </button>
                <button
                  id="stop-melody-btn"
                  class="hidden px-6 py-3 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 transition flex items-center"
                >
                  <i class="fas fa-stop mr-2"></i>
                  Stop Melodie
                </button>
              </div>
              
              <div class="text-sm text-gray-700 mb-3 text-center">
                <i class="fas fa-hand-pointer text-purple-600 mr-2"></i>
                Klik op de paarse toetsen om de noten te horen
              </div>
              <div id="piano-roll" class="flex justify-center items-end space-x-0.5 mb-4" style="min-height: 120px;">
                {/* Generated dynamically by JS */}
              </div>
              <div id="song-range-info" class="text-center text-lg font-bold text-purple-900">
                {/* Range info */}
              </div>
            </div>
            
            <div class="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <p class="text-sm text-amber-900 text-center">
                <i class="fas fa-lightbulb text-amber-600 mr-2"></i>
                <strong>Tip:</strong> Oefen eerst de noten, zing dan het volledige liedje tijdens de opname!
              </p>
            </div>
          </div>

          {/* STAP 3: Recording Section */}
          <div class="bg-white rounded-lg shadow-lg p-8">
            <h2 class="text-2xl font-bold text-gray-900 mb-6 text-center" style="font-family: 'Playfair Display', serif;">
              <span class="inline-block bg-animato-primary text-white rounded-full w-8 h-8 text-center leading-8 mr-2">3</span>
              Neem je stem op
            </h2>
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
        let melodyTimeouts = [];
        let currentMelody = null;
        let isPlayingMelody = false;
        
        // =====================================================
        // SONG MELODIES (simplified versions for demo)
        // =====================================================
        
        const songMelodies = {
          'Somewhere Over the Rainbow': [
            {note: 'C4', duration: 0.5}, {note: 'C5', duration: 1}, {note: 'B4', duration: 0.5}, 
            {note: 'A4', duration: 0.5}, {note: 'G4', duration: 1}, {note: 'A4', duration: 0.5},
            {note: 'C5', duration: 1.5}
          ],
          'Hallelujah (vrouwen)': [
            {note: 'C4', duration: 0.5}, {note: 'E4', duration: 0.5}, {note: 'G4', duration: 0.5},
            {note: 'A4', duration: 1}, {note: 'G4', duration: 0.5}, {note: 'E4', duration: 1}
          ],
          'Happy Birthday (vrouwen)': [
            {note: 'C4', duration: 0.4}, {note: 'C4', duration: 0.4}, {note: 'D4', duration: 0.8},
            {note: 'C4', duration: 0.8}, {note: 'F4', duration: 0.8}, {note: 'E4', duration: 1.6}
          ],
          'Amazing Grace': [
            {note: 'D4', duration: 0.8}, {note: 'G4', duration: 0.8}, {note: 'G4', duration: 0.8},
            {note: 'E4', duration: 0.4}, {note: 'G4', duration: 0.8}, {note: 'D4', duration: 1.2}
          ],
          'Hallelujah (mannen)': [
            {note: 'C3', duration: 0.5}, {note: 'E3', duration: 0.5}, {note: 'G3', duration: 0.5},
            {note: 'A3', duration: 1}, {note: 'G3', duration: 0.5}, {note: 'E3', duration: 1}
          ],
          'My Way': [
            {note: 'F2', duration: 0.6}, {note: 'A2', duration: 0.6}, {note: 'C3', duration: 0.8},
            {note: 'D3', duration: 0.8}, {note: 'C3', duration: 0.8}, {note: 'A2', duration: 1}
          ],
          "Ol' Man River": [
            {note: 'E2', duration: 0.8}, {note: 'G2', duration: 0.8}, {note: 'A2', duration: 0.6},
            {note: 'C3', duration: 1}, {note: 'B2', duration: 0.8}, {note: 'G2', duration: 1.2}
          ],
          'Happy Birthday (mannen)': [
            {note: 'C3', duration: 0.4}, {note: 'C3', duration: 0.4}, {note: 'D3', duration: 0.8},
            {note: 'C3', duration: 0.8}, {note: 'F3', duration: 0.8}, {note: 'E3', duration: 1.6}
          ]
        };
        
        // =====================================================
        // SONG SELECTION HANDLERS (with sheet music viz)
        // =====================================================
        
        document.querySelectorAll('[data-song]').forEach(songItem => {
          songItem.addEventListener('click', function() {
            const songTitle = this.dataset.song;
            const rangeLow = this.dataset.rangeLow;
            const rangeHigh = this.dataset.rangeHigh;
            const freqLow = parseFloat(this.dataset.freqLow);
            const freqHigh = parseFloat(this.dataset.freqHigh);
            
            // Stop any playing melody
            stopMelody();
            
            // Store current melody
            currentMelody = songMelodies[songTitle] || null;
            
            // Show piano container
            const container = document.getElementById('piano-container');
            container.classList.remove('hidden');
            
            // Update title
            document.getElementById('selected-song-title').textContent = songTitle;
            
            // Update range info
            document.getElementById('song-range-info').textContent = 
              \`\${rangeLow} tot \${rangeHigh} (\${freqLow.toFixed(0)} - \${freqHigh.toFixed(0)} Hz)\`;
            
            // Generate piano roll visualization with playable keys
            generatePianoRoll(rangeLow, rangeHigh);
            
            // Highlight selected song
            document.querySelectorAll('[data-song]').forEach(item => {
              item.classList.remove('bg-purple-100', 'border-2', 'border-purple-400');
            });
            this.classList.add('bg-purple-100', 'border-2', 'border-purple-400');
            
            // Scroll to piano
            setTimeout(() => {
              container.scrollIntoView({ 
                behavior: 'smooth', 
                block: 'center' 
              });
            }, 200);
          });
        });
        
        // Note frequencies for piano
        const noteFrequencies = {
          'C2': 65.41, 'C#2': 69.30, 'D2': 73.42, 'D#2': 77.78, 'E2': 82.41, 'F2': 87.31, 'F#2': 92.50, 'G2': 98.00, 'G#2': 103.83, 'A2': 110.00, 'A#2': 116.54, 'B2': 123.47,
          'C3': 130.81, 'C#3': 138.59, 'D3': 146.83, 'D#3': 155.56, 'E3': 164.81, 'F3': 174.61, 'F#3': 185.00, 'G3': 196.00, 'G#3': 207.65, 'A3': 220.00, 'A#3': 233.08, 'B3': 246.94,
          'C4': 261.63, 'C#4': 277.18, 'D4': 293.66, 'D#4': 311.13, 'E4': 329.63, 'F4': 349.23, 'F#4': 369.99, 'G4': 392.00, 'G#4': 415.30, 'A4': 440.00, 'A#4': 466.16, 'B4': 493.88,
          'C5': 523.25, 'C#5': 554.37, 'D5': 587.33, 'D#5': 622.25, 'E5': 659.25, 'F5': 698.46, 'F#5': 739.99, 'G5': 783.99, 'G#5': 830.61, 'A5': 880.00, 'A#5': 932.33, 'B5': 987.77,
          'C6': 1046.50
        };
        
        // Global audio context for melody playback
        let melodyAudioContext = null;
        
        // Play note sound
        function playNote(note, duration = 0.5) {
          const frequency = noteFrequencies[note];
          if (!frequency) return;
          
          if (!melodyAudioContext) {
            melodyAudioContext = new (window.AudioContext || window.webkitAudioContext)();
          }
          
          const oscillator = melodyAudioContext.createOscillator();
          const gainNode = melodyAudioContext.createGain();
          
          oscillator.connect(gainNode);
          gainNode.connect(melodyAudioContext.destination);
          
          oscillator.frequency.value = frequency;
          oscillator.type = 'sine';
          
          gainNode.gain.setValueAtTime(0.3, melodyAudioContext.currentTime);
          gainNode.gain.exponentialRampToValueAtTime(0.01, melodyAudioContext.currentTime + duration);
          
          oscillator.start(melodyAudioContext.currentTime);
          oscillator.stop(melodyAudioContext.currentTime + duration);
          
          // Visual feedback on piano key
          highlightKey(note, duration * 1000);
        }
        
        // Highlight piano key during playback
        function highlightKey(note, duration) {
          const key = document.querySelector(\`[data-note="\${note}"]\`);
          if (key) {
            key.classList.add('ring-4', 'ring-yellow-400');
            setTimeout(() => {
              key.classList.remove('ring-4', 'ring-yellow-400');
            }, duration);
          }
        }
        
        // Play melody sequence
        function playMelody() {
          console.log('playMelody called, currentMelody:', currentMelody);
          if (!currentMelody) {
            console.error('No melody selected!');
            return;
          }
          if (isPlayingMelody) {
            console.log('Already playing, ignoring');
            return;
          }
          
          isPlayingMelody = true;
          document.getElementById('play-melody-btn').classList.add('hidden');
          document.getElementById('stop-melody-btn').classList.remove('hidden');
          
          console.log('Starting melody playback with', currentMelody.length, 'notes');
          
          let currentTime = 0;
          currentMelody.forEach((noteObj) => {
            const timeout = setTimeout(() => {
              playNote(noteObj.note, noteObj.duration);
            }, currentTime * 1000);
            
            melodyTimeouts.push(timeout);
            currentTime += noteObj.duration;
          });
          
          // Auto-reset after melody finishes
          const finishTimeout = setTimeout(() => {
            stopMelody();
          }, currentTime * 1000);
          melodyTimeouts.push(finishTimeout);
        }
        
        // Stop melody
        function stopMelody() {
          melodyTimeouts.forEach(timeout => clearTimeout(timeout));
          melodyTimeouts = [];
          isPlayingMelody = false;
          
          document.getElementById('play-melody-btn').classList.remove('hidden');
          document.getElementById('stop-melody-btn').classList.add('hidden');
        }
        
        // Melody control buttons - use event delegation since buttons may not exist yet
        document.addEventListener('click', function(e) {
          if (e.target && e.target.id === 'play-melody-btn') {
            playMelody();
          } else if (e.target && e.target.id === 'stop-melody-btn') {
            stopMelody();
          } else if (e.target && e.target.closest('#play-melody-btn')) {
            playMelody();
          } else if (e.target && e.target.closest('#stop-melody-btn')) {
            stopMelody();
          }
        });
        
        // Generate piano roll visualization with playable keys
        function generatePianoRoll(noteLow, noteHigh) {
          const pianoRoll = document.getElementById('piano-roll');
          
          // All piano keys from C2 to C6
          const allNotes = ['C2','C#2','D2','D#2','E2','F2','F#2','G2','G#2','A2','A#2','B2',
                           'C3','C#3','D3','D#3','E3','F3','F#3','G3','G#3','A3','A#3','B3',
                           'C4','C#4','D4','D#4','E4','F4','F#4','G4','G#4','A4','A#4','B4',
                           'C5','C#5','D5','D#5','E5','F5','F#5','G5','G#5','A5','A#5','B5',
                           'C6'];
          
          const lowIndex = allNotes.indexOf(noteLow);
          const highIndex = allNotes.indexOf(noteHigh);
          
          // Generate keys with click handlers
          pianoRoll.innerHTML = allNotes.map((note, index) => {
            const isBlack = note.includes('#');
            const isInRange = index >= lowIndex && index <= highIndex;
            
            let bgColor, hoverColor, textColor;
            if (isInRange) {
              bgColor = isBlack ? 'bg-purple-700' : 'bg-purple-400';
              hoverColor = isBlack ? 'hover:bg-purple-900' : 'hover:bg-purple-600';
              textColor = 'text-white';
            } else {
              bgColor = isBlack ? 'bg-gray-700' : 'bg-white border border-gray-400';
              hoverColor = isBlack ? 'hover:bg-gray-800' : 'hover:bg-gray-100';
              textColor = isBlack ? 'text-white' : 'text-gray-700';
            }
            
            const height = isBlack ? 'h-20' : 'h-28';
            const width = isBlack ? 'w-8' : 'w-10';
            const cursor = isInRange ? 'cursor-pointer' : 'cursor-not-allowed opacity-40';
            
            return \`
              <div class="\${width} \${height} \${bgColor} \${hoverColor} \${cursor} rounded-b shadow-md relative group transition-all active:scale-95" 
                   data-note="\${note}"
                   data-in-range="\${isInRange}"
                   onclick="if(this.dataset.inRange === 'true') playNote('\${note}')"
                   title="\${note} - \${noteFrequencies[note].toFixed(2)} Hz">
                <span class="absolute bottom-1 left-0 right-0 text-xs text-center \${textColor} font-medium">
                  \${note}
                </span>
              </div>
            \`;
          }).join('');
        }
        
        // =====================================================
        // GENDER VALIDATION
        // =====================================================
        
        function checkGenderSelection() {
          const gender = document.querySelector('input[name="gender"]:checked');
          if (!gender) {
            alert('⚠️ Selecteer eerst je geslacht voor een nauwkeurige analyse\\n\\nDit is essentieel voor correcte stemgroep-bepaling (Mannen: Tenor/Bas | Vrouwen: Sopraan/Alt)');
            
            // Scroll to gender selection
            document.querySelector('input[name="gender"]').closest('.pt-4').scrollIntoView({ 
              behavior: 'smooth', 
              block: 'center' 
            });
            
            return false;
          }
          return true;
        }
        
        // =====================================================
        // START RECORDING (with gender check)
        // =====================================================
        
        startRecordingBtn.addEventListener('click', async () => {
          // CRITICAL: Check gender selection first
          if (!checkGenderSelection()) {
            return;
          }
          
          // Stop any playing melody before recording
          stopMelody();
          
          try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            // Create audio processing chain to filter out piano tones
            const source = audioContext.createMediaStreamSource(stream);
            const highPassFilter = audioContext.createBiquadFilter();
            const destination = audioContext.createMediaStreamDestination();
            
            // High-pass filter to remove low-frequency piano tones
            // Human voice typically starts around 85Hz (male) to 165Hz (female)
            // This filter attenuates frequencies below 150Hz to remove bass piano notes
            highPassFilter.type = 'highpass';
            highPassFilter.frequency.value = 150; // Hz
            highPassFilter.Q.value = 1.0;
            
            // Connect: microphone -> filter -> destination
            source.connect(highPassFilter);
            highPassFilter.connect(destination);
            
            // Use filtered stream for recording
            const filteredStream = destination.stream;
            mediaRecorder = new MediaRecorder(filteredStream);
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
        
        // Upload and Analyze (with gender check)
        uploadAnalyzeBtn.addEventListener('click', async () => {
          // CRITICAL: Check gender selection first
          if (!checkGenderSelection()) {
            return;
          }
          
          const file = fileInput.files[0];
          if (!file) {
            alert('Selecteer eerst een audio bestand');
            return;
          }
          
          if (file.size > 5 * 1024 * 1024) {
            alert('Bestand is te groot (max 5MB)');
            return;
          }
          
          const gender = document.querySelector('input[name="gender"]:checked')?.value;
          
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
          // Simplified to classic 4 voice types: Sopraan, Alt, Tenor, Bas
          const rangesByGender = {
            male: {
              'Tenor': { low: 130, high: 523, ideal: 330 },      // C3-C5
              'Bas': { low: 82, high: 392, ideal: 196 }          // E2-G4
            },
            female: {
              'Sopraan': { low: 260, high: 1047, ideal: 523 },   // C4-C6
              'Alt': { low: 175, high: 698, ideal: 349 }         // F3-F5
            },
            other: {
              'Sopraan': { low: 260, high: 1047, ideal: 523 },
              'Alt': { low: 175, high: 698, ideal: 349 },
              'Tenor': { low: 130, high: 523, ideal: 330 },
              'Bas': { low: 82, high: 392, ideal: 196 }
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
            const stemgroepMap = { 
              'Sopraan': 'S', 
              'Alt': 'A', 
              'Tenor': 'T', 
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
