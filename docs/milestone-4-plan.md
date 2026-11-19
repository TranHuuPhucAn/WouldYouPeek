# Milestone four: creator scenarios

Status: **approved and implemented; local verification complete with documented manual/remote checks**. Prepared and approved on 18 November 2026 with separate frontend and backend planning agents, followed by two implementation agents. Planning baseline was `ded1adc`; implementation uses `feat/creator` from local `dev` at `06f35e7`, which contains the merged milestone-three work. See [verification evidence](milestone-4-verification.md) for the actual branch preparation, checks and limitations.

This milestone lets a creator turn a manually selected YouTube moment into a saved draft, rehearse the learner experience, review the exact saved content, and publish it to a learner library. Creators can revise or withdraw their own scenarios while existing learner sessions retain their original content.

## Confirmed scope

The user confirmed these three product decisions during planning:

| Decision | Milestone-four behavior |
| --- | --- |
| Approval | A creator reviews and publishes their own scenarios. There is no separate moderator or reviewer role. |
| Video input | YouTube links and explicit timestamps. Video file uploads come later. |
| Learner experience | A library of published scenarios, started one at a time. Keep the existing three-scenario demo. |

Existing decisions remain: verified accounts are required to play; any verified learner can enable creator access; footage must use the player's available information; explanations target advanced players; matching the pro is separate from making a defensible decision. After a choice is committed, start the pro's continuation and show the analysis below it. This milestone does not introduce a mandatory watch-to-end gate.

The approved access boundary keeps guests on the existing demo. Verified learners and creators can browse the new library and play its published scenarios. Creator drafts, review notes, and authoring controls are visible only to their owner.

The current Next.js, React, TypeScript, Supabase Auth/Postgres, YouTube player, CSS, Vitest, Testing Library, and pgTAP stack remains. New infrastructure is unnecessary for the product features in this milestone. A separate local test stack is required to keep publication tests away from the user's accounts and content.

## What the creator can do

1. Open the creator dashboard and create a private draft.
2. Enter a YouTube URL, source attribution, player and round context, and setup/decision/continuation timestamps.
3. Write the question and answer choices, identify the observed pro action, and assess every choice independently.
4. Explain the known information, uncertainty, conditional alternatives, risks, outcome, and takeaway. Creator-written or AI-assisted analysis is labeled appropriately; the existing demo retains its AI attribution.
5. Explicitly save incomplete work. The UI distinguishes unsaved changes from a successfully saved draft.
6. Preview the saved draft through setup, pause, a practice choice, continuation, and feedback. This preview never creates learner attempts or history.
7. Complete an editorial review of the saved revision: player-only information, decision timing, source audio, playable continuation, and explanations grounded in the pre-decision information.
8. Publish that reviewed revision. Learners can now find it in the library and start a saved one-scenario session.
9. Edit the working draft while the current published version stays live. Saving content changes invalidates the earlier review. Review and publish again to release a new immutable version.
10. Withdraw the scenario from the library and new session starts. Already-started sessions and history keep access to their pinned version. Restoring visibility requires a new review and explicit publication; unchanged content can reuse its existing immutable version. Withdrawal is a delisting operation, not deletion or an emergency takedown.

There is no claim that a checkbox proves video quality or that the app knows the player's thoughts. Form validation checks structural correctness; a creator records their own editorial review. Observed actions, interpretations, and missing information remain distinguishable in the learner explanation.

## State and data guarantees

The published version and working draft are separate. A single status field must not force a published scenario offline when its owner begins editing.

| Situation | Creator sees | Learner sees |
| --- | --- | --- |
| New incomplete draft | Editable, private, with missing-field guidance | Nothing |
| Valid saved draft | Saved preview and review actions | Nothing until published |
| Reviewed saved revision | Publish action for that revision | Previous published version, if any |
| Published revision | Live version and editable working draft | Current published version for new sessions |
| Draft changed after publication | Unpublished changes; review required again | Previous published version |
| Withdrawn scenario | Retained content and publication history | No library entry or new start; existing sessions/history remain |

