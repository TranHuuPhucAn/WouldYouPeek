# Milestone four backend plan

Status: **approved and implemented; local verification complete with documented manual/remote checks**. Original planning baseline: `ded1adc` on local `feat/user`. Implementation is on `feat/creator`; this report retains the approved file/function/test design. See [verification evidence](milestone-4-verification.md) for actual results and limitations.

## Confirmed scope

The user has confirmed that creators review and publish their own scenarios, supply YouTube links and timestamps rather than uploading files, and publish individual scenarios that learners select from a library. The existing three-scenario demo remains separate. The existing rule that any verified learner may enable creator access continues.

New scenario explanations are written by their creator; a creator can disclose manual AI assistance. There is no AI-generation API, automated VOD extraction, storage bucket, transcoding service, moderator role, or second-person approval queue in this milestone. Review means the creator's explicit review of a saved draft, not independent editorial approval. Hosted deployment and real email delivery are separate work.

The proposed access default preserves guest access to the three demo previews. The new library requires a verified learner or creator. Ordinary withdrawal removes an item from discovery and prevents fresh sessions; previously pinned sessions and their history remain usable. Withdrawal is delisting, not a hard takedown mechanism. These policy details remain part of the implementation approval.

## What the current code requires us to preserve

- `public.scenarios` contains the catalogue identity, current version pointer and `is_demo`/`is_published` flags. Its text IDs must continue accepting the existing demo slugs.
- `public.scenario_versions` and `private.scenario_answer_keys` are immutable. Existing sessions pin a version UUID, and submitted feedback is saved with each attempt.
- `public.start_training_session` currently selects published demo rows and creates or resumes one active session per user. The unique active-session index must remain.
- `wyp_rpc` is a non-login, non-table-owner, non-bypass role. Runtime requests use the learner's validated JWT and public Supabase key. Trusted confirmation is mirrored into `profiles.email_verified_at` by a separate trigger-only role; no application role needs auth-schema access.
- Public demo RPCs return whitelisted setup-only fields. Full answers remain private until a learner submits their answer, except in the owner's private authoring/review experience.
- The current response parser only accepts `analysis.author = 'ai'`. Creator provenance therefore requires a backward-compatible contract/parser change; simply changing editor labels would be insufficient.
- CI's job ID is `verify`. Keep that ID stable so the user's branch protection keeps requiring the correct check.

## Lifecycle and invariants

A scenario has three independent pieces of state: a mutable working draft, a review receipt for a particular saved draft, and an optional immutable published version. Do not collapse these into one status column: a published scenario may also have unpublished edits.

1. **Create:** a creator obtains a server-generated UUID scenario ID and an empty private draft. A catalogue shell is unpublished and never a demo item.
2. **Save:** incomplete drafts are valid when their shape, types, sizes and IDs are safe. Content changes increment the draft revision, invalidate review, and leave the live published version untouched.
3. **Review:** the creator previews the saved content and confirms the checklist. A receipt records the exact draft revision, server-computed checksum, reviewer account and server timestamp. All publish-readiness rules must pass.
4. **Publish:** one transaction checks ownership, creator verification, expected resource revision, the review receipt and current content. It inserts the immutable safe challenge and private answer key, then switches the catalogue pointer. New sessions see the new version; old sessions retain their original version.
5. **Edit after publication:** save another working draft. Re-review is mandatory before publishing changed content as a new immutable version.
6. **Withdraw:** delist the current version, clear its current review acknowledgement and preserve the draft and all immutable content/history. Re-review and explicit publication restore it. An unchanged restored version can be reused rather than manufacturing a duplicate content version.

There is no hard-delete endpoint or account deletion feature in milestone four. Seeded demo scenarios have no creator owner and cannot be claimed, edited, withdrawn, or published by an ordinary creator. New creator APIs cannot set ownership, `is_demo`, catalogue order, published-version IDs, timestamps, review identity, or current-version pointers.

Two revisions have distinct jobs:

- `revision` is the resource mutation revision used by every command's `expectedRevision`.
- `draft.revision` changes only when saved content actually changes. A no-op save keeps the draft revision and review receipt intact. Recording review changes the resource revision without changing the reviewed draft revision.

Every successful command has a UUID request ID scoped to its actor. Retry detection happens before revision checks. The same request ID with the same operation and full normalized payload returns the current canonical owner snapshot of its original resource; a changed payload returns `IDEMPOTENCY_CONFLICT`. The receipt also identifies the published version created by that command so a later retry cannot imply the latest version was created by the earlier request. A repeated publish of already-live identical content must not create another version.

## Agreed contract proposal for implementation approval

Backend owns `src/contracts/creator.ts`, `src/contracts/library.ts`, the changes to `src/contracts/challenge.ts` and `src/contracts/session.ts`, and shared content validation. Frontend owns client response parsing and presentation. Both agents review these contracts before implementing dependent code.

