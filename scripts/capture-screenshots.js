#!/usr/bin/env node
/**
 * Captures the README screenshots from the real Electron app.
 *
 *   node scripts/generate-sample.js
 *   node scripts/capture-screenshots.js
 *
 * The app is launched through Playwright's Electron driver with a throwaway
 * user-data directory, so no saved tab state leaks into the images. The setup
 * and detection screens are genuine — the file is loaded through the real
 * preview IPC path and the columns really are auto-detected.
 *
 * The processing, captcha and done screens are rendered by pushing sample
 * state straight into the renderer. That is deliberate: capturing them for
 * real would mean firing dozens of live lookups at the FBR portal every time
 * the docs are refreshed, and would put third-party taxpayer data in the
 * README. The layout, styling and numbers formatting are the app's own.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'screenshots');
const SAMPLE = path.join(ROOT, 'examples', 'sample-input.xlsx');
const WIDTH = 1000;

const shot = (name) => path.join(OUT_DIR, name);

const setContentSize = (app, w, h) =>
  app.evaluate(({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows()[0].setContentSize(size.w, size.h);
  }, { w, h });

/** Size the window to exactly fit the current screen — no dead space. */
async function fitWindow(app, page, maxHeight = 1500) {
  // body is min-height:100vh, so scrollHeight can never report less than the
  // current viewport. Collapse the window first, then measure.
  await setContentSize(app, WIDTH, 100);
  await page.waitForTimeout(250);

  const height = await page.evaluate(() =>
    Math.ceil(Math.max(document.documentElement.scrollHeight, document.body.scrollHeight))
  );
  await setContentSize(app, WIDTH, Math.min(maxHeight, height));
  await page.waitForTimeout(500);
}

