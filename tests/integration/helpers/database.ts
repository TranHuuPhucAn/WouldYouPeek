import { execFileSync } from "node:child_process";
import {
  assertDisposableTarget,
  cleanChildEnvironment,
} from "../../../scripts/local-target.mjs";
import { assertDockerOwnership } from "../../../scripts/local-test-stack.mjs";
import { getLocalTestConfig } from "./local-supabase";

// Exact primary RAISE messages in the tracked editorial maintenance script.
const EDITORIAL_ERRORS = new Set([
  "EDITORIAL_REPAIR_REQUIRES_POSTGRES",
  "EDITORIAL_REPAIR_TARGET_MISMATCH",
  "EDITORIAL_REPAIR_REVIEW_REQUIRED",
  "EDITORIAL_REPAIR_INVALID_SOURCES",
  "EDITORIAL_REPAIR_ORDER_MISMATCH",
  "EDITORIAL_REPAIR_PUBLICATION_CHANGED",
  "EDITORIAL_REPAIR_SOURCE_UNAVAILABLE",
  "EDITORIAL_REPAIR_SOURCE_CHANGED",
  "EDITORIAL_REPAIR_GENERATION_CHANGED",
  "EDITORIAL_REPAIR_MEDIA_UNAVAILABLE",
]);

export function fixtureSqlFailure(error: unknown): Error & { stderr?: string } {
  const failure: Error & { stderr?: string } = new Error(
    "Disposable fixture database operation failed.",
  );
  try {
    const raw = (error as { stderr?: unknown } | null)?.stderr;
    const limit = 32_768;
    let text = "";
    let truncated = false;
    if (Buffer.isBuffer(raw)) {
      truncated = raw.length > limit;
      text = raw.subarray(0, limit).toString("utf8");
    } else if (typeof raw === "string") {
      truncated = raw.length > limit;
      text = raw.slice(0, limit);
    }
    // A truncated final line cannot establish an exact primary message.
    if (truncated) text = text.slice(0, text.lastIndexOf("\n") + 1);
    const primary = text.split(/\r?\n/).find((line) =>
      /^(?:psql:(?:<stdin>|-):\d+:\s*)?ERROR:\s/.test(line),
    );
    const code = primary?.match(
      /^(?:psql:(?:<stdin>|-):\d+:\s*)?ERROR:\s+([A-Z_]+)\s*$/,
    )?.[1];
    if (code && EDITORIAL_ERRORS.has(code)) failure.stderr = `ERROR: ${code}\n`;
  } catch {
    // Unknown exception shapes and getters also receive only the fixed message.
  }
  return failure;
}

/** Trusted fixture administration only, never a normal or hosted database. */
export function fixtureSql(statement: string): string {
  getLocalTestConfig();
  const target = assertDisposableTarget(process.env);
  assertDockerOwnership(target);
  try {
    return execFileSync(
      "docker",
      [
        "exec",
        "-i",
        `supabase_db_${target.projectId}`,
        "psql",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-X",
        "-Atq",
        "-v",
        "ON_ERROR_STOP=1",
      ],
      {
        cwd: target.workspace,
        env: { ...cleanChildEnvironment(), NODE_ENV: "test" },
        input: statement,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 10_000,
      },
    ).trim();
  } catch (error) {
    // Child errors may include private rows, SQL input or credentials.
    throw fixtureSqlFailure(error);
  }
}

export function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
