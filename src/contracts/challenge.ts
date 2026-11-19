export type Assessment = "recommended" | "reasonable" | "risky";
export type MediaStatus = "ready" | "demo";

export type YouTubeSegment = {
  kind: "youtube";
  videoId: string;
  startSeconds: number;
  endSeconds: number;
  alt: string;
  caption?: string;
};

export type UploadedVideoSegment = {
  kind: "uploaded-video";
  assetId: string;
  startSeconds: number;
  endSeconds: number;
  alt: string;
  caption?: string;
};

export type MediaAsset =
  | { kind: "video"; src: string; alt: string; caption?: string }
  | { kind: "illustration"; src: string; alt: string; caption?: string }
  | YouTubeSegment
  | UploadedVideoSegment;

export type DecisionAsset =
  | { kind: "image"; imageUrl: string; alt: string }
  | { kind: "paused-video"; atSeconds: number; alt: string };

export type YouTubeChallengeSource = {
  kind: "youtube";
  videoId: string;
  url: string;
  title: string;
  uploader: string;
  player: string;
  matchType: "ranked" | "tournament";
  map: string;
  agent: string;
  round: number;
  score: string;
  side: "attack" | "defense";
  publishedDate?: string;
  dateNote?: string;
};

export type UploadedChallengeSource = Omit<
  YouTubeChallengeSource,
  "kind" | "videoId" | "url"
> & { kind: "uploaded"; assetId: string; creditUrl: string };
export type ChallengeSource = YouTubeChallengeSource | UploadedChallengeSource;

export type ObservedAction = { optionId: string; description: string };

export type ScenarioAnalysis = {
  author: "ai" | "creator" | "ai-assisted";
  notice: string;
  rationale: string;
  limitations: string[];
};
export type AIAnalysis = ScenarioAnalysis & { author: "ai" };

export type ChallengeSummary = {
  id: string;
  title: string;
  topic: string;
  order: number;
  mediaStatus: MediaStatus;
};

export type ChallengeOption = { id: string; label: string };

export type ChallengeDetail = ChallengeSummary & {
  contentVersion: string;
  context: string;
  question?: string;
  source?: ChallengeSource;
  knownFacts?: string[];
  unknowns?: string[];
  linkedScenarioId?: string;
  setup: MediaAsset;
  decision: DecisionAsset;
  options: ChallengeOption[];
};

export type ChallengeListResponse = { challenges: ChallengeSummary[] };
export type ChallengePreview = ChallengeSummary & {
  context: string;
  source?: ChallengeSource;
  setup: MediaAsset;
};
export type ChallengePreviewListResponse = { challenges: ChallengePreview[] };
export type AnswerRequest = { optionId: string };

export type OptionFeedback = {
  optionId: string;
  assessment: Assessment;
  explanation: string;
  acceptableWhen: string[];
  risks: string[];
};

export type AnswerResponse = {
  challengeId: string;
  contentVersion: string;
  selectedOptionId: string;
  selectedAssessment: Assessment;
  recommendedOptionIds: string[];
  optionFeedback: OptionFeedback[];
  takeaway: string;
  reveal: MediaAsset;
  outcomeText: string;
  observedAction?: ObservedAction;
  matchesPro?: boolean;
  analysis?: ScenarioAnalysis;
};

export type ApiErrorCode =
  | "INVALID_JSON"
  | "INVALID_REQUEST"
  | "INVALID_OPTION"
  | "CHALLENGE_NOT_FOUND"
  | "AUTH_REQUIRED"
  | "EMAIL_NOT_VERIFIED"
  | "CREATOR_REQUIRED"
  | "SESSION_NOT_FOUND"
  | "SESSION_CONFLICT"
  | "ANSWER_LOCKED"
  | "IDEMPOTENCY_CONFLICT"
  | "SESSION_REQUIRED"
  | "SCENARIO_NOT_FOUND"
  | "SCENARIO_CONFLICT"
  | "DRAFT_NOT_READY"
  | "REVIEW_REQUIRED"
  | "SCENARIO_UNAVAILABLE"
  | "ACTIVE_SESSION_EXISTS"
  | "PAYLOAD_TOO_LARGE"
  | "RATE_LIMITED"
  | "STORAGE_UNAVAILABLE"
  | "INTERNAL_ERROR"
  | "VIDEO_NOT_FOUND"
  | "VIDEO_CONFLICT"
  | "VIDEO_NOT_READY"
  | "VIDEO_IN_USE"
  | "UPLOAD_LIMIT_REACHED"
  | "UPLOAD_EXPIRED"
  | "VIDEO_UNSUPPORTED"
  | "MEDIA_UNAVAILABLE";

export type ApiErrorResponse = {
  error: { code: ApiErrorCode; message: string; details?: ApiErrorDetails };
};
export type ApiErrorDetails =
  | { issues: import("./creator").ValidationIssue[] }
  | { activeSession: import("./session").SessionSummary };
