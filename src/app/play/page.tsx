import { redirect } from "next/navigation";
import { getCurrentAccount } from "@/server/auth/guards";
import { getActiveSessionSummary } from "@/server/training/service";

export default async function PlayPage() {
  const viewer = await getCurrentAccount();
  const session = viewer?.emailVerified
    ? await getActiveSessionSummary()
    : null;
  redirect(session ? `/play/${session.id}` : "/library");
}
