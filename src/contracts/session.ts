import type { AnswerResponse, ChallengeDetail } from "./challenge";
import type { PlaylistSessionMetadata } from "./playlist";
export type SessionTarget =
  | { kind: "demo" }
  | { kind: "scenario"; scenarioId: string }
  | { kind: "playlist"; playlistId: string };

export type SavedAnswer = {
  id: string;
  answeredAt: string;
  result: AnswerResponse;
};
export type SessionItem = {
  id: string;
  position: number;
  challenge: ChallengeDetail;
  answer: SavedAnswer | null;
};
export type SessionSnapshot = {
  id: string;
  target: SessionTarget;
  title: string;
  playlist?: PlaylistSessionMetadata;
  status: "in_progress" | "completed" | "ended";
  phase: "setup" | "review" | "completed" | "ended";
  revision: number;
  currentIndex: number | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  endedAt: string | null;
  items: SessionItem[];
};
export type SessionMutationResponse = {
  session: SessionSnapshot;
  replayed: boolean;
};
export type CreateSessionResponse = SessionMutationResponse & {
  created: boolean;
};
export type SessionSummary = {
  id: string;
  target: SessionTarget;
  title: string;
  playlist?: PlaylistSessionMetadata;
  status: "in_progress" | "completed" | "ended";
  answeredCount: number;
  totalCount: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  endedAt: string | null;
};
export type SessionHistoryResponse = {
  sessions: SessionSummary[];
  nextCursor: string | null;
};
export type StartSessionRequest =
  | {
      requestId: string;
      target?: Exclude<SessionTarget, { kind: "playlist" }>;
      expectedPublicationVersion?: never;
    }
  | {
      requestId: string;
      target: Extract<SessionTarget, { kind: "playlist" }>;
      expectedPublicationVersion: string;
    };
export type AnswerSessionRequest = {
  optionId: string;
  requestId: string;
  expectedRevision: number;
};
export type AdvanceSessionRequest = {
  fromItemId: string;
  requestId: string;
  expectedRevision: number;
};
export type EndSessionRequest = {
  requestId: string;
  expectedRevision: number;
};
