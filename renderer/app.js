// ─── Tab State ─────────────────────────────────────────────────────────────
class TabState {
  constructor(tabId, root) {
    this.tabId = tabId;
    this.root = root;
    this.currentFile = null;
    this.previewData = null;
    this.headless = true;
    this.isPaused = false;
    this.screen = 'setup';
    this.customName = null;
    this.outputFile = null;
  }

  el(selector) {
    return this.root.querySelector(selector);
  }
}

const tabs = new Map();
let activeTabId = null;
let captchaTabId = null;

// ─── State Persistence ──────────────────────────────────────────────────────
function collectState() {
  const tabsArr = [];
  const tabList = document.querySelectorAll('.tab-btn');
  tabList.forEach(btn => {
    const tabId = parseInt(btn.dataset.tabId);
    const tab = tabs.get(tabId);
    if (!tab) return;

    const cnicSelect = tab.el('.cnic-col-select');
    const atlSelect = tab.el('.atl-col-select');

    tabsArr.push({
      name: tab.customName || null,
      filePath: tab.currentFile || null,
      outputFile: tab.outputFile || null,
      cnicCol: cnicSelect && cnicSelect.value !== '' ? parseInt(cnicSelect.value) : null,
      atlCol: atlSelect && atlSelect.value !== '' ? parseInt(atlSelect.value) : null,
      headless: tab.headless,
    });
  });

  // Find active tab index by iterating tab buttons in order
  let activeIndex = 0;
  let idx = 0;
  tabList.forEach(btn => {
    if (parseInt(btn.dataset.tabId) === activeTabId) activeIndex = idx;
    idx++;
  });

  return { tabs: tabsArr, activeTabIndex: activeIndex };
}

