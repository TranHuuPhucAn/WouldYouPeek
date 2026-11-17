import "server-only";
import { redirect } from "next/navigation";
import { requireVerifiedUser } from "@/server/auth/guards";
import { ApiError } from "@/server/http";
export async function requirePageAccount(returnTo: string) {
  try {
    return await requireVerifiedUser();
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.code === "AUTH_REQUIRED")
        redirect(`/sign-in?returnTo=${encodeURIComponent(returnTo)}`);
      if (error.code === "EMAIL_NOT_VERIFIED") redirect("/check-email");
    }
    throw error;
  }
}
