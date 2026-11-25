"use client";
import { useEffect, useRef, useState } from "react";
import type { OperatorReportMedia } from "@/contracts/moderation";
import { YouTubeScenarioPlayer } from "@/components/challenge/YouTubeScenarioPlayer";
import { UploadedScenarioPlayer } from "@/components/challenge/UploadedScenarioPlayer";
import { ScenarioMedia } from "@/components/challenge/ScenarioMedia";
export function ReportMediaPreview({
  media,
  reportId,
}: {
  media: OperatorReportMedia;
  reportId: string;
}) {
  const [phase, setPhase] = useState<"setup" | "reveal" | null>(null),
    [attempt, setAttempt] = useState(0),
    [invalid, setInvalid] = useState(false),
    [selectedScope, setSelectedScope] = useState<string | null>(null);
  const scope = JSON.stringify([reportId, media.challenge.contentVersion]);
  const activePhase = selectedScope === scope ? phase : null;
  const setupButton = useRef<HTMLButtonElement>(null),
    revealButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setPhase(null);
    setInvalid(false);
    const invalidate = () => {
      setInvalid(true);
      setPhase(null);
    };
    window.addEventListener("wyp:identity-invalidated", invalidate);
    return () =>
      window.removeEventListener("wyp:identity-invalidated", invalidate);
  }, [reportId, media.challenge.contentVersion]);
  const key = JSON.stringify([
    reportId,
    media.challenge.contentVersion,
    activePhase,
    attempt,
  ]);
  function select(next: "setup" | "reveal") {
    if (invalid) return;
    setSelectedScope(scope);
    setAttempt((a) => a + 1);
    setPhase(next);
  }
  const setup = media.challenge.setup,
    reveal = media.reveal,
    mode = activePhase === "reveal" ? "reveal" : "review-setup";
  const props = { mode, playbackKey: key, autoplay: true } as const;
  return (
    <section className="surface-card" aria-label="Reported recording">
      <h2>Watch the reported version.</h2>
      <p>
        Playback uses the reported version {media.challenge.contentVersion},
        even if the creator has since updated it.
      </p>
      <div className="card-actions">
        <button
          ref={setupButton}
          className="button button-secondary"
          disabled={invalid}
          onClick={() => select("setup")}
        >
          Watch reported setup
        </button>
        <button
          ref={revealButton}
          className="button button-secondary"
          disabled={invalid}
          onClick={() => select("reveal")}
        >
          Watch reported continuation
        </button>
        {activePhase && (
          <button
            className="text-button"
            onClick={() => {
              const trigger =
                activePhase === "setup" ? setupButton : revealButton;
              setPhase(null);
              trigger.current?.focus();
            }}
          >
            Close video
          </button>
        )}
      </div>
      {invalid ? (
        <p role="status">Operator playback access changed.</p>
      ) : (
        activePhase && (
          <div key={key} className="operator-media">
            {setup.kind === "youtube" ? (
              <YouTubeScenarioPlayer
                setup={setup}
                reveal={reveal.kind === "youtube" ? reveal : undefined}
                {...props}
              />
            ) : setup.kind === "uploaded-video" ? (
              <UploadedScenarioPlayer
                setup={setup}
                reveal={reveal.kind === "uploaded-video" ? reveal : undefined}
                context={{
                  kind: "operator-report",
                  reportId,
                  phase: activePhase,
                }}
                {...props}
              />
            ) : (
              <ScenarioMedia
                media={activePhase === "setup" ? setup : reveal}
                label={
                  activePhase === "setup"
                    ? "Reported setup"
                    : "Reported continuation"
                }
                {...props}
              />
            )}
          </div>
        )
      )}
    </section>
  );
}
