import "server-only";
import { redirect } from "next/navigation";
import { requireVerifiedUser } from "@/server/auth/guards";
import { ApiError } from "@/server/http";
import { safeReturnTo } from "@/server/auth/redirects";
export async function requirePageAccount(returnTo: string) {
  const destination = safeReturnTo(returnTo);
  try {
    return await requireVerifiedUser();
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.code === "AUTH_REQUIRED")
        redirect(`/sign-in?returnTo=${encodeURIComponent(destination)}`);
      if (error.code === "EMAIL_NOT_VERIFIED")
        redirect(`/check-email?returnTo=${encodeURIComponent(destination)}`);
    }
    throw error;
  }
}
export async function requirePageCreator(returnTo: string) {
  const viewer = await requirePageAccount(returnTo);
  if (viewer.role !== "creator") redirect("/account");
  return viewer;
}
