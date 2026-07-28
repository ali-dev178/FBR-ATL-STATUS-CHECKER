# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Node 20 is now the minimum.** Node 18 has been end-of-life since April 2025 and current Playwright refuses to start on it.
- Electron 35 → 43, Playwright 1.58 → 1.62, electron-builder 26.8 → 26.15. Verified by running the app from source, packaging it, and launching the packaged build to confirm it still finds its bundled Chromium.
- `actions/checkout` and `actions/setup-node` moved from v4 to v7; CI now covers Node 20, 22 and 24.

## [1.0.0] — 2026-07-28

First public release.

### Added

- Tabbed Electron app for bulk ATL verification against the FBR IRIS portal
- Automatic detection of the header row, CNIC/NTN column, ATL Status column, and the serial and name columns used for progress display; the read and write columns can be corrected from a dropdown
- Captchas solved locally with Tesseract OCR — up to 5 attempts per row, refreshing the captcha between tries — falling back to a manual-entry popup only if all of them miss
- Resume support: completed rows are read back from the output workbook, so a stopped or crashed run picks up where it left off
- Duplicate cache, so a repeated CNIC/NTN costs one lookup instead of many
- Per-row retries with a CNIC ↔ NTN fallback when the portal rejects the guessed parameter type
- Format-preserving Excel output — results are written into the xlsx XML directly, leaving styles, merged cells, hidden columns and column widths intact, and the input file untouched
- Multiple files in parallel tabs, sharing one browser and one OCR worker
- Pause, resume and stop; background or visible browser mode, switchable mid-run
- Live progress with ETA, per-status counters and a timestamped activity log
- Retry N/A rows after a completed run
- Recovery from the browser being closed mid-run, by reconnecting in background mode
- Tab configuration persisted across restarts
- Standalone CLI (`automate.js`) with `--headless` and `--limit=N`
- Windows, macOS and Linux builds with Chromium bundled
- Sample workbook, smoke checks, and scripts to regenerate the icon, sample data and README screenshots

### Fixed

- **Retry N/A Rows did nothing.** After a completed run it re-read the output workbook, saw the `Record not exist` values it had just written, counted every one of those rows as already done, and immediately reported "All rows already have results" without re-checking anything. Retrying now explicitly treats that status as unfinished work.
- Row reading detected the header row differently from the setup preview, matching any row that had a cell at the read-column index. A title row above the real header was treated as the header, so the header row itself was processed as data and its label overwritten in the output. Both paths now share one detection routine.
- The bundled Chromium was located at a hard-coded Windows path (`chrome-win64/chrome.exe`), so packaged macOS and Linux builds could not find a browser. The lookup is now platform-aware.
- `extraResources` copied Chromium from `node_modules/playwright/.local-browsers`, which current Playwright versions no longer populate; builds now take it from `node_modules/playwright-core/.local-browsers`, and `npm run dist:*` downloads it there first.
- The Tesseract language model was cached into whatever directory the app happened to be launched from. It now goes to the app's user-data directory, which is always writable and is not the user's Downloads folder.
- The app window referenced an icon that did not exist in the repository.
- `package.json` declared the ISC license while the repository ships MIT.

[Unreleased]: https://github.com/ali-dev178/FBR-ATL-STATUS-CHECKER/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/ali-dev178/FBR-ATL-STATUS-CHECKER/releases/tag/v1.0.0
