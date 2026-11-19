# Would You Peek?

A Valorant decision-practice app for advanced players. Watch a professional player’s POV, make a choice at a paused moment, then watch the continuation and read conditional analysis. The demo contains three approved moments from TenZ’s ranked stream on Bind.

Matching the pro and making a defensible decision are separate outcomes. Creators can author, review and publish their own scenarios. Explanations distinguish creator-written or AI-assisted analysis; the original demo retains its AI-authored attribution. Observable facts and missing context remain separate from interpretations.

## Run locally

Install **Node.js 24.x**, npm, **FFmpeg** (including `ffprobe`), and a running **Docker Desktop** (or compatible Docker runtime). On macOS, `brew install ffmpeg` supplies the video tools; on Ubuntu, use `sudo apt-get install ffmpeg`. The Supabase CLI is pinned in the project’s development dependencies; a global installation or hosted Supabase account is unnecessary. Everything in this milestone runs locally without paid services or AI APIs.

```sh
git clone https://github.com/TranHuuPhucAn/WouldYouPeek.git
cd WouldYouPeek
npm ci
npm run db:start
npm run db:env
npm run media:setup
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). The first database start downloads local service images and applies the migrations and demo seed. `db:env` creates an ignored `.env.local` using the local API URL and public key; it never writes an administrator key into the application environment. `.env.example` documents the three settings.

In a second terminal in the same project, start the uploaded-video validator:

```sh
npm run media:worker
```

This process checks uploaded file format, size, duration and codecs using `ffprobe`. It does not identify gameplay moments or generate questions. `media:setup` writes an ignored, restricted `.env.media-worker.json` credential valid for eight hours; rerun it and restart the worker when it expires. `npm run media:check` checks local prerequisites. The web app never receives the validator credential. YouTube scenarios continue working while the validator is stopped; new uploads wait for validation.

Use **Watch demo** as a guest to view setup clips. Choose **Join the lab**, register with an email and a password of 12–128 characters including uppercase, lowercase and a number, then open the confirmation email in the [local email inbox](http://127.0.0.1:54324). These local emails are captured; no real email is sent. Password-reset and verification-resend messages use the same inbox.

After verification, start a session. Watch setup, choose an action, and submit. The answer is saved before the pro’s continuation and analysis appear. **Next scenario** advances the saved checkpoint; **Finish session** completes the final review. History retains completed sessions. Refreshing an unanswered scenario restarts setup; refreshing a saved answer restores review. Unsubmitted selections and video time are not persisted.

Under **Account**, any verified learner can enable creator access. Creators retain learner access. Open **Creator studio** to create a private draft, choose a YouTube source or an owned uploaded recording, write context, choices and analysis, and explicitly save. Incomplete drafts can be saved. Preview uses only the saved draft and does not create a learner session.

**Your videos** holds reusable uploads. Supported files are MP4 with H.264 8-bit video and AAC audio (or no audio), up to 2 GiB, two hours and 1920×1080. Each creator can reserve/store up to 10 GiB, with at most three unfinished uploads. Uploads show preparation/transfer progress and then server validation; a completed transfer is not yet a ready source. To resume after a browser reload, reselect the same file. Unsupported files are rejected without automatic conversion.

Cancelling an unfinished upload prevents it from becoming a usable recording. Storage manages cleanup of temporary upload fragments, so cancelling or expiring a partial transfer does not guarantee immediate disk-space recovery.

In the scenario editor, watch and seek through either source, then use **Set setup start**, **Set decision pause**, and **Set continuation end**, or enter precise timestamps. You choose every moment; there is no automatic extraction. Marking changes the working draft until you save. Replacing a source asks for confirmation and clears its old timing marks and media descriptions. One uploaded recording can support several scenarios without duplicating its bytes.

When the draft is complete, preview it, review the source and explanations, and record the checklist. **Publish** makes that exact reviewed content available in the verified learner **Library**. Learners can start one library scenario at a time or keep playing the three-scenario demo. If another session is active, resume it explicitly before starting a different target.

Editing a published scenario leaves its previous version available until a new reviewed version is published. Content changes invalidate the review. **Unpublish** removes the scenario from discovery and new starts; existing sessions and history retain their original version. Republishing requires another review. Creator review is self-review, not independent moderation.

If upgrading an existing local installation, preserve your accounts and scenarios by applying only the pending migrations. Restart the project’s Supabase services to enable its newly configured Storage service; stopping retains local data:

```sh
npm ci
npm run db:stop
npm run db:start
npm run db:migrate:local
npm run db:env
npm run media:setup
npm run dev
```

YouTube playback requires an internet connection. Use `127.0.0.1:3000` consistently: auth callbacks and mutation-origin checks are configured for that address. If changing the port or hostname, update `NEXT_PUBLIC_APP_URL` in `.env.local`, `auth.site_url` and `auth.additional_redirect_urls` in `supabase/config.toml`, then restart the app and local services.

Stop the web server with `Ctrl+C`; stop local services with `npm run db:stop`. Stopping preserves database volumes. Starting again restores accounts and sessions. **`npm run db:reset:local` deletes local accounts, creator content and progress**, recreates the development database and seeds the three demo scenarios. It is unnecessary for normal upgrades or verification.

To serve an optimized build locally, keep Supabase running and use:

```sh
npm run build
npm start
```

## Verify

```sh
npm ci
npm run test:ci
```

Keep Docker running. The full command creates an ignored `.wyp-test-work/<run-id>/` source copy and a uniquely named disposable Supabase project. It uses API port 55321, database 55322, inbox 55324 and an app at `http://localhost:3100`. These ports must be free. The different app hostname also isolates browser auth cookies from your development app at `127.0.0.1:3000`.

