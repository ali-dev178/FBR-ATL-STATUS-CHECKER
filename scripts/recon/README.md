# Portal recon scripts

Throwaway Playwright scripts for reading the IRIS portal's current markup. They
are not part of the app and nothing imports them — they exist because FBR
changes the portal from time to time, and when it does, these are the fastest
way to find out what moved.

Each one opens a visible browser and prints what it finds:

| Script | What it dumps |
|---|---|
| `portal-structure.js` | Every link, button and input on the landing page, plus a screenshot |
| `portal-selectors.js` | The selectors the app relies on, on the ATL verification form, and whether each still matches |
| `captcha.js` | The captcha element, its markup, and a saved copy of the image |

```bash
node scripts/recon/portal-structure.js
node scripts/recon/portal-selectors.js
node scripts/recon/captcha.js
```

Findings are printed to stdout as JSON; the only files they write are PNG
screenshots, into the working directory. Run them from the project root.

When a selector has moved, the fix belongs in `engine/portal.js` (form fields,
navigation, result scraping) or `engine/captcha.js` (the captcha canvas and its
refresh button). Please attach the relevant output to the issue — see the
"Portal changed" issue template.
