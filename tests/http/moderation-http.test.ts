import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type {
  OperatorReportDetail,
  ReportReceipt,
  ResolveReportResponse,
  VisibilityResponse,
} from "@/contracts/moderation";
import type { PlaybackAccess } from "@/contracts/video";
import {
  createVerifiedCreator,
  publishScenarioFixture,
} from "../integration/helpers/creator-scenarios";
import { createVerifiedTestUser } from "../integration/helpers/test-users";
import {
  createOperator,
  publicationTarget,
  revokeOperator,
} from "../integration/helpers/moderation";
import {
  fixture,
  uploadedContent,
  uploadReady,
} from "../integration/helpers/videos";
import { api, loginBrowser } from "./helpers/browser";

describe("moderation through real Next routes and SSR identity", () => {
  it("enforces authentication, operator membership, origin and bounded bodies", async () => {
    const learner = await createVerifiedTestUser({ operator: true }),
      creator = await createVerifiedCreator();
    const browser = await loginBrowser(learner),
      creatorBrowser = await loginBrowser(creator);
    const body = {
      requestId: randomUUID(),
      target: await publicationTarget("bind-clove-utility-window"),
      category: "broken_video",
      detail: "Source would not load",
    };
    expect(
      (await api(null, "/api/scenario-reports", body)).response.status,
    ).toBe(401);
    expect((await api(null, "/api/operator/reports")).response.status).toBe(
      401,
    );
    expect((await api(browser, "/api/operator/reports")).response.status).toBe(
      403,
    );
    expect(
      (await api(creatorBrowser, "/api/operator/reports")).response.status,
    ).toBe(403);
    expect(
      (
        await api(browser, "/api/scenario-reports", body, {
          headers: { Origin: "https://foreign.test" },
        })
      ).response.status,
    ).toBe(400);
    expect(
      (
        await api(browser, "/api/scenario-reports", {
          ...body,
          detail: "x".repeat(200_000),
        })
      ).response.status,
    ).toBe(413);
    expect(
      (
        await api(browser, "/api/scenario-reports", {
          ...body,
          reporterId: creator.id,
        })
      ).response.status,
    ).toBe(400);
    expect(
      (
        await api(browser, "/api/scenario-reports", {
          ...body,
          category: "other",
          detail: " ",
        })
      ).response.status,
    ).toBe(400);
    expect(
      (
        await api(
          browser,
          `/api/operator/scenarios/${body.target.scenarioId}/visibility`,
          {
            requestId: randomUUID(),
            expectedRevision: 0,
            hidden: true,
            reason: "Forged action",
          },
        )
      ).response.status,
    ).toBe(403);
  });

  it("persists exact receipts and independent operator actions without leaking private notes", async () => {
    const owner = await createVerifiedCreator(),
      learner = await createVerifiedTestUser(),
      operator = await createOperator();
    const scenario = await publishScenarioFixture(owner);
    const ownerBrowser = await loginBrowser(owner),
      learnerBrowser = await loginBrowser(learner),
      operatorBrowser = await loginBrowser(operator);
    const body = {
      requestId: randomUUID(),
      target: await publicationTarget(scenario.id),
      category: "analysis_issue",
      detail: "<script>Report text must stay plain text</script>",
    };
    const receipt = await api<ReportReceipt>(
      learnerBrowser,
      "/api/scenario-reports",
      body,
    );
    expect(receipt.response.status).toBe(200);
    expect(Object.keys(receipt.data.report).sort()).toEqual([
      "createdAt",
      "id",
      "status",
    ]);
    expect(
      (await api<ReportReceipt>(learnerBrowser, "/api/scenario-reports", body))
        .data,
    ).toMatchObject({ replayed: true, report: { id: receipt.data.report.id } });
    expect(
      (
        await api<ReportReceipt>(learnerBrowser, "/api/scenario-reports", {
          ...body,
          requestId: randomUUID(),
          detail: "Duplicate text",
        })
      ).data.duplicate,
    ).toBe(true);
    const path = `/api/operator/reports/${receipt.data.report.id}`;
    expect((await api(learnerBrowser, path)).response.status).toBe(403);
    const detail = await api<OperatorReportDetail>(operatorBrowser, path);
    expect(detail.response.status).toBe(200);
    expect(detail.data.report.detail).toBe(body.detail);
    expect(detail.data.report.contentVersion).toBe(body.target.contentVersion);
    expect(detail.data.media).not.toHaveProperty("selectedOptionId");
    const hideBody = {
      requestId: randomUUID(),
      expectedRevision: detail.data.visibility.revision,
      hidden: true,
      reason: "Please correct the explanation before restoration.",
    };
    const hide = await api<VisibilityResponse>(
      operatorBrowser,
      `/api/operator/scenarios/${scenario.id}/visibility`,
      hideBody,
    );
    expect(hide.response.status).toBe(200);
    expect(hide.data.visibility.hidden).toBe(true);
    expect(
      (await api(null, `/api/library/scenarios/${scenario.id}`)).response
        .status,
    ).toBe(404);
    expect(
      (
        await api(learnerBrowser, "/api/sessions", {
          requestId: randomUUID(),
          target: { kind: "scenario", scenarioId: scenario.id },
        })
      ).response.status,
    ).toBe(404);
    const resolve = {
      requestId: randomUUID(),
      expectedRevision: detail.data.report.revision,
      resolution: "addressed",
      operatorNote: "Private operator investigation details.",
    };
    expect(
      (
        await api<ResolveReportResponse>(
          operatorBrowser,
          `${path}/resolve`,
          resolve,
        )
      ).data.report.status,
    ).toBe("resolved");
    expect(
      (await api<OperatorReportDetail>(operatorBrowser, path)).data.visibility
        .hidden,
    ).toBe(true);
    const creatorView = await api(
      ownerBrowser,
      `/api/creator/scenarios/${scenario.id}`,
    );
    expect(JSON.stringify(creatorView.data)).not.toContain(
      resolve.operatorNote,
    );
    expect(JSON.stringify(creatorView.data)).not.toContain(body.detail);
    expect(JSON.stringify(creatorView.data)).not.toContain(learner.id);
    expect(JSON.stringify(creatorView.data)).toContain(hideBody.reason);
    expect(
      (
        await api(operatorBrowser, `${path}/resolve`, {
          ...resolve,
          requestId: randomUUID(),
        })
      ).response.status,
    ).toBe(409);
    revokeOperator(operator);
    expect((await api(operatorBrowser, path)).response.status).toBe(403);
    expect(
      (
        await api(
          operatorBrowser,
          `/api/operator/scenarios/${scenario.id}/visibility`,
          {
            ...hideBody,
            requestId: randomUUID(),
            expectedRevision: 1,
            hidden: false,
          },
        )
      ).response.status,
    ).toBe(403);
  });

  it("signs reported uploads through the real operator API and rejects forged or revoked contexts", async () => {
    const owner = await createVerifiedCreator(),
      reporter = await createVerifiedTestUser(),
      operator = await createOperator();
    const bytes = await fixture(),
      video = await uploadReady(owner, bytes);
    const scenario = await publishScenarioFixture(
      owner,
      uploadedContent(video.id),
    );
    const reporterBrowser = await loginBrowser(reporter),
      operatorBrowser = await loginBrowser(operator);
    const receipt = await api<ReportReceipt>(
      reporterBrowser,
      "/api/scenario-reports",
      {
        requestId: randomUUID(),
        target: await publicationTarget(scenario.id),
        category: "broken_video",
        detail: "Inspect the original recording.",
      },
    );
    expect(receipt.response.status).toBe(200);
    const context = {
      kind: "operator-report",
      reportId: receipt.data.report.id,
      phase: "reveal",
    };
    const signed = await api<PlaybackAccess>(
      operatorBrowser,
      "/api/media/playback",
      context,
    );
    expect(signed.response.status).toBe(200);
    expect(signed.data.assetId).toBe(video.id);
    const fetched = await fetch(signed.data.url, {
      headers: { Range: "bytes=0-127" },
    });
    expect(fetched.status).toBe(206);
    expect(Buffer.from(await fetched.arrayBuffer())).toEqual(
      bytes.subarray(0, 128),
    );
    expect(
      (await api(reporterBrowser, "/api/media/playback", context)).response
        .status,
    ).toBe(403);
    expect(
      (
        await api(operatorBrowser, "/api/media/playback", {
          ...context,
          assetId: video.id,
        })
      ).response.status,
    ).toBe(400);
    expect(
      (
        await api(operatorBrowser, "/api/media/playback", {
          ...context,
          reportId: randomUUID(),
        })
      ).response.status,
    ).toBe(404);
    revokeOperator(operator);
    expect(
      (await api(operatorBrowser, "/api/media/playback", context)).response
        .status,
    ).toBe(403);
  }, 60_000);
});