The runner first verifies additive upgrades from milestone three to four, then four to five, preserving accounts, creator drafts, review digests, published versions and saved sessions. It then resets only its disposable database, generates small original video fixtures, starts its scoped media validator, and runs seed/type drift checks, unit/component tests, PostgreSQL pgTAP tests, real Auth/Data/Storage API integration tests, type checking, a production build and actual Next.js HTTP tests. It stops its own app/validator and removes only its owned test services, volumes and workspace, including on ordinary cancellation. Your development database, video library, `.env.local` and `.next` are untouched. Failure diagnostics are stored under ignored `test-results/` when available.

`npm test` runs fast backend/frontend tests; `test:backend` and `test:frontend` select a suite. `npm run test:scripts` checks isolation, cleanup and pipeline failure handling without Docker. Database, integration and HTTP suites refuse the normal development project and hosted targets; run them through `test:ci` so publication fixtures remain isolated. Test administrator credentials are never passed to the web app.

`db:seed:generate` regenerates SQL from the canonical fixtures; `db:types` regenerates TypeScript from the local schema. Their `:check` counterparts detect drift. These scripts accept no extra remote-target arguments. Type checking generates Next.js route types and checks without the incremental cache. Builds use Webpack; development uses Turbopack.

The GitHub Actions workflow runs clean installation, migration/seed/type checks, unit/component tests, real database/integration tests, type checking and a production build for pull requests into `dev` and `main`, and pushes to those branches. GitHub execution begins when you push; local container checks are recorded separately.

## Active scenarios

