# Milestone four frontend plan

Status: **approved and implemented; local verification complete with documented manual/remote checks**. Original planning baseline: `ded1adc` on local `feat/user`. Implementation is on `feat/creator`; this report retains the approved file/function/test design. See [verification evidence](milestone-4-verification.md) for actual results and limitations.

The companion backend plan owns database rules and shared transport contracts. The combined milestone plan is the final source of truth if a naming difference remains between reports.

## Decisions and scope

Confirmed product constraints carried forward:

- Advanced Valorant players train on real player POV with only information available to that player. Broadcast spectator outlines and omniscient information do not meet the intended content standard.
- A learner commits a decision, the pro continuation starts, and analysis appears below the video. There is no new mandatory watch-to-end gate in this milestone.
- Matching the observed pro action and choosing a defensible action are separate outcomes. Multiple choices can be reasonable; there is no requirement to invent one correct answer.
- Verified creators retain learner access. Creator pages and APIs must not expose another creator's private drafts or another learner's sessions.
- The existing three-scenario demo, accounts, history, and immutable saved answers remain usable.
- Creator-written analysis replaces the demo's AI-only assumption. Optional declared AI assistance is labelled honestly; no AI generation API is introduced here.

Product choices confirmed by the user during this planning pass:

1. Creators review and publish their own scenarios. A separate moderator/reviewer role is not added.
2. Creators submit YouTube links and timestamps. Uploaded video files, storage buckets, transcoding, and upload progress are deferred.
3. Learners browse published scenarios and start one-scenario sessions; the original three-scenario demo remains available. Creator-authored collections are deferred.

The library plan keeps guests on the existing three-scenario demo. Browsing creator-published entries and starting their scenarios require a verified learner or creator account. Existing guest demo access remains unchanged.

Separate reviewers, file uploads, and creator-authored training sets remain outside the approved scope.

## What the current implementation already provides

- `YouTubeScenarioPlayer`, `DecisionPanel`, and `FeedbackPanel` provide reusable bounded playback and decision/review presentation.
- `ChallengePlayer` and `useChallengeSession` are tied to persisted learner sessions. A creator preview must not mount that hook or post learner answers.
- `PlayDashboard` currently describes only the TenZ three-scenario demo. `ChallengePlayer` has three fixed progress segments and `SessionRecap` hardcodes “Three calls.” These need to reflect the actual selected session.
- `FeedbackPanel`, `SessionRecap`, the `AIAnalysis` contract, and response validation assume analysis is AI-authored. New creator provenance needs an additive, backwards-compatible change across all of them.
- Session reads and writes already use verified identity, caller-owned records, revisions, request UUIDs, and canonical response validation. Authoring should follow those conventions rather than introduce an unrelated mutation mechanism.
- Existing account invalidation events unmount private learner data and reject late responses. Creator draft/editor and review components must participate in the same lifecycle.

The installed Next.js documentation was consulted: `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`, `01-app/01-getting-started/07-mutating-data.md`, and `01-app/02-guides/authentication.md`. Pages remain Server Components for initial guarded reads; interactive forms and playback are Client Components. Authorization stays close to the data/service boundary, not solely in layout or client navigation.

## User journeys

### Creator workspace

`/creator` becomes the creator dashboard. An authenticated learner without creator access keeps the existing link to enable it in Account. A verified creator sees their own paginated scenario list, a “New scenario” button, and clear separate indicators for working draft and learner-visible publication.

Creating a draft is an explicit button action, never a GET/page-render side effect. The button posts an idempotent create command and navigates to `/creator/scenarios/[id]`. A double click or lost response must not create two drafts. An empty draft is displayed as “Untitled scenario.”

Each dashboard row shows title, last saved date, draft readiness/review state, publication state, and links to edit or review. A scenario can be published while having unpublished edits: the UI must display both facts rather than collapse them into a misleading single status. Dashboard filters are exactly `all | unpublished | published | withdrawn`; `unpublished` means never published, while readiness/review remain separate badges. Pagination cursors are bound to the selected filter. Full-text search, bulk operations, analytics, collaboration, and hard deletion are deferred.

### Edit a working draft

`/creator/scenarios/[id]` presents one form with labelled sections and a sticky Save/status area. Keep ordinary text inputs, textareas, selects, and repeatable rows; no rich-text editor or raw JSON editing is needed.

