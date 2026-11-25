import type { Ref } from "react";
import { AnalysisNote, analysisLabel } from "./AnalysisNote";
import type {
  AnswerResponse,
  Assessment,
  ChallengeDetail,
  OptionFeedback,
} from "@/contracts/challenge";

export function assessmentLabel(assessment: Assessment, isProScenario = true) {
  if (!isProScenario) return assessment;
  return {
    recommended: "Preferred under these assumptions",
    reasonable: "Defensible",
    risky: "Risky",
  }[assessment];
}
function Conditions({
  feedback,
  headingLevel = 4,
}: {
  feedback: OptionFeedback;
  headingLevel?: 3 | 4;
}) {
  const Heading = headingLevel === 3 ? "h3" : "h4";
  return (
    <div className="feedback-conditions">
      {!!feedback.acceptableWhen?.length && (
        <section>
          <Heading>Defensible when</Heading>
          <ul>
            {feedback.acceptableWhen.map((condition) => (
              <li key={condition}>{condition}</li>
            ))}
          </ul>
        </section>
      )}
      {!!feedback.risks?.length && (
        <section>
          <Heading>Risks to account for</Heading>
          <ul>
            {feedback.risks.map((risk) => (
              <li key={risk}>{risk}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
export function FeedbackPanel({
  challenge,
  answer,
  headingId,
  headingRef,
}: {
  challenge: ChallengeDetail;
  answer: AnswerResponse;
  headingId?: string;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const selected = challenge.options.find(
    (option) => option.id === answer.selectedOptionId,
  );
  const selectedFeedback = answer.optionFeedback.find(
    (option) => option.optionId === answer.selectedOptionId,
  );
  const others = answer.optionFeedback.filter(
    (option) => option.optionId !== answer.selectedOptionId,
  );
  const hasComparison =
    !!answer.observedAction && typeof answer.matchesPro === "boolean";
  const player = challenge.source?.player ?? "the pro";
  const observed = challenge.options.find(
    (option) => option.id === answer.observedAction?.optionId,
  );
  const headline =
    hasComparison &&
    !answer.matchesPro &&
    answer.selectedAssessment === "reasonable"
      ? "Different call. Still defensible."
      : "Here’s the reasoning.";
  return (
    <section
      className="feedback-panel scenario-debrief"
      aria-label="Answer feedback"
    >
      <div className="section-heading">
        <div>
          <span className="eyebrow">THE DEBRIEF</span>
          <h2 id={headingId} ref={headingRef} tabIndex={-1}>
            {headline}
          </h2>
        </div>
      </div>
      <div className="decision-comparison">
        <div>
          <span className="eyebrow">YOUR CALL</span>
          <p className="chosen-call">{selected?.label}</p>
          <span className={`assessment ${answer.selectedAssessment}`}>
            Your decision:{" "}
            {assessmentLabel(answer.selectedAssessment, hasComparison)}
          </span>
        </div>
        {hasComparison && (
          <div>
            <span className="eyebrow">OBSERVED CHOICE</span>
            <p className="chosen-call">
              {observed?.label ?? answer.observedAction!.description}
            </p>
            <span className="comparison-label">
              {answer.matchesPro
                ? "Same choice as the pro"
                : "Different choice from the pro"}{" "}
              · {player}
            </span>
          </div>
        )}
      </div>
      {hasComparison && (
        <p className="comparison-note">
          The comparison records what happened. Your assessment depends on the
          information and risks at the pause.
        </p>
      )}
      <div className="takeaway">
        <span className="eyebrow">THE TAKEAWAY</span>
        <p>{answer.takeaway}</p>
      </div>
      {selectedFeedback && (
        <p className="selected-explanation">{selectedFeedback.explanation}</p>
      )}
      {hasComparison && !answer.recommendedOptionIds.length && (
        <p className="conditional-note">
          There is no single preferred answer here. Compare the conditions that
          make each choice defensible.
        </p>
      )}
      <div className="debrief-details">
        {selectedFeedback &&
          (!!selectedFeedback.acceptableWhen?.length ||
            !!selectedFeedback.risks?.length) && (
            <details>
              <summary>Conditions &amp; risks</summary>
              <Conditions feedback={selectedFeedback} headingLevel={3} />
            </details>
          )}
        {!!others.length && (
          <details>
            <summary>Other choices</summary>
            <div className="option-feedback">
              {others.map((feedback) => (
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
                  <Conditions feedback={feedback} />
                </article>
              ))}
            </div>
          </details>
        )}
        {answer.analysis && (
          <details>
            <summary>Deeper reasoning &amp; limitations</summary>
            <AnalysisNote analysis={answer.analysis} />
          </details>
        )}
        <details>
          <summary>
            {challenge.mediaStatus === "demo"
              ? "Authored continuation"
              : "Recorded outcome"}
          </summary>
          <div className="outcome-note">
            {answer.observedAction && (
              <p>
                <strong>{player}:</strong> {answer.observedAction.description}
              </p>
            )}
            <p>{answer.outcomeText}</p>
            <small>
              A successful outcome does not settle the quality of the decision.
              Assess the choice using what was known before it.
            </small>
          </div>
        </details>
      </div>
      {answer.analysis && (
        <p className="analysis-credit">
          {analysisLabel(answer.analysis.author)} · Interpretation.{" "}
          {answer.analysis.notice}
        </p>
      )}
    </section>
  );
}
