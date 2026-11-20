"use client";

import Link from "next/link";
import type { AccountUser } from "@/contracts/auth";
import type { SessionSnapshot } from "@/contracts/session";
import { SessionPersistenceNotice } from "@/components/sessions/SessionPersistenceNotice";
import { useEffect, useRef } from "react";
import { useChallengeSession } from "@/hooks/use-challenge-session";
import { ScenarioMedia } from "./ScenarioMedia";
import { DecisionPanel } from "./DecisionPanel";
import { FeedbackPanel } from "./FeedbackPanel";
import { SessionRecap } from "./SessionRecap";
import { YouTubeScenarioPlayer } from "./YouTubeScenarioPlayer";
import { UploadedScenarioPlayer } from "./UploadedScenarioPlayer";
import { SourceAttribution } from "./SourceAttribution";

export function ChallengePlayer({
  initialSession,
  viewer,
}: {
  initialSession: SessionSnapshot;
  viewer: AccountUser;
}) {
  const session = useChallengeSession(initialSession, viewer.id);
  const { state } = session;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (["setup", "review", "complete"].includes(state.phase))
      heading.current?.focus();
  }, [state.phase, state.currentIndex]);
  const challenge = state.challenge;
  const isDecision = state.phase === "decision" || state.phase === "submitting";
  const media = challenge
    ? isDecision && challenge.decision.kind === "image"
      ? {
          kind: "illustration" as const,
          src: challenge.decision.imageUrl,
          alt: challenge.decision.alt,
        }
      : state.phase === "review" &&
          state.reviewMedia === "outcome" &&
          state.feedback
        ? state.feedback.reveal
        : challenge.setup
    : null;
  const mediaLabel =
    challenge?.mediaStatus === "demo"
      ? state.phase === "review" && state.reviewMedia === "outcome"
        ? "Authored continuation · Illustrative demo"
        : "Illustrative demo"
      : state.phase === "review" && state.reviewMedia === "outcome"
        ? "Recorded outcome"
        : "Recorded gameplay";
  return (
    <div>
      <SessionPersistenceNotice
        pending={state.pending}
        error={state.error}
        unresolved={state.unresolved}
        onRetry={session.retrySave}
      />
      {state.phase === "complete" ? (
        <>
          <h2 className="sr-only" ref={heading} tabIndex={-1}>
            Session recap
          </h2>
          <SessionRecap
            completed={state.completed}
            onRestart={session.restart}
            pending={state.pending}
            completedAt={state.snapshot.completedAt}
            title={state.snapshot.title}
            playlist={state.snapshot.playlist}
          />
        </>
      ) : (
        <main className="play-shell">
          <div className="session-topline">
            <Link href="/" className="text-button">
              ← Home
            </Link>
            <div
              className={
                state.snapshot.playlist
                  ? "session-progress playlist-progress"
                  : "session-progress"
              }
              aria-label={`Scenario ${state.currentIndex + 1} of ${state.catalogue.length || 3}`}
            >
              <span className="mono">
                {String(state.currentIndex + 1).padStart(2, "0")} /{" "}
                {String(state.catalogue.length || 3).padStart(2, "0")}
              </span>
              <div className="progress-segments" aria-hidden="true">
                {state.catalogue.map((_, index) => (
                  <i
                    key={index}
                    className={index <= state.currentIndex ? "filled" : ""}
                  />
                ))}
              </div>
            </div>
          </div>
          {state.snapshot.playlist && (
            <p className="playlist-session-context">
              {state.snapshot.title}{" "}
              <span>· By {state.snapshot.playlist.credit.displayName}</span>
            </p>
          )}
          {state.phase === "auth-required" ? (
            <div className="status-panel">
              <h1>Sign in to continue.</h1>
              <p>Your confirmed progress is saved.</p>
              <Link href="/sign-in" className="button button-primary">
                Sign in
              </Link>
            </div>
          ) : challenge && media ? (
            <>
              <div className="challenge-heading">
                <span className="eyebrow">
                  SCENARIO {String(state.currentIndex + 1).padStart(2, "0")}{" "}
                  <span className="eyebrow-separator">/</span> {challenge.topic}
                </span>
                <h1 ref={heading} tabIndex={-1}>
                  {challenge.title}
                </h1>
              </div>
              <div className="challenge-grid">
                <div className="challenge-main">
                  {challenge.setup.kind === "youtube" ? (
                    <YouTubeScenarioPlayer
                      key={challenge.id}
                      setup={challenge.setup}
                      reveal={
                        state.feedback?.reveal.kind === "youtube"
                          ? state.feedback.reveal
                          : undefined
                      }
                      mode={
                        isDecision
                          ? "decision"
                          : state.phase === "review"
                            ? state.reviewMedia === "outcome"
                              ? "reveal"
                              : "review-setup"
                            : "setup"
                      }
                      onComplete={session.completeSetup}
                    />
                  ) : challenge.setup.kind === "uploaded-video" ? (
                    <UploadedScenarioPlayer
                      key={challenge.id}
                      setup={challenge.setup}
                      reveal={
                        state.feedback?.reveal.kind === "uploaded-video"
                          ? state.feedback.reveal
                          : undefined
                      }
                      mode={
                        isDecision
                          ? "decision"
                          : state.phase === "review"
                            ? state.reviewMedia === "outcome"
                              ? "reveal"
                              : "review-setup"
                            : "setup"
                      }
                      context={{
                        kind: "session-item",
                        sessionId: state.snapshot.id,
                        itemId: state.snapshot.items[state.currentIndex].id,
                        phase:
                          state.phase === "review" &&
                          state.reviewMedia === "outcome"
                            ? "reveal"
                            : "setup",
                      }}
                      onComplete={session.completeSetup}
                    />
                  ) : (
                    <ScenarioMedia
                      key={`${challenge.id}-${state.phase === "setup" ? "setup" : isDecision ? "decision" : state.reviewMedia}`}
                      media={media}
                      label={mediaLabel}
                      onComplete={
                        state.phase === "setup"
                          ? session.completeSetup
                          : undefined
                      }
                    />
                  )}
                  {isDecision && (
                    <DecisionPanel
                      question={challenge.question}
                      options={challenge.options}
                      selectedOptionId={state.selectedOptionId}
                      pending={state.phase === "submitting" || state.unresolved}
                      error={state.error}
                      onSelect={session.selectOption}
                      onSubmit={session.submitSelection}
                      onReplay={session.replaySetup}
                    />
                  )}
                  {state.phase === "review" && state.feedback && (
                    <FeedbackPanel
                      challenge={challenge}
                      answer={state.feedback}
                      reviewMedia={state.reviewMedia}
                      finalChallenge={
                        state.currentIndex === state.catalogue.length - 1
                      }
                      onShowSetup={session.showReviewSetup}
                      onShowOutcome={session.showReviewOutcome}
                      onNext={session.nextChallenge}
                      pending={state.pending}
                    />
                  )}
                </div>
                <aside className="context-panel">
                  <span className="eyebrow">ROUND INTEL</span>
                  <h2>The situation</h2>
                  <p>{challenge.context}</p>
                  {challenge.linkedScenarioId && (
                    <p className="linked-note">
                      Linked follow-up · Same round, a new balance of risk.
                    </p>
                  )}
                  {challenge.source && (
                    <SourceAttribution source={challenge.source} />
                  )}
                  {challenge.knownFacts?.length ? (
                    <div className="context-facts">
                      <h3>Available information</h3>
                      <ul>
                        {challenge.knownFacts.map((fact) => (
                          <li key={fact}>{fact}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {challenge.unknowns?.length ? (
                    <details className="context-unknowns">
                      <summary>What remains unknown</summary>
                      <ul>
                        {challenge.unknowns.map((fact) => (
                          <li key={fact}>{fact}</li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                  <div className="context-divider" />
                  <div className="intel-tip">
                    <span className="tip-symbol" aria-hidden="true">
                      ↗
                    </span>
                    <div>
                      <h3>Use what you know.</h3>
                      <p>
                        Consider the information available now. The result comes
                        after your call.
                      </p>
                    </div>
                  </div>
                  <div className="demo-notice">
                    <span className="mono">
                      {challenge.mediaStatus === "demo"
                        ? "ILLUSTRATIVE DEMO"
                        : "RECORDED SCENARIO"}
                    </span>
                    <p>
                      {challenge.mediaStatus === "demo"
                        ? "An original training diagram with an authored continuation. Not recorded Valorant footage."
                        : "Review the setup before choosing your next action."}
                    </p>
                  </div>
                </aside>
              </div>
            </>
          ) : null}
        </main>
      )}
      <footer className="site-footer">
        <span>MAKE THE CALL. THEN LEARN WHY.</span>
        <span>
          Would You Peek? <span className="footer-dot">·</span> Player POV
          practice
        </span>
      </footer>
    </div>
  );
}
