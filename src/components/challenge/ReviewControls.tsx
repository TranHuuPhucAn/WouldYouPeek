import type { ScenarioPlaybackStatus } from "@/lib/video/playback-events";

export function ReviewControls({
  analysisVisible,
  status,
  analysisId,
  reviewMedia,
  onShowAnalysis,
  onShowSetup,
  onShowOutcome,
  onNext,
  onViewAnalysis,
  nextLabel = "Next scenario",
  pending = false,
}: {
  analysisVisible: boolean;
  status: ScenarioPlaybackStatus;
  analysisId: string;
  reviewMedia: "setup" | "outcome";
  onShowAnalysis: () => void;
  onViewAnalysis: () => void;
  onShowSetup: () => void;
  onShowOutcome: () => void;
  onNext?: () => void;
  nextLabel?: string;
  pending?: boolean;
}) {
  if (!analysisVisible)
    return (
      <section className="continuation-status" aria-label="Continuation review">
        <span className="eyebrow">YOUR CHOICE IS SAVED</span>
        <h2>Watch what happened next.</h2>
        <p>
          The analysis will appear after the continuation. Use the player’s Play
          button if it hasn’t started.
        </p>
        {status === "blocked" || status === "error" ? (
          <div className="analysis-escape">
            <p>
              {status === "blocked"
                ? "Playback needs your permission to start."
                : "The recording is unavailable right now."}{" "}
              Your saved analysis is still available.
            </p>
            <button
              className="button button-secondary"
              onClick={onShowAnalysis}
            >
              Read saved analysis
            </button>
          </div>
        ) : (
          <details className="video-trouble">
            <summary>Video trouble?</summary>
            <p>
              If the video is slow or cannot play, you can still review your
              saved choice.
            </p>
            <button
              className="button button-secondary"
              onClick={onShowAnalysis}
            >
              Read saved analysis
            </button>
          </details>
        )}
      </section>
    );
  return (
    <div className="review-controls scenario-review-controls">
      <div className="review-replay-actions" aria-label="Review media">
        <button
          className="button button-secondary"
          aria-pressed={reviewMedia === "setup"}
          onClick={onShowSetup}
        >
          Watch setup
        </button>
        <button
          className="button button-secondary"
          aria-pressed={reviewMedia === "outcome"}
          onClick={onShowOutcome}
        >
          Watch continuation
        </button>
      </div>
      <a
        className="text-button"
        href={`#${analysisId}`}
        onClick={(event) => {
          event.preventDefault();
          onViewAnalysis();
        }}
      >
        View analysis
      </a>
      {onNext && (
        <button
          className="button button-primary"
          onClick={onNext}
          disabled={pending}
        >
          {pending ? "Saving…" : nextLabel}
          <span aria-hidden="true">→</span>
        </button>
      )}
    </div>
  );
}