```ts
type CreatorDraftContent = {
  title: string;
  topic: string;
  context: string;
  question: string;
  source: {
    url: string; title: string; uploader: string; player: string;
    map: string; agent: string; score: string;
    matchType: 'ranked' | 'tournament' | null;
    round: number | null; side: 'attack' | 'defense' | null;
    publishedDate: string; dateNote: string;
  };
  media: {
    startSeconds: number | null;
    decisionSeconds: number | null;
    endSeconds: number | null;
    setupAlt: string; decisionAlt: string; revealAlt: string;
  };
  knownFacts: string[];
  unknowns: string[];
  options: {
    id: string; label: string;
    assessment: 'recommended' | 'reasonable' | 'risky' | null;
    explanation: string; acceptableWhen: string[]; risks: string[];
  }[];
  observedAction: { optionId: string | null; description: string };
  analysis: {
    author: 'creator' | 'ai-assisted';
    rationale: string; limitations: string[];
  };
  takeaway: string;
  outcomeText: string;
};

type ValidationIssue = { path: string; code: string; message: string };
type ReviewChecklist = {
  povInformationChecked: boolean;
  setupSpoilersChecked: boolean;
  pauseTimingChecked: boolean;
  continuationChecked: boolean;
  normalSpeedAudioChecked: boolean;
  alternativeChoicesChecked: boolean;
  sourceAttributionChecked: boolean;
};
type CreatorScenarioSnapshot = {
  id: string;
  revision: number;
  draft: { revision: number; content: CreatorDraftContent; savedAt: string };
  readiness: { issues: ValidationIssue[]; canReview: boolean };
  review: {
    id: string; draftRevision: number; reviewedAt: string;
    checklist: ReviewChecklist;
  } | null;
  publication: {
    state: 'never_published' | 'published' | 'withdrawn';
    currentVersion: string | null;
    publishedAt: string | null;
    hasUnpublishedChanges: boolean;
  };
  updatedAt: string;
};
type CreatorMutationResponse = {
  scenario: CreatorScenarioSnapshot;
  replayed: boolean;
  publishedVersion: string | null; // Version created/reused by this command.
};
type SessionTarget = { kind: 'demo' } | { kind: 'scenario'; scenarioId: string };
type ApiErrorResponse = {
  error: {
    code: ApiErrorCode;
    message: string;
    details?:
      | { issues: ValidationIssue[] }
      | { activeSession: SessionSummary };
  };
};
```

Creator list responses return compact, owner-only summaries with title, draft/review/publication state, revisions and timestamps, never full answer content. Both creator and learner lists use `{ scenarios, nextCursor }` with a default page size of 20 and maximum 50. Snapshot and history contracts add `target: SessionTarget` and a stored `title`, enabling accurate resume and replay labels without changing saved item semantics.

The creator dashboard accepts only `status=all|unpublished|published|withdrawn`, with an omitted value normalized to `all`. `unpublished` means never published (`current_version IS NULL`); `published` means currently visible even when it has new draft edits; `withdrawn` means a previously published version is currently delisted. Draft completeness and reviewed status remain separate badges, not filter states. The cursor includes its normalized status and is rejected if reused with another filter. Every branch of the filter retains owner checks. No arbitrary library filters are added.

The optional error details are backward-compatible with existing `{ code, message }` consumers. They are a discriminated pairing in implementation: only `DRAFT_NOT_READY`/known field-validation errors carry `issues`, and only `ACTIVE_SESSION_EXISTS` carries an owned `activeSession`. The browser's API error parser must validate this pairing before presenting a Resume link. No other error exposes arbitrary details.

Readiness/error reports return at most 100 deterministic field issues, with bounded path and message strings; a truncated report remains non-publishable. Preview state is keyed to `draft.revision`, so a review-only resource revision change does not rewind playback or discard a simulated choice.

`ScenarioAnalysis` supports `author: 'ai' | 'creator' | 'ai-assisted'`. Preserve old `'ai'` payloads and their notices exactly. New publication notices are generated from the declared provenance; creator input cannot impersonate an independent review or fabricate a reviewer's email. Public provenance uses labels, not account email or an invented public profile feature. `recommendedOptionIds` remains derived from assessments; there may be zero, one, or multiple recommended choices. Matching the observed pro choice remains independent of assessment.

## Content validation and editorial review

Draft shape is complete with empty strings, nullable scalar values and empty lists; it is not arbitrary JSON. Unknown keys, incorrect types, duplicate option IDs, invalid enumerations and oversized content are rejected even when saving an incomplete draft. A temporarily invalid URL, missing required prose, out-of-order timestamps or an option removed from the observed-action selection may be saved as incomplete content and reported with field-specific readiness issues.

Proposed bounds, shared by TypeScript and SQL tests:

| Field | Save/publish constraint |
| --- | --- |
| JSON request | At most 64 KiB of UTF-8 bytes, checked while reading; a forged/missing Content-Length does not bypass the limit |
| Title / topic / option label | At most 120 / 80 / 160 characters; nonblank at publication |
| Source short fields and alt text | At most 300 characters each; relevant fields and all three alt texts required at publication |
| Source URL | At most 2,048 characters; publication requires an accepted YouTube URL |
| Prose | At most 2,000 characters, with 4,000 for context, analysis rationale and option explanation |
| Lists | At most 10 entries of 300 characters each; blank lines ignored by explicit editor normalization, not silently dropped by the database |
| Options | 0–5 while drafting; 2–5 at publication, stable unique UUID option IDs and a valid observed-action reference |
| Times | Finite numbers, 0–43,200 seconds, at most three decimal places; nullable while drafting |
| Published intervals | Start < decision < end; setup 2–120 seconds, continuation 1–120 seconds; setup end and reveal start both derive from the single decision value |
| Round / score | Round integer 1–100; score two nonnegative integers within 0–99; required at publication |
| Dates | Optional ISO date or empty string; actual source date is creator-entered, never represented as automatically verified |

