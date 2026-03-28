const { EventEmitter } = require('events');
const { detectType, readInputRows } = require('./detect');
const { OutputWorkbook } = require('./excel');
const { navigateToPortal, resetForm, ensurePortalReady, verifyOne } = require('./portal');

const MAX_VERIFY_RETRIES = 3;

class AutomationEngine extends EventEmitter {
  constructor(options) {
    super();
    this.tabId = options.tabId;
    this.sharedResources = options.sharedResources;
    this.inputFile = options.inputFile;
    this.outputFile = options.outputFile || options.inputFile.replace(/\.xlsx$/i, '_results.xlsx');
    this.headless = options.headless !== false;
    this.cnicCol = options.cnicCol;
    this.atlCol = options.atlCol;

    this.page = null; // borrowed from SharedResources
    this.workbook = null;

    this.paused = false;
    this.stopped = false;
    this.resultCache = new Map();

    // Stats
    this.stats = {
      total: 0,
      processed: 0,
      active: 0,
      inactive: 0,
      na: 0,
      cached: 0,
      portalLookups: 0,
      skipped: 0,
      startTime: 0,
    };
  }

  pause() {
    this.paused = true;
    this.emit('log', { level: 'info', message: 'Pausing after current row...' });
  }

  resume() {
    this.paused = false;
    this.emit('log', { level: 'info', message: 'Resumed.' });
    this.emit('resumed');
  }

  stop() {
    this.stopped = true;
    this.emit('log', { level: 'info', message: 'Stopping after current row...' });
  }

  async _waitWhilePaused() {
    while (this.paused && !this.stopped) {
      this.emit('actually-paused');
      await new Promise(r => {
        const check = () => {
          if (!this.paused || this.stopped) return r();
          this.once('resumed', r);
        };
        check();
      });
    }
  }

  _isPageClosed(err) {
    const msg = (err && err.message) || '';
    return msg.includes('Target page, context or browser has been closed') ||
           msg.includes('has been closed') ||
           msg.includes('browser has been disconnected');
  }

  async _reconnectPage() {
    this.emit('log', { level: 'warn', message: 'Browser/page closed — switching to background mode...' });
    // Release the dead page reference
    this.sharedResources.pages.delete(this.tabId);
    this.sharedResources.tabModes.delete(this.tabId);
    this.page = null;

    // Also clean up the dead visible browser if no one else uses it
    const hasVisible = [...this.sharedResources.tabModes.values()].some(m => m === 'visible');
    if (!hasVisible && this.sharedResources.visibleBrowser) {
      await this.sharedResources.visibleBrowser.close().catch(() => {});
      this.sharedResources.visibleBrowser = null;
    }

    // Reconnect in headless (background) mode — faster and no accidental close
    this.headless = true;
    this.page = await this.sharedResources.acquirePage(this.tabId, true);
    await navigateToPortal(this.page);
    this.emit('log', { level: 'info', message: 'Reconnected in background mode — continuing...' });
  }

  _createCaptchaSolver() {
    return async (pgRef) => {
      const result = await this.sharedResources.solveCaptchaQueued(pgRef);

      if (result.solved) {
        this.emit('log', { level: 'info', message: `Captcha OCR: ${result.text}` });
        return result;
      }

      // OCR failed — ask GUI for manual solve
      this.emit('log', { level: 'warn', message: 'Captcha OCR failed, requesting manual input...' });

      return new Promise((resolve) => {
        this.emit('captcha-manual', {
          imageBase64: result.imageBase64,
          resolve: (text) => {
            resolve({ solved: true, manual: true, text });
          },
        });
      });
    };
  }