- Ownership and verification are checked by pages, service methods, and database functions; a hidden button is never the access check.
- The original demo scenarios remain system-owned. Enabling creator access does not grant ownership of those records or other creators' scenarios.
- Publication atomically writes the immutable challenge version, its private answer key, publication metadata, and a command receipt. Partial publication is rolled back.
- The client never supplies trusted owner IDs, version numbers, demo flags, or reviewer identity.
- Commands use request IDs and expected revisions. Identical retries resolve to the same logical operation; a lost response cannot publish twice. A stale editor cannot overwrite another tab's saved work.
- Review applies to an exact saved draft revision/content digest. Editing after review invalidates it, including edits made from another tab.
- Learner pre-answer responses contain no answer key, observed pro choice, continuation interval, or analysis. The authoring API can return those fields only to the creator who owns the draft.
- Creator email addresses and authentication metadata are not public attribution.
- Existing saved sessions and completed attempts remain immutable even after a new version is published or the listing is withdrawn.
- One active learner session per account remains. Starting an unrelated scenario must offer an explicit way to resume the existing session; it must not silently substitute that session for the requested scenario.
- Adding a library scenario must not increase the size of the three-scenario demo session.

## Planning reports and implementation contract

The two reports contain the detailed proposed file trees, functions, responsibilities, and tests:

- [Frontend plan](milestone-4-frontend-plan.md): creator dashboard/editor, saved preview and review, publishing controls, learner library, selected-session UX, and existing player/recap adaptations.
- [Backend plan](milestone-4-backend-plan.md): schema changes, permissions, ownership, RPC transactions, HTTP contracts, publication/version behavior, library reads, and isolated test infrastructure.

The reports use the same proposed transport contract. The backend builder owns schema, generated types, contracts, shared pure content validation, and server/API modules; the frontend builder consumes those contracts and owns pages, components, hooks, and client interaction modules. Changes to shared contracts must be agreed before either builder changes their consumer.

| Shared contract | Agreed behavior |
| --- | --- |
| Draft snapshot | `CreatorScenarioSnapshot` contains a resource `revision`, `draft.revision/content/savedAt`, readiness issues, optional review receipt, and a separate publication state/current version. |
| Create/save commands | `POST /api/creator/scenarios` accepts a request UUID. `PUT /api/creator/scenarios/[id]` accepts the request UUID, expected resource revision, and complete bounded draft content. |
| Review | `GET /api/creator/scenarios/[id]/review?revision=...` targets an exact resource revision and returns an owner-only simulated learner payload. `POST` records the checklist against the saved content revision and checksum. |
| Publication | Explicit `POST` publish/unpublish endpoints return `{ scenario, replayed, publishedVersion }`. The last field identifies the version associated with that operation; it is not confused with a later live version when a delayed request is retried. |
| No-op save | Saving identical normalized content retains its draft revision and review. Preview state is keyed to draft revision, so marking reviewed does not restart the video. |
| Creator list | A fixed optional publication filter supports `all`, `unpublished`, `published`, and `withdrawn`. Here `unpublished` means never published; readiness/review remain separate row badges. Pagination is bound to the chosen filter. |
| Library | Verified-only `/api/library/scenarios` and item endpoints return published, creator-owned, non-demo setup previews and a standalone provenance label. They never serialize the analysis body to render a label. |
| Session selection | `POST /api/sessions` adds `target: { kind: 'demo' }` or `{ kind: 'scenario', scenarioId }`. The old request shape keeps its demo meaning and original retry semantics. Session summary/snapshot add a pinned title and target. |
| Active-session conflict | `ACTIVE_SESSION_EXISTS` returns only the caller's safe active-session summary. Same-target resume keeps the already pinned version; a different target requires explicit Resume, with no automatic abandonment. |
| Field issues | Safe bounded `error.details.issues` accompanies known validation errors; other database diagnostics are never passed through. Client parsers validate both error code and detail shape. |

Content limits are part of the proposal: at most five choices, a 64 KiB command body, setup of 2–120 seconds, continuation of 1–120 seconds, and source timestamps up to 12 hours with millisecond precision. The reports specify the per-field text limits. Incomplete drafts can be saved; publication requires complete source, question, options, explanation, observed action, and reviewed timing. Conditional-risk and uncertainty lists may be empty when deliberately reviewed as having no additional entries; the UI must not force invented uncertainty.

YouTube parsing derives only a canonical URL and video ID. Titles, uploader names, player identities, and round details are entered and reviewed by the creator, not automatically verified against an external service. No source-video download or external metadata/AI API is needed.

