import "server-only";
import type { DeploymentCapabilities } from "@/contracts/deployment";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getServerAppConfig } from "@/server/config";
import { ApiError } from "@/server/http";

export async function getDeploymentCapabilities(): Promise<DeploymentCapabilities> {
  try {
    const config = getServerAppConfig();
    const client = await createServerSupabaseClient();
    const { data, error } = await client
      .rpc("get_application_capabilities")
      .abortSignal(AbortSignal.timeout(5_000));
    if (
      error ||
      !data ||
      typeof data !== "object" ||
      Array.isArray(data) ||
      Object.keys(data).length !== 1 ||
      !("sourceMode" in data) ||
      (data.sourceMode !== "youtube-only" &&
        data.sourceMode !== "youtube-and-upload") ||
      (config.deploymentMode === "hosted" && data.sourceMode !== "youtube-only")
    )
      throw new Error("Invalid application capability");
    return { sourceMode: data.sourceMode };
  } catch {
    throw new ApiError(
      "STORAGE_UNAVAILABLE",
      "The application is temporarily unavailable. Please try again later.",
    );
  }
}

export async function requireUploadsEnabled() {
  if ((await getDeploymentCapabilities()).sourceMode !== "youtube-and-upload")
    throw new ApiError(
      "UPLOADS_DISABLED",
      "Video uploads are unavailable here. Use a YouTube link.",
    );
}
