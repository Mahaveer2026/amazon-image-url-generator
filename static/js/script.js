/* =============================================
   SellerCDN — Google Drive Version
============================================= */

const dropZone      = document.getElementById('dropZone');
const fileInput     = document.getElementById('fileInput');
const progressCard  = document.getElementById('progressCard');
const progressFill  = document.getElementById('progressFill');
const progressLabel = document.getElementById('progressLabel');
const progressFrac  = document.getElementById('progressFrac');
const actionBar     = document.getElementById('actionBar');
const countBadge    = document.getElementById('countBadge');
const resultsGrid   = document.getElementById('resultsGrid');
const errorBox      = document.getElementById('errorBox');
const errorList     = document.getElementById('errorList');
const toastEl       = document.getElementById('toast');

let allImages = [];
let toastTimer = null;

/* ── Drag & Drop ─────────────────────────────── */
dropZone.addEventListener('dragenter', function(e) { e.preventDefault(); dropZone.classList.add('over'); });
dropZone.addEventListener('dragover',  function(e) { e.preventDefault(); dropZone.classList.add('over'); });
dropZone.addEventListener('dragleave', function(e) {
  if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove('over');
});
dropZone.addEventListener('drop', function(e) {
  e.preventDefault();
  dropZone.classList.remove('over');
  var files = Array.from(e.dataTransfer.files).filter(function(f) { return f.type.startsWith('image/'); });
  if (files.length) handleFiles(files);
  else showToast('No valid image files found', 'err');
});

dropZone.addEventListener('click', function() { fileInput.click(); });
fileInput.addEventListener('change', function() {
  if (fileInput.files.length) handleFiles(Array.from(fileInput.files));
  fileInput.value = '';
});

/* ── Upload Handler ──────────────────────────── */
async function handleFiles(files) {
  // Show skeletons right away
  files.forEach(function() {
    var s = document.createElement('div');
    s.className = 'skel-card';
    s.innerHTML = '<div class="skel-img"></div><div class="skel-body"><div class="skel-line"></div><div class="skel-line s"></div></div>';
    resultsGrid.prepend(s);
  });

  // Show progress
  progressCard.style.display = 'block';
  progressFill.style.width = '0%';
  progressLabel.textContent = 'Uploading ' + files.length + ' image' + (files.length > 1 ? 's' : '') + ' to Google Drive…';
  progressFrac.textContent = '0 / ' + files.length;

  var BATCH = 5;
  var done = 0;

  for (var i = 0; i < files.length; i += BATCH) {
    var batch = files.slice(i, i + BATCH);
    var fd = new FormData();
    batch.forEach(function(f) { fd.append('images', f); });

    try {
      var res = await fetch('/upload', { method: 'POST', body: fd });
      if (!res.ok) throw new Error('Server error ' + res.status);
      var data = await res.json();

      (data.success || []).forEach(function(img) {
        allImages.unshift(img);
        done++;
        var pct = Math.round((done / files.length) * 100);
        progressFill.style.width = pct + '%';
        progressFrac.textContent = done + ' / ' + files.length;
        var skel = resultsGrid.querySelector('.skel-card');
        if (skel) skel.replaceWith(buildCard(img));
        else resultsGrid.prepend(buildCard(img));
      });

      (data.errors || []).forEach(function(err) {
        done++;
        var skel = resultsGrid.querySelector('.skel-card');
        if (skel) skel.remove();
        addError(err.filename, err.error);
      });

    } catch(err) {
      batch.forEach(function(f) {
        done++;
        var skel = resultsGrid.querySelector('.skel-card');
        if (skel) skel.remove();
        addError(f.name, err.message);
      });
    }
  }

  progressCard.style.display = 'none';
  refreshBar();
  if (allImages.length) showToast(allImages.length + ' image' + (allImages.length > 1 ? 's' : '') + ' uploaded successfully!', 'ok');
}

