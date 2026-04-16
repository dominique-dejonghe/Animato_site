/**
 * Foto Upload Component — R2-ready version
 * Client-side foto upload met:
 * - Drag & drop
 * - Klik om te kiezen
 * - Client-side resize (max 400x400px, JPEG 75% kwaliteit)
 * - Server-side upload via /api/photos/upload
 * - Preview
 * - Verwijder optie
 * 
 * Verwacht DOM elementen:
 * - #foto-upload-zone (drop zone)
 * - #foto-file-input (hidden file input)
 * - #foto-preview-img (preview img tag)
 * - #foto-placeholder (placeholder div)
 * - #foto-url-input (hidden input met foto_url value)
 * - #foto-remove-btn (verwijder knop)
 * - #foto-upload-status (status tekst)
 * - data-user-id on #foto-upload-zone (target user id for admin uploads)
 */
(function() {
  'use strict';

  var uploadZone = document.getElementById('foto-upload-zone');
  var fileInput = document.getElementById('foto-file-input');
  var previewImg = document.getElementById('foto-preview-img');
  var placeholder = document.getElementById('foto-placeholder');
  var urlInput = document.getElementById('foto-url-input');
  var removeBtn = document.getElementById('foto-remove-btn');
  var statusEl = document.getElementById('foto-upload-status');

  if (!uploadZone || !fileInput) return;

  // Get target user ID (for admin editing other users)
  var targetUserId = uploadZone.dataset.userId || null;

  // ========== Click to upload ==========
  uploadZone.addEventListener('click', function(e) {
    if (e.target.closest('#foto-remove-btn')) return;
    fileInput.click();
  });

  fileInput.addEventListener('change', function(e) {
    var file = e.target.files && e.target.files[0];
    if (file) processFile(file);
  });

  // ========== Drag & drop ==========
  uploadZone.addEventListener('dragover', function(e) {
    e.preventDefault();
    e.stopPropagation();
    uploadZone.classList.add('border-blue-500', 'bg-blue-50');
  });

  uploadZone.addEventListener('dragleave', function(e) {
    e.preventDefault();
    e.stopPropagation();
    uploadZone.classList.remove('border-blue-500', 'bg-blue-50');
  });

  uploadZone.addEventListener('drop', function(e) {
    e.preventDefault();
    e.stopPropagation();
    uploadZone.classList.remove('border-blue-500', 'bg-blue-50');
    var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) processFile(file);
  });

  // ========== Remove button ==========
  if (removeBtn) {
    removeBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      
      showStatus('Foto verwijderen...', 'text-orange-600');
      
      fetch('/api/photos/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_user_id: targetUserId })
      }).then(function(res) { return res.json(); })
        .then(function(data) {
          if (urlInput) urlInput.value = '';
          if (previewImg) {
            previewImg.src = '';
            previewImg.classList.add('hidden');
          }
          if (placeholder) placeholder.classList.remove('hidden');
          if (removeBtn) removeBtn.classList.add('hidden');
          showStatus('Foto verwijderd.', 'text-green-600');
        })
        .catch(function() {
          showStatus('Fout bij verwijderen.', 'text-red-600');
        });
    });
  }

  // ========== Process file ==========
  function processFile(file) {
    var allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedTypes.indexOf(file.type) === -1) {
      showStatus('Ongeldig bestandstype. Alleen JPG, PNG, GIF en WEBP.', 'text-red-600');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      showStatus('Bestand is te groot. Maximum 10MB.', 'text-red-600');
      return;
    }

    showStatus('Foto verkleinen...', 'text-blue-600');

    var reader = new FileReader();
    reader.onload = function(event) {
      var img = new Image();
      img.onload = function() {
        // Resize client-side
        var resized = resizeImage(img, 400, 400, 0.75);
        
        // Show preview immediately
        if (previewImg) {
          previewImg.src = resized;
          previewImg.classList.remove('hidden');
        }
        if (placeholder) placeholder.classList.add('hidden');
        
        showStatus('Uploaden naar server...', 'text-blue-600');
        
        // Upload to server
        var payload = { data: resized, content_type: 'image/jpeg' };
        if (targetUserId) payload.target_user_id = targetUserId;
        
        fetch('/api/photos/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
        .then(function(res) { return res.json(); })
        .then(function(data) {
          if (data.success) {
            if (urlInput) urlInput.value = data.url;
            if (removeBtn) removeBtn.classList.remove('hidden');
            var sizeKB = Math.round(data.size / 1024);
            showStatus('Foto opgeslagen! (' + sizeKB + ' KB)', 'text-green-600');
          } else {
            throw new Error(data.error || 'Upload mislukt');
          }
        })
        .catch(function(err) {
          showStatus('Upload mislukt: ' + err.message, 'text-red-600');
        });
      };
      img.onerror = function() {
        showStatus('Kon de afbeelding niet laden. Probeer een ander bestand.', 'text-red-600');
      };
      img.src = event.target.result;
    };
    reader.onerror = function() {
      showStatus('Fout bij lezen van bestand.', 'text-red-600');
    };
    reader.readAsDataURL(file);
  }

  // ========== Client-side image resize ==========
  function resizeImage(img, maxWidth, maxHeight, quality) {
    var canvas = document.createElement('canvas');
    var width = img.width;
    var height = img.height;

    if (width > height) {
      if (width > maxWidth) {
        height = Math.round(height * maxWidth / width);
        width = maxWidth;
      }
    } else {
      if (height > maxHeight) {
        width = Math.round(width * maxHeight / height);
        height = maxHeight;
      }
    }

    canvas.width = width;
    canvas.height = height;

    var ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, width, height);

    return canvas.toDataURL('image/jpeg', quality);
  }

  function showStatus(message, colorClass) {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.className = 'text-xs mt-2 ' + (colorClass || 'text-gray-500');
  }
})();
