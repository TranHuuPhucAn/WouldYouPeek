import Link from "next/link";
import { requirePageAccount } from "@/app/protected-page";
import { listOwnedScenarios } from "@/server/creator/service";
import { CreatorDashboard } from "@/components/creator/CreatorDashboard";
export default async function CreatorPage() {
  const viewer = await requirePageAccount("/creator");
  const initial = viewer.role === "creator" ? await listOwnedScenarios() : null;
  return (
    <main className="page-shell">
      <div className="page-heading">
        <span className="eyebrow">CREATOR SPACE</span>
        <h1>Your perspective belongs here.</h1>
        <p>
          Frame the decision. Explore the alternatives. Help another player see
          more.
        </p>
      </div>
      {initial ? (
        <CreatorDashboard key={viewer.id} initial={initial} />
      ) : (
        <section className="surface-card">
          <h2>Enable creator access to get started.</h2>
          <p>
            Use YouTube links or your uploaded recordings, write your analysis,
            then review and publish them for learners. Creator access also keeps
            all learner features.
          </p>
          <Link className="button button-primary" href="/account">
            Manage creator access →
          </Link>
        </section>
      )}
    </main>
  );
}