/* ── Build Card ──────────────────────────────── */
function buildCard(img) {
  var size = fmtBytes(img.size || 0);
  var card = document.createElement('div');
  card.className = 'result-card';

  // Preview: try to load the image; fallback gracefully
  var imgSrc = img.url;

  card.innerHTML =
    '<div class="card-thumb">' +
      '<img src="' + esc(imgSrc) + '" alt="' + esc(img.filename) + '" loading="lazy" onerror="this.src=\'data:image/svg+xml,<svg xmlns=\\\'http://www.w3.org/2000/svg\\\' width=\\\'100\\\' height=\\\'100\\\'><rect width=\\\'100\\\' height=\\\'100\\\' fill=\\\'%23eaedf4\\\'/><text x=\\\'50%\\\' y=\\\'50%\\\' text-anchor=\\\'middle\\\' dy=\\\'.3em\\\' fill=\\\'%238496aa\\\' font-size=\\\'12\\\'>IMG</text></svg>\'"/>' +
      '<div class="card-live"><div class="card-live-dot"></div>Live</div>' +
      (img.format ? '<div class="card-fmt">' + esc(img.format) + '</div>' : '') +
    '</div>' +
    '<div class="card-body">' +
      '<div class="card-name" title="' + esc(img.filename) + '">' + esc(img.filename) + '</div>' +
      '<div class="card-meta">' + (size ? size + '  ·  ' : '') + 'Google Drive CDN</div>' +
      '<div class="card-url">' + esc(img.url) + '</div>' +
      '<div class="card-actions">' +
        '<button class="btn-copy" onclick="copyUrl(this,\'' + escAttr(img.url) + '\')">' +
          '<svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="4" y="4" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M2.5 9V2.5h6.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>' +
          'Copy URL' +
        '</button>' +
        '<a class="btn-ext" href="' + esc(img.url) + '" target="_blank" rel="noopener" title="Open image">' +
          '<svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M5 2H2a1 1 0 00-1 1v8a1 1 0 001 1h8a1 1 0 001-1v-3M8 1h4v4M12 1L6 7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '</a>' +
      '</div>' +
    '</div>';
  return card;
}

/* ── Copy single URL ─────────────────────────── */
function copyUrl(btn, url) {
  navigator.clipboard.writeText(url).then(function() {
    var orig = btn.innerHTML;
    btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2 6.5l3.5 3.5 6-6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg> Copied!';
    btn.classList.add('ok');
    setTimeout(function() { btn.innerHTML = orig; btn.classList.remove('ok'); }, 2200);
    showToast('URL copied!', 'ok');
  }).catch(function() { showToast('Copy failed — please select manually', 'err'); });
}

/* ── Copy All URLs ───────────────────────────── */
function copyAllUrls() {
  if (!allImages.length) return;
  var text = allImages.map(function(img) { return img.url; }).join('\n');
  navigator.clipboard.writeText(text).then(function() {
    showToast(allImages.length + ' URLs copied to clipboard!', 'ok');
  }).catch(function() { showToast('Copy failed', 'err'); });
}

/* ── Export Excel ────────────────────────────── */
async function exportExcel() {
  if (!allImages.length) return;
  var btn = document.getElementById('exportBtn');
  var orig = btn.innerHTML;
  btn.innerHTML = '<div class="prog-spinner" style="width:14px;height:14px;border-width:2px;margin:0"></div> Generating…';
  btn.disabled = true;

  try {
    var res = await fetch('/export-excel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ images: allImages })
    });
    if (!res.ok) throw new Error('Export failed');
    var blob = await res.blob();
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href   = url;
    var now  = new Date();
    a.download = 'amazon_image_urls_' + now.getFullYear() + pad(now.getMonth()+1) + pad(now.getDate()) + '.xlsx';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Excel file downloaded!', 'ok');
  } catch(err) {
    showToast('Export failed: ' + err.message, 'err');
  } finally {
    btn.innerHTML = orig;
    btn.disabled  = false;
  }
}

/* ── Clear All ───────────────────────────────── */
function clearAll() {
  allImages = [];
  resultsGrid.innerHTML = '';
  errorBox.style.display = 'none';
  errorList.innerHTML = '';
  actionBar.style.display = 'none';
}

/* ── Helpers ─────────────────────────────────── */
function refreshBar() {
  if (allImages.length > 0) {
    actionBar.style.display = 'flex';
    countBadge.textContent = allImages.length + ' image' + (allImages.length !== 1 ? 's' : '') + ' ready';
  }
}

function addError(filename, msg) {
  errorBox.style.display = 'block';
  var row = document.createElement('div');
  row.className = 'err-row';
  row.innerHTML = '<span class="err-file">' + esc(filename) + '</span><span>' + esc(msg) + '</span>';
  errorList.appendChild(row);
}

function showToast(msg, type) {
  clearTimeout(toastTimer);
  toastEl.textContent = msg;
  toastEl.className = 'toast show ' + (type || 'ok');
  toastTimer = setTimeout(function() { toastEl.className = 'toast'; }, 3200);
}

function fmtBytes(b) {
  if (!b) return '';
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b/1024).toFixed(1) + ' KB';
  return (b/1048576).toFixed(1) + ' MB';
}

function pad(n) { return n < 10 ? '0'+n : ''+n; }
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function escAttr(s) { return String(s).replace(/'/g,"&#39;").replace(/"/g,'&quot;'); }
