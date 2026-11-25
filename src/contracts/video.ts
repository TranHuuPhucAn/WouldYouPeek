export const VIDEO_STATES = [
  "pending_upload",
  "uploaded",
  "validating",
  "ready",
  "rejected",
  "deleting",
  "deleted",
] as const;
export type VideoState = (typeof VIDEO_STATES)[number];
export type VideoMetadata = {
  durationSeconds: number;
  width: number;
  height: number;
  videoCodec: "h264";
  pixelFormat: "yuv420p";
  audioCodec: "aac" | null;
};
export type VideoAssetSnapshot = {
  id: string;
  revision: number;
  fileName: string;
  contentFingerprint: string;
  state: VideoState;
  byteSize: number;
  actualByteSize: number | null;
  metadata: VideoMetadata | null;
  failure: { code: string; message: string; retryable: boolean } | null;
  uploadExpiresAt: string;
  createdAt: string;
  updatedAt: string;
  canDelete: boolean;
};
export type VideoLimits = {
  maxFileBytes: number;
  maxDurationSeconds: number;
  maxWidth: number;
  maxHeight: number;
  maxPendingUploads: number;
  maxOwnerBytes: number;
};
export type VideoListResponse = {
  videos: VideoAssetSnapshot[];
  nextCursor: string | null;
  limits: VideoLimits;
  validator: { online: boolean; lastSeenAt: string | null };
};
export type CreateVideoRequest = {
  requestId: string;
  fileName: string;
  byteSize: number;
  mimeType: "video/mp4";
  /** SHA-256 of concatenated SHA-256 digests of successive 4 MiB file chunks. */
  contentFingerprint: string;
};
export type VideoCommand = { requestId: string; expectedRevision: number };
export type VideoMutationResponse = {
  video: VideoAssetSnapshot;
  replayed: boolean;
};
export type VideoRequestResponse = { video: VideoAssetSnapshot | null };
export type VideoUploadDescriptor = {
  assetId: string;
  bucket: "creator-vods";
  objectPath: string;
  endpoint: string;
  uploadUrl: string;
  expiresAt: string;
  byteSize: number;
  mimeType: "video/mp4";
};
export type VideoUploadSessionResponse = {
  video: VideoAssetSnapshot;
  upload: VideoUploadDescriptor;
};
export type PlaybackPhase = "setup" | "reveal";
export type PlaybackContext =
  | { kind: "operator-report"; reportId: string; phase: PlaybackPhase }
  | { kind: "creator-asset"; assetId: string }
  | {
      kind: "creator-scenario";
      scenarioId: string;
      revision: number;
      phase: PlaybackPhase;
    }
  | { kind: "library-scenario"; scenarioId: string }
  | {
      kind: "session-item";
      sessionId: string;
      itemId: string;
      phase: PlaybackPhase;
    };
export type PlaybackAccess = {
  assetId: string;
  url: string;
  expiresAt: string;
};