The YouTube parser accepts only HTTPS URLs on an exact host allowlist: `youtube.com`, `www.youtube.com`, `m.youtube.com`, and `youtu.be`. Support a normal watch URL and a short video URL; extract an 11-character video ID and produce the canonical `https://www.youtube.com/watch?v=...` URL. Ignore sharing/time tracking parameters because the editor's explicit timestamps are authoritative. Reject embedded credentials, unexpected ports, duplicate/conflicting video IDs, playlist-only links, unsupported paths, lookalike domains and non-HTTP schemes. Do not fetch an arbitrary user-supplied URL, download the VOD, trust supplied embed HTML, or require a YouTube API key.

Publication requires source attribution, a player-visible context and question, independent option assessments and explanations, analysis rationale, observed action, outcome, takeaway, and provenance. Unknowns, analysis limitations, and each option's acceptable-circumstance/risk lists may be empty when the creator consciously determines there are none to add. The required review acknowledgement explicitly covers those omissions as intentional; do not force invented unknowns or filler text. Nonempty lists must still satisfy their type, text and size limits. Do not require a uniquely correct answer or equate match outcome with decision quality.

The review checklist covers strict player-only information, absence of setup spoilers, pause timing, observed continuation, normal-speed audio, alternatives and source attribution. The server can require acknowledgements bound to saved content; it cannot establish that a person truly watched a video or that a tactical explanation is correct. Label this honestly as creator-reviewed. The preview follows learner sequencing: setup → decision → submit → start continuation with analysis below. No mandatory watch-to-end gate is introduced.

SQL is the authority for publish eligibility because authenticated callers can invoke exposed RPCs directly. Shared TypeScript validators provide early field feedback; shared valid/invalid fixture vectors check TypeScript/SQL agreement. A service-only validator is not an access boundary.

## Database design and transaction boundaries

Apply additive migrations. Never edit the applied milestone-three migrations or mutate existing immutable demo content.

| Record | Proposed change and constraints |
| --- | --- |
| `public.scenarios` | Add nullable `creator_id` referencing the auth account with `ON DELETE SET NULL`, `created_at`, `updated_at`, and publication timestamps. Existing seeds retain null ownership and `is_demo=true`. New creator rows always have server-derived owner and `is_demo=false`. New drafts are unpublished shells; safe catalogue fields change only on publication. |
| `private.scenario_drafts` | One row per scenario: `scenario_id`, resource `revision`, `draft_revision`, bounded content JSONB, server checksum, saved/updated timestamps. Content/review mutations lock this row. |
| `private.scenario_reviews` | Immutable receipt ID, scenario ID, draft revision and checksum, historical reviewer UUID, server timestamp and checklist. The reviewer UUID is captured by the verified command and intentionally has no cascading auth FK; deleting an account must not mutate immutable review evidence. No email is copied. A draft points to its current valid receipt or null via a composite FK ensuring receipt/scenario identity. |
| `private.creator_commands` | Actor/request-ID primary key; operation, complete normalized payload, fingerprint, scenario ID and resulting revision, plus published-version reference if applicable. Actor FK may cascade with account removal as existing session receipts do. Deny runtime DELETE and reject UPDATE; no trigger blocks this defined account cascade. These actor-bound receipts are never exposed through public catalogue functions. |
| Existing immutable version/key tables | Creator publication inserts new versions with server-generated UUID and contentVersion such as `creator-1`. Store creator review evidence in the existing private review field; preserve all legacy JSON and checksums. |
| `public.training_sessions` | Add immutable selection fields `target_kind`, nullable `target_scenario_id`, and stored `target_title`. Backfill existing sessions as demo; add a CHECK for valid target shape. Retain the existing one-active-session index and answer/review revision model. |
| `private.session_commands` | Extend the allowed operation set for explicit selected starts. Keep old receipts and their original payload meaning. No rewriting of historical command payloads. |

Owner deletion is not a product flow in this milestone. Schema references must nevertheless avoid cascading deletion of immutable published versions that other learners have pinned. An orphaned owner's content has no creator edit authority and is excluded from library discovery/new starts by the non-null owner condition; its pinned versions and history remain readable to the learners who own those sessions. Orphaned private drafts/reviews remain inaccessible to normal accounts. A future administrative retention/takedown policy is separate. Do not add a privileged runtime delete path merely to clean test fixtures.

Use a new `wyp_creator_rpc` role for authoring functions: non-login, non-inheriting, not a table owner, not a superuser and without BYPASSRLS. Keep `wyp_rpc`'s training permissions unchanged except for new read/selection helpers. Grant schema CREATE only while transferring function ownership and revoke it at the end of the migration. No role receives access to Supabase's managed auth schema.

