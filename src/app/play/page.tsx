import { requirePageAccount } from "@/app/protected-page";
import { getHistory } from "@/server/training/service";
import { PlayDashboard } from "@/components/sessions/PlayDashboard";
export default async function PlayPage() {
  const viewer = await requirePageAccount("/play");
  const history = await getHistory();
  return (
    <main className="page-shell" key={viewer.id}>
      <div className="page-heading">
        <span className="eyebrow">THE DECISION LAB</span>
        <h1>Your next call starts here.</h1>
        <p>Focus on the information available. Then question the outcome.</p>
      </div>
      <PlayDashboard
        activeSession={
          history.sessions.find((item) => item.status === "in_progress") ?? null
        }
      />
    </main>
  );
}
