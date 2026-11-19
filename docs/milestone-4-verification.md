# Milestone-four verification

Date: 18 November 2026. Status: implementation and local automated verification complete. Browser workflow checks passed; human audio review and GitHub-run CI remain outstanding. This report records actual results separately from the approved acceptance plan.

## Branch and scope

The user approved two new builders, `feat/creator` from `dev`, the planned tests, and no GitHub push. Remote inspection found milestone three merged into `origin/main` at `06f35e7`, while `origin/dev` remained at the older demo commit `74a7b01`. Local `dev` was fast-forwarded to `origin/main`, then `feat/creator` was created from local `dev`. No remote branch was changed. Before the creator PR targets GitHub `dev`, bring remote `dev` up to date with `main` through the repository's protected-branch workflow.

The implementation includes private explicit-save authoring, saved-only preview, self-review, immutable publication, withdrawal, a verified learner library, selected single-scenario sessions, provenance labels and additive migrations. It retains the original demo, existing accounts and version-pinned session history. Uploads, automatic extraction, hosted deployment and real email delivery remain outside scope.

## Verification environment

Publication tests run in an ignored source copy and uniquely named disposable Supabase project. API/database/mail ports are 55321/55322/55324; the acceptance app uses `localhost:3100`. The user's normal `would-you-peek` project and app at `127.0.0.1:3000` are separate. The app receives only public configuration, never the test administrator key. Test target guards check the exact marker, real path, run identity, ports and Docker ownership before database operations or cleanup.

`npm run test:ci` is the reproducible full pipeline. It verifies upgrade preservation before a disposable reset, then checks the clean schema, fixtures, generated types, unit/component tests, SQL permissions/transactions, Auth/Data API integration, type checking, production build and actual HTTP routes. The GitHub Actions job remains named `verify` for existing branch protection. GitHub execution will occur after the owner pushes and opens the PR; local results do not establish a remote check result.

## Results

| Check | Actual result |
| --- | --- |
| Locked clean installation | Passed in separate macOS and native Linux ARM64 workspaces. No dependencies or lockfile changes were needed. |
| Script isolation/cancellation guards | **22 passed**. Includes wrong project/host/port, missing or altered ownership, symlink escape, source exclusions, deletion-aware refresh, cleanup scope, failure propagation, SIGINT and SIGTERM. |
| Additive M3 → M4 preservation | Passed before any disposable reset. Existing logins, creator role, completed and active sessions, saved answers, immutable versions/keys and original command receipts survived. The active session continued successfully. |
| Clean migrations and canonical seed | All nine migrations applied from scratch; seed drift check passed. |
| Generated database types | Public-schema type drift check passed. |
| Unit/component tests | **565 passed in 60 files**: 274 backend and 291 frontend. |
| PostgreSQL pgTAP | **195 assertions passed across six suites**. Covers grants/RLS, owner isolation, immutable publication, rollback, review validity, withdrawal and session selection. |
| Real Auth/Data API integration | **28 passed in six files**. Includes independent-client races, normalized JS/SQL validation parity, idempotent commands, stable pagination and version-pinned sessions. |
| Production Next.js HTTP | **13 passed in two files**, including the full author → review → publish → learner → revision → withdrawal → saved-history flow. |
| TypeScript and production builds | Passed on macOS ARM64 and native Linux ARM64 using Node 24; Linux was not x86 emulation. Production HTTP ran against the macOS build. |
| Normal development database upgrade | All four additive migrations applied with `npm run db:migrate:local`. Before/after digests of existing records matched: two accounts/profiles, three demo scenarios/versions/keys, two sessions, six items, three attempts and eight command receipts. No reset or test publication touched this project. |
| Dependency audit | `npm audit --omit=dev --json` reported **zero production vulnerabilities**. Full audit reported six high-severity development-package findings through the existing picomatch/Vite/Vitest dependency chain. This milestone did not alter that dependency tree; no forced major downgrade was applied. |

The complete fresh `test:ci` pipeline passed with 563 unit/component tests. Browser acceptance then identified wording improvements (known-fact readiness guidance, current creator instructions and generic unavailable-page copy). After those changes, all 565 unit/component tests and 22 script tests passed; production HTTP, TypeScript and both platform builds were rerun successfully. SQL and shared domain behavior were unchanged by those wording fixes.

GitHub's Ubuntu `verify` job has been configured but has **not** been run on this branch by the agents. The owner must push/open the PR and wait for that protected check; a local native Linux ARM64 build does not substitute for the actual GitHub runner.