The main implementation areas are:

| Files/modules | Functions and responsibilities | Where the full per-function tests are specified |
| --- | --- | --- |
| `src/components/creator/`, `src/hooks/use-scenario-editor.ts`, `src/lib/creator/editor-state.ts` | Dashboard, field sections, `useScenarioEditor()`, `saveDraft()`, retry/reconcile actions, and `editorReducer()` preserve editable work and confirmed saved state. | Frontend report: component and state/transport tables. |
| `src/components/creator/ScenarioPreview.tsx`, `CreatorReview.tsx`, `PublicationControls.tsx` | Local preview choice/replay, `markReviewed()`, `publishReviewedDraft()`, and `confirmUnpublish()` operate on saved owner content and stable command IDs. | Frontend report: preview, review and publication tests. |
| `src/lib/creator/content.ts`, `src/server/creator/`, `src/app/api/creator/` | Shared validation, command parsers, safe projections, owner-scoped repository calls, and create/save/review/publish/unpublish service functions. | Backend report: file/function responsibilities and SQL inventory. |
| `src/app/library/`, `src/components/library/`, `src/server/library/`, `src/app/api/library/` | List published previews, validate cursors/IDs, render safe cards, and explicitly start or resume the selected scenario. | Both reports: library API, UI, permission and session-selection tests. |
| Existing training/session modules and challenge components | Add explicit targets and pinned titles, one-item progress/recap, correct replay target, and creator/AI-assisted/legacy-AI labels. | Both reports: existing demo/history regression and selected-session tests. |
| Four new Supabase migrations and generated database types | Draft/review records; publication transactions/receipts; library/session selection; restricted ownership/RLS grants. | Backend report: schema, SQL function inventory, pgTAP and multi-client integration cases. |
| `scripts/local-test-stack.mjs`, local migration wrapper, package scripts and CI | Isolate disposable tests, apply additive upgrades, run the whole verification pipeline, and preserve the existing `verify` check name. | Backend report: test-target guard tests and upgrade/CI acceptance. |

The complete new/modified file trees, including named test files, are in the two linked reports; these rows summarize them rather than defining a separate implementation list.

## Build sequence after approval

| Step | Work | Verification before the next step |
| --- | --- | --- |
| 1. Prepare the branch and baseline | Refresh remote refs; confirm milestone three has merged into `dev`; create proposed `feat/creator` from current `dev`. Preserve any user work and local accounts. | Required milestone-three CI is green; baseline and branch point recorded. Do not silently branch from the stale local `dev` reference. |
| 2. Freeze shared contracts and test isolation | Implement the agreed draft/review/library/session DTOs and a disposable test project with separate ports, data, and Next.js build output. | Both builders agree on request/response fixtures; test commands refuse the normal development database and hosted targets. |
| 3. Add storage and authoring operations | Add migrations, creator ownership, draft persistence, review records, versioned publication, withdrawal, and restricted RPC grants. | Real-database permission/transaction tests plus an upgrade test from the milestone-three schema pass. Existing accounts and history survive an additive migration. |
| 4. Build authoring UI in parallel | Dashboard, source and timing form, context/options/analysis editor, explicit save, saved preview, review, and publication controls. | Component/API tests cover incomplete work, validation, conflicts, retries, expired authentication, and ownership boundaries. |
| 5. Connect the learner library | Paginated published listings and single-scenario starts; generalize player progress and recap; retain demo routing and saved-session behavior. | New sessions use the current publication; existing sessions use their pinned version; active-session mismatch is explicit; preview produces no attempts. |
| 6. Run acceptance and prepare the PR | Full automated suites, browser author-to-learner journey, accessibility and responsive checks, real video/audio review, and README updates. | Required `verify` check passes on the PR into `dev`. No incomplete checks are described as passing. GitHub push and merge remain with the user. |

The branch-preparation deviation is recorded in the verification report: remote `main` contained milestone three but remote `dev` was behind. Local `dev` was fast-forwarded to that merged baseline before creating the user-requested `feat/creator`; remote synchronization remains with the owner.

## Test and CI acceptance

Keep the existing GitHub Actions workflow and the `verify` job name so the user's branch protection continues to require the same check. Pull requests into `dev`/`main` and pushes to those branches retain full verification. This milestone extends CI; deployment remains a later task.

