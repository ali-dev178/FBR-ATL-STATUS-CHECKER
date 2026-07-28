# AGENTS.md

This file provides guidance to coding agents working in this repository.

## What This Project Does

Electron desktop app that bulk-checks taxpayer Active Taxpayer List (ATL) status on Pakistan's FBR IRIS portal (iris.fbr.gov.pk). Reads CNIC/NTN numbers from an Excel file, automates the portal lookup via Playwright, solves captchas with Tesseract OCR, and writes results back to Excel.

## Commands

```bash
npm start              # Launch the Electron GUI app
npm run cli            # Run the standalone CLI version (automate.js, reads Input.xlsx)
npm run check          # Smoke checks — no browser or network required
npm run sample         # Rebuild examples/sample-input.xlsx
npm run icons          # Rebuild assets/icon.png + icon.ico from assets/icon.svg
npm run screenshots    # Rebuild screenshots/ by driving the real app
npm run browsers       # Download Chromium into the dir the build copies from
npm run dist:win       # Build Windows portable executable
npm run dist:mac       # Build macOS dmg
npm run dist:linux     # Build Linux AppImage
npm run dist:all       # Build for all three
```

The CLI supports `--headless` (run browser in background) and `--limit=N` (process only N rows).

There is no unit-test suite. `npm run check` is the automated safety net; everything touching the portal is verified by running the app (see CONTRIBUTING.md for what to exercise).

## Architecture

There are two modes: the **Electron GUI** (main path) and a **standalone CLI** (`automate.js`, a self-contained monolithic script that predates the modular engine).

### Electron App (main path)

```
main.js                    Electron main process — window, IPC handlers, tab lifecycle
preload.js                 Context bridge (api.* methods exposed to renderer)
renderer/
  index.html               Tab-based UI using <template> for cloning tab panes
  app.js                   All frontend logic (TabState class, IPC listeners, DOM)
  styles.css
```

### Engine (engine/)

The backend is split into focused modules, all orchestrated by `AutomationEngine`:

- **AutomationEngine.js** — EventEmitter that drives the row-processing loop. Handles pause/resume/stop, result caching, retry logic, and browser reconnection if the page closes mid-run.
- **SharedResources.js** — Singleton managing shared Playwright browser instances (headless and visible) and a single Tesseract worker across all tabs. Handles page acquisition/release and headless-to-visible switching.
- **portal.js** — FBR IRIS portal interactions: navigation, form reset, `verifyOne()` which fills the form, solves captcha, clicks verify, and scrapes the result.
- **captcha.js** — OCR loop: extracts captcha canvas as PNG, runs Tesseract, retries up to 5 times with captcha refresh. Falls back to manual input via the GUI.
- **detect.js** — Excel parsing: auto-detects header row, CNIC/NTN column, ATL status column, Sr No column, and Name column. Generates preview data for the setup screen.
- **excel.js** — `OutputWorkbook` writes ATL results by manipulating the .xlsx ZIP's sheet XML directly via JSZip. This avoids ExcelJS write corruption that strips formatting/styles. ExcelJS is only used for *reading* existing results (resume support).
- **browserPath.js** — Locates the Chromium bundled into a packaged app, probing the per-platform layouts. Returns `undefined` in development so Playwright resolves its own install.

### Supporting directories

```
scripts/                   Dev tooling, none of it shipped in the app
  check.js                 Smoke checks
  generate-sample.js       Rebuilds examples/sample-input.xlsx
  generate-icons.js        Renders assets/icon.svg to png + ico (via Playwright)
  capture-screenshots.js   Drives the real app to regenerate README screenshots
  install-bundled-chromium.js  Chromium into playwright-core/.local-browsers
  recon/                   Throwaway probes for re-reading the portal's markup
examples/sample-input.xlsx Fictional demo data (25 rows, one duplicate, title row)
assets/                    App icon — icon.svg is the source, png/ico generated
screenshots/               README images, generated
```

### Key Design Decisions

- **JSZip for Excel writes**: ExcelJS corrupts formatting when writing, so `OutputWorkbook` opens the xlsx as a ZIP, modifies the raw XML to insert cell values, and saves back. This preserves all original formatting. It copies the style index from a neighbouring cell in the same row so new cells inherit the row's borders.
- **Shared browser pool**: `SharedResources` maintains at most one headless and one visible Chromium instance. Multiple tabs share these browsers via separate pages. The "Show Browser" button switches all headless tabs to visible mid-run by pausing engines, creating new pages on the visible browser, and resuming.
- **One header-detection routine**: `readInputRows` delegates header detection to `autoDetectColumns`, so what gets processed always matches what the setup preview showed. They used to differ, and a title row above the real header caused the header row itself to be processed as data.
- **Bundled Chromium**: For packaged builds, Playwright's Chromium is copied from `node_modules/playwright-core/.local-browsers` to `resources/browsers/` as an extraResource. Only the full Chromium is bundled — not the headless shell — which is why `executablePath` must be passed explicitly rather than relying on `PLAYWRIGHT_BROWSERS_PATH` alone. `main.js` and `SharedResources.js` both resolve it through `engine/browserPath.js`.
- **Captcha flow**: OCR attempt first (digits-only whitelist, up to 5 retries with refresh). If OCR fails, the engine emits `captcha-manual` which triggers a modal overlay in the renderer for manual entry.
- **Tab state persistence**: Tab configuration (file paths, column selections, headless mode) is saved to `userData/tab-state.json` and restored on app restart. Processing state is not persisted — resume works by checking which rows in the output file already have results.

### IPC Flow

Renderer calls `window.api.*` (defined in preload.js) which maps to `ipcMain.handle`/`ipcMain.on` in main.js. Engine events (`progress`, `log`, `row-start`, `row-complete`, `captcha-manual`, `done`, `error`) are batched and forwarded to the renderer via `mainWindow.webContents.send` every 2 seconds.

Note that `window.api` is frozen by `contextBridge` and cannot be stubbed from a test harness — `scripts/capture-screenshots.js` works around this by replaying the click handler's steps instead of stubbing the file dialog.

## Working in this repo

- Never commit real CNIC/NTN numbers, names, or customer workbooks. Use `examples/sample-input.xlsx` or invent values in the same shape.
- Generated files (`screenshots/`, `assets/icon.png`, `assets/icon.ico`, `examples/sample-input.xlsx`) are committed. Regenerate and commit them when the thing they depict changes.
- Comments in the portal and Excel code mark deliberate workarounds — per-character typing to trigger Angular events, hand-written xlsx XML, multi-path Chromium probing. Check the comment before removing something that looks redundant.

## Dependencies

- **playwright** — Browser automation against the IRIS portal
- **tesseract.js** — Captcha OCR (digits-only mode)
- **xlsx** — Fast Excel reading (SheetJS)
- **exceljs** — Excel reading for resume support (checking existing results)
- **jszip** — Direct xlsx XML manipulation for writing results without corrupting formatting
