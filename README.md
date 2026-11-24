# Would You Peek?

A Valorant decision-practice app for advanced players. Watch a professional player’s POV, make a choice at a paused moment, then watch the continuation and read conditional analysis. The demo contains three approved moments from TenZ’s ranked stream on Bind.

Matching the pro and making a defensible decision are separate outcomes. Creators can author, review and publish their own scenarios and assemble them into ordered playlists. Explanations distinguish creator-written or AI-assisted analysis; the original demo retains its AI-authored attribution. Observable facts and missing context remain separate from interpretations.

## Run locally

Install **Node.js 24.x**, npm, **FFmpeg** (including `ffprobe`), and a running **Docker Desktop** (or compatible Docker runtime). On macOS, `brew install ffmpeg` supplies the video tools; on Ubuntu, use `sudo apt-get install ffmpeg`. The Supabase CLI is pinned in the project’s development dependencies; a global installation or hosted Supabase account is unnecessary for local development. Local development uses no paid services or AI APIs. The full verification suite additionally requires **age** for real backup-encryption tests (`brew install age` or `sudo apt-get install age`).

```sh
git clone https://github.com/TranHuuPhucAn/WouldYouPeek.git
cd WouldYouPeek
npm ci
npm run db:start
npm run db:env
npm run media:setup
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). The first database start downloads local service images and applies the migrations and demo seed. The local helper verifies the database container belongs to this checkout before enabling uploaded recordings. `db:env` creates an ignored `.env.local` using the local API URL, public key, application origin and `WYP_DEPLOYMENT_MODE=local`; it never writes an administrator key into the application environment. `.env.example` documents local and hosted settings.

In a second terminal in the same project, start the uploaded-video validator:

```sh
npm run media:worker
```

This process checks uploaded file format, size, duration and codecs using `ffprobe`. It does not identify gameplay moments or generate questions. `media:setup` writes an ignored, restricted `.env.media-worker.json` credential valid for eight hours; rerun it and restart the worker when it expires. `npm run media:check` checks local prerequisites. The web app never receives the validator credential. YouTube scenarios continue working while the validator is stopped; new uploads wait for validation.

**Home** is your film room: resume unfinished practice, explore a featured published moment, study players with accurate scenario counts, and discover playlists and more scenarios. Cards open the existing previews; visiting Home never starts or replaces a session. Guests get a short introduction, while account-specific links lead to verification, creator access or the Creator workspace. Home uses the live catalogue and keeps healthy sections available when an individual content or saved-progress read fails.

Open **Library** to browse existing scenarios grouped by player, search player names, and view a player's scenarios. The three original TenZ moments are available individually. Guests can view published metadata and YouTube setup clips; playing requires a verified account. Private uploaded videos require verified access even on preview pages.

Switch to **Playlists** to browse ordered collections, search included player names, or view playlists containing a selected player. A mixed-player collection always plays its full sequence. Its detail page shows the ordered scenario metadata and public creator credit; videos play after starting the saved session. The curated TenZ starter groups the three original moments under a Would You Peek editorial credit.

Choose **Sign in to play** on a scenario or playlist, then register with an email and a password of 8–128 characters including uppercase, lowercase, a number and a symbol. Open the confirmation email in the [local email inbox](http://127.0.0.1:54324), follow its link and press **Verify email**. Opening or scanning the link alone does not consume it. Verification returns you to the selected detail; resend keeps that destination too. These local emails are captured; no real email is sent. Password-reset messages use the same inbox and an explicit confirmation before setting the new password.

After verification, start a scenario. Watch setup, select an answer card, and **Lock in your call**. Replay setup keeps your selection. The answer is saved before the pro’s continuation plays; analysis appears below after that continuation finishes. The debrief separates your decision assessment from whether you matched the pro, with expandable conditions, risks and other choices. If playback is blocked or unavailable, use **Read saved analysis** to continue reviewing your saved choice. **Finish session** completes the review.

Home and Library offer **Continue your session** when you have unfinished practice. Leaving a page keeps the session resumable. **End session early** permanently closes it after confirmation and preserves submitted decisions in History, labelled **Ended early** with the saved count. Unanswered scenarios receive no saved answer or continuation access through that ended session. A session with no saved decisions can also be ended. Once every decision is saved, use **Finish session** instead.

Refreshing an unanswered scenario restarts setup; reopening a saved answer shows its analysis immediately without autoplay. Completed and early-ended recaps offer optional setup and continuation replay for saved answers, with only one video active at a time. Replay never changes your saved answer or restarts the session. Unsubmitted selections and video time are not persisted. Opening an end confirmation pauses playback; closing it does not resume the video or cancel a request already submitted.

A playlist uses the same saved flow with **Next scenario** between items and **Finish session** at the end. Only one session is active at a time. Starting the same playlist resumes its saved version; a different target offers **Resume current session** or **End current session**. After ending, explicitly start the selected target. If a playlist changes after its preview loads, refresh the preview before starting a new run. Practising a completed playlist again returns to its current preview; old history retains the original order, versions and credit.

Under **Account**, any verified learner can enable creator access. Creators retain learner access. Open **Creator studio** to create a private draft, choose a YouTube source or an owned uploaded recording, write context, choices and analysis, and explicitly save. Incomplete drafts can be saved. Preview uses only the saved draft and does not create a learner session.

**Your videos** holds reusable uploads. Supported files are MP4 with H.264 8-bit video and AAC audio (or no audio), up to 2 GiB, two hours and 1920×1080. Each creator can reserve/store up to 10 GiB, with at most three unfinished uploads. Uploads show preparation/transfer progress and then server validation; a completed transfer is not yet a ready source. To resume after a browser reload, reselect the same file. Unsupported files are rejected without automatic conversion.

Cancelling an unfinished upload prevents it from becoming a usable recording. Storage manages cleanup of temporary upload fragments, so cancelling or expiring a partial transfer does not guarantee immediate disk-space recovery.

In the scenario editor, watch and seek through either source, then use **Set setup start**, **Set decision pause**, and **Set continuation end**, or enter precise timestamps. You choose every moment; there is no automatic extraction. Marking changes the working draft until you save. Replacing a source asks for confirmation and clears its old timing marks and media descriptions. One uploaded recording can support several scenarios without duplicating its bytes.

When the draft is complete, preview it, review the source and explanations, and record the checklist. **Publish** makes that exact reviewed content visible in **Library**, under the source player's name. The editor suggests existing player names; case and whitespace variants share one player group. Drafts do not create public player entries. Learners start one scenario at a time. If another session is active, resume it or explicitly end it before starting a different target.

Editing a published scenario leaves its previous version available until a new reviewed version is published. Content changes invalidate the review. **Unpublish** removes the scenario from discovery and new starts; existing sessions and history retain their original version. Republishing requires another review. Creator review is self-review; the separate operator controls below handle reported problems.

To create a playlist, open **Creator → Playlists**, enter a title and optional description, and select up to 20 distinct scenarios you own and have published. Mixed players are allowed. Use **Move up** and **Move down** to set the order, then explicitly save. Empty/incomplete drafts remain private. A playlist references existing scenario versions and never duplicates uploaded video bytes.

Set a public creator name under **Account** before reviewing a playlist. Names are 2–50 characters and are never derived from account emails. Review requires a title of 1–120 characters and 1–20 scenarios; descriptions allow up to 1,000 characters. Review the saved selections, sequence and credit, record the checklist, then publish. Later draft edits stay private until republished. Each publication freezes its title, order, source versions, included players and credit; a later name change affects future publications only.

New scenario versions do not silently update playlists: choose **Update to latest** in the playlist draft when desired. Withdrawing any included scenario blocks affected playlist publications from discovery and new starts. Restoring that scenario alone does not restore those playlists; review and publish the collection again, retaining or updating its selected versions. Playlist **Unpublish** also stops new starts. Existing saved sessions remain available throughout. Creator review is self-review; creator labels do not imply endorsement by the featured pro.

**Report a problem** is available on scenario previews, active practice and saved-answer reviews. Sign in and verify your email to submit a report about video availability, pause/spoiler timing, context, analysis or inappropriate content. Reports identify the version you actually viewed; an updated public version requires explicit confirmation before retargeting. Details are limited to 2,000 characters, with an explanation required for Other. Accounts can submit five new reports per rolling hour and have one open report per version/category. Duplicate reports return the existing reference without appending new text. Reports do not automatically hide content or send email.

An explicitly provisioned operator can open **Account → Review scenario reports**. The queue distinguishes open and resolved reports; details show the reported version, its explanation, the current publication and optional setup/continuation playback. Only one preview plays at a time. **Resolve** and **Hide/Restore** are separate actions. Creator enrollment does not grant operator access, and private report text and operator notes are not shown to creators.

Hiding removes a scenario from public discovery and new starts, including dependent playlists. Existing owned practice and answered History remain available. Creators see a separate **Hidden by operator** notice and its reason; editing or republishing cannot clear that hold. Restoring a hold does not publish a withdrawn scenario. Creator playlists require review and republication after a source is restored; the editorial starter playlist uses the maintenance procedure described below. Previously issued short-lived upload URLs and the original public YouTube recording are not erased by hiding.

If upgrading an existing local installation, preserve your accounts and scenarios by applying only the pending migrations. Restart the project’s Supabase services to load the current local service and email configuration; stopping retains local data:

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

Stop the web server with `Ctrl+C`; stop local services with `npm run db:stop`. After applying the 9A/9B migrations, run the updated app and reload existing tabs. The old M9 client cannot interpret ended sessions; reverting app code alone is not a compatible rollback after early-ended records exist.

Stopping preserves database volumes. Starting again restores accounts and sessions. **`npm run db:reset:local` deletes local accounts, creator content and progress**, recreates the development database and seeds the three demo scenarios. It is unnecessary for normal upgrades or verification.

To serve an optimized build locally, keep Supabase running and use:

```sh
npm run build
npm start
```

## Operator maintenance

Operator access is provisioned manually for a verified account you control. Creator enrollment and the application cannot grant it. These commands target the normal local project; first confirm the container's workspace matches this checkout:

```sh
docker inspect supabase_db_would-you-peek --format '{{ index .Config.Labels "com.supabase.cli.workdir" }}'
docker exec -it supabase_db_would-you-peek psql -X -U postgres -d postgres -v ON_ERROR_STOP=1
```

In `psql`, run `\conninfo`. Find the intended account UUID under **Authentication → Users** in [local Studio](http://127.0.0.1:54323), then replace the placeholder and confirm the returned email and verification date:

```sql
\set operator_user_id 'REPLACE_WITH_VERIFIED_ACCOUNT_UUID'
select id, email, email_confirmed_at, deleted_at
from auth.users where id = :'operator_user_id'::uuid;
```

Grant or restore access using that same UUID. This refuses missing, unverified or deleted accounts and leaves learner/creator access unchanged:

```sql
begin;
select set_config('wyp.operator_user_id', :'operator_user_id', true);
do $$
declare target uuid := current_setting('wyp.operator_user_id')::uuid;
begin
  if current_user <> 'postgres' or session_user <> 'postgres' then
    raise exception 'Use the trusted postgres connection';
  end if;
  if not exists (select 1 from auth.users where id = target
      and email_confirmed_at is not null and deleted_at is null) then
    raise exception 'The exact account must exist and have a verified email';
  end if;
  insert into private.operator_memberships(user_id) values (target)
  on conflict(user_id) do update set granted_at = now(), revoked_at = null;