| Section | Fields and behaviour |
| --- | --- |
| Source | YouTube URL, source title/uploader, player, ranked/tournament, map, agent, round, score, attack/defense, optional source date/date note. Creator supplies attribution manually; no scraped metadata or uploaded media is implied. |
| Timing | Setup start, decision pause, and continuation end; all reference the same source video. Inputs accept seconds or `mm:ss[.sss]` / `hh:mm:ss[.sss]`. Accessible descriptions explain which portion learners see before answering. |
| Moment | Title, topic, player-visible context, question, known facts, and unknown information. Facts and uncertainties remain separate. |
| Choices | Two to five options for a publishable scenario. Each option has a stable ID, label, independent assessment, explanation, acceptable conditions, and risks. Removing/reordering options must not silently change the observed action's identity. |
| Observed action | Select the option corresponding to what the pro did and describe the action factually. This selection does not automatically mark an option recommended. |
| Analysis | Creator-authored or AI-assisted declaration, rationale, limitations, takeaway, and recorded outcome. Explain assumptions rather than claiming to know the pro's intent. |

The backend-owned limits are surfaced in labels and counters: title 120 characters, topic 80, option label 160, short text 300, ordinary prose 2,000, context/rationale/option explanation 4,000, at most ten items per text list, and at most five options. Unknowns, analysis limitations, acceptable conditions, and risks may be empty when the creator deliberately finds none and has reviewed the content; do not require invented uncertainty or filler to pass validation. Proposed source times are 0–43,200 seconds with millisecond precision; publishable setup is 2–120 seconds and continuation 1–120 seconds. These are product limits proposed for approval, not discovered limitations of YouTube.

**Saving and incomplete content:** explicit Save persists blanks/nulls and incomplete semantic content, while rejecting malformed values and oversized payloads. A blank time maps to `null`; a malformed nonempty time is an inline error, not silently saved as zero. Draft readiness reports what still prevents review. Saves do not publish, and draft edits never change an existing live version.

**Unsaved changes:** keep edits in component state, scoped to the authenticated owner. Show “Unsaved changes,” “Saving…,” and “Saved at …” using confirmed server responses. Guard supported in-app navigation and browser unload where available. A browser unload prompt is best effort; explicit Save is the durability mechanism. No persistent browser draft cache is introduced. Signing out or losing identity clears/unmounts private editor state; saved work remains in the database.

**Races:** one mutating command at a time. A save carries the last resource revision and an immutable payload snapshot. If typing continues during a save, accept the returned saved baseline without overwriting newer local edits. A stale tab receives a conflict notice with “Compare with latest” and an explicit “Load latest saved draft” action. Do not silently overwrite remote content or offer force-save. Users may copy their text manually before discarding local edits; a merge editor is outside this milestone.

If a response is lost, retain the exact request UUID and payload and offer Retry save. Do not manufacture a new command until that request is reconciled. Late responses after navigation or account changes are ignored.

### Review a saved revision

“Review saved draft” links to `/creator/scenarios/[id]/review` only after local edits have been saved. Review is always based on the server's saved draft revision; the header displays that revision and its save time. The page cannot quietly preview unsaved browser data and then publish a different stored draft.

The review page contains:

1. A readiness report linking missing/invalid fields back to the editor.
2. An owner-only learner preview that runs setup → paused decision → local choice → pro continuation with analysis below. All choices can be explored by restarting the preview. It displays “Creator preview — no session or progress is saved.”
3. A checklist for player-only information, pause/continuation timing, normal-speed source audio, embed playback, source attribution, and conditional analysis. These are creator attestations, not claims that automated tests or the browser have established tactical truth.
4. A “Mark reviewed” action that records the exact saved draft revision. A subsequent explicit “Publish scenario” or “Publish update” action consumes that review receipt.

Checkboxes are local to the current saved draft until submitted. Loading another content revision clears them. Changes saved in another tab cause review/publish commands to fail with a conflict and require the creator to reload/review the latest draft. Review-only resource changes do not reset the preview or the checklist for an unchanged draft. Viewing a valid review receipt does not confer access to other creators' content.

Preview reuses presentation and the lower-level video component, but it has its own small local state machine. It does not call `/api/sessions`, create a session, submit an answer, affect history, or emit learner completion analytics. All preview feedback is intentionally available to the owning creator; it must never be passed to a public library Client Component or serialized into a public page.

### Publish, revise, and withdraw

Publishing has a concrete final action and summary: title, source, exact reviewed draft revision, and whether this is an initial publication or an update. The UI does not mark the scenario live until the server returns success. A retry uses the same command; publishing the same content again does not create another version.

After publication, the creator sees a link to the learner-facing library entry. Editing creates unpublished changes while learners continue to receive the previous live version. Republishing creates a new immutable version for future sessions. Existing sessions and completed history retain the versions they originally pinned.

“Unpublish” is a separate explicit action with an inline confirmation explaining that the entry will leave the library and stop accepting new starts. It preserves drafts, previous versions, and already-started/completed sessions. Unpublishing clears the review receipt; restoring visibility requires reviewing and publishing again. This is normal editorial withdrawal, not a hard content erasure feature. No hard-delete control is added.

