import Link from "next/link";
import { requirePageAccount } from "@/app/protected-page";
export default async function CreatorPage() {
  const viewer = await requirePageAccount("/creator");
  return (
    <main className="page-shell">
      <div className="page-heading">
        <span className="eyebrow">CREATOR SPACE</span>
        <h1>
          {viewer.role === "creator"
            ? "Your perspective belongs here."
            : "Help others read the moment."}
        </h1>
      </div>
      <section className="surface-card">
        <h2>
          {viewer.role === "creator"
            ? "Creator access is enabled."
            : "Enable creator access to get ready."}
        </h2>
        <p>
          Scenario authoring, VOD uploads and publishing arrive in the next
          milestone. For now, keep exploring the learner experience.
        </p>
        <Link
          className="button button-primary"
          href={viewer.role === "creator" ? "/play" : "/account"}
        >
          {viewer.role === "creator"
            ? "Back to practice →"
            : "Manage creator access →"}
        </Link>
      </section>
    </main>
  );
}