end $$;
commit;
```

Refresh **Account** to see **Review scenario reports**. To revoke access, reconnect to the same local database, set `operator_user_id` to the exact account UUID again, and run:

```sql
update private.operator_memberships set revoked_at = now()
where user_id = :'operator_user_id'::uuid and revoked_at is null
returning user_id, revoked_at;
```

Revocation takes effect for new operator requests after the update commits. Existing signed video URLs can remain usable for up to 300 seconds; independent creator and learner permissions remain valid. Keep actual account identifiers and connection credentials out of tracked files.

### Republish the editorial starter after a restore

Restoring a source does not automatically reactivate its playlists. Creator playlists use their normal review/publish flow. The fixed editorial starter requires an explicit review and [maintenance script](supabase/maintenance/republish_editorial_playlist.sql), run by the operator through the trusted local database connection above.

After resolving the source issue and restoring visibility, inspect the starter's current publication and dependencies in `psql`:

```sql
select p.current_version as expected_publication_id,
  jsonb_agg(jsonb_build_object(
    'scenarioId', s.id, 'scenarioVersion', v.content_version,
    'availabilityGeneration', private.current_scenario_availability_generation(s.id)
  ) order by i.position) as reviewed_sources,
  bool_and(private.scenario_publicly_available(s.id)
    and private.playlist_version_media_ready(v.id)) as sources_ready
