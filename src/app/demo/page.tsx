import { listChallengePreviews } from "@/server/challenges/service";
import { DemoPreview } from "@/components/demo/DemoPreview";
export default async function DemoPage() {
  const previews = await listChallengePreviews();
  return (
    <main className="page-shell">
      <div className="page-heading">
        <span className="eyebrow">EXPLORE THE LAB</span>
        <h1>See the moment before the call.</h1>
        <p>Three real pro POV setups. Sign in when you’re ready to decide.</p>
      </div>
      <DemoPreview previews={previews} />
    </main>
  );
}
