import type { AnswerResponse, ChallengeDetail } from "./challenge";

export const REPORT_CATEGORIES = [
  "broken_video",
  "spoiler",
  "incorrect_context",
  "analysis_issue",
  "inappropriate_content",
  "other",
] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];
export type ReportStatus = "open" | "resolved";
export type ReportResolution = "dismissed" | "addressed";
export type ReportTarget =
  | { kind: "publication"; scenarioId: string; contentVersion: string }
  | { kind: "session-item"; sessionId: string; itemId: string };
export type SubmitReportRequest = {
  requestId: string;
  target: ReportTarget;
  category: ReportCategory;
  detail: string;
};
export type ReportReceipt = {
  report: { id: string; status: ReportStatus; createdAt: string };
  replayed: boolean;
  duplicate: boolean;
};
export type OperatorReport = {
  id: string;
  scenarioId: string;
  contentVersion: string;
  category: ReportCategory;
  detail: string;
  status: ReportStatus;
  revision: number;
  createdAt: string;
  resolvedAt: string | null;
  resolution: ReportResolution | null;
  operatorNote: string | null;
};
export type OperatorReportList = {
  reports: OperatorReport[];
  nextCursor: string | null;
};
export type OperatorReportMedia = {
  challenge: ChallengeDetail;
} & Pick<
  AnswerResponse,
  | "reveal"
  | "observedAction"
  | "analysis"
  | "optionFeedback"
  | "takeaway"
  | "outcomeText"
>;
export type ScenarioVisibility = {
  scenarioId: string;
  hidden: boolean;
  revision: number;
  reason: string | null;
  changedAt: string | null;
  affectedPlaylistCount: number;
  affectedEditorialPlaylistCount: number;
  creatorPublished: boolean;
  currentContentVersion: string | null;
};
export type CreatorVisibilityNotice = {
  hidden: boolean;
  reason: string | null;
  changedAt: string | null;
};
export type OperatorReportDetail = {
  report: OperatorReport;
  media: OperatorReportMedia;
  visibility: ScenarioVisibility;
};
export type ResolveReportRequest = {
  requestId: string;
  expectedRevision: number;
  resolution: ReportResolution;
  operatorNote: string;
};
export type ResolveReportResponse = {
  report: OperatorReport;
  replayed: boolean;
};
export type VisibilityRequest = {
  requestId: string;
  expectedRevision: number;
  hidden: boolean;
  reason: string;
};
export type VisibilityResponse = {
  visibility: ScenarioVisibility;
  replayed: boolean;
};
