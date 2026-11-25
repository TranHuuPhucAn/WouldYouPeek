import "server-only";
import { notFound } from "next/navigation";
import { requirePageAccount } from "@/app/protected-page";
import { requireOperator } from "@/server/auth/guards";
import { ApiError } from "@/server/http";
export async function requireOperatorPage(returnTo: string) {
  await requirePageAccount(returnTo);
  try {
    return await requireOperator();
  } catch (error) {
    if (error instanceof ApiError && error.code === "OPERATOR_REQUIRED")
      notFound();
    throw error;
  }
}
