// ─── State ──────────────────────────────────────────────────────────────────
let currentFile = null;
let previewData = null;
let headless = true;
let isPaused = false;

// ─── Screen Navigation ─────────────────────────────────────────────────────
function showScreen(name) {
  document.body.setAttribute('data-screen', name);
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function formatTime(seconds) {
  if (!seconds || seconds < 0) return '--';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

function addLog(message, level = 'info') {
  const box = document.getElementById('logBox');
  const line = document.createElement('div');
  line.className = `log-line log-${level}`;
  const time = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  line.textContent = `[${time}] ${message}`;
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
  // Keep max 100 lines
  while (box.children.length > 100) box.removeChild(box.firstChild);
}

// ─── Setup Screen ───────────────────────────────────────────────────────────

document.getElementById('btnBrowse').addEventListener('click', async () => {
  const filePath = await window.api.pickFile();
  if (!filePath) return;

  currentFile = filePath;
  document.getElementById('filePath').value = filePath;

  // Get preview
  const preview = await window.api.previewFile(filePath);

  if (preview.error) {
    alert('Error: ' + preview.error);
    return;
  }

  previewData = preview;
  renderPreview(preview);
  document.getElementById('previewSection').classList.remove('hidden');
});

function renderPreview(data) {
  // Column selectors
  const cnicSelect = document.getElementById('cnicColSelect');
  const atlSelect = document.getElementById('atlColSelect');
  cnicSelect.innerHTML = '';
  atlSelect.innerHTML = '';

  data.headers.forEach(h => {
    const colLetter = String.fromCharCode(65 + h.index);
    const isDetectedCnic = h.index === data.detectedCnicCol;
    const isDetectedAtl = h.index === data.detectedAtlCol;

    const opt1 = document.createElement('option');
    opt1.value = h.index;
    opt1.textContent = isDetectedCnic ? `${colLetter}: ${h.name}  [auto-detected]` : `${colLetter}: ${h.name}`;
    if (isDetectedCnic) opt1.selected = true;
    cnicSelect.appendChild(opt1);

    const opt2 = document.createElement('option');
    opt2.value = h.index;
    opt2.textContent = isDetectedAtl ? `${colLetter}: ${h.name}  [auto-detected]` : `${colLetter}: ${h.name}`;
    if (isDetectedAtl) opt2.selected = true;
    atlSelect.appendChild(opt2);
  });

  // If ATL col is beyond existing headers (will create new column)
  const atlExists = data.headers.some(h => h.index === data.detectedAtlCol);
  if (!atlExists) {
    const colLetter = String.fromCharCode(65 + data.detectedAtlCol);
    const opt = document.createElement('option');
    opt.value = data.detectedAtlCol;
    opt.textContent = `${colLetter}: (New Column)  [auto-detected]`;
    opt.selected = true;
    atlSelect.appendChild(opt);
  }

  // Stats
  const statsDiv = document.getElementById('detectionStats');
  statsDiv.innerHTML = `
    <div class="stat-item"><span class="dot dot-total"></span> Total rows: <strong>${data.totalRows}</strong></div>
    <div class="stat-item"><span class="dot dot-unique"></span> Unique values: <strong>${data.uniqueValues}</strong></div>
    <div class="stat-item"><span class="dot dot-dup"></span> Duplicates: <strong>${data.duplicates}</strong></div>
    <div class="stat-item"><span class="dot dot-cnic"></span> CNIC: <strong>${data.cnicCount}</strong></div>
    <div class="stat-item"><span class="dot dot-ntn"></span> NTN: <strong>${data.ntnCount}</strong></div>
  `;

  // Preview table
  const tbody = document.querySelector('#previewTable tbody');
  tbody.innerHTML = '';
  data.previewRows.forEach(row => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${row.srNo}</td>
      <td>${row.buyerName}</td>
      <td>${row.cnicNtn}</td>
      <td class="type-${row.type.toLowerCase()}">${row.type}</td>
    `;
    tbody.appendChild(tr);
  });
}

// Toggle buttons
document.getElementById('btnVisible').addEventListener('click', () => {
  headless = false;
  document.getElementById('btnVisible').classList.add('active');
  document.getElementById('btnBackground').classList.remove('active');
});

document.getElementById('btnBackground').addEventListener('click', () => {
  headless = true;
  document.getElementById('btnBackground').classList.add('active');
  document.getElementById('btnVisible').classList.remove('active');
});

// Start button
document.getElementById('btnStart').addEventListener('click', () => {
  if (!currentFile || !previewData) return;

  const cnicCol = parseInt(document.getElementById('cnicColSelect').value);
  const atlCol = parseInt(document.getElementById('atlColSelect').value);

  showScreen('processing');
  document.getElementById('logBox').innerHTML = '';
  isPaused = false;

  window.api.start({
    filePath: currentFile,
    headless,
    cnicCol,
    atlCol,
  });
});

// ─── Processing Screen ─────────────────────────────────────────────────────

document.getElementById('btnPause').addEventListener('click', () => {
  window.api.pause();
  isPaused = true;
  document.getElementById('btnPause').classList.add('hidden');
  document.getElementById('btnResume').classList.remove('hidden');
});

document.getElementById('btnResume').addEventListener('click', () => {
  window.api.resume();
  isPaused = false;
  document.getElementById('btnResume').classList.add('hidden');
  document.getElementById('btnPause').classList.remove('hidden');
});

document.getElementById('btnStop').addEventListener('click', () => {
  if (confirm('Stop processing? You can resume later.')) {
    window.api.stop();
  }
});

document.getElementById('btnShowBrowser').addEventListener('click', () => {
  window.api.showBrowser();
  document.getElementById('btnShowBrowser').disabled = true;
  document.getElementById('btnShowBrowser').textContent = 'Browser Visible';
});

// ─── Captcha Popup ──────────────────────────────────────────────────────────

document.getElementById('btnCaptchaSubmit').addEventListener('click', submitCaptcha);
document.getElementById('captchaInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitCaptcha();
});

function submitCaptcha() {
  const text = document.getElementById('captchaInput').value.trim();
  if (!text) return;
  window.api.captchaResponse(text);
  document.getElementById('captchaOverlay').classList.add('hidden');
  document.getElementById('captchaInput').value = '';
}

// ─── Done Screen ────────────────────────────────────────────────────────────

document.getElementById('btnOpenOutput').addEventListener('click', () => {
  window.api.openOutput();
});

document.getElementById('btnRetryNA').addEventListener('click', () => {
  showScreen('processing');
  document.getElementById('logBox').innerHTML = '';
  window.api.retryNA();
});

document.getElementById('btnNewFile').addEventListener('click', () => {
  window.api.newFile();
  currentFile = null;
  previewData = null;
  document.getElementById('filePath').value = '';
  document.getElementById('previewSection').classList.add('hidden');
  showScreen('setup');
});

// ─── IPC Listeners ──────────────────────────────────────────────────────────

window.api.onUpdate((data) => {
  if (data.progress) {
    updateProgress(data.progress);
  }

  if (data.eventType === 'row-start') {
    document.getElementById('currentRow').textContent =
      `Sr ${data.srNo}: ${data.buyerName} — ${data.cnicNtn} (${data.lookupType})`;
  }

  if (data.eventType === 'row-complete') {
    const lower = data.status.toLowerCase().replace(/[^a-z]/g, '');
    const statusClass = lower === 'active' ? 'log-info' :
                        data.status === 'N/A' ? 'log-warn' : 'log-error';
    document.getElementById('lastResult').innerHTML =
      `Last: Sr ${data.srNo} — <span class="${statusClass}">${data.status}</span>${data.cached ? ' (cached)' : ''}`;
  }

  if (data.logs) {
    data.logs.forEach(log => addLog(log.message, log.level));
  }
});

function updateProgress(p) {
  document.getElementById('progressBar').style.width = `${p.percent}%`;
  document.getElementById('progressText').textContent =
    `${p.processed} / ${p.total} (${p.percent}%)`;
  document.getElementById('progressEta').textContent =
    `${formatTime(p.elapsed)} elapsed | ETA: ${formatTime(p.eta)} | ${p.speed}s/row`;

  document.getElementById('statActive').textContent = p.active;
  document.getElementById('statInactive').textContent = p.inactive;
  document.getElementById('statNA').textContent = p.na;
  document.getElementById('statCached').textContent = p.cached;
  document.getElementById('statLookups').textContent = p.portalLookups;
}

window.api.onCaptchaRequired((data) => {
  document.getElementById('captchaOverlay').classList.remove('hidden');
  if (data.imageBase64) {
    document.getElementById('captchaImage').src = data.imageBase64;
  }
  document.getElementById('captchaInput').value = '';
  setTimeout(() => document.getElementById('captchaInput').focus(), 100);
});

window.api.onDone((data) => {
  showScreen('done');

  document.getElementById('doneActive').textContent = data.active || 0;
  document.getElementById('doneInactive').textContent = data.inactive || 0;
  document.getElementById('doneNA').textContent = data.na || 0;
  document.getElementById('doneCached').textContent = data.cached || 0;
  document.getElementById('doneLookups').textContent = data.portalLookups || 0;

  const totalTime = formatTime(data.elapsed);
  document.getElementById('doneSummary').innerHTML = `
    Total time: <strong>${totalTime}</strong><br>
    Processed: <strong>${data.processed}</strong> rows<br>
    Previously completed: <strong>${data.skipped || 0}</strong> rows<br>
    Output saved to: <strong>${data.outputFile || 'output.xlsx'}</strong>
  `;
});

window.api.onError((data) => {
  addLog(`ERROR: ${data.message}`, 'error');
});
