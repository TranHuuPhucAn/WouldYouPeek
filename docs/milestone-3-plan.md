# Milestone three accounts and storage plan

Status: **implemented on `feat/user`; verification results recorded**. Prepared on 17 November 2026 from separate frontend and backend planning reviews. The user approved local implementation and testing with two new builders. See [verification results and remaining manual checks](milestone-3-verification.md). GitHub pushes and merges remain with the user.

Milestone three makes the three-scenario experience account-based and saves learning sessions. A visitor can inspect the demo and watch setup previews. A verified account can answer, watch the continuation and return to saved progress. Any verified account can enable creator access; creator authoring remains the next milestone.

## Confirmed product decisions

| Decision       | Planned behaviour                                                                                                                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Guest access   | Browse the three scenarios and watch setup-only previews. Signing in is required to play. Public preview payloads omit questions, choices, feedback and continuation bounds. This is the proposed interpretation of “view the demo.” |
| Authentication | Email and password, email verification, sign-in, sign-out, confirmation resend and password reset.                                                                                                                                   |
| Learner access | Every verified account can start or resume training and inspect its own history.                                                                                                                                                     |
| Creator access | Every verified account can enable creator access for itself. No manual approval queue. Creator capability includes learner access.                                                                                                   |
| Content        | Keep the three approved VOD scenarios and existing conditional analysis. Move their active runtime source to the database.                                                                                                           |
| Persistence    | Save committed answers, the current scenario, the review checkpoint and completion. Preserve previous sessions.                                                                                                                      |
| Resume         | One active session per account. Starting returns that session if it exists; Play again after completion creates a new session.                                                                                                       |
| Unsaved state  | Radio selections, video time and playback state remain local. Reloading an unanswered scenario restarts its setup; reloading an answered scenario restores its review.                                                               |
| Assessment     | Pro comparison remains independent of tactical assessment. History must not label matching the pro as accuracy, rank or skill.                                                                                                       |

Uploads, scenario editing/publishing, automatic VOD extraction, creator approval of generated drafts, payments, social login, account-profile editing and public deployment are outside this milestone. There will be no storage bucket yet: YouTube continues hosting the videos.

## Recommended stack and local setup

Keep Next.js App Router, React, TypeScript, existing CSS, Vitest and Testing Library. Add **Supabase Auth and Postgres**, using `@supabase/supabase-js` and `@supabase/ssr`. Use SQL migrations and generated database types; an additional ORM is unnecessary for this scope.

