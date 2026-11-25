import Link from "next/link";
import type { LibraryScenarioPreview } from "@/contracts/library";

export function analysisLabel(item: LibraryScenarioPreview) {
  if (item.editorialOrigin === "curated")
    return "Curated · AI-authored analysis";
  return item.provenance === "ai-assisted"
    ? "Creator-reviewed · AI-assisted"
    : "Creator-reviewed";
}

export function ScenarioCard({
  scenario: item,
}: {
  scenario: LibraryScenarioPreview;
}) {
  return (
    <article className="library-card">
      <span className="eyebrow">{item.topic}</span>
      <h3>
        <Link href={`/library/${item.id}`}>{item.title}</Link>
      </h3>
      <p>
        {item.player.displayName} · {item.source?.agent} · {item.source?.map}
      </p>
      <p className="library-context">{item.context}</p>
      <div className="library-card-footer">
        <span>{analysisLabel(item)}</span>
        <Link className="text-button" href={`/library/${item.id}`}>
          Explore scenario →
        </Link>
      </div>
    </article>
  );
}