/** Replace the log box contents with a fixed, readable transcript. */
const WRITE_LOG = (lines) => {
  const tab = tabs.get(activeTabId);
  const box = tab.el('.log-box');
  box.innerHTML = '';
  for (const [time, level, message] of lines) {
    const line = document.createElement('div');
    line.className = `log-line log-${level}`;
    line.textContent = `[${time}] ${message}`;
    box.appendChild(line);
  }
  box.scrollTop = box.scrollHeight;
};

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (!fs.existsSync(SAMPLE)) {
    throw new Error('examples/sample-input.xlsx is missing — run: node scripts/generate-sample.js');
  }

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fbr-atl-shots-'));
  const app = await electron.launch({
    args: [ROOT, `--user-data-dir=${userDataDir}`],
    cwd: ROOT,
  });

  const page = await app.firstWindow();
  await page.waitForSelector('.tab-pane', { timeout: 30000 });
  await page.waitForTimeout(1200);

  // ── 1. Empty setup screen ────────────────────────────────────────────────
  await fitWindow(app, page);
  await page.screenshot({ path: shot('01-setup.png') });
  console.log('screenshots/01-setup.png');

  // ── 2. File loaded, columns auto-detected (real detection pipeline) ──────
  // The Browse button opens a native dialog that cannot be driven from here,
  // and window.api is frozen by contextBridge so it cannot be stubbed. Run the
  // same steps the click handler runs — including the real preview-file IPC.
  await page.evaluate(async (file) => {
    const tab = tabs.get(activeTabId);
    tab.currentFile = file;
    tab.el('.file-path').value = file;
    updateTabButton(tab);

    const preview = await window.api.previewFile(file);
    if (preview.error) throw new Error(preview.error);

    tab.previewData = preview;
    renderPreview(tab, preview);
    tab.el('.preview-section').classList.remove('hidden');
    tab.el('.btn-clear-file').classList.remove('hidden');

    tab.outputFile = file.replace(/\.xlsx$/i, '_results.xlsx');
    tab.el('.output-path').value = tab.outputFile;
  }, SAMPLE);
  await page.waitForSelector('.tab-pane.active .preview-section:not(.hidden)', { timeout: 30000 });
  await page.waitForTimeout(800);
  await fitWindow(app, page);
  await page.screenshot({ path: shot('02-detection.png') });
  console.log('screenshots/02-detection.png');

  // ── 3. Processing screen ────────────────────────────────────────────────
  await page.evaluate(() => {
    const tab = tabs.get(activeTabId);
    showTabScreen(tab, 'processing');
    updateProgress(tab, {
      processed: 17, total: 25, percent: 68,
      active: 11, inactive: 4, na: 2, cached: 1, portalLookups: 16,
      elapsed: 108, eta: 51, speed: 6.4,
    });
    tab.el('.current-row').textContent =
      'Sr 18: Ravi Plastics — 3310100000008 (CNIC)';
    tab.el('.last-result').innerHTML =
      'Last: Sr 17 — <span class="log-info">Active</span>';
  });
  await page.evaluate(WRITE_LOG, [
    ['14:02:11', 'info', 'Reading sample-input.xlsx...'],
    ['14:02:11', 'info', 'Launching browser...'],
    ['14:02:14', 'info', 'Navigating to IRIS portal...'],
    ['14:02:21', 'info', 'Ready. Processing...'],
    ['14:02:27', 'info', '[12/25] Sr 12: 3520100000003 (CNIC)'],
    ['14:02:29', 'info', 'Captcha OCR: 481936'],
    ['14:02:34', 'info', '[13/25] Sr 13: 7777777 (NTN)'],
    ['14:02:36', 'warn', 'Captcha OCR failed, requesting manual input...'],
    ['14:02:44', 'info', '[14/25] Sr 14: 6110100000006 (CNIC)'],
    ['14:02:46', 'info', 'Captcha OCR: 205714'],
    ['14:02:52', 'info', '[15/25] Sr 15: 8888888 (NTN)'],
    ['14:02:54', 'info', 'Captcha OCR: 736820'],
    ['14:02:59', 'info', '[16/25] Sr 16: 3520100000007 (CNIC)'],
    ['14:03:01', 'info', 'NTN failed → trying CNIC'],
    ['14:03:07', 'info', '[17/25] Sr 17: 3520100000003 (CNIC)'],
    ['14:03:07', 'info', '[17/25] Sr 17: CACHED → Active'],
    ['14:03:12', 'info', 'Saved 10 results.'],
  ]);
  await fitWindow(app, page);
  await page.screenshot({ path: shot('03-processing.png') });
  console.log('screenshots/03-processing.png');

  // ── 4. Manual captcha fallback ──────────────────────────────────────────
  await page.evaluate(() => {
    // A stand-in for the portal's numeric captcha, drawn locally so no
    // third-party image ends up in the repo.
    const c = document.createElement('canvas');
    c.width = 200; c.height = 70;
    const g = c.getContext('2d');
    g.fillStyle = '#f4f4f4'; g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = '#bdbdbd'; g.lineWidth = 1;
    for (let i = 0; i < 8; i++) {
      g.beginPath();
      g.moveTo(i * 27, (i * 17) % 70);
      g.lineTo(200 - i * 19, (i * 29 + 12) % 70);
      g.stroke();
    }
    const digits = '739154';
    const angles = [-0.18, 0.12, -0.06, 0.2, -0.14, 0.08];
    g.fillStyle = '#2b2b2b';
    g.font = 'bold 34px Georgia, serif';
    for (let i = 0; i < digits.length; i++) {
      g.save();
      g.translate(22 + i * 28, 46 + ((i % 2) ? 4 : -3));
      g.rotate(angles[i]);
      g.fillText(digits[i], 0, 0);
      g.restore();
    }
    document.getElementById('captchaImage').src = c.toDataURL('image/png');
    document.getElementById('captchaOverlay').classList.remove('hidden');
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: shot('04-captcha.png') });
  console.log('screenshots/04-captcha.png');
  await page.evaluate(() => document.getElementById('captchaOverlay').classList.add('hidden'));

  // ── 5. Done screen ──────────────────────────────────────────────────────
  await page.evaluate((file) => {
    const tab = tabs.get(activeTabId);
    showTabScreen(tab, 'done');
    const set = (sel, val) => { tab.el(sel).textContent = val; };
    set('.done-active-num', 16);
    set('.done-inactive-num', 6);
    set('.done-na-num', 2);
    set('.done-cached-num', 1);
    set('.done-lookups-num', 24);
    tab.el('.done-summary-text').innerHTML = `
      Total time: <strong>2m 41s</strong><br>
      Processed: <strong>25</strong> rows<br>
      Previously completed: <strong>0</strong> rows<br>
      Output saved to: <strong>${file.replace(/\.xlsx$/i, '_results.xlsx')}</strong>
    `;
  }, SAMPLE);
  await fitWindow(app, page);
  await page.screenshot({ path: shot('05-done.png') });
  console.log('screenshots/05-done.png');

  // ── 6. Multiple files in parallel tabs ──────────────────────────────────
  await page.evaluate(() => {
    const rename = (tabId, name) => {
      const btn = document.querySelector(`.tab-btn[data-tab-id="${tabId}"] .tab-label`);
      if (btn) btn.textContent = name;
      tabs.get(tabId).customName = name;
    };
    rename(activeTabId, 'Buyers Q1');
  });

  const tabIds = {};
  for (const [name, screen] of [
    ['Suppliers Q1', 'processing'],
    ['Vendors 2024', 'setup'],
  ]) {
    await page.click('#btnAddTab');
    await page.waitForTimeout(600);
    tabIds[name] = await page.evaluate(({ name, screen }) => {
      const tab = tabs.get(activeTabId);
      tab.customName = name;
      document.querySelector(`.tab-btn[data-tab-id="${activeTabId}"] .tab-label`).textContent = name;
      if (screen === 'processing') {
        showTabScreen(tab, 'processing');
        updateProgress(tab, {
          processed: 402, total: 1180, percent: 34,
          active: 271, inactive: 108, na: 23, cached: 64, portalLookups: 338,
          elapsed: 2634, eta: 5096, speed: 6.6,
        });
        tab.el('.current-row').textContent =
          'Sr 403: Karakoram Steel Works — 6666666 (NTN)';
        tab.el('.last-result').innerHTML =
          'Last: Sr 402 — <span class="log-info">Active</span> (cached)';
      }
      return activeTabId;
    }, { name, screen });
  }

  // Land on the busy tab so the shot shows a real run, not an empty pane.
  await page.evaluate((id) => switchTab(id), tabIds['Suppliers Q1']);
  await page.waitForTimeout(300);

  await page.evaluate(WRITE_LOG, [
    ['09:41:02', 'info', 'Reading suppliers-q1.xlsx...'],
    ['09:41:03', 'info', 'Resuming: 240 rows already done, 1180 remaining'],
    ['09:41:06', 'info', 'Launching browser...'],
    ['09:41:14', 'info', 'Ready. Processing...'],
    ['10:24:51', 'info', '[400/1180] Sr 400: 3520100000009 (CNIC)'],
    ['10:24:53', 'info', 'Captcha OCR: 118472'],
    ['10:24:58', 'info', '[401/1180] Sr 401: 4230100000010 (CNIC)'],
    ['10:25:00', 'info', 'Captcha OCR: 664031'],
    ['10:25:05', 'info', '[402/1180] Sr 402: CACHED → Active'],
    ['10:25:05', 'info', 'Saved 10 results.'],
  ]);
  await fitWindow(app, page);
  await page.screenshot({ path: shot('06-multiple-tabs.png') });
  console.log('screenshots/06-multiple-tabs.png');

  await app.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