### Learner library and selected sessions

`/library` is for verified learners and creators. It lists published scenarios with title, topic, player/map/agent/source information, and provenance label without exposing option assessments, observed action, reveal times, or analysis. `/library/[scenarioId]` shows a setup-only preview, attribution, and Start action. Guests receive a sign-in redirect that safely preserves the selected library URL. Entries use the currently published version; source availability remains an external dependency.

The original `/demo` and three-scenario demo start remain explicit. The Play dashboard shows the user's actual active session and links to the library. Session history and recap show a useful title and actual number of decisions, including one-scenario runs.

A start request carries `{ kind: 'demo' }` or `{ kind: 'scenario', scenarioId }`. If the same target is active, resume it. If a different target is active, show “Finish your current session before starting this scenario” with a Resume link and return-to-library action; do not silently navigate into unrelated content. This milestone does not add abandon/delete-session semantics. A completed session's “Play again” preserves its target; if that scenario is withdrawn, show the unavailable result and a library link instead of falling back to the demo.

## Shared contracts agreed with the backend planner

These interfaces are the approved coordinated frontend/backend design. The backend builder owns shared contracts and both builders review their implementation before UI integration. Learner-visible DTOs are explicit projections, not spreads of a private authored object.

```ts
type CreatorScenarioSnapshot = {
  id: string;
  revision: number; // Resource revision: every accepted non-replayed mutation.
  draft: {
    revision: number; // Content revision: changes only when content changes.
    content: CreatorDraftContent;
    savedAt: string;
  };
  readiness: { issues: ValidationIssue[]; canReview: boolean };
  review: {
    id: string;
    draftRevision: number;
    reviewedAt: string;
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
  publishedVersion: string | null;
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
type SessionTarget =
  | { kind: 'demo' }
  | { kind: 'scenario'; scenarioId: string };
```

`CreatorDraftContent` groups `title`, `topic`, `context`, `question`, `source`, `media`, `knownFacts`, `unknowns`, `options`, `observedAction`, `analysis`, `takeaway`, and `outcomeText`. Blank strings/nulls/empty arrays are valid draft defaults. Media is expressed as `startSeconds`, `decisionSeconds`, and `endSeconds` plus setup/decision/reveal alt text. The server derives only the video ID/canonical URL from the submitted YouTube URL and constructs the published challenge shapes. Title, uploader and dates remain manually supplied creator claims, not fetched or externally verified metadata. Clients cannot assign owner, publisher, live version, or trusted review identity.

An option's `id` is stable across edits/reordering, and its assessment is nullable until ready. New analysis supports `author: 'creator' | 'ai-assisted'`; previously published `author: 'ai'` remains readable with its original notice. Attribution must use server-approved generic labels and existing source credit, never the creator's private email. The library receives a dedicated allowlisted provenance label/enum; it never receives the full analysis object merely to display authorship. Public display-name/profile editing is outside scope.

| API | Frontend use |
| --- | --- |
| `GET /api/creator/scenarios?cursor=…&status=…` | Own dashboard and pagination; optional status is `all`, `unpublished`, `published`, or `withdrawn`, with a filter-bound cursor. |
| `POST /api/creator/scenarios` with `{ requestId }` | Explicitly create an empty draft. |
| `GET /api/creator/scenarios/[id]` | Own canonical editor snapshot and conflict reconciliation. |
| `PUT /api/creator/scenarios/[id]` with `{ requestId, expectedRevision, content }` | Save working content; resource and content revisions remain distinct. |
| `GET /api/creator/scenarios/[id]/review?revision=…` | Owner-only, revision-bound preview containing `{ scenario, challenge, feedbackByOption }`; invalid content produces safe field issues. |
| `POST …/[id]/review` with `{ requestId, expectedRevision, checklist }` | Record review of the exact saved draft revision. |
| `POST …/[id]/publish` with `{ requestId, expectedRevision, reviewId }` | Publish only the current reviewed draft. |
| `POST …/[id]/unpublish` with `{ requestId, expectedRevision }` | Withdraw new access while preserving saved history. |
| `GET /api/library/scenarios?cursor=…` and `GET …/[id]` | Published setup-only catalogue/detail. |
| `POST /api/sessions` with `{ requestId, target }` | Start/resume requested target; receive canonical saved session. |

