# Pocket Clipper for Notion

A personal Firefox extension for Android (and desktop Firefox 142+) that saves readable articles and
bookmarks directly into your Notion pages and databases. Independently implemented; not affiliated
with Notion.

## What works

- Capture the current page with Mozilla Readability, without changing the webpage.
- Save editable headings, paragraphs, lists, links, quotes, code and external images, or save just
  the source link.
- Rename clips, switch between workspace integrations, search destinations, and reuse the last
  destination per workspace.
- Remember tokens, workspace choices and captures in local browser storage, without a separate
  clipper password.
- Persist progress before writes; resume interrupted saves without blindly repeating page creation
  or appending duplicate content.
- Open completed pages in Notion and clear local captures independently of the Notion page.

There is no hosted backend or developer-operated data service. Your own integration token
authenticates requests directly to `https://api.notion.com`. No analytics, remote scripts, automatic
webpage fetching, or browser cookie access.

## Quick start on desktop

```sh
npm ci
npm run build
```

1. Open Firefox 142 or later and navigate to `about:debugging#/runtime/this-firefox`.
2. Choose **Load Temporary Add-on** and select `dist/manifest.json`.
3. Open a webpage, then open **Pocket Clipper** from Firefox's extensions menu.
4. New installations open directly into workspace setup—no clipper passphrase is required.
5. [Create a Notion internal integration](https://app.notion.com/developers/connections) for the
   workspace, with **Read content**, **Insert content** and **Update content** capabilities.
6. In Notion, open the parent page or database you want to use, choose **••• → Connections**, and
   add that integration. It only appears in destination search after access is granted and indexed
   by Notion.
7. Paste the integration token into the extension's setup form. Allow the Notion API permission when
   Firefox asks. Do not paste the token into chat or source files.
8. Choose a destination, edit the title if needed, and save.

Temporary add-ons are removed when Firefox restarts. Use them for testing, not as the only copy of
pending captures. For persistent installation, use a Mozilla-signed build.

## Local app with your real Notion workspace

Run `npm run preview` and open `http://127.0.0.1:4173/popup.html`. This now uses the **live Notion
API**. Choose your saved connection, open **Save to**, and type a database name. Searches update as
you type. Only databases/pages shared with the selected integration can appear.

The local app routes requests through a loopback-only API bridge to work around browser cross-origin
restrictions. It forwards only the Notion operations the clipper uses, to the fixed HTTPS Notion API
origin. It rejects foreign origins and requires a per-server bridge key; tokens are not logged or
stored by the server. Connections and captures remain in local browser storage on this device,
without additional application encryption. Do not expose this development server on a public
interface.

Previously saved local connections remain available. Earlier versions of this preview accepted
tokens without authenticating them, so Notion may now reject a placeholder/invalid token. If that
happens, remove that connection in Settings and reconnect with your real internal integration token.
Authentication is checked by Notion before a new connection is saved.

In the local app, paste a **Webpage URL** and choose **Use this link** to save a bookmark. Full
article capture requires the Firefox extension, which can read the actual browser page. The local
app does not fetch arbitrary website URLs or display sample article content.

For an offline sample UI with no Notion requests, run `npm run demo` on port **4174**. Automated
browser tests use separate servers on ports 4174 and 4175, leaving the user's live app and saved
connections on 4173 untouched.

## Test on Android

Use Firefox 142+ on the phone, enable Android USB debugging and Firefox **Remote debugging via
USB**, and connect the device to this computer. Install Android Platform Tools if not already
available.

```sh
adb devices
npm run build
npx web-ext run --source-dir dist --target firefox-android --android-device DEVICE_ID --firefox-apk org.mozilla.firefox
```

Replace `DEVICE_ID` with the value printed by `adb devices`. Firefox Beta and Nightly use different
application IDs; use the ID of the browser installed on the device. On this Mac, adb is available at
`/Users/ankitsaini/Library/Android/sdk/platform-tools/adb`; add its directory to PATH or pass
`--adb-bin` with that path.

In Firefox, visit an article and open **Extensions → Pocket Clipper**. Complete setup on the phone,
choose a destination, and save. Test small-screen scrolling, the software keyboard, backgrounding
Firefox during a save, returning after a process restart, and resuming a pending clip.

[Mozilla's Android extension development instructions](https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/)
describe device configuration and debugging.

## Persistent installation and packaging

```sh
npm run package
```

This creates the unsigned extension ZIP and XPI in `artifacts/`, plus a source archive for Mozilla
reviewers. **Release and Beta Firefox require Mozilla signing.** The unsigned package is ready for
development testing and submission, not normal permanent installation.

For personal use, submit the ZIP through the
[AMO Developer Hub](https://addons.mozilla.org/developers/) and choose self-distribution /
**unlisted**. Supply `pocket-clipper-source-0.1.0.zip` if source is requested; build instructions
are `npm ci && npm run build`. Download the resulting signed XPI and follow Mozilla's current
instructions for installing self-distributed add-ons on your Firefox Android version. No public
store listing is necessary. No package has been uploaded or submitted by this project.

See
[Mozilla signing and distribution](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/).

## Remembered connections and interrupted saves

Your workspace connections, selected destination and pending captures are saved on this device and
loaded automatically when the clipper opens. There is no automatic lock or recurring passphrase
prompt. The UI state omits stored tokens, and webpage content scripts cannot invoke privileged
actions. Firefox stores the extension's data in its local extension storage; the local web app uses
browser local storage. Neither adds application-level encryption in this version.

Existing encrypted data from earlier builds is preserved. If its old passphrase was blank, it
migrates automatically. Otherwise, enter that previous passphrase **once** using **Migrate saved
connections**. After the replacement is saved, the old encrypted record is removed; future visits
need no passphrase. If you do not remember the old passphrase, use Settings to delete local data and
reconnect instead.

Each capture is persisted before its first Notion write. Pending saves can be resumed without
unlocking. Mobile OS background execution limits still apply; open the clipper and press Resume if a
save was interrupted.

If a content append times out, Resume reads the page and compares the saved content with the capture
before continuing. If content differs, it pauses rather than guessing. Avoid editing a partially
saved page until the clip is complete.

If page creation itself times out, the result may be unknown. The extension will not create a second
page automatically. Check the destination in Notion and paste the created page's URL into the
recovery form. The extension verifies the parent and existing content before attaching it. If no
page exists, remove the capture and clip again after checking Notion.

Use the **Workspace** selector in the clipping view to choose a saved connection. In **Settings**,
saved connections appear under **Your workspaces**; choose **Use [workspace name]** to return to
clipping. Your selection is remembered. Use **Add another workspace** only when connecting a new
integration. Removing a connection requires first finishing or removing its pending clips. Clearing
a local capture never deletes its Notion page. **Delete all local clipper data** removes saved
connections and captures and cannot be undone. Removing a connection or deleting local data is how
to forget saved access.

## Verification

```sh
npm run check             # TypeScript, unit/integration tests, build and Mozilla lint
npm run test:browser      # Real Chrome, 390px and 320px layouts; local fake Notion API
npm run test:firefox      # Actual Firefox add-on in a temporary profile; local fake Notion API
npm run preview          # Live local Notion app at http://127.0.0.1:4173/popup.html
npm run demo             # Offline fixture demo at http://127.0.0.1:4174/popup.html
```

Browser tests use installed Google Chrome. Firefox tests use the standard macOS Firefox path by
default; set `FIREFOX_BINARY` to override it. The local-app bridge and test fixtures are not
included in the extension package. The live local app contacts Notion; demo mode and automated tests
use fixture responses.

The included checks verify extraction, schema mapping, persistence, legacy migration, interrupted
writes, actual Firefox content-script injection and privileged-message rejection. A real Android
device and a real Notion token are still needed to validate the live end-to-end experience. See
[validation notes](docs/validation.md).

## Current boundaries

- The personal version uses internal integration tokens. Public OAuth and an accompanying service
  are outside this build.
- Only pages/databases shared with the selected integration are available; there is no import of the
  first-party Notion login session.
- Lists retain reading order but nested lists are flattened; tables are converted into readable text
  rows. Some original layout is lost. Reader extraction and site compatibility will differ from
  Notion's first-party clipper.
- Images are external URLs. Expiring, private or login-protected images may not display in Notion.
  Binary uploads, screenshots, PDFs and photo clipping are not implemented.
- The extension reads the current top-level document, including content already rendered after
  login. It does not access cross-origin frames, bypass paywalls, or load additional lazy content
  for you.
- Oversized or unextractable articles offer an explicit link-only fallback. Maximum capture: 1,500
  content blocks / 3 MB serialized content; at most 10 pending clips and 20 completed clips are
  retained.
- Database schemas are never modified. The title and first URL property are mapped from the current
  data source schema; custom property editing is not included.
- Firefox's restricted pages, browser settings pages and some protected websites do not allow
  capture.
- There is no iPhone extension in this release.

## Source layout

```text
src/content.ts          Readability extraction and Notion block conversion
src/shared.ts           Safe URLs and rich text helpers
src/notion.ts           Fixed-origin Notion API client
src/jobs.ts             Save journal, reconciliation and recovery
src/storage.ts          Automatic persistence and one-time legacy migration
src/vault.ts            Legacy encryption format for migration
src/background.ts       Browser APIs, connection management and message authorization
src/ui.ts               Mobile clipping and settings interface
public/                 Manifest, HTML, styles and icon
scripts/                Build, packaging, isolated Firefox checks and local demo
tests/                  Content, storage, API, recovery and browser tests
```

API behavior follows [Notion page creation](https://developers.notion.com/reference/post-page),
[data source search](https://developers.notion.com/reference/post-search) and
[block appends](https://developers.notion.com/reference/patch-block-children), pinned to API version
`2026-03-11`. Mozilla Readability is distributed under Apache-2.0; its license is included in the
extension package.
