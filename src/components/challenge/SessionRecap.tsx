import { AnalysisNote } from "./AnalysisNote";
import Link from "next/link";
import type { CompletedChallenge } from "@/lib/session/session-reducer";
import { assessmentLabel } from "./FeedbackPanel";

export function SessionRecap({
  completed,
  onRestart,
  pending = false,
  completedAt,
  title,
}: {
  completed: CompletedChallenge[];
  onRestart: () => void;
  pending?: boolean;
  completedAt?: string | null;
  title?: string;
}) {
  const hasProScenarios = completed.some(({ answer }) => answer.observedAction);
  return (
    <main className="recap-shell">
      <span className="eyebrow">
        <span className="status-dot" /> SESSION COMPLETE
      </span>
      <h1>
        {completed.length === 1
          ? "One call."
          : completed.length === 3
            ? "Three calls."
            : `${completed.length} calls.`}
        <br />
        <span className="accent-text">More perspective.</span>
      </h1>
      {title && <p className="quiet-note">{title}</p>}
      <p className="recap-intro">
        Good decisions start with noticing the details. Take a moment to revisit
        yours.
      </p>
      {completedAt && (
        <p className="quiet-note">
          Saved on{" "}
          {new Date(completedAt).toLocaleDateString("en", {
            dateStyle: "medium",
            timeZone: "UTC",
          })}
        </p>
      )}
      <div className="recap-list">
        {completed.map(({ challenge, answer }, index) => (
          <details className="recap-card" key={challenge.id}>
            <summary>
              <span className="recap-number">0{index + 1}</span>
              <span className="recap-title">
                <small>{challenge.topic}</small>
                {challenge.source && (
                  <span className="recap-source">
                    {challenge.source.player} · {challenge.source.map} · Round{" "}
                    {challenge.source.round}
                  </span>
                )}
                <strong>{challenge.title}</strong>
                <span>
                  Your call:{" "}
                  {
                    challenge.options.find(
                      (option) => option.id === answer.selectedOptionId,
                    )?.label
                  }
                </span>
                {answer.observedAction &&
                  typeof answer.matchesPro === "boolean" && (
                    <span className="recap-comparison">
                      {answer.matchesPro
                        ? "Same choice as the pro"
                        : "Different choice from the pro"}
                    </span>
                  )}
              </span>
              <span className={`assessment ${answer.selectedAssessment}`}>
                {assessmentLabel(
                  answer.selectedAssessment,
                  !!answer.observedAction,
                )}
              </span>
              <span className="expand-mark" aria-hidden="true">
                +
              </span>
            </summary>
            <div className="recap-detail">
              <p className="recap-takeaway">{answer.takeaway}</p>
              {answer.observedAction && (
                <p>
                  <strong>
                    {challenge.source?.player ?? "The pro"} chose:
                  </strong>{" "}
                  {answer.observedAction.description}
                </p>
              )}
              {answer.analysis && <AnalysisNote analysis={answer.analysis} />}
              {answer.optionFeedback.map((feedback) => (
                <div key={feedback.optionId}>
                  <h3>
                    {
                      challenge.options.find(
                        (option) => option.id === feedback.optionId,
                      )?.label
                    }{" "}
                    <span className={`assessment ${feedback.assessment}`}>
                      {assessmentLabel(
                        feedback.assessment,
                        !!answer.observedAction,
                      )}
                    </span>
                  </h3>
                  <p>{feedback.explanation}</p>
                  {feedback.acceptableWhen?.length > 0 && (
                    <p>
                      <strong>Defensible when:</strong>{" "}
                      {feedback.acceptableWhen.join(" ")}
                    </p>
                  )}
                  {feedback.risks?.length > 0 && (
                    <p>
                      <strong>Risks:</strong> {feedback.risks.join(" ")}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </details>
        ))}
      </div>
      <p className="quiet-note">
        {hasProScenarios
          ? "Review the conditions behind your choices. Matching a pro’s action is a comparison, not a measure of rank or skill."
          : "Review the conditions behind your choices. This session does not measure your rank or skill."}
      </p>
      <div className="recap-actions">
        <button
          className="button button-primary"
          onClick={onRestart}
          disabled={pending}
        >
          {pending ? "Opening…" : "Play again"}{" "}
          <span aria-hidden="true">↺</span>
        </button>
        <Link href="/library" className="button button-secondary">
          Scenario library
        </Link>
        <Link href="/play" className="text-button">
          Open current practice
        </Link>
        <Link href="/history" className="button button-secondary">
          Session history
        </Link>
      </div>
    </main>
  );
}
