#!/usr/bin/env node
/**
 * Smoke checks for the parts of the app that can run without a browser or a
 * live portal: module loading, Excel column detection, and the format-safe
 * output writer.
 *
 *   npm run check
 *
 * Anything that needs the FBR portal is deliberately out of scope — those
 * paths are exercised by running the app.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SAMPLE = path.join(ROOT, 'examples', 'sample-input.xlsx');

let passed = 0;
let failed = 0;

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ok  ${name}`);
    })
    .catch((err) => {
      failed++;
      console.log(`  FAIL  ${name}`);
      console.log(`        ${err.message}`);
    });
}

(async () => {
  console.log('\nfbr-atl-checker smoke checks\n');

  // ── modules load ────────────────────────────────────────────────────────
  // preload.js is excluded — it needs Electron's contextBridge, which only
  // exists inside a renderer process.
  await test('every engine module loads', () => {
    for (const mod of ['detect', 'excel', 'portal', 'captcha', 'browserPath',
                       'SharedResources', 'AutomationEngine']) {
      require(path.join(ROOT, 'engine', `${mod}.js`));
    }
  });

  const { detectType, generatePreview, readInputRows } = require(path.join(ROOT, 'engine', 'detect'));
  const { OutputWorkbook } = require(path.join(ROOT, 'engine', 'excel'));
  const { resolveBundledChromium } = require(path.join(ROOT, 'engine', 'browserPath'));

  // ── CNIC vs NTN ─────────────────────────────────────────────────────────
  await test('detectType distinguishes CNIC from NTN', () => {
    assert.strictEqual(detectType('3520100000001'), 'CNIC', '13 digits is a CNIC');
    assert.strictEqual(detectType('1111111'), 'NTN', '7 digits is an NTN');
    assert.strictEqual(detectType('A123456'), 'NTN', 'alphanumeric is an NTN');
  });

  // ── sample workbook ─────────────────────────────────────────────────────
  await test('the sample workbook exists', () => {
    assert.ok(
      fs.existsSync(SAMPLE),
      'examples/sample-input.xlsx is missing — run: npm run sample'
    );
  });

  await test('column detection finds the right columns in the sample', async () => {
    const preview = await generatePreview(SAMPLE);
    assert.ok(!preview.error, preview.error);
    assert.strictEqual(preview.headerIdx, 2, 'header row is the third row');
    assert.strictEqual(preview.detectedCnicCol, 2, 'CNIC/NTN is column C');
    assert.strictEqual(preview.detectedAtlCol, 3, 'ATL Status is column D');
    assert.strictEqual(preview.totalRows, 25);
    assert.strictEqual(preview.duplicates, 1, 'the sample has one repeated value');
    assert.strictEqual(preview.cnicCount + preview.ntnCount, preview.totalRows);
  });

  await test('row reading starts below the header', () => {
    const { dataRows } = readInputRows(SAMPLE, 2, 3);
    assert.strictEqual(dataRows.length, 25);
    assert.strictEqual(dataRows[0].excelRow, 4, 'first data row is Excel row 4');
    assert.strictEqual(dataRows[0].srNo, 1);
    assert.ok(dataRows[0].buyerName.length > 0, 'the name column was picked up');
  });

  // ── output writer ───────────────────────────────────────────────────────
  await test('writing results leaves the input file untouched', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fbr-atl-check-'));
    const output = path.join(dir, 'out.xlsx');
    const before = fs.readFileSync(SAMPLE);

    try {
      const wb = new OutputWorkbook(SAMPLE, output);
      await wb.init();
      await wb.writeStatus(4, 3, 'Active');
      await wb.writeStatus(5, 3, 'In-Active');
      await wb.flush();

      const results = await wb.getExistingResults(3);
      assert.strictEqual(results.get(4), 'Active');
      assert.strictEqual(results.get(5), 'In-Active');
      assert.ok(!results.has(6), 'untouched rows stay empty');

      assert.ok(
        before.equals(fs.readFileSync(SAMPLE)),
        'the input workbook must never be modified'
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('resume picks up where a previous run stopped', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fbr-atl-check-'));
    const output = path.join(dir, 'out.xlsx');

    try {
      const first = new OutputWorkbook(SAMPLE, output);
      await first.init();
      await first.writeStatus(4, 3, 'Active');
      await first.flush();

      // A second run over the same output must see the earlier result.
      const second = new OutputWorkbook(SAMPLE, output);
      await second.init();
      const existing = await second.getExistingResults(3);
      assert.strictEqual(existing.get(4), 'Active');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // ── retry / resume row splitting ────────────────────────────────────────
  const { AutomationEngine, NOT_FOUND } = require(path.join(ROOT, 'engine', 'AutomationEngine'));

  const engineForSplit = () =>
    new AutomationEngine({ tabId: 0, inputFile: 'x.xlsx', outputFile: 'y.xlsx' });

  const ROWS = [
    { excelRow: 4, cnicNtn: '1111111' },
    { excelRow: 5, cnicNtn: '2222222' },
    { excelRow: 6, cnicNtn: '3333333' },
  ];

  await test('a normal run skips every row that already has a result', () => {
    const existing = new Map([[4, 'Active'], [5, NOT_FOUND]]);
    const { pendingRows, skipped } = engineForSplit()._splitRows(ROWS, existing);
    assert.strictEqual(skipped, 2);
    assert.deepStrictEqual(pendingRows.map((r) => r.excelRow), [6]);
  });

  await test('Retry N/A Rows re-queues the rows that came back not found', () => {
    // The bug this guards: "Record not exist" is written into the same column
    // as a real result, so without redoStatuses the retry finds nothing to do.
    const existing = new Map([[4, 'Active'], [5, NOT_FOUND], [6, NOT_FOUND]]);
    const engine = engineForSplit();
    const { pendingRows, skipped } = engine._splitRows(ROWS, existing, new Set([NOT_FOUND]));

    assert.strictEqual(skipped, 1, 'only the genuinely verified row is skipped');
    assert.deepStrictEqual(pendingRows.map((r) => r.excelRow), [5, 6]);
    assert.ok(
      !engine.resultCache.has('2222222'),
      'a re-queued row must not be seeded into the cache, or it would resolve to N/A again'
    );
  });

  // ── popup dismissal ─────────────────────────────────────────────────────
  // Against a stand-in for FBR's promo modal, so the mechanism is covered
  // without touching the portal. Skipped when Chromium is not installed
  // (`npx playwright install chromium`), which is the case in CI.
  const { dismissPopups } = require(path.join(ROOT, 'engine', 'portal'));

  const MODAL_PAGE = (closeButton) => `<!doctype html><meta charset="utf-8">
    <style>body { overflow: hidden; }</style>
    <body class="modal-open">
      <div class="cdk-overlay-container">
        <div class="cdk-overlay-backdrop mdb-backdrop cdk-overlay-backdrop-showing"
             style="position:fixed;inset:0;z-index:1200;background:rgba(0,0,0,.5)"></div>
        <div class="cdk-global-overlay-wrapper">
          <mdb-modal-container class="modal fade show"
               style="display:block;position:fixed;inset:0;z-index:1055">
            <div class="modal-content" style="width:600px;height:400px;margin:auto;background:#fff">
              ${closeButton}
            </div>
          </mdb-modal-container>
        </div>
      </div>
      <div id="parameterType">the verification form</div>
    </body>`;

  let browser = null;
  try {
    browser = await require('playwright').chromium.launch();
  } catch {
    console.log('  skip  popup dismissal (no Chromium — run: npx playwright install chromium)');
  }

  if (browser) {
    const openPage = async (html) => {
      const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
      await page.setContent(html);
      return page;
    };
    const state = (page) => page.evaluate(() => ({
      modals: document.querySelectorAll('mdb-modal-container').length,
      backdrops: document.querySelectorAll('.cdk-overlay-backdrop').length,
      overflow: getComputedStyle(document.body).overflow,
      formIntact: !!document.querySelector('#parameterType'),
    }));

    await test('a promo modal is closed via its own close control', async () => {
      // Behaves like the real one: closing restores scrolling.
      const page = await openPage(MODAL_PAGE(`
        <a class="pointer mainDashboardHelpDlgClose"
           onclick="document.querySelector('.cdk-overlay-container').remove();
                    document.body.style.overflow='visible'">
          <i class="fa fa-times-circle-o"></i>
        </a>`));
      try {
        assert.strictEqual(await dismissPopups(page), true, 'a popup should have been detected');
        const after = await state(page);
        assert.strictEqual(after.modals, 0, 'the modal is gone');
        assert.notStrictEqual(after.overflow, 'hidden', 'scrolling is restored');
        assert.ok(after.formIntact, 'the verification form survived');
      } finally {
        await page.close();
      }
    });

    await test('a modal with no working close control is removed anyway', async () => {
      // The scroll lock is what breaks navigation, so it must clear even when
      // there is nothing to click and Escape does nothing.
      const page = await openPage(MODAL_PAGE('<span>no close button here</span>'));
      try {
        assert.strictEqual(await dismissPopups(page), true);
        const after = await state(page);
        assert.strictEqual(after.modals, 0, 'the modal was removed');
        assert.strictEqual(after.backdrops, 0, 'the backdrop went with it');
        assert.notStrictEqual(after.overflow, 'hidden', 'the scroll lock was undone');
        assert.ok(after.formIntact, 'the verification form survived');
      } finally {
        await page.close();
      }
    });

    await test('a clean page is left alone', async () => {
      const page = await openPage('<body><div id="parameterType">form</div></body>');
      try {
        assert.strictEqual(await dismissPopups(page), false, 'nothing to dismiss');
        assert.ok((await state(page)).formIntact);
      } finally {
        await page.close();
      }
    });

    await browser.close();
  }

  // ── packaging helper ────────────────────────────────────────────────────
  await test('bundled Chromium lookup is inert outside a packaged app', () => {
    assert.strictEqual(resolveBundledChromium(), undefined);
  });

  await test('bundled Chromium lookup finds the layout Playwright installs', () => {
    // Playwright reports where its Chromium lives on this OS even when it is
    // not installed. Recreating that layout in a fake resources folder means a
    // rename in a Playwright update (macOS went from Chromium.app to Google
    // Chrome for Testing.app) fails here instead of in a packaged app.
    const expected = require('playwright').chromium.executablePath();
    const parts = expected.split(path.sep);
    const revision = parts.findLastIndex((part) => part.startsWith('chromium-'));
    assert.ok(revision >= 0, `no chromium-<revision> folder in ${expected}`);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fbr-atl-check-'));
    const exe = path.join(dir, 'browsers', ...parts.slice(revision));
    const previous = process.resourcesPath;
    try {
      fs.mkdirSync(path.dirname(exe), { recursive: true });
      fs.writeFileSync(exe, '');
      process.resourcesPath = dir;
      assert.strictEqual(resolveBundledChromium(), exe, `expected ${parts.slice(revision).join('/')}`);
    } finally {
      process.resourcesPath = previous;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