from public.playlists p
join private.playlist_version_items i on i.publication_id = p.current_version
join public.scenarios s on s.id = i.scenario_id
join public.scenario_versions v on v.id = s.current_version
where p.id = '7ecf3523-18cb-5cbe-a307-5b5cd43d1836'
group by p.current_version;
```

Review the actual source moments and explanations; `sources_ready` only checks availability. The JSON must contain exactly `scenarioId`, `scenarioVersion` and numeric `availabilityGeneration` for each item, ordered `bind-clove-utility-window`, `bind-clove-smoke-contest`, then `bind-clove-advantage-reset`. Copy the reviewed values, exit `psql` with `\q`, and replace every placeholder below. Run from the project root:

```sh
docker exec -i supabase_db_would-you-peek psql -X -U postgres -d postgres \
  --single-transaction -v ON_ERROR_STOP=1 \
  -v playlist_id=7ecf3523-18cb-5cbe-a307-5b5cd43d1836 \
  -v expected_publication_id='REPLACE_WITH_CURRENT_PUBLICATION_UUID' \
  -v reviewed_sources='REPLACE_WITH_REVIEWED_JSON_ARRAY' \
  -v reviewed_by='REPLACE_WITH_REVIEWER_NAME' \
  -v review_reason='REPLACE_WITH_REVIEW_REASON' \
  -f - < supabase/maintenance/republish_editorial_playlist.sql
```

Keep `--single-transaction`. The script checks the fixed target, original order, current source versions, availability generations and media readiness under locks, then creates a new immutable publication. It preserves older publications and saved sessions. Save the emitted JSON and successful commit as local maintenance evidence. Stale inputs, hidden/withdrawn sources and a repeated invocation using the old publication ID are rejected; inspect and review again instead of changing historical rows. This script never runs automatically.

## Verify

```sh
npm ci
npm run test:ci
```

Keep Docker running. The full command creates an ignored `.wyp-test-work/<run-id>/` source copy and a uniquely named disposable Supabase project. It uses API port 55321, database 55322, inbox 55324 and an app at `http://localhost:3100`. These ports must be free. The different app hostname also isolates browser auth cookies from your development app at `127.0.0.1:3000`.

The runner first verifies additive upgrades from milestone three to four, four to five, five to six, and six to seven, preserving accounts, creator drafts, review digests, player mappings, immutable versions, uploaded bytes and references, saved sessions and command receipts. The M7 check also proves the curated playlist is added without reseeding existing data. Additional populated upgrades verify M9 → 9A session ending and 9A → 9B reports and visibility controls, including active, completed and ended history, command retries and real uploaded bytes. The M10 upgrade proves hosted upload denial and preservation of local media/history. It then resets only its disposable database, verifies fresh hosted readiness, rehearses encrypted PostgreSQL backup/restore in two owned scratch databases, enables uploads through the validated local helper, generates small original video fixtures, starts its scoped media validator, and runs seed/type drift checks, unit/component tests, PostgreSQL pgTAP tests, real Auth/Data/Storage API integration tests, type checking, a production build and actual Next.js HTTP tests. It stops its own app/validator and removes only its owned test services, volumes and workspace, including on ordinary cancellation. Your development database, video library, `.env.local` and `.next` are untouched. Failure diagnostics are stored under ignored `test-results/` when available.

