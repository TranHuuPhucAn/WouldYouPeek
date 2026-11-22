import { execFile, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { LibraryScenarioPreview } from "@/contracts/library";
import type {
  ReportCategory,
  ReportReceipt,
  ReportTarget,
  VisibilityResponse,
} from "@/contracts/moderation";
import {
  assertDisposableTarget,
  cleanChildEnvironment,
} from "../../../scripts/local-target.mjs";
import { assertDockerOwnership } from "../../../scripts/local-test-stack.mjs";
import { createLocalTestClient, getLocalTestConfig } from "./local-supabase";
import { rpc } from "./creator-scenarios";
import { createVerifiedTestUser, type TestUser } from "./test-users";

/** Administrative fixture operations only, bound to the owned disposable project. */
export function moderationSql(statement: string): string {
  getLocalTestConfig();
  const target = assertDisposableTarget(process.env);
  assertDockerOwnership(target);
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
}

export function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export async function createOperator(): Promise<TestUser> {
  const user = await createVerifiedTestUser();
  moderationSql(
    `insert into private.operator_memberships(user_id) values (${sqlLiteral(user.id)});`,
  );
  return user;
}

export function revokeOperator(user: TestUser) {
  moderationSql(
    `update private.operator_memberships set revoked_at=clock_timestamp() where user_id=${sqlLiteral(user.id)};`,
  );
}

export async function revokeOperatorAsync(user: TestUser): Promise<void> {
  getLocalTestConfig();
  const target = assertDisposableTarget(process.env);
  assertDockerOwnership(target);
  await new Promise<void>((resolve, reject) => {
    const child = execFile(
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
        timeout: 15_000,
      },
      (error) =>
        error
          ? reject(new Error("Disposable operator revocation failed."))
          : resolve(),
    );
    child.stdin!.end(
      `update private.operator_memberships set revoked_at=clock_timestamp() where user_id=${sqlLiteral(user.id)};`,
    );
  });
}

export async function publicationTarget(
  scenarioId: string,
): Promise<Extract<ReportTarget, { kind: "publication" }>> {
  const preview = await rpc<LibraryScenarioPreview>(
    createLocalTestClient(),
    "get_library_preview",
    { p_scenario_id: scenarioId },
  );
  return {
    kind: "publication",
    scenarioId,
    contentVersion: preview.contentVersion,
  };
}

export function reportArgs(
  target: ReportTarget,
  category: ReportCategory = "analysis_issue",
  detail = "Please review the assumptions in this explanation.",
  requestId = randomUUID(),
) {
  return {
    p_request_id: requestId,
    p_target: target,
    p_category: category,
    p_detail: detail,
  };
}

export function submitReport(
  user: TestUser,
  target: ReportTarget,
  category?: ReportCategory,
  detail?: string,
) {
  return rpc<ReportReceipt>(
    user.client,
    "create_scenario_report",
    reportArgs(target, category, detail),
  );
}

export function visibilityArgs(
  scenarioId: string,
  revision: number,
  hidden = true,
  reason = "Review the timing and source context.",
  requestId = randomUUID(),
) {
  return {
    p_scenario_id: scenarioId,
    p_request_id: requestId,
    p_expected_revision: revision,
    p_hidden: hidden,
    p_reason: reason,
  };
}

export function setVisibility(
  operator: TestUser,
  scenarioId: string,
  revision: number,
  hidden = true,
) {
  return rpc<VisibilityResponse>(
    operator.client,
    "set_operator_scenario_visibility",
    visibilityArgs(scenarioId, revision, hidden),
  );
}
