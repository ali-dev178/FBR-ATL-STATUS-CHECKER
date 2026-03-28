const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

  console.log('Navigating to IRIS portal...');
  await page.goto('https://iris.fbr.gov.pk/', { waitUntil: 'networkidle', timeout: 60000 });

  // Scroll to verifications and click ATL Income Tax
  await page.locator('text=Online Verifications').first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  await page.locator('text=Active Taxpayer List (Income Tax)').first().click();
  await page.waitForTimeout(1500);

  // Select CNIC radio to activate the form
  try {
    const label = page.locator('label[for="2"]').first();
    await label.click({ timeout: 3000 });
  } catch {
    await page.evaluate(() => {
      const radio = document.querySelector('input[name="MR"][value="CNIC"]');
      if (radio) { radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true })); radio.click(); }
    });
  }
  await page.waitForTimeout(1000);

  // Find captcha-related elements
  const captchaInfo = await page.evaluate(() => {
    const info = { images: [], canvases: [], captchaElements: [] };

    // Look for images near the captcha
    document.querySelectorAll('img').forEach(img => {
      const rect = img.getBoundingClientRect();
      info.images.push({
        src: img.src.substring(0, 200),
        alt: img.alt,
        class: img.className,
        id: img.id,
        width: rect.width,
        height: rect.height,
        visible: rect.width > 0 && rect.height > 0,
        outerHTML: img.outerHTML.substring(0, 500),
      });
    });

    // Look for canvas elements (captcha often uses canvas)
    document.querySelectorAll('canvas').forEach(c => {
      const rect = c.getBoundingClientRect();
      info.canvases.push({
        id: c.id, class: c.className, width: rect.width, height: rect.height,
        outerHTML: c.outerHTML.substring(0, 500),
      });
    });

    // Look for anything with "captcha" in class/id/text
    document.querySelectorAll('[class*="captcha" i], [id*="captcha" i], [class*="Captcha" i], [id*="Captcha" i]').forEach(el => {
      const rect = el.getBoundingClientRect();
      info.captchaElements.push({
        tag: el.tagName, id: el.id, class: el.className,
        text: el.innerText?.substring(0, 200),
        width: rect.width, height: rect.height,
        outerHTML: el.outerHTML.substring(0, 800),
      });
    });

    // Also look for SVG elements (some captchas use SVG)
    info.svgCount = document.querySelectorAll('svg').length;

    // Look for the area around the captcha label
    const labels = document.querySelectorAll('label');
    labels.forEach(l => {
      if (l.innerText.toLowerCase().includes('captcha')) {
        const parent = l.closest('div');
        if (parent) {
          info.captchaParentHTML = parent.outerHTML.substring(0, 2000);
        }
      }
    });

    // Also check the Refresh button area - captcha refresh is often near the captcha image
    const refreshBtn = document.querySelector('.btn-purple.btn');
    if (refreshBtn) {
      const parent = refreshBtn.closest('div')?.parentElement;
      if (parent) {
        info.refreshAreaHTML = parent.outerHTML.substring(0, 2000);
      }
    }

    return info;
  });

  console.log('\n=== IMAGES ===');
  captchaInfo.images.filter(i => i.visible).forEach(i => console.log(JSON.stringify(i)));

  console.log('\n=== CANVASES ===');
  captchaInfo.canvases.forEach(c => console.log(JSON.stringify(c)));

  console.log('\n=== CAPTCHA ELEMENTS ===');
  captchaInfo.captchaElements.forEach(c => console.log(JSON.stringify(c)));

  console.log('\n=== SVG COUNT ===', captchaInfo.svgCount);

  console.log('\n=== CAPTCHA PARENT HTML ===');
  console.log(captchaInfo.captchaParentHTML || 'Not found');

  console.log('\n=== REFRESH AREA HTML ===');
  console.log(captchaInfo.refreshAreaHTML || 'Not found');

  // Screenshot the verification form area
  const formArea = page.locator('.col-12.col-sm-12.col-md-8.col-lg-8').first();
  if (await formArea.isVisible({ timeout: 3000 })) {
    await formArea.screenshot({ path: 'captcha_area.png' });
    console.log('\nScreenshot saved: captcha_area.png');
  }

  // Try to screenshot just the captcha area specifically
  const captchaEl = page.locator('[class*="captcha" i]').first();
  try {
    if (await captchaEl.isVisible({ timeout: 2000 })) {
      await captchaEl.screenshot({ path: 'captcha_element.png' });
      console.log('Captcha element screenshot saved: captcha_element.png');
    }
  } catch (e) {
    console.log('Could not screenshot captcha element:', e.message);
  }

  await page.waitForTimeout(2000);
  await browser.close();
})();