All owner responses use no-store and validate the expected scenario ID, revisions, nested content shape, and legal publication/review relationships. Mutations return `CreatorMutationResponse`; `scenario` is the current canonical snapshot, while `publishedVersion` identifies the publication produced by that specific operation. On replay it may differ from a newer version currently live. The UI must not overwrite current publication state with the historical receipt value. `ACTIVE_SESSION_EXISTS` includes only the caller's own safe session summary in `error.details.activeSession`. `ApiClientError` preserves only the agreed code-matched details union, `{ issues: ValidationIssue[] } | { activeSession: SessionSummary }`; raw server objects are not rendered.

The preview endpoint's `?revision=` parameter is the **resource** revision. The review receipt's `draftRevision` identifies the reviewed **content** revision. The review page first obtains a snapshot, then requests its preview with `snapshot.revision`; if another command races between those reads, it shows a conflict/reload state rather than previewing a different revision. The preview component identity is keyed by account/scenario/`draft.revision`, so a review-only resource revision change preserves playback/choice state. A Save with unchanged normalized content leaves `draft.revision` and its valid review receipt intact; an actual content change increments it and clears the review.

## Proposed folder tree

`N` means new, `M` means modified, and `S` means shared/backend-owned contract or server integration. Only this planning document is being created now.

```text
src/
├── app/
│   ├── creator/page.tsx                                  M
│   ├── creator/scenarios/[id]/page.tsx                   N
│   ├── creator/scenarios/[id]/review/page.tsx            N
│   ├── library/page.tsx                                  N
│   ├── library/[scenarioId]/page.tsx                     N
│   ├── play/page.tsx                                     M
│   ├── protected-page.ts                                M
│   └── globals.css                                       M
├── components/
│   ├── creator/
│   │   ├── CreatorDashboard.tsx                          N
│   │   ├── CreatorStatus.tsx                             N
│   │   ├── ScenarioEditor.tsx                            N
│   │   ├── SourceFields.tsx                              N
│   │   ├── TimingFields.tsx                              N
│   │   ├── DecisionFields.tsx                            N
│   │   ├── AnalysisFields.tsx                            N
│   │   ├── CreatorReview.tsx                             N
│   │   ├── ScenarioPreview.tsx                           N
│   │   └── PublicationControls.tsx                       N
│   ├── library/
│   │   ├── ScenarioLibrary.tsx                           N
│   │   └── ScenarioStart.tsx                             N
│   ├── navigation/SiteHeader.tsx                         M
│   ├── sessions/PlayDashboard.tsx                        M
│   ├── sessions/SessionHistory.tsx                       M
│   ├── challenge/ChallengePlayer.tsx                     M
│   ├── challenge/FeedbackPanel.tsx                       M
│   ├── challenge/SessionRecap.tsx                        M
│   └── challenge/AnalysisNote.tsx                        N
├── hooks/
│   ├── use-scenario-editor.ts                            N
│   └── use-challenge-session.ts                          M
├── lib/
│   ├── creator/
│   │   ├── content.ts                                    N, S
│   │   ├── editor-state.ts                               N
│   │   ├── timestamps.ts                                 N
│   │   └── preview-state.ts                              N
│   ├── client/
│   │   ├── creator-api.ts                                N
│   │   ├── creator-validation.ts                         N
│   │   ├── library-api.ts                                N
│   │   ├── api-response.ts                               M
│   │   ├── challenge-validation.ts                       M
│   │   └── session-api.ts                                M
│   └── session/hydrate-session.ts                        M if target projection needs it
└── contracts/
    ├── creator.ts                                        N, S
    ├── library.ts                                        N, S
    ├── challenge.ts                                      M, S
    └── session.ts                                        M, S

tests/frontend/
├── creator-fixtures.ts                                   N
├── creator-api.test.ts                                   N
├── creator-validation.test.ts                            N
├── creator-editor-state.test.ts                          N
├── creator-timestamps.test.ts                            N
├── creator-dashboard.test.tsx                            N
├── creator-editor.test.tsx                               N
├── use-scenario-editor.test.tsx                          N
├── creator-review.test.tsx                               N
├── creator-preview.test.tsx                              N
├── creator-publication.test.tsx                          N
├── library-api.test.ts                                   N
├── scenario-library.test.tsx                             N
├── scenario-start.test.tsx                               N
├── analysis-note.test.tsx                                N
├── navigation-and-pages.test.tsx                         M
├── play-dashboard.test.tsx                               M
├── session-history.test.tsx                              M
├── session-api.test.ts                                   M
├── challenge-player.test.tsx                             M
├── feedback-and-recap.test.tsx                           M
├── saved-session-flow.test.tsx                           M
└── use-challenge-session.test.tsx                        M

docs/milestone-4-verification.md                          N during implementation
README.md                                                 M during implementation
```

