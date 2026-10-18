# Mobile Notion clipper: proposed implementation plan

Status: initial plan dated 17 October 2026; personal implementation built 18 October 2026. Confirmed scope: Notion’s official Web Clipper workflow, Firefox on Android first. Android hardware and live Notion validation remain outstanding.

## Implementation update — 18 October 2026

The user approved implementation and confirmed **Personal use first**. The initial build now uses direct Notion internal integration tokens in an encrypted local vault, replacing the proposed public OAuth backend. It includes the Firefox Android manifest, mobile UI, article/link capture, workspace connections, destination search, schema-aware saves and interrupted-write recovery. Source and installation instructions are in `README.md`; verification evidence and the remaining Android/live Notion checks are in `docs/validation.md`. The original proposal below remains design context rather than a claim that all platform checks are complete.

## Scope and evidence

The working directory is empty. No source code, manifest, or installed extension was inspected. This proposal uses Notion's documented official clipper workflow as the baseline. The user confirmed Notion’s official Web Clipper as the reference. Its historical Firefox listing could not be retrieved during research; before implementation, capture the reference version and behavior where available.

Confirmed platform: Firefox on Android. Assumptions: we are building an independent Notion integration; parity means capturing editable article content with its source URL, renaming it, choosing a workspace and destination, saving, and opening the result. It does not mean copying Notion's private implementation or branding.

Notion already provides iOS and Android clipping through its app's share menu. If that existing workflow meets the need, using it avoids a separate product. A new implementation is justified if we need our own workflow, better extraction, or browser-level capture.

Sources:

