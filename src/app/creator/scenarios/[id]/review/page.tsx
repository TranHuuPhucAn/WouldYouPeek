import { notFound } from "next/navigation";
import { requirePageCreator } from "@/app/protected-page";
import { findOwnedScenario, getReviewPreview } from "@/server/creator/service";
import { ApiError } from "@/server/http";
import { CreatorReview } from "@/components/creator/CreatorReview";
import Link from "next/link";
import { getDeploymentCapabilities } from "@/server/deployment/capabilities";
export default async function CreatorReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params,
    viewer = await requirePageCreator(`/creator/scenarios/${id}/review`);
  try {
    const initial = await findOwnedScenario(id);
    const capabilities = await getDeploymentCapabilities();
    if (
      initial.draft.content.source.kind === "uploaded" &&
      capabilities.sourceMode === "youtube-only"
    )
      return (
        <main className="page-shell">
          <section className="surface-card">
            <h1>Replace this recording to continue.</h1>
            <p>
              Your draft is saved. This site supports YouTube recordings, so
              choose a YouTube link before reviewing or publishing.
            </p>
            <Link
              className="button button-primary"
              href={`/creator/scenarios/${id}`}
            >
              Edit scenario →
            </Link>
          </section>
        </main>
      );
    let preview = null,
      error: string | undefined;
    if (initial.readiness.canReview) {
      try {
        preview = await getReviewPreview(id, initial.revision);
      } catch (failure) {
        if (
          failure instanceof ApiError &&
          ["SCENARIO_CONFLICT", "DRAFT_NOT_READY"].includes(failure.code)
        )
          error =
            "The saved draft changed while this review opened. Reload the latest review.";
        else throw failure;
      }
    }
    return (
      <main className="page-shell">
        <CreatorReview
          key={`${viewer.id}-${id}`}
          initial={initial}
          initialPreview={preview}
          initialError={error}
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
