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

## Notes for users

- Downloads should come from the [Releases page](https://github.com/ali-dev178/FBR-ATL-STATUS-CHECKER/releases) of this repository. Release binaries are built by the [release workflow](.github/workflows/release.yml) from a tagged commit, on GitHub-hosted runners.
- The app sends no telemetry and has no update mechanism, no account, and no server.
- It makes network requests to two places. Every lookup goes to the IRIS portal. Separately, the first time OCR runs on a fresh install, tesseract.js downloads its English language model (~10 MB) from the jsdelivr CDN and caches it in the app's user-data directory; no data of yours is sent with that request. Nothing else is contacted.
- Your input files, output files and tab state stay on your machine. Captcha images are written to your system temp directory during OCR.
- Output workbooks contain taxpayer identifiers. Treat them with whatever care your obligations require.