Supabase's SSR package supports cookie-based sessions. Use its browser and request-scoped server clients; verify identity rather than trusting the user object from an unverified session cookie. Refresh responses must preserve the provider's cookie and cache headers. [Supabase SSR guide](https://supabase.com/docs/guides/auth/server-side/nextjs)

Develop against a local Supabase stack with the CLI and a Docker-compatible container runtime. Its local email inbox supports confirmation and recovery testing without sending real email. The committed configuration, migrations and seed should reproduce the same demo dataset. [Local Supabase setup](https://supabase.com/docs/guides/local-development/cli/getting-started)

Hosted Supabase and an email provider can be configured later. Before testing hosted signup with ordinary users, configure custom SMTP: Supabase's default mail service restricts recipients and is not intended for production use. No hosted project or SMTP account will be created during planning. [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp)

Node 24.x remains the documented development target. Build preparation must repair and verify the existing native-dependency lockfile portability issue with a clean install; the earlier registry repair was canceled and is not considered complete. Pin compatible new dependencies when implementing and validate the lockfile on a clean Linux CI runner as well as the development machine.

## Access and session boundaries

| Capability                     | Guest            | Verified learner      | Creator          |
| ------------------------------ | ---------------- | --------------------- | ---------------- |
| Browse demo and watch setup    | Yes              | Yes                   | Yes              |
| Answer and reveal continuation | No               | Own session           | Own session      |
| Read saved progress/history    | No               | Own only              | Own only         |
| Enable creator access          | No               | For self              | Already enabled  |
| Open creator landing           | Sign-in redirect | Link to enable access | Yes              |
| Edit/publish/upload            | No               | No                    | Future milestone |

The UI is not the permission boundary. Server pages, Server Actions, API handlers and database functions enforce the appropriate identity and ownership checks. `src/proxy.ts` refreshes auth cookies and provides early routing; it does not replace those checks. This matches the installed Next.js 16 authentication and Proxy guidance.

Store the current role in trusted database state. Do not accept a role, user ID, assessment or pro-choice flag from signup metadata or an answer request. Creator enrollment is a dedicated authenticated operation that can only enable the caller's own creator capability. A creator receives no access to another learner's sessions.

Database tables require explicit grants and row-level security. Keep answer keys and internal review metadata separate from preview data. Test access through the Supabase Data API and RPC endpoints as well as through Next.js; a hidden frontend control is insufficient. Privileged SQL functions require narrow execute grants, explicit caller/ownership checks and a fixed search path. [Row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security), [database functions](https://supabase.com/docs/guides/database/functions)

Authenticated responses use private, no-store handling. Auth changes cancel pending requests and unmount the player. Browser observations of auth state help refresh the UI; the server remains authoritative. Return destinations are restricted to approved same-origin app paths, and cookie-authenticated mutations reject cross-origin requests.

The original VOD and this project's seed content remain inspectable outside the training UI. These controls protect accounts, saved records and the normal reveal sequence; they are not an anti-cheating guarantee.

## Canonical training behaviour

1. Start or resume returns the account's one active session. Concurrent starts cannot create two active sessions.
2. The session pins the three selected content versions. Later scenario edits do not rewrite an existing attempt.
3. Completing setup exposes the decision locally. An unsubmitted choice is not a saved answer.
4. Submission sends only the option ID, session item ID, request ID and expected session revision. The database validates the option and derives feedback.
5. Saving the answer and moving the durable checkpoint to review happen atomically. The UI reveals the continuation only after the saved response, or after reconciliation confirms that the save succeeded.
6. Next advances one item. Finish on the final review marks the session completed. Failed advancement keeps the feedback visible.
7. Replaying setup or continuation is read-only and creates no new attempt.
8. A retried command with the same request ID and payload returns its recorded outcome before checking an obsolete revision. Reusing that ID for different input fails. A genuinely stale command reloads the canonical session instead of overwriting it.
9. Refresh or a later sign-in restores the server checkpoint. Completion shows the historical recap; Play again starts a separate history record.

The milestone will test persistence across reload, sign-out/sign-in, a fresh browser context and app/database-service restart without resetting the database. Cross-device use additionally requires a reachable hosted service and is not established by localhost-only testing.

## Shared API contract

These are proposed interfaces to freeze before the two builders work in parallel. `src/contracts/session.ts` is the canonical filename for training-session contracts; authentication contracts belong in `auth.ts`.

```ts
type AccountUser = {
  id: string;
  email: string;
  emailVerified: boolean;
  role: "learner" | "creator";
  capabilities: ("learn" | "create")[];
  createdAt: string;
};

type SessionSnapshot = {
  id: string;
  status: "in_progress" | "completed";
  phase: "setup" | "review" | "completed";
  revision: number;
  currentIndex: number | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  items: {
    id: string;
    position: number;
    challenge: ChallengeDetail;
    answer: {
      id: string;
      answeredAt: string;
      result: AnswerResponse;
    } | null;
  }[];
};

type SessionMutationResponse = {
  session: SessionSnapshot;
  replayed: boolean;
};

type CreateSessionResponse = SessionMutationResponse & { created: boolean };
```

New record and request IDs are UUIDs; dates are ISO timestamps. Existing authored challenge IDs and `contentVersion` strings remain intact. `ChallengePreview` contains summary fields, context, source and setup only. `SessionSummary` contains session ID, status, answered/total counts and dates; the history response is `{ sessions: SessionSummary[], nextCursor: string | null }`. No separate aggregate progress table is needed.

`AuthFormState` contains pending/success/error status, safe field errors, an optional generic message and retry timing when available. It never echoes passwords, tokens or auth-provider internals. `AnswerResponse` retains its current independent assessment and pro-comparison fields.

| Endpoint or action                                     | Inputs                                                | Result and access                                                                                                |
| ------------------------------------------------------ | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `GET /api/challenges`                                  | None                                                  | Public preview catalogue.                                                                                        |
| `GET /api/challenges/[id]`                             | Authored challenge ID                                 | Public setup-only preview.                                                                                       |
| Existing `POST /api/challenges/[id]/answer`            | Legacy request                                        | Retired: 401 for guests; 409 `SESSION_REQUIRED` for authenticated callers. It cannot bypass persistent training. |
| Auth Server Actions                                    | Validated form fields                                 | Sign up/in/out, request reset, resend confirmation and update password.                                          |
| `GET /auth/confirm`                                    | Supported token hash/type and safe return destination | Verify confirmation/recovery token, set cookies and redirect. Invalid or expired links use an auth error page.   |
| `GET /api/account`                                     | Auth cookie                                           | Safe current-account DTO.                                                                                        |
| `POST /api/account/creator`                            | Empty body                                            | Enable only the current verified user's creator capability; repeated calls are harmless.                         |
| `POST /api/sessions`                                   | `{ requestId }`                                       | Create or resume the single active session; return `CreateSessionResponse`.                                      |
| `GET /api/sessions?cursor=...`                         | Validated opaque cursor; bounded page size            | Current user's paginated history.                                                                                |
| `GET /api/sessions/[sessionId]`                        | Session UUID                                          | Current user's canonical `SessionSnapshot`.                                                                      |
| `POST /api/sessions/[sessionId]/items/[itemId]/answer` | `{ optionId, requestId, expectedRevision }`           | Atomically save and return `SessionMutationResponse`.                                                            |
| `POST /api/sessions/[sessionId]/advance`               | `{ fromItemId, requestId, expectedRevision }`         | Acknowledge review, advance or finish; return `SessionMutationResponse`.                                         |

The UI uses server actions for auth forms and the existing JSON API style for account/session interactions. Server-rendered pages call the service layer directly rather than fetching their own API routes.

Keep the existing 400 validation errors and generic 500 error. Add `AUTH_REQUIRED` (401), `EMAIL_NOT_VERIFIED` and `CREATOR_REQUIRED` (403), `SESSION_NOT_FOUND` (404 for missing or foreign-owned sessions), `SESSION_CONFLICT`, `ANSWER_LOCKED`, `IDEMPOTENCY_CONFLICT` and `SESSION_REQUIRED` (409), provider throttling (429), and `STORAGE_UNAVAILABLE` (503). No database outage silently changes saved play into a local-only demo.

An idempotency receipt binds the caller, request ID, operation and logical payload. Replay detection occurs before revision validation and returns the **current canonical snapshot** of the original session, not a stale copy of its earlier state. This prevents a delayed retry from moving the UI backwards or creating another session after the original session completes.

## Planned file tree

`N` means new and `M` means modified after approval. The current video component and timing modules are retained. Shared contract/config files have one assigned owner during implementation; both builders review their interfaces.

```text
would-you-peek/
├── .env.example                                             N
├── .gitignore                                               M
├── package.json / package-lock.json                          M
├── vitest.config.ts                                         M
├── README.md                                                M
├── .github/workflows/ci.yml                                 N
├── docs/milestone-3-plan.md                                 planning only
├── scripts/render-demo-seed.mjs                             N
├── supabase/
│   ├── config.toml                                          N
│   ├── fixtures/demo-scenarios.json                         N
│   ├── seed.sql                                             N, generated
│   ├── templates/confirmation.html                         N
│   ├── templates/recovery.html                             N
│   ├── migrations/
│   │   ├── <timestamp>_accounts_and_roles.sql               N
│   │   ├── <timestamp>_versioned_scenarios.sql              N
│   │   ├── <timestamp>_training_sessions.sql                N
│   │   └── <timestamp>_access_and_rpcs.sql                  N
│   └── tests/database/
│       ├── accounts_and_roles.test.sql                     N
│       ├── content_disclosure.test.sql                     N
│       └── session_integrity.test.sql                      N
├── src/
│   ├── proxy.ts                                             N
│   ├── contracts/
│   │   ├── challenge.ts                                     M
│   │   ├── auth.ts                                          N
│   │   └── session.ts                                       N
│   ├── types/database.ts                                   N, generated
│   ├── app/
│   │   ├── layout.tsx / page.tsx / globals.css              M
│   │   ├── demo/page.tsx                                    N
│   │   ├── play/page.tsx                                    M
│   │   ├── play/[sessionId]/page.tsx                        N
│   │   ├── history/page.tsx                                 N
│   │   ├── account/page.tsx                                 N
│   │   ├── creator/page.tsx                                 N
│   │   ├── (auth)/
│   │   │   ├── actions.ts                                  N
│   │   │   ├── sign-in/page.tsx                             N
│   │   │   ├── sign-up/page.tsx                             N
│   │   │   ├── check-email/page.tsx                         N
│   │   │   ├── forgot-password/page.tsx                    N
│   │   │   └── reset-password/page.tsx                     N
│   │   ├── auth/confirm/route.ts                           N
│   │   ├── auth/error/page.tsx                             N
│   │   └── api/
│   │       ├── account/route.ts                            N
│   │       ├── account/creator/route.ts                    N
│   │       ├── challenges/route.ts                         M
│   │       ├── challenges/[id]/route.ts                    M
│   │       ├── challenges/[id]/answer/route.ts             M
│   │       ├── sessions/route.ts                           N
│   │       ├── sessions/[sessionId]/route.ts               N
│   │       ├── sessions/[sessionId]/advance/route.ts       N
│   │       └── sessions/[sessionId]/items/[itemId]/
│   │           └── answer/route.ts                         N
│   ├── components/
│   │   ├── navigation/SiteHeader.tsx                       N
│   │   ├── auth/
│   │   │   ├── SignInForm.tsx                              N
│   │   │   ├── SignUpForm.tsx                              N
│   │   │   ├── ForgotPasswordForm.tsx                      N
│   │   │   ├── ResetPasswordForm.tsx                       N
│   │   │   └── AuthStateSync.tsx                           N
│   │   ├── account/AccountPanel.tsx                        N
│   │   ├── demo/DemoPreview.tsx                            N
│   │   ├── sessions/PlayDashboard.tsx                      N
│   │   ├── sessions/SessionHistory.tsx                     N
│   │   ├── sessions/SessionPersistenceNotice.tsx          N
│   │   └── challenge/
│   │       ├── ChallengePlayer.tsx                         M
│   │       ├── FeedbackPanel.tsx                           M
│   │       └── SessionRecap.tsx                            M
│   ├── hooks/use-challenge-session.ts                       M
│   ├── lib/
│   │   ├── supabase/browser.ts                             N
│   │   ├── supabase/server.ts                              N
│   │   ├── supabase/proxy.ts                               N
│   │   ├── client/
│   │   │   ├── api-response.ts                             N
│   │   │   ├── challenge-validation.ts                    N
│   │   │   ├── challenge-api.ts                            M
│   │   │   ├── account-api.ts                              N
│   │   │   └── session-api.ts                              N
│   │   └── session/
│   │       ├── session-reducer.ts                          M
│   │       └── hydrate-session.ts                          N
│   └── server/
│       ├── config.ts                                        N
│       ├── http.ts                                          M
│       ├── auth/
│       │   ├── service.ts                                   N
│       │   ├── guards.ts                                    N
│       │   ├── validation.ts                               N
│       │   └── redirects.ts                                N
│       ├── account/service.ts                              N
│       ├── challenges/
│       │   ├── data.ts                                      M
│       │   ├── repository.ts                               N
│       │   └── service.ts                                   M
│       └── training/
│           ├── validation.ts                               N
│           ├── repository.ts                               N
│           ├── projections.ts                              N
│           └── service.ts                                   N
└── tests/
    ├── backend/                                             new and adapted tests below
    ├── frontend/                                            new and adapted tests below
    └── integration/
        ├── auth.test.ts                                     N
        ├── access-control.test.ts                           N
        ├── session-persistence.test.ts                      N
        └── helpers/
            ├── local-supabase.ts                            N
            └── test-users.ts                                N
```

The full paths above are proposed repository-relative paths, not files already implemented. Function names can be adjusted during implementation when they preserve these responsibilities and the approved contract.

## Frontend agent report

The frontend reuses the video/decision/review components while replacing the production in-memory session coordinator with a persistent one. Public preview has its own small component and cannot mount the interactive answer flow. Generic video code remains independent of authentication; invalidating an account unmounts the player and cancels its work.

| File or group                                                    | Planned functions and purpose                                                                                                                                                                                                  | Planned tests                                                                                                                                       |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/layout.tsx`, `components/navigation/SiteHeader.tsx`         | `RootLayout()` and `SiteHeader({viewer})` share navigation and server-provided role links. Remove duplicated headers from the existing homepage/player.                                                                        | Guest, learner and creator links; identity refresh; protected services still enforce access.                                                        |
| `app/page.tsx`                                                   | `HomePage()` distinguishes Watch demo from Sign in to play and describes saved progress.                                                                                                                                       | Correct links and no anonymous interactive entry.                                                                                                   |
| `app/demo/page.tsx`, `components/demo/DemoPreview.tsx`           | `DemoPage()` loads previews; `DemoPreview()` renders only setup; `selectPreview(id)` replaces the active video.                                                                                                                | No question/options/reveal; switching destroys the prior iframe; boundary and replay regressions.                                                   |
| `app/play/page.tsx`, `components/sessions/PlayDashboard.tsx`     | `PlayPage()` requires a verified account and loads its active summary; `PlayDashboard()` shows start/resume; `startOrResume()` retains one request ID until resolved.                                                          | Auth redirect, resume, duplicate clicks, lost creation response, recovery from failure.                                                             |
| `app/play/[sessionId]/page.tsx`                                  | `SavedSessionPage()` verifies ownership and supplies a canonical snapshot to the player.                                                                                                                                       | Own session; missing/foreign session; completed recap.                                                                                              |
| Auth page files                                                  | `SignInPage()`, `SignUpPage()`, `CheckEmailPage()`, `ForgotPasswordPage()`, `ResetPasswordPage()`, `AuthErrorPage()` select forms/status and safe destinations. Check-email offers resend.                                     | Expired links, resend state, signed-in routing, no credentials in URLs, reset requires authenticated recovery session.                              |
| Four auth form files                                             | `SignInForm()`, `SignUpForm()`, `ForgotPasswordForm()`, `ResetPasswordForm()` use `useActionState` with backend actions. Show accessible field errors, submission state and provider outcomes.                                 | Keyboard/focus, required inputs, duplicate submit, bad credentials, generic reset responses, mismatched password confirmation, successful recovery. |
| `lib/supabase/browser.ts`                                        | `createBrowserSupabaseClient()` creates the supported browser client for auth state synchronization, using public configuration only.                                                                                          | Singleton reuse where appropriate, missing config, no server-only imports.                                                                          |
| `components/auth/AuthStateSync.tsx`                              | `AuthStateSync()`, `handleAuthChange()`, `recheckViewer()` subscribe to auth events and revalidate on tab return. Cancel account-specific work and refresh navigation.                                                         | Sign-out/account switch across tabs, no late response shown to another user, cleanup/unsubscribe.                                                   |
| `app/account/page.tsx`, `components/account/AccountPanel.tsx`    | `AccountPage()` loads own account; `AccountPanel()` shows email/role, sign-out/reset and self-enrollment; `enableCreatorAccess()` confirms the server response before changing UI.                                             | Enrollment, retries, malformed account, retained learner access and no optimistic role escalation.                                                  |
| `app/creator/page.tsx`                                           | `CreatorPage()` checks creator capability and renders a small access-confirmation landing. A learner gets a link to enable access.                                                                                             | Guest redirect, learner onboarding, creator access; no functioning editor/upload controls implied.                                                  |
| `app/history/page.tsx`, `components/sessions/SessionHistory.tsx` | `HistoryPage()` loads owned summaries; `SessionHistory()` displays date/progress/review links; `loadMore()` merges cursor pages without duplicates.                                                                            | Empty/loading/error/history states, pagination and no accuracy/rank label.                                                                          |
| `lib/client/api-response.ts`                                     | `readApiResponse()` and `parseApiError()` centralize JSON/no-store handling and typed failures.                                                                                                                                | Malformed JSON, invalid success/error payloads, aborts and all new error statuses.                                                                  |
| `lib/client/challenge-validation.ts`                             | `parseChallengePreview()`, `parseChallengeDetail()`, `parseAnswerResponse()`, `validateAnswerForChallenge()` reuse current validation with explicit preview boundaries.                                                        | Existing media/option/comparison cases, accidental answer fields in previews, historical version agreement.                                         |
| `lib/client/challenge-api.ts`                                    | `getChallenges()` and `getChallengePreview()` call only public preview endpoints. Remove production use of stateless answer submission.                                                                                        | Safe previews, wrong DTO rejection, no anonymous answer call.                                                                                       |
| `lib/client/account-api.ts`                                      | `getAccount()` and `enableCreatorAccess()` validate current-account responses and the dedicated no-body enrollment operation.                                                                                                  | Role/capability consistency, malformed response, repeated enable and auth failures.                                                                 |
| `lib/client/session-api.ts`                                      | `createOrResumeSession()`, `getSession()`, `listSessions()`, `answerSessionItem()`, `advanceSession()`, `parseSessionSnapshot()` validate requests and canonical results.                                                      | Requested session/item IDs, revision/index/phase consistency, locked versions, missing/extra feedback and malformed history.                        |
| `lib/session/hydrate-session.ts`                                 | `hydrateSessionSnapshot()` maps validated server checkpoints into UI state; `getCompletedChallenges()` derives recap entries from saved answers.                                                                               | Setup/review/final-review/completed hydration, no duplicate attempt, historical feedback.                                                           |
| `lib/session/session-reducer.ts`                                 | Extend `sessionReducer()` and `createInitialSessionState()` for canonical hydration, request states and auth-required state; keep local choice/replay transitions.                                                             | No invented server completion; reject stale identity/session/revision; retry, replay and selection preservation.                                    |
| `hooks/use-challenge-session.ts`                                 | `useChallengeSession(initialSession,viewerId)`, `submitSelection()`, `advance()`, `reconcileSession()`, `retrySave()`, `createNextSession()`, `invalidateIdentity()` coordinate commands, stable request IDs and cancellation. | Concurrent clicks, lost response, same-command retry, revision conflict, two tabs, identity change, unmount and final Finish.                       |
| `components/challenge/ChallengePlayer.tsx`                       | `ChallengePlayer({initialSession,viewer})` connects the existing player flow to saved state.                                                                                                                                   | Actual seeded catalogue, save before reveal, iframe preservation, restored checkpoint.                                                              |
| `components/challenge/FeedbackPanel.tsx`                         | `FeedbackPanel()` adds advancement pending/error state and retains read-only replay.                                                                                                                                           | Failed Next/Finish keeps feedback; retry cannot skip an item.                                                                                       |
| `components/challenge/SessionRecap.tsx`                          | `SessionRecap()` adds saved dates/history links and a new-session action.                                                                                                                                                      | Old attempts are immutable; a new run is separate; comparison remains independent of assessment.                                                    |
| `components/sessions/SessionPersistenceNotice.tsx`               | `SessionPersistenceNotice()` announces Saving, Saved, retry or sign-in-required state.                                                                                                                                         | No Saved label before acknowledgement; accessible status changes; no database/revision jargon in product copy.                                      |
| `app/globals.css`                                                | Styles for auth forms, shared header, dashboard, history and account states. No new UI framework.                                                                                                                              | Desktop/mobile layout, focus visibility, readable validation/status messages.                                                                       |

## Backend agent report

The backend moves content and training records into Postgres while keeping authored feedback deterministic. Supabase manages credentials; application tables never store passwords. Server services use the caller's verified auth context and ordinary user-scoped database clients, not a service-role client for normal learner requests.

### Storage model

| Table                           | Main fields and purpose                                                                                           | Constraints and access                                                                                                                              |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `public.profiles`               | `user_id`, `role`, `created_at`, `creator_enabled_at`                                                             | Auth-user foreign key; default learner; own read; no general client role writes.                                                                    |
| `public.scenarios`              | Stable authored ID, catalogue metadata, current version, demo/publication flags                                   | Public preview functions select allowed fields; no creator content writes in this milestone.                                                        |
| `public.scenario_versions`      | UUID, scenario ID, content version, immutable safe challenge JSON, checksum, timestamp                            | Unique scenario/version; immutable payload; referenced versions cannot be deleted. Anonymous users cannot directly read the full challenge payload. |
| `private.scenario_answer_keys`  | Version ID, full feedback/continuation and internal review metadata                                               | Unexposed schema; no guest or ordinary authenticated table privileges.                                                                              |
| `public.training_sessions`      | ID, user ID, phase, current index, revision, timestamps                                                           | One noncompleted session per account; valid phase/index constraints; own read; narrow RPC writes.                                                   |
| `public.training_session_items` | ID, session/user IDs, position, scenario-version ID                                                               | Unique session/position; consistent ownership foreign keys; fixed order and versions.                                                               |
| `public.attempts`               | ID, item/session/user IDs, selected option, saved answer JSON, timestamp                                          | One immutable answer per item; own read; assessments derived by the database.                                                                       |
| `private.session_commands`      | Caller/request IDs, operation, payload fingerprint, session ID, resulting revision, original creation-result flag | Unique caller/request ID; internal receipt only; start commands preserve whether they created or resumed a session.                                 |

Keep the auth identity in Supabase's managed auth tables. A private signup trigger creates the application's learner profile without trusting user-provided role metadata. Keep answer snapshot schema versions explicit so future format changes can preserve historical rendering.

Definer functions will be owned by a dedicated `NOLOGIN`, non-`BYPASSRLS` role that **does not own the tables**. Grant it only the needed schema/table/column privileges and explicit owner-scoped RLS policies. Implementation adjustment: Supabase’s managed `auth` schema does not grant the migration executor schema-usage grant authority. A separate restricted `wyp_auth_sync` trigger role copies only the trusted confirmation timestamp from auth INSERT/UPDATE events into `profiles.email_verified_at`. The training RPC role reads this protected field and caller claims; it receives no auth-table access. Neither role owns application tables or bypasses RLS. Tests cover confirmation revocation with an existing JWT and direct REST reads. Revoke default PUBLIC execute and grant access only to the intended callers. Table ownership, execute grants and RLS policies are tested together; merely declaring a non-bypass role does not make a privileged function safe.

### SQL responsibilities

| Migration or SQL function                                                                | Purpose                                                                                                                                               | Planned verification                                                                                             |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `accounts_and_roles.sql`                                                                 | Create profile schema/defaults, trigger, role constraints and initial policies. `private.handle_new_auth_user()` inserts the default learner profile. | Signup creates one learner; injected role metadata ignored; user cannot write role or another profile.           |
| `versioned_scenarios.sql`                                                                | Create scenario/version/answer-key tables, uniqueness and immutability constraints.                                                                   | Safe/private separation, duplicate version handling, content immutability and retained historical references.    |
| `training_sessions.sql`                                                                  | Create sessions, ordered items, immutable attempts, receipts and ownership indexes/constraints.                                                       | One active session, one attempt/item, valid cursor/phase and composite ownership.                                |
| `access_and_rpcs.sql`                                                                    | Define minimal function-owner grants, RLS policies, execute privileges and the functions below.                                                       | Schema/grant tests with real anonymous/authenticated roles, including direct RPC calls.                          |
| `public.enable_creator()`                                                                | Verify caller and enable only their creator capability, preserving the initial enable timestamp on retry.                                             | Repeated enrollment, foreign-user mutation denial, learner access retained.                                      |
| `public.list_scenario_previews()`, `public.get_scenario_preview()`                       | Select only published demo preview fields.                                                                                                            | Anonymous preview succeeds; question/options/answer/reveal/private review fields are absent.                     |
| `public.start_training_session(request_id)`                                              | Resolve receipt, resume active session or create a version-pinned three-item session.                                                                 | Concurrent start, lost response, delayed retry after completion, exactly one active session.                     |
| `public.get_training_session(session_id)`, `public.list_training_sessions(cursor,limit)` | Return only caller-owned canonical data or paginated summaries.                                                                                       | Another user's IDs produce no data; cursor validation and stable pagination.                                     |
| `public.submit_session_answer(...)`                                                      | Lock session, verify current item/revision/option, derive feedback, write attempt/receipt/review checkpoint atomically.                               | Duplicate and concurrent submissions, forged assessment, invalid option/phase, rollback and version consistency. |
| `public.advance_training_session(...)`                                                   | Require the current answered item; record receipt and advance one item or mark complete.                                                              | No skip, idempotent replay, stale revisions and final review retention.                                          |
| Private verification/snapshot/receipt helpers                                            | `require_verified_user()`, `read_session_snapshot()`, `match_session_command()` centralize identity, projection and replay checks.                    | Cannot be called as unrestricted API helpers; fixed search path and caller isolation.                            |

### Server files and functions

| File                                                                  | Planned functions and purpose                                                                                                                                                                             | Planned tests                                                                                                                       |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `contracts/auth.ts`, `contracts/session.ts`, `contracts/challenge.ts` | Types for account, forms, previews, saved sessions/commands/history and expanded errors. No executable functions.                                                                                         | Type checking and runtime contract tests on both sides.                                                                             |
| `server/config.ts`                                                    | `getPublicSupabaseConfig()`, `getServerAppConfig()` validate URL, publishable key and trusted app origin.                                                                                                 | Missing/malformed settings; secrets never included in public config.                                                                |
| `lib/supabase/server.ts`                                              | `createServerSupabaseClient()` uses awaited Next cookies and supported SSR adapters; create per request.                                                                                                  | Cookie read/write/chunks; no shared client identity between requests.                                                               |
| `lib/supabase/proxy.ts`                                               | `refreshAuthSession(request)` uses verified claims and preserves cookie/cache headers through replacement responses.                                                                                      | Token refresh, redirects and header preservation.                                                                                   |
| `src/proxy.ts`                                                        | `proxy(request)` and `config.matcher` provide refresh/coarse redirects while excluding static resources.                                                                                                  | Public demo access, protected redirect, no loops; services independently authorize.                                                 |
| `server/auth/guards.ts`                                               | `getCurrentAccount()`, `requireVerifiedUser()`, `requireCreator()` verify identity and current profile/capabilities close to the protected operation.                                                     | Forged/expired/missing session, unverified email, role changes, creator inheritance.                                                |
| `server/auth/validation.ts`                                           | `parseSignInInput()`, `parseSignUpInput()`, `parseResetRequest()`, `parseNewPassword()` reject extra/oversized fields and enforce configured policy. Do not trim passwords.                               | Invalid shape, role injection, confirmation mismatch and password boundaries.                                                       |
| `server/auth/redirects.ts`                                            | `safeReturnTo()` accepts only intended app destinations; `buildAuthRedirect()` uses configured origin.                                                                                                    | External, protocol-relative, encoded/backslash bypasses and valid owned-session paths.                                              |
| `server/auth/service.ts`                                              | `signUp()`, `signIn()`, `requestPasswordReset()`, `resendVerification()`, `verifyEmailToken()`, `updatePassword()`, `signOut()` wrap provider operations and safe errors.                                 | Signup/verification, bad credentials, generic account-existence responses, throttling, password recovery and current-device logout. |
| `app/(auth)/actions.ts`                                               | `signUpAction()`, `signInAction()`, `requestResetAction()`, `resendVerificationAction()`, `updatePasswordAction()`, `signOutAction()` validate, call services and return typed form state/safe redirects. | Action authorization, origin handling, errors and form integration.                                                                 |
| `app/auth/confirm/route.ts`                                           | `GET()` accepts supported confirmation/recovery token types, verifies the token and forwards cookies to a safe redirect.                                                                                  | Expired/reused/invalid links; signup and recovery destinations; no token logging.                                                   |
| `server/account/service.ts`                                           | `getAccount()` maps own safe user/profile; `enableCreator()` calls the self-enrollment RPC.                                                                                                               | No target-user/role body, repeated enable and verified-account requirement.                                                         |
| `server/challenges/repository.ts`                                     | `listPreviewRecords()`, `findPreviewRecord()` query explicit database preview projections.                                                                                                                | Mapping, missing record and unavailable storage; direct disclosure integration tests.                                               |
| `server/challenges/service.ts`                                        | `listChallengePreviews()`, `getChallengePreview()` whitelist public DTOs. Remove runtime fixture-answer evaluation.                                                                                       | No public question/answer/reveal fields; no silent fixture fallback.                                                                |
| `server/challenges/data.ts`                                           | Retain a thin server-only typed fixture export from canonical seed JSON for regression tests; production repositories use the database.                                                                   | Dataset integrity and no divergent duplicate catalogue.                                                                             |
| `server/training/validation.ts`                                       | `parseStartSession()`, `parseAnswerCommand()`, `parseAdvanceCommand()`, `parseHistoryCursor()` enforce IDs, revision, input shape and bounds.                                                             | Reject injected user/role/assessment/progress fields, malformed IDs and cursors.                                                    |
| `server/training/repository.ts`                                       | `startOrResumeSession()`, `findSession()`, `listSessions()`, `submitSessionAnswer()`, `advanceSession()` call narrow RPCs with the caller's JWT.                                                          | Parameters/error mapping; no privileged runtime client.                                                                             |
| `server/training/projections.ts`                                      | `toSessionSnapshot()`, `toSessionSummary()`, `toSavedAnswer()` validate and project database results.                                                                                                     | Unanswered feedback omitted; foreign/internal fields excluded; corrupt state fails closed.                                          |
| `server/training/service.ts`                                          | `startSession()`, `getSession()`, `getHistory()`, `answerSessionItem()`, `advanceSession()` combine auth, validation, repository and projection.                                                          | Ownership, reconciliation, duplicate commands, final feedback and storage failure.                                                  |
| `server/http.ts`                                                      | Extend `ApiError`, `jsonResponse()`, `errorResponse()`, `handleRoute()` and add `requireSameOrigin()` for cookie-authenticated JSON writes.                                                               | Standard status/error bodies, generic 500, private no-store, origin/content-type rejection.                                         |
| New and modified API route files                                      | Thin `GET()`/`POST()` adapters for the endpoint table above; no duplicated business rules.                                                                                                                | Real Request/Response tests for valid requests, missing auth, ownership, body errors and DB failure.                                |
| `scripts/render-demo-seed.mjs`                                        | `readFixtures()`, `validateFixtures()`, `renderSeedSql()` create deterministic safely escaped seed SQL from JSON.                                                                                         | Stable output, invalid relationships, SQL escaping, changed-content/version conflict.                                               |
| `types/database.ts`                                                   | Generated schema/RPC types; no handwritten functions.                                                                                                                                                     | Regenerate after migrations and require no unexplained diff.                                                                        |

### Seed and configuration files

Move the authored dataset into `supabase/fixtures/demo-scenarios.json` as the single canonical seed fixture. The Node seed renderer reads JSON directly; it must not import the current `server-only` module in an ordinary Node process. The existing fixture export reads the same JSON for regression tests.

Generated `seed.sql` uses stable version IDs. Identical reapplication is harmless; changed content under the same version ID fails rather than overwriting history. Updating published content requires a new version. Keep the seven existing review evidence images and their references. A reset/seed command applies only to an explicitly local/test database, never automatically on hosted application startup.

`supabase/config.toml` configures local auth, email confirmation, allowed redirects, database exposure, seed files and local test services. The confirmation/recovery templates target the safe server callback. `.env.example` documents public Supabase configuration and application origin with placeholders; `.gitignore` must explicitly allow this example while continuing to exclude real `.env` files and local Supabase state.

`package.json` adds documented database/test/type-generation/seed commands and compatible SDK/CLI dependencies. `vitest.config.ts` separates fast unit/component tests from opt-in real-service integration tests. `.github/workflows/ci.yml` runs clean installation, migration/seed checks, database tests, integration tests, type checking and build for pull requests into `dev` and `main`. Runtime credentials are never committed; local test service credentials are ephemeral. README will explain local services, email inbox, environment setup and all verification commands.

## Test files and acceptance gates

Add frontend tests: `auth-forms.test.tsx`, `auth-state-sync.test.tsx`, `account-panel.test.tsx`, `demo-preview.test.tsx`, `play-dashboard.test.tsx`, `session-history.test.tsx`, `session-api.test.ts`, `account-api.test.ts`, `hydrate-session.test.ts` and `saved-session-flow.test.tsx` under `tests/frontend/`.

Add backend tests: `auth-service.test.ts`, `auth-guards.test.ts`, `auth-validation.test.ts`, `auth-redirects.test.ts`, `auth-confirm.test.ts`, `account-service.test.ts`, `training-service.test.ts`, `training-projections.test.ts`, `training-routes.test.ts` and `seed-renderer.test.ts` under `tests/backend/`.

Adapt the existing challenge API/service/routes, HTTP, reducer, hook, player and recap tests for the intentional access/contract changes. Preserve meaningful YouTube lifecycle, native-video, timing and conditional-feedback coverage. The previous 203 passing tests are a baseline, not evidence that the proposed authentication/database features pass.

The integration helpers `createLocalTestClient()`, `assertLocalTestTarget()`, `createVerifiedTestUser()` and `cleanupTestUsers()` use a dedicated local test environment. They reject hosted database targets for destructive setup/teardown and never run in production app code. DB pgTAP tests and application-level calls provide complementary evidence. [Supabase database testing](https://supabase.com/docs/guides/local-development/testing/overview)

Proposed verification commands after implementation:

```sh
npm ci
npm run db:start
npm run db:reset:local
npm run db:seed:check
npm run db:types:check
npm test
npm run test:db
npm run test:integration
npm run typecheck
npm run build
```

`db:reset:local` is only for a disposable local test database. `db:seed:check` compares the deterministic renderer with committed seed SQL; `db:types:check` compares regenerated database types with the committed file. `npm test` remains the fast backend/frontend suite; `test:integration` explicitly opts into live local-service tests. Browser and email acceptance follows these automated commands.

| Gate                   | Required checks                                                                                                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clean setup            | Fresh dependency install on supported development environment and Linux CI; migrations from empty database; reproducible seeds; generated types/SQL match; no embedded secrets.                                           |
| Identity and roles     | Signup, confirmation, resend, sign-in, recovery, logout; verified-account guards; arbitrary role metadata ignored; self-enable only; creators still learn.                                                                |
| Direct database access | Anonymous preview permitted; private answer keys denied; direct unauthorized table/RPC writes denied; user A cannot access user B; creator cannot read other learners; function ownership/grants/RLS combinations tested. |
| Atomic writes          | Concurrent answers produce one attempt; concurrent starts produce one active session; transaction rollback leaves no partial answer/progress; replay cannot skip; conflicting key payload rejected.                       |
| Durable learning       | Saved answer precedes reveal; reload at setup/review/final review/completed; later content versions preserve old sessions; fresh login and service restart retain history; new completed run creates separate history.    |
| Client coordination    | Lost response retry, stale revision reconciliation, cancellation, two tabs, sign-out/account switch, expired auth, private caching, no stale identity data rendered.                                                      |
| Real browser and email | Actual local verification/recovery links and cookies; direct protected URLs; guest preview; two accounts; creator enable; all three videos; keyboard and narrow mobile; network failure and final Finish.                 |
| Release readiness      | Unit/component, real DB, route/integration tests, typecheck and production build pass. Record live VOD pause/audio checks separately; mocked playback is insufficient for them.                                           |

The normal-speed audio/spoiler and final embedded playback checks carried over from milestone two remain acceptance items for the VOD experience. The user's successful manual demo trial does not substitute for the complete browser matrix.

## Build sequence after approval

1. **Foundation and contract freeze.** Start an approved `feat/user` branch from `dev`; repair clean-install portability; pin dependencies and finalize DTOs, SQL/RPC signatures and error codes. Preserve the existing app until replacements are integrated.
2. **Backend foundation.** Implement local configuration, migrations, canonical seed, generated types and DB permission tests. Prove RLS and transactional behaviour against the actual local service.
3. **Parallel account work.** Backend implements auth/services/routes; frontend implements forms, navigation, public preview and protected page shells against the frozen contracts.
4. **Persistent player integration.** Backend supplies canonical session operations; frontend replaces session coordination, adds history and self-service creator enrollment. Verify response-loss, refresh and identity-change paths together.
5. **Acceptance.** Run the complete automated and real-browser/email matrix, including original VOD regressions. Correct failures before treating the milestone as complete.
6. **Review and GitHub workflow.** Provide the tested changes for your review. You continue handling GitHub pushes and merges: feature work goes into `dev`, then tested releases go from `dev` to `main`.

After approval, assign **two new implementation agents**. The frontend builder owns pages/components/client adapters/state/tests. The backend builder owns auth/server/API/database/seed/integration tests. Agree shared contracts first; one designated owner updates shared package/config/contracts to avoid conflicting edits. The root agent integrates, reviews permissions and runs acceptance checks.

## Approval scope

Approval covers the local Supabase architecture, the account flows and access matrix above, self-enabled creator capability, versioned storage for the three existing scenarios, saved session/history behaviour, the proposed file/function/test work and the `feat → dev → main` workflow. It does not authorize hosted deployment, public email sending, creator authoring/upload features or GitHub pushes performed on your behalf.

The approved implementation runs locally. Hosted services, public email sending, deployment and GitHub pushes are not included.
