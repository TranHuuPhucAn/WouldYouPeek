import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  REPORT_CATEGORIES,
  type OperatorReportDetail,
  type OperatorReportList,
  type ReportReceipt,
  type ResolveReportResponse,
} from "@/contracts/moderation";
import type {
  CreateSessionResponse,
  SessionMutationResponse,
} from "@/contracts/session";
import {
  createVerifiedCreator,
  publishScenarioFixture,
  rpc,
  saveDraftFixture,
} from "./helpers/creator-scenarios";
import { republishScenario } from "./helpers/playlists";
import { createLocalTestClient } from "./helpers/local-supabase";
import { createVerifiedTestUser } from "./helpers/test-users";
import {
  createOperator,
  moderationSql,
  publicationTarget,
  reportArgs,
  revokeOperator,
  sqlLiteral,
  submitReport,
} from "./helpers/moderation";

describe("version-pinned scenario reporting", () => {
  it("keeps current-publication and owned historical reports on the exact seen version", async () => {
    const owner = await createVerifiedCreator(),
      learner = await createVerifiedTestUser(),
      stranger = await createVerifiedTestUser(),
      operator = await createOperator();
    let scenario = await publishScenarioFixture(owner);
    const original = await publicationTarget(scenario.id);
    const session = (
      await rpc<CreateSessionResponse>(
        learner.client,
        "start_selected_training_session",
        {
          p_request_id: randomUUID(),
          p_target: { kind: "scenario", scenarioId: scenario.id },
        },
      )
    ).session;
    const item = session.items[0];
    const activeReport = await submitReport(
      learner,
      { kind: "session-item", sessionId: session.id, itemId: item.id },
      "broken_video",
    );
    expect(
      (
        await learner.client
          .from("attempts")
          .select("id")
          .eq("session_id", session.id)
      ).data,
    ).toEqual([]);
    await rpc<SessionMutationResponse>(
      learner.client,
      "submit_session_answer",
      {
        p_session_id: session.id,
        p_item_id: item.id,
        p_option_id: item.challenge.options[0].id,
        p_request_id: randomUUID(),
        p_expected_revision: 0,
      },
    );
    scenario = await republishScenario(
      owner,
      await saveDraftFixture(owner, scenario, {
        ...scenario.draft.content,
        question: "A revised question after the saved attempt",
      }),
    );
    expect(
      (await learner.client.rpc("create_scenario_report", reportArgs(original)))
        .error?.message,
    ).toBe("REPORT_TARGET_CHANGED");
    const historical = await submitReport(learner, {
      kind: "session-item",
      sessionId: session.id,
      itemId: item.id,
    });
    const detail = await rpc<OperatorReportDetail>(
      operator.client,
      "get_operator_report",
      { p_report_id: historical.report.id },
    );
    expect(detail.report.contentVersion).toBe(original.contentVersion);
    expect(detail.media.challenge).toEqual(item.challenge);
    expect(detail.visibility.currentContentVersion).toBe(
      scenario.publication.currentVersion,
    );
    expect(detail.visibility.currentContentVersion).not.toBe(
      original.contentVersion,
    );
    expect(detail.media).not.toHaveProperty("selectedOptionId");
    expect(detail.media).not.toHaveProperty("matchesPro");
    expect(detail.report).not.toHaveProperty("reporterId");
    expect(
      (
        await stranger.client.rpc(
          "create_scenario_report",
          reportArgs({
            kind: "session-item",
            sessionId: session.id,
            itemId: item.id,
          }),
        )
      ).error,
    ).not.toBeNull();
    expect(activeReport.report.id).not.toBe(historical.report.id);
  });

  it("rejects unseen queued and early-ended unanswered items as historical targets", async () => {
    const learner = await createVerifiedTestUser();
    const session = (
      await rpc<CreateSessionResponse>(
        learner.client,
        "start_training_session",
        { p_request_id: randomUUID() },
      )
    ).session;
    expect(
      (
        await learner.client.rpc(
          "create_scenario_report",
          reportArgs({
            kind: "session-item",
            sessionId: session.id,
            itemId: session.items[1].id,
          }),
        )
      ).error,
    ).not.toBeNull();
    await rpc(learner.client, "end_training_session", {
      p_session_id: session.id,
      p_request_id: randomUUID(),
      p_expected_revision: 0,
    });
    expect(
      (
        await learner.client.rpc(
          "create_scenario_report",
          reportArgs({
            kind: "session-item",
            sessionId: session.id,
            itemId: session.items[0].id,
          }),
        )
      ).error,
    ).not.toBeNull();
  });

  it("replays receipts, identifies duplicates without overwriting text, and enforces rolling quota", async () => {
    const learner = await createVerifiedTestUser(),
      operator = await createOperator();
    const target = await publicationTarget("bind-clove-utility-window"),
      input = reportArgs(target, "broken_video", "Original report text");
    const first = await rpc<ReportReceipt>(
      learner.client,
      "create_scenario_report",
      input,
    );
    expect(first).toMatchObject({
      replayed: false,
      duplicate: false,
      report: { status: "open" },
    });
    expect(Object.keys(first.report).sort()).toEqual([
      "createdAt",
      "id",
      "status",
    ]);
    expect(
      await rpc<ReportReceipt>(learner.client, "create_scenario_report", input),
    ).toMatchObject({ replayed: true, report: { id: first.report.id } });
    const duplicate = await rpc<ReportReceipt>(
      learner.client,
      "create_scenario_report",
      reportArgs(
        target,
        "broken_video",
        "A duplicate must not overwrite the initial report",
      ),
    );
    expect(duplicate).toMatchObject({
      duplicate: true,
      replayed: false,
      report: { id: first.report.id },
    });
    expect(
      (
        await rpc<OperatorReportDetail>(
          operator.client,
          "get_operator_report",
          { p_report_id: first.report.id },
        )
      ).report.detail,
    ).toBe("Original report text");
    expect(
      (
        await learner.client.rpc("create_scenario_report", {
          ...input,
          p_detail: "Changed under same request ID",
        })
      ).error?.message,
    ).toBe("IDEMPOTENCY_CONFLICT");
    for (const category of REPORT_CATEGORIES.slice(1, 5))
      await submitReport(learner, target, category);
    expect(
      (
        await learner.client.rpc(
          "create_scenario_report",
          reportArgs(target, "other", "Sixth distinct report"),
        )
      ).error?.message,
    ).toBe("RATE_LIMITED");
    expect(
      (
        await rpc<ReportReceipt>(
          learner.client,
          "create_scenario_report",
          input,
        )
      ).replayed,
    ).toBe(true);
    expect(
      (await submitReport(learner, target, "broken_video")).duplicate,
    ).toBe(true);
    expect(
      Number(
        moderationSql(
          `select count(*) from private.scenario_reports where reporter_id=${sqlLiteral(learner.id)};`,
        ),
      ),
    ).toBe(5);
  });

  it("requires protected membership and keeps resolution separate from scenario visibility", async () => {
    const learner = await createVerifiedTestUser({
        role: "operator",
        operator: true,
        capabilities: ["moderate"],
      }),
      creator = await createVerifiedCreator(),
      operator = await createOperator();
    const target = await publicationTarget("bind-clove-utility-window");
    const submitted = await submitReport(learner, target);
    expect(await rpc(learner.client, "get_operator_access")).toBe(false);
    expect(await rpc(creator.client, "get_operator_access")).toBe(false);
    expect(await rpc(operator.client, "get_operator_access")).toBe(true);
    for (const account of [learner, creator]) {
      expect(
        (
          await account.client.rpc("get_operator_report", {
            p_report_id: submitted.report.id,
          })
        ).error?.message,
      ).toBe("OPERATOR_REQUIRED");
      expect(
        (await account.client.rpc("list_operator_reports", {})).error?.message,
      ).toBe("OPERATOR_REQUIRED");
      expect(
        (
          await account.client
            .schema("private")
            .from("operator_memberships")
            .insert({ user_id: account.id })
        ).error,
      ).not.toBeNull();
      expect(
        (
          await account.client
            .schema("private")
            .from("scenario_reports")
            .select("*")
        ).error,
      ).not.toBeNull();
    }
    expect(
      (
        await createLocalTestClient().rpc(
          "create_scenario_report",
          reportArgs(target),
        )
      ).error,
    ).not.toBeNull();
    const detail = await rpc<OperatorReportDetail>(
      operator.client,
      "get_operator_report",
      { p_report_id: submitted.report.id },
    );
    const command = {
      p_report_id: submitted.report.id,
      p_request_id: randomUUID(),
      p_expected_revision: detail.report.revision,
      p_resolution: "dismissed",
      p_operator_note: "Inspected original source and explanation.",
    };
    const resolved = await rpc<ResolveReportResponse>(
      operator.client,
      "resolve_scenario_report",
      command,
    );
    expect(resolved.report.status).toBe("resolved");
    expect(
      (
        await rpc<OperatorReportDetail>(
          operator.client,
          "get_operator_report",
          { p_report_id: submitted.report.id },
        )
      ).visibility.hidden,
    ).toBe(false);
    expect(
      (
        await rpc<ResolveReportResponse>(
          operator.client,
          "resolve_scenario_report",
          command,
        )
      ).replayed,
    ).toBe(true);
    expect(
      (
        await operator.client.rpc("resolve_scenario_report", {
          ...command,
          p_request_id: randomUUID(),
        })
      ).error?.message,
    ).toBe("REPORT_CONFLICT");
    const secondReport = await submitReport(learner, target, "broken_video");
    const secondDetail = await rpc<OperatorReportDetail>(
      operator.client,
      "get_operator_report",
      { p_report_id: secondReport.report.id },
    );
    await rpc(operator.client, "resolve_scenario_report", {
      ...command,
      p_report_id: secondReport.report.id,
      p_request_id: randomUUID(),
      p_expected_revision: secondDetail.report.revision,
    });
    const page = await rpc<OperatorReportList>(
      operator.client,
      "list_operator_reports",
      { p_status: "resolved", p_limit: 1 },
    );
    expect(page.reports.every((report) => report.status === "resolved")).toBe(
      true,
    );
    expect(page.nextCursor).toBeTruthy();
    expect(
      (
        await operator.client.rpc("list_operator_reports", {
          p_status: "open",
          p_cursor: page.nextCursor,
          p_limit: 1,
        })
      ).error?.message,
    ).toBe("INVALID_REQUEST");
    revokeOperator(operator);
    expect(await rpc(operator.client, "get_operator_access")).toBe(false);
    expect(
      (
        await operator.client.rpc("get_operator_report", {
          p_report_id: submitted.report.id,
        })
      ).error?.message,
    ).toBe("OPERATOR_REQUIRED");
  });
});
