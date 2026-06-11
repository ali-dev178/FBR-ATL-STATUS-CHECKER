const { chromium } = require('playwright');
const Tesseract = require('tesseract.js');
const { solveCaptcha } = require('./captcha');
const { navigateToPortal } = require('./portal');
const path = require('path');
const fs = require('fs');

function getUserAgent() {
  const platform = process.platform;
  if (platform === 'darwin') return 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  if (platform === 'linux') return 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
}

function getBrowserPath() {
  if (process.resourcesPath) {
    const packed = path.join(process.resourcesPath, 'browsers');
    if (fs.existsSync(packed)) {
      const dirs = fs.readdirSync(packed).filter(d => d.startsWith('chromium-'));
      if (dirs.length > 0) {
        return path.join(packed, dirs[0], 'chrome-win64', 'chrome.exe');
      }
    }
  }
  return undefined;
}

class SharedResources {
  constructor() {
    this.headlessBrowser = null;
    this.visibleBrowser = null;
    this.worker = null;
    this.pages = new Map();     // tabId -> page
    this.tabModes = new Map();  // tabId -> 'headless' | 'visible'
    this.ocrQueue = Promise.resolve();
  }

  async _getBrowser(headless) {
    if (headless) {
      if (!this.headlessBrowser) {
        const execPath = getBrowserPath();
        const opts = { headless: true, args: ['--disable-blink-features=AutomationControlled'] };
        if (execPath) opts.executablePath = execPath;
        this.headlessBrowser = await chromium.launch(opts);
      }
      return this.headlessBrowser;
    } else {
      if (!this.visibleBrowser) {
        const execPath = getBrowserPath();
        const opts = { headless: false, slowMo: 50, args: ['--disable-blink-features=AutomationControlled'] };
        if (execPath) opts.executablePath = execPath;
        this.visibleBrowser = await chromium.launch(opts);
      }
      return this.visibleBrowser;
    }
  }

  async acquirePage(tabId, headless) {
    const browser = await this._getBrowser(headless);

    // Init Tesseract if needed
    if (!this.worker) {
      this.worker = await Tesseract.createWorker('eng');
      await this.worker.setParameters({
        tessedit_char_whitelist: '0123456789',
        tessedit_pageseg_mode: '7',
      });
    }

    const page = await browser.newPage({
      viewport: { width: 1400, height: 900 },
      userAgent: getUserAgent(),
    });

    this.pages.set(tabId, page);
    this.tabModes.set(tabId, headless ? 'headless' : 'visible');
    return page;
  }

  async releasePage(tabId) {
    const page = this.pages.get(tabId);
    const mode = this.tabModes.get(tabId);
    if (page) {
      await page.close().catch(() => {});
      this.pages.delete(tabId);
      this.tabModes.delete(tabId);
    }

    // Close browser if no tabs using it
    if (mode === 'headless' && this.headlessBrowser) {
      const hasHeadless = [...this.tabModes.values()].some(m => m === 'headless');
      if (!hasHeadless) {
        await this.headlessBrowser.close().catch(() => {});
        this.headlessBrowser = null;
      }
    } else if (mode === 'visible' && this.visibleBrowser) {
      const hasVisible = [...this.tabModes.values()].some(m => m === 'visible');
      if (!hasVisible) {
        await this.visibleBrowser.close().catch(() => {});
        this.visibleBrowser = null;
      }
    }

    // Cleanup Tesseract if no pages at all
    if (this.pages.size === 0) {
      await this._destroyWorker();
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

  // Switch a specific tab from headless to visible
  async switchTabToVisible(tabId) {
    const mode = this.tabModes.get(tabId);
    if (mode !== 'headless') return null; // already visible or not found

    // Close old headless page
    const oldPage = this.pages.get(tabId);
    if (oldPage) await oldPage.close().catch(() => {});

    // Clean up headless browser if no one else uses it
    const otherHeadless = [...this.tabModes.entries()].some(([tid, m]) => tid !== tabId && m === 'headless');
    if (!otherHeadless && this.headlessBrowser) {
      await this.headlessBrowser.close().catch(() => {});
      this.headlessBrowser = null;
    }

    // Create page on visible browser
    const browser = await this._getBrowser(false);
    const page = await browser.newPage({
      viewport: { width: 1400, height: 900 },
      userAgent: getUserAgent(),
    });

    this.pages.set(tabId, page);
    this.tabModes.set(tabId, 'visible');
    await navigateToPortal(page);
    return page;
  }

  // Switch ALL headless tabs to visible (for "Show Browser" button)
  async switchAllToVisible() {
    const switched = new Map();
    const headlessTabs = [...this.tabModes.entries()].filter(([, m]) => m === 'headless').map(([tid]) => tid);

    for (const tabId of headlessTabs) {
      const page = await this.switchTabToVisible(tabId);
      if (page) switched.set(tabId, page);
    }

    return switched;
  }

  async _destroyWorker() {
    if (this.worker) {
      await this.worker.terminate().catch(() => {});
      this.worker = null;
    }
  }

  async destroy() {
    await this._destroyWorker();
    if (this.headlessBrowser) {
      await this.headlessBrowser.close().catch(() => {});
      this.headlessBrowser = null;
    }
    if (this.visibleBrowser) {
      await this.visibleBrowser.close().catch(() => {});
      this.visibleBrowser = null;
    }
    this.pages.clear();
    this.tabModes.clear();
  }
}

module.exports = { SharedResources };
