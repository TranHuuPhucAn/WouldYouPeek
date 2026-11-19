import { AnalysisNote } from "./AnalysisNote";
import type {
  AnswerResponse,
  Assessment,
  ChallengeDetail,
} from "@/contracts/challenge";

export function assessmentLabel(assessment: Assessment, isProScenario = true) {
  if (!isProScenario) return assessment;
  return {
    recommended: "Preferred under these assumptions",
    reasonable: "Defensible",
    risky: "Risky",
  }[assessment];
}

type Props = {
  challenge: ChallengeDetail;
  answer: AnswerResponse;
  reviewMedia: "setup" | "outcome";
  finalChallenge: boolean;
  onShowSetup: () => void;
  onShowOutcome: () => void;
  onNext: () => void;
  pending?: boolean;
  nextLabel?: string;
};

export function FeedbackPanel({
  challenge,
  answer,
  reviewMedia,
  finalChallenge,
  onShowSetup,
  onShowOutcome,
  onNext,
  pending = false,
  nextLabel,
}: Props) {
  const selected = challenge.options.find(
    (option) => option.id === answer.selectedOptionId,
  );
  const hasComparison =
    answer.observedAction !== undefined &&
    typeof answer.matchesPro === "boolean";
  const player = challenge.source?.player ?? "the pro";
  return (
    <section className="feedback-panel" aria-label="Answer feedback">
      <div className="section-heading">
        <div>
          <span className="eyebrow">THE DEBRIEF</span>
          <h2>Here’s the reasoning.</h2>
        </div>
        <span className={`assessment ${answer.selectedAssessment}`}>
          {assessmentLabel(answer.selectedAssessment, hasComparison)}
        </span>
      </div>
      <p className="selected-answer">
        Your call: <strong>{selected?.label}</strong>
      </p>
      {hasComparison && (
        <div className="pro-comparison">
          <span className="eyebrow">OBSERVED CHOICE</span>
          <h3>
            {answer.matchesPro
              ? "Same choice as the pro"
              : "Different choice from the pro"}
          </h3>
          <p>
            <strong>{player}:</strong> {answer.observedAction!.description}
          </p>
          <small>
            The comparison records what happened. Your assessment depends on the
            information and risks at the pause.
          </small>
        </div>
      )}
      {answer.analysis && <AnalysisNote analysis={answer.analysis} />}
      {hasComparison && answer.recommendedOptionIds.length === 0 && (
        <p className="conditional-note">
          There is no single preferred answer here. Compare the conditions that
          make each choice defensible.
        </p>
      )}
      <div className="takeaway">
        <span className="eyebrow">TAKE THIS INTO YOUR NEXT ROUND</span>
        <p>{answer.takeaway}</p>
      </div>
      <div className="option-feedback">
        {answer.optionFeedback.map((feedback) => (
          <article key={feedback.optionId} className="feedback-option">
            <div>
              <h3>
                {
                  challenge.options.find(
                    (option) => option.id === feedback.optionId,
                  )?.label
                }
              </h3>
              <span className={`assessment ${feedback.assessment}`}>
                {assessmentLabel(feedback.assessment, hasComparison)}
              </span>
            </div>
            <p>{feedback.explanation}</p>
            {(feedback.acceptableWhen?.length > 0 ||
              feedback.risks?.length > 0) && (
              <div className="feedback-conditions">
                {feedback.acceptableWhen?.length > 0 && (
                  <section>
                    <h4>Defensible when</h4>
                    <ul>
                      {feedback.acceptableWhen.map((condition) => (
                        <li key={condition}>{condition}</li>
                      ))}
                    </ul>
                  </section>
                )}
                {feedback.risks?.length > 0 && (
                  <section>
                    <h4>Risks to account for</h4>
                    <ul>
                      {feedback.risks.map((risk) => (
                        <li key={risk}>{risk}</li>
                      ))}
                    </ul>
                  </section>
                )}
              </div>
            )}
          </article>
        ))}
      </div>
      <div className="outcome-note">
        <h3>
          {challenge.mediaStatus === "demo"
            ? "Authored continuation"
            : "Recorded outcome"}
        </h3>
        <p>{answer.outcomeText}</p>
        <small>
          A successful outcome does not settle the quality of the decision.
          Assess the choice using what was known before it.
        </small>
      </div>
      <div className="review-controls">
        <div className="segmented-control" aria-label="Review media">
          <button aria-pressed={reviewMedia === "setup"} onClick={onShowSetup}>
            Setup
          </button>
          <button
            aria-pressed={reviewMedia === "outcome"}
            onClick={onShowOutcome}
          >
            Outcome
          </button>
        </div>
        <button
          className="button button-primary"
          onClick={onNext}
          disabled={pending}
        >
          {pending
            ? "Saving…"
            : nextLabel
              ? nextLabel
              : finalChallenge
                ? "Finish session"
                : "Next scenario"}
          <span aria-hidden="true">→</span>
        </button>
      </div>
    </section>
  );
}