`npm test` runs fast backend/frontend tests; `test:backend` and `test:frontend` select a suite. `npm run test:scripts` checks isolation, cleanup and pipeline failure handling without Docker. Database, integration and HTTP suites refuse the normal development project and hosted targets; run them through `test:ci` so publication fixtures remain isolated. Test administrator credentials are never passed to the web app. The recovery rehearsal uses real `pg_dump`, PostgreSQL COPY and age encryption, checks every restored table plus password hashes, history and permissions, and refuses a target populated during preparation. It models remote transport and provider schema comparison; actual hosted login and provider recovery remain separate release acceptance checks.

For local investigation, `npm run test:ci -- --keep` retains its owned disposable database/workspace after the run; the app and validator still stop. Record the printed workspace and clean it up with the validated `stopTestStack()` and `cleanupTestWorkspace()` helpers after investigation. Never substitute the normal project identity. CI uses the default automatic cleanup.

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
- `src/server/creator-playlists/`, `src/server/playlists/`, `src/lib/playlists/`: owned playlist authoring, immutable publication metadata, safe discovery and shared content/order helpers.
- `src/server/account/creator-profile/`: separately saved public creator credit with revision and retry checks.
- `src/server/video/`, `src/app/api/creator/videos/`, `src/app/api/media/playback/`: resumable upload reservations, reference-safe deletion and context-authorized playback access.
- `src/worker/media/`, `scripts/local-media-worker.mjs`: local metadata validation under a narrowly scoped credential; no publishing or learner-answer privileges.
- `src/app/library/`, `src/components/library/`, `src/server/library/`, `src/server/players/`: public player groups, safe published previews and verified selected-scenario starts.
- `src/lib/players/`, `src/lib/scenario-id.ts`: consistent player identity normalization and curated-slug/creator-UUID scenario identifiers.
- `src/server/auth/`, `src/app/(auth)/`, `src/lib/supabase/`: validation, auth actions, confirmation/recovery callbacks, verified identity and cookie refresh.
- `src/server/training/` and `src/app/api/sessions/`: canonical session reads and atomic start, answer, advance and early-end commands.
- `src/lib/client/`, `src/lib/session/`, `src/hooks/use-challenge-session.ts`: validated responses, durable checkpoint hydration, retry reconciliation and auth-change cancellation.
- `src/components/challenge/`: bounded YouTube/uploaded players, choices, advanced analysis and recap.
- `src/server/moderation/`, `src/app/api/scenario-reports/`, `src/app/api/operator/`, `src/components/operator/`: pinned-version reports, private operator review and independent visibility holds.
- `supabase/migrations/`: profiles, versioned scenarios, sessions, immutable attempts, private answer keys and command receipts, RLS and narrowly granted functions.
- `supabase/fixtures/demo-scenarios.json`: the canonical authored dataset. `scripts/render-demo-seed.mjs` generates `supabase/seed.sql`; runtime repositories read the database.
- `supabase/fixtures/curated-playlist.json`: stable editorial starter identity, metadata and references; migration and seed initialization verify the same manifest without rewriting historical content.
- `tests/backend/`, `tests/frontend/`, `tests/integration/`, `supabase/tests/database/`: complementary unit, component, real-service and permission/transaction tests.

Guests can browse published player groups and setup-only scenario previews. Verified accounts can play and read their own history. Public responses exclude questions, choices, outcomes, private drafts, account details and private video URLs. Creator enrollment affects only the current account and grants no access to others' private drafts or learner records. Private answer keys cannot be read directly through the public Data API. Session and authoring functions use separate restricted non-login roles that do not own application tables or bypass row-level security. A trigger-only role synchronizes trusted email confirmation into a protected profile column; runtime roles need no direct auth-table access.

The player catalogue maps immutable scenario versions to stable player records. Only current published versions contribute to groups and counts; historical attribution is preserved for saved sessions. Player names use Unicode normalization, collapsed whitespace and ASCII case folding, without fuzzy matching different spellings. The curated TenZ scenarios retain their original IDs and AI-analysis attribution. Old `/demo` links redirect to TenZ; `/play` resumes the caller's active session or opens Library, without creating a session.

Playlist filters use their frozen player membership. A player remains reachable through a playlist even when no current standalone scenario names them. Public playlist data contains ordered metadata only, with no questions, answers, media credentials or account identifiers. Withdrawal generations prevent a restored source from silently reactivating an older playlist publication or stale review.

Each session pins immutable scenario versions. Answers and review checkpoints commit together. One account has at most one active session. Commands carry a request UUID and expected revision; retrying an identical command returns the current canonical snapshot of its original session, even after completion. Reusing the UUID with different input fails. Losing a response or encountering a stale tab triggers reconciliation rather than another attempt.

## API