function saveAppState() {
  try {
    const state = collectState();
    window.api.saveState(state);
  } catch (err) {
    console.error('Failed to save app state:', err);
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function formatTime(seconds) {
  if (!seconds || seconds < 0) return '--';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

function addLog(tab, message, level = 'info') {
  const box = tab.el('.log-box');
  if (!box) return;
  const line = document.createElement('div');
  line.className = `log-line log-${level}`;
  const time = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  line.textContent = `[${time}] ${message}`;
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
  while (box.children.length > 100) box.removeChild(box.firstChild);
}

function showTabScreen(tab, screenName) {
  tab.root.querySelectorAll('.screen').forEach(s => s.style.display = 'none');
  const target = tab.root.querySelector(`.screen-${screenName}`);
  if (target) target.style.display = 'block';
  tab.screen = screenName;
  updateTabButton(tab);
}

function updateTabButton(tab) {
  const btn = document.querySelector(`.tab-btn[data-tab-id="${tab.tabId}"]`);
  if (!btn) return;

  const dot = btn.querySelector('.tab-status');
  if (dot) dot.className = `tab-status tab-status-${tab.screen}`;

  const label = btn.querySelector('.tab-label');
  if (label && !tab.customName) {
    if (tab.currentFile) {
      const name = tab.currentFile.split(/[/\\]/).pop().replace(/\.xlsx$/i, '');
      label.textContent = name;
    } else {
      label.textContent = `Tab ${tab.tabId}`;
    }
  }
}

function updateCloseButtons() {
  const closeBtns = document.querySelectorAll('.tab-close');
  closeBtns.forEach(btn => {
    btn.style.display = tabs.size <= 1 ? 'none' : '';
  });
}

// ─── Tab Management ────────────────────────────────────────────────────────
async function createTab() {
  const tabId = await window.api.createTab();

  // Clone template
  const template = document.getElementById('tabTemplate');
  const clone = template.content.cloneNode(true);
  const pane = clone.querySelector('.tab-pane');
  pane.dataset.tabId = tabId;

  document.getElementById('tabContent').appendChild(pane);

  const tab = new TabState(tabId, pane);
  tabs.set(tabId, tab);

  // Create tab button
  const btn = document.createElement('button');
  btn.className = 'tab-btn';
  btn.dataset.tabId = tabId;
  btn.innerHTML = `<span class="tab-status tab-status-setup"></span><span class="tab-label">Tab ${tabId}</span><span class="tab-close">&times;</span>`;

  btn.addEventListener('click', (e) => {
    if (e.target.classList.contains('tab-close')) {
      closeTab(tabId);
    } else {
      switchTab(tabId);
    }
  });

  // Double-click to rename
  btn.addEventListener('dblclick', (e) => {
    if (e.target.classList.contains('tab-close')) return;
    const label = btn.querySelector('.tab-label');
    const current = label.textContent;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tab-rename-input';
    input.value = current;
    label.replaceWith(input);
    input.focus();
    input.select();

    const finish = () => {
      const val = input.value.trim() || current;
      const span = document.createElement('span');
      span.className = 'tab-label';
      span.textContent = val;
      input.replaceWith(span);
      tab.customName = val;
      saveAppState();
    };

    input.addEventListener('blur', finish);
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') input.blur();
      if (ev.key === 'Escape') { input.value = current; input.blur(); }
    });
  });

  document.getElementById('tabList').appendChild(btn);

  // Setup event listeners for this tab
  setupTabListeners(tab);

  // Switch to this tab
  switchTab(tabId);
  updateCloseButtons();
  saveAppState();

  return tab;
}

async function restoreTab(savedTab) {
  // Create the tab (this calls switchTab internally)
  const tab = await createTab();
  if (!tab) return;

  // Restore custom name
  if (savedTab.name) {
    tab.customName = savedTab.name;
    const btn = document.querySelector(`.tab-btn[data-tab-id="${tab.tabId}"]`);
    if (btn) {
      const label = btn.querySelector('.tab-label');
      if (label) label.textContent = savedTab.name;
    }
  }

  // Restore headless mode
  if (savedTab.headless === false) {
    tab.headless = false;
    tab.el('.btn-visible').classList.add('active');
    tab.el('.btn-background').classList.remove('active');
  }

  // Restore file and preview if file still exists
  if (savedTab.filePath) {
    try {
      const preview = await window.api.previewFile(savedTab.filePath);
      if (!preview || preview.error) {
        // File no longer exists or can't be read — leave tab in setup without file
        return;
      }

      tab.currentFile = savedTab.filePath;
      tab.el('.file-path').value = savedTab.filePath;
      tab.previewData = preview;
      renderPreview(tab, preview);
      tab.el('.preview-section').classList.remove('hidden');
      tab.el('.btn-clear-file').classList.remove('hidden');
      updateTabButton(tab);

      // Restore column selections after preview has populated the dropdowns
      if (savedTab.cnicCol !== null && savedTab.cnicCol !== undefined) {
        const cnicSelect = tab.el('.cnic-col-select');
        if (cnicSelect) {
          // Check if the option exists
          const optExists = Array.from(cnicSelect.options).some(o => parseInt(o.value) === savedTab.cnicCol);
          if (optExists) cnicSelect.value = savedTab.cnicCol;
        }
      }
      if (savedTab.atlCol !== null && savedTab.atlCol !== undefined) {
        const atlSelect = tab.el('.atl-col-select');
        if (atlSelect) {
          const optExists = Array.from(atlSelect.options).some(o => parseInt(o.value) === savedTab.atlCol);
          if (optExists) atlSelect.value = savedTab.atlCol;
        }
      }

      // Restore output file path
      if (savedTab.outputFile) {
        tab.outputFile = savedTab.outputFile;
      } else {
        tab.outputFile = savedTab.filePath.replace(/\.xlsx$/i, '_results.xlsx');
      }
      tab.el('.output-path').value = tab.outputFile;
    } catch (err) {
      // File can't be loaded — leave tab in setup state
      console.error('Failed to restore file for tab:', err);
    }
  }
}

function switchTab(tabId) {
  // Hide all panes
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));

  // Show selected
  const tab = tabs.get(tabId);
  if (!tab) return;
  tab.root.classList.add('active');

  const btn = document.querySelector(`.tab-btn[data-tab-id="${tabId}"]`);
  if (btn) btn.classList.add('active');

  activeTabId = tabId;
}

async function closeTab(tabId) {
  // Don't close last tab
  if (tabs.size <= 1) return;

  const tab = tabs.get(tabId);
  if (!tab) return;

  // Confirm if processing
  if (tab.screen === 'processing') {
    if (!confirm('This tab is still processing. Close it?')) return;
  }

  window.api.closeTab(tabId);

  // Remove DOM
  tab.root.remove();
  const btn = document.querySelector(`.tab-btn[data-tab-id="${tabId}"]`);
  if (btn) btn.remove();

  tabs.delete(tabId);

  // Switch to another tab if this was active
  if (activeTabId === tabId) {
    const firstTabId = tabs.keys().next().value;
    if (firstTabId) switchTab(firstTabId);
  }

  updateCloseButtons();
  saveAppState();
}

