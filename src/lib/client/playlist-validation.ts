import type {
  CreatorPlaylistListResponse,
  CreatorPlaylistScenarioList,
  CreatorPlaylistSnapshot,
  LibraryPlaylistResponse,
  PlaylistCredit,
  PlaylistDetail,
  PlaylistItemPreview,
  PlaylistMutationResponse,
  PlaylistPreview,
  PlaylistPublication,
  PlaylistReviewPreview,
  PlaylistSessionMetadata,
} from "@/contracts/playlist";
import { PLAYLIST_REVIEW_CHECKLIST_KEYS } from "@/contracts/playlist";
import {
  normalizeCreatorDisplayName,
  validatePlaylistDraft,
  validatePlaylistPublishContent,
} from "@/lib/playlists/content";
import { isScenarioId } from "@/lib/scenario-id";
import { invalidResponse, isRecord } from "./challenge-validation";
import { parseValidationIssues } from "./creator-validation";
import { parsePlayerSummary } from "./player-validation";
import { isDate, isUuid } from "./session-api";

const exact = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length &&
  keys.every((key) => key in value);
const count = (value: unknown) =>
  Number.isSafeInteger(value) && Number(value) >= 0;
const text = (
  value: unknown,
  maximum: number,
  empty = false,
): value is string =>
  typeof value === "string" &&
  (empty || !!value.trim()) &&
  [...value].length <= maximum &&
  !/[\u0000-\u0008\u000e-\u001f\u007f-\u0084\u0086-\u009f]/.test(value);
const version = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9._-]{1,100}$/.test(value);
function cursor(value: unknown) {
  if (!(value === null || text(value, 4096))) invalidResponse();
  return value as string | null;
}
function unique<T>(items: T[], key: (item: T) => string) {
  if (new Set(items.map(key)).size !== items.length) invalidResponse();
}