| Endpoint                                               | Access and result                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `GET /api/challenges`                                  | Public setup-only preview catalogue.                                            |
| `GET /api/challenges/[id]`                             | Public preview; no question, choices, feedback or reveal interval.              |
| `POST /api/challenges/[id]/answer`                     | Retired: guests receive 401; signed-in callers receive 409 `SESSION_REQUIRED`.  |
| `GET /api/account`                                     | Current account and capabilities.                                               |
| `POST /api/account/creator`                            | Verified self-enrollment; empty JSON object.                                    |
| `GET/PUT /api/account/creator-profile`                 | Verified creator's own public name/revision; writes include request ID and expected revision. |
| `GET /api/creator/scenarios?status=all&cursor=...`      | Verified creator's own draft/publication summaries.                            |
| `POST /api/creator/scenarios`                         | `{ requestId }`; create a private draft.                                       |
| `GET /api/creator/scenarios/[id]`                     | Owner's current saved draft and publication state.                             |
| `PUT /api/creator/scenarios/[id]`                     | `{ requestId, expectedRevision, content }`; explicitly save a bounded draft.   |
| `GET /api/creator/scenarios/[id]/review?revision=...`  | Owner-only preview of the exact saved revision.                                |
| `POST /api/creator/scenarios/[id]/review`             | `{ requestId, expectedRevision, checklist }`; record self-review.              |
| `POST /api/creator/scenarios/[id]/publish`            | `{ requestId, expectedRevision, reviewId }`; publish atomically.               |
| `POST /api/creator/scenarios/[id]/unpublish`          | `{ requestId, expectedRevision }`; delist new starts.                          |
| `GET/POST /api/creator/playlists`                    | Own paginated playlist summaries / create a private draft with `{ requestId }`. |
| `GET/PUT /api/creator/playlists/[id]`                 | Own saved playlist / save `{ requestId, expectedRevision, content }`.         |
| `GET /api/creator/playlists/[id]/review?revision=...` | Owner-only saved metadata and public-credit revision for review.             |
| `POST /api/creator/playlists/[id]/review`             | `{ requestId, expectedRevision, profileRevision, checklist }`; record exact collection review. |
| `POST /api/creator/playlists/[id]/publish`            | `{ requestId, expectedRevision, reviewId }`; publish an immutable collection. |
| `POST /api/creator/playlists/[id]/unpublish`          | Revision/idempotency command; stop new discovery and starts.                  |
| `GET /api/creator/playlist-scenarios?query=...&cursor=...` | Own current published scenario metadata and versions for selection.       |
| `GET /api/creator/videos`                            | Owner's reusable uploads, limits and validator availability.                 |
| `POST /api/creator/videos`                           | Reserve an owned upload with a request UUID and file identity.                |
| `GET /api/creator/videos/requests/[requestId]`        | Reconcile an interrupted upload reservation.                                 |
| `GET /api/creator/videos/[id]`                       | Owner's upload, validation and deletion state.                               |
| `POST /api/creator/videos/[id]/upload-session`       | Obtain/resume the same immutable Storage upload destination.                 |
| `POST /api/creator/videos/[id]/complete`             | Confirm uploaded bytes and request server-side format validation.            |
| `POST /api/creator/videos/[id]/retry-validation`     | Retry an eligible temporary validation failure.                              |
| `POST /api/creator/videos/[id]/delete`               | Remove an unreferenced source and confirm Storage deletion.                  |
| `POST /api/media/playback`                           | Authorize source, saved creator scenario, library, pinned-session or operator-report playback. |
| `GET /api/library/players?query=...&cursor=...`        | Public player groups, published counts and up to three previews per group.    |
| `GET /api/library/scenarios?playerId=...&cursor=...` | Public published previews, optionally filtered by player, without answers.    |
| `GET /api/library/scenarios/[id]`                    | One published setup-only preview.                                             |
| `GET /api/library/playlists?query=...&playerId=...&cursor=...` | Public available playlist cards, filtered by included players.             |
| `GET /api/library/playlists/[id]`                    | Current immutable playlist metadata and complete ordered item list.          |
| `POST /api/sessions`                                   | `{ requestId, target }`; targets are demo, scenario or playlist. Playlist targets `{ kind: 'playlist', playlistId }` additionally require `expectedPublicationVersion`. Omitting the target retains the demo behavior. |
| `GET /api/sessions?cursor=...`                         | Own paginated history.                                                          |
| `GET /api/sessions/[sessionId]`                        | Own canonical saved session.                                                    |
| `POST /api/sessions/[sessionId]/items/[itemId]/answer` | `{ optionId, requestId, expectedRevision }`; atomically save answer and review. |
| `POST /api/sessions/[sessionId]/advance`               | `{ fromItemId, requestId, expectedRevision }`; advance review or finish.        |
| `POST /api/sessions/[sessionId]/end` | `{ requestId, expectedRevision }`; permanently end an unfinished session and keep answered history. |
| `POST /api/scenario-reports` | Verified caller; version-specific target, category, detail and request ID. |
| `GET /api/operator/reports` | Operator-only paginated queue, filtered by status. |
| `GET /api/operator/reports/[id]` | Operator-only pinned content, private report and current visibility. |
| `POST /api/operator/reports/[id]/resolve` | Revision-checked resolution with a private operator note. |
| `POST /api/operator/scenarios/[id]/visibility` | Revision-checked hide/restore with a creator-facing reason. |

Auth forms use Server Actions. Cookie-authenticated JSON writes require the configured same-origin request. Private responses use no-store handling. Missing or foreign sessions return 404; stale or conflicting commands return 409; unavailable storage returns 503 without a fixture fallback. Auth and input errors use safe messages without provider internals.

## Content and playback

Use the creator studio for new scenarios and revisions. Source titles, attribution, player identity and round details are entered by the creator; the app parses YouTube URLs but does not verify those claims through an external API. YouTube videos remain embedded at their source. Uploaded recordings are stored privately in the local Storage service. Saving unchanged normalized content retains the review; changes require fresh review. Publishing pins immutable content and an answer key, with idempotent receipts protecting retries and stale revisions preventing silent overwrites.