  async _verifyWithRetries(cnicNtn, primaryType) {
    for (let retry = 0; retry < MAX_VERIFY_RETRIES; retry++) {
      if (retry > 0) {
        this.emit('log', { level: 'info', message: `Retry ${retry}/${MAX_VERIFY_RETRIES - 1}` });
        await ensurePortalReady(this.page);
      }

      try {
        const captchaSolver = this._createCaptchaSolver();

        // Attempt 1: primary type
        const result1 = await verifyOne(this.page, captchaSolver, cnicNtn, primaryType);

        if (result1.success && result1.status) {
          return result1.status.filingStatus || 'Found';
        }

        const err1 = (result1.error || '').toLowerCase();
        if (err1.includes('captcha') || err1.includes('try again') || err1.includes('timeout') || result1.captchaFailed) {
          this.emit('log', { level: 'warn', message: `Transient error: ${result1.error} — retrying` });
          await resetForm(this.page);
          continue;
        }

        // Attempt 2: fallback type
        const fallbackType = primaryType === 'CNIC' ? 'NTN' : 'CNIC';
        this.emit('log', { level: 'info', message: `${primaryType} failed → trying ${fallbackType}` });

        await resetForm(this.page);
        const result2 = await verifyOne(this.page, captchaSolver, cnicNtn, fallbackType);

        if (result2.success && result2.status) {
          return result2.status.filingStatus || 'Found';
        }

        const err2 = (result2.error || '').toLowerCase();
        if (err2.includes('captcha') || err2.includes('try again') || err2.includes('timeout') || result2.captchaFailed) {
          this.emit('log', { level: 'warn', message: `Transient error on fallback: ${result2.error} — retrying` });
          await resetForm(this.page);
          continue;
        }

        // Both failed with non-transient errors
        return 'N/A';

      } catch (err) {
        // If page/browser was closed, bubble up immediately — don't retry on dead page
        if (this._isPageClosed(err)) throw err;

        this.emit('log', { level: 'error', message: `Error (attempt ${retry + 1}): ${err.message.substring(0, 150)}` });
        await this.page.locator('.swal2-confirm, .swal2-close').first().click({ timeout: 1000 }).catch(() => {});
        if (retry < MAX_VERIFY_RETRIES - 1) {
          await ensurePortalReady(this.page);
        }
      }
    }

    return 'N/A';
  }

  _updateStat(status) {
    const lower = status.toLowerCase().replace(/[^a-z]/g, ''); // "In-Active" → "inactive"
    if (lower === 'active') {
      this.stats.active++;
    } else if (status === 'N/A') {
      this.stats.na++;
    } else {
      this.stats.inactive++;
    }
  }

  _getProgress() {
    const elapsed = (Date.now() - this.stats.startTime) / 1000;
    const speed = this.stats.processed > 0 ? elapsed / this.stats.processed : 0;
    const remaining = (this.stats.total - this.stats.processed) * speed;
    return {
      ...this.stats,
      elapsed: Math.round(elapsed),
      speed: Math.round(speed * 10) / 10,
      eta: Math.round(remaining),
      percent: this.stats.total > 0 ? Math.round((this.stats.processed / this.stats.total) * 100) : 0,
    };
  }