The backend report lists the matching route handlers, services, migrations, database tests, and integration/HTTP tests. Avoid adding frontend-owned API stubs to production paths; component tests use mock transport adapters/fixtures.

## File, function, and test responsibilities

### Server pages and navigation

| File | Planned functions and responsibility | Verification |
| --- | --- | --- |
| `app/creator/page.tsx` | `CreatorPage()` obtains verified identity, renders the learner enable-access callout or loads the caller's creator list and passes only safe DTOs to the dashboard. | Page tests for guest/unverified/learner/creator paths; owner data absent for learners; empty/error states. Real HTTP tests confirm direct access, not only navigation hiding. |
| `app/creator/scenarios/[id]/page.tsx` | `CreatorScenarioPage()` awaits route params, requires creator access, obtains the owner-only snapshot, maps missing/foreign IDs to a generic not-found page, and keys editor state to account/scenario identity. | Direct URL tests for own vs foreign draft; malformed IDs; storage error distinct from not-found; no private RSC payload for unauthorized viewers. |
| `app/creator/scenarios/[id]/review/page.tsx` | `CreatorReviewPage()` reads the saved snapshot/readiness and binds preview to its resource revision; renders blockers instead of leaking a partial invalid preview. | Incomplete draft, own valid draft, concurrent edit, and foreign IDs. Server functions get safe DTOs directly rather than fetching the app's own API. |
| `app/library/page.tsx` | `LibraryPage()` requires a verified account, loads the published first page, and renders a neutral empty state. | Guest sign-in redirect, unverified check-email redirect, withdrawn/draft absence; no private authored fields in props/RSC. |
| `app/library/[scenarioId]/page.tsx` | `LibraryScenarioPage()` obtains published preview and current viewer, renders attribution/setup plus start/sign-in control, handles withdrawn/missing identically. | Only setup before answer; safe return URL after sign-in; no leaking outcomes in metadata/title hints. |
| `app/protected-page.ts` | Preserve `requirePageAccount()` and add `requirePageCreator(returnTo)` using server role checks and existing safe auth redirects. | Missing identity, unverified identity, learner without create capability, creator, and unavailable auth/storage. |
| `app/play/page.tsx` | `PlayPage()` passes actual active-session metadata and explicit demo target to the dashboard. | Existing demo start/resume and new single-scenario active-session summary. |
| `components/navigation/SiteHeader.tsx` | `SiteHeader()` exposes Library to signed-in learners/creators, preserves demo/auth/account navigation, and wraps correctly on narrow widths. | Role-specific links, keyboard navigation, browser mobile layout. |

### Creator components

| File | Planned functions and responsibility | Verification |
| --- | --- | --- |
| `CreatorDashboard.tsx` | `CreatorDashboard()` owns list state; `createDraft()` posts one idempotent create command; `loadMore()` appends unique rows; `changeFilter()` switches among `all`, `unpublished`, `published`, `withdrawn`, resets the filter-bound cursor, and rejects late responses from previous filters. | Empty list, duplicate click, lost response/retry, pagination deduplication, filter races, correct never-published filter semantics, role expiry and aborted late results. |
| `CreatorStatus.tsx` | `CreatorStatus()` renders separate draft/review/publication labels; `describeCreatorStatus(snapshot)` derives concise accessible text without equating an edited live item to an unpublished item. | Never-published/incomplete, ready, reviewed, published-with-edits, published-without-edits, and withdrawn combinations. |
| `ScenarioEditor.tsx` | `ScenarioEditor()` composes sections and hook; `handleSubmit()` saves; `focusFirstIssue()` moves focus to the first actionable field; `confirmLeave()` protects supported in-app navigation when dirty. | Semantic labels; keyboard save; error summary links; latest local text surviving an in-flight save; unsaved navigation; no request to publish on Save. |
| `SourceFields.tsx` | `SourceFields()` renders metadata inputs and source URL feedback; `updateSourceField()` changes only the intended field. Shared backend-owned YouTube parsing returns canonical information; no automatic external fetch. | Allowed URL shapes, rejected non-YouTube/javascript/private-host URLs, nullable enum/round, text escaping and source credit labels. |
| `TimingFields.tsx` | `TimingFields()` keeps editable strings with field errors, exposes normalized segment lengths, and updates typed timing when parseable. | Fractional/whole timestamps, empty vs invalid, order/length boundaries, precision, screen-reader description; no frame-perfect promise. |
| `DecisionFields.tsx` | `DecisionFields()` renders title/context/question/facts/unknowns and option rows; `addOption()`, `removeOption(id)`, `moveOption(id,direction)`, `updateOption(id,patch)` preserve stable IDs; removing the observed option clears its reference and flags readiness. | Two–five choice limits, unique IDs, reordered IDs retain feedback, removing observed action cannot retain dangling match, zero or multiple recommended options valid, dynamic rows labelled and keyboard operable. |
| `AnalysisFields.tsx` | `AnalysisFields()` renders observed-action selector, creator/AI-assisted declaration, rationale, limitations, takeaway, and outcome; `updateAnalysisField()` and list callbacks update only the selected field. | Independent assessment vs pro choice; plain text escaping; missing limitations/unknowns supported as empty when consciously none; no fake AI generation button. |
| `CreatorReview.tsx` | `CreatorReview()` combines readiness, owner preview, revision labels, checklist and publication actions; `toggleChecklistItem()`, `markReviewed()`, `reloadReview()` manage local attestations and command results. | Incomplete checklist, stale draft/review receipt, required normal-speed audio attestation, safe errors, saved-only preview, content changes clearing checks, review-only resource changes preserving preview, and no-op Save retaining the review receipt. |
| `ScenarioPreview.tsx` | `ScenarioPreview()` runs isolated preview state using the reusable player/panels; `completeSetup()`, `selectOption(id)`, `submitPreviewChoice()`, `replayPreview()`, `showReviewMedia(mode)` change local state only. | No network/session writes; no reveal before local commit; correct selected feedback for every option; comparison independent of assessment; source changes reset preview; playback retry/autoplay errors preserve local choice. |
| `PublicationControls.tsx` | `PublicationControls()` offers explicit publish/update/unpublish controls; `publishReviewedDraft()`, `requestUnpublish()`, `confirmUnpublish()`, `retryCommand()` preserve operation UUID and current revision until resolved. | Double-click and response loss, rejected stale review, no optimistic published badge, inline confirmation, withdrawal preserving history, idempotent canonical result. |

