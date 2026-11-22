import Link from "next/link";
import { requirePageCreator } from "@/app/protected-page";
import { listVideos } from "@/server/video/service";
import { VideoLibrary } from "@/components/creator/VideoLibrary";
import { getDeploymentCapabilities } from "@/server/deployment/capabilities";

export default async function CreatorVideosPage() {
  const viewer = await requirePageCreator("/creator/videos");
  const capabilities = await getDeploymentCapabilities();
  if (capabilities.sourceMode === "youtube-only")
    return (
      <main className="page-shell">
        <section className="surface-card">
          <h1>Create with a YouTube recording.</h1>
          <p>
            Video uploads are unavailable here. Add a YouTube link to your
            scenario, then mark its decision points.
          </p>
          <Link className="button button-primary" href="/creator">
            Your scenarios →
          </Link>
        </section>
      </main>
    );
  const initial = await listVideos();
  return (
    <main className="page-shell">
      <Link className="text-button" href="/creator">
        ← Creator workspace
      </Link>
      <div className="page-heading">
        <span className="eyebrow">CREATOR VIDEOS</span>
        <h1>Your footage. Your decision points.</h1>
        <p>
          Upload once, choose your moments, and reuse the recording across
          scenarios.
        </p>
      </div>
      <VideoLibrary key={viewer.id} viewerId={viewer.id} initial={initial} />
    </main>
  );
}
