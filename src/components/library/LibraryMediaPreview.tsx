"use client";
import Link from "next/link";
import type { AccountUser } from "@/contracts/auth";
import type { LibraryScenarioPreview } from "@/contracts/library";
import { ScenarioMedia } from "@/components/challenge/ScenarioMedia";

export function LibraryMediaPreview({
  scenario,
  viewer,
}: {
  scenario: LibraryScenarioPreview;
  viewer: AccountUser | null;
}) {
  if (scenario.setup.kind === "uploaded-video" && !viewer?.emailVerified) {
    const returnTo = encodeURIComponent(`/library/${scenario.id}`);
    return (
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
    );
  }
  return (
    <ScenarioMedia
      media={scenario.setup}
      label="Setup preview"
      context={{ kind: "library-scenario", scenarioId: scenario.id }}
    />
  );
}
