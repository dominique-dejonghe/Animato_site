/**
 * Leden Import - Copy-Paste aanpak
 * Geen externe libraries nodig. Puur vanilla JS.
 * 
 * Werkt met:
 * - Tab-gescheiden data (copy-paste vanuit Excel / Google Sheets)
 * - Komma-gescheiden (CSV)
 * - Puntkomma-gescheiden
 */
(function() {
  'use strict';

  // ========== DOM referenties ==========
  var pasteArea = document.getElementById('pasteArea');
  var previewTable = document.getElementById('previewTable');
  var importBtn = document.getElementById('importBtn');
  var previewSection = document.getElementById('preview-section');
  var previewCount = document.getElementById('preview-count');
  var statusMessage = document.getElementById('statusMessage');
  var clearBtn = document.getElementById('clearBtn');
  var loadExampleBtn = document.getElementById('loadExampleBtn');
  var resultSection = document.getElementById('resultSection');
  var resultContent = document.getElementById('resultContent');
  var parsedData = [];

  if (!pasteArea) {
    console.error('leden-import.js: pasteArea niet gevonden');
    return;
  }

  // ========== Event listeners ==========
  var debounceTimer = null;
  pasteArea.addEventListener('input', function() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function() { parseInput(); }, 400);
  });

  pasteArea.addEventListener('paste', function() {
    setTimeout(function() { parseInput(); }, 100);
  });

  clearBtn.addEventListener('click', function() {
    pasteArea.value = '';
    parsedData = [];
    previewTable.innerHTML = '';
    previewSection.classList.add('hidden');
    statusMessage.classList.add('hidden');
    resultSection.classList.add('hidden');
  });

  loadExampleBtn.addEventListener('click', function() {
    pasteArea.value = 'Voornaam\tAchternaam\tEmail\tStemgroep\tTelefoon\tAdres\n'
      + 'Jan\tJanssen\tjan.janssen@voorbeeld.be\tTenor\t0471234567\tKerkstraat 1 Brussel\n'
      + 'Marie\tPieters\tmarie.pieters@voorbeeld.be\tSopraan\t0487654321\tStationslaan 5 Gent\n'
      + 'Luc\tVermeersch\tluc.vermeersch@voorbeeld.be\tBas\t\t\n'
      + 'Els\tDe Smedt\tels.desmedt@voorbeeld.be\tAlt\t0499111222\t';
    parseInput();
  });

  // ========== Parse logica ==========
  function detectSeparator(text) {
    var firstLine = text.split('\n')[0] || '';
    var tabs = (firstLine.match(/\t/g) || []).length;
    var commas = (firstLine.match(/,/g) || []).length;
    var semis = (firstLine.match(/;/g) || []).length;
    if (tabs >= 2) return '\t';
    if (semis >= commas && semis >= 2) return ';';
    if (commas >= 2) return ',';
    return '\t'; // default
  }

  function normalizeKey(key) {
    return key.toLowerCase().trim()
      .replace(/[\u00e9\u00e8\u00ea\u00eb]/g, 'e')
      .replace(/[\u00e0\u00e2\u00e4]/g, 'a')
      .replace(/[\u00f9\u00fb\u00fc]/g, 'u')
      .replace(/[\u00ee\u00ef]/g, 'i')
      .replace(/[\u00f4\u00f6]/g, 'o')
      .replace(/[^a-z0-9 ]/g, '')
      .trim();
  }

  function mapColumn(normalizedName) {
    var mappings = {
      'voornaam': 'voornaam', 'first name': 'voornaam', 'firstname': 'voornaam', 'voorname': 'voornaam', 'naam': 'voornaam',
      'achternaam': 'achternaam', 'familienaam': 'achternaam', 'last name': 'achternaam', 'lastname': 'achternaam', 'family name': 'achternaam',
      'email': 'email', 'emailadres': 'email', 'mail': 'email', 'e mail': 'email', 'eml': 'email', 'emailaddress': 'email',
      'stemgroep': 'stemgroep', 'stem': 'stemgroep', 'voice': 'stemgroep', 'part': 'stemgroep', 'stemtype': 'stemgroep', 'sectie': 'stemgroep',
      'telefoon': 'telefoon', 'gsm': 'telefoon', 'tel': 'telefoon', 'phone': 'telefoon', 'telefoonnummer': 'telefoon', 'gsmnummer': 'telefoon', 'mobile': 'telefoon',
      'adres': 'adres', 'address': 'adres', 'straat': 'adres', 'woonplaats': 'adres'
    };
    return mappings[normalizedName] || null;
  }

  function normalizeStemgroep(val) {
    if (!val) return '';
    var s = val.toUpperCase().trim();
    if (s === 'S' || s.indexOf('SOPR') === 0) return 'S';
    if (s === 'A' || s.indexOf('ALT') === 0 || s.indexOf('MEZZO') === 0) return 'A';
    if (s === 'T' || s.indexOf('TEN') === 0) return 'T';
    if (s === 'B' || s.indexOf('BAS') === 0 || s.indexOf('BARI') === 0) return 'B';
    return '';
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str || ''));
    return div.innerHTML;
  }

  function parseInput() {
    var raw = pasteArea.value.trim();
    if (!raw) {
      previewSection.classList.add('hidden');
      statusMessage.classList.add('hidden');
      parsedData = [];
      return;
    }

    var sep = detectSeparator(raw);
    var lines = raw.split('\n').filter(function(l) { return l.trim() !== ''; });
    if (lines.length < 2) {
      showStatus('bg-yellow-50 text-yellow-800 border border-yellow-200',
        'Minimaal 2 regels nodig: 1 koprij + 1 of meer datarijen.');
      previewSection.classList.add('hidden');
      return;
    }

    // Parse koprij
    var headerCells = lines[0].split(sep).map(function(h) { return h.trim().replace(/^["']|["']$/g, ''); });
    var columnMap = [];
    var foundFields = {};
    for (var i = 0; i < headerCells.length; i++) {
      var mapped = mapColumn(normalizeKey(headerCells[i]));
      columnMap.push(mapped);
      if (mapped) foundFields[mapped] = true;
    }

    if (!foundFields['voornaam'] || !foundFields['email']) {
      var sepName = (sep === '\t') ? 'tab' : (sep === ',') ? 'komma' : 'puntkomma';
      showStatus('bg-yellow-50 text-yellow-800 border border-yellow-200',
        'Kolomnamen niet herkend. Gevonden: ' + headerCells.join(', ') +
        '. Verwacht: Voornaam, Achternaam, Email. Gedetecteerd scheidingsteken: ' + sepName + '.');
      previewSection.classList.add('hidden');
      return;
    }

    // Parse datarijen
    parsedData = [];
    previewTable.innerHTML = '';
    var valid = 0;
    var invalid = 0;

    for (var r = 1; r < lines.length; r++) {
      var cells = lines[r].split(sep).map(function(c) { return c.trim().replace(/^["']|["']$/g, ''); });
      var item = { voornaam: '', achternaam: '', email: '', stemgroep: '', telefoon: '', adres: '', errors: [], isValid: false };

      for (var c = 0; c < columnMap.length; c++) {
        var field = columnMap[c];
        var val = (cells[c] || '').trim();
        if (field && val) {
          item[field] = val;
        }
      }

      // Validatie
      if (!item.voornaam) item.errors.push('Geen voornaam');
      if (!item.achternaam) item.errors.push('Geen achternaam');
      if (!item.email || item.email.indexOf('@') === -1) item.errors.push('Ongeldig email');

      // Stemgroep normaliseren
      item.stemgroep = normalizeStemgroep(item.stemgroep);
      item.isValid = item.errors.length === 0;
      if (item.isValid) valid++; else invalid++;
      parsedData.push(item);

      // Render rij
      var tr = document.createElement('tr');
      tr.className = item.isValid ? 'hover:bg-green-50' : 'bg-red-50';
      var statusHtml = item.isValid
        ? '<span class="text-green-600 text-xs font-semibold"><i class="fas fa-check-circle"></i> OK</span>'
        : '<span class="text-red-600 text-xs font-semibold" title="' + escapeHtml(item.errors.join(', ')) + '"><i class="fas fa-times-circle"></i> ' + escapeHtml(item.errors[0]) + '</span>';
      tr.innerHTML = '<td class="px-4 py-2 text-gray-400 text-xs">' + r + '</td>'
        + '<td class="px-4 py-2">' + statusHtml + '</td>'
        + '<td class="px-4 py-2">' + escapeHtml(item.voornaam || '-') + '</td>'
        + '<td class="px-4 py-2">' + escapeHtml(item.achternaam || '-') + '</td>'
        + '<td class="px-4 py-2">' + escapeHtml(item.email || '-') + '</td>'
        + '<td class="px-4 py-2">' + escapeHtml(item.stemgroep || '\u2014') + '</td>'
        + '<td class="px-4 py-2">' + escapeHtml(item.telefoon || '\u2014') + '</td>'
        + '<td class="px-4 py-2 text-xs text-gray-500">' + escapeHtml(item.adres || '\u2014') + '</td>';
      previewTable.appendChild(tr);
    }

    previewSection.classList.remove('hidden');
    previewCount.textContent = '(' + (lines.length - 1) + ' rijen: ' + valid + ' geldig, ' + invalid + ' ongeldig)';

    if (valid > 0) {
      importBtn.disabled = false;
      importBtn.innerHTML = '<i class="fas fa-check mr-2"></i> Importeer ' + valid + ' leden';
      showStatus('bg-green-50 text-green-700 border border-green-200',
        (lines.length - 1) + ' rijen herkend. ' + valid + ' geldig en klaar om te importeren.' +
        (invalid > 0 ? ' ' + invalid + ' rij(en) ongeldig (worden overgeslagen).' : ''));
    } else {
      importBtn.disabled = true;
      showStatus('bg-red-50 text-red-700 border border-red-200',
        'Geen geldige rijen gevonden. Controleer of Voornaam, Achternaam en Email ingevuld zijn.');
    }
  }

  // ========== Import actie ==========
  importBtn.addEventListener('click', function() {
    var validData = parsedData.filter(function(d) { return d.isValid; });
    if (validData.length === 0) return;

    importBtn.disabled = true;
    importBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Bezig met importeren...';
    showStatus('bg-blue-50 text-blue-700 border border-blue-200', 'Importeren... even geduld.');

    var payload = validData.map(function(d) {
      return {
        voornaam: d.voornaam,
        achternaam: d.achternaam,
        email: d.email,
        stemgroep: d.stemgroep || '',
        telefoon: d.telefoon || '',
        adres: d.adres || ''
      };
    });

    fetch('/api/admin/leden/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ leden: payload })
    })
    .then(function(response) {
      var ct = response.headers.get('content-type') || '';
      if (!ct.includes('application/json')) {
        return response.text().then(function(txt) {
          console.error('Non-JSON response:', response.status, txt.substring(0, 500));
          throw new Error('Server gaf geen JSON terug (HTTP ' + response.status + '). Ben je nog ingelogd? Herlaad de pagina en probeer opnieuw.');
        });
      }
      return response.json();
    })
    .then(function(result) {
      if (result.success) {
        var msg = '<div class="text-center">'
          + '<i class="fas fa-check-circle text-green-500 text-4xl mb-3"></i>'
          + '<h3 class="text-lg font-bold text-green-800 mb-2">Import geslaagd!</h3>'
          + '<p class="text-sm text-gray-700">'
          + '<strong>' + result.imported + '</strong> leden aangemaakt';
        if (result.skipped > 0) msg += ', <strong>' + result.skipped + '</strong> overgeslagen (bestond al)';
        if (result.errors && result.errors.length > 0) msg += ', <strong>' + result.errors.length + '</strong> fouten';
        msg += '.</p>';
        if (result.errors && result.errors.length > 0) {
          msg += '<div class="mt-3 text-left bg-red-50 rounded p-3 text-xs text-red-700">'
            + '<p class="font-semibold mb-1">Fouten:</p><ul class="list-disc list-inside">';
          result.errors.forEach(function(e) { msg += '<li>' + escapeHtml(e) + '</li>'; });
          msg += '</ul></div>';
        }
        msg += '<a href="/admin/leden" class="inline-block mt-4 bg-animato-primary text-white px-6 py-2 rounded hover:bg-animato-secondary transition">'
          + '<i class="fas fa-users mr-2"></i> Naar ledenlijst</a></div>';
        resultContent.innerHTML = msg;
        resultSection.classList.remove('hidden');
        statusMessage.classList.add('hidden');
        previewSection.classList.add('hidden');
        importBtn.innerHTML = '<i class="fas fa-check mr-2"></i> Klaar!';
      } else {
        showStatus('bg-red-50 text-red-700 border border-red-200', 'Fout: ' + (result.error || 'Onbekende fout'));
        importBtn.disabled = false;
        importBtn.innerHTML = '<i class="fas fa-check mr-2"></i> Opnieuw proberen';
      }
    })
    .catch(function(err) {
      console.error('Import fetch error:', err);
      showStatus('bg-red-50 text-red-700 border border-red-200', 'Fout: ' + err.message);
      importBtn.disabled = false;
      importBtn.innerHTML = '<i class="fas fa-check mr-2"></i> Opnieuw proberen';
    });
  });

  function showStatus(classes, message) {
    statusMessage.className = 'mb-6 p-4 rounded text-sm ' + classes;
    statusMessage.textContent = message;
    statusMessage.classList.remove('hidden');
  }
})();