- Every creator RPC checks the caller's trusted verified profile and creator role, even if the Next service already checked.
- Ownership policies use the caller from the validated JWT, not a supplied owner UUID. Direct creator-table grants to `anon` and `authenticated` are revoked; clients access narrowly scoped RPCs only.
- The creator role may insert owned non-demo scenario shells; update grants exclude ownership, IDs, sort order and demo designation. Own-version/key insert and read policies require the parent scenario to belong to the caller. Draft, review and command policies are also owner-scoped and recheck verification/role.
- Review rows and command receipts are append-only. Published challenge/version/key immutability triggers remain in force for every runtime role.
- Explicitly revoke PUBLIC/anonymous/authenticated execution on **every** new helper and RPC after ownership transfer, then grant only intended public entry points to authenticated callers. Test actual privileges. Do not rely on the existing schema-scoped default privilege statement: PostgreSQL's global default PUBLIC function privilege must be handled explicitly. [Supabase function permissions](https://supabase.com/docs/guides/database/functions)
- Creator procedures serialize actor commands, then lock the scenario/draft consistently. Explicit learner starts and publication/withdrawal use the same scenario advisory-lock namespace to define which published version is selected when requests race. Locks must have one documented order to avoid deadlocks.
- Publish revalidates the saved content and review inside the transaction, computes safe challenge/answer-key projections in SQL, inserts both immutable halves, updates live metadata/pointer, advances resource revision and records the receipt. Any failure rolls back all changes. The browser never supplies a trusted published challenge object.

## API and selected-session behavior

All cookie-authenticated mutations keep existing same-origin and JSON-content checks. Private responses use `private, no-store`. Server-rendered pages call services directly rather than making HTTP calls back into their own API.

| Endpoint | Request and result |
| --- | --- |
| `GET /api/creator/scenarios?status=all&cursor=...` | Owner's paginated summaries with fixed statuses `all`, `unpublished`, `published`, or `withdrawn`; omitted status means all. Verified creator required and cursor bound to the normalized filter. |
| `POST /api/creator/scenarios` | `{ requestId }`; creates an empty draft and returns canonical mutation result. |
| `GET /api/creator/scenarios/[id]` | Owner's `CreatorScenarioSnapshot`; missing and foreign-owned IDs both return 404. |
| `PUT /api/creator/scenarios/[id]` | `{ requestId, expectedRevision, content }`; replaces the bounded draft, preserving a current review only for identical normalized content. |
| `GET /api/creator/scenarios/[id]/review?revision=...` | Owner-only projection for the exact saved **resource** revision: `{ scenario, challenge, feedbackByOption }`, where feedback maps each option ID to a complete preview `AnswerResponse`. Preview content uses a server-generated draft version label and writes no learner session/attempt. Incomplete drafts return readiness issues. |
| `POST /api/creator/scenarios/[id]/review` | `{ requestId, expectedRevision, checklist }`; records the saved-draft review receipt. |
| `POST /api/creator/scenarios/[id]/publish` | `{ requestId, expectedRevision, reviewId }`; atomic version publication. |
| `POST /api/creator/scenarios/[id]/unpublish` | `{ requestId, expectedRevision }`; delists and invalidates the current review acknowledgement. |
| `GET /api/library/scenarios?cursor=...` | Verified learner's paginated published creator preview catalogue: `is_published=true`, `is_demo=false`, non-null creator owner and a valid current version. Separate from the demo API. |
| `GET /api/library/scenarios/[id]` | Published creator preview only; no answer content or owner email. |
| `POST /api/sessions` | `{ requestId, target: {kind:'demo'} }` or `{ requestId, target:{kind:'scenario',scenarioId} }`; retain old `{requestId}` as an explicit demo target compatibility path. |

New errors: `SCENARIO_NOT_FOUND` (404), `SCENARIO_CONFLICT` (409), `DRAFT_NOT_READY` (422), `REVIEW_REQUIRED` (409), `SCENARIO_UNAVAILABLE` (404), `ACTIVE_SESSION_EXISTS` (409), and `PAYLOAD_TOO_LARGE` (413). Reuse existing identity, creator, invalid-request, idempotency and unavailable-storage codes. Known field failures expose bounded `{ issues }`. The active-session conflict exposes only the caller's safe `{ activeSession: SessionSummary }`; no supplied/private foreign scenario details are echoed. Error details require explicit server and client allowlists, not arbitrary database diagnostic output.

Selected starts follow this order:

1. Validate identity and input; serialize commands for this learner.
2. Resolve a matching prior request receipt first, even if the original session is now completed or the item withdrawn.
3. If an active session has the same target, return it with its originally pinned version, including after ordinary withdrawal.
4. If an active session has a different target, return `ACTIVE_SESSION_EXISTS` and its safe summary. Do not replace it, abandon it or silently resume an unrelated scenario.
5. With no active session, a demo start selects only the existing demo set; a scenario start selects exactly one currently published creator version. Withdrawal prevents this new start. The creator cannot expand the demo by publishing more items.
6. Insert the pinned item(s), immutable target metadata and command receipt in the same transaction. Existing answer, advance and final Finish semantics remain.

Keep the old `start_training_session(uuid)` entry point compatible with old demo receipts. Add `start_selected_training_session(uuid,jsonb)` for explicit targets and an internal shared start engine, avoiding ambiguous PostgREST overloads. New selected commands have a distinct receipt operation and include the target in their logical payload. Update command replay to include `created` for both start operations. No old receipt should suddenly match a different selected target.

