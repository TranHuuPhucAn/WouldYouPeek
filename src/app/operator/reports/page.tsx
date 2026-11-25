import { notFound } from "next/navigation";
import { ApiError } from "@/server/http";
import { requireOperatorPage } from "../access";
import { getOperatorReports } from "@/server/moderation/service";
import { ReportQueue } from "@/components/operator/ReportQueue";
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; cursor?: string; limit?: string }>;
}) {
  const viewer = await requireOperatorPage("/operator/reports");
  const query = await searchParams;
  const initial = await getOperatorReports(query).catch((error: unknown) => {
    if (error instanceof ApiError && error.code === "INVALID_REQUEST")
      notFound();
    throw error;
  });
  return (
    <main className="page-shell">
      <div className="page-heading">
        <span className="eyebrow">OPERATOR</span>
        <h1>Scenario reports.</h1>
        <p>Review the moment, its explanation, and its public availability.</p>
      </div>
      <ReportQueue
        key={viewer.id}
        viewerId={viewer.id}
        initial={initial}
        initialStatus={query.status === "resolved" ? "resolved" : "open"}
      />
    </main>
  );
}
