# FBR ATL Status Checker

A desktop application that bulk-verifies **Active Taxpayer List (ATL)** status from Pakistan's Federal Board of Revenue (FBR) [IRIS portal](https://iris.fbr.gov.pk/). Feed it an Excel file with CNIC or NTN numbers and it checks each one against the portal automatically, writing the result (Active / In-Active / Record not exist) back into the spreadsheet.

Built with Electron, Playwright, and Tesseract.js.

## Features

- **Bulk processing** — process hundreds or thousands of CNIC/NTN numbers from an Excel file
- **Auto column detection** — automatically finds the CNIC/NTN column, Sr No column, Name column, and ATL Status column in your spreadsheet
- **Captcha solving** — built-in OCR (Tesseract.js) solves numeric captchas automatically; falls back to a manual input popup when OCR fails
- **Multi-tab support** — run multiple files simultaneously in separate tabs
- **Resume support** — if processing is interrupted, restart and it picks up where it left off by checking which rows already have results
- **Result caching** — duplicate CNIC/NTN values are looked up only once; subsequent rows get the cached result instantly
- **Background mode** — runs the browser headlessly for faster processing; switch to visible mode mid-run with the "Show Browser" button
- **Pause / Resume / Stop** — full control over processing at any time
- **Retry N/A rows** — after processing completes, retry any rows that returned "Record not exist"
- **Preserves Excel formatting** — writes results directly into the xlsx XML so all original formatting, styles, and formulas are preserved
- **Tab state persistence** — remembers your open tabs, file paths, and column selections between app restarts
- **Cross-platform** — works on Windows and macOS
- **CLI mode** — standalone command-line script for headless batch processing

## Screenshots

<!-- Add screenshots of your app here -->
<!-- ![Setup Screen](screenshots/setup.png) -->
<!-- ![Processing Screen](screenshots/processing.png) -->
<!-- ![Done Screen](screenshots/done.png) -->

## Prerequisites

