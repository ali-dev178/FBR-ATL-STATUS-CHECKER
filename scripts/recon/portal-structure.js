const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  console.log('Navigating to IRIS portal...');
  await page.goto('https://iris.fbr.gov.pk/', { waitUntil: 'networkidle', timeout: 60000 });

  // Take a screenshot of the homepage
  await page.screenshot({ path: 'screenshot_home.png', fullPage: true });
  console.log('Homepage screenshot saved.');

  // Get all visible text and links on the page
  const pageInfo = await page.evaluate(() => {
    const info = { links: [], buttons: [], inputs: [], text: [] };

    // Get all links
    document.querySelectorAll('a').forEach(a => {
      if (a.innerText.trim() || a.href) {
        info.links.push({ text: a.innerText.trim(), href: a.href, id: a.id, class: a.className });
      }
    });

    // Get all buttons
    document.querySelectorAll('button, [role="button"]').forEach(b => {
      info.buttons.push({ text: b.innerText.trim(), id: b.id, class: b.className, type: b.type });
    });

    // Get all inputs
    document.querySelectorAll('input, select, textarea').forEach(i => {
      info.inputs.push({
        tag: i.tagName, type: i.type, id: i.id, name: i.name,
        class: i.className, placeholder: i.placeholder, label: i.labels?.[0]?.innerText
      });
    });

    // Get main text content
    document.querySelectorAll('h1, h2, h3, h4, h5, h6, p, span, li, label, mat-card-title, .card-title').forEach(el => {
      const t = el.innerText.trim();
      if (t && t.length > 2 && t.length < 200) info.text.push(t);
    });

    return info;
  });

  console.log('\n=== LINKS ===');
  pageInfo.links.forEach(l => console.log(JSON.stringify(l)));

  console.log('\n=== BUTTONS ===');
  pageInfo.buttons.forEach(b => console.log(JSON.stringify(b)));

  console.log('\n=== INPUTS ===');
  pageInfo.inputs.forEach(i => console.log(JSON.stringify(i)));

  console.log('\n=== TEXT CONTENT (unique) ===');
  [...new Set(pageInfo.text)].forEach(t => console.log(t));

  // Now try to find and click "Online Verifications"
  console.log('\n=== LOOKING FOR ONLINE VERIFICATIONS ===');

  const ovLink = await page.evaluate(() => {
    const allElements = [...document.querySelectorAll('a, button, span, div, li, mat-list-item, [routerlink]')];
    const matches = allElements.filter(el =>
      el.innerText && el.innerText.toLowerCase().includes('verification')
    );
    return matches.map(m => ({
      tag: m.tagName, text: m.innerText.trim().substring(0, 100),
      id: m.id, class: m.className, href: m.href || '',
      routerLink: m.getAttribute('routerlink') || '',
      outerHTML: m.outerHTML.substring(0, 300)
    }));
  });

  console.log('Verification-related elements:');
  ovLink.forEach(el => console.log(JSON.stringify(el)));

  // Try clicking on "Online Verifications" if found
  try {
    const clickTarget = await page.locator('text=Online Verification').first();
    if (await clickTarget.isVisible({ timeout: 5000 })) {
      console.log('\nClicking Online Verifications...');
      await clickTarget.click();
      await page.waitForLoadState('networkidle', { timeout: 15000 });
      await page.waitForTimeout(3000);

      // Screenshot the verification page
      await page.screenshot({ path: 'screenshot_verification.png', fullPage: true });
      console.log('Verification page screenshot saved.');

      // Get the verification form details
      const verificationPage = await page.evaluate(() => {
        const info = { dropdowns: [], inputs: [], buttons: [], labels: [], text: [] };

        document.querySelectorAll('select, mat-select, [role="listbox"], [role="combobox"]').forEach(s => {
          info.dropdowns.push({
            tag: s.tagName, id: s.id, class: s.className,
            outerHTML: s.outerHTML.substring(0, 500),
            options: [...s.querySelectorAll('option, mat-option')].map(o => o.innerText.trim())
          });
        });

        document.querySelectorAll('input, textarea').forEach(i => {
          info.inputs.push({
            tag: i.tagName, type: i.type, id: i.id, name: i.name,
            class: i.className, placeholder: i.placeholder,
            formControlName: i.getAttribute('formcontrolname') || '',
            outerHTML: i.outerHTML.substring(0, 500)
          });
        });

        document.querySelectorAll('button').forEach(b => {
          info.buttons.push({ text: b.innerText.trim(), id: b.id, class: b.className, type: b.type });
        });

        document.querySelectorAll('label, mat-label').forEach(l => {
          info.labels.push(l.innerText.trim());
        });

        document.querySelectorAll('h1, h2, h3, h4, h5, p, span').forEach(el => {
          const t = el.innerText.trim();
          if (t && t.length > 2 && t.length < 200) info.text.push(t);
        });

        // Also get the full HTML structure of forms
        const forms = document.querySelectorAll('form, [formgroup], mat-card');
        info.formHTML = [...forms].map(f => f.outerHTML.substring(0, 2000));

        return info;
      });

      console.log('\n=== VERIFICATION PAGE - DROPDOWNS ===');
      verificationPage.dropdowns.forEach(d => console.log(JSON.stringify(d)));

      console.log('\n=== VERIFICATION PAGE - INPUTS ===');
      verificationPage.inputs.forEach(i => console.log(JSON.stringify(i)));

      console.log('\n=== VERIFICATION PAGE - BUTTONS ===');
      verificationPage.buttons.forEach(b => console.log(JSON.stringify(b)));

      console.log('\n=== VERIFICATION PAGE - LABELS ===');
      verificationPage.labels.forEach(l => console.log(l));

      console.log('\n=== VERIFICATION PAGE - TEXT ===');
      [...new Set(verificationPage.text)].slice(0, 50).forEach(t => console.log(t));

      console.log('\n=== VERIFICATION PAGE - FORM HTML ===');
      (verificationPage.formHTML || []).forEach(h => console.log(h));
    }
  } catch (e) {
    console.log('Could not find/click Online Verifications link:', e.message);
  }

  // Get the full page URL
  console.log('\nCurrent URL:', page.url());

  await browser.close();
})();
