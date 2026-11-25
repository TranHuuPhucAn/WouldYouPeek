"use client";
import { useEffect, useId, useReducer, useRef } from "react";
import type { CreatorReviewPreview } from "@/contracts/creator";
import {
  createPreviewState,
  previewReducer,
  selectPreviewFeedback,
} from "@/lib/creator/preview-state";
import { useReviewPresentation } from "@/hooks/use-review-presentation";
import { DecisionPanel } from "@/components/challenge/DecisionPanel";
import { FeedbackPanel } from "@/components/challenge/FeedbackPanel";
import { ScenarioHeader } from "@/components/challenge/ScenarioHeader";
import { ScenarioContext } from "@/components/challenge/ScenarioContext";
import { ScenarioPlayback } from "@/components/challenge/ScenarioPlayback";
import { ReviewControls } from "@/components/challenge/ReviewControls";

export function ScenarioPreview({
  preview,
}: {
  preview: CreatorReviewPreview;
}) {
  return (
    <PreviewScenario
      key={`${preview.scenario.id}:${preview.scenario.revision}`}
      preview={preview}
    />
  );
}
function PreviewScenario({ preview }: { preview: CreatorReviewPreview }) {
  const [state, dispatch] = useReducer(
    previewReducer,
    undefined,
    createPreviewState,
  );
  const { challenge } = preview;
  const answer =
    state.phase === "review" && state.selectedOptionId
      ? selectPreviewFeedback(preview, state.selectedOptionId)
      : null;
  const mode =
    state.phase === "review"
      ? state.reviewMedia === "outcome"
        ? "reveal"
        : "review-setup"
      : state.phase;
  const scopeKey = JSON.stringify([
    "creator",
    preview.scenario.id,
    preview.scenario.revision,
    state.attempt,
  ]);
  const presentation = useReviewPresentation({
    scopeKey,
    answerKey: answer ? `${state.attempt}:${state.selectedOptionId}` : null,
    mode,
  });
  const analysisId = useId(),
    heading = useRef<HTMLHeadingElement>(null),
    focusAnalysis = useRef(false);
  function viewAnalysis() {
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView?.({ block: "start" });
  }
  function showAnalysis() {
    focusAnalysis.current = true;
    presentation.showAnalysis();
  }
  useEffect(() => {
    if (focusAnalysis.current && presentation.analysisVisible) {
      focusAnalysis.current = false;
      viewAnalysis();
    }
  }, [presentation.analysisVisible]);
  function showMedia(media: "setup" | "outcome") {
    presentation.restartPlayback();
    dispatch({ type: "MEDIA", media });
  }
  if (
    challenge.setup.kind !== "youtube" &&
    challenge.setup.kind !== "uploaded-video"
  )
    return (
      <p role="alert">This saved preview has no supported player recording.</p>
    );
  return (
    <section
      className="creator-preview scenario-player"
      aria-label="Creator learner preview"
    >
      <div className="creator-preview-heading">
        <span className="eyebrow">LEARNER PREVIEW</span>
        <p>Creator preview — no session or progress is saved.</p>
      </div>
      <ScenarioHeader
        challenge={challenge}
        preview
        phase={
          state.phase === "review"
            ? presentation.analysisVisible
              ? "analysis"
              : "continuation"
            : state.phase
        }
      />
      <ScenarioPlayback
        key={scopeKey}
        challenge={challenge}
        answer={answer}
        mode={mode}
        context={{
          kind: "creator-scenario",
          scenarioId: preview.scenario.id,
          revision: preview.scenario.revision,
          phase: mode === "reveal" ? "reveal" : "setup",
        }}
        analysisVisible={presentation.analysisVisible}
        playbackKey={presentation.playbackKey}
        autoplay={presentation.autoplay}
        onPlaybackEvent={presentation.onPlaybackEvent}
        onComplete={() => dispatch({ type: "SETUP_COMPLETE" })}
        onReadAnalysis={showAnalysis}
      />
      <ScenarioContext challenge={challenge} />
      {state.phase === "decision" && (
        <DecisionPanel
          question={challenge.question}
          options={challenge.options}
          selectedOptionId={state.selectedOptionId}
          pending={false}
          error={null}
          onSelect={(optionId) => {
            if (challenge.options.some((option) => option.id === optionId))
              dispatch({ type: "SELECT", optionId });
          }}
          onSubmit={() => {
            if (
              state.selectedOptionId &&
              selectPreviewFeedback(preview, state.selectedOptionId)
            )
              dispatch({ type: "SUBMIT" });
          }}
          onReplay={() => {
            presentation.restartPlayback();
            dispatch({ type: "REPLAY_SETUP" });
          }}
        />
      )}
      {state.phase === "review" && answer && (
        <>
          {presentation.analysisVisible && (
            <FeedbackPanel
              challenge={challenge}
              answer={answer}
              headingId={analysisId}
              headingRef={heading}
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
            onNext={() => dispatch({ type: "RESET" })}
            nextLabel="Try another choice"
          />
        </>
      )}
    </section>
  );
}
