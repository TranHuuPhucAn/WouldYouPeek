import type { AccountUser } from "@/contracts/auth";
import { readApiResponse } from "./api-response";
import { invalidResponse, isRecord, isText } from "./challenge-validation";
import { isDate, isUuid } from "./session-api";
export function parseAccount(value: unknown): AccountUser {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !isText(value.email) ||
    !value.email.includes("@") ||
    typeof value.emailVerified !== "boolean" ||
    !["learner", "creator"].includes(String(value.role)) ||
    !isDate(value.createdAt) ||
    !Array.isArray(value.capabilities) ||
    value.capabilities.length !== (value.role === "creator" ? 2 : 1) ||
    !value.capabilities.includes("learn") ||
    (value.role === "creator" && !value.capabilities.includes("create"))
  )
    invalidResponse();
  return value as AccountUser;
}
export async function getAccount(signal?: AbortSignal) {
  return parseAccount(
    await readApiResponse(
      await fetch("/api/account", { cache: "no-store", signal }),
    ),
  );
}
export async function enableCreatorAccess(signal?: AbortSignal) {
  const account = parseAccount(
    await readApiResponse(
      await fetch("/api/account/creator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        cache: "no-store",
        signal,
      }),
    ),
  );
  if (account.role !== "creator") invalidResponse();
  return account;
}
