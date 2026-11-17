import { notFound } from "next/navigation";
import { requirePageAccount } from "@/app/protected-page";
import { getSession } from "@/server/training/service";
import { ApiError } from "@/server/http";
import { ChallengePlayer } from "@/components/challenge/ChallengePlayer";
export default async function SavedSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const viewer = await requirePageAccount(`/play/${sessionId}`);
  let snapshot;
  try {
    snapshot = await getSession(sessionId);
  } catch (error) {
    if (
      error instanceof ApiError &&
      ["SESSION_NOT_FOUND", "INVALID_REQUEST"].includes(error.code)
    )
      notFound();
    throw error;
  }
  return (
    <ChallengePlayer
      key={`${viewer.id}:${snapshot.id}`}
      viewer={viewer}
      initialSession={snapshot}
    />
  );
}
