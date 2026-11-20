export type CreatorProfile = { displayName: string | null; revision: number };
export type SaveCreatorProfileRequest = {
  requestId: string;
  expectedRevision: number;
  displayName: string;
};
export type CreatorProfileMutationResponse = {
  profile: CreatorProfile;
  replayed: boolean;
};