Uploaded scenarios store permanent asset IDs, not expiring URLs. The app grants short-lived playback access to the source owner, a verified learner viewing a published scenario, a learner's eligible pinned session item, or an active operator reviewing the exact reported version. An ended session grants replay only for answered items; active sessions grant current and answered items. Independent ownership/publication permissions still apply. A playback link grants access to the whole original file; timestamp boundaries are an educational interface, not DRM. Already-issued links can remain usable until expiry. Uploaded sources referenced by any saved draft or published version cannot be deleted, including when a scenario is withdrawn, so old sessions retain their video. Unused uploads can be removed from Your videos; quota is released after deletion is confirmed.

The original system-owned demo remains in the canonical JSON fixture. To maintain that fixture, increment `contentVersion` when changing published content, then regenerate and review the seed. Reapplying identical seed content is harmless; changing an existing version fails. Creators cannot edit the system demo.

Each scenario needs player-visible context, unknowns, bounded setup/decision/continuation times, options with independent assessments, an observed action, conditional explanations and review evidence. Evaluate choices using information available before the pause. Do not infer a player’s intent or unavailable team communications. AI drafts and source audio need editorial review before publication.

The official YouTube iframe remains mounted through setup and decision. Playback pauses with a 0.30-second margin; browser scheduling and seeking are not frame-perfect. Replaying setup preserves an unsubmitted selection. Post-answer replay is read-only. Errors and blocked autoplay have explicit retry/play controls. The original public video and repository fixture remain inspectable; this is an educational reveal sequence, not an anti-cheating mechanism.

The seven `artifacts/vod-review/scenario-*.jpg` images preserve visual source evidence. Simulated player tests establish application behavior, not normal-speed audio quality or tactical correctness. Automated upload tests generate original small video files under ignored `test-results/`; no real VODs or uploaded user files belong in Git.

## Hosted launch and release operation

Milestone 10 adds hosted configuration and release tools. **A successful local build does not deploy this application.** Provider setup, actual email delivery, the hosted restore rehearsal and public deployment require their own verified release steps. There is no automatic deployment or migration workflow in this repository. GitHub's existing `Verify` / `verify` check remains the merge gate.

The first hosted release starts with fresh accounts, the three canonical TenZ scenarios and the editorial starter playlist. Do not copy local users, histories, drafts or uploaded videos. Hosted mode allows YouTube sources only. The interface, server, SQL RPCs, worker entry points and Storage policies enforce that boundary. Local mode retains the upload workflow. Database capability defaults to YouTube only; ordinary users, creators and operators cannot change it. A deployment/configuration mismatch fails closed.

The proposed free setup is Vercel Hobby (personal, non-commercial use), Supabase Free and Cloudflare Turnstile Free, using provider hostnames. Confirm current eligibility and capacity at setup time. Supabase's free tier may pause for inactivity and does not provide automatic database backups; no keep-alive traffic or automatic paid upgrade is configured. Use separate Supabase projects for preview and production. Preview is internal release verification, not a public beta. Do not enable preview deployments with production environment values.

### Application environment

| Setting | Hosted value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Exact `https://<project-ref>.supabase.co` URL for this environment |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | That project's public publishable/anon key |
| `NEXT_PUBLIC_APP_URL` | Exact canonical HTTPS application origin |
| `WYP_DEPLOYMENT_MODE` | `hosted` |
| `WYP_RELEASE_ENVIRONMENT` | `preview` or `production`; must match the host environment when supplied |
| `WYP_SUPABASE_PROJECT_REF` | Exact project reference, matching the public URL |
| `WYP_SUPPORT_EMAIL` | An address the owner actually monitors; displayed on Help/privacy |
| `WYP_TURNSTILE_SITE_KEY` | Real public Turnstile widget key for the allowed hostname |

The web application never receives the database password, Supabase service-role key, SMTP password, Turnstile secret or hosted maintenance token. Configure SMTP credentials and the Turnstile secret in Supabase Auth. Keep real values out of Git and CI output. `NEXT_PUBLIC_*` values are embedded at build time: build the tested commit separately for production, rather than promoting a preview bundle connected to another database.

### Real email and bot protection

Supabase's default sender restricts recipients to project-team addresses and cannot support public registration. Configure custom SMTP and keep email confirmation enabled. A dedicated free project Gmail account with 2-Step Verification and an app password is a candidate, **not a proven delivery service**. Use that account's own sender address through `smtp.gmail.com`, not a paid Workspace trial. Prove verification, resend and recovery delivery to external Gmail and Outlook inboxes before release. Start with a conservative total email rate allowance, such as 10/hour, and change it only within demonstrated provider limits. Failure is a sender-setup blocker; it does not authorize payment or disabling verification.

Set the exact site URL and allowed callback origins in Supabase Auth, and install the reviewed confirmation/recovery templates from `supabase/templates/`. Disable provider link tracking. GET/HEAD on `/auth/confirm` lead to an explicit confirmation form; only its POST exchanges the token. Test scanner-style repeated reads, expired/used links, cross-device opening and return to the requested scenario. Never include callback tokens in logs, screenshots or support messages.

Enable Cloudflare Turnstile in Supabase Auth as well as configuring the app's widget key. Sign-up, sign-in, reset requests and verification resend forward the challenge token. Provider rejection of missing/invalid/reused tokens must be tested against the actual hosted Auth endpoint; hiding a submit button is insufficient. Local configuration uses Mailpit and no live challenge service. A blocked widget has a retry path, not an authentication bypass.

### Explicit hosted targets