Creator lists paginate by stable creation timestamp plus scenario ID and bind the fixed publication-status filter into the cursor; library lists paginate by stable first-publication timestamp plus ID. Cursor input is bounded, decoded/validated into typed values, and never interpolated into SQL. Filters always retain ownership/publication checks independent of cursor content. Search, ratings, arbitrary filtering, library filters, collections and profile pages are deferred.

Pagination is a live view, not a long-running snapshot. New publications may appear on a refresh of the first page; withdrawals can remove entries between requests. Immutable sort keys prevent an edited/republished item moving ahead of its existing cursor. Decode the cursor's tuple directly rather than requiring its anchor row to remain visible, so withdrawing the last item from a page does not break the next-page request. Tests cover those concurrent changes without claiming snapshot-consistent totals.

The library's safe projection adds only a standalone provenance enum/label to the setup preview; it never serializes `analysis` to obtain a badge in the browser. The video ID and canonical source URL derive from the validated URL. Video title, uploader, player and other source context remain creator-entered fields, explicitly not external metadata verification.

## Proposed backend file tree

`N` = new, `M` = modified after approval. Frontend page/component files are in the companion frontend plan.

```text
would-you-peek/
├── docs/milestone-4-backend-plan.md                    planning document only
├── docs/milestone-4-verification.md                    N, implementation evidence
├── README.md                                          M
├── .gitignore                                         M, disposable test workspaces/output
├── package.json                                       M, migration/test scripts
├── .github/workflows/ci.yml                            M, keep job ID verify
├── scripts/
│   ├── local-supabase.mjs                              M
│   └── local-test-stack.mjs                            N
├── src/contracts/
│   ├── creator.ts                                     N
│   ├── library.ts                                     N
│   ├── challenge.ts                                   M
│   └── session.ts                                     M
├── src/lib/creator/content.ts                          N, shared pure validation
├── src/server/
│   ├── http.ts                                        M
│   ├── creator/
│   │   ├── validation.ts                              N
│   │   ├── projections.ts                             N
│   │   ├── repository.ts                              N
│   │   └── service.ts                                 N
│   ├── library/
│   │   ├── validation.ts                              N
│   │   ├── projections.ts                             N
│   │   ├── repository.ts                              N
│   │   └── service.ts                                 N
│   └── training/
│       ├── validation.ts                              M
│       ├── projections.ts                             M
│       ├── repository.ts                              M
│       └── service.ts                                 M
├── src/app/api/
│   ├── creator/scenarios/route.ts                      N
│   ├── creator/scenarios/[id]/route.ts                 N
│   ├── creator/scenarios/[id]/review/route.ts           N
│   ├── creator/scenarios/[id]/publish/route.ts          N
│   ├── creator/scenarios/[id]/unpublish/route.ts        N
│   ├── library/scenarios/route.ts                      N
│   ├── library/scenarios/[id]/route.ts                 N
│   └── sessions/route.ts                               M
├── src/types/database.ts                              M, generated
├── supabase/migrations/
│   ├── 20261118000100_creator_drafts_and_reviews.sql    N
│   ├── 20261118000200_creator_commands_and_publish.sql  N
│   ├── 20261118000300_library_and_selected_sessions.sql N
│   └── 20261118000400_creator_access.sql               N
├── supabase/tests/database/
│   ├── creator_access.test.sql                        N
│   ├── creator_publication.test.sql                   N
│   └── selected_sessions.test.sql                     N
├── tests/fixtures/creator-content-cases.json           N
├── tests/backend/
│   ├── creator-content.test.ts                        N
│   ├── creator-validation.test.ts                     N
│   ├── creator-projections.test.ts                    N
│   ├── creator-repository.test.ts                     N
│   ├── creator-service.test.ts                        N
│   ├── creator-routes.test.ts                         N
│   ├── library-service.test.ts                        N
│   ├── library-routes.test.ts                         N
│   ├── training-validation.test.ts                    M
│   ├── training-projections.test.ts                   M
│   ├── training-repository.test.ts                    M
│   ├── training-service.test.ts                       M
│   ├── training-routes.test.ts                        M
│   └── http.test.ts                                   M
├── tests/integration/
│   ├── helpers/local-supabase.ts                       M
│   ├── helpers/test-users.ts                          M
│   ├── helpers/creator-scenarios.ts                    N
│   ├── creator-access.test.ts                         N
│   ├── creator-lifecycle.test.ts                      N
│   └── creator-session-persistence.test.ts             N
├── tests/http/creator-http.test.ts                     N
├── tests/scripts/
│   ├── local-supabase.test.mjs                         N
│   └── local-test-stack.test.mjs                       N
└── tests/migrations/milestone-4-preservation.test.mjs    N
```

Migration timestamp prefixes may advance to the implementation date; names and dependency order are the planned responsibilities. The source fixture and existing demo seed remain unchanged unless an independently justified bug requires a reviewed correction.

## File/function responsibilities and verification