- [Notion clipper workflow and mobile support](https://www.notion.com/help/web-clipper)
- [Firefox Android extension development](https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/)
- [Firefox iOS does not support add-ons](https://support.mozilla.org/en-US/kb/add-ons-firefox-ios)

## Recommended route

Start with an independently implemented Firefox Android extension. It is the closest fit to the request and can capture the current page's DOM, including content already loaded in the browser. Use a touch-friendly extension panel and retain the browser-based clipping flow.

Future expansion, outside this plan: if iPhone or support across mobile browsers is later required, add a companion app with an iOS Share Extension and an Android share receiver. Share actions provide a broadly available entry point, but cannot be assumed to expose the active page DOM or authenticated session. For Safari, evaluate JavaScript preprocessing in the share extension; a Safari Web Extension is another option if richer browser capture is required. Neither provides a Firefox iOS add-on.

Do not promise identical extraction from a URL-only share and a browser DOM capture. Label partial capture clearly and offer an explicit link-only fallback when article extraction fails.

## Feature parity contract

| Desktop capability | Mobile behavior | Completion check |
| --- | --- | --- |
| Clip current page | Firefox Android extension action | The chosen URL reaches the clipping form |
| Editable title | Prefilled title with touch-friendly editing | The edited title appears in Notion |
| Choose workspace | Select among separately authorized workspaces | No content crosses workspace boundaries |
| Find a page or database | Search accessible pages and database destinations; recent destination shortcut | Save under a page and into a database |
| Save readable content | Headings, paragraphs, lists, links, quotes, code and supported images | Representative fixtures remain editable and preserve order |
| Preserve source | Store source URL in page content and an appropriate database URL property | Source can be reopened from Notion |
| Save and open | Explicit progress, success, failure and Open in Notion states | Success is reported only after confirmed completion |

Tags, custom property editing, annotations, screenshots, photo uploads and PDF capture require separate scope decisions. Notion's help says tags are edited after clipping; they are not assumed to be part of baseline parity. Preserve arbitrary database schemas: do not silently change a user's database to make clipping work. Explain missing required properties or permissions.

## Architecture

Use TypeScript for the Firefox WebExtension, capture model, extraction pipeline and service. Keep browser APIs behind adapters so the portable parser does not depend on extension globals. A possible monorepo layout is:

    apps/firefox-extension/   Android browser entry point and clipping UI
    packages/clip-core/       Content model, sanitization, article parsing
    services/notion-gateway/  OAuth, authorized destination lookup, save jobs
    tests/fixtures/           Captured HTML and expected content structures

For a public product, use Notion OAuth with a small backend holding the client secret and encrypted credentials. Validate OAuth state, bind each authorization to the correct app user and workspace, and scope every lookup/save to that authorization. Handle current credential refresh and revocation behavior. Clients hold app session credentials rather than Notion client secrets. For a personal prototype, a user-supplied integration token is an alternative, but adds setup friction and requires an explicit secure-storage decision.

The gateway searches only authorized resources, validates destination schemas, converts captured content into supported Notion content, and writes pages in bounded batches. Keep a durable save job with a client-generated request ID and progress records. Reconcile ambiguous timeouts before retrying page creation; do not assume Notion provides an idempotency guarantee. Resume partial content writes without creating a second page.

Prefer client-provided content. A URL-fetch fallback is useful for public articles but cannot inherit the browser's login. If implemented, restrict fetches to public HTTP(S) destinations, revalidate redirects and resolved addresses, bound response sizes and timeouts, and isolate fetch workers. Never upload browser cookies. Sanitize captured HTML and avoid logging tokens or article bodies. Set a documented retention period for temporary captures.

Sources:

- [Notion authorization](https://developers.notion.com/guides/get-started/authorization)
- [Notion search](https://developers.notion.com/reference/post-search)
- [Notion request limits](https://developers.notion.com/reference/request-limits)
- [Android share receivers](https://developer.android.com/training/sharing/receive)
- [Apple share extension webpage access](https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/ExtensionScenarios.html)
- [Safari Web Extensions](https://developer.apple.com/documentation/safariservices/safari-web-extensions)

## Ordered work packages

Each row is a focused deliverable; split it further if it grows beyond a few files. Commands and dependency versions will be fixed when the project is initialized, rather than inventing commands for this empty workspace.

| Task | Depends on | Acceptance and verification |
| --- | --- | --- |
| 1. Record official clipper parity | None | Record the available official reference version and a repeatable feature checklist for Firefox Android; compare the reference workflow against this proposal |
| 2. Android capture spike | 1 | On a real Firefox Android device, invoke the extension, read title/URL/DOM, and show a usable panel; check API compatibility with web-ext lint and remote debugging |
| 3. Notion write spike | 1 | Authorize a test workspace and save one editable article under a page and into a database; verify permissions, source URL and output in Notion |
| 4. Article conversion | 2, 3 | Extract representative HTML fixtures into supported content; verify structure, unsafe markup removal, image handling and long-content batching |
| 5. Destination selection | 3 | Search authorized destinations and remember the recent choice per workspace; test inaccessible destinations and database property requirements |
| 6. Complete Android clipping flow | 4, 5 | Edit title, choose destination, save, then open the created page from a small-screen UI; verify on a real phone with keyboard and accessibility text scaling |
| 7. Durable saving | 6 | Persist queued captures before acknowledging receipt; recover after process termination, connectivity loss and rate limits; test failure injection and ambiguous create timeouts |
| 8. Android release candidate | 7 | Complete the parity matrix, API/permission audit, signing and AMO submission preparation; verify desktop behavior too if one package supports both |

Checkpoint after 1–3: establish that the reference workflow is understood and full-content clipping is technically viable. If article capture or destination permissions are insufficient, revise the parity contract before expanding the UI.

Checkpoint after 6–8: Android is complete only when the whole clipping flow passes on real devices, including recovery behavior. iPhone apps and share receivers are outside this release.

## Verification and limits

Build a fixed corpus of ordinary articles, image-heavy pages, code tutorials, long pages, non-Latin text, dynamically rendered pages and pages requiring login. Check structure and source preservation rather than pixel-identical reproduction. On protected pages, test only content the user can already view; do not attempt to bypass access restrictions.

Exercise permission denial, canceled authorization, revoked credentials, unavailable destinations, unusual database schemas, large requests, slow networks, background termination and partial Notion writes. A queued capture must be labeled queued; it is not yet saved in Notion. Retry timing is subject to mobile OS execution limits.

Exact output parity with Notion's first-party parser is unproven. Public API permissions also differ from the first-party app's access: our destination picker cannot assume access to everything visible in the user's Notion account. These are feasibility findings to resolve, not details to defer until release.

## Indicative schedule

Planning estimate, assuming one experienced engineer and baseline article clipping: 2–3 days to confirm scope and run the spikes; 1–2 weeks for the Android end-to-end beta; another 1–2 weeks for extraction coverage, recovery and release preparation. Budget roughly 4–6 weeks for an Android release candidate. These are estimates, not commitments; store review and unusually difficult sites are excluded.

## Decisions before implementation

1. Is this a personal tool or a publicly distributed product? This determines whether user-supplied credentials are acceptable or public OAuth is needed.
2. Which limitations of Notion’s existing mobile share workflow matter most? This refines priorities without changing the confirmed Firefox Android scope.
3. Record the available official reference version before freezing the parity checklist.

Recommended first milestone: from a real Firefox Android page, capture one complete article, edit its title, choose an authorized Notion destination, save it, and open the result.
