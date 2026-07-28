const fs = require('fs');
const path = require('path');

/**
 * Locates the Chromium that electron-builder copies into the packaged app.
 *
 * Only the full Chromium build is bundled (see `extraResources` in
 * package.json) — Playwright's separate headless-shell download is not — so
 * the launcher must be handed an explicit executablePath. Playwright would
 * otherwise go looking for a headless shell that is not there.
 *
 * The directory layout differs per platform, and macOS has both an arm64 and
 * an x64 variant, so every known location is probed rather than assumed.
 */
const CANDIDATES = {
  win32: [
    ['chrome-win64', 'chrome.exe'],
    ['chrome-win', 'chrome.exe'],
  ],
  darwin: [
    ['chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'],
    ['chrome-mac-arm64', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'],
    ['chrome-mac-x64', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'],
  ],
  linux: [
    ['chrome-linux', 'chrome'],
    ['chrome-linux64', 'chrome'],
  ],
};

/** The `browsers` folder inside a packaged app, or null when running from source. */
function bundledBrowsersDir() {
  if (!process.resourcesPath) return null;
  const dir = path.join(process.resourcesPath, 'browsers');
  return fs.existsSync(dir) ? dir : null;
}

/** Absolute path to the bundled Chromium binary, or undefined if not packaged. */
function resolveBundledChromium() {
  const root = bundledBrowsersDir();
  if (!root) return undefined;

  let revisions;
  try {
    revisions = fs.readdirSync(root).filter((d) => d.startsWith('chromium-')).sort();
  } catch {
    return undefined;
  }

  const candidates = CANDIDATES[process.platform] || CANDIDATES.linux;
  for (const revision of revisions) {
    for (const parts of candidates) {
      const exe = path.join(root, revision, ...parts);
      if (fs.existsSync(exe)) return exe;
    }
  }
  return undefined;
}

/**
 * What to pass as `executablePath`. An explicit PLAYWRIGHT_CHROMIUM_PATH wins
 * (the Electron main process sets it, and it is a useful escape hatch for the
 * CLI); otherwise fall back to the bundled binary. `undefined` means "let
 * Playwright resolve its own install", which is what happens in development.
 */
function chromiumExecutablePath() {
  return process.env.PLAYWRIGHT_CHROMIUM_PATH || resolveBundledChromium();
}

module.exports = { bundledBrowsersDir, resolveBundledChromium, chromiumExecutablePath };
