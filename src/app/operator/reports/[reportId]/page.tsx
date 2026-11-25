import { notFound } from "next/navigation";
import { requireOperatorPage } from "../../access";
import { getOperatorReport } from "@/server/moderation/service";
import { ApiError } from "@/server/http";
import { ReportDetail } from "@/components/operator/ReportDetail";
export default async function ReportPage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const { reportId } = await params;
  const viewer = await requireOperatorPage(`/operator/reports/${reportId}`);
  try {
    const initial = await getOperatorReport(reportId);
    return (
      <ReportDetail
        key={`${viewer.id}:${reportId}`}
        viewerId={viewer.id}
        initial={initial}
      />
    );
  } catch (error) {
    if (
      error instanceof ApiError &&
      ["REPORT_NOT_FOUND", "INVALID_REQUEST"].includes(error.code)
    )
      notFound();
    throw error;
  }
}
