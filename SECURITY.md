# Security Policy

## Supported versions

The latest release is the only supported version. Fixes go into a new release rather than being backported.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately through [GitHub's private vulnerability reporting](https://github.com/ali-dev178/FBR-ATL-STATUS-CHECKER/security/advisories/new), or by email to **ali.dev178@gmail.com**.

Include what the issue is, how to reproduce it, and what an attacker could do with it. A proof of concept helps. You should get a first response within a week; if you do not, please chase it by email.

Once a fix is ready it ships in a release, and the advisory is published with credit to you unless you would rather stay anonymous.

## What is in scope

- Anything that lets a crafted `.xlsx` file run code, escape the sandbox or read files outside the workbook
- Weakening of the Electron process boundary — `contextIsolation`, `nodeIntegration`, the preload bridge, or anything reachable through IPC
- Exfiltration of user data. The app is meant to send your data to exactly one host — `iris.fbr.gov.pk` — and to write to the output path you chose. Anything else is a bug worth reporting.
- Supply-chain problems in how releases are built or published

## What is not in scope

- **The FBR IRIS portal itself.** Vulnerabilities in the portal belong to FBR, not to this project. Please report them to FBR directly and do not include portal exploit details in issues here.
- **Captcha OCR accuracy.** Poor recognition is a bug, not a vulnerability.
- **Unsigned builds triggering SmartScreen or Gatekeeper.** This is known and documented in the README. Code-signing certificates are not something this project currently has.
- Reports produced by running a scanner over the dependency tree without showing an exploitable path.

## Known dependency advisories

**SheetJS is not installed from npm.** The `xlsx` package on the npm registry has been abandoned at 0.18.5 and carries unfixed prototype-pollution and ReDoS advisories. Since parsing other people's spreadsheets is exactly what this app does, the dependency points at SheetJS's own distribution instead:

```json
"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"
```

That is the vendor's documented way of shipping releases. Two consequences: `npm ci` needs to reach `cdn.sheetjs.com`, and Dependabot cannot track the version — updating it is a manual edit.

**`exceljs` pulls in advisories that this app does not reach.** `npm audit` reports issues in `archiver` and its dependency chain (`glob`, `minimatch`, `rimraf`, `zip-stream`). Those are on exceljs's *writing* path, which this app never calls — output is written by `engine/excel.js` through JSZip. exceljs is used only to read existing results back for resume support. The advisories will clear when exceljs updates; a fix is not available downstream today, and the only "fix" npm offers is a major downgrade that would be worse.

## Notes for users

- Downloads should come from the [Releases page](https://github.com/ali-dev178/FBR-ATL-STATUS-CHECKER/releases) of this repository. Release binaries are built by the [release workflow](.github/workflows/release.yml) from a tagged commit, on GitHub-hosted runners.
- The app sends no telemetry and has no update mechanism, no account, and no server.
- It makes network requests to two places. Every lookup goes to the IRIS portal. Separately, the first time OCR runs on a fresh install, tesseract.js downloads its English language model (~10 MB) from the jsdelivr CDN and caches it in the app's user-data directory; no data of yours is sent with that request. Nothing else is contacted.
- Your input files, output files and tab state stay on your machine. Captcha images are written to your system temp directory during OCR.
- Output workbooks contain taxpayer identifiers. Treat them with whatever care your obligations require.