// ─── Tab Event Listeners ───────────────────────────────────────────────────
function setupTabListeners(tab) {
  // Browse
  tab.el('.btn-browse').addEventListener('click', async () => {
    const filePath = await window.api.pickFile();
    if (!filePath) return;

    tab.currentFile = filePath;
    tab.el('.file-path').value = filePath;
    updateTabButton(tab);

    const preview = await window.api.previewFile(filePath);
    if (preview.error) {
      alert('Error: ' + preview.error);
      return;
    }

    tab.previewData = preview;
    renderPreview(tab, preview);
    tab.el('.preview-section').classList.remove('hidden');
    tab.el('.btn-clear-file').classList.remove('hidden');

    // Set default output path
    tab.outputFile = filePath.replace(/\.xlsx$/i, '_results.xlsx');
    tab.el('.output-path').value = tab.outputFile;

    saveAppState();
  });

  // Clear file
  tab.el('.btn-clear-file').addEventListener('click', () => {
    tab.currentFile = null;
    tab.previewData = null;
    tab.outputFile = null;
    tab.el('.file-path').value = '';
    tab.el('.preview-section').classList.add('hidden');
    tab.el('.btn-clear-file').classList.add('hidden');
    updateTabButton(tab);
    saveAppState();
  });

  // Change output directory
  tab.el('.btn-change-output-dir').addEventListener('click', async () => {
    const dir = await window.api.pickDirectory();
    if (!dir || !tab.outputFile) return;
    const filename = tab.outputFile.split(/[/\\]/).pop();
    tab.outputFile = dir + '/' + filename;
    tab.el('.output-path').value = tab.outputFile;
    saveAppState();
  });

  // Editable output path — sync back on blur or Enter
  tab.el('.output-path').addEventListener('blur', () => {
    const val = tab.el('.output-path').value.trim();
    if (val) {
      tab.outputFile = val.endsWith('.xlsx') ? val : val + '.xlsx';
      tab.el('.output-path').value = tab.outputFile;
      saveAppState();
    } else if (tab.outputFile) {
      tab.el('.output-path').value = tab.outputFile;
    }
  });

  tab.el('.output-path').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') tab.el('.output-path').blur();
  });

  // Toggle buttons
  tab.el('.btn-visible').addEventListener('click', () => {
    tab.headless = false;
    tab.el('.btn-visible').classList.add('active');
    tab.el('.btn-background').classList.remove('active');
    saveAppState();
  });

  tab.el('.btn-background').addEventListener('click', () => {
    tab.headless = true;
    tab.el('.btn-background').classList.add('active');
    tab.el('.btn-visible').classList.remove('active');
    saveAppState();
  });

  // Start
  tab.el('.btn-start').addEventListener('click', () => {
    if (!tab.currentFile || !tab.previewData) return;

    const cnicCol = parseInt(tab.el('.cnic-col-select').value);
    const atlCol = parseInt(tab.el('.atl-col-select').value);

    showTabScreen(tab, 'processing');
    tab.el('.log-box').innerHTML = '';
    tab.isPaused = false;

    window.api.start(tab.tabId, {
      filePath: tab.currentFile,
      outputFile: tab.outputFile,
      headless: tab.headless,
      cnicCol,
      atlCol,
    });
    saveAppState();
  });

  // Pause / Resume / Stop
  tab.el('.btn-pause').addEventListener('click', () => {
    window.api.pause(tab.tabId);
    tab.isPaused = true;
    tab.el('.btn-pause').classList.add('hidden');
    tab.el('.btn-resume').classList.remove('hidden');
  });

  tab.el('.btn-resume').addEventListener('click', () => {
    window.api.resume(tab.tabId);
    tab.isPaused = false;
    tab.el('.btn-resume').classList.add('hidden');
    tab.el('.btn-pause').classList.remove('hidden');
  });

  tab.el('.btn-stop').addEventListener('click', () => {
    if (confirm('Stop processing? You can resume later.')) {
      window.api.stop(tab.tabId);
    }
  });

  // Show Browser (global — affects all tabs)
  tab.el('.btn-show-browser').addEventListener('click', () => {
    window.api.showBrowser();
    // Disable for all tabs
    tabs.forEach(t => {
      const btn = t.el('.btn-show-browser');
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Browser Visible';
      }
    });
  });

  // Done screen buttons
  tab.el('.btn-open-output').addEventListener('click', () => {
    window.api.openOutput(tab.tabId);
  });

  tab.el('.btn-retry-na').addEventListener('click', () => {
    showTabScreen(tab, 'processing');
    tab.el('.log-box').innerHTML = '';
    window.api.retryNA(tab.tabId);
  });

  tab.el('.btn-new-file').addEventListener('click', () => {
    window.api.newFile(tab.tabId);
    tab.currentFile = null;
    tab.previewData = null;
    tab.el('.file-path').value = '';
    tab.el('.preview-section').classList.add('hidden');
    showTabScreen(tab, 'setup');
    updateTabButton(tab);
    saveAppState();
  });
}

