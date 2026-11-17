import type { AnswerResponse, ChallengeDetail } from "./challenge";

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
  status: "in_progress" | "completed";
  phase: "setup" | "review" | "completed";
  revision: number;
  currentIndex: number | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
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
  status: "in_progress" | "completed";
  answeredCount: number;
  totalCount: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};
export type SessionHistoryResponse = {
  sessions: SessionSummary[];
  nextCursor: string | null;
};
export type StartSessionRequest = { requestId: string };
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
