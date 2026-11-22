import { getPrivatePageMetadata } from "@/server/metadata";
export const metadata = getPrivatePageMetadata("Your saved sessions");
import { requirePageAccount } from "@/app/protected-page";
import { getHistory } from "@/server/training/service";
import { SessionHistory } from "@/components/sessions/SessionHistory";
export default async function HistoryPage() {
  const viewer = await requirePageAccount("/history");
  const history = await getHistory();
  return (
    <main className="page-shell">
      <div className="page-heading">
        <span className="eyebrow">YOUR PROGRESS</span>
        <h1>Return to your decisions.</h1>
        <p>
          Revisit the conditions and alternatives. Matching the pro is a
          comparison, not a skill score.
        </p>
      </div>
      <SessionHistory key={viewer.id} initialHistory={history} />
    </main>
  );
}
