"use client";

import { useState } from "react";
import type { PlaylistSessionMetadata } from "@/contracts/playlist";
import type { SessionItem } from "@/contracts/session";
import Link from "next/link";
import { assessmentLabel } from "./FeedbackPanel";
import { SavedScenarioReview, type SavedReplay } from "./SavedScenarioReview";
import { useScenarioReport } from "@/hooks/use-scenario-report";
import {
  ReportScenarioDialog,
  ReportRequestStatus,
} from "@/components/reports/ReportScenarioDialog";

export function SessionRecap({
  items,
  sessionId,
  viewerId,
  onRestart,
  pending = false,
  completedAt,
  title,
  playlist,
  status = "completed",
  endedAt,
}: {
  items: SessionItem[];
  sessionId: string;
  viewerId: string;
  onRestart: () => void;
  pending?: boolean;
  completedAt?: string | null;
  title?: string;
  playlist?: PlaylistSessionMetadata;
  status?: "completed" | "ended";
  endedAt?: string | null;
}) {
  const [replay, setReplay] = useState<SavedReplay | null>(null);
  const report = useScenarioReport(viewerId);
  const completed = items.filter((item) => item.answer);
  const savedAt = status === "ended" ? endedAt : completedAt;
  const hasProScenarios = completed.some(
    ({ answer }) => answer?.result.observedAction,
  );
  return (
    <main className="recap-shell scenario-recap">
      <span className="eyebrow">
        <span className="status-dot" />
        {status === "ended" ? "ENDED EARLY" : "SESSION COMPLETE"}
      </span>
      {status === "ended" ? (
        <h1>
          Session ended.
          <br />
          <span className="accent-text">Your history stays.</span>
        </h1>
      ) : (
        <h1>
          {completed.length === 1
            ? "One call."
            : completed.length === 3
              ? "Three calls."
              : `${completed.length} calls.`}
          <br />
          <span className="accent-text">More perspective.</span>
        </h1>
      )}
      {title && <p className="quiet-note">{title}</p>}
      {playlist && (
        <p className="quiet-note">
          Playlist by {playlist.credit.displayName} ·{" "}
          {playlist.players.map((player) => player.displayName).join(", ")}
        </p>
      )}
      <p className="recap-intro">
        {status === "ended"
          ? `${completed.length} of ${items.length} decisions saved. This session cannot be resumed.`
          : "Good decisions start with noticing the details. Take a moment to revisit yours."}
      </p>
      {status === "ended" && completed.length === 0 && (
        <p>
          No decisions were saved. Choose another scenario when you’re ready.
        </p>
      )}
      {savedAt && (
        <p className="quiet-note">
          Saved on{" "}
          {new Date(savedAt).toLocaleDateString("en", {
            dateStyle: "medium",
            timeZone: "UTC",
          })}
        </p>
      )}
      <div className="recap-list">
        {completed.map((item, index) => {
          const { challenge } = item,
            answer = item.answer!.result;
          return (
            <details
              className="recap-card"
              key={item.id}
              onToggle={(event) => {
                if (!event.currentTarget.open)
                  setReplay((active) =>
                    active?.itemId === item.id ? null : active,
                  );
              }}
            >
              <summary>
                <span className="recap-number">
                  {String(index + 1).padStart(2, "0")}
                </span>
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
                <SavedScenarioReview
                  item={item}
                  sessionId={sessionId}
                  viewerId={viewerId}
                  replay={replay?.itemId === item.id ? replay : null}
                  onReplay={(media) =>
                    setReplay((previous) => ({
                      itemId: item.id,
                      media,
                      attempt: (previous?.attempt ?? 0) + 1,
                    }))
                  }
                  onClose={() => setReplay(null)}
                  onReport={() =>
                    report.begin({
                      kind: "session-item",
                      sessionId,
                      itemId: item.id,
                    })
                  }
                  suspended={report.open}
                />
              </div>
            </details>
          );
        })}
      </div>
      <ReportRequestStatus report={report} />
      <ReportScenarioDialog report={report} />
      {completed.length > 0 && (
        <p className="quiet-note">
          {hasProScenarios
            ? "Review the conditions behind your choices. Matching a pro’s action is a comparison, not a measure of rank or skill."
            : "Review the conditions behind your choices. This session does not measure your rank or skill."}
        </p>
      )}
      <div className="recap-actions">
        <button
          className="button button-primary"
          onClick={onRestart}
          disabled={pending}
        >
          {pending
            ? "Opening…"
            : playlist
              ? "View latest playlist"
              : "Play again"}{" "}
          <span aria-hidden="true">↺</span>
        </button>
        <Link href="/library" className="button button-secondary">
          Scenario library
        </Link>
        <Link href="/history" className="button button-secondary">
          Session history
        </Link>
      </div>
    </main>
  );
}