All three use [WASHED GAMER PLAYS APAC RANKED](https://www.youtube.com/watch?v=_yPrykaB2nE) from the verified TenZ channel: player POV, Clove on Bind, ranked. This is the approved fallback to VCT footage. No video has been downloaded or rehosted.

| Scenario                     | Setup | Decision | Continuation end |
| ---------------------------- | ----- | -------- | ---------------- |
| `bind-clove-utility-window`  | 28:25 | 28:33    | 28:38            |
| `bind-clove-smoke-contest`   | 31:25 | 31:29.5  | 31:37            |
| `bind-clove-advantage-reset` | 31:43 | 31:53    | 32:00.5          |

The last two moments are an explicitly linked pair in the same round. The first examines utility timing, the second a low-health contest while down a player, and the third how aggression changes after gaining a 3v1 advantage. None requires a uniquely preferred answer; the successful smoke contest is still assessed as risky.

## Architecture and access

The app uses Next.js App Router, React, TypeScript, Supabase Auth, Postgres and private local Storage. Supabase SSR handles request-scoped cookies. The proxy refreshes identity; pages, services and database functions independently enforce access. Normal app requests use the caller’s session and public key. Local media setup uses the local signing secret only to mint a restricted validator credential; it stores neither the signing secret nor a service-role key. Administrator credentials used by test fixtures are excluded from the application and validator environments.

- `src/contracts/`: shared preview, account, authoring, library and saved-session contracts.
- `src/components/creator/`, `src/hooks/use-scenario-editor.ts`, `src/lib/creator/`: explicit-save editor, saved preview, review and publication controls, shared content validation and editor state.
- `src/server/creator/`, `src/app/api/creator/`: owner-scoped drafts, review records, publication and withdrawal commands.
- `src/server/video/`, `src/app/api/creator/videos/`, `src/app/api/media/playback/`: resumable upload reservations, reference-safe deletion and context-authorized playback access.
- `src/worker/media/`, `scripts/local-media-worker.mjs`: local metadata validation under a narrowly scoped credential; no publishing or learner-answer privileges.
- `src/app/library/`, `src/components/library/`, `src/server/library/`: verified-only published previews and selected-scenario starts.
- `src/server/auth/`, `src/app/(auth)/`, `src/lib/supabase/`: validation, auth actions, confirmation/recovery callbacks, verified identity and cookie refresh.
- `src/server/training/` and `src/app/api/sessions/`: canonical session reads and atomic start, answer and advance commands.
- `src/lib/client/`, `src/lib/session/`, `src/hooks/use-challenge-session.ts`: validated responses, durable checkpoint hydration, retry reconciliation and auth-change cancellation.
- `src/components/challenge/`: bounded YouTube/uploaded players, choices, advanced analysis and recap.
- `supabase/migrations/`: profiles, versioned scenarios, sessions, immutable attempts, private answer keys and command receipts, RLS and narrowly granted functions.
- `supabase/fixtures/demo-scenarios.json`: the canonical authored dataset. `scripts/render-demo-seed.mjs` generates `supabase/seed.sql`; runtime repositories read the database.
- `tests/backend/`, `tests/frontend/`, `tests/integration/`, `supabase/tests/database/`: complementary unit, component, real-service and permission/transaction tests.

Guests can read demo setup-only previews. Verified accounts can browse the library, play and read their own history. Creator enrollment affects only the current account and grants no access to others' private drafts or learner records. Private answer keys cannot be read directly through the public Data API. Session and authoring functions use separate restricted non-login roles that do not own application tables or bypass row-level security. A trigger-only role synchronizes trusted email confirmation into a protected profile column; runtime roles need no direct auth-table access.

Each session pins immutable scenario versions. Answers and review checkpoints commit together. One account has at most one active session. Commands carry a request UUID and expected revision; retrying an identical command returns the current canonical snapshot of its original session, even after completion. Reusing the UUID with different input fails. Losing a response or encountering a stale tab triggers reconciliation rather than another attempt.

## API

| Endpoint                                               | Access and result                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `GET /api/challenges`                                  | Public setup-only preview catalogue.                                            |
| `GET /api/challenges/[id]`                             | Public preview; no question, choices, feedback or reveal interval.              |
| `POST /api/challenges/[id]/answer`                     | Retired: guests receive 401; signed-in callers receive 409 `SESSION_REQUIRED`.  |
| `GET /api/account`                                     | Current account and capabilities.                                               |
| `POST /api/account/creator`                            | Verified self-enrollment; empty JSON object.                                    |
| `GET /api/creator/scenarios?status=all&cursor=...`      | Verified creator's own draft/publication summaries.                            |
| `POST /api/creator/scenarios`                         | `{ requestId }`; create a private draft.                                       |
| `GET /api/creator/scenarios/[id]`                     | Owner's current saved draft and publication state.                             |
| `PUT /api/creator/scenarios/[id]`                     | `{ requestId, expectedRevision, content }`; explicitly save a bounded draft.   |
| `GET /api/creator/scenarios/[id]/review?revision=...`  | Owner-only preview of the exact saved revision.                                |
| `POST /api/creator/scenarios/[id]/review`             | `{ requestId, expectedRevision, checklist }`; record self-review.              |
| `POST /api/creator/scenarios/[id]/publish`            | `{ requestId, expectedRevision, reviewId }`; publish atomically.               |
| `POST /api/creator/scenarios/[id]/unpublish`          | `{ requestId, expectedRevision }`; delist new starts.                          |
| `GET /api/creator/videos`                            | Owner's reusable uploads, limits and validator availability.                 |
| `POST /api/creator/videos`                           | Reserve an owned upload with a request UUID and file identity.                |
| `GET /api/creator/videos/requests/[requestId]`        | Reconcile an interrupted upload reservation.                                 |
| `GET /api/creator/videos/[id]`                       | Owner's upload, validation and deletion state.                               |
| `POST /api/creator/videos/[id]/upload-session`       | Obtain/resume the same immutable Storage upload destination.                 |
| `POST /api/creator/videos/[id]/complete`             | Confirm uploaded bytes and request server-side format validation.            |
| `POST /api/creator/videos/[id]/retry-validation`     | Retry an eligible temporary validation failure.                              |
| `POST /api/creator/videos/[id]/delete`               | Remove an unreferenced source and confirm Storage deletion.                  |
| `POST /api/media/playback`                           | Authorize source, saved creator scenario, library or pinned-session playback. |
| `GET /api/library/scenarios?cursor=...`               | Verified-only published creator previews, without answers.                    |
| `GET /api/library/scenarios/[id]`                    | One published setup-only preview.                                             |
| `POST /api/sessions`                                   | `{ requestId, target }`; `target` is `{ kind: 'demo' }` or `{ kind: 'scenario', scenarioId }`. Omitting it retains the demo behavior. |
| `GET /api/sessions?cursor=...`                         | Own paginated history.                                                          |
| `GET /api/sessions/[sessionId]`                        | Own canonical saved session.                                                    |
| `POST /api/sessions/[sessionId]/items/[itemId]/answer` | `{ optionId, requestId, expectedRevision }`; atomically save answer and review. |
| `POST /api/sessions/[sessionId]/advance`               | `{ fromItemId, requestId, expectedRevision }`; advance review or finish.        |

Auth forms use Server Actions. Cookie-authenticated JSON writes require the configured same-origin request. Private responses use no-store handling. Missing or foreign sessions return 404; stale or conflicting commands return 409; unavailable storage returns 503 without a fixture fallback. Auth and input errors use safe messages without provider internals.

## Content and playback

Use the creator studio for new scenarios and revisions. Source titles, attribution, player identity and round details are entered by the creator; the app parses YouTube URLs but does not verify those claims through an external API. YouTube videos remain embedded at their source. Uploaded recordings are stored privately in the local Storage service. Saving unchanged normalized content retains the review; changes require fresh review. Publishing pins immutable content and an answer key, with idempotent receipts protecting retries and stale revisions preventing silent overwrites.

Uploaded scenarios store permanent asset IDs, not expiring URLs. The app grants short-lived playback access to the source owner, a verified learner viewing a published scenario, or a learner's own pinned session. A playback link grants access to the whole original file; timestamp boundaries are an educational interface, not DRM. Already-issued links can remain usable until expiry. Uploaded sources referenced by any saved draft or published version cannot be deleted, including when a scenario is withdrawn, so old sessions retain their video. Unused uploads can be removed from Your videos; quota is released after deletion is confirmed.

The original system-owned demo remains in the canonical JSON fixture. To maintain that fixture, increment `contentVersion` when changing published content, then regenerate and review the seed. Reapplying identical seed content is harmless; changing an existing version fails. Creators cannot edit the system demo.

Each scenario needs player-visible context, unknowns, bounded setup/decision/continuation times, options with independent assessments, an observed action, conditional explanations and review evidence. Evaluate choices using information available before the pause. Do not infer a player’s intent or unavailable team communications. AI drafts and source audio need editorial review before publication.

The official YouTube iframe remains mounted through setup and decision. Playback pauses with a 0.30-second margin; browser scheduling and seeking are not frame-perfect. Replaying setup preserves an unsubmitted selection. Post-answer replay is read-only. Errors and blocked autoplay have explicit retry/play controls. The original public video and repository fixture remain inspectable; this is an educational reveal sequence, not an anti-cheating mechanism.

The seven `artifacts/vod-review/scenario-*.jpg` images preserve visual source evidence. Simulated player tests establish application behavior, not normal-speed audio quality or tactical correctness. Automated upload tests generate original small video files under ignored `test-results/`; no real VODs or uploaded user files belong in Git.

## Project progression

1. **Milestone one:** illustrative decision-player prototype.
2. **Milestone two:** three curated real player-POV VOD scenarios and conditional analysis.
3. **Milestone three:** verified accounts, learner/creator access, persistent versioned sessions and history.
4. **Milestone four:** creator scenario submission, editing, review and publishing.
5. **Milestone five:** reusable uploaded videos, manual scenario timing for YouTube and uploads, and uploaded learner playback through the existing review/publication workflow.
6. **Proposed launch milestone:** hosted deployment, real verification/reset email, backups and operational checks. Library expansion and analytics can follow separately.

Work branches target `dev`; tested releases move from `dev` to `main`. This milestone is built on `feat/creator-media`. GitHub pushes and merges remain with the repository owner. Hosted deployment and production email remain separate work. Automatic extraction is not part of the current roadmap.
