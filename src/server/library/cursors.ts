import "server-only";
import { ApiError } from "@/server/http";
import { isScenarioId } from "@/lib/scenario-id";
import { UUID_PATTERN } from "@/server/training/validation";

const DATE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
function keys(v: Record<string, unknown>, names: string[]) {
  return (
    Object.keys(v).length === names.length &&
    names.every((k) => Object.hasOwn(v, k))
  );
}
function date(v: unknown) {
  return (
    typeof v === "string" &&
    v.length <= 50 &&
    DATE.test(v) &&
    Number.isFinite(Date.parse(v))
  );
}
export function parseCatalogueCursor(
  value: unknown,
  kind: "players" | "scenarios",
  filter: string | null,
): string | null {
  if (value === undefined || value === null) return null;
  try {
    if (
      typeof value !== "string" ||
      value.length > 1024 ||
      !/^[A-Za-z0-9_-]+$/.test(value)
    )
      throw new Error();
    const bytes = Buffer.from(value, "base64url");
    if (bytes.toString("base64url") !== value) throw new Error();
    const c = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    if (!c || typeof c !== "object" || Array.isArray(c)) throw new Error();
    if (
      kind === "scenarios" &&
      filter === null &&
      keys(c, ["publishedAt", "id"])
    ) {
      if (
        !date(c.publishedAt) ||
        typeof c.id !== "string" ||
        !UUID_PATTERN.test(c.id)
      )
        throw new Error();
      return value;
    }
    if (c.v !== 1 || c.kind !== kind) throw new Error();
    if (kind === "players") {
      if (
        !keys(c, ["v", "kind", "query", "id"]) ||
        c.query !== filter ||
        typeof c.id !== "string" ||
        !UUID_PATTERN.test(c.id)
      )
        throw new Error();
    } else if (
      !keys(c, ["v", "kind", "playerId", "at", "id"]) ||
      c.playerId !== filter ||
      !date(c.at) ||
      !isScenarioId(c.id)
    )
      throw new Error();
    return value;
  } catch {
    throw new ApiError(
      "INVALID_REQUEST",
      "The page cursor is invalid for this view.",
    );
  }
}
