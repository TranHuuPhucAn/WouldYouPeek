# Would You Peek?

A Valorant decision-practice app for advanced players. Watch a professional player’s POV, make a choice at a paused moment, then watch the continuation and read conditional analysis. The demo contains three approved moments from TenZ’s ranked stream on Bind.

Matching the pro and making a defensible decision are separate outcomes. Explanations are AI-authored interpretations, with observable facts and missing context identified separately.

## Run locally

Install **Node.js 24.x**, npm and a running **Docker Desktop** (or compatible Docker runtime). The Supabase CLI is pinned in the project’s development dependencies; a global installation or hosted Supabase account is unnecessary.

```sh
git clone https://github.com/TranHuuPhucAn/WouldYouPeek.git
cd WouldYouPeek
npm ci
npm run db:start
npm run db:env
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). The first database start downloads local service images and applies the migrations and demo seed. `db:env` creates an ignored `.env.local` using the local API URL and public key; it never writes an administrator key into the application environment. `.env.example` documents the three settings.

Use **Watch demo** as a guest to view setup clips. Choose **Join the lab**, register with an email and a password of 12–128 characters including uppercase, lowercase and a number, then open the confirmation email in the [local email inbox](http://127.0.0.1:54324). These local emails are captured; no real email is sent. Password-reset and verification-resend messages use the same inbox.

After verification, start a session. Watch setup, choose an action, and submit. The answer is saved before the pro’s continuation and analysis appear. **Next scenario** advances the saved checkpoint; **Finish session** completes the final review. History retains completed sessions. Refreshing an unanswered scenario restarts setup; refreshing a saved answer restores review. Unsubmitted selections and video time are not persisted.

Under **Account**, any verified learner can enable creator access. Creators retain learner access. The creator landing is included; uploading, editing and publishing scenarios come in milestone four.

YouTube playback requires an internet connection. Use `127.0.0.1:3000` consistently: auth callbacks and mutation-origin checks are configured for that address. If changing the port or hostname, update `NEXT_PUBLIC_APP_URL` in `.env.local`, `auth.site_url` and `auth.additional_redirect_urls` in `supabase/config.toml`, then restart the app and local services.

Stop the web server with `Ctrl+C`; stop local services with `npm run db:stop`. Stopping preserves database volumes. Starting again restores accounts and sessions. **`npm run db:reset:local` deletes local accounts and progress**, recreates the disposable database and seeds the three scenarios; use it only when intentionally resetting local test data.

To serve an optimized build locally, keep Supabase running and use:

```sh
npm run build
npm start
```

## Verify

```sh
npm ci
npm run db:start
npm run db:reset:local
npm run db:env
npm run db:seed:check
npm run db:types:check
npm test
npm run test:db
npm run test:integration
npm run typecheck
npm run build
```

With the app running at `http://127.0.0.1:3000` in another terminal, run `npm run test:http` to exercise the actual Next.js API with two disposable learner accounts. CI runs this against the production build.

`npm test` runs fast backend/frontend tests; `test:backend` and `test:frontend` select a suite. `test:db` runs real PostgreSQL pgTAP tests. `test:integration` obtains ephemeral local test credentials from the running CLI, creates disposable accounts, exercises Auth/Data API/RPC behavior, and removes its own accounts. Its target guard rejects hosted addresses before administrative setup or cleanup. The local inbox retains test messages until you clear it.

`db:seed:generate` regenerates SQL from the canonical fixtures; `db:types` regenerates TypeScript from the local schema. Their `:check` counterparts detect drift. These scripts accept no extra remote-target arguments. Type checking first generates Next.js route types. Builds use Webpack; development uses Turbopack.

The GitHub Actions workflow runs clean installation, migration/seed/type checks, unit/component tests, real database/integration tests, type checking and a production build for pull requests into `dev` and `main`, and pushes to those branches. GitHub execution begins when you push; local container checks are recorded separately.

See [milestone-three verification](docs/milestone-3-verification.md) for exact results and remaining manual checks. The earlier milestone-two baseline was 203 tests; it does not verify accounts or persistence.

## Active scenarios

