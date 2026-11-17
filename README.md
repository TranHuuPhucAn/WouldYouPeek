# Would You Peek?

A local Valorant decision-practice app for advanced players. Watch a professional player's POV, make a choice at a paused moment, then watch the continuation with conditional analysis below. The active demo contains three approved moments from TenZ's ranked stream on Bind.

Matching the pro and making a defensible decision are independent outcomes. Explanations are static AI-authored interpretations, with observable facts and missing context identified separately.

## Run locally

Install **Node.js 24.x and npm**, then clone and start the project:

```sh
git clone https://github.com/TranHuuPhucAn/WouldYouPeek.git
cd WouldYouPeek
npm ci
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000), choose **Play 3 scenarios**, then press **Play setup**. The video pauses for your choice; submit to watch the pro's continuation and read the analysis below it.

No environment variables, accounts, database or API keys are required. YouTube playback needs an internet connection. Progress lives in the React session; refreshing starts over. Stop the server with `Ctrl+C`. If port 3000 is occupied, use `npm run dev -- --port 3001` and open the URL printed by Next.js.

The current setup has been verified on Apple Silicon macOS. The test runner still uses a Darwin-specific native dependency workaround; fresh installs and test execution on other platforms remain unverified.

To run an optimized production build locally:

```sh
npm run build
npm start
```

## Verify

```sh
npm test
npm run typecheck
npm run build
```

Run one test project with `npm test -- --project backend` or `npm test -- --project frontend`. Type checking generates Next.js route types first, so generated `.next/` files and `next-env.d.ts` do not need to be committed. `npm start` serves a successful production build. The build uses Webpack because Turbopack's CSS worker could not open its internal port in this environment; the development server uses Turbopack.

### Milestone two verification

Implemented and checked on 17 November 2026:

- **203 tests passed across 15 files**: 68 backend and 135 frontend tests.
- TypeScript checking and the production Webpack build passed.
- The built server passed 13 HTTP checks: catalogue, all three public details and all nine answer choices, including no-store headers, disclosure boundaries and comparison consistency.
- The actual catalogue completed a full automated session with a simulated YouTube provider: paused choices, selection-preserving replay, independent comparison/assessment, feedback beneath the video, recap, restart and refresh reset.
- The temporary embed-probe page was removed and the verification server stopped.

The selected source loaded and played in an official YouTube embed during an initial browser probe. That probe also confirmed that reaching YouTube's end boundary displays an end screen, so the app pauses early to retain the scene. Browser control became unavailable before the final app could be exercised. Accurate pauses for all three scenarios, normal-speed audio/spoiler review, and the final desktop/mobile, keyboard, replay, recovery and background-tab checks remain unverified. Automated player tests use a simulated provider and do not replace those checks.

The seven source screenshots in `artifacts/vod-review/` document the earlier visual review. Milestone one's 101-test/browser results concern the illustrative prototype and do not verify this VOD implementation. Older prototype screenshots and unused research captures are excluded from this repository.

## Active scenarios

All three use [WASHED GAMER PLAYS APAC RANKED](https://www.youtube.com/watch?v=_yPrykaB2nE) from the verified TenZ channel: player POV, Clove on Bind, ranked. This is the approved fallback to VCT footage. No video has been downloaded or rehosted.

| Scenario | Setup | Decision | Continuation end |
| --- | --- | --- | --- |
| `bind-clove-utility-window` | 28:25 | 28:33 | 28:38 |
| `bind-clove-smoke-contest` | 31:25 | 31:29.5 | 31:37 |
| `bind-clove-advantage-reset` | 31:43 | 31:53 | 32:00.5 |

The last two moments are an explicitly linked pair in the same round. The first examines utility timing, the second a low-health contest while down a player, and the third how aggression changes after gaining a 3v1 advantage. None requires a uniquely preferred answer; the successful smoke contest is still assessed as risky.

See [scenario evidence and reasoning](docs/vod-scenarios.md) and the [approved implementation plan](docs/milestone-2-plan.md) for source review, file responsibilities and acceptance checks.

## Playback and learner flow

The YouTube player stays mounted from setup through the decision. Replaying setup preserves the learner's selection. Submitting locks the answer, starts the pro's continuation and displays analysis beneath it. If autoplay is blocked, an explicit Play continuation control is available. Post-answer review can replay setup or continuation without creating another attempt. Recap presents the choice, pro comparison and assessment separately.

Playback uses the official YouTube IFrame API with source attribution and external accessible controls. The app polls playback time and pauses 0.30 seconds before the approved endpoint; this margin still needs live-browser verification. Replay reloads the bounded interval because seeking can cancel the provider's end bound. Network failure, unavailable sources and disabled embedding have retry/error states; background-tab handling pauses playback.

YouTube seeking and browser scheduling are not frame-perfect. The public source remains accessible, so this is an educational disclosure flow rather than an anti-cheating mechanism. Production publication should wait for the remaining playback and audio checks in the plan.

## Architecture

- `src/contracts/challenge.ts`: shared API types, including source metadata, bounded YouTube segments, paused decisions and conditional feedback.
- `src/server/challenges/data.ts`: server-only scenario catalogue, observations, AI analysis and separate visual/audio/embed review states.
- `src/server/challenges/service.ts`: safe public projections, submission validation and independent pro-choice comparison.
- `src/server/http.ts` and `src/app/api/challenges/**`: consistent JSON responses and three thin route handlers.
- `src/lib/client/challenge-api.ts`: response validation, including timestamps, option references, comparison consistency and answer/challenge agreement.
- `src/lib/session/session-reducer.ts` and `src/hooks/use-challenge-session.ts`: session transitions, request cancellation, selection preservation and submission guards.
- `src/lib/video/youtube-api.ts`: shared script loading, provider construction and recoverable errors.
- `src/lib/video/segment-controller.ts`: pure interval validation and playback decisions.
- `src/components/challenge/YouTubeScenarioPlayer.tsx`: persistent player, bounded replay, timing monitor and lifecycle cleanup.
- `src/components/challenge/**`: context, decisions, conditional analysis and recap. `ScenarioMedia.tsx` retains image and native-video support.
- `public/demo/**`: original milestone-one diagrams retained for illustrative regression fixtures.

## API

| Endpoint | Response |
| --- | --- |
| `GET /api/challenges` | `{ challenges: ChallengeSummary[] }`, in authored order. |
| `GET /api/challenges/[id]` | Context, source, visible facts, unknowns, setup bounds, paused-decision metadata and option labels. |
| `POST /api/challenges/[id]/answer` | Accepts only `{ "optionId": "use-meddle" }`; returns assessment, per-option conditions/risks, observed action, pro comparison, AI analysis and continuation. |

Initial GET responses exclude assessments, observed action, analysis, outcome, reveal bounds and internal review metadata. Answer fields remain server-only until submission. Recommended-option lists may be empty.

Errors use `{ error: { code, message } }`: invalid JSON/body/options return 400, unknown challenges return 404, and unexpected errors return a generic 500. Responses use `Cache-Control: no-store`. Submissions are stateless and deterministic; the server stores no personal data or attempt history. `contentVersion` identifies authored content, and the client rejects feedback for a different content version.

## Edit the content

Update `src/server/challenges/data.ts`. Each VOD record needs source metadata, setup/decision/reveal times, player-visible facts, unknowns, three options with independent assessments, an observed action referencing an option, conditional explanations, AI-analysis attribution and internal review evidence. Use the same video ID across source/setup/reveal, end setup at the decision and start continuation there.

Evaluate a decision using information available before the pause. Keep the visible outcome separate from inferred rationale; do not infer a player's intent or unavailable team communications. Review the normal-speed audio as well as the visuals for spoilers. A visual review alone does not qualify a source for publication.

The illustration and native-video branches remain supported for regression coverage. Illustrative fixtures must retain `mediaStatus: "demo"`, an image decision and an authored continuation; they must not imply a professional-player comparison.

## Test structure

- Backend: catalogue integrity, evidence references, safe projections, all nine choices, independent comparison/assessment, defensive copies, request validation and route errors.
- Frontend: response validation, reducer and asynchronous hook, full session flow, comparison/analysis rendering and image/native-video regressions.
- YouTube: script loading/retry, pure timing boundaries, player lifecycle, replay, autoplay fallback, failures, visibility handling and stale-event cleanup using a simulated provider.

Vitest uses Node for backend tests and jsdom for frontend tests. The `server-only` marker is mocked only in tests, including the tests that connect the real catalogue to the client; the Next.js build retains the actual import boundary. Tests establish application behaviour and internal consistency, not tactical correctness or improvements to in-game performance.

## Future milestones

- Add login and two roles: **learners** access scenarios; **creators** upload scenarios and author questions and explanations.
- Prefer creator-authored explanations long term. Keep AI drafts subject to editorial review.
- Build an automatic pipeline from a whole VOD to proposed decision segments, pause points, questions, observed actions and draft analysis.
- Keep extracted scenarios as drafts until a creator reviews, edits and approves them for publication.
- Expand the reviewed library across players, maps and decision types, using VCT footage when genuine player-only information is available.
- Add persistent progress, a database and media storage when the creator workflow requires them.

Accounts, uploads, extraction, persistence and deployment are outside this local demo milestone.