| File | Planned exports/functions and responsibility | Verification |
| --- | --- | --- |
| `contracts/creator.ts` | Types above plus list/command/review-preview DTOs and creator-specific error details. | Compile both agents against the same definitions; response fixtures must satisfy runtime parsers. |
| `contracts/library.ts` | `LibraryScenarioPreview`, `LibraryListResponse`; safe preview + provenance labels only. | Disclosure tests assert exact field allowlists and no draft/review/answer/account data. |
| `contracts/challenge.ts` | Introduce compatible `ScenarioAnalysis`, keep legacy AI payload support, add known API error codes/details. | Existing demos and old saved attempts continue parsing; new creator/AI-assisted payloads accepted without relabeling legacy data. |
| `contracts/session.ts` | `SessionTarget`, selected start command, target/title in summary/snapshot, owned active-session conflict details. | Compile + runtime fixtures for old/demo and selected sessions. |
| `lib/creator/content.ts` | `createEmptyDraft()`, `parseYouTubeSource()`, `normalizeDraftContent()`, `validateDraftContent()`, `validatePublishContent()`. Pure functions; normalize only documented whitespace/URL representations and return path-based issues. | Table-driven bounds, incomplete drafts, unknown fields, source spoofing, URL ambiguity, timing precision, duplicate options, missing observed action, zero recommended choices, deliberate empty unknown/limitation/condition/risk lists, and same-content normalization. Shared vectors also run through SQL. |
| `server/creator/validation.ts` | `parseCreatorId()`, `parseCreatorFilter()`, `parseCreatorCursor()`, `parseCreateDraft()`, `parseSaveDraft()`, `parseReviewCommand()`, `parsePublishCommand()`, `parseUnpublishCommand()`, `parseReviewRevision()`. Validate exact command keys, UUIDs, revisions, fixed status enum, status-bound cursor and checklist. | Rejected additional ownership/version fields; malformed identifiers, revisions, booleans, unknown checklist keys and oversized cursors. Verify absent status defaults to all, invalid enums fail, never-published vs withdrawn distinction and mismatched cursor/filter rejection. |
| `server/creator/projections.ts` | `toCreatorSummary()`, `toCreatorSnapshot()`, `toCreatorList()`, `toCreatorMutation()`, `toCreatorReviewPreview()`. Runtime validation and deliberate projection of DB results. | Corrupt DB responses fail closed; cross-resource review IDs/draft revisions rejected; no account email, command payload or provider detail leakage. |
| `server/creator/repository.ts` | `listOwnedScenarios(status, cursor)`, `findOwnedScenario()`, `createDraft()`, `saveDraft()`, `getReviewPreview()`, `recordReview()`, `publishScenario()`, `unpublishScenario()`. Caller-scoped RPC adapters only; creator list RPC receives validated `p_status`, `p_cursor` and bounded `p_limit`. | Correct RPC names/args, status-filter and cursor forwarding, provider-error mapping, no service-role client; real permission behavior covered below. |
| `server/creator/service.ts` | Same use-case names as repository with `requireCreator()`, request parsing, safe projection and bounded field-error mapping. | Guest/unverified/learner rejection, no foreign ownership oracle, validation before mutation, stale-revision and idempotency conflict handling; avoid mock-only authorization claims. |
| `server/library/validation.ts` | `parseLibraryCursor()`, `parseLibraryScenarioId()`; handle creator UUID text and retained demo-compatible identifier syntax without SQL interpolation. | Invalid/oversized cursors, foreign cursor fields, injected IDs and unexpected query parameters. |
| `server/library/projections.ts` | `toLibraryPreview()`, `toLibraryList()`; whitelist setup/source/provenance only. | Deliberate malicious extra-field fixtures, invalid media/source and stable pagination. |
| `server/library/repository.ts` | `listPublishedScenarios()`, `findPublishedScenario()` invoke verified-only RPCs. | SQL integration tests cover draft/unpublished exclusion, owner-independent published reads, pagination. |
| `server/library/service.ts` | `getLibrary()`, `getLibraryScenario()` verify learner, parse input and project safe result. | Guest/unverified denial and unavailable/withdrawn item behavior. |
| `server/training/validation.ts` | Extend `parseStartSession()` and add `parseSessionTarget()`; legacy shape normalizes to demo compatibility path. | Unknown kind, extra fields, missing ID, request replay payload identity and existing answer/advance regressions. |
| `server/training/repository.ts` | Extend `startOrResumeSession()` with explicit target and old-entry compatibility; existing read/answer/advance adapters retained. | RPC selection and parameters, no arbitrary client-supplied version IDs. |
| `server/training/service.ts` | Extend `startSession()` to selected target and safe owned conflict details. | Different active target conflicts, same target resumes, withdrawn selected item fails only for new sessions. |
| `server/training/projections.ts` | Extend `toSessionSnapshot()`/`toSessionSummary()` and answer provenance; retain strict item/phase/revision validation. | One-item Finish, old three-item sessions, unknown target shapes, legacy AI saved answers, creator-written answers and correct historical title. |
| `server/http.ts` | `readLimitedJsonBody()` performs streamed byte bounds; extend `ApiError`, `errorResponse()` and `databaseError()` for explicit safe detail variants. | Missing/lying Content-Length, streamed overrun, bad JSON, correct 413/422/409, no raw Postgres or account data. |
| Creator route files | Collection `GET/POST`; item `GET/PUT`; review `GET/POST`; publish and unpublish `POST`. Each wraps service with existing origin/error/cache handling and awaits Next route params. | Real method/JSON/origin/access tests, narrow missing/foreign responses, no-store, response parser agreement. |
| Library route files | Collection/item `GET`; call verified-only library services. | Auth matrix and no answer leakage in body or errors. |
| `api/sessions/route.ts` | Existing GET history and POST selected-start integration. | Legacy and target-aware request forms; no implicit unrelated resume. |
| `types/database.ts` | Generated schema/RPC types only. | `db:types:check` verifies drift after migrations; no manual type edits. |
| `scripts/local-supabase.mjs` | Add guarded `migrate` action and `db:migrate:local` script; reuse local status validation, reject extra CLI args/remote targets. | Argument rejection and target-guard tests; migration only after explicit local identity check. CLI 3.2.0 uses `migration up` locally by default; do not invent a `--local` flag. |
| `scripts/local-test-stack.mjs` | `prepareTestWorkspace()`, `assertDisposableTarget()`, `startTestStack()`, `runMigrationPreservation()`, `runVerificationPipeline()`, `runTestCommand()`, `stopTestStack()`, `cleanupTestWorkspace()`. `npm run test:ci` invokes the isolated full pipeline including the upgrade test. Orchestrate explicit test project/ports and app output, clean only created resources. | `tests/scripts/local-test-stack.test.mjs` checks refused user project/54321/3000 or hosted targets, mismatched project identity, collision/start failure cleanup, exact owned cleanup targets, no `.next`/environment mutation and fail-fast/nonzero propagation. Migration preservation plus all existing/new suites must actually be invoked by the pipeline. |
| `tests/scripts/local-supabase.test.mjs` | Node test cases for the migrate argument parser, local status/target checks and safe CLI invocation using controlled command stubs. | Refuse extra/remote arguments, malformed status and wrong project; assert `migration up` without unsupported `--local`; no Docker/database mutation during these guard unit tests. |
| `.gitignore` / `package.json` | Ignore only the known disposable test workspace/output path (`.wyp-test-work/`) and retain existing test-results exclusions. Add `test:scripts` using Node's test runner, `test:ci` using the isolated orchestrator, and `db:migrate:local` using the local wrapper. | Guard tests verify workspace identity; stage dry run excludes local test credentials/logs/builds. Scripts are included in the documented and CI verification path, not left as unused files. |
| Integration helper files | `createVerifiedCreator()`, `createDraftFixture()`, `publishScenarioFixture()`, `assertDisposableTestTarget()` plus existing user helper adaptations. | Generated test users and explicit test-stack identity; no privileged runtime deletion or immutable-trigger disabling. |
| Migration preservation test | `createM3Baseline()`, `snapshotExistingRecords()`, `applyPendingMigrations()`, `assertPreservedRecords()`. Run only in disposable project. | Accounts, creator role, completed/active sessions, attempts, original version UUIDs/checksums and demo IDs preserved exactly; new target fields backfilled correctly. |
| README, CI, verification document | Document additive migration and `npm run test:ci`; CI's existing `verify` job calls that pipeline, which invokes `tests/migrations/milestone-4-preservation.test.mjs` before the clean-install regression pass. Keep the existing PR/push triggers. Collect actual results and remaining manual playback checks. | Verify that upgrade test failure fails the same required `verify` job; commands rehearsed after approval; no passing claims before execution. |