export function parsePlaylistCredit(value: unknown): PlaylistCredit {
  if (
    !isRecord(value) ||
    !exact(value, ["kind", "displayName"]) ||
    !["creator", "editorial"].includes(String(value.kind)) ||
    !text(value.displayName, 50) ||
    [...value.displayName].length < 2 ||
    normalizeCreatorDisplayName(value.displayName) !== value.displayName
  )
    invalidResponse();
  return {
    kind: value.kind as PlaylistCredit["kind"],
    displayName: value.displayName,
  };
}
function players(value: unknown) {
  if (!Array.isArray(value) || !value.length || value.length > 20)
    invalidResponse();
  const result = value.map(parsePlayerSummary);
  unique(result, (item) => item.id);
  return result;
}
export function parsePlaylistSessionMetadata(
  value: unknown,
): PlaylistSessionMetadata {
  if (
    !isRecord(value) ||
    !exact(value, ["publicationVersion", "credit", "players"]) ||
    !isUuid(value.publicationVersion)
  )
    invalidResponse();
  return {
    publicationVersion: value.publicationVersion,
    credit: parsePlaylistCredit(value.credit),
    players: players(value.players),
  };
}
export function parsePlaylistItemPreview(value: unknown): PlaylistItemPreview {
  if (
    !isRecord(value) ||
    !exact(value, [
      "scenarioId",
      "scenarioVersion",
      "title",
      "topic",
      "player",
      "map",
      "agent",
      "sourceKind",
      "provenance",
    ]) ||
    !isScenarioId(value.scenarioId) ||
    !version(value.scenarioVersion) ||
    !text(value.title, 120) ||
    !text(value.topic, 100) ||
    !text(value.map, 300) ||
    !text(value.agent, 300) ||
    !["youtube", "uploaded-video"].includes(String(value.sourceKind)) ||
    !["ai", "creator", "ai-assisted"].includes(String(value.provenance))
  )
    invalidResponse();
  return {
    scenarioId: value.scenarioId,
    scenarioVersion: value.scenarioVersion,
    title: value.title,
    topic: value.topic,
    player: parsePlayerSummary(value.player),
    map: value.map,
    agent: value.agent,
    sourceKind: value.sourceKind as PlaylistItemPreview["sourceKind"],
    provenance: value.provenance as PlaylistItemPreview["provenance"],
  };
}
function preview(value: unknown, detail: boolean): PlaylistPreview {
  if (
    !isRecord(value) ||
    !exact(value, [
      "id",
      "publicationVersion",
      "title",
      "description",
      "credit",
      "players",
      "itemCount",
      "publishedAt",
      ...(detail ? ["items"] : []),
    ]) ||
    !isUuid(value.id) ||
    !isUuid(value.publicationVersion) ||
    !text(value.title, 120) ||
    !text(value.description, 1000, true) ||
    !count(value.itemCount) ||
    Number(value.itemCount) < 1 ||
    Number(value.itemCount) > 20 ||
    !isDate(value.publishedAt)
  )
    invalidResponse();
  const included = players(value.players);
  if (included.length > Number(value.itemCount)) invalidResponse();
  return {
    id: value.id,
    publicationVersion: value.publicationVersion,
    title: value.title,
    description: value.description,
    credit: parsePlaylistCredit(value.credit),
    players: included,
    itemCount: Number(value.itemCount),
    publishedAt: value.publishedAt,
  };
}
export function parsePlaylistPreview(value: unknown) {
  return preview(value, false);
}
export function parsePlaylistDetail(
  value: unknown,
  expectedId?: string,
): PlaylistDetail {
  const base = preview(value, true),
    raw = value as Record<string, unknown>;
  if (
    (expectedId && base.id !== expectedId) ||
    !Array.isArray(raw.items) ||
    raw.items.length !== base.itemCount
  )
    invalidResponse();
  const items = raw.items.map(parsePlaylistItemPreview);
  unique(items, (item) => item.scenarioId);
  const included = [
    ...new Map(items.map((item) => [item.player.id, item.player])).values(),
  ];
  if (JSON.stringify(included) !== JSON.stringify(base.players))
    invalidResponse();
  return { ...base, items };
}
export function parseLibraryPlaylistResponse(
  value: unknown,
): LibraryPlaylistResponse {
  if (
    !isRecord(value) ||
    !exact(value, ["playlists", "nextCursor"]) ||
    !Array.isArray(value.playlists) ||
    value.playlists.length > 50
  )
    invalidResponse();
  const playlists = value.playlists.map(parsePlaylistPreview);
  unique(playlists, (item) => item.id);
  return { playlists, nextCursor: cursor(value.nextCursor) };
}
function publication(value: unknown): PlaylistPublication {
  if (
    !isRecord(value) ||
    !exact(value, [
      "state",
      "currentVersion",
      "publishedAt",
      "hasUnpublishedChanges",
      "availability",
      "issues",
    ]) ||
    !["never_published", "published", "withdrawn"].includes(
      String(value.state),
    ) ||
    typeof value.hasUnpublishedChanges !== "boolean" ||
    ![null, "available", "blocked"].includes(
      value.availability as null | string,
    )
  )
    invalidResponse();
  if (
    value.state === "never_published"
      ? value.currentVersion !== null ||
        value.publishedAt !== null ||
        value.availability !== null
      : !isUuid(value.currentVersion) || !isDate(value.publishedAt)
  )
    invalidResponse();
  const issues = parseValidationIssues(value.issues);
  if (value.state === "published") {
    if (
      value.availability === null ||
      (value.availability === "available"
        ? issues.length !== 0
        : issues.length === 0)
    )
      invalidResponse();
  } else if (value.availability !== null || issues.length !== 0)
    invalidResponse();
  return value as PlaylistPublication;
}
export function parseCreatorPlaylistSnapshot(
  value: unknown,
  expectedId?: string,
): CreatorPlaylistSnapshot {
  if (
    !isRecord(value) ||
    !exact(value, [
      "id",
      "revision",
      "draft",
      "items",
      "readiness",
      "review",
      "publication",
      "updatedAt",
    ]) ||
    !isUuid(value.id) ||
    (expectedId && value.id !== expectedId) ||
    !count(value.revision) ||
    !isDate(value.updatedAt) ||
    !isRecord(value.draft) ||
    !exact(value.draft, ["revision", "content", "savedAt"]) ||
    !count(value.draft.revision) ||
    Number(value.draft.revision) > Number(value.revision) ||
    !isDate(value.draft.savedAt) ||
    validatePlaylistDraft(value.draft.content).length
  )
    invalidResponse();
  const content = value.draft
    .content as CreatorPlaylistSnapshot["draft"]["content"];
  if (
    content.items.some((item) => !isUuid(item.scenarioId)) ||
    !Array.isArray(value.items) ||
    value.items.length !== content.items.length ||
    !isRecord(value.readiness) ||
    !exact(value.readiness, ["issues", "canReview"]) ||
    typeof value.readiness.canReview !== "boolean"
  )
    invalidResponse();
  const issues = parseValidationIssues(value.readiness.issues);
  const canReview = value.readiness.canReview;
  if (
    value.readiness.canReview !== (issues.length === 0) ||
    (value.readiness.canReview &&
      validatePlaylistPublishContent(content).length !== 0)
  )
    invalidResponse();
  value.items.forEach((item, index) => {
    if (
      !isRecord(item) ||
      !exact(item, [
        "position",
        "selection",
        "preview",
        "currentVersion",
        "issues",
      ]) ||
      item.position !== index ||
      !isRecord(item.selection) ||
      !exact(item.selection, ["scenarioId", "scenarioVersion"]) ||
      item.selection.scenarioId !== content.items[index].scenarioId ||
      item.selection.scenarioVersion !== content.items[index].scenarioVersion ||
      !(item.currentVersion === null || version(item.currentVersion))
    )
      invalidResponse();
    if (item.preview !== null) {
      const selected = parsePlaylistItemPreview(item.preview);
      if (
        selected.scenarioId !== item.selection.scenarioId ||
        selected.scenarioVersion !== item.selection.scenarioVersion
      )
        invalidResponse();
    }
    const itemIssues = parseValidationIssues(item.issues);
    if (
      canReview &&
      (item.preview === null ||
        item.currentVersion === null ||
        itemIssues.length !== 0)
    )
      invalidResponse();
  });
  publication(value.publication);
  if (value.review !== null) {
    const review = value.review;
    if (
      !isRecord(review) ||
      !exact(review, [
        "id",
        "draftRevision",
        "profileRevision",
        "reviewedAt",
        "checklist",
      ]) ||
      !isUuid(review.id) ||
      review.draftRevision !== value.draft.revision ||
      !count(review.profileRevision) ||
      Number(review.profileRevision) < 1 ||
      !isDate(review.reviewedAt) ||
      !isRecord(review.checklist) ||
      !exact(review.checklist, [...PLAYLIST_REVIEW_CHECKLIST_KEYS]) ||
      !PLAYLIST_REVIEW_CHECKLIST_KEYS.every(
        (key) => (review.checklist as Record<string, unknown>)[key] === true,
      ) ||
      !value.readiness.canReview
    )
      invalidResponse();
  }
  if (Date.parse(value.updatedAt) < Date.parse(value.draft.savedAt))
    invalidResponse();
  return value as CreatorPlaylistSnapshot;
}
export function parseCreatorPlaylistList(
  value: unknown,
): CreatorPlaylistListResponse {
  if (
    !isRecord(value) ||
    !exact(value, ["playlists", "nextCursor"]) ||
    !Array.isArray(value.playlists) ||
    value.playlists.length > 50
  )
    invalidResponse();
  const playlists = value.playlists.map((item) => {
    if (
      !isRecord(item) ||
      !exact(item, [
        "id",
        "title",
        "revision",
        "draftRevision",
        "itemCount",
        "canReview",
        "reviewed",
        "publication",
        "createdAt",
        "updatedAt",
      ]) ||
      !isUuid(item.id) ||
      !text(item.title, 120, true) ||
      !count(item.revision) ||
      !count(item.draftRevision) ||
      Number(item.draftRevision) > Number(item.revision) ||
      !count(item.itemCount) ||
      Number(item.itemCount) > 20 ||
      typeof item.canReview !== "boolean" ||
      typeof item.reviewed !== "boolean" ||
      (item.reviewed && !item.canReview) ||
      (item.canReview &&
        (Number(item.itemCount) < 1 || !text(item.title, 120))) ||
      !isDate(item.createdAt) ||
      !isDate(item.updatedAt)
    )
      invalidResponse();
    publication(item.publication);
    return item as CreatorPlaylistListResponse["playlists"][number];
  });
  unique(playlists, (item) => item.id);
  return { playlists, nextCursor: cursor(value.nextCursor) };
}
export function parsePlaylistMutationResponse(
  value: unknown,
  expectedId?: string,
): PlaylistMutationResponse {
  if (
    !isRecord(value) ||
    !exact(value, ["playlist", "replayed", "publishedVersion"]) ||
    typeof value.replayed !== "boolean" ||
    !(value.publishedVersion === null || isUuid(value.publishedVersion))
  )
    invalidResponse();
  return {
    playlist: parseCreatorPlaylistSnapshot(value.playlist, expectedId),
    replayed: value.replayed,
    publishedVersion: value.publishedVersion,
  };
}
export function parsePlaylistReviewPreview(
  value: unknown,
  expectedId?: string,
  expectedRevision?: number,
): PlaylistReviewPreview {
  if (
    !isRecord(value) ||
    !exact(value, ["playlist", "credit", "profileRevision", "items"]) ||
    !count(value.profileRevision) ||
    Number(value.profileRevision) < 1 ||
    !Array.isArray(value.items)
  )
    invalidResponse();
  const playlist = parseCreatorPlaylistSnapshot(value.playlist, expectedId);
  if (
    !playlist.readiness.canReview ||
    (expectedRevision !== undefined &&
      playlist.revision !== expectedRevision) ||
    value.items.length !== playlist.items.length ||
    (playlist.review !== null &&
      playlist.review.profileRevision !== value.profileRevision)
  )
    invalidResponse();
  const items = value.items.map(parsePlaylistItemPreview);
  if (
    items.some(
      (item, index) =>
        item.scenarioId !== playlist.draft.content.items[index].scenarioId ||
        item.scenarioVersion !==
          playlist.draft.content.items[index].scenarioVersion ||
        JSON.stringify(item) !==
          JSON.stringify(
            parsePlaylistItemPreview(playlist.items[index].preview),
          ),
    )
  )
    invalidResponse();
  const credit = parsePlaylistCredit(value.credit);
  if (credit.kind !== "creator") invalidResponse();
  return {
    playlist,
    credit,
    profileRevision: Number(value.profileRevision),
    items,
  };
}
export function parsePlaylistScenarioCandidates(
  value: unknown,
): CreatorPlaylistScenarioList {
  if (
    !isRecord(value) ||
    !exact(value, ["scenarios", "nextCursor"]) ||
    !Array.isArray(value.scenarios) ||
    value.scenarios.length > 50
  )
    invalidResponse();
  const scenarios = value.scenarios.map(parsePlaylistItemPreview);
  unique(scenarios, (item) => item.scenarioId);
  if (scenarios.some((item) => !isUuid(item.scenarioId))) invalidResponse();
  return { scenarios, nextCursor: cursor(value.nextCursor) };
}
export function validatePlaylistContinuity(
  next: CreatorPlaylistSnapshot,
  previous: CreatorPlaylistSnapshot,
) {
  if (
    next.id !== previous.id ||
    next.revision < previous.revision ||
    next.draft.revision < previous.draft.revision
  )
    invalidResponse();
}
