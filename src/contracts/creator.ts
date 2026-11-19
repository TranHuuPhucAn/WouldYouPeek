import type { AnswerResponse, Assessment, ChallengeDetail } from "./challenge";

export type ValidationIssue = { path: string; code: string; message: string };
export type CreatorFilter = "all" | "unpublished" | "published" | "withdrawn";
export type CreatorSourceAttribution = {
  title: string;
  uploader: string;
  player: string;
  map: string;
  agent: string;
  score: string;
  matchType: "ranked" | "tournament" | null;
  round: number | null;
  side: "attack" | "defense" | null;
  publishedDate: string;
  dateNote: string;
};
export type YouTubeCreatorSource = CreatorSourceAttribution & {
  url: string;
  kind?: never;
};
export type UploadedCreatorSource = CreatorSourceAttribution & {
  kind: "uploaded";
  assetId: string | null;
  creditUrl: string;
};
export type CreatorSource = YouTubeCreatorSource | UploadedCreatorSource;
export type CreatorDraftContent = {
  title: string;
  topic: string;
  context: string;
  question: string;
  source: CreatorSource;
  media: {
    startSeconds: number | null;
    decisionSeconds: number | null;
    endSeconds: number | null;
    setupAlt: string;
    decisionAlt: string;
    revealAlt: string;
  };
  knownFacts: string[];
  unknowns: string[];
  options: {
    id: string;
    label: string;
    assessment: Assessment | null;
    explanation: string;
    acceptableWhen: string[];
    risks: string[];
  }[];
  observedAction: { optionId: string | null; description: string };
  analysis: {
    author: "creator" | "ai-assisted";
    rationale: string;
    limitations: string[];
  };
  takeaway: string;
  outcomeText: string;
};
export const REVIEW_CHECKLIST_KEYS = [
  "povInformationChecked",
  "setupSpoilersChecked",
  "pauseTimingChecked",
  "continuationChecked",
  "normalSpeedAudioChecked",
  "alternativeChoicesChecked",
  "sourceAttributionChecked",
] as const;
export type ReviewChecklist = Record<
  (typeof REVIEW_CHECKLIST_KEYS)[number],
  boolean
>;
export type CreatorPublication = {
  state: "never_published" | "published" | "withdrawn";
  currentVersion: string | null;
  publishedAt: string | null;
  hasUnpublishedChanges: boolean;
};
export type CreatorScenarioSnapshot = {
  id: string;
  revision: number;
  draft: { revision: number; content: CreatorDraftContent; savedAt: string };
  readiness: { issues: ValidationIssue[]; canReview: boolean };
  review: {
    id: string;
    draftRevision: number;
    reviewedAt: string;
    checklist: ReviewChecklist;
  } | null;
  publication: CreatorPublication;
  updatedAt: string;
};
export type CreatorScenarioSummary = {
  id: string;
  title: string;
  revision: number;
  draftRevision: number;
  canReview: boolean;
  reviewed: boolean;
  publication: CreatorPublication;
  createdAt: string;
  updatedAt: string;
};
export type CreatorListResponse = {
  scenarios: CreatorScenarioSummary[];
  nextCursor: string | null;
};
export type CreatorMutationResponse = {
  scenario: CreatorScenarioSnapshot;
  replayed: boolean;
  publishedVersion: string | null;
};
export type CreatorReviewPreview = {
  scenario: CreatorScenarioSnapshot;
  challenge: ChallengeDetail;
  feedbackByOption: Record<string, AnswerResponse>;
};
export type CreateDraftRequest = { requestId: string };
export type CreatorCommand = { requestId: string; expectedRevision: number };
export type SaveDraftRequest = CreatorCommand & {
  content: CreatorDraftContent;
};
export type ReviewDraftRequest = CreatorCommand & {
  checklist: ReviewChecklist;
};
export type PublishDraftRequest = CreatorCommand & { reviewId: string };