## SQL function inventory

| Migration | Planned functions and responsibility | Critical database tests |
| --- | --- | --- |
| Drafts/reviews | `private.require_creator()` checks trusted verified creator; `private.validate_creator_draft(jsonb, boolean)` returns structural/publish issues; `private.creator_content_checksum(jsonb)` computes canonical content identity; `private.read_creator_snapshot(text)` and `private.creator_summary(text)` project only the owner's record. | TypeScript/SQL vector parity, null/missing JSON fields, literal false checks, creator revocation, ownership isolation and helper execution privileges. |
| Commands/publish | `private.match_creator_command(...)`, `private.record_creator_command(...)`, `private.project_creator_publication(...)`; public `create_creator_scenario`, `save_creator_scenario`, `get_creator_scenario`, `list_creator_scenarios(p_status,p_cursor,p_limit)`, `get_creator_review_preview`, `review_creator_scenario`, `publish_creator_scenario`, `unpublish_creator_scenario`. | pgTAP: full payload comparison, owner/request scope, fixed status-filter meanings, cursor/filter mismatch, stale saves, review invalidation, sequential retry behavior, rollback and immutable old versions. Integration: actual simultaneous review/save, publish/withdraw, and duplicate-request races on independent clients. |
| Library/session selection | Public `list_library_previews`, `get_library_preview`, `start_selected_training_session`; internal shared target-start implementation. Update old demo start compatibility, `private.match_session_command`, `private.read_session_snapshot`, and history projection to include targets/titles. | Verified-only safe catalogue, selected version pinning, withdrawal/new-start races, same-target resume, unrelated-active conflict, preserved old receipt semantics, exactly three demo items and one library item. |
| Access | Explicit grants, column grants, force-RLS policies, function ownership/revocation and immutable triggers; no new user-facing use case. | `has_function_privilege`, table/schema grants, nonowner/nonbypass role attributes, malicious direct RPC and Data API calls, seed mutation/claim attempts, forged owner/reviewer/version flags and user metadata. |