The maintenance tools additionally require **PostgreSQL client tools** (`psql`, `pg_dump`, `pg_dumpall`), **age**, Docker and the pinned Supabase CLI. On macOS, `brew install libpq age` installs the clients; add Homebrew's `libpq/bin` directory to the current terminal's `PATH`. Use a PostgreSQL client at least as new as the server. Never replace the local helpers' target checks to make them operate remotely.

Store a private target JSON file **outside the checkout**, with file mode `600`, in a directory you control. The tool requires canonical filesystem paths rather than symlink aliases. Example shape (the references below are placeholders):

```json
{
  "schemaVersion": 1,
  "environment": "preview",
  "projectRef": "bbbbbbbbbbbbbbbbbbbb",
  "productionProjectRef": "aaaaaaaaaaaaaaaaaaaa",
  "appOrigin": "https://your-preview-host.vercel.app",
  "database": {
    "host": "db.bbbbbbbbbbbbbbbbbbbb.supabase.co",
    "port": 5432,
    "user": "postgres",
    "name": "postgres"
  }
}
```

Production uses `environment: production` and identical `projectRef`/`productionProjectRef`. Preview must use a different reference. If a direct IPv6 connection is unavailable, use the dashboard's **session** pooler on port 5432 with username `postgres.<project-ref>`; transaction pooler port 6543 is rejected. TLS certificate verification is required. SQL commands use `WYP_HOSTED_CA_FILE` when supplied, otherwise libpq uses its system trust configuration. Backup schema comparison requires an explicit, valid CA PEM file outside the checkout with private permissions.

Supply `WYP_HOSTED_DB_PASSWORD` and, for migration and restore preparation, a scoped `WYP_HOSTED_ACCESS_TOKEN` through a protected environment or password manager. Backup export uses the database password and the configured CA directly; it does not require an API token. Do not put values in command arguments, screenshots, public workflows or shell history. `WYP_TARGET_FILE`, `WYP_PROJECT_REF`, `WYP_RELEASE_ENVIRONMENT` and `WYP_RELEASE_SHA` in the commands below are non-secret variables identifying the reviewed target and full commit SHA; set them deliberately before running anything.

```sh
npm run hosted:release -- preflight --target "$WYP_TARGET_FILE" --project "$WYP_PROJECT_REF" --environment "$WYP_RELEASE_ENVIRONMENT" --sha "$WYP_RELEASE_SHA"
```

Preflight requires a clean checkout of the exact current release-branch commit and a successful latest `Verify` push run for that SHA: `dev` for preview, `main` for production. It rejects divergent migration history, uploaded objects and contradictory source capabilities. Seeded current databases also pass the read-only SQL readiness assertions. Unavailable GitHub evidence keeps the gate closed. These tools do not push, merge, buy services or assign hostnames.

After reviewing preflight and, for a populated database, making a recent encrypted backup:

```sh
npm run hosted:release -- migrate --target "$WYP_TARGET_FILE" --project "$WYP_PROJECT_REF" --environment "$WYP_RELEASE_ENVIRONMENT" --sha "$WYP_RELEASE_SHA" --confirm "$WYP_PROJECT_REF" --backup "$WYP_BACKUP_MANIFEST"
```

Omit `--backup` only for a fresh project without accounts. The CLI applies reviewed additive migrations to the explicit project reference. It does not reset the database, copy local Auth settings or seed user accounts. Existing remote migration versions must be an ordered prefix of the checkout. An encrypted backup matching the current project/migration state and no older than 24 hours is required before migrating a database with accounts.

For the initial project only:

```sh
npm run hosted:release -- seed --target "$WYP_TARGET_FILE" --project "$WYP_PROJECT_REF" --environment "$WYP_RELEASE_ENVIRONMENT" --sha "$WYP_RELEASE_SHA" --confirm "$WYP_PROJECT_REF"
```

Seeding checks freshness inside the same transaction as the canonical seed. An already seeded project is checked without rewriting its content. Accounts or unexpected content block initial seeding. Never run `db:reset:local`, the local fixture runner or the local validator against hosting.

Create and verify the owner's account normally, then use the exact-UUID operator SQL shown in **Operator maintenance** through trusted administration of the intended hosted project. First confirm the project identity. Never infer operator membership from creator access or user-editable metadata. Verify both grant and revoke behavior with an ordinary creator and the operator.

### Encrypted backups and isolated restore

Create an age recovery key outside the checkout (`age-keygen -o /absolute/private/path/recovery.agekey`), protect it with file mode `600`, and keep a separate protected recovery copy. Use the public recipient from `age-keygen -y` for exports. The private backup directory must have mode `700` and must be outside Git. Database records and credentials must never become GitHub Actions artifacts.

```sh
npm run hosted:backup -- export --target "$WYP_TARGET_FILE" --project "$WYP_PROJECT_REF" --environment "$WYP_RELEASE_ENVIRONMENT" --sha "$WYP_RELEASE_SHA" --destination "$WYP_BACKUP_DIRECTORY" --recipient "$WYP_AGE_RECIPIENT"
```

Set `WYP_HOSTED_CA_FILE` to the trusted CA file (private permissions, outside the checkout). The schema comparison binds `verify-full` and that CA to the password-free hosted URL, keeping those hosted TLS settings out of its separate local shadow database. SQL queries and dumps retain full TLS verification.