// ─── Preview Rendering ─────────────────────────────────────────────────────
function updateDetectionStats(tab) {
  const data = tab.previewData;
  if (!data) return;

  const atlCol = parseInt(tab.el('.atl-col-select').value);
  const alreadyDone = data.columnFillCounts[atlCol] || 0;
  const toProcess = data.totalRows - alreadyDone;

  const statsDiv = tab.el('.detection-stats');
  statsDiv.innerHTML = `
    <div class="stat-item"><span class="dot dot-total"></span> Total rows: <strong>${data.totalRows}</strong></div>
    <div class="stat-item"><span class="dot dot-unique"></span> To process: <strong>${toProcess}</strong></div>
    <div class="stat-item"><span class="dot" style="background:var(--active-green)"></span> Already done: <strong>${alreadyDone}</strong></div>
    <div class="stat-item"><span class="dot dot-cnic"></span> CNIC: <strong>${data.cnicCount}</strong></div>
    <div class="stat-item"><span class="dot dot-ntn"></span> NTN: <strong>${data.ntnCount}</strong></div>
    <div class="stat-item"><span class="dot" style="background:var(--warning)"></span> Duplicates: <strong>${data.duplicates}</strong></div>
    <div class="stat-item"><span class="dot" style="background:var(--lookup-purple)"></span> Unique lookups: <strong>${data.uniqueValues}</strong></div>
  `;
}

