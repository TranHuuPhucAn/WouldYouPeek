import "server-only";
import type { AccountUser } from "@/contracts/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ApiError } from "@/server/http";
import { getPublicSupabaseConfig } from "@/server/config";

function checkIdentityError(error: unknown) {
  if (!error) return;
  const status =
    typeof error === "object" && "status" in error ? error.status : undefined;
  // Missing, expired or invalid credentials are guest state; connectivity failures are not.
  if (typeof status === "number" && status >= 400 && status < 500) return;
  throw new ApiError(
    "STORAGE_UNAVAILABLE",
    "Account services are temporarily unavailable. Please try again.",
  );
}

async function readIdentity<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch {
    throw new ApiError(
      "STORAGE_UNAVAILABLE",
      "Account services are temporarily unavailable. Please try again.",
    );
  }
}

export async function getCurrentAccount(): Promise<AccountUser | null> {
  try {
    getPublicSupabaseConfig();
  } catch {
    return null;
  }
  const client = await createServerSupabaseClient();
  const claims = await readIdentity(() => client.auth.getClaims());
  checkIdentityError(claims.error);
  if (claims.error || !claims.data?.claims.sub) return null;
  const {
    data: { user },
    error,
  } = await readIdentity(() => client.auth.getUser());
  checkIdentityError(error);
  if (error || !user || user.id !== claims.data.claims.sub) return null;
  const profile = await client
    .from("profiles")
    .select("role,created_at")
    .eq("user_id", user.id)
    .single();
  if (profile.error || !profile.data)
    throw new ApiError(
      "STORAGE_UNAVAILABLE",
      "Your account could not be loaded. Please try again.",
    );
  const role = profile.data.role;
  if (role !== "learner" && role !== "creator")
    throw new ApiError(
      "STORAGE_UNAVAILABLE",
      "Your account could not be loaded. Please try again.",
    );
  return {
    id: user.id,
    email: user.email ?? "",
    emailVerified: Boolean(user.email_confirmed_at),
    role,
    capabilities: role === "creator" ? ["learn", "create"] : ["learn"],
    createdAt: profile.data.created_at,
  };
}
export async function requireVerifiedUser(): Promise<AccountUser> {
  getPublicSupabaseConfig();
  const user = await getCurrentAccount();
  if (!user) throw new ApiError("AUTH_REQUIRED", "Sign in to continue.");
  if (!user.emailVerified)
    throw new ApiError(
      "EMAIL_NOT_VERIFIED",
      "Verify your email before continuing.",
    );
  return user;
}
export async function requireCreator(): Promise<AccountUser> {
  const user = await requireVerifiedUser();
  if (user.role !== "creator")
    throw new ApiError(
      "CREATOR_REQUIRED",
      "Enable creator access in your account first.",
    );
  return user;
}
