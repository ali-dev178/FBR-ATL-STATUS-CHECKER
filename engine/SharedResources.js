const { chromium } = require('playwright');
const Tesseract = require('tesseract.js');
const { solveCaptcha } = require('./captcha');
const { navigateToPortal } = require('./portal');
const path = require('path');
const fs = require('fs');
const os = require('os');

function getUserAgent() {
  const platform = process.platform;
  if (platform === 'darwin') return 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  if (platform === 'linux') return 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
}

function getBrowserPath() {
  // In packaged app, browsers are in extraResources/browsers
  if (process.resourcesPath) {
    const packed = path.join(process.resourcesPath, 'browsers');
    if (fs.existsSync(packed)) {
      // Find the chromium directory inside
      const dirs = fs.readdirSync(packed).filter(d => d.startsWith('chromium'));
      if (dirs.length > 0) {
        return path.join(packed, dirs[0]);
      }
    }
  }
  return undefined; // use default (node_modules) in dev
}

class SharedResources {
  constructor() {
    this.browser = null;
    this.worker = null;
    this.headless = true;
    this.pages = new Map(); // tabId -> page
    this.ocrQueue = Promise.resolve();
  }

  async acquirePage(tabId, headless) {
    // Launch browser if needed
    if (!this.browser) {
      this.headless = headless;
      const execPath = getBrowserPath();
      const launchOpts = {
        headless,
        slowMo: headless ? 0 : 50,
        args: ['--disable-blink-features=AutomationControlled'],
      };
      if (execPath) launchOpts.executablePath = execPath;
      this.browser = await chromium.launch(launchOpts);
    }

    // Init Tesseract if needed
    if (!this.worker) {
      this.worker = await Tesseract.createWorker('eng');
      await this.worker.setParameters({
        tessedit_char_whitelist: '0123456789',
        tessedit_pageseg_mode: '7',
      });
    }

    const page = await this.browser.newPage({
      viewport: { width: 1400, height: 900 },
      userAgent: getUserAgent(),
    });

    this.pages.set(tabId, page);
    return page;
  }

  async releasePage(tabId) {
    const page = this.pages.get(tabId);
    if (page) {
      await page.close().catch(() => {});
      this.pages.delete(tabId);
    }
    // Cleanup everything if no more pages
    if (this.pages.size === 0) {
      await this.destroy();
    }
  }

  async solveCaptchaQueued(page) {
    return new Promise((resolve, reject) => {
      this.ocrQueue = this.ocrQueue.then(async () => {
        try {
          resolve(await solveCaptcha(page, this.worker));
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  async switchToVisible() {
    if (!this.headless) return new Map();
    this.headless = false;

    const tabIds = [...this.pages.keys()];

    // Close headless browser
    if (this.browser) await this.browser.close().catch(() => {});

    // Launch visible browser
    const execPath = getBrowserPath();
    const launchOpts = {
      headless: false,
      slowMo: 50,
      args: ['--disable-blink-features=AutomationControlled'],
    };
    if (execPath) launchOpts.executablePath = execPath;
    this.browser = await chromium.launch(launchOpts);

    // Recreate all pages and navigate to portal
    const newPages = new Map();
    for (const tabId of tabIds) {
      const page = await this.browser.newPage({
        viewport: { width: 1400, height: 900 },
        userAgent: getUserAgent(),
      });
      this.pages.set(tabId, page);
      await navigateToPortal(page);
      newPages.set(tabId, page);
    }

    return newPages; // caller updates engine page references
  }

  async destroy() {
    if (this.worker) {
      await this.worker.terminate().catch(() => {});
      this.worker = null;
    }
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
    this.pages.clear();
  }
}

module.exports = { SharedResources };