### State and transport

| File | Planned functions and responsibility | Verification |
| --- | --- | --- |
| `hooks/use-scenario-editor.ts` | `useScenarioEditor(initial,viewerId)` coordinates form, saved baseline and mutation state; `saveDraft()`, `retrySave()`, `fetchLatest()`, `acceptLatest()`, `invalidateIdentity()` handle API outcomes without discarding newer typing. | Hook-level race tests: edit during save, same UUID retry, remote newer revision, delayed/aborted replies, account switch, unsaved values retained after validation failure, owner data cleared on auth expiry. |
| `lib/creator/editor-state.ts` | `createEditorState(snapshot)` builds initial values; `editorReducer(state,action)` applies field/option edits and confirmed snapshots; `isEditorDirty(state)` compares normalized persistable content; `buildDraftCommand(state,requestId)` freezes the payload with resource revision. | Meaningful transitions and invariants, especially edits after submit, revision monotonicity, retained pending command, immutable payload, no read-only metadata accepted from form state. |
| `lib/creator/content.ts` (backend-owned) | `validateDraftContent()`, `validatePublishContent()`, and `parseYouTubeSource()` provide pure shared limits/normalization/readiness logic. The frontend imports them for feedback; database and server enforcement remain independent. | The same edge-case vectors exercise client parsing, server validation and direct RPC enforcement. Test valid local draft states separately from publishable states. |
| `lib/creator/timestamps.ts` | `parseTimestampInput(text)` returns value/null or a specific format/range issue; `formatTimestampInput(seconds)` preserves millisecond precision; `getTimingSummary(media)` returns setup/reveal durations without mutating content. | Boundary table for negative/nonfinite/exponential/malformed colon forms, seconds/minutes overflow, whitespace, fractional round-trip, blank, ordering, source maximum and max segment durations. |
| `lib/creator/preview-state.ts` | `createPreviewState(preview)` initializes setup; `previewReducer(state,action)` handles setup/decision/review/reset; `selectPreviewFeedback(preview,optionId)` chooses already-owner-authorized feedback and rejects unknown IDs. | Illegal transition rejection, no skipped commit, original scenario ID/version consistency, selection/reset isolation; preview has no auth/session side effects. |
| `lib/client/creator-api.ts` | `listCreatorScenarios()`, `getCreatorScenario()`, `createCreatorScenario()`, `saveCreatorScenario()`, `getCreatorReview()`, `reviewCreatorScenario()`, `publishCreatorScenario()`, `unpublishCreatorScenario()` serialize documented routes/bodies, no-store fetches, abort signals, and validate responses. | Correct verbs/paths/bodies, expected ID, malformed responses, safe errors, 401/403/404/409/422/503, abort propagation; exact UUID reuse exercised above. |
| `lib/client/creator-validation.ts` | `parseCreatorSnapshot()`, `parseCreatorList()`, `parseCreatorReview()` validate owner DTOs; `parseCreatorMutationResponse()` validates the canonical snapshot separately from the operation's publication receipt; `parseValidationIssues()` accepts only safe field-path/code/message tuples; `validateCreatorContinuity(next,previous)` rejects older/different records. Shared draft schema/limits are imported, not copied. | Unknown fields, malformed option IDs, bad timestamp/enum values, duplicate rows, invalid resource/draft/review combinations, preview answer-key consistency, replayed historical publishedVersion with a newer canonical live version, unexpected private metadata. |
| `lib/client/library-api.ts` | `listLibraryScenarios(cursor)`, `getLibraryScenario(id)`, `parseLibraryPage()`, `parseLibraryEntry()` validate allowlisted published projections and pagination. | Empty/end pages, duplicate IDs, unavailable entries, wrong source/video identity, forbidden feedback/reveal/owner fields, invalid cursors. |
| `lib/client/api-response.ts` | Extend `ApiClientError` and `parseApiError()` to retain allowlisted `details` for field issues and `ACTIVE_SESSION_EXISTS`; preserve existing generic handling for unknown server payloads. | Nested private/error-internal data dropped, safe field issue mapping, active summary validation, all existing error consumers still pass. |
| `lib/client/challenge-validation.ts` | Update `isAnalysis()` and affected preview/detail/answer validators for approved creator provenance while preserving legacy AI data and restrictive preview allowlists. | Creator/AI-assisted/legacy AI accepted; invalid provenance rejected; draft fields never accepted by published preview validators. |
| `lib/client/session-api.ts` | Extend `createOrResumeSession()`, `parseSessionSnapshot()`, `parseSessionSummary()`, and `validateSessionContinuity()` with explicit target/title while retaining existing UUID/revision/pinned-answer invariants. | Same target resume; different target conflict with owned summary; old session target backfill compatibility; one-item and three-item runs; target cannot change mid-session. |

