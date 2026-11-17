# Milestone three verification

Verified locally on 17 November 2026. Implementation is on `feat/user`, created from `dev` at `74a7b01`. No commit, push, merge, hosted deployment or real email delivery was performed.

## Automated results

| Check                              | Result                                                                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| macOS Apple Silicon clean `npm ci` | Passed; removed the Darwin-only optional dependency workaround.                                                                                              |
| Linux x64 clean `npm ci`           | Passed in a disposable `node:24-bookworm-slim` container.                                                                                                    |
| Unit/component tests               | **381 passed, 42 files** on macOS and Linux x64. Includes 200 backend and 181 frontend tests.                                                                |
| PostgreSQL pgTAP                   | **77 assertions passed, 3 files**, against the actual local database.                                                                                        |
| Supabase Auth/Data API integration | **13 tests passed, 3 files**. Repeated successfully after service restart.                                                                                   |
| Actual Next.js HTTP API            | **7 tests passed** against both development and production servers.                                                                                          |
| Type checking                      | Passed on macOS and Linux x64.                                                                                                                               |
| Production Webpack build           | Passed on macOS. Extra Linux x64 build under Rosetta emulation did not complete; see limits below.                                                           |
| Seed drift check                   | Generated seed matches canonical fixtures.                                                                                                                   |
| Database type drift check          | CLI-generated public schema types match the committed file.                                                                                                  |
| Migration/reset                    | Empty-database migration and seed succeeded; repeated disposable reset succeeded. Fifth integrity migration applied without deleting saved browser progress. |
| Local command guard                | Extra arguments such as `reset --remote` are rejected before any CLI/database operation.                                                                     |

The real database tests cover anonymous preview disclosure, forbidden answer-key access, direct write denial, owner isolation, creator isolation, unverified/revoked accounts, narrow function ownership/grants, one active session, concurrent starts/answers, immutable content and attempts, stale revisions, idempotent receipts, rollback after an injected post-insert failure, version-pinned history and pagination. Real email tests verify signup confirmation, one-use links, password recovery/update, invalid old passwords and logout.

The HTTP suite logs in two disposable accounts using Supabase SSR cookies and calls the running Next.js endpoints. It checks public previews, retired stateless answers, ownership, origin/content-type restrictions, creator enrollment, all three persisted answers, final review/Finish, history, retry conflicts and a fresh login context. Administrative credentials are confined to guarded local test account creation/cleanup.

## Observed browser results

The in-app browser used the actual local services and official YouTube embed, without a simulated playback provider:

- Guest preview played setup and paused without showing questions, choices or continuation controls.
- Signup submitted successfully; the captured confirmation email opened the server callback and established a verified learner session.
- All three VOD setups played and reached their decision pauses. All three saved answers played their continuations to completion with analysis below.
- A different first choice displayed “Different choice from the pro” and “Defensible.” Matching the second pro choice displayed “Same choice as the pro” and “Risky.”
- Keyboard Space selected a decision; Enter activated Play again. Headings received focus on transitions.
- Reload restored saved first review. Reload of the final review still required explicit Finish. Finish produced the saved three-choice recap.
- Two tabs initially showed the second review. After one advanced, the stale tab's Next received a conflict and reconciled to the third setup without skipping it.
- Creator enrollment succeeded; the creator landing appeared and learner/history navigation remained available.
- Logout removed private content. A direct saved-session URL redirected to sign-in.
- After stopping and starting both local Supabase and the app, a fresh sign-in on the production build restored creator access and the completed session with all three saved answers.
- Play again created a different active session. History retained the completed session and listed the new zero-answer session separately.
- The production password-recovery form delivered a captured email. Its callback authenticated the recovery session and displayed the protected new-password form. Password update and old-password rejection were exercised by the real Auth integration test; the browser form itself was not submitted.

A stale cached browser login after deletion of a disposable account initially trapped the guest view behind an auth-change message. This was fixed by reconciling browser identity hints with the server account endpoint. Regression tests cover deleted accounts, concurrent logout and stale reconciliation responses; a browser retry confirmed sign-in was usable again.

## Implementation adjustments

Supabase CLI 3 uses `[local_smtp]` and `auth.email.enabled`; configuration follows the installed CLI. The managed `auth` schema does not let the ordinary migration executor grant schema usage to the application function role. A separate restricted trigger role therefore mirrors `auth.users.email_confirmed_at` into protected `profiles.email_verified_at`. RPC and direct-row policies consult that trusted field. Neither application role owns tables, can log in, bypasses RLS, or receives broad auth-schema membership. Confirmation revocation with an existing JWT is tested.

The portable npm lockfile was regenerated in a directory without `node_modules`, preserving direct dependency versions. Seven transitive versions changed during resolution; both operating-system test runs passed. Platform binding packages are now represented across supported targets, with no explicit Darwin-only root dependency.

## Limits and remaining manual review

- The extra Linux x64 production build stayed in its compilation worker under Rosetta emulation for over ten minutes and was stopped. Linux clean installation, all 381 tests and type checking passed; this does not establish a completed Linux build. The configured GitHub job will test the build on a native Linux runner after you push.
- The complete normal-speed audio/spoiler editorial review carried over from milestone two remains open. Actual playback and visible pauses were observed, but this is not a frame-accurate timing measurement or an audio-review claim.
- Browser layout was inspected at the available roughly 689-pixel panel width with no horizontal overflow; the saved full-page recap also rendered a wider desktop layout. The browser's requested 375-pixel viewport override did not change its measured viewport, so phone-width acceptance and the complete desktop/mobile matrix remain unverified. The temporary override was reset.
- Response-loss, network failure, expired-auth cancellation, autoplay fallback and background visibility are covered by automated component/player tests. Their complete real-browser failure matrix was not repeated.
- A fresh browser context was represented by a fresh SSR cookie client in the HTTP suite; the UI check used a fresh tab after logout and sign-in, not a second physical device.
- The GitHub Actions workflow is configured but has not run remotely because pushing remains with the user. Hosted auth, SMTP and cross-device persistence are outside this local milestone.

Implementation and automated functional checks are complete. The remaining browser/editorial items above should be reviewed before public release; they are not represented as passing checks.

## Local handoff

The verification web server and project Supabase services were stopped after testing. Database volumes were retained, including the disposable browser test account and its completed/new sessions. The ignored `.env.local` is ready. Run `npm run db:start` followed by `npm run dev` to try the app; register your own account and use the local email inbox. Git remains on `feat/user`, with changes uncommitted and unpushed.
