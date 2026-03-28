const { chromium } = require('playwright');
const XLSX = require('xlsx');
const ExcelJS = require('exceljs');
const Tesseract = require('tesseract.js');
const path = require('path');
const fs = require('fs');
const readline = require('readline');

// ─── CONFIG ────────────────────────────────────────────────────────────────
const INPUT_FILE = path.join(__dirname, 'Input.xlsx');
const OUTPUT_FILE = path.join(__dirname, 'output.xlsx');
const PORTAL_URL = 'https://iris.fbr.gov.pk/';
const MAX_CAPTCHA_RETRIES = 5;
const MAX_VERIFY_RETRIES = 3;  // retry full verification on transient failures
const SAVE_EVERY = 10;

// ─── HELPERS ───────────────────────────────────────────────────────────────

function readInputRows() {
  const wb = XLSX.readFile(INPUT_FILE);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const range = XLSX.utils.decode_range(ws['!ref']);
  const startRow = range.s.r;
  const allRows = XLSX.utils.sheet_to_json(ws, { defval: '', header: 1 });

  // ── Auto-detect header row by scanning for CNIC/NTN column ──
  let headerIdx = -1;
  let cnicCol = -1;
  let atlCol = -1;
  for (let i = 0; i < allRows.length; i++) {
    const row = allRows[i];
    for (let c = 0; c < row.length; c++) {
      const val = String(row[c] || '').toLowerCase().trim();
      if (val.includes('cnic') || val.includes('ntn')) {
        headerIdx = i;
        cnicCol = c;
        break;
      }
    }
    if (headerIdx >= 0) break;
  }

  if (headerIdx < 0) {
    console.error('ERROR: Could not find CNIC/NTN column header in the file.');
    process.exit(1);
  }

  const headerRow = allRows[headerIdx];
  for (let c = 0; c < headerRow.length; c++) {
    const val = String(headerRow[c] || '').toLowerCase().trim();
    if (val.includes('atl') || val.includes('status')) {
      atlCol = c;
      break;
    }
  }

  if (atlCol < 0) {
    atlCol = headerRow.length;
    console.log(`No "ATL Status" column found — will create one at column ${atlCol + 1}`);
  }

  console.log(`Auto-detected layout:`);
  console.log(`  Header row: Excel row ${headerIdx + startRow + 1}`);
  console.log(`  CNIC/NTN column: ${String.fromCharCode(65 + cnicCol)}`);
  console.log(`  ATL Status column: ${String.fromCharCode(65 + atlCol)}`);

  const dataRows = [];
  for (let i = headerIdx + 1; i < allRows.length; i++) {
    const row = allRows[i];
    const srNo = row[0];
    const cnicNtn = String(row[cnicCol] || '').trim();
    if (!cnicNtn || (!Number.isFinite(srNo) && !/^\d+$/.test(String(srNo).trim()))) continue;
    const excelRow = i + startRow + 1;
    dataRows.push({ excelRow, srNo, buyerName: row[1], cnicNtn, row });
  }

  return { dataRows, atlCol };
}

// ─── Read existing ATL results from output.xlsx for resume support ─────────

async function getExistingResults(atlCol) {
  if (!fs.existsSync(OUTPUT_FILE)) return new Map();

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(OUTPUT_FILE);
  const ws = wb.worksheets[0];
  const existing = new Map(); // excelRow → status

  ws.eachRow((row, rowNumber) => {
    const cell = row.getCell(atlCol + 1);
    const val = cell.value;
    if (val && String(val).trim() !== '') {
      existing.set(rowNumber, String(val).trim());
    }
  });

  return existing;
}

function initOutputFile() {
  // Only clone if output.xlsx doesn't exist yet (preserve previous results for resume)
  if (!fs.existsSync(OUTPUT_FILE)) {
    fs.copyFileSync(INPUT_FILE, OUTPUT_FILE);
    console.log(`Created ${OUTPUT_FILE} from ${INPUT_FILE}`);
  } else {
    console.log(`Using existing ${OUTPUT_FILE} (resume mode)`);
  }
}