### Library and existing learner components

| File | Planned functions and responsibility | Verification |
| --- | --- | --- |
| `ScenarioLibrary.tsx` | `ScenarioLibrary()` displays published cards; `loadMore()` appends without duplicates; no private authoring payload is accepted by props. | Loading/empty/error/retry, pagination, guest policy, safe attribution, absent draft/answer content. |
| `ScenarioStart.tsx` | `ScenarioStart()` renders sign-in or a requested-target start button; `startScenario()` sends stable request ID and target; `resumeExisting()` follows only the server-provided owned-session ID. | Same-target resume, different-target conflict display, signed-out flow/return path, withdrawn entry between view and click, repeated click, auth expiry and retry. |
| `PlayDashboard.tsx` | `PlayDashboard()` shows actual active title/count; `startOrResume()` uses explicit demo target when starting the demo; add library entry link. | Demo regression, active single-scenario label, stale dashboard conflict, no unrelated-target silent resume. |
| `SessionHistory.tsx` | Preserve `loadMore()` and render pinned session title/target with actual count. | Old demo/new scenario histories, published update/withdrawal does not relabel past content, pagination and account isolation. |
| `ChallengePlayer.tsx` | `ChallengePlayer()` renders progress from actual item count, preserves current answer persistence and video lifecycle, and passes target to recap/restart. | One vs three items, final-review Finish, no progress placeholders, all existing answer/reload/auth-expiry regressions. |
| `AnalysisNote.tsx` | `AnalysisNote()` centralizes server-approved provenance/rationale/notice/limitations; `analysisLabel()` maps legacy AI, creator and AI-assisted authorship. | Correct labels/ARIA text; no creator email; no creator prose falsely labelled AI; safe rendering of HTML-like input. |
| `FeedbackPanel.tsx` | Preserve `assessmentLabel()` and independent pro comparison; `FeedbackPanel()` uses `AnalysisNote()` and supports a preview-specific final action label without implying a saved learner session. | Existing comparison/conditional feedback tests; zero/multiple preferred options; preview button does not say saved; analysis follows the committed choice and sits below continuation. |
| `SessionRecap.tsx` | `SessionRecap()` uses actual completed count and `AnalysisNote()`; replay preserves target, and library navigation is explicit. | Singular/plural counts, legacy AI/new creator label, old pinned analysis, unavailable replay path. |
| `hooks/use-challenge-session.ts` | `createNextSession()` sends the completed session's target and handles active-target/unpublished conflicts; existing submit/reconcile/advance behaviour stays unchanged. | Replay of single scenario remains single; replay after update uses newly published version; withdrawn source is unavailable; response loss and unrelated active target are handled explicitly. |
| `app/globals.css` | Add creator/editor/review/library layout, field-error/status styles, mobile stacking and visible focus states using existing design tokens. | Browser visual review at narrow phone and desktop widths, long titles/validation lists, no horizontal overflow, focus visibility and reduced-motion compatibility. |

