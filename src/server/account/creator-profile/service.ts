import "server-only";
import { requireCreator } from "@/server/auth/guards";
import * as repository from "./repository";
import { parseSaveCreatorProfile } from "./validation";
import { toCreatorProfile, toCreatorProfileMutation } from "./projections";
export async function getCreatorProfile() {
  await requireCreator();
  return toCreatorProfile(await repository.getCreatorProfile());
}
export async function saveCreatorProfile(value: unknown) {
  await requireCreator();
  return toCreatorProfileMutation(
    await repository.saveCreatorProfile(parseSaveCreatorProfile(value)),
  );
}