| Layer | Required evidence |
| --- | --- |
| Pure validation and service tests | URL normalization/host allowlist, timestamp ordering and bounds, incomplete drafts versus publishable content, field limits, stable option IDs and observed-choice references, provenance, safe response projection, cursor validation. |
| Frontend/component tests | Editing and explicit save, pending/error states, validation focus, dirty navigation warnings, review invalidation, conflict recovery without silent overwrite, saved preview with no learner writes, library authentication, one-item progress/recap, legacy three-item demo and AI labels. |
| pgTAP and real database tests | Creator A versus creator B, learner/guest/unverified access, direct Data API denial, protected system demo ownership, exact function grants, immutable versions/keys, all-or-nothing publication, one active session, same-command retries, races, withdrawal and review invalidation. |
| Auth/Data API and actual Next HTTP tests | Real verified creator creates/saves/reviews/publishes; separate learner sees only public-facing content and answers through a saved session; cross-origin or malformed writes fail; old and new versions coexist safely. |
| Migration upgrade tests | Start with milestone-three accounts, creator role, completed session and an in-progress session in a disposable database; apply only the new migrations; verify those records, privileges and continuation paths remain valid. |
| Browser acceptance | Create and publish from creator A; creator B cannot open A's draft; learner plays the published scenario, reloads/resumes and sees history; publish a revision and withdraw it; confirm pinned sessions still work; keyboard and narrow/wide layouts; actual YouTube setup/pause/continuation and normal-speed audio. |
| Release checks | Clean install, fixture/type drift, automated suites, typecheck and native Linux production build/HTTP verification in CI. |

Publication tests need permanent scenario versions. They must run in a dedicated disposable project, not the user's existing local stack. Teardown destroys only that explicitly identified test project after evidence is collected; it does not disable immutability or add a privileged deletion path to the app. Source, environment, generated types and build directories for the test app are isolated so a test run cannot replace the user's running local app configuration or `.next` output.

The proposed full-suite command is `npm run test:ci`, used by both local acceptance and the existing GitHub `verify` job. It prepares an ignored `.wyp-test-work/<run-id>/` workspace and an explicitly identified disposable Supabase project on separate ports (API 55321, database 55322, inbox 55324, app 3100). It runs script guard tests, the milestone-three-to-four upgrade preservation test, a clean migration/seed pass, and all existing/new test, type, build and HTTP checks. Any phase failure fails the required CI job. Existing test wrappers and helpers must recognize the verified disposable profile consistently; merely changing a port or weakening the local-target guard is insufficient. The frontend uses this same pipeline for integrated acceptance.

The proposed new `db:migrate:local` command applies pending migrations without resetting user data. The installed Supabase CLI 3.2.0 help confirms that `migration up` targets local services by default and uses `--remote` for hosted targets; there is no `--local` flag in this installed version. The wrapper must verify the intended local project, reject extra target arguments, and never call a reset as part of this upgrade.

Two editorial checks from milestone three remain visible: complete normal-speed audio/spoiler review and the full responsive browser matrix were not previously established by mocked tests. This milestone's preview and library journey must record actual browser evidence and any remaining limitations separately.

## Explicit boundaries and later progression

This proposal covers local product implementation and verification. It does not include file uploads/transcoding, automatic VOD extraction, AI generation calls, creator-built training sets, a separate moderation role, public creator profiles, ratings, payments, notifications, or hosted deployment/SMTP. Publishing makes content available in the configured app; it does not deploy the site to the internet.

Milestone five can feed candidate scenarios into the same draft/review/publish contract. Generated content will remain private until a creator reviews and publishes it. Actual file uploads and separately moderated publication need their own design when brought into scope.

The earlier suggestion to add a hosted deployment/email milestone 3.5 was a recommendation, not an approved roadmap change. This milestone-four plan follows the user's current request and keeps live email/deployment separate.

## Approval recorded

The user approved the combined scope and both technical reports, and requested two new implementation agents on `feat/creator` from `dev`. Approval covers creator self-review, YouTube-only authoring, the verified learner library, immutable versions and withdrawal, explicit-save/conflict handling, isolated verification and additive migrations. GitHub push and merge remain with the user; hosted deployment and external email sending are outside scope.

The detailed proposal below its status header is retained as the design record. Current implementation evidence and any deviations are recorded in the linked verification report.