Export from a clean checkout of the recorded source SHA whose migrations match the database. A strict schema comparison against the reviewed migrations must also pass; unresolved drift blocks the backup instead of silently omitting it. Four encrypted files contain role/schema evidence, managed-schema evidence and application/authentication data. A private manifest records migration hashes, encrypted-file checksums and table row hashes. Plaintext exports are not written to disk. Unexpected uploaded objects or a failed hosted-readiness check block export. Backups contain sensitive password hashes and private records even though encrypted. Store a separate protected copy outside the hosting provider. Auth provider settings, SMTP/CAPTCHA secrets, API keys and recovery-key custody require a separate owner-controlled inventory.

The automated restore path is for an **empty, different preview project only**, with compatible Supabase managed schemas and no application migrations/accounts/objects:

```sh
npm run hosted:backup -- restore --target "$WYP_RESTORE_TARGET_FILE" --project "$WYP_RESTORE_PROJECT_REF" --environment preview --manifest "$WYP_BACKUP_MANIFEST" --identity "$WYP_AGE_IDENTITY_FILE" --confirm "$WYP_RESTORE_PROJECT_REF"
```

Use the exact reviewed migration files recorded by the backup. Restore decrypts and checks all files before mutation, replays those migrations to recreate application roles/grants/RLS and custom Auth/Storage objects, then imports the data transactionally. It does not blindly replay managed platform DDL. It checks every captured table's rows/hash and hosted readiness afterward. The encrypted schema/role exports remain recovery evidence for reviewing unexpected drift; schema changes must be represented by reviewed migrations. A same-project, production or nonempty restore destination is refused. Tables are locked and emptiness is rechecked inside the import transaction. A failed preparation can leave an initialized disposable target; inspect it or deliberately create another empty target rather than forcing a destructive retry. Never use public CI to restore real users' data.

A completed restore command is not full operational acceptance. On synthetic staging data, prove restored password login/reset, profile synchronization, cross-account denial, session/playlist snapshots, operator grant/revoke, reports/holds and YouTube playback. Reconfigure provider settings with destination-specific credentials. Do not send test emails to restored real users. Hosted-to-hosted recovery remains a release checkpoint until it has actually been rehearsed on the chosen providers.

Take protected backups daily while operating and before every populated migration. This is an owner-run procedure; no scheduler is installed. Record backup age and the last successful restore rehearsal. Missing a backup increases possible data loss. Database exports do not contain Storage file bytes; hosted YouTube-only mode deliberately has none.

### Publication and rollback

1. Finish the full local CI suite, populated-upgrade tests and desktop/device acceptance. Commit/push/merge remain with the repository owner.
2. Configure isolated preview hosting, prove real emails/CAPTCHA and all learner/creator/operator flows, then rehearse recovery with synthetic records.
3. Review the exact production `main` SHA after its required `Verify` check passes. Disable automatic production promotion that could race CI. Apply compatible migrations and build that commit with production values.
4. Inspect the production candidate and its read-only checks. A candidate URL may already be publicly reachable; confirm the free host's actual deployment protection rather than assuming an unaliased URL is private. Review the exact final hostname before approving promotion.
5. After explicit deployment approval and hostname promotion, immediately verify final-origin signup/verification/reset, cookies, all three scenarios, playlist resume/history, early ending, publishing and reports. Full callback behavior on that hostname cannot be proven before it points to the candidate.

`npm run hosted:release -- smoke` accepts the same explicit target/SHA flags as preflight and performs read-only page/readiness checks. It does not create accounts or replace real playback/email testing. `/api/health` returns only bounded readiness; application errors avoid private payloads and credentials. Use the providers' free dashboards to review usage and failures; no paid monitoring service or learner analytics integration is added.

Keep the previous verified application build and its compatible schema range. Routine rollback changes the application deployment, not saved user data. Use additive migrations and forward fixes. Do not run down migrations, database reset or an old seed as rollback. Emergency data recovery restores privately into another target, validates it, and reviews cutover while preserving the original database and newer writes for reconciliation.

## Project progression

1. **Milestone one:** illustrative decision-player prototype.
2. **Milestone two:** three curated real player-POV VOD scenarios and conditional analysis.
3. **Milestone three:** verified accounts, learner/creator access, persistent versioned sessions and history.
4. **Milestone four:** creator scenario submission, editing, review and publishing.
5. **Milestone five:** reusable uploaded videos, manual scenario timing for YouTube and uploads, and uploaded learner playback through the existing review/publication workflow.
6. **Milestone six:** public player-based Library, individually playable curated scenarios, saved-session resume and simpler navigation.
7. **Milestone seven:** creator playlists, including mixed-player collections and ordered, resumable training sessions.
8. **Milestone eight:** a film-room Home page with saved-session resume, a live featured moment, player counts, playlist discovery and account-specific entry points.
9. **Milestone nine:** clearer scenario presentation and training UX; **9A** adds permanent early session ending with answered history, and **9B** adds scenario reports and operator hide/restore.
10. **Milestone ten:** hosted YouTube-only configuration, explicit email confirmation and bot protection, Help/privacy, release checks and protected backup/restore tooling. Actual provider/email acceptance and public deployment are separate release gates.

Work branches target `dev`; tested releases move from `dev` to `main`. Milestone 10 is built on `feat/launch` from merged `dev`. GitHub commits, pushes and merges remain with the repository owner. The milestone-10 feature checkpoint selected launch of the current features. Later progress, bookmarks, filters and guided-authoring features need separate approval. Automatic extraction is not part of the current roadmap.
