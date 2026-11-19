import { expect, it, vi } from "vitest";
import { parseAccount, enableCreatorAccess } from "@/lib/client/account-api";
import { viewer } from "./session-fixtures";
it("rejects inconsistent role and capabilities", () => {
  expect(parseAccount(viewer)).toEqual(viewer);
  expect(() => parseAccount({ ...viewer, role: "creator" })).toThrow();
  expect(() => parseAccount({ ...viewer, capabilities: ["create"] })).toThrow();
  expect(() => parseAccount({ ...viewer, id: "bad" })).toThrow();
});
it("enables only current account without caller-supplied role or identity", async () => {
  const creator = {
    ...viewer,
    role: "creator",
    capabilities: ["learn", "create"],
  };
  const fetcher = vi.fn().mockResolvedValue(Response.json(creator));
  vi.stubGlobal("fetch", fetcher);
  expect(await enableCreatorAccess()).toEqual(creator);
  expect(fetcher).toHaveBeenCalledWith(
    "/api/account/creator",
    expect.objectContaining({ body: "{}", cache: "no-store", method: "POST" }),
  );
});
