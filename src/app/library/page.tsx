import { requirePageAccount } from "@/app/protected-page";
import { getLibrary } from "@/server/library/service";
import { ScenarioLibrary } from "@/components/library/ScenarioLibrary";
export default async function LibraryPage() {
  const viewer = await requirePageAccount("/library"),
    initial = await getLibrary();
  return (
    <main className="page-shell">
      <div className="page-heading">
        <span className="eyebrow">THE SCENARIO LIBRARY</span>
        <h1>One moment. A new perspective.</h1>
        <p>
          Explore creator-reviewed player POVs. Make your call before seeing the
          action and analysis.
        </p>
      </div>
      <ScenarioLibrary key={viewer.id} initial={initial} />
    </main>
  );
}
