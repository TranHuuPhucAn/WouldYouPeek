import { notFound } from "next/navigation";
import { getCurrentAccount } from "@/server/auth/guards";
import { getLibraryScenario } from "@/server/library/service";
import { ApiError } from "@/server/http";
import { LibraryScenarioDetail } from "@/components/library/LibraryScenarioDetail";
import {
  getPublicPageMetadata,
  getUnavailableMetadata,
} from "@/server/metadata";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ scenarioId: string }>;
}) {
  const { scenarioId } = await params;
  try {
    const item = await getLibraryScenario(scenarioId);
    return getPublicPageMetadata({
      title: item.title,
      description: `Study a ${item.player.displayName} decision. Watch the setup and make your call.`,
      path: `/library/${item.id}`,
    });
  } catch {
    return getUnavailableMetadata("Scenario unavailable");
  }
}
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
      <LibraryScenarioDetail
        key={`${viewer?.id ?? "guest"}-${scenarioId}`}
        scenario={item}
        viewer={viewer}
      />
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