## Browser acceptance

The final production app was exercised with three synthetic accounts in the disposable project. Real YouTube embeds were used; no fixture was published into the user's normal library.

| Journey | Observed result |
| --- | --- |
| Guest authoring access | Creator URL redirected to sign-in. |
| Authoring and explicit save | Created a draft from the UI, saved incomplete work, reloaded it, then entered source/context/timestamps, two independently defensible choices and AI-assisted analysis. Short YouTube URLs canonicalized after save. |
| Validation and keyboard | Invalid `28:75` timing blocked Save and focused the Decision pause input. Keyboard activation worked for create/save, choice controls, review and publication. |
| Saved preview | Actual setup played and paused before the utility action. Both matching and different choices revealed continuation and the appropriate comparison below the video. Creator history remained empty. |
| Review and publication | Unreviewed publication stayed disabled. Synthetic checklist confirmations exercised review and published `creator-1`; edited content invalidated review while the original library version stayed live. Fresh review published `creator-2`. These synthetic attestations are test data, not editorial certification. |
| Ownership | Creator B opening creator A's private draft received the unavailable page without draft contents. |
| Learner library/session | Independent learner opened the published setup-only entry and started one scenario. Starting a different library scenario displayed an explicit current-session Resume choice. |
| Withdrawal and pinned history | After v2 publication and withdrawal, the learner resumed the already-started v1 with its original title/question, answered, reloaded the saved debrief, finished, and reopened completed history. Play again correctly refused a fresh start of withdrawn content. |
| Unavailable embed | A disposable invalid YouTube source produced an explicit playback error and Retry video control, with no decision unlocked. Retry reinitialized the player; the valid source was then restored privately. |
| Layout | Reviewed desktop and 390×844 phone layouts, including review/publication, paused learner choices, debrief and recap. Phone document width matched its client width (375 CSS pixels plus scrollbar); no horizontal page overflow was observed. |
| Final copy verification | Rebuilt/reloaded and verified known-fact requirements, current account creator instructions and neutral unavailable-page copy. |

Local screenshots are retained under ignored `test-results/milestone-4-browser/`: `published-desktop.jpg`, `review-mobile.jpg`, `learner-mobile.jpg`, `history-desktop.jpg` and `creator-final.jpg`. They document disposable test states and are intentionally excluded from GitHub staging.

The acceptance app, uniquely owned test containers/volumes and isolated build workspaces were removed after verification. Normal development services were retained, and `http://127.0.0.1:3000/api/challenges` still returned all three demo previews after the additive upgrade. Source changes remain uncommitted on `feat/creator`; environment files, build output, test workspaces and local screenshots are excluded from staging. A scan of all 266 stageable project files found no recognizable private tokens or local environment/build directories.

## Review corrections

- The test runner reconciles deleted/renamed source files on refresh rather than retaining stale routes and tests.
- SIGINT/SIGTERM cancels owned command groups and reaches cleanup; subprocess regression tests cover both signals. Captured commands wait for closed output streams.
- Browser test cookies use a separate hostname, because ports do not isolate cookies from the user's normal app.
- Supabase CLI project identifiers are kept within its 40-character limit, and missing Docker resources fail closed.
- Raw spaces and unfinished list lines typed during a save survive its response. A recovered save returning another tab's newer content now requires explicit reconciliation instead of silently adopting its revision and overwriting it.
- Publish readiness requires at least one known fact, matching the existing learner challenge contract. Incomplete drafts remain saveable.
- Production file tracing is explicitly rooted in the current project, preventing a nested verification copy from choosing the parent workspace lockfile.

## Editorial and external checks

The creator checklist is a self-attestation. Automated tests validate the review requirement and playback state machine; they cannot establish tactical correctness, a player's intent or audio spoiler quality. Visual setup/pause/continuation were observed, but **normal-speed listening and human tactical sign-off remain manual**. No video was downloaded or rehosted.

Background visibility and blocked-autoplay transitions pass simulated player/component tests. The in-app browser kept both test tabs' documents visible when another tab opened, so that attempt could not establish real hidden-tab behavior. A normal-browser background-tab/autoplay policy check remains manual. This is not recorded as a passed live-browser check.

One History navigation attempt after changing the viewport stalled without a console error. Direct navigation worked, and the same link after a subsequent publication worked normally; code review found no corresponding navigation interception. No unsupported fix was introduced for that unreproduced observation.

No code was committed or pushed, no pull request was opened, and no deployment or real email was sent by the implementation agents.
