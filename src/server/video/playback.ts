import "server-only";
import type { PlaybackAccess } from "@/contracts/video";
import { requireVerifiedUser } from "@/server/auth/guards";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getPublicSupabaseConfig } from "@/server/config";
import { ApiError } from "@/server/http";
import { parsePlaybackContext } from "./validation";
import { toVideoObject } from "./projections";
import { authorizePlayback as authorize } from "./repository";
export async function issuePlaybackUrl(
  input: unknown,
): Promise<PlaybackAccess> {
  await requireVerifiedUser();
  const context = parsePlaybackContext(input),
    object = toVideoObject(await authorize(context)),
    client = await createServerSupabaseClient();
  const expiresIn = 300;
  const { data, error } = await client.storage
    .from(object.bucket)
    .createSignedUrl(object.objectPath, expiresIn);
  if (error || !data?.signedUrl)
    throw new ApiError(
      "MEDIA_UNAVAILABLE",
      "This video is temporarily unavailable. Try again.",
    );
  const origin = getPublicSupabaseConfig().url,
    url = new URL(data.signedUrl);
  if (
    url.origin !== origin ||
    url.username ||
    url.password ||
    url.hash ||
    url.pathname !==
      `/storage/v1/object/sign/${object.bucket}/${object.objectPath}` ||
    !url.searchParams.get("token")
  )
    throw new ApiError(
      "MEDIA_UNAVAILABLE",
      "The video address could not be loaded safely.",
    );
  return {
    assetId: object.assetId,
    url: url.toString(),
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
  };
}
