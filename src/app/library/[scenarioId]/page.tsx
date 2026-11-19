import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageAccount } from "@/app/protected-page";
import { getLibraryScenario } from "@/server/library/service";
import { ApiError } from "@/server/http";
import { SourceAttribution } from "@/components/challenge/SourceAttribution";
import { ScenarioMedia } from "@/components/challenge/ScenarioMedia";
import { ScenarioStart } from "@/components/library/ScenarioStart";
export default async function LibraryScenarioPage({
  params,
}: {
  params: Promise<{ scenarioId: string }>;
}) {
  const { scenarioId } = await params,
    viewer = await requirePageAccount(`/library/${scenarioId}`);
  try {
    const item = await getLibraryScenario(scenarioId);
    return (
      <main className="page-shell" key={`${viewer.id}-${scenarioId}`}>
        <Link href="/library" className="text-button">
          ← Scenario library
        </Link>
        <div className="page-heading">
          <span className="eyebrow">{item.topic}</span>
          <h1>{item.title}</h1>
          <p>
            {item.source?.player} · {item.source?.agent} · {item.source?.map}
          </p>
        </div>
        <div className="library-detail-grid">
          <section>
            <ScenarioMedia
              media={item.setup}
              label="Setup preview"
              context={{ kind: "library-scenario", scenarioId }}
            />
            <p className="preview-context">{item.context}</p>
            <div className="source-attribution">
              <p>
                {item.provenance === "ai-assisted"
                  ? "Creator-reviewed analysis with AI assistance"
                  : "Creator-reviewed analysis"}
              </p>
              {item.source && <SourceAttribution source={item.source} />}
            </div>
          </section>
          <ScenarioStart scenarioId={scenarioId} />
        </div>
      </main>
    );
  } catch (error) {
    if (
      error instanceof ApiError &&
      [
        "SCENARIO_UNAVAILABLE",
        "SCENARIO_NOT_FOUND",
        "INVALID_REQUEST",
        "CHALLENGE_NOT_FOUND",
      ].includes(error.code)
    )
      notFound();
    throw error;
  }
}
