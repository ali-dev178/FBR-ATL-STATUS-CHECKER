# Contributing

Thanks for taking an interest. Bug reports, portal fixes, docs and features are all welcome.

The most valuable contribution to this project is usually the least glamorous one: **when FBR changes the IRIS portal, the selectors break.** If you notice that before anyone else, a pull request fixing `engine/portal.js` helps every user of this app immediately.

## Getting set up

Node.js 18 or newer.

```bash
git clone https://github.com/<your-username>/FBR-ATL-STATUS-CHECKER.git
cd FBR-ATL-STATUS-CHECKER

npm install
npx playwright install chromium

npm run sample     # build the demo workbook
npm run check      # smoke checks — should be all green
npm start          # run the app
```

## Before you open a pull request

**Run the smoke checks.**

```bash
npm run check
```

They cover module loading, Excel column detection and the output writer, and they run in CI on every push. They need no network access.

**Then exercise the paths that no automated check reaches.** There is no unit-test suite for anything that touches the portal, so this part is manual. Depending on what you changed:

| If you touched | Check by hand |
|---|---|
| `engine/detect.js` | Load a file with a title row above the header, one with a serial column, and one without. Confirm the Detection Summary numbers. |
| `engine/excel.js` | Process a few rows of a **formatted** workbook — borders, merged cells, hidden columns — and confirm the output opens in Excel with formatting intact and the input file unchanged. |
| `engine/portal.js` / `engine/captcha.js` | Run 10+ real rows in Visible mode and watch the form fill, the captcha solve, and the result scrape. Then run the same rows headless. |
| `engine/AutomationEngine.js` | Stop mid-run and restart the same file — completed rows must be skipped. Pause and resume. Close the visible browser mid-run and confirm it recovers. |
| `engine/SharedResources.js` | Run two tabs at once. Use **Show Browser** while both are running. |
| `renderer/` or `main.js` | Open several tabs, rename one, close one, restart the app, and confirm state was restored. |

Say in the pull request what you actually ran. "Checked 30 rows in visible mode, 30 headless, resume worked" is worth more than a green checkmark.

**Please do not** paste real CNIC or NTN numbers into issues, pull requests, screenshots or test files. Use `examples/sample-input.xlsx`, or make up values in the same shape.

## Regenerating assets

Some files in the repo are generated. If your change affects them, rebuild and commit the result:

```bash
npm run sample         # examples/sample-input.xlsx
npm run icons          # assets/icon.png, assets/icon.ico  (from assets/icon.svg)
npm run screenshots    # screenshots/*.png  (launches the app)
```

Regenerate the screenshots whenever you change the UI, so the README does not drift away from what the app looks like.

## Style

Match the file you are editing. The codebase is plain CommonJS with no build step, no transpiler and no linter — 2-space indent, semicolons, single quotes.

Comments should explain *why*, especially where the code looks odd on purpose. There is a lot of that here: typing the registration number one character at a time, writing xlsx XML by hand, probing several Chromium paths. If you find yourself removing a workaround because it looks unnecessary, check the comment first — most of them are load-bearing.

## Commits and pull requests

Short, imperative commit subjects: `fix captcha refresh selector`, not `fixed stuff`.

In the pull request, describe what changed and why, and what you tested. If it is a portal fix, mention roughly when you saw the portal change — that context is useful later.

One logical change per pull request, please. A selector fix and a UI redesign in the same branch are hard to review and harder to revert.

## Reporting bugs

Open an [issue](https://github.com/ali-dev178/FBR-ATL-STATUS-CHECKER/issues/new/choose) and include your OS, whether you are on a downloaded build or running from source, what you expected, and what happened. If it is a processing failure, the contents of the log box are the single most useful thing you can attach — with any real identifiers removed.

Security issues go through [SECURITY.md](SECURITY.md) instead, not public issues.

## Scope

This is a focused tool: bulk ATL verification from a spreadsheet. Things that fit well are more portal verifications, better file handling, better recovery and better reporting. Things that fit badly are anything that makes the app harder to install, anything that sends user data anywhere, and anything designed to evade the portal's rate limits or captcha rather than work with them.

By contributing, you agree that your contribution is licensed under the [MIT License](LICENSE).
