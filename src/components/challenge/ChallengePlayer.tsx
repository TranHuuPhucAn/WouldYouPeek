"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { useChallengeSession } from "@/hooks/use-challenge-session";
import { ScenarioMedia } from "./ScenarioMedia";
import { DecisionPanel } from "./DecisionPanel";
import { FeedbackPanel } from "./FeedbackPanel";
import { SessionRecap } from "./SessionRecap";
import { YouTubeScenarioPlayer } from "./YouTubeScenarioPlayer";

export function ChallengePlayer() {
  const session = useChallengeSession();
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
    <div className="app-shell">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="Would You Peek home">
          <span className="brand-mark" aria-hidden="true">
            +
          </span>
          <span>
            WOULD YOU <strong>PEEK?</strong>
          </span>
        </Link>
        <span className="header-tag">
          THE DECISION LAB <span className="tag-outline">PRO POV</span>
        </span>
      </header>
      {state.phase === "complete" ? (
        <>
          <h2 className="sr-only" ref={heading} tabIndex={-1}>
            Session recap
          </h2>
          <SessionRecap
            completed={state.completed}
            onRestart={session.restart}
          />
        </>
      ) : (
        <main className="play-shell">
          <div className="session-topline">
            <Link href="/" className="text-button">
              ← Home
            </Link>
            <div
              className="session-progress"
              aria-label={`Scenario ${state.currentIndex + 1} of ${state.catalogue.length || 3}`}
            >
              <span className="mono">
                {String(state.currentIndex + 1).padStart(2, "0")} /{" "}
                {String(state.catalogue.length || 3).padStart(2, "0")}
              </span>
              <div className="progress-segments" aria-hidden="true">
                {[0, 1, 2].map((index) => (
                  <i
                    key={index}
                    className={index <= state.currentIndex ? "filled" : ""}
                  />
                ))}
              </div>
            </div>
          </div>
          {state.phase === "loading" ? (
            <div className="status-panel" role="status">
              <span className="loading-cross" aria-hidden="true">
                +
              </span>
              <h1>Setting the scene…</h1>
              <p>Getting your next decision ready.</p>
            </div>
          ) : state.phase === "error" ? (
            <div className="status-panel" role="alert">
              <span className="error-symbol">!</span>
              <h1>Let’s try that again.</h1>
              <p>{state.error}</p>
              <button
                className="button button-primary"
                onClick={session.retryLoad}
              >
                Retry loading
              </button>
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
                      pending={state.phase === "submitting"}
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
                    <div className="source-attribution">
                      <span className="mono">
                        {challenge.source.player} · {challenge.source.agent} ·{" "}
                        {challenge.source.map}
                      </span>
                      <p>
                        Round {challenge.source.round} ·{" "}
                        {challenge.source.score} ·{" "}
                        {challenge.source.side === "attack"
                          ? "Attacking"
                          : "Defending"}
                      </p>
                      <a
                        href={challenge.source.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Source: {challenge.source.uploader} ↗
                      </a>
                      <p className="source-note">
                        {challenge.source.matchType === "ranked"
                          ? "Ranked player recording"
                          : "Tournament recording"}
                        . Opening the source can reveal the outcome.
                      </p>
                    </div>
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
          Would You Peek? <span className="footer-dot">·</span> POV Demo
        </span>
      </footer>
    </div>
  );
}
