"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { AccountUser } from "@/contracts/auth";
import type { LibraryScenarioPreview } from "@/contracts/library";
import { SourceAttribution } from "@/components/challenge/SourceAttribution";
import { LibraryMediaPreview } from "./LibraryMediaPreview";
import { analysisLabel } from "./ScenarioCard";
import { ScenarioStart } from "./ScenarioStart";
import { ScenarioInteractionScope } from "./ScenarioInteractionScope";

/** One displayed publication owns its recording, context, and attribution. */
export function LibraryScenarioDetail({
  scenario,
  viewer,
}: {
  scenario: LibraryScenarioPreview;
  viewer: AccountUser | null;
}) {
  const [displayed, setDisplayed] = useState(scenario);
  useEffect(() => setDisplayed(scenario), [scenario]);
  return (
    <main className="page-shell">
      <Link href="/library" className="text-button">
        ← Scenario library
      </Link>
      <div className="page-heading">
        <span className="eyebrow">{displayed.topic}</span>
        <h1>{displayed.title}</h1>
        <p>
          <Link href={`/library/players/${displayed.player.id}`}>
            {displayed.player.displayName}
          </Link>{" "}
          · {displayed.source?.agent} · {displayed.source?.map}
        </p>
      </div>
      <ScenarioInteractionScope>
        <div className="library-detail-grid">
          <section>
            <LibraryMediaPreview
              scenario={displayed}
              viewer={viewer}
              onPublicationRefreshed={setDisplayed}
            />
            <p className="preview-context">{displayed.context}</p>
            <div className="source-attribution">
              <p>{analysisLabel(displayed)}</p>
              {displayed.source && (
                <SourceAttribution source={displayed.source} />
              )}
            </div>
          </section>
          <ScenarioStart
            key={`${viewer?.id ?? "guest"}-${viewer?.emailVerified ?? false}`}
            scenarioId={displayed.id}
            viewer={viewer}
          />
        </div>
      </ScenarioInteractionScope>
    </main>
  );
}
