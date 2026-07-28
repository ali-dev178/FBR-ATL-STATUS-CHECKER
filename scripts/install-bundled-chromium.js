#!/usr/bin/env node
/**
 * Downloads Chromium into node_modules/playwright-core/.local-browsers so that
 * electron-builder can copy it into the packaged app (see `extraResources`).
 *
 * A plain `npx playwright install chromium` puts the browser in a shared
 * per-user cache instead, which the build cannot reach. Setting
 * PLAYWRIGHT_BROWSERS_PATH=0 is what redirects it next to the package.
 *
 * Runs automatically before every `npm run dist:*`. It is a no-op once the
 * browser is present.
 */
const { spawnSync } = require('child_process');
const path = require('path');

const cli = path.join(
  __dirname, '..', 'node_modules', 'playwright-core', 'cli.js'
);

const result = spawnSync(process.execPath, [cli, 'install', 'chromium'], {
  stdio: 'inherit',
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: '0' },
});

if (result.error) {
  console.error('Failed to run the Playwright installer:', result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
