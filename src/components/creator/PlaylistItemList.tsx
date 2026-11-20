import Link from "next/link";
import type { PlaylistItemPreview } from "@/contracts/playlist";
export function PlaylistItemList({
  items,
  ownerReview = false,
}: {
  items: PlaylistItemPreview[];
  ownerReview?: boolean;
}) {
  return (
    <ol className="playlist-order-list">
      {items.map((item, index) => (
        <li key={item.scenarioId} className="surface-card playlist-item">
          <span className="playlist-position">
            {String(index + 1).padStart(2, "0")}
          </span>
          <div>
            <h3>{item.title}</h3>
            <p>
              {item.player.displayName} · {item.map} · {item.agent}
            </p>
            {ownerReview && (
              <p className="quiet-note">
                Selected version {item.scenarioVersion} ·{" "}
                <Link href={`/creator/scenarios/${item.scenarioId}`}>
                  Open current scenario draft
                </Link>
              </p>
            )}
            <p className="quiet-note">
              {item.topic} ·{" "}
              {item.sourceKind === "youtube" ? "YouTube" : "Uploaded recording"}{" "}
              ·{" "}
              {item.provenance === "ai"
                ? "AI-authored analysis"
                : item.provenance === "ai-assisted"
                  ? "AI-assisted analysis"
                  : "Creator-authored analysis"}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
