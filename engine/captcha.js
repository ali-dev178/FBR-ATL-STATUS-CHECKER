const path = require('path');
const fs = require('fs');
const os = require('os');

const MAX_CAPTCHA_RETRIES = 5;

async function solveCaptcha(page, worker, tempDir) {
  const captchaPath = path.join(tempDir || os.tmpdir(), 'captcha_temp.png');

  for (let attempt = 0; attempt < MAX_CAPTCHA_RETRIES; attempt++) {
    const dataUrl = await page.evaluate(() => {
      const c = document.querySelector('canvas.captcha-canvas');
      return c ? c.toDataURL('image/png') : null;
    });

    if (!dataUrl) {
      await page.waitForTimeout(800);
      continue;
    }

    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
    fs.writeFileSync(captchaPath, Buffer.from(base64, 'base64'));

    const { data } = await worker.recognize(captchaPath);
    const digits = data.text.trim().replace(/[^0-9]/g, '');

    if (digits.length >= 6) return { solved: true, text: digits.substring(0, 6), attempt: attempt + 1 };
    if (digits.length >= 4) return { solved: true, text: digits, attempt: attempt + 1 };

    // Refresh captcha and retry
    await page.locator('i.fa.fa-refresh').first().click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(1000);
  }

  // All OCR attempts failed — get the captcha image for manual solving
  const dataUrl = await page.evaluate(() => {
    const c = document.querySelector('canvas.captcha-canvas');
    return c ? c.toDataURL('image/png') : null;
  });

  return { solved: false, imageBase64: dataUrl || null };
}

module.exports = { solveCaptcha };
