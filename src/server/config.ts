import "server-only";
import { ApiError } from "./http";

function url(value: string | undefined, name: string): string {
  try {
    if (!value) throw new Error();
    const parsed = new URL(value);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      parsed.pathname !== "/"
    )
      throw new Error();
    return parsed.origin;
  } catch {
    throw new ApiError(
      "STORAGE_UNAVAILABLE",
      `Configure ${name} before using accounts and saved training.`,
    );
  }
}
export function getPublicSupabaseConfig() {
  const supabaseUrl = url(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    "NEXT_PUBLIC_SUPABASE_URL",
  );
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!publishableKey?.trim() || publishableKey.startsWith("sb_secret_"))
    throw new ApiError(
      "STORAGE_UNAVAILABLE",
      "Configure the public Supabase publishable key before using accounts.",
    );
  // Legacy local anon JWTs are allowed; service-role JWTs must never reach this client.
  try {
    const payload = JSON.parse(
      Buffer.from(publishableKey.split(".")[1] ?? "", "base64url").toString(),
    );
    if (payload.role === "service_role")
      throw new ApiError("STORAGE_UNAVAILABLE", "Use a public Supabase key.");
  } catch (error) {
    if (error instanceof ApiError) throw error;
  }
  return { url: supabaseUrl, publishableKey };
}
export function getServerAppConfig() {
  return {
    ...getPublicSupabaseConfig(),
    appOrigin: url(process.env.NEXT_PUBLIC_APP_URL, "NEXT_PUBLIC_APP_URL"),
  };
}