// ─── In-memory workbook: load once, flush periodically ─────────────────────

let _outputWb = null;
let _outputWs = null;
let _pendingWrites = 0;

async function loadOutputWorkbook() {
  _outputWb = new ExcelJS.Workbook();
  await _outputWb.xlsx.readFile(OUTPUT_FILE);
  _outputWs = _outputWb.worksheets[0];
}

async function writeATLStatus(excelRow, atlCol, status) {
  _outputWs.getRow(excelRow).getCell(atlCol + 1).value = status;
  _pendingWrites++;
  if (_pendingWrites >= SAVE_EVERY) {
    await flushOutput();
  }
}

async function flushOutput() {
  if (_pendingWrites > 0) {
    await _outputWb.xlsx.writeFile(OUTPUT_FILE);
    console.log(`  [Saved ${_pendingWrites} results to output.xlsx]`);
    _pendingWrites = 0;
  }
}

// ─── CNIC/NTN cache ────────────────────────────────────────────────────────

const resultCache = new Map();

function detectType(value) {
  const digitsOnly = value.replace(/[^0-9]/g, '');
  if (digitsOnly.length === 13 && /^\d{13}$/.test(value)) return 'CNIC';
  return 'NTN';
}

function promptUser(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => { rl.close(); resolve(answer.trim()); });
  });
}

// ─── CAPTCHA ───────────────────────────────────────────────────────────────

async function solveCaptcha(page, worker) {
  const captchaPath = path.join(__dirname, 'captcha_temp.png');

  for (let attempt = 0; attempt < MAX_CAPTCHA_RETRIES; attempt++) {
    const dataUrl = await page.evaluate(() => {
      const c = document.querySelector('canvas.captcha-canvas');
      return c ? c.toDataURL('image/png') : null;
    });

    if (!dataUrl) {
      console.log(`  Captcha attempt ${attempt + 1}: canvas not found`);
      await page.waitForTimeout(800);
      continue;
    }

    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
    fs.writeFileSync(captchaPath, Buffer.from(base64, 'base64'));

    const { data } = await worker.recognize(captchaPath);
    const digits = data.text.trim().replace(/[^0-9]/g, '');

    console.log(`  Captcha attempt ${attempt + 1}: OCR="${digits}"`);

    if (digits.length >= 6) return digits.substring(0, 6);
    if (digits.length >= 4) return digits;

    console.log('  Refreshing captcha...');
    await page.locator('i.fa.fa-refresh').first().click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(1000);
  }

  return null;
}

// ─── VERIFY: submit a single lookup ────────────────────────────────────────

