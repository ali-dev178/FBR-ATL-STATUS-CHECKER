const { chromium } = require('playwright');

const PORTAL_URL = 'https://iris.fbr.gov.pk/';

function getUserAgent() {
  const platform = process.platform;
  if (platform === 'darwin') return 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  if (platform === 'linux') return 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
}

async function launchBrowser(headless = true) {
  const browser = await chromium.launch({
    headless,
    slowMo: headless ? 0 : 50,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = await browser.newPage({
    viewport: { width: 1400, height: 900 },
    userAgent: getUserAgent(),
  });
  return { browser, page };
}

async function navigateToPortal(page, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await page.goto(PORTAL_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      // Wait for the page to fully render
      await page.waitForTimeout(3000);
      // Wait for "Online Verifications" to appear
      await page.locator('text=Online Verifications').first().waitFor({ state: 'visible', timeout: 30000 });
      await page.locator('text=Online Verifications').first().scrollIntoViewIfNeeded();
      await page.waitForTimeout(1500);
      await page.locator('li.pointer >> text=Active Taxpayer List (Income Tax)').first().click();
      await page.waitForTimeout(1500);
      return; // success
    } catch (err) {
      if (attempt < maxRetries - 1) {
        await page.waitForTimeout(3000);
      } else {
        throw err;
      }
    }
  }
}

async function resetForm(page) {
  await page.locator('text=Online Verifications').first().scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(400);
  await page.locator('li.pointer >> text=Active Taxpayer List (Income Tax)').first().click().catch(() => {});
  await page.waitForTimeout(800);
}

async function ensurePortalReady(page) {
  try {
    const url = page.url();
    if (!url.includes('iris.fbr.gov.pk')) {
      await navigateToPortal(page);
      return;
    }

    const formVisible = await page.locator('#parameterType').isVisible({ timeout: 3000 }).catch(() => false);
    if (!formVisible) {
      await resetForm(page);
    }
  } catch (err) {
    await navigateToPortal(page);
  }
}

async function verifyOne(page, captchaSolver, value, type) {
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

  // 3. Fill Registration Number
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
  const captchaResult = await captchaSolver(page);

  if (captchaResult.solved || captchaResult.manual) {
    const text = captchaResult.text;
    const captchaInput = page.locator('.input-container input[placeholder="Enter "]').first();
    await captchaInput.click();
    await captchaInput.fill(text);
  } else {
    return { success: false, error: 'Captcha failed', captchaFailed: true };
  }
  await page.waitForTimeout(200);

  // 6. Click VERIFY
  await page.locator('.verifyBTN button.active-btn-green').first().click({ timeout: 5000 });

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
        text = text.trim();
        // Extract just the status keyword (Active, In-Active, Non-Active, etc.)
        const match = text.match(/^(In-Active|Non-Active|Active|Inactive)/i);
        data.filingStatus = match ? match[1] : text.split(/\s+Note:/i)[0].trim();
      }
      return data;
    });
    return { success: true, status };
  }

  return { success: false, error: 'No result found' };
}

module.exports = { launchBrowser, navigateToPortal, resetForm, ensurePortalReady, verifyOne, PORTAL_URL };
