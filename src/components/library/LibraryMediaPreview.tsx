"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { AccountUser } from "@/contracts/auth";
import type { LibraryScenarioPreview } from "@/contracts/library";
import { ScenarioMedia } from "@/components/challenge/ScenarioMedia";
import { useScenarioReport } from "@/hooks/use-scenario-report";
import { useScenarioMediaSuspended } from "./ScenarioInteractionScope";
import {
  ReportScenarioDialog,
  ReportRequestStatus,
} from "@/components/reports/ReportScenarioDialog";

export function LibraryMediaPreview({
  scenario,
  viewer,
  onPublicationRefreshed,
}: {
  scenario: LibraryScenarioPreview;
  viewer: AccountUser | null;
  onPublicationRefreshed?: (scenario: LibraryScenarioPreview) => void;
}) {
  const [displayed, setDisplayed] = useState(scenario);
  const siblingDialogOpen = useScenarioMediaSuspended();
  useEffect(() => setDisplayed(scenario), [scenario]);
  const report = useScenarioReport(
    viewer?.emailVerified ? viewer.id : null,
    (next) => {
      setDisplayed(next);
      onPublicationRefreshed?.(next);
    },
  );
  const verified = !!viewer?.emailVerified && !report.invalid;
  const returnTo = encodeURIComponent(`/library/${displayed.id}`);
  return (
    <>
      {displayed.setup.kind === "uploaded-video" && !verified ? (
        <section
          className="surface-card library-media-gate"
          aria-label="Recording preview"
        >
          <span className="eyebrow">UPLOADED RECORDING</span>
          <h2>A player POV, ready for your call.</h2>
          <p>
            {viewer
              ? "Verify your email to preview this recording and play the scenario."
              : "Sign in to preview this recording and play the scenario."}
          </p>
          <Link
            className="button button-secondary"
            href={`${viewer ? "/check-email" : "/sign-in"}?returnTo=${returnTo}`}
          >
            {viewer ? "Verify email →" : "Sign in to preview →"}
          </Link>
        </section>
      ) : (
        <ScenarioMedia
          key={`${displayed.id}:${displayed.contentVersion}`}
          media={displayed.setup}
          label="Setup preview"
          context={{ kind: "library-scenario", scenarioId: displayed.id }}
          suspended={report.open || siblingDialogOpen}
        />
      )}
      <div className="report-entry">
        {verified ? (
          <button
            className="text-button"
            onClick={() =>
              report.begin({
                kind: "publication",
                scenarioId: displayed.id,
                contentVersion: displayed.contentVersion,
              })
            }
          >
            Report a problem
          </button>
        ) : (
          <Link
            className="text-button"
            href={`${viewer ? "/check-email" : "/sign-in"}?returnTo=${returnTo}`}
          >
            {viewer
              ? "Verify email to report a problem"
              : "Sign in to report a problem"}
          </Link>
        )}
        <ReportRequestStatus report={report} />
      </div>
      <ReportScenarioDialog report={report} />
    </>
  );
}
