import { getDeploymentCapabilities } from "@/server/deployment/capabilities";
import { createRequestId, logOperationalEvent } from "@/server/observability";

export async function GET() {
  const start = Date.now();
  try {
    await getDeploymentCapabilities();
    return Response.json(
      { ok: true },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    const requestId = createRequestId();
    logOperationalEvent({
      operation: "health",
      code: "STORAGE_UNAVAILABLE",
      status: 503,
      requestId,
      durationMs: Date.now() - start,
    });
    return Response.json(
      { ok: false },
      {
        status: 503,
        headers: {
          "Cache-Control": "private, no-store",
          "X-Request-Id": requestId,
        },
      },
    );
  }
}
