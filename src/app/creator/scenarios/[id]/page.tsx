import { notFound } from "next/navigation";
import { requirePageCreator } from "@/app/protected-page";
import { findOwnedScenario } from "@/server/creator/service";
import { ApiError } from "@/server/http";
import { ScenarioEditor } from "@/components/creator/ScenarioEditor";
import { getDeploymentCapabilities } from "@/server/deployment/capabilities";
export default async function CreatorScenarioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const viewer = await requirePageCreator(`/creator/scenarios/${id}`);
  try {
    const initial = await findOwnedScenario(id);
    const capabilities = await getDeploymentCapabilities();
    return (
      <main className="page-shell">
        <ScenarioEditor
          key={`${viewer.id}-${id}`}
          initial={initial}
          viewerId={viewer.id}
          capabilities={capabilities}
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