- [Node.js](https://nodejs.org/) v18 or higher
- [Git](https://git-scm.com/) (to clone the repository)

## Installation

1. **Clone the repository**

   ```bash
   git clone https://github.com/ali-dev178/FBR-ATL-STATUS-CHECKER.git
   cd FBR-ATL-STATUS-CHECKER
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Install Playwright browsers**

   Playwright needs a Chromium binary to automate the FBR portal:

   ```bash
   npx playwright install chromium
   ```

4. **Run the app**

   ```bash
   npm start
   ```

## Usage

### GUI Mode (Electron App)

1. Launch the app with `npm start`
2. Click **Browse** and select your Excel file (`.xlsx`)
3. The app auto-detects columns. Verify or adjust:
   - **Read Column** — the column containing CNIC/NTN numbers
   - **Write Column** — where ATL status results will be written
4. Choose browser mode:
   - **Background (Faster)** — runs headlessly, no browser window shown
   - **Visible** — shows the browser so you can watch the process
5. Click **Start Processing**
6. Monitor progress with real-time stats (Active / Inactive / N/A / Cached / Portal Lookups)
7. If a captcha can't be solved automatically, a popup appears for manual entry
8. When done:
   - Click **Open Output File** to view results
   - Click **Retry N/A Rows** to re-attempt any failed lookups
   - Click **Process New File** to start over with a different file

#### Tips

- **Multiple files at once**: Click the **+** button in the tab bar to open additional tabs, each processing a different file independently
- **Rename tabs**: Double-click a tab label to rename it
- **Show Browser mid-run**: If running in Background mode, click **Show Browser** to switch to Visible mode without restarting
- **Resume after crash**: Just reopen the app and start the same file again — it detects existing results in the output file and skips completed rows
- **Output file**: By default, results are saved to `<input-filename>_results.xlsx` in the same directory. You can change the output path before starting

### CLI Mode

For batch processing without the GUI, use the standalone CLI script:

```bash
# Basic usage (opens browser window)
npm run cli

# Headless mode (no browser window)
node automate.js --headless

# Process only first N rows
node automate.js --limit=50

# Combine flags
node automate.js --headless --limit=100
```

The CLI script reads from `Input.xlsx` in the project root and writes to `output.xlsx`.

## Excel File Format

Your input Excel file should have:

- A **header row** containing a column with "CNIC" or "NTN" in the header name
- Data rows below the header with CNIC (13-digit) or NTN numbers
- Optionally, a column with "ATL" or "Status" in the header (auto-detected as the write column; created automatically if not found)
- Optionally, a Sr No column ("Sr", "Sr.", "S.No", "#", etc.) and a Name column ("Name", "Buyer", "Company", etc.)

**Example:**

| Sr | Buyer Name | CNIC/NTN | ATL Status |
|----|------------|----------|------------|
| 1 | Ali Khan | 3520112345678 | |
| 2 | ABC Corp | 1234567 | |
| 3 | XYZ Ltd | A1234567 | |

The app handles mixed CNIC and NTN values in the same column — it auto-detects the type for each row (13 digits = CNIC, anything else = NTN).

## Building Distributables

### Windows (Portable EXE)

```bash
npm run dist:win
```

Produces a portable `.exe` in the `dist/` directory. No installation required — just run the exe.

### macOS (DMG)

```bash
npm run dist:mac
```

Produces a `.dmg` installer in the `dist/` directory.

### Both Platforms

```bash
npm run dist:all
```

### Build Notes

- The build bundles Playwright's Chromium browser inside the app (as an extraResource), so end users do **not** need to install Playwright or Chromium separately.
- Windows builds produce a portable executable (no installer needed).
- macOS builds produce a standard DMG with drag-to-Applications.
- Build output goes to the `dist/` directory.
- To build a directory-only package (no installer/exe), use `npm run pack`.

## Project Structure

```
FBR-ATL-STATUS-CHECKER/
├── main.js                  # Electron main process, IPC handlers, tab lifecycle
├── preload.js               # Context bridge (renderer ↔ main)
├── automate.js              # Standalone CLI script (self-contained)
├── renderer/
│   ├── index.html           # Tab-based UI with <template> cloning
│   ├── app.js               # Frontend logic (TabState, DOM, IPC listeners)
│   └── styles.css           # Dark theme styling
├── engine/
│   ├── AutomationEngine.js  # Core processing loop (EventEmitter)
│   ├── SharedResources.js   # Shared browser pool & Tesseract worker
│   ├── portal.js            # FBR IRIS portal automation
│   ├── captcha.js           # Captcha OCR solving
│   ├── detect.js            # Excel parsing & column detection
│   └── excel.js             # Output writing via JSZip (format-safe)
├── package.json
└── README.md
```

### Architecture Overview

**Electron GUI flow:**

```
renderer/app.js  ──IPC──►  main.js  ──►  AutomationEngine
                                              │
                           ┌──────────────────┤
                           ▼                  ▼
                    SharedResources      OutputWorkbook
                     │         │              │
                     ▼         ▼              ▼
                 Playwright  Tesseract     JSZip
                 (Chromium)   (OCR)     (Excel write)
```

- **AutomationEngine** drives the row-by-row processing loop with pause/resume/stop support
- **SharedResources** manages a shared pool of Playwright browser instances and a single Tesseract OCR worker across all tabs
- **OutputWorkbook** writes results by directly manipulating the xlsx XML inside the ZIP archive (using JSZip), which preserves all original Excel formatting — ExcelJS is only used for reading

## How It Works

1. **Read Excel** — Parses the input file using SheetJS (`xlsx`), auto-detects the header row and relevant columns
2. **Launch browser** — Opens a Chromium instance via Playwright (headless or visible)
3. **Navigate to IRIS** — Goes to `https://iris.fbr.gov.pk/`, clicks "Online Verifications" → "Active Taxpayer List (Income Tax)"
4. **For each row:**
   - Check the result cache (skip portal if this CNIC/NTN was already looked up)
   - Select parameter type (CNIC or NTN)
   - Fill the registration number (character-by-character to trigger Angular events)
   - Fill today's date
   - Solve the captcha via OCR (up to 5 attempts with refresh)
   - Click VERIFY and scrape the result
   - If the primary type fails, try the fallback type (CNIC → NTN or vice versa)
   - Write the result to the output file
5. **Save results** — Flushes to disk every 10 rows and on completion

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `npm start` shows a blank window | Run `npx playwright install chromium` to install the browser |
| Captcha keeps failing | The portal may have changed its captcha format. Try Visible mode and solve manually |
| "Target page has been closed" errors | The browser was closed externally. The app auto-reconnects in background mode |
| Build fails on macOS | Ensure you have Xcode command line tools: `xcode-select --install` |
| Excel formatting is lost | Make sure you're using the latest version — the app uses JSZip-based writing to preserve formatting |
| App won't start after update | Delete the state file at `%APPDATA%/fbr-atl-checker/tab-state.json` (Windows) or `~/Library/Application Support/fbr-atl-checker/tab-state.json` (macOS) |

## Contributing

Contributions are welcome! Here's how to get started:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Test with `npm start`
5. Commit and push: `git push origin feature/my-feature`
6. Open a Pull Request

### Areas for Contribution

- **Tests** — the project currently has no test suite
- **Linux support** — build configuration and testing
- **Better captcha solving** — improved OCR preprocessing or alternative approaches
- **UI improvements** — better progress visualization, dark/light theme toggle
- **Electron auto-update** — automatic update checking and installation
- **i18n** — Urdu / other language support

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Disclaimer

This tool automates publicly available verification on the FBR IRIS portal. It is intended for legitimate business use — such as accountants, auditors, and businesses verifying the ATL status of their suppliers and buyers. Use responsibly and in accordance with FBR's terms of service. The authors are not responsible for any misuse.
