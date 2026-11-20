"use client";

import Link from "next/link";
import { useEffect, useId, useRef } from "react";
import type { AccountUser } from "@/contracts/auth";
import type { SessionSnapshot } from "@/contracts/session";
import type { PlaybackMode } from "@/lib/video/segment-controller";
import { SessionPersistenceNotice } from "@/components/sessions/SessionPersistenceNotice";
import { useChallengeSession } from "@/hooks/use-challenge-session";
import { useReviewPresentation } from "@/hooks/use-review-presentation";
import { DecisionPanel } from "./DecisionPanel";
import { FeedbackPanel } from "./FeedbackPanel";
import { SessionRecap } from "./SessionRecap";
import { ScenarioHeader, type ScenarioPhase } from "./ScenarioHeader";
import { ScenarioContext } from "./ScenarioContext";
import { ScenarioPlayback } from "./ScenarioPlayback";
import { ReviewControls } from "./ReviewControls";

export function ChallengePlayer({
  initialSession,
  viewer,
}: {
  initialSession: SessionSnapshot;
  viewer: AccountUser;
}) {
  const session = useChallengeSession(initialSession, viewer.id);
  const { state } = session;
  const challenge = state.challenge;
  const item = state.snapshot.items[state.currentIndex];
  const isDecision = state.phase === "decision" || state.phase === "submitting";
  const identityChanged = viewer.id !== state.viewerId;
  const reviewing =
    !identityChanged && state.phase === "review" && !!state.feedback;
  const mode: PlaybackMode = isDecision
    ? "decision"
    : reviewing
      ? state.reviewMedia === "outcome"
        ? "reveal"
        : "review-setup"
      : "setup";
  const scopeKey = JSON.stringify([
    viewer.id,
    state.snapshot.id,
    item?.id,
    challenge?.contentVersion,
  ]);
  const presentation = useReviewPresentation({
    scopeKey,
    answerKey: reviewing ? (item?.answer?.id ?? null) : null,
    mode,
  });
  const heading = useRef<HTMLHeadingElement>(null);
  const analysisHeading = useRef<HTMLHeadingElement>(null);
  const focusAnalysis = useRef(false);
  const analysisId = useId();
  useEffect(() => {
    heading.current?.focus();
  }, [state.currentIndex, state.phase === "complete"]);
  useEffect(() => {
    if (focusAnalysis.current && presentation.analysisVisible) {
      focusAnalysis.current = false;
      viewAnalysis();
    }
  }, [presentation.analysisVisible]);
  function viewAnalysis() {
    analysisHeading.current?.focus({ preventScroll: true });
    analysisHeading.current?.scrollIntoView?.({ block: "start" });
  }
  function showAnalysis() {
    focusAnalysis.current = true;
    presentation.showAnalysis();
    if (presentation.analysisVisible) {
      focusAnalysis.current = false;
      viewAnalysis();
    }
  }
  function showMedia(media: "setup" | "outcome") {
    presentation.restartPlayback();
    if (media === "setup") session.showReviewSetup();
    else session.showReviewOutcome();
  }
  const phase: ScenarioPhase =
    state.phase === "submitting"
      ? "saving"
      : isDecision
        ? "decision"
        : reviewing
          ? presentation.analysisVisible
            ? "analysis"
            : "continuation"
          : "setup";
  return (
    <div>
      <SessionPersistenceNotice
        pending={state.pending}
        error={state.error}
        unresolved={state.unresolved}
        onRetry={session.retrySave}
      />
      {state.phase === "complete" && !identityChanged ? (
        <>
          <h2 className="sr-only" ref={heading} tabIndex={-1}>
            Session recap
          </h2>
          <SessionRecap
            items={state.snapshot.items}
            sessionId={state.snapshot.id}
            viewerId={viewer.id}
            onRestart={session.restart}
            pending={state.pending}
            completedAt={state.snapshot.completedAt}
            title={state.snapshot.title}
            playlist={state.snapshot.playlist}
          />
        </>
      ) : (
        <main className="play-shell scenario-player">
          {state.phase === "auth-required" || identityChanged ? (
            <div className="status-panel">
              <h1>Sign in to continue.</h1>
              <p>Your confirmed progress is saved.</p>
              <Link href="/sign-in" className="button button-primary">
                Sign in
              </Link>
            </div>
          ) : challenge && item ? (
            <>
              <ScenarioHeader
                challenge={challenge}
                phase={phase}
                index={state.currentIndex}
                total={state.snapshot.items.length}
                title={
                  state.snapshot.playlist ? state.snapshot.title : undefined
                }
                playlist={state.snapshot.playlist}
                headingRef={heading}
              />
              <ScenarioPlayback
                key={scopeKey}
                challenge={challenge}
                answer={reviewing ? state.feedback : null}
                mode={mode}
                context={{
                  kind: "session-item",
                  sessionId: state.snapshot.id,
                  itemId: item.id,
                  phase: mode === "reveal" ? "reveal" : "setup",
                }}
                analysisVisible={presentation.analysisVisible}
                playbackKey={presentation.playbackKey}
                autoplay={presentation.autoplay}
                onPlaybackEvent={presentation.onPlaybackEvent}
                onComplete={session.completeSetup}
                onReadAnalysis={showAnalysis}
              />
              <ScenarioContext challenge={challenge} />
              {state.phase === "setup" && (
                <div className="scenario-watch-note">
                  <span className="eyebrow">WATCH THE SETUP</span>
                  <h2>Your call is coming up.</h2>
                  <p>
                    Read the situation. You will choose when the video pauses.
                  </p>
                </div>
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
                  onReplay={() => {
                    presentation.restartPlayback();
                    session.replaySetup();
                  }}
                />
              )}
              {reviewing && state.feedback && (
                <>
                  <p className="sr-only" role="status">
                    {presentation.analysisVisible
                      ? "Analysis ready. Your choice is saved."
                      : "Your choice is saved. Watch the continuation."}
                  </p>
                  {presentation.analysisVisible && (
                    <FeedbackPanel
                      challenge={challenge}
                      answer={state.feedback}
                      headingId={analysisId}
                      headingRef={analysisHeading}
                    />
                  )}
                  <ReviewControls
                    analysisVisible={presentation.analysisVisible}
                    status={presentation.status}
                    analysisId={analysisId}
                    reviewMedia={state.reviewMedia}
                    onShowAnalysis={showAnalysis}
                    onViewAnalysis={viewAnalysis}
                    onShowSetup={() => showMedia("setup")}
                    onShowOutcome={() => showMedia("outcome")}
                    onNext={session.nextChallenge}
                    nextLabel={
                      state.currentIndex === state.snapshot.items.length - 1
                        ? "Finish session"
                        : "Next scenario"
                    }
                    pending={state.pending}
                  />
                </>
              )}
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
