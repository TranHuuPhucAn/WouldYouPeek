import { describe, expect, it, vi } from "vitest";
import {
  parseCreatorSnapshot,
  parseCreatorList,
  parseCreatorReview,
  parseCreatorMutationResponse,
  validateCreatorContinuity,
} from "@/lib/client/creator-validation";
import * as api from "@/lib/client/creator-api";
import { parseApiError } from "@/lib/client/api-response";
import {
  listLibraryScenarios,
  getLibraryScenario,
} from "@/lib/client/library-api";
import {
  creatorSnapshot,
  creatorSummary,
  creatorPreview,
  creatorId,
  commandId,
  allChecked,
  reviewId,
  libraryEntry,
} from "./creator-fixtures";
import { sessionSummary } from "./session-fixtures";
describe("strict creator API boundary", () => {
  it("accepts incomplete drafts, complete drafts and review receipts", () => {
    for (const s of [
      creatorSnapshot(false),
      creatorSnapshot(),
      creatorSnapshot(true, true),
    ])
      expect(parseCreatorSnapshot(s, s.id)).toEqual(s);
    expect(
      parseCreatorList({ scenarios: [creatorSummary()], nextCursor: null })
        .scenarios,
    ).toHaveLength(1);
    expect(
      parseCreatorReview(creatorPreview(), creatorId, 1).challenge.id,
    ).toBe(creatorId);
  });
  it.each([
    (s: ReturnType<typeof creatorSnapshot>) => ({
      ...s,
      ownerEmail: "private@example.com",
    }),
    (s: ReturnType<typeof creatorSnapshot>) => ({ ...s, id: "bad-id" }),
    (s: ReturnType<typeof creatorSnapshot>) => ({ ...s, revision: -1 }),
    (s: ReturnType<typeof creatorSnapshot>) => ({
      ...s,
      draft: { ...s.draft, revision: 90 },
    }),
    (s: ReturnType<typeof creatorSnapshot>) => ({
      ...s,
      readiness: { issues: [], canReview: false },
    }),
    (s: ReturnType<typeof creatorSnapshot>) => ({
      ...s,
      publication: { ...s.publication, state: "published" },
    }),
    (s: ReturnType<typeof creatorSnapshot>) => ({
      ...s,
      review: { ...creatorSnapshot(true, true).review!, draftRevision: 99 },
    }),
    (s: ReturnType<typeof creatorSnapshot>) => ({
      ...s,
      draft: { ...s.draft, content: { ...s.draft.content, title: 90 } },
    }),
  ])("rejects incoherent or private response %#", (mutate) =>
    expect(() => parseCreatorSnapshot(mutate(creatorSnapshot()))).toThrow(),
  );
  it("rejects wrong identities, regressions, duplicate rows and malformed command receipts", () => {
    expect(() => parseCreatorSnapshot(creatorSnapshot(), commandId)).toThrow();
    expect(() =>
      validateCreatorContinuity(
        { ...creatorSnapshot(), revision: 0 },
        creatorSnapshot(),
      ),
    ).toThrow();
    expect(() =>
      parseCreatorList({
        scenarios: [creatorSummary(), creatorSummary()],
        nextCursor: null,
      }),
    ).toThrow();
    expect(() =>
      parseCreatorMutationResponse({
        scenario: creatorSnapshot(),
        replayed: "yes",
        publishedVersion: null,
      }),
    ).toThrow();
  });
  it("rejects stale preview and feedback assigned to a different option", () => {
    expect(() => parseCreatorReview(creatorPreview(), creatorId, 99)).toThrow();
    const p = creatorPreview();
    const ids = p.challenge.options.map((o) => o.id);
    p.feedbackByOption[ids[1]] = p.feedbackByOption[ids[0]];
    expect(() => parseCreatorReview(p)).toThrow();
  });
  it("accepts creator and AI-assisted analysis in preview feedback", () => {
    for (const author of ["creator", "ai-assisted"] as const) {
      const p = creatorPreview();
      Object.values(p.feedbackByOption).forEach((answer) => {
        answer.analysis!.author = author;
      });
      expect(
        parseCreatorReview(p).feedbackByOption[p.challenge.options[0].id]
          .analysis?.author,
      ).toBe(author);
    }
  });
  it("preserves all command fields and uses private no-store requests", async () => {
    const response = {
      scenario: creatorSnapshot(),
      replayed: false,
      publishedVersion: null,
    };
    const fetcher = vi
      .fn()
      .mockImplementation(() => Promise.resolve(Response.json(response)));
    vi.stubGlobal("fetch", fetcher);
    await api.createCreatorScenario({ requestId: commandId });
    await api.saveCreatorScenario(creatorId, {
      requestId: commandId,
      expectedRevision: 1,
      content: creatorSnapshot().draft.content,
    });
    await api.reviewCreatorScenario(creatorId, {
      requestId: commandId,
      expectedRevision: 1,
      checklist: allChecked(),
    });
    await api.publishCreatorScenario(creatorId, {
      requestId: commandId,
      expectedRevision: 2,
      reviewId,
    });
    await api.unpublishCreatorScenario(creatorId, {
      requestId: commandId,
      expectedRevision: 3,
    });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/creator/scenarios",
      `/api/creator/scenarios/${creatorId}`,
      `/api/creator/scenarios/${creatorId}/review`,
      `/api/creator/scenarios/${creatorId}/publish`,
      `/api/creator/scenarios/${creatorId}/unpublish`,
    ]);
    for (const [, init] of fetcher.mock.calls) {
      expect(init.cache).toBe("no-store");
      expect(init.headers).toEqual({ "Content-Type": "application/json" });
      expect(JSON.parse(init.body).requestId).toBe(commandId);
    }
    expect(fetcher.mock.calls[1][1].method).toBe("PUT");
  });
  it("encodes pagination/filter and binds preview to a saved revision", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ scenarios: [], nextCursor: null }))
      .mockResolvedValueOnce(Response.json(creatorPreview()))
      .mockResolvedValueOnce(Response.json(creatorSnapshot()));
    vi.stubGlobal("fetch", fetcher);
    await api.listCreatorScenarios("next token", "withdrawn");
    await api.getCreatorReview(creatorId, 1);
    await api.getCreatorScenario(creatorId);
    expect(fetcher.mock.calls[0][0]).toBe(
      "/api/creator/scenarios?status=withdrawn&cursor=next+token",
    );
    expect(fetcher.mock.calls[1][0]).toBe(
      `/api/creator/scenarios/${creatorId}/review?revision=1`,
    );
  });
  it("rejects an unsafe scenario path before issuing a request", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(api.getCreatorScenario("../account")).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
describe("library and safe conflict diagnostics", () => {
  it("accepts preview-only library entries and rejects answer disclosures", async () => {
    const entry = libraryEntry();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ scenarios: [entry], nextCursor: null }),
      )
      .mockResolvedValueOnce(Response.json(entry))
      .mockResolvedValueOnce(
        Response.json({ ...entry, observedAction: { optionId: "secret" } }),
      );
    vi.stubGlobal("fetch", fetcher);
    expect((await listLibraryScenarios()).scenarios).toEqual([entry]);
    expect(await getLibraryScenario(creatorId)).toEqual(entry);
    await expect(getLibraryScenario(creatorId)).rejects.toThrow();
    expect(fetcher.mock.calls[0][1].cache).toBe("no-store");
  });
  it("rejects malformed cursors and unknown provenance", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ scenarios: [], nextCursor: 42 }))
        .mockResolvedValueOnce(
          Response.json({ ...libraryEntry(), provenance: "official-pro" }),
        ),
    );
    await expect(listLibraryScenarios()).rejects.toThrow();
    await expect(getLibraryScenario(creatorId)).rejects.toThrow();
  });
  it("allowlists a valid owned active-session resume target", () => {
    const active = sessionSummary();
    const error = parseApiError(
      {
        error: {
          code: "ACTIVE_SESSION_EXISTS",
          message: "Continue current session",
          details: {
            activeSession: {
              ...active,
              email: "private@example.com",
              token: "secret",
            },
          },
        },
      },
      409,
    );
    expect(error.details).toEqual({ activeSession: active });
    expect(JSON.stringify(error.details)).not.toContain("private@example");
  });
  it("drops malformed active targets and bounds validation diagnostics", () => {
    expect(
      parseApiError(
        {
          error: {
            code: "ACTIVE_SESSION_EXISTS",
            message: "Conflict",
            details: { activeSession: { ...sessionSummary(), id: "/evil" } },
          },
        },
        409,
      ).details,
    ).toBeUndefined();
    expect(
      parseApiError(
        {
          error: {
            code: "DRAFT_NOT_READY",
            message: "Incomplete",
            details: {
              issues: [
                {
                  path: "title",
                  code: "REQUIRED",
                  message: "Title needed",
                  private: "secret",
                },
              ],
            },
          },
        },
        422,
      ).details,
    ).toEqual({
      issues: [{ path: "title", code: "REQUIRED", message: "Title needed" }],
    });
  });
});
