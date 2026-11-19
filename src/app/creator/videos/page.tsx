import Link from "next/link";
import { requirePageCreator } from "@/app/protected-page";
import { listVideos } from "@/server/video/service";
import { VideoLibrary } from "@/components/creator/VideoLibrary";

export default async function CreatorVideosPage() {
  const viewer = await requirePageCreator("/creator/videos");
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
