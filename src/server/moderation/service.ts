import "server-only";
import { requireOperator, requireVerifiedUser } from "@/server/auth/guards";
import { ApiError } from "@/server/http";
import { parseUuid } from "@/server/training/validation";
import * as repository from "./repository";
import {
  parseReportCommand,
  parseReportQuery,
  parseResolutionCommand,
  parseVisibilityCommand,
  parseModerationScenarioId,
} from "./validation";
import {
  toReportReceipt,
  toOperatorReportList,
  toOperatorReportDetail,
  toResolveReportResponse,
  toVisibilityResponse,
} from "./projections";
export async function submitReport(input: unknown) {
  await requireVerifiedUser();
  return toReportReceipt(
    await repository.createReport(parseReportCommand(input)),
  );
}
export async function getOperatorReports(
  query: { status?: unknown; cursor?: unknown; limit?: unknown } = {},
) {
  await requireOperator();
  const parsed = parseReportQuery(query);
  const result = toOperatorReportList(await repository.listReports(parsed));
  if (result.reports.some((report) => report.status !== parsed.status))
    throw new ApiError(
      "STORAGE_UNAVAILABLE",
      "The report queue could not be loaded safely.",
    );
  return result;
}
export async function getOperatorReport(id: string) {
  await requireOperator();
  const reportId = parseUuid(id).toLowerCase();
  const result = toOperatorReportDetail(await repository.findReport(reportId));
  if (result.report.id.toLowerCase() !== reportId)
    throw new ApiError(
      "STORAGE_UNAVAILABLE",
      "The report could not be loaded safely.",
    );
  return result;
}
export async function resolveOperatorReport(id: string, input: unknown) {
  await requireOperator();
  const reportId = parseUuid(id).toLowerCase();
  const result = toResolveReportResponse(
    await repository.resolveReport(reportId, parseResolutionCommand(input)),
  );
  if (result.report.id.toLowerCase() !== reportId)
    throw new ApiError(
      "STORAGE_UNAVAILABLE",
      "The report could not be loaded safely.",
    );
  return result;
}
export async function changeScenarioVisibility(id: string, input: unknown) {
  await requireOperator();
  const scenarioId = parseModerationScenarioId(id);
  const result = toVisibilityResponse(
    await repository.setScenarioVisibility(
      scenarioId,
      parseVisibilityCommand(input),
    ),
  );
  if (result.visibility.scenarioId !== scenarioId)
    throw new ApiError(
      "STORAGE_UNAVAILABLE",
      "The scenario visibility could not be loaded safely.",
    );
  return result;
}
