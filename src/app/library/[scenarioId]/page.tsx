import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentAccount } from "@/server/auth/guards";
import { getLibraryScenario } from "@/server/library/service";
import { ApiError } from "@/server/http";
import { SourceAttribution } from "@/components/challenge/SourceAttribution";
import { LibraryMediaPreview } from "@/components/library/LibraryMediaPreview";
import { analysisLabel } from "@/components/library/ScenarioCard";
import { ScenarioStart } from "@/components/library/ScenarioStart";
export default async function LibraryScenarioPage({
  params,
}: {
  params: Promise<{ scenarioId: string }>;
}) {
  const { scenarioId } = await params,
    viewer = await getCurrentAccount();
  try {
    const item = await getLibraryScenario(scenarioId);
    return (
      <main
        className="page-shell"
        key={`${viewer?.id ?? "guest"}-${scenarioId}`}
      >
        <Link href="/library" className="text-button">
          ← Scenario library
        </Link>
        <div className="page-heading">
          <span className="eyebrow">{item.topic}</span>
          <h1>{item.title}</h1>
          <p>
            <Link href={`/library/players/${item.player.id}`}>
              {item.player.displayName}
            </Link>{" "}
            · {item.source?.agent} · {item.source?.map}
          </p>
        </div>
        <div className="library-detail-grid">
          <section>
            <LibraryMediaPreview scenario={item} viewer={viewer} />
            <p className="preview-context">{item.context}</p>
            <div className="source-attribution">
              <p>{analysisLabel(item)}</p>
              {item.source && <SourceAttribution source={item.source} />}
            </div>
          </section>
          <ScenarioStart
            key={`${viewer?.id ?? "guest"}-${viewer?.emailVerified ?? false}`}
            scenarioId={item.id}
            viewer={viewer}
          />
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