async function verifyOne(page, worker, value, type) {
  const inputValue = value.replace(/[^0-9A-Za-z]/g, '');
  const today = new Date().toISOString().split('T')[0];

  // 1. Open Parameter Type dropdown
  await page.locator('#parameterType .select-box__current').first().click({ timeout: 5000 });
  await page.waitForTimeout(300);

  // 2. Select NTN or CNIC
  if (type === 'NTN') {
    await page.locator('#parameterType ul li label[for="1"]').click({ timeout: 3000 });
  } else {
    await page.locator('#parameterType ul li label[for="2"]').click({ timeout: 3000 });
  }
  await page.waitForTimeout(400);

  // 3. Fill Registration Number (char-by-char for Angular)
  await page.evaluate((val) => {
    const field = document.getElementById('regNo');
    if (!field) return;
    field.value = '';
    field.focus();
    for (let c = 0; c < val.length; c++) {
      field.value += val.charAt(c);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }, inputValue);
  await page.waitForTimeout(200);

  // 4. Fill Date
  await page.locator('#date').fill(today);
  await page.waitForTimeout(200);

  // 5. Solve Captcha
  const captchaText = await solveCaptcha(page, worker);
  if (captchaText) {
    const captchaInput = page.locator('.input-container input[placeholder="Enter "]').first();
    await captchaInput.click();
    await captchaInput.fill(captchaText);
    console.log(`  Captcha filled: ${captchaText}`);
  } else {
    console.log('  Auto-captcha failed. Please solve it manually in the browser.');
    await promptUser('  Press ENTER when done: ');
  }
  await page.waitForTimeout(200);

  // 6. Click VERIFY
  await page.locator('.verifyBTN button.active-btn-green').first().click({ timeout: 5000 });
  console.log(`  Clicked VERIFY (${type})...`);

  // 7. Wait for response
  await page.waitForTimeout(3000);

  // 8. Check result
  const pageState = await page.evaluate(() => {
    const result = { hasError: false, hasResult: false, errorText: '', resultText: '' };

    const swal = document.querySelector('.swal2-popup, .swal2-container');
    if (swal && swal.offsetHeight > 0) {
      result.hasError = true;
      result.errorText = swal.innerText.trim();
      return result;
    }

    const invalidFields = document.querySelectorAll('.ng-invalid.ng-touched, .is-invalid, .error');
    if (invalidFields.length > 3) {
      result.hasError = true;
      result.errorText = 'Form validation error';
      return result;
    }

    const pEls = document.querySelectorAll('.styled-table p');
    if (pEls.length > 0) {
      result.hasResult = true;
      result.resultText = [...pEls].map(p => p.textContent.trim()).join(' | ');
    }

    const backPanel = document.querySelector('.back');
    if (backPanel && backPanel.offsetHeight > 0) {
      result.hasResult = true;
      if (!result.resultText) result.resultText = backPanel.innerText.trim();
    }

    return result;
  });

  // Dismiss any popup
  await page.locator('.swal2-confirm, .swal2-close').first().click({ timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(400);

  if (pageState.hasError) {
    return { success: false, error: pageState.errorText };
  }

  if (pageState.hasResult) {
    const status = await page.evaluate(() => {
      const p = document.querySelectorAll('.styled-table p');
      if (!p || p.length === 0) return null;
      const data = {};
      if (p[0]) data.cnic = p[0].textContent.trim();
      if (p[1]) data.name = p[1].textContent.trim();
      if (p[2]) data.ntn = p[2].textContent.trim();
      if (p[3]) {
        const row = p[3];
        const b = row.querySelector('b');
        let text = b ? row.textContent.replace(b.textContent, '') : row.textContent;
        data.filingStatus = text.trim();
      }
      return data;
    });
    return { success: true, status };
  }

  return { success: false, error: 'No result found' };
}

// ─── RESET FORM ────────────────────────────────────────────────────────────

async function resetForm(page) {
  await page.locator('text=Online Verifications').first().scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(400);
  await page.locator('li.pointer >> text=Active Taxpayer List (Income Tax)').first().click().catch(() => {});
  await page.waitForTimeout(800);
}

// ─── Ensure portal page is ready (recover from crashes/nav errors) ─────────

async function ensurePortalReady(page) {
  try {
    // Check if we're still on the IRIS portal
    const url = page.url();
    if (!url.includes('iris.fbr.gov.pk')) {
      console.log('  [Recovering: navigating back to IRIS portal...]');
      await page.goto(PORTAL_URL, { waitUntil: 'networkidle', timeout: 60000 });
      await page.locator('text=Online Verifications').first().scrollIntoViewIfNeeded();
      await page.waitForTimeout(1200);
      await page.locator('li.pointer >> text=Active Taxpayer List (Income Tax)').first().click();
      await page.waitForTimeout(1200);
      return;
    }

    // Check if the form is visible
    const formVisible = await page.locator('#parameterType').isVisible({ timeout: 3000 }).catch(() => false);
    if (!formVisible) {
      console.log('  [Recovering: form not visible, re-clicking ATL tab...]');
      await page.locator('text=Online Verifications').first().scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(500);
      await page.locator('li.pointer >> text=Active Taxpayer List (Income Tax)').first().click().catch(() => {});
      await page.waitForTimeout(1000);
    }
  } catch (err) {
    console.log(`  [Recovering: full page reload... (${err.message.substring(0, 60)})]`);
    await page.goto(PORTAL_URL, { waitUntil: 'networkidle', timeout: 60000 });
    await page.locator('text=Online Verifications').first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(1200);
    await page.locator('li.pointer >> text=Active Taxpayer List (Income Tax)').first().click();
    await page.waitForTimeout(1200);
  }
}

// ─── VERIFY WITH RETRIES ──────────────────────────────────────────────────

async function verifyWithRetries(page, worker, cnicNtn, primaryType) {
  for (let retry = 0; retry < MAX_VERIFY_RETRIES; retry++) {
    if (retry > 0) {
      console.log(`  [Retry ${retry}/${MAX_VERIFY_RETRIES - 1}]`);
      await ensurePortalReady(page);
    }

    try {
      // ── Attempt 1: Try with detected type ──
      const result1 = await verifyOne(page, worker, cnicNtn, primaryType);

      if (result1.success && result1.status) {
        return result1.status.filingStatus || 'Found';
      }

      // Check if it was a captcha/transient error — retry the same type
      const err1 = (result1.error || '').toLowerCase();
      if (err1.includes('captcha') || err1.includes('try again') || err1.includes('timeout')) {
        console.log(`  Transient error: ${result1.error?.substring(0, 80)} — retrying...`);
        await resetForm(page);
        continue; // retry from top
      }

      // ── Attempt 2: Try with the other type ──
      const fallbackType = primaryType === 'CNIC' ? 'NTN' : 'CNIC';
      console.log(`  ${primaryType} failed → trying ${fallbackType}...`);

      await resetForm(page);
      const result2 = await verifyOne(page, worker, cnicNtn, fallbackType);

      if (result2.success && result2.status) {
        return result2.status.filingStatus || 'Found';
      }

      // Check if fallback was also a transient error
      const err2 = (result2.error || '').toLowerCase();
      if (err2.includes('captcha') || err2.includes('try again') || err2.includes('timeout')) {
        console.log(`  Transient error on fallback: ${result2.error?.substring(0, 80)} — retrying...`);
        await resetForm(page);
        continue; // retry from top
      }

      // Both types failed with non-transient error — no point retrying
      console.log(`  Both types failed → N/A`);
      return 'N/A';

    } catch (err) {
      console.error(`  ERROR (attempt ${retry + 1}): ${err.message.substring(0, 150)}`);
      // Dismiss any popups
      await page.locator('.swal2-confirm, .swal2-close').first().click({ timeout: 1000 }).catch(() => {});

      if (retry < MAX_VERIFY_RETRIES - 1) {
        console.log('  Recovering for retry...');
        await ensurePortalReady(page);
      }
    }
  }

  // All retries exhausted
  return 'N/A';
}

// ─── MAIN ──────────────────────────────────────────────────────────────────

(async () => {
  initOutputFile();
  const { dataRows, atlCol } = readInputRows();
  console.log(`Loaded ${dataRows.length} data rows from ${INPUT_FILE}`);

  // ── Resume: check which rows already have results in output.xlsx ──
  const existingResults = await getExistingResults(atlCol);

  // Pre-populate cache from existing results and filter out completed rows
  const pendingRows = [];
  let skippedCount = 0;
  for (const row of dataRows) {
    const existing = existingResults.get(row.excelRow);
    if (existing) {
      // Already has a result — add to cache and skip
      resultCache.set(row.cnicNtn, existing);
      skippedCount++;
    } else {
      pendingRows.push(row);
    }
  }

  if (skippedCount > 0) {
    console.log(`Resuming: ${skippedCount} rows already have results, ${pendingRows.length} remaining`);
  }

  const uniqueValues = new Set(pendingRows.map(r => r.cnicNtn));
  const cachedFromExisting = pendingRows.filter(r => resultCache.has(r.cnicNtn)).length;
  console.log(`Unique values to look up: ${uniqueValues.size - cachedFromExisting} new + ${cachedFromExisting} from previous results\n`);

  // Apply --limit to pending rows only
  const LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1]) || pendingRows.length;
  const rowsToProcess = Math.min(LIMIT, pendingRows.length);

  if (rowsToProcess === 0) {
    console.log('All rows already have results. Nothing to do.');
    process.exit(0);
  }

  console.log(`Processing ${rowsToProcess} of ${pendingRows.length} pending rows\n`);

  await loadOutputWorkbook();

  const HEADLESS = process.argv.includes('--headless');
  const browser = await chromium.launch({ headless: HEADLESS, slowMo: HEADLESS ? 0 : 50 });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

  console.log('Navigating to IRIS portal...');
  await page.goto(PORTAL_URL, { waitUntil: 'networkidle', timeout: 60000 });

  await page.locator('text=Online Verifications').first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
  await page.locator('li.pointer >> text=Active Taxpayer List (Income Tax)').first().click();
  await page.waitForTimeout(1200);

  // Init Tesseract worker once
  console.log('Initializing OCR engine...');
  const worker = await Tesseract.createWorker('eng');
  await worker.setParameters({
    tessedit_char_whitelist: '0123456789',
    tessedit_pageseg_mode: '7',
  });
  console.log('OCR ready.\n');

  const startTime = Date.now();
  let processed = 0;
  let cached = 0;
  let portalLookups = 0;

  for (let i = 0; i < rowsToProcess; i++) {
    const { excelRow, srNo, buyerName, cnicNtn } = pendingRows[i];
    const primaryType = detectType(cnicNtn);

    console.log(`━━━ [${i + 1}/${rowsToProcess}] Sr ${srNo}: ${buyerName}`);

    let atlStatus = 'N/A';

    // ── Check cache first — skip portal lookup for duplicates ──
    if (resultCache.has(cnicNtn)) {
      atlStatus = resultCache.get(cnicNtn);
      cached++;
      console.log(`  CACHED (${cnicNtn}): ${atlStatus}`);
    } else {
      console.log(`  Value: ${cnicNtn} → ${primaryType}`);

      // Ensure portal is in good state before each lookup
      await ensurePortalReady(page);

      atlStatus = await verifyWithRetries(page, worker, cnicNtn, primaryType);
      portalLookups++;

      // Store in cache
      resultCache.set(cnicNtn, atlStatus);
    }

    // ── Write ATL Status to output workbook ──
    await writeATLStatus(excelRow, atlCol, atlStatus);
    processed++;

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const avgPerRecord = (elapsed / processed).toFixed(1);
    const remaining = ((rowsToProcess - processed) * avgPerRecord).toFixed(0);
    console.log(`  → ${atlStatus}  (row ${excelRow}) [${elapsed}s elapsed, ~${remaining}s left]`);
    console.log('');

    // Reset form for next record (only if next one needs a portal lookup)
    if (i < rowsToProcess - 1 && !resultCache.has(pendingRows[i + 1]?.cnicNtn)) {
      await resetForm(page);
    }
  }

  // Final flush
  await flushOutput();

  await worker.terminate();
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n━━━ DONE ━━━`);
  console.log(`  Processed: ${processed}/${rowsToProcess}`);
  console.log(`  Portal lookups: ${portalLookups}`);
  console.log(`  From cache: ${cached}`);
  console.log(`  Previously completed: ${skippedCount}`);
  console.log(`  Total time: ${totalTime}s`);
  console.log(`  Output: ${OUTPUT_FILE}`);
  await promptUser('\nPress ENTER to close browser: ');
  await browser.close();
})();
