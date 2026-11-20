import type { ValidationIssue, CreatorFilter } from "./creator";
import type { PlayerSummary } from "./player";
export type PlaylistSelection = { scenarioId: string; scenarioVersion: string };
export type PlaylistDraftContent = {
  title: string;
  description: string;
  items: PlaylistSelection[];
};
export type PlaylistCredit = {
  kind: "creator" | "editorial";
  displayName: string;
};
export type PlaylistItemPreview = PlaylistSelection & {
  title: string;
  topic: string;
  player: PlayerSummary;
  map: string;
  agent: string;
  sourceKind: "youtube" | "uploaded-video";
  provenance: "ai" | "creator" | "ai-assisted";
};
export type CreatorPlaylistItem = {
  position: number;
  selection: PlaylistSelection;
  preview: PlaylistItemPreview | null;
  currentVersion: string | null;
  issues: ValidationIssue[];
};
export type PlaylistPublication = {
  state: "never_published" | "published" | "withdrawn";
  currentVersion: string | null;
  publishedAt: string | null;
  hasUnpublishedChanges: boolean;
  availability: "available" | "blocked" | null;
  issues: ValidationIssue[];
};
export const PLAYLIST_REVIEW_CHECKLIST_KEYS = [
  "orderChecked",
  "selectedVersionsChecked",
  "mixedPlayersChecked",
  "creditChecked",
] as const;
export type PlaylistReviewChecklist = Record<
  (typeof PLAYLIST_REVIEW_CHECKLIST_KEYS)[number],
  boolean
>;
export type CreatorPlaylistSnapshot = {
  id: string;
  revision: number;
  draft: { revision: number; content: PlaylistDraftContent; savedAt: string };
  items: CreatorPlaylistItem[];
  readiness: { issues: ValidationIssue[]; canReview: boolean };
  review: {
    id: string;
    draftRevision: number;
    profileRevision: number;
    reviewedAt: string;
    checklist: PlaylistReviewChecklist;
  } | null;
  publication: PlaylistPublication;
  updatedAt: string;
};
export type CreatorPlaylistSummary = {
  id: string;
  title: string;
  revision: number;
  draftRevision: number;
  itemCount: number;
  canReview: boolean;
  reviewed: boolean;
  publication: PlaylistPublication;
  createdAt: string;
  updatedAt: string;
};
export type CreatorPlaylistListResponse = {
  playlists: CreatorPlaylistSummary[];
  nextCursor: string | null;
};
export type PlaylistMutationResponse = {
  playlist: CreatorPlaylistSnapshot;
  replayed: boolean;
  publishedVersion: string | null;
};
export type PlaylistReviewPreview = {
  playlist: CreatorPlaylistSnapshot;
  credit: PlaylistCredit;
  profileRevision: number;
  items: PlaylistItemPreview[];
};
export type CreatorPlaylistScenarioList = {
  scenarios: PlaylistItemPreview[];
  nextCursor: string | null;
};
export type PlaylistPreview = {
  id: string;
  publicationVersion: string;
  title: string;
  description: string;
  credit: PlaylistCredit;
  players: PlayerSummary[];
  itemCount: number;
  publishedAt: string;
};
export type PlaylistDetail = PlaylistPreview & { items: PlaylistItemPreview[] };
export type LibraryPlaylistResponse = {
  playlists: PlaylistPreview[];
  nextCursor: string | null;
};
export type PlaylistSessionMetadata = {
  publicationVersion: string;
  credit: PlaylistCredit;
  players: PlayerSummary[];
};
export type PlaylistFilter = CreatorFilter;
export type CreatePlaylistRequest = { requestId: string };
export type PlaylistCommand = { requestId: string; expectedRevision: number };
export type SavePlaylistRequest = PlaylistCommand & {
  content: PlaylistDraftContent;
};
export type ReviewPlaylistRequest = PlaylistCommand & {
  checklist: PlaylistReviewChecklist;
  profileRevision: number;
};
export type PublishPlaylistRequest = PlaylistCommand & { reviewId: string };
export const CURATED_TENZ_PLAYLIST_ID = "7ecf3523-18cb-5cbe-a307-5b5cd43d1836";