## Planned automated and browser verification

Meaningful functions are tested through observable behaviour and invariants; do not add tautological tests for getters or static markup. Reuse existing Vitest/Testing Library setup and frontend fixture factories. Do not introduce a new frontend form/state framework solely for this milestone.

New frontend fixtures include a blank/incomplete draft, review-ready draft, reviewed draft, published draft with unpublished changes, withdrawn entry, generic creator/AI-assisted feedback, and one-scenario session. Factories derive from shared contract-safe fixtures and avoid private account data or real credentials.

The minimum cross-layer acceptance walkthrough is:

1. A guest can still view the approved demo and cannot answer or read private creator routes.
2. A learner enables creator access, creates an incomplete draft, saves it, signs out/in, and sees the saved draft again.
3. The creator enters a legitimate YouTube source, timings, context, two or more options, conditional feedback and observed action; Save never changes the library.
4. The review page uses the saved revision; every preview choice yields correct local feedback, and history/session counts remain unchanged.
5. Required checks are completed after normal-speed source/audio/playback review; review then publish makes one library entry available to an independent learner.
6. An independent creator cannot open or mutate that draft by guessing its ID; a learner's initial response and public page contain no answer key or reveal metadata.
7. The learner starts the single scenario, commits an answer, watches the continuation with analysis below, finishes, reloads, and reads saved history.
8. The creator edits/publishes another version; a new run receives it while the old run retains original question, feedback and provenance.
9. The creator unpublishes; new catalogue/start requests stop, existing owned sessions/history remain readable and resumable.
10. Two tabs edit the same draft: the second save reports conflict without discarding typed text or overwriting newer saved work. Repeat at review/publish boundaries.
11. Simulate an interrupted save/publish response, then retry; one saved revision/publication results. Verify auth expiry/account switching removes all creator preview/draft material and ignores late responses.
12. Start a different scenario while the demo is active; the UI explains the conflict and offers Resume. Finish the active session, then start the intended scenario successfully.

Browser acceptance covers keyboard-only create/edit/review/publish, focus after validation, screen-reader-friendly labels/status, narrow phone and desktop layouts, blocked autoplay, source/embed failure, background-tab playback pause, and actual normal-speed audio/spoiler inspection. Mock player tests establish UI behaviour only. A creator's self-attestation is recorded transparently and is not described as an independent editorial approval.

Existing unit/component, database, integration, HTTP, typecheck and build commands remain required CI checks under the existing `verify` job. The backend builder extends actual HTTP and database tests for ownership, validation, atomic publishing and version/history isolation. The coordinated test-stack proposal uses a separate Supabase project with API `55321`, database `55322`, email inbox `55324`, and an acceptance app at `3100`. Its origin, callback configuration and test-target guards must be generated together. Run destructive reset and publication tests only against that explicitly disposable target; never reset or publish test fixtures into the user's current trial database/library on ports `54321`/`3000`. CI remains isolated on its own runner.

## Build order after approval

The shared full-suite entry point will be `npm run test:ci`, backed by the isolated orchestrator in the backend report. Its generated source/environment/build workspace is `.wyp-test-work/<run-id>/`, excluded from Git. The same pipeline runs upgrade preservation and the existing/new suites under GitHub's required `verify` job; frontend integration must not launch publication tests against the user's normal development stack.

1. Freeze shared contracts, exact field limits, guest library policy, lifecycle/error codes and test fixtures with the backend builder. Read the installed Next.js guides again if code guidance changes before implementation.
2. Build creator dashboard and explicit Save editor against mocked transport fixtures; include incomplete drafts and save/conflict/auth states from the start.
3. Add saved-revision review, isolated preview, review receipt, and explicit publish/unpublish controls. Exercise errors before connecting real persistence.
4. Connect backend routes and actual ownership checks; run cross-layer creator flows with two disposable accounts.
5. Add the published library, explicit session targets, generic session labels/counts, provenance rendering and correct replay behaviour. Re-run all existing demo/auth/session tests.
6. Complete actual browser/audio/mobile acceptance and CI checks; update README and `docs/milestone-4-verification.md` with exact passed checks and any remaining limitations.

Frontend builder owns components, hooks, client transport/validators, styles and frontend tests. Backend builder owns shared contracts, services, route handlers, migrations and integration/HTTP permissions tests. The primary agent owns interface reconciliation, final end-to-end acceptance and documentation integration. Only one builder edits each shared file at a time.

No implementation starts until the user approves the combined milestone plan. A new implementation feature branch must be based on updated `dev` after milestone three is merged; planning does not switch branches or push changes.
