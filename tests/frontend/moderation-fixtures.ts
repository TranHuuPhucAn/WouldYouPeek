import type {
  OperatorReportDetail,
  ReportReceipt,
} from "@/contracts/moderation";
import { creatorPreview, when } from "./creator-fixtures";
export const reportId = "12345678-1234-4234-8234-123456789abc";
export function receipt(overrides: Partial<ReportReceipt> = {}): ReportReceipt {
  return {
    report: { id: reportId, status: "open", createdAt: when },
    replayed: false,
    duplicate: false,
    ...overrides,
  };
}
export function operatorDetail(): OperatorReportDetail {
  const preview = creatorPreview(),
    answer = Object.values(preview.feedbackByOption)[0];
  const challenge = { ...preview.challenge, contentVersion: "creator-1" };
  return {
    report: {
      id: reportId,
      scenarioId: challenge.id,
      contentVersion: challenge.contentVersion,
      category: "analysis_issue",
      detail: "The alternative choice deserves another look.",
      status: "open",
      revision: 0,
      createdAt: when,
      resolvedAt: null,
      resolution: null,
      operatorNote: null,
    },
    media: {
      challenge,
      reveal: answer.reveal,
      observedAction: answer.observedAction,
      analysis: answer.analysis,
      optionFeedback: answer.optionFeedback,
      takeaway: answer.takeaway,
      outcomeText: answer.outcomeText,
    },
    visibility: {
      scenarioId: challenge.id,
      hidden: false,
      revision: 0,
      reason: null,
      changedAt: null,
      affectedPlaylistCount: 2,
      affectedEditorialPlaylistCount: 1,
      creatorPublished: true,
      currentContentVersion: "creator-2",
    },
  };
}