Function definitions must specify `search_path = ''` and qualify objects. Default execution privileges are explicitly corrected and all intended grants asserted after ownership transfers; using SECURITY DEFINER without this audit is insufficient. Existing auth sync and learner read policies remain independently tested.

## Test layers and acceptance

1. **Unit and service tests:** validators, projections, safe errors, route behavior and RPC parameters as mapped above. Reuse table-driven fixtures instead of tests that merely restate implementation lines.
2. **Real database pgTAP:** run in transaction/rollback, exercise role/owner isolation, restricted helper permissions, direct RPC bypass attempts, immutable records, review freshness, sequenced state invariants, payload replay and atomic rollback. A single transaction's assertions do not establish concurrent correctness.
3. **Real Auth/Data API integration:** two creators plus a learner and unverified user; one owner creates, edits, reviews and publishes while the other owner cannot inspect or mutate the draft. Learner sees only published safe projections and obtains feedback only through an owned answer submission. Verify stale tabs, reviewed-content edits, selected starts, withdrawal and old-history preservation. Use independent connections/clients and explicit barriers to race publish/save, review/save, start/withdraw and duplicate request receipts in `creator-lifecycle.test.ts` and `creator-session-persistence.test.ts`; assert one valid serial outcome, no partial versions and no duplicate sessions/versions. These races are distinct from sequential stale-revision tests.
4. **Actual Next HTTP:** origin/content limits, authoring permissions, safe field errors, no-store, full create→save→review→publish→start→answer→finish lifecycle, and replays after lost responses. Run against the production build in CI as well as local development acceptance.
5. **Upgrade preservation:** start a disposable milestone-three database with synthetic existing users and completed/active sessions; apply new migrations without a reset; verify their immutable content and saved progress survive. Also test a clean full migration/seed install.
6. **Real browser/editorial acceptance:** creator input/review/publish, role changes while editing, network loss, refresh, two tabs, keyboard/mobile, blocked YouTube playback and explicit normal-speed visual/audio inspection. Mocked playback cannot establish video availability, tactical correctness or spoiler-free audio. The three legacy demos keep their existing review limitations; do not silently relabel them as fully reviewed.

M4 publication tests must not run against the user's live local project. Immutable published test content cannot be safely cleaned by the existing account-only helper. Use a separately named disposable Supabase project with API/DB/mail ports 55321/55322/55324 and a separate Next workspace/output on port 3100, after checking ports are available. Test configuration and guards must explicitly prove the disposable project identity and loopback addresses; a hostname-only check is inadequate. The test orchestrator rejects production URLs and the user project's normal 54321/3000 endpoints for reset/cleanup. It cleans its own Docker volumes/workspace only; the user's accounts, `.env.local`, `.next` and running app remain untouched. CI uses one disposable stack for its job and retains the `verify` check name.

`npm run test:ci` is the single local/CI entry point for the full isolated acceptance pipeline. It creates `.wyp-test-work/<run-id>/` with explicit ownership markers, installs the locked dependencies in that workspace, runs script guard tests, starts the disposable milestone-three baseline, invokes the migration-preservation test and applies the pending migrations. After preservation assertions pass, it resets **only that same disposable project** for a clean full migration/seed pass, then runs seed drift, generated-type drift, all existing and new frontend/backend tests, pgTAP, Auth/Data API integration, type checking, production build and actual HTTP tests against its port-3100 app. All test fixtures, public local keys and provider connection details are injected into the isolated workspace rather than the user's `.env.local`. Any failed phase exits nonzero and fails `verify`; cleanup runs in a finalizer and retains bounded failure evidence outside the credential-bearing workspace. The CI workflow explicitly calls this pipeline, so the upgrade test cannot be accidentally omitted while the required check stays green.

The existing wrapper's hardcoded normal-development ports and the integration/HTTP helpers must be adapted together for this explicit disposable profile. Guarded profile selection requires the owned workspace marker, expected project identity and matching loopback endpoints; a port change alone is not authorization for reset or cleanup. Standalone publication test commands must refuse the normal user database rather than silently falling back to it.

## Implementation sequence after approval

1. Refresh repository refs and verify milestone three is merged into `dev`. Local `dev`/`main` refs were still at `74a7b01` during planning; do not infer remote state from those refs or force-reset them. Create the approved feature branch from current `dev`; the user retains push/merge control.
2. Freeze shared content/DTO/error/session-target contracts with the frontend builder. Add validator vectors and the isolated test harness first.
3. Add draft/review schema, role policies and owner-only read/save RPCs. Prove direct access isolation and additive upgrade preservation before exposing UI mutations.
4. Add review/atomic publish/withdraw RPCs and Next service/routes. Prove immutable versions, idempotency and rollback with real database tests.
5. Add verified learner library and explicit selected-session support, including old receipt compatibility and one-active-session conflict behavior.
6. Integrate frontend editing/review/library flows. Run the full existing regression suite plus new tests, type generation/drift checks and production build. Preserve CI triggers and `verify` job ID.
7. Complete real-browser and editorial acceptance, record actual results and remaining limitations, and provide the user a reviewable change set. Do not push, merge, deploy or send real email on their behalf.

The user approved the confirmed scope, draft/publication rules, guest/library access, withdrawal/history semantics, bounds, contracts and isolated-test approach. This report retains the design record; actual implementation/test evidence is in the linked verification report.
