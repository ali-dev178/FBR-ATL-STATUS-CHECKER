const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

  await page.goto('https://iris.fbr.gov.pk/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);

  // Scroll to verifications
  await page.locator('text=Online Verifications').first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);

  // Click ATL Income Tax
  await page.locator('li.pointer >> text=Active Taxpayer List (Income Tax)').first().click();
  await page.waitForTimeout(1500);

  // === CHECK ALL MACRO SELECTORS ===
  const checks = await page.evaluate(() => {
    const results = {};

    // 1. Check #parameterType dropdown
    const paramType = document.getElementById('parameterType');
    results.parameterTypeExists = !!paramType;
    results.parameterTypeHTML = paramType?.outerHTML?.substring(0, 1500) || 'NOT FOUND';

    // 2. Check dropdown trigger: //*[@id="parameterType"]/div/div/p
    const dropdownP = paramType?.querySelector('div > div > p');
    results.dropdownTriggerExists = !!dropdownP;
    results.dropdownTriggerText = dropdownP?.textContent?.trim() || 'NOT FOUND';

    // 3. Check #regNo
    const regNo = document.getElementById('regNo');
    results.regNoExists = !!regNo;
    results.regNoHTML = regNo?.outerHTML || 'NOT FOUND';

    // 4. Check #date
    const dateEl = document.getElementById('date');
    results.dateExists = !!dateEl;
    results.dateHTML = dateEl?.outerHTML || 'NOT FOUND';

    // 5. Check captcha canvas
    const canvas = document.querySelector('canvas.captcha-canvas');
    results.captchaCanvasExists = !!canvas;
    results.captchaCanvasHTML = canvas?.outerHTML || 'NOT FOUND';
    // Try to get canvas content
    if (canvas) {
      try {
        const dataUrl = canvas.toDataURL('image/png');
        results.canvasDataUrlLength = dataUrl.length;
        results.canvasHasContent = dataUrl.length > 100;
      } catch (e) {
        results.canvasError = e.message;
      }
    }

    // 6. Check captcha input
    const captchaInput = document.querySelector('.input-container input[placeholder="Enter "]');
    results.captchaInputExists = !!captchaInput;
    results.captchaInputHTML = captchaInput?.outerHTML || 'NOT FOUND';

    // 7. Check verify button
    const verifyBtn1 = document.querySelector('.verifyBTN button.active-btn-green');
    const verifyBtn2 = document.querySelector('button.active-btn-green[type="submit"]');
    results.verifyBtnMacroSelector = !!verifyBtn1;
    results.verifyBtnFallbackSelector = !!verifyBtn2;
    results.verifyBtnHTML = (verifyBtn1 || verifyBtn2)?.outerHTML || 'NOT FOUND';

    // 8. Check .captcha-bg
    const captchaBg = document.querySelector('.captcha-bg');
    results.captchaBgExists = !!captchaBg;
    results.captchaBgHTML = captchaBg?.outerHTML?.substring(0, 500) || 'NOT FOUND';

    // 9. Check captcha refresh button
    const refreshIcon = document.querySelector('mat-icon');
    const allMatIcons = document.querySelectorAll('mat-icon');
    results.matIconCount = allMatIcons.length;
    results.matIconTexts = [...allMatIcons].map(i => ({ text: i.textContent.trim(), class: i.className, parent: i.parentElement?.outerHTML?.substring(0, 300) }));

    // 10. Check the captcha area parent structure
    const captchaParent = captchaBg?.parentElement;
    results.captchaParentHTML = captchaParent?.outerHTML?.substring(0, 2000) || 'NOT FOUND';

    return results;
  });

  console.log('=== SELECTOR CHECKS ===\n');
  for (const [key, val] of Object.entries(checks)) {
    if (typeof val === 'object' && !Array.isArray(val)) {
      console.log(`${key}:`, JSON.stringify(val, null, 2));
    } else if (Array.isArray(val)) {
      console.log(`${key}:`);
      val.forEach(v => console.log('  ', JSON.stringify(v)));
    } else {
      console.log(`${key}: ${val}`);
    }
  }

  // Now click the dropdown and check options
  console.log('\n=== DROPDOWN OPTIONS ===');
  try {
    const dropdownP = page.locator('#parameterType >> div >> div >> p').first();
    await dropdownP.click({ timeout: 3000 });
    await page.waitForTimeout(500);

    const options = await page.evaluate(() => {
      const paramType = document.getElementById('parameterType');
      const lis = paramType?.querySelectorAll('ul li');
      return [...(lis || [])].map((li, idx) => ({
        index: idx,
        text: li.textContent.trim(),
        labelText: li.querySelector('label')?.textContent?.trim() || '',
        labelFor: li.querySelector('label')?.getAttribute('for') || '',
        html: li.outerHTML.substring(0, 500),
      }));
    });
    options.forEach(o => console.log(JSON.stringify(o)));
  } catch (e) {
    console.log('Dropdown click failed:', e.message);
  }

  // Screenshot captcha canvas via toDataURL
  console.log('\n=== CAPTCHA CANVAS DATA ===');
  const captchaDataUrl = await page.evaluate(() => {
    const canvas = document.querySelector('canvas.captcha-canvas');
    if (!canvas) return null;
    return canvas.toDataURL('image/png');
  });

  if (captchaDataUrl) {
    const base64Data = captchaDataUrl.replace(/^data:image\/png;base64,/, '');
    fs.writeFileSync('captcha_canvas_data.png', Buffer.from(base64Data, 'base64'));
    console.log('Canvas data saved to captcha_canvas_data.png (length: ' + base64Data.length + ')');
  } else {
    console.log('Canvas toDataURL returned null');
  }

  // Also try direct element screenshot
  try {
    await page.locator('canvas.captcha-canvas').first().screenshot({ path: 'captcha_canvas_screenshot.png' });
    console.log('Direct canvas screenshot saved to captcha_canvas_screenshot.png');
  } catch (e) {
    console.log('Direct screenshot failed:', e.message);
  }

  // Also try screenshotting the .captcha-bg div
  try {
    await page.locator('.captcha-bg').first().screenshot({ path: 'captcha_bg_screenshot.png' });
    console.log('Captcha bg screenshot saved to captcha_bg_screenshot.png');
  } catch (e) {
    console.log('Captcha bg screenshot failed:', e.message);
  }

  await page.waitForTimeout(1000);
  await browser.close();
})();