  async start() {
    this.stopped = false;
    this.paused = false;
    this.stats.startTime = Date.now();

    try {
      // 1. Read input
      this.emit('log', { level: 'info', message: `Reading ${this.inputFile}...` });
      const { dataRows, atlCol } = readInputRows(this.inputFile, this.cnicCol, this.atlCol);

      // 2. Init output workbook
      this.workbook = new OutputWorkbook(this.inputFile, this.outputFile);
      await this.workbook.init();

      // 3. Check existing results for resume
      const existingResults = await this.workbook.getExistingResults(atlCol);

      const pendingRows = [];
      for (const row of dataRows) {
        const existing = existingResults.get(row.excelRow);
        if (existing) {
          this.resultCache.set(row.cnicNtn, existing);
          this.stats.skipped++;
        } else {
          pendingRows.push(row);
        }
      }

      this.stats.total = pendingRows.length;

      if (this.stats.skipped > 0) {
        this.emit('log', { level: 'info', message: `Resuming: ${this.stats.skipped} rows already done, ${pendingRows.length} remaining` });
      }

      if (pendingRows.length === 0) {
        this.emit('done', { ...this._getProgress(), outputFile: this.outputFile, message: 'All rows already have results.' });
        return;
      }

      this.emit('progress', this._getProgress());

      // 4. Acquire page from shared browser
      this.emit('log', { level: 'info', message: 'Launching browser...' });
      this.page = await this.sharedResources.acquirePage(this.tabId, this.headless);

      // 5. Navigate to portal
      this.emit('log', { level: 'info', message: 'Navigating to IRIS portal...' });
      await navigateToPortal(this.page);

      this.emit('log', { level: 'info', message: 'Ready. Processing...' });

      // 6. Process rows
      for (let i = 0; i < pendingRows.length; i++) {
        if (this.stopped) break;
        await this._waitWhilePaused();
        if (this.stopped) break;

        const { excelRow, srNo, buyerName, cnicNtn } = pendingRows[i];
        const primaryType = detectType(cnicNtn);

        this.emit('row-start', { index: i, total: pendingRows.length, srNo, buyerName, cnicNtn, type: primaryType });

        let atlStatus = 'N/A';

        // Check cache
        if (this.resultCache.has(cnicNtn)) {
          atlStatus = this.resultCache.get(cnicNtn);
          this.stats.cached++;
          this.emit('log', { level: 'info', message: `[${i + 1}/${pendingRows.length}] Sr ${srNo}: CACHED → ${atlStatus}` });
        } else {
          this.emit('log', { level: 'info', message: `[${i + 1}/${pendingRows.length}] Sr ${srNo}: ${cnicNtn} (${primaryType})` });

          try {
            await ensurePortalReady(this.page);
            atlStatus = await this._verifyWithRetries(cnicNtn, primaryType);
          } catch (err) {
            if (this._isPageClosed(err)) {
              await this._reconnectPage();
              // Retry this row from scratch
              i--;
              continue;
            }
            throw err;
          }
          this.stats.portalLookups++;

          this.resultCache.set(cnicNtn, atlStatus);
        }

        // Write result
        await this.workbook.writeStatus(excelRow, atlCol, atlStatus);
        this.stats.processed++;
        this._updateStat(atlStatus);

        this.emit('row-complete', { index: i, excelRow, srNo, cnicNtn, status: atlStatus, cached: this.resultCache.has(cnicNtn) });
        this.emit('progress', this._getProgress());

        // Reset form for next (if next needs portal lookup)
        if (i < pendingRows.length - 1 && !this.resultCache.has(pendingRows[i + 1]?.cnicNtn)) {
          await resetForm(this.page).catch(err => {
            if (!this._isPageClosed(err)) throw err;
            // Page closed during reset — will reconnect on next iteration
          });
        }
      }

      // Final flush
      const flushed = await this.workbook.flush();
      if (flushed > 0) {
        this.emit('log', { level: 'info', message: `Saved final ${flushed} results.` });
      }

      this.emit('done', { ...this._getProgress(), outputFile: this.outputFile });

    } catch (err) {
      this.emit('error', { message: err.message, recoverable: false });
    } finally {
      await this._cleanup();
    }
  }

  async retryNARows() {
    // Re-process rows that have N/A status
    this.emit('log', { level: 'info', message: 'Retrying N/A rows...' });

    // Clear N/A entries from cache so they get re-looked up
    for (const [key, val] of this.resultCache) {
      if (val === 'N/A') this.resultCache.delete(key);
    }

    // Reset stats for retry run
    this.stats.processed = 0;
    this.stats.active = 0;
    this.stats.inactive = 0;
    this.stats.na = 0;
    this.stats.cached = 0;
    this.stats.portalLookups = 0;
    this.stats.skipped = 0;
    this.stopped = false;
    this.paused = false;

    await this.start();
  }

  async _cleanup() {
    if (this.page) {
      await this.sharedResources.releasePage(this.tabId);
      this.page = null;
    }
  }

  async destroy() {
    this.stopped = true;
    await this._cleanup();
  }
}

module.exports = { AutomationEngine };
