import { notFound } from "next/navigation";
import { requirePageCreator } from "@/app/protected-page";
import { findOwnedScenario } from "@/server/creator/service";
import { ApiError } from "@/server/http";
import { ScenarioEditor } from "@/components/creator/ScenarioEditor";
export default async function CreatorScenarioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const viewer = await requirePageCreator(`/creator/scenarios/${id}`);
  try {
    const initial = await findOwnedScenario(id);
    return (
      <main className="page-shell">
        <ScenarioEditor
          key={`${viewer.id}-${id}`}
          initial={initial}
          viewerId={viewer.id}
        />
      </main>
    );
  } catch (error) {
    if (
      error instanceof ApiError &&
      ["SCENARIO_NOT_FOUND", "INVALID_REQUEST"].includes(error.code)
    )
      notFound();
    throw error;
  }
}