function renderPreview(tab, data) {
  const cnicSelect = tab.el('.cnic-col-select');
  const atlSelect = tab.el('.atl-col-select');
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

  // If ATL col is beyond existing headers (new column)
  const atlExists = data.headers.some(h => h.index === data.detectedAtlCol);
  if (!atlExists) {
    const colLetter = String.fromCharCode(65 + data.detectedAtlCol);
    const opt = document.createElement('option');
    opt.value = data.detectedAtlCol;
    opt.textContent = `${colLetter}: (New Column)  [auto-detected]`;
    opt.selected = true;
    atlSelect.appendChild(opt);
  }

  // Recalculate stats when write column changes
  atlSelect.onchange = () => updateDetectionStats(tab);

  // Stats
  updateDetectionStats(tab);

  // Preview table
  const tbody = tab.el('.preview-table tbody');
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

// ─── Progress Update ───────────────────────────────────────────────────────
function updateProgress(tab, p) {
  const bar = tab.el('.screen-processing .progress-bar');
  if (bar) bar.style.width = `${p.percent}%`;

  const txt = tab.el('.progress-text-val');
  if (txt) txt.textContent = `${p.processed} / ${p.total} (${p.percent}%)`;

  const eta = tab.el('.progress-eta');
  if (eta) eta.textContent = `${formatTime(p.elapsed)} elapsed | ETA: ${formatTime(p.eta)} | ${p.speed}s/row`;

  const an = tab.el('.stat-active-num');
  if (an) an.textContent = p.active;
  const inn = tab.el('.stat-inactive-num');
  if (inn) inn.textContent = p.inactive;
  const nan = tab.el('.stat-na-num');
  if (nan) nan.textContent = p.na;
  const cn = tab.el('.stat-cached-num');
  if (cn) cn.textContent = p.cached;
  const ln = tab.el('.stat-lookups-num');
  if (ln) ln.textContent = p.portalLookups;
}

// ─── IPC Listeners (global, route by tabId) ────────────────────────────────
window.api.onUpdate((data) => {
  const tab = tabs.get(data.tabId);
  if (!tab) return;

  if (data.progress) {
    updateProgress(tab, data.progress);
  }

  if (data.eventType === 'row-start') {
    const el = tab.el('.current-row');
    if (el) el.textContent = `Sr ${data.srNo}: ${data.buyerName} — ${data.cnicNtn} (${data.lookupType})`;
  }

  if (data.eventType === 'row-complete') {
    const lower = data.status.toLowerCase().replace(/[^a-z]/g, '');
    const statusClass = lower === 'active' ? 'log-info' :
                        data.status === 'N/A' ? 'log-warn' : 'log-error';
    const el = tab.el('.last-result');
    if (el) el.innerHTML = `Last: Sr ${data.srNo} — <span class="${statusClass}">${data.status}</span>${data.cached ? ' (cached)' : ''}`;
  }

  if (data.logs) {
    data.logs.forEach(log => addLog(tab, log.message, log.level));
  }
});

window.api.onCaptchaRequired((data) => {
  captchaTabId = data.tabId;
  document.getElementById('captchaOverlay').classList.remove('hidden');
  if (data.imageBase64) {
    document.getElementById('captchaImage').src = data.imageBase64;
  }
  document.getElementById('captchaInput').value = '';
  setTimeout(() => document.getElementById('captchaInput').focus(), 100);
});

window.api.onDone((data) => {
  const tab = tabs.get(data.tabId);
  if (!tab) return;

  showTabScreen(tab, 'done');

  const set = (sel, val) => { const e = tab.el(sel); if (e) e.textContent = val || 0; };
  set('.done-active-num', data.active);
  set('.done-inactive-num', data.inactive);
  set('.done-na-num', data.na);
  set('.done-cached-num', data.cached);
  set('.done-lookups-num', data.portalLookups);

  const totalTime = formatTime(data.elapsed);
  const summary = tab.el('.done-summary-text');
  if (summary) {
    summary.innerHTML = `
      Total time: <strong>${totalTime}</strong><br>
      Processed: <strong>${data.processed}</strong> rows<br>
      Previously completed: <strong>${data.skipped || 0}</strong> rows<br>
      Output saved to: <strong>${data.outputFile || 'output.xlsx'}</strong>
    `;
  }
});

window.api.onError((data) => {
  const tab = tabs.get(data.tabId);
  if (!tab) return;
  addLog(tab, `ERROR: ${data.message}`, 'error');
});

// ─── Captcha Popup ─────────────────────────────────────────────────────────
document.getElementById('btnCaptchaSubmit').addEventListener('click', submitCaptcha);
document.getElementById('captchaInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitCaptcha();
});

function submitCaptcha() {
  const text = document.getElementById('captchaInput').value.trim();
  if (!text || !captchaTabId) return;
  window.api.captchaResponse(captchaTabId, text);
  document.getElementById('captchaOverlay').classList.add('hidden');
  document.getElementById('captchaInput').value = '';
  captchaTabId = null;
}

// ─── Add Tab Button ────────────────────────────────────────────────────────
document.getElementById('btnAddTab').addEventListener('click', () => createTab());

// ─── Init: Restore state or create first tab ──────────────────────────────
(async () => {
  try {
    const savedState = await window.api.loadState();
    if (savedState && savedState.tabs && savedState.tabs.length > 0) {
      for (const savedTab of savedState.tabs) {
        await restoreTab(savedTab);
      }
      // Switch to the previously active tab
      const tabButtons = document.querySelectorAll('.tab-btn');
      const targetIndex = Math.min(savedState.activeTabIndex || 0, tabButtons.length - 1);
      if (tabButtons[targetIndex]) {
        const targetTabId = parseInt(tabButtons[targetIndex].dataset.tabId);
        switchTab(targetTabId);
      }
    } else {
      await createTab();
    }
  } catch (err) {
    console.error('Failed to restore state, creating fresh tab:', err);
    if (tabs.size === 0) await createTab();
  }
})();