All three use [WASHED GAMER PLAYS APAC RANKED](https://www.youtube.com/watch?v=_yPrykaB2nE) from the verified TenZ channel: player POV, Clove on Bind, ranked. This is the approved fallback to VCT footage. No video has been downloaded or rehosted.

| Scenario                     | Setup | Decision | Continuation end |
| ---------------------------- | ----- | -------- | ---------------- |
| `bind-clove-utility-window`  | 28:25 | 28:33    | 28:38            |
| `bind-clove-smoke-contest`   | 31:25 | 31:29.5  | 31:37            |
| `bind-clove-advantage-reset` | 31:43 | 31:53    | 32:00.5          |

The last two moments are an explicitly linked pair in the same round. The first examines utility timing, the second a low-health contest while down a player, and the third how aggression changes after gaining a 3v1 advantage. None requires a uniquely preferred answer; the successful smoke contest is still assessed as risky.

See [scenario evidence and reasoning](docs/vod-scenarios.md) and the [approved implementation plan](docs/milestone-2-plan.md) for source review, file responsibilities and acceptance checks.

## Architecture and access

The app uses Next.js App Router, React, TypeScript, Supabase Auth and Postgres. Supabase SSR handles request-scoped cookies. The proxy refreshes identity; pages, services and database functions independently enforce access. Normal app requests use the caller’s session and public key. Administrator credentials exist only in guarded local test setup.

- `src/contracts/`: shared preview, account and saved-session contracts.
- `src/server/auth/`, `src/app/(auth)/`, `src/lib/supabase/`: validation, auth actions, confirmation/recovery callbacks, verified identity and cookie refresh.
- `src/server/training/` and `src/app/api/sessions/`: canonical session reads and atomic start, answer and advance commands.
- `src/lib/client/`, `src/lib/session/`, `src/hooks/use-challenge-session.ts`: validated responses, durable checkpoint hydration, retry reconciliation and auth-change cancellation.
- `src/components/challenge/`: the existing bounded YouTube player, choices, advanced analysis and recap.
- `supabase/migrations/`: profiles, versioned scenarios, sessions, immutable attempts, private answer keys and command receipts, RLS and narrowly granted functions.
- `supabase/fixtures/demo-scenarios.json`: the canonical authored dataset. `scripts/render-demo-seed.mjs` generates `supabase/seed.sql`; runtime repositories read the database.
- `tests/backend/`, `tests/frontend/`, `tests/integration/`, `supabase/tests/database/`: complementary unit, component, real-service and permission/transaction tests.

Guests can read setup-only previews. Verified accounts can play and read their own history. Creator enrollment affects only the current account and grants no access to other learners’ records. Private answer keys cannot be read directly through the public Data API. Session functions run under a restricted non-login role that does not own application tables or bypass row-level security. A separate trigger-only role synchronizes trusted email confirmation into a protected profile column; neither runtime role needs direct auth-table access.

Each session pins immutable scenario versions. Answers and review checkpoints commit together. One account has at most one active session. Commands carry a request UUID and expected revision; retrying an identical command returns the current canonical snapshot of its original session, even after completion. Reusing the UUID with different input fails. Losing a response or encountering a stale tab triggers reconciliation rather than another attempt.

## API

| Endpoint                                               | Access and result                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `GET /api/challenges`                                  | Public setup-only preview catalogue.                                            |
| `GET /api/challenges/[id]`                             | Public preview; no question, choices, feedback or reveal interval.              |
| `POST /api/challenges/[id]/answer`                     | Retired: guests receive 401; signed-in callers receive 409 `SESSION_REQUIRED`.  |
| `GET /api/account`                                     | Current account and capabilities.                                               |
| `POST /api/account/creator`                            | Verified self-enrollment; empty JSON object.                                    |
| `POST /api/sessions`                                   | `{ requestId }`; create or resume one active session.                           |
| `GET /api/sessions?cursor=...`                         | Own paginated history.                                                          |
| `GET /api/sessions/[sessionId]`                        | Own canonical saved session.                                                    |
| `POST /api/sessions/[sessionId]/items/[itemId]/answer` | `{ optionId, requestId, expectedRevision }`; atomically save answer and review. |
| `POST /api/sessions/[sessionId]/advance`               | `{ fromItemId, requestId, expectedRevision }`; advance review or finish.        |

Auth forms use Server Actions. Cookie-authenticated JSON writes require the configured same-origin request. Private responses use no-store handling. Missing or foreign sessions return 404; stale or conflicting commands return 409; unavailable storage returns 503 without a fixture fallback. Auth and input errors use safe messages without provider internals.

## Content and playback

Edit the canonical JSON fixture and increment `contentVersion` when changing published content, then regenerate and review the seed. Reapplying identical seed content is harmless; changing an existing version fails. A local reset is destructive and is not a content-update workflow for hosted data. Creator editing/publishing will provide that workflow in milestone four.

Each scenario needs player-visible context, unknowns, bounded setup/decision/continuation times, options with independent assessments, an observed action, conditional explanations and review evidence. Evaluate choices using information available before the pause. Do not infer a player’s intent or unavailable team communications. AI drafts and source audio need editorial review before publication.

The official YouTube iframe remains mounted through setup and decision. Playback pauses with a 0.30-second margin; browser scheduling and seeking are not frame-perfect. Replaying setup preserves an unsubmitted selection. Post-answer replay is read-only. Errors and blocked autoplay have explicit retry/play controls. The original public video and repository fixture remain inspectable; this is an educational reveal sequence, not an anti-cheating mechanism.

The seven `artifacts/vod-review/scenario-*.jpg` images preserve visual source evidence. Simulated player tests establish application behavior, not normal-speed audio quality or tactical correctness. No video is downloaded or rehosted, and no storage bucket is needed yet.

## Project progression

1. **Milestone one:** illustrative decision-player prototype.
2. **Milestone two:** three curated real player-POV VOD scenarios and conditional analysis.
3. **Milestone three:** verified accounts, learner/creator access, persistent versioned sessions and history.
4. **Milestone four:** creator scenario submission, editing, review and publishing.
5. **Milestone five:** automatic whole-VOD extraction into drafts, approved by a creator before publication.
6. Expand the reviewed library, improve feedback and analytics, then prepare hosted deployment and production email delivery.

Work branches target `dev`; tested releases move from `dev` to `main`. This milestone is built on `feat/user`. GitHub pushes and merges remain with the repository owner. Hosted deployment, custom SMTP, uploads, extraction and public publication are outside this milestone.
