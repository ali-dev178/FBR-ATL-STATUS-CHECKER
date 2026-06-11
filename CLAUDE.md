# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Does

Electron desktop app that bulk-checks taxpayer Active Taxpayer List (ATL) status on Pakistan's FBR IRIS portal (iris.fbr.gov.pk). Reads CNIC/NTN numbers from an Excel file, automates the portal lookup via Playwright, solves captchas with Tesseract OCR, and writes results back to Excel.

## Commands

```bash
npm start              # Launch the Electron GUI app
npm run cli            # Run the standalone CLI version (automate.js, reads Input.xlsx)
npm run dist:win       # Build Windows portable executable
npm run dist:mac       # Build macOS dmg
npm run dist:all       # Build for both platforms
```

The CLI supports `--headless` (run browser in background) and `--limit=N` (process only N rows).

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

### Key Design Decisions

- **JSZip for Excel writes**: ExcelJS corrupts formatting when writing, so `OutputWorkbook` opens the xlsx as a ZIP, modifies the raw XML to insert cell values, and saves back. This preserves all original formatting.
- **Shared browser pool**: `SharedResources` maintains at most one headless and one visible Chromium instance. Multiple tabs share these browsers via separate pages. The "Show Browser" button switches all headless tabs to visible mid-run by pausing engines, creating new pages on the visible browser, and resuming.
- **Bundled Chromium**: For packaged builds, Playwright's Chromium is copied to `resources/browsers/` as an extraResource. `main.js` and `SharedResources.js` both detect this path at runtime.
- **Captcha flow**: OCR attempt first (digits-only whitelist, up to 5 retries with refresh). If OCR fails, the engine emits `captcha-manual` which triggers a modal overlay in the renderer for manual entry.
- **Tab state persistence**: Tab configuration (file paths, column selections, headless mode) is saved to `userData/tab-state.json` and restored on app restart. Processing state is not persisted — resume works by checking which rows in the output file already have results.

### IPC Flow

Renderer calls `window.api.*` (defined in preload.js) which maps to `ipcMain.handle`/`ipcMain.on` in main.js. Engine events (`progress`, `log`, `row-start`, `row-complete`, `captcha-manual`, `done`, `error`) are batched and forwarded to the renderer via `mainWindow.webContents.send` every 2 seconds.

## Dependencies

- **playwright** — Browser automation against the IRIS portal
- **tesseract.js** — Captcha OCR (digits-only mode)
- **xlsx** — Fast Excel reading (SheetJS)
- **exceljs** — Excel reading for resume support (checking existing results)
- **jszip** — Direct xlsx XML manipulation for writing results without corrupting formatting
