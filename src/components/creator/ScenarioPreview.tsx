"use client";
import { useReducer } from "react";
import type { CreatorReviewPreview } from "@/contracts/creator";
import {
  createPreviewState,
  previewReducer,
  selectPreviewFeedback,
} from "@/lib/creator/preview-state";
import { UploadedScenarioPlayer } from "@/components/challenge/UploadedScenarioPlayer";
import { SourceAttribution } from "@/components/challenge/SourceAttribution";
import { YouTubeScenarioPlayer } from "@/components/challenge/YouTubeScenarioPlayer";
import { DecisionPanel } from "@/components/challenge/DecisionPanel";
import { FeedbackPanel } from "@/components/challenge/FeedbackPanel";
export function ScenarioPreview({
  preview,
}: {
  preview: CreatorReviewPreview;
}) {
  const [state, dispatch] = useReducer(
      previewReducer,
      undefined,
      createPreviewState,
    ),
    { challenge } = preview;
  const answer = state.selectedOptionId
    ? selectPreviewFeedback(preview, state.selectedOptionId)
    : null;
  if (
    challenge.setup.kind !== "youtube" &&
    challenge.setup.kind !== "uploaded-video"
  )
    return (
      <p role="alert">This saved preview has no supported player recording.</p>
    );
  return (
    <section className="creator-preview" aria-label="Creator learner preview">
      <div className="creator-preview-heading">
        <span className="eyebrow">LEARNER PREVIEW</span>
        <h2>{challenge.title}</h2>
        <p>Creator preview — no session or progress is saved.</p>
      </div>
      <div className="creator-preview-context">
        <p>{challenge.context}</p>
        {challenge.source && <SourceAttribution source={challenge.source} />}
        {!!challenge.knownFacts?.length && (
          <details>
            <summary>Player-visible information</summary>
            <ul>
              {challenge.knownFacts.map((fact, index) => (
                <li key={index}>{fact}</li>
              ))}
            </ul>
          </details>
        )}
        {!!challenge.unknowns?.length && (
          <details>
            <summary>Unknown information</summary>
            <ul>
              {challenge.unknowns.map((fact, index) => (
                <li key={index}>{fact}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
      {challenge.setup.kind === "uploaded-video" ? (
        <UploadedScenarioPlayer
          key={state.attempt}
          setup={challenge.setup}
          reveal={
            state.phase === "review" && answer?.reveal.kind === "uploaded-video"
              ? answer.reveal
              : undefined
          }
          mode={
            state.phase === "review"
              ? state.reviewMedia === "outcome"
                ? "reveal"
                : "review-setup"
              : state.phase
          }
          context={{
            kind: "creator-scenario",
            scenarioId: preview.scenario.id,
            revision: preview.scenario.revision,
            phase:
              state.phase === "review" && state.reviewMedia === "outcome"
                ? "reveal"
                : "setup",
          }}
          onComplete={() => dispatch({ type: "SETUP_COMPLETE" })}
        />
      ) : (
        <YouTubeScenarioPlayer
          key={state.attempt}
          setup={challenge.setup}
          reveal={
            state.phase === "review" && answer?.reveal.kind === "youtube"
              ? answer.reveal
              : undefined
          }
          mode={
            state.phase === "review"
              ? state.reviewMedia === "outcome"
                ? "reveal"
                : "review-setup"
              : state.phase
          }
          onComplete={() => dispatch({ type: "SETUP_COMPLETE" })}
        />
      )}
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
            if (answer) dispatch({ type: "SUBMIT" });
          }}
          onReplay={() => dispatch({ type: "REPLAY_SETUP" })}
        />
      )}
      {state.phase === "review" && answer && (
        <FeedbackPanel
          challenge={challenge}
          answer={answer}
          reviewMedia={state.reviewMedia}
          finalChallenge
          nextLabel="Try another choice"
          onShowSetup={() => dispatch({ type: "MEDIA", media: "setup" })}
          onShowOutcome={() => dispatch({ type: "MEDIA", media: "outcome" })}
          onNext={() => dispatch({ type: "RESET" })}
        />
      )}
    </section>
  );
}
