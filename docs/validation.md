# Validation and outstanding checks

## Verified locally

- TypeScript compilation and extension bundling.
- Sixteen unit/integration tests: content extraction, URL safety, rich-text limits, encryption, destination mapping, bounded writes and recovery after ambiguous responses.
- Eight real Chrome browser tests: personal setup and saving, append reconciliation, lock/unlock across reload, a 320px link-only fallback, the packaged article extractor, empty-passphrase setup and unlocking, returning to saved workspaces, and remembering the selected workspace after reload.
- Actual desktop Firefox temporary add-on installation and nine integration checks using local Notion fixtures: background messaging, workspace setup, destination search, content script capture, rejection of privileged requests from webpage content scripts, save completion, encrypted storage, locking and decryption.
- Visual inspection of the 390px saved-article interface. No browser console errors in the main flow.

The fixture tests execute application code; only browser APIs (in Chrome UI tests) and Notion HTTP responses are substituted. The Firefox checks use actual extension APIs. No live Notion token was available, and no requests were sent to a real workspace.

## Mozilla linter

Zero errors. Two `UNSAFE_VAR_ASSIGNMENT` warnings refer to Mozilla Readability's own `innerHTML` assignments in the bundled `capture.js` (source: `node_modules/@mozilla/readability/Readability.js`). Readability only receives a detached document clone. Its extracted HTML is never inserted into the extension UI or original page. The UI uses text nodes and `textContent`. These upstream warnings are documented rather than globally suppressed; other lint errors remain failures.

## Dependency audit

The runtime dependency is Mozilla Readability. `npm audit --omit=dev` reported zero runtime vulnerabilities at delivery. Development tooling includes `web-ext` → `@devicefarmer/adbkit` → `node-forge@1.4.0`, affected by [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv). npm counts this as three high-severity entries in that development dependency chain. At build time, the current registry version of node-forge was still 1.4.0, and npm's offered automatic fix was a downgrade to an obsolete web-ext version. These packages are not bundled or shipped in the extension. Keep device debugging local and with trusted devices; review upstream fixes before publishing or by 2026-11-18, whichever comes first.

## Required before claiming Android/live parity

- Install and run on a real Android phone with Firefox 142+. No device was attached during development.
- Test live page and database saves using a personal integration token.
- Check multi-workspace permissions and revocation against real workspaces.
- Exercise Android keyboard, accessibility scaling, process termination and reconnect behavior.
- Validate capture quality across the user's actual reading sites, including lazy images, code tutorials and authenticated articles.
- Submit the unsigned package to Mozilla for unlisted signing before normal persistent installation in release Firefox. No signing credentials were available, and no upload was performed.

The existing plan's proposed public OAuth backend is intentionally replaced by a direct personal integration-token connection, following the user's confirmed “Personal use first” direction.
